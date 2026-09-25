# API worker instructions

Read [the root instructions](../../AGENTS.md), [core](../../packages/core/AGENTS.md) and [infrastructure](../../packages/infrastructure/AGENTS.md) first. Keep this file current when routes, bindings or middleware change.

`@pickler/api` is Pickler's backend on Cloudflare Workers (Hono). It replaces the parts of Relayer's NestJS API (on Render) that Pickler needs; the extraction plan is in [docs/relayer-extraction/00-plan.md](../../docs/relayer-extraction/00-plan.md).

## Current state

```text
src/
  index.ts                  # Worker entry; builds services lazily from bindings
  app.ts                    # createApp(services): routes, request id, error handler
  container.ts              # Composition root: Supabase adapters + core use cases
  env.ts                    # Bindings and Hono context variables
  http/envelope.ts          # Relayer's response envelope (same JSON shape)
  http/error-handler.ts     # Relayer's global exception filter; maps core errors to statuses
  http/http-error.ts        # Route-level HTTP errors
  http/agent-dto.ts         # Relayer's snake_case agent, analytics and audit shapes
  middleware/request-id.ts
  middleware/auth.ts        # authenticated(), requireModule(), requirePermission()
  middleware/agent-auth.ts  # agentOnly() (HMAC) and agentScoped() (HMAC or JWT/API key, optional self-access)
  routes/auth.ts            # GET /v1/auth/me
  routes/agents.ts          # Agent read endpoints
  routes/marketplace.ts     # Public marketplace reads: agents from the database, markets from the sample board
  routes/signing.ts         # Passkey custody: challenge, register, add device, wallet read
  growth/market-responses.ts# Perpetual market read models mapped to their DTOs
  budget/agent-ledger.ts    # AgentLedger Durable Object: budget authority per agent
  budget/sql-ledger-store.ts# LedgerStore over Durable Object SQLite (amounts as decimal TEXT)
  budget/budget-gateway.ts  # What routes use from the ledger
test/                       # Route and middleware tests with injected services
```

Routes:

| Route                                                                                          | Auth                                                                    |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /health`                                                                                  | none (liveness only)                                                    |
| `GET /v1/auth/me`                                                                              | signed-in user; API keys refused                                        |
| `GET /v1/handles/:handle/availability`                                                         | none (sign-up form)                                                     |
| `GET /v1/profile`, `POST /v1/profile`                                                          | signed-in user (JWT); API keys refused                                  |
| `GET /v1/agents`, `GET /v1/agents/:id`, `GET /v1/agents/:id/audit`                             | JWT or API key + `agent` module + `read Agent`                          |
| `GET /v1/agents/:id/status`, `GET /v1/agents/:id/analytics`, `GET /v1/agents/:id/budget`       | agent HMAC (own id only) or JWT/API key + `agent` module + `read Agent` |
| `GET /v1/marketplace/{agents,directory,reads,profiles,personas,markets,analytics,leaderboard}` | none (public marketplace)                                               |
| `POST /v1/signing/passkeys/{challenge,register,add/prepare,add/confirm}`                       | signed-in user; API keys refused                                        |
| `GET /v1/signing/wallets/me`                                                                   | signed-in user; API keys refused                                        |
| `GET /v1/signing/agents/state`, `POST /v1/signing/agents/{delegated,wallet}/{prepare,confirm}` | signed-in user; API keys refused                                        |
| `POST /v1/signing/agents/wallet/:walletId/policies/{prepare,confirm}`                          | signed-in user; API keys refused                                        |

Agent HMAC follows `@relayerfi/agent-sdk`: headers `x-agent-id`, `x-agent-auth`, `x-request-timestamp`; payload `METHOD + /v1/path + timestamp + sha256(JSON.stringify(body) or "")`, ±60 s. Agent secrets (`agents.agent_credentials`) are decrypted with `ENCRYPTION_KEY`; the format is byte-compatible with Relayer's, so the key only has to equal Relayer's when importing Relayer data. Agent write endpoints are not ported yet.

## Passkey custody

`/v1/signing` is mounted only when `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`,
`TURNKEY_PARENT_ORG_ID`, `TURNKEY_RPID` and `TURNKEY_APP_NAME` are all bound; without them the
rest of the API serves unchanged. The decisions are `createCustodyService` in `@pickler/core`;
the routes validate and map. The email that names the Turnkey sub-organization and identifies
the user to the authenticator comes from the verified token, never from the body, and an
attestation is refused at the door unless it is three base64url strings and transports Turnkey
has a name for (`SUPPORTED_TRANSPORTS`).

Responses deliberately withhold what the browser has no use for: register answers with
`sub_organization_id`, `master_wallet_id` and `address` but not the root user id, and
add/confirm answers with the activity's id and status rather than the activity. All three
reasons a challenge can be refused — unknown, someone else's, expired — are one 400 with one
body; mapping them apart would tell a caller that a challenge they guessed exists.

The custody service is built per request so the orphaned-sub-organization warning a lost
registration race produces carries the request id. `wallets.webauthn_challenges` has no sweeper
yet: rows are deleted when consumed, expiry is judged on read, and an authenticated caller can
leave one row per challenge request behind. The `webauthn_challenges_expiry_idx` index is there
for the cleanup that has not been written.

### The agent wallet ceremony

Under the same mount, `/v1/signing/agents` runs docs/specs/studio-create-and-fund-v1.md §4.1 as
prepare → passkey stamp in the browser → confirm, three times: Pickler's delegated user (first
agent only), the agent's wallet (`{ handle }`, profile handle rules), and that wallet's policies
(no body; core adds the delegated user's self-delete policy when none of the person's wallets
is linked to an agent yet, and a `first_agent` field is refused). Each confirm is refused with 400
`invalid_signed_activity` before anything reaches Turnkey unless the stamped request is exactly
what its prepare built, apart from the timestamp. Prepares answer the
unsigned activity in add/prepare's shape; a wallet prepare for a handle with an unlinked wallet
answers `{ existing: { wallet_id, address } }` instead, and the browser skips that stamp.
Confirms answer `delegated_user_id`, `{ wallet_id, address }` and `policy_ids`.
`GET /agents/state` answers `has_sub_organization` and `has_delegated_user`. The link to an agent
is written by the create-agent transaction, not here.

`TURNKEY_DELEGATED_API_PUBLIC_KEY` is the public half of Pickler's delegated key; without it the
ceremony answers 503 `agent_wallets_unavailable` and nothing else changes. `delegatedPublicKeyFrom`
in `container.ts` accepts only a compressed P-256 key (`0[23]` plus 64 hex); anything else is
treated as absent, with a `console.error` naming the variable, never its value. A delegated user
Turnkey created but Pickler could not record (a lost race) is logged with `console.error`: ids only.
`TURNKEY_DELEGATED_API_PRIVATE_KEY` is held by Pickler, unused until live trading, and never
logged or passed to the custody service. Generate a pair with
`npm run turnkey:delegated-key --workspace=@pickler/infrastructure -- --print-private` (without
the flag only the public key is printed); append one to a local `.dev.vars` without printing it
with `... -- --append <absolute path to workers/api/.dev.vars>`. A changed `.dev.vars` needs a `wrangler dev` restart.

## Budget ledger

`AgentLedger` (binding `AGENT_LEDGER`, SQLite-backed, one instance per agent id) replaces Relayer's Redis hash and `budget-check.lua`. Logic lives in `@pickler/core` (`createBudgetLedger`); the object wraps every operation in `ctx.storage.transactionSync`, schedules an alarm for the next reservation expiry and hydrates once, read-only, from `budget.budgets` and `agents.agents.status`.

- Spend goes through `reserve` → `commit` or `release`, idempotent by reservation id. Post-hoc telemetry uses `record`, deduplicated by event id.
- Tables are created synchronously in the constructor. Do not move migrations into `blockConcurrencyWhile(async …)`: a spike showed methods could run before the tables existed.
- The ledger does not write to Postgres yet. A write-behind projection to `budget.budgets` and `budget.ledger_entries` comes next.
- The legacy `POST /v1/agents/:id/budget` (API key can raise limits) is intentionally not ported; limit changes arrive with the passkey prepare/confirm flow (Turnkey wave).
- Verified in local workerd: 50 concurrent reserves of 70 against a limit of 1000 accept exactly 14; retries with the same ids add nothing; the alarm releases expired holds.

## Public marketplace

`routes/marketplace.ts` serves the marketplace's public reads under `/v1/marketplace`. Agents,
directory, reads, profiles, personas, analytics and the leaderboard answer from
`PostgresAgentDirectory` over the invocation's pool, so an empty database is an empty marketplace
and a failed read is a failure. The prefix exists because `/v1/agents` is already the authenticated
workspace agent list ported from Relayer; mounting the public list on the same path would put it
behind that route's credentials. The invented agents that used to answer here now live in
`scripts/design/fixtures/` and are served only by the design harness's fixture API.

`/v1/marketplace/markets` and `/v1/marketplace/markets/:symbol` still answer from
`createSampleMarketBoard`: no venue is polled and private research never feeds them. The detail
response includes `readQuestion` — core's `readQuestionAtLevel` with `{level}` left for the client —
so the sentence a paid read answers is written once, here, and not in a page.

## Rules

- Keep decisions in `@pickler/core` (authentication, permissions, modules). Middleware reads HTTP and maps results; it does not decide.
- Every ported file starts with its Relayer source path and commit and lists intentional behaviour changes.
- Responses use `successEnvelope` / errors thrown to `handleError`. Do not return ad-hoc JSON shapes.
- Credentials: `Authorization: Bearer <Supabase JWT>`, `Authorization: ApiKey <key>` or `X-API-Key`. `X-Integrator-Id` selects a workspace the user belongs to. Client IP comes from `CF-Connecting-IP`.
- No Node-only APIs, TCP connections or process-level state. Use Durable Objects, KV, Queues and Cron Triggers for what Relayer did with Redis, timers and `@nestjs/schedule`.
- CORS: browser origins must be listed in `ALLOWED_ORIGINS` (comma-separated).
- Responses keep Relayer's field names (snake_case agent payloads) so existing dashboard and SDK clients parse them unchanged.
- Secrets (`SUPABASE_SECRET_KEY`, `ENCRYPTION_KEY`) come from `wrangler secret put` or a local `.dev.vars` (see `.dev.vars.example`). Never commit them or log them.

## Commands

From the repository root: `npm run typecheck --workspace=@pickler/api`, `npm test`, `npm run lint`. From `workers/api`: `npx wrangler dev` (local workerd) and `npx wrangler deploy --dry-run --outdir <dir>` to check the bundle. Deploying requires explicit authorization.

All API-key routes enforce explicit scope abilities; use `read:agents` for product agent reads.
Broad legacy labels alone grant no route authority. SQLite ledger upgrades are additive and retain
history; committed reservation refunds require a matching period and spend generation. `.wrangler`
state is local generated output and must never be tracked. The product workspace/agent registry is
not yet connected to research tenants; see [integration boundaries](../../docs/frontend-integration.md).

## Cloudflare unification update

The request-scoped composition resolves the trusted DATABASE Hyperdrive binding through src/database.ts, using verified origin TLS and two connections per invocation. Direct DATABASE_URL is allowed only for explicit local loopback development. It does not import Mastra or require LLM credentials.

`POST /v1/studio/agents/draft` (JWT, manage rights as for creating an agent; registered before the `/agents/:id` routes)
turns `{ line }` into `{ draft, unsupported }` with the drafter built in `container.ts` from the
optional `MODEL_BASE_URL`, `MODEL_ID` and `MODEL_API_KEY` — the same model the research worker
uses. Without all three, with a base URL that does not parse (the drafter is then null and every
other route is unaffected), or when the model fails or answers outside `agentDraftSchema`, the route
answers 503 `DRAFT_UNAVAILABLE`; it never substitutes a guess. A model failure is logged with
the request id and the cause's message, never the key or the request; the body stays the bare code. What cannot run yet (Perpl, beats
other than Sports) is listed in `unsupported`, not dropped. Studio routes (`/v1/studio`, in `src/routes/studio.ts`) use JWT-only research DTOs, intentionally preserving the research response family rather than product envelopes. Growth routes preserve their existing DTOs and cookies.

`GET /v1/studio/agents` and `GET /v1/studio/agents/:id` answer `studioAgentSchema`, composed in one
helper in `src/routes/studio.ts`: the wallet linked to the agent (`wallets.findAgentWallet`, the
`PostgresCustodyStore`), its AUSD balance (`balances.read`), `canSchedule` from
`isReadyToSchedule` over `repository.readiness` plus the balance, and `canCreateAnother` over the
balances of every listed agent that has a wallet (agents created before wallets have none and are
not counted). An agent with no linked wallet reads a balance of 0, so it cannot be scheduled and
turning its schedule on answers `NOT_FUNDED`. That is intended: every agent is now created with a
wallet, and nothing has launched. A balance read that fails fails the request (500); it is never shown as zero.
`PUT /agents/:id/schedule` with `enabled: true` refuses 409 `NOT_FUNDED` when the lock says
`unfunded`; `first_run` is still refused 409 `NOT_READY` by the repository inside its transaction.
Turning the schedule off reads no balance. `POST /agents` refuses 409 `UNFUNDED_AGENT` when
`canCreateAnother` is closed, but a retry of an earlier create is looked up first with
`directory.createdWithKey` and replays the original agent without meeting the lock. The balance reader is `createAusdBalanceReader` on `CHAIN_ID`
(default 10143) and `MONAD_RPC_URL` (default that network's first public endpoint), kept per
isolate in `container.ts` so its 15 s cache outlives one request.

`PUT /agents/:id/limits { perCallAusd, perDayAusd }` writes only `config.spend` through
`repository.updateSpend`. It takes no version and keeps the version, the schedule and readiness,
because the deposit sheet sets limits right before the schedule is turned on and limits do not
change how the agent researches. `PUT /config` still bumps the version as before, and it
never writes `spend`: the store keeps the stored limits and ignores any `spend` in the body, so
`PUT /limits` is their only writer. The agent DTO answers `spend` and
`spendEnforced: false`. The limits are not enforced yet; the trading work enforces them through a
per-call and daily ledger period or a Turnkey value cap. The monthly budget ledger is not used.

`PUT /agents/:id/interval { hours }` accepts only 3, 6, 12 or 24 (the home's "every 3h / 6h / 12h /
daily") and writes only `config.intervalHours` through `repository.updateInterval`, with manage
rights and the agent's `agentScope`. Like the limits it takes no version and keeps the version, the
schedule and readiness, because the person tunes it right before turning the schedule on and a new
version would lock the schedule again until another manual run. With the schedule on, the next run
moves to now plus the new interval. It answers the runtime record (`agentResponseSchema`); any
other body is 400 `INVALID_INPUT` before any write. `PUT /config` may still change the interval,
with a new version.

`POST /agents/:id/deposit/prepare { amountAusd }` answers `{ url, body, timestampMs,
organizationId, amountMicroUsd }`, the sign_transaction activity the passkey stamps.
`POST /agents/:id/deposit/confirm { amountAusd, signed }` answers `{ txHash }`. Both need manage
rights and the agent's `agentScope`. The decisions are core's `prepareDeposit` and
`confirmDeposit`, reached through `services.studio.custody`. That is the same per-request custody
service `/v1/signing` uses and is present only when Turnkey is composed; without it the routes
answer 503 `DEPOSITS_UNAVAILABLE`. `container.ts` gives the service `createAusdDepositChain` on
`CHAIN_ID` and `MONAD_RPC_URL`, forgetting through the per-isolate AUSD reader. Failures are bare
codes: 400 `INVALID_INPUT`, 400 `INVALID_SIGNED_ACTIVITY` (the stamped transfer is not this amount
to this agent, or the body differs), 400 `DEPOSIT_FEE_TOO_HIGH` (a stamped fee over twice a fresh
quote), 400 `DEPOSIT_NONCE_MISMATCH` (the stamped nonce is above the master's pending
nonce; prepare again), 400
`SIGNED_ACTIVITY_REJECTED`, 404 `AGENT_WALLET_NOT_FOUND`, 409 `NO_CUSTODY_ACCOUNT`, 409
`DEPOSIT_NOT_SENDABLE` (the gas estimate failed), 409 `DEPOSIT_ALREADY_RECORDED` (a repeated
confirm; nothing is sent again) and 502 `SIGNING_UNAVAILABLE`. A refused broadcast is 500 and
records nothing. A deposit that was broadcast but could not be recorded is logged with
`console.error` by `reportUnrecordedDeposit` in `container.ts`: request id, hash, amount and agent
id, never key material. A signed transaction from Turnkey that is not the approved one, or not
signed by the master, is 500 `INTERNAL_OR_PROVIDER_FAILURE`. It is logged with `console.error` as
"Signed deposit transaction mismatch", with the request id and a message that names fields only.
Nothing is broadcast.

The earlier Durable Object budget description is legacy: new mapped agents use PostgresBudgetLedger. Keep the exported legacy class/data intact; do not bind it in staging. PostgreSQL drivers use Workers nodejs_compat; no standalone Node server is deployed. Current migration boundaries and operator commands are documented in ../../docs/cloudflare-unification.md.

Use `wrangler.staging.jsonc` for the unified staging API. It has no Durable Object binding or
public HTTP route. The web Service Binding is its entry point; JWT checks remain mandatory.
Run `npm run build:worker --workspace=@pickler/api` for a deployment dry run. Read the staging
operations guide before changing resource IDs or enabling admissions.

## Hosted database transport

Both deployed backend Workers require the trusted `DATABASE` Hyperdrive binding. The origin
uses Supabase session port 5432, verify-full with its CA, and disabled query caching.
There is no hosted direct-secret fallback or plaintext staging exception. Keep pools scoped
to each invocation, limited to two connections, and close them on every outcome. Local development
uses explicit APP_ENV=local with a loopback DATABASE_URL. Migrations retain their separate
operator connection. Admission controls remain independent of transport.

## Operator-enabled Studio access

The staging configuration keeps admissions enabled for operator-approved users. This flag is not
user authorization: PostgreSQL research access and workspace ownership remain mandatory. Keep
the API and consumer flags aligned. New agents still start with scheduling disabled. For an
emergency stop deploy both hosts with `--var ADMISSIONS_ENABLED:false`; restore only after checking
queued jobs, active schedules and enabled users. Never enqueue a paid run as a deployment check.
