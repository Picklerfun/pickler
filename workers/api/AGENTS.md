# API worker instructions

Read [the root instructions](../../AGENTS.md), [core](../../packages/core/AGENTS.md) and [infrastructure](../../packages/infrastructure/AGENTS.md) first. Keep this file current when routes, bindings or middleware change.

`@pickler/api` is Pickler's backend on Cloudflare Workers (Hono). It replaces the parts of Relayer's NestJS API (on Render) that Pickler needs; the extraction plan is in [docs/relayer-extraction/00-plan.md](../../docs/relayer-extraction/00-plan.md).

## Current state

`test/studio-fixture-worker.ts` composes the production app and services for controlled local
acceptance only. It checks the disposable database marker before composition and reroutes only
external provider transports. Its private dispatcher bridge is test-only, uses a local Research
Service Binding, and never exists in production routes or OpenAPI. The fixture is typechecked;
never use it as a deployment entry. See [Studio acceptance](../../docs/studio-acceptance.md).

```text
src/
  index.ts                  # Worker entry; builds services lazily from bindings
  app.ts                    # createApp(services): routes, request id, error handler
  container.ts              # Composition root: Postgres adapters + core use cases
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

| Route                                                                                          | Auth                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                                                  | none (liveness only)                                                                                                                                                               |
| `GET /v1/auth/me`                                                                              | signed-in user; API keys refused                                                                                                                                                   |
| `GET /v1/handles/:handle/availability`                                                         | none (sign-up form)                                                                                                                                                                |
| `GET /v1/profile`, `POST /v1/profile`                                                          | signed-in user (JWT); API keys refused; POST 409 `wallet_required` for a studio account without a custody account (tokens marked `app_metadata.pickler_account = "wallet"` exempt) |
| `GET /v1/agents`, `GET /v1/agents/:id`, `GET /v1/agents/:id/audit`                             | JWT or API key + `agent` module + `read Agent`                                                                                                                                     |
| `GET /v1/agents/:id/status`, `GET /v1/agents/:id/analytics`, `GET /v1/agents/:id/budget`       | agent HMAC (own id only) or JWT/API key + `agent` module + `read Agent`                                                                                                            |
| `GET /v1/marketplace/{agents,directory,reads,profiles,personas,markets,analytics,leaderboard}` | none (public marketplace)                                                                                                                                                          |
| `POST /v1/signing/passkeys/{challenge,register,add/prepare,add/confirm}`                       | signed-in user; API keys refused                                                                                                                                                   |
| `GET /v1/signing/wallets/me`                                                                   | signed-in user; API keys refused                                                                                                                                                   |
| `GET /v1/signing/agents/state`, `POST /v1/signing/agents/{delegated,wallet}/{prepare,confirm}` | signed-in user; API keys refused                                                                                                                                                   |
| `POST /v1/signing/agents/wallet/:walletId/policies/{prepare,confirm}`                          | signed-in user; API keys refused                                                                                                                                                   |

Agent HMAC follows `@relayerfi/agent-sdk`: headers `x-agent-id`, `x-agent-auth`, `x-request-timestamp`; payload `METHOD + /v1/path + timestamp + sha256(JSON.stringify(body) or "")`, ±60 s. Agent secrets (`agents.agent_credentials`) are decrypted with `ENCRYPTION_KEY`; the format is byte-compatible with Relayer's, so the key only has to equal Relayer's when importing Relayer data. Agent write endpoints are not ported yet.

## Passkey custody

`/v1/signing` is mounted only when `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`,
`TURNKEY_PARENT_ORG_ID`, `TURNKEY_RPID` and `TURNKEY_APP_NAME` are all bound; without them the
rest of the API serves unchanged. It is also left unmounted, with the reason logged, when
`turnkeyRelyingPartyProblem` in `@pickler/core` refuses the relying party: `pickler.fun` is
Mera's on every surface, and `localhost` is refused unless `APP_ENV` is `local` or `development`.
The deployed value is `app.pickler.fun` (`docs/specs/mobile-monorepo-v1.md`, W2 and W8). The decisions are `createCustodyService` in `@pickler/core`;
the routes validate and map. Nothing that names a passkey comes from the body, and an
attestation is refused at the door unless it is three base64url strings and transports Turnkey
has a name for (`SUPPORTED_TRANSPORTS`).

Signup: email → code → passkey (mandatory; creates the master wallet) → handle (creates the profile
and workspace) → welcome. The first passkey is therefore usually registered before any profile
exists, and `identity()` in `routes/signing.ts` gives it two deliberately different names. The
WebAuthn `user.name` / `user.displayName` from `challenge`, stored in the device keychain, are the
profile's handle and display name where there is a profile, else the sign-in email from the
verified token's `email` claim (never a wallet account's synthetic email, recognised by
`WALLET_EMAIL_DOMAIN`), else `pickler-<id8>`. The Turnkey root user's `userName` and the
sub-organization's name, from `register` (`ownerLabel`), are never the email — email is kept out of
Turnkey — but the handle where there is a profile, else `pickler-<id8>`. Neither is stored with the
challenge; each route derives its own from the same profile read.

`POST /v1/profile` refuses a studio (email or Google) account that has no custody account with
409 `wallet_required`, so its username is saved only once the master wallet exists. A wallet
sign-in account is exempt — its own wallet is its wallet — and is recognised only by the token's
server-only `app_metadata.pickler_account = "wallet"` (`UserPrincipal.walletAccount`, read by the
Supabase JWT verifier). `createWalletAccounts` sets it at `admin.createUser`, and every wallet
sign-in calls `markWalletAccount` before minting the session, which backfills it on an account made
before the marker existed — only when the account's email is that address's own synthetic one, so
an email account that linked the wallet stays a studio account. The synthetic email is computable
from a public address, so an account found there (createUser's lost race, or a returning address)
is accepted only if it is marked, or has no password and no identity but `email`
(`walletAccountVerdict`, over `createAuthUserLookup`'s read of `auth.users` and `auth.identities`;
the admin API cannot say whether a password is set). Anything else — a pre-registration with a
password — is refused with 409 `wallet_account_conflict` before any link, backfill or session, and
logged with the address digest only. On a local run, where the product database has no `auth`
schema, the lookup falls back to the admin API by id and accepts only marked accounts. A wallet account that has not
signed in since then gets 409 until its next sign-in; that is accepted, because a session comes
only from that sign-in. The email domain is never an exemption: with email sign-up open and
confirmations off, anyone can register an address in `WALLET_EMAIL_DOMAIN`. `isWalletAccountEmail`
survives only to keep the synthetic email out of a passkey's keychain name, which is cosmetic.

No wallet sign-in route answers 500 for bad input (`asHttp` in `routes/wallet-auth.ts`): an address
that is not one is 400 `invalid_address`, a `chain_id` that is not a positive whole number 400
`invalid_chain` (refused in the route, and again in core), and a `raw` that is not a sign-in
message, or a field viem's builder refuses, 400 `invalid_message`. Core's `issueNonce` validates
the address and the chain and builds the message before it stores the nonce, so a refused request
leaves no row in `identity.siwe_nonces`.

`POST /v1/auth/wallet/verify` and `/link` accept an optional `kind`, `"mera"` or `"eoa"`: which of
the marketplace's two wallets signed (`docs/specs/mera-web-v1.md`, M7). The route's `presented()`
passes it to core, which stores `mera` or `external` in `identity.wallet_links.kind`; a body
without one is `eoa`, and any other value is 400 `invalid_wallet_kind` before anything is read. It
is the caller's statement and nothing proves it, so no route may authorise by it. It has nothing to
do with custody: a Mera wallet is never a Turnkey wallet, and the custody routes never read it.

`POST /v1/auth/wallet/nonce` is public and has no rate limit of its own. What bounds it is in the
store: every issue deletes up to `EXPIRED_NONCE_PURGE_BATCH` (100) expired nonces, and an address
holds `MAX_OPEN_NONCES_PER_ADDRESS` (5, core) at most — a further issue evicts its oldest and is
never refused, because the address is unverified and a refusal would let anybody lock a wallet out
of signing in. An evicted nonce answers 400 `nonce_invalid`, which a retry fixes. A nonce is kept under the address it was issued to, so `verify` and
`link` answer 400 `nonce_invalid` for one presented in a message naming another address. There is
no cap per client yet: `CF-Connecting-IP` is available to the route, but keeping its hash needs a
column `identity.siwe_nonces` does not have.

`POST /v1/auth/wallet/join` is the one route through which an address changes account
(`docs/specs/mera-web-v1.md` §9). It is for a person who connected a wallet with no account — which
made it one — and already has an account under another wallet. The caller's session is the account
given up; the body is a message signed by the other wallet, the account kept — not the sign-in
message but the one `POST /v1/auth/wallet/nonce` writes when its body carries `joining`, whose
sentence names the wallet being let in (`joinStatement` in core). `/join` accepts it only for the
caller's own wallet, `/verify` and `/link` accept only the sign-in sentence, and a message
presented to the wrong one is 400 `wrong_purpose` with its nonce spent. Core's `join`
moves the caller's wallet with `links.reassignSole` — one statement that holds again that the
caller has exactly one wallet and no profile and that the kept account still has a wallet — and
then removes the emptied account through `discardAccount`, unless it gained a profile in that
instant. A failed removal is tolerated, but unlike after a lost link this account has a live
session: it stays without a wallet until that session ends. The route answers with a session for
the kept account. It refuses with 404 `no_account` (the wallet that signed opens no account), 409
`same_account`, and 409 `join_has_profile`, `join_has_custody`, `join_not_wallet_account` and
`join_changed`: only the bare account wallet sign-in made for its one wallet, with no username and
no custody account, is ever given up — never an email or Google account that linked a wallet, and
never one with a Turnkey sub-organization, whose rows nothing ties to the auth user. `hasProfile`
and `hasCustodyAccount` in `walletAuthServices` are those two checks. Do not widen these conditions without the owner: a join cannot be undone, and `/link` still
answers 409 for an address owned elsewhere.

A first wallet sign-in can lose its link: the address was linked to nobody when `verify` looked,
and a signed-in account's `POST /v1/auth/wallet/link` of the same wallet wrote the link first
(`link` answers `created: false`). `verify` then reads the link again and signs in its holder, after
the same `markWalletAccount` check, never the account it just made. That account is deleted through
`AccountProvisioner.discardAccount` only when this very call created it (`forAddress` answers
`created`), and `createWalletAccounts` deletes nothing but the address's own marked wallet account.
A delete that fails is logged and the sign-in still succeeds; the leftover holds no wallet.

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

`GET /v1/studio/wallets` (and its Console alias) includes `chainId`, supplied by composition from
the same validated CHAIN_ID used for custody balances and transfers. It is null when no supported
chain is composed; request query parameters never change it. The wallet DTO/OpenAPI describes
10143 (Monad Testnet) and 143 (Monad mainnet). This does not expose a per-user network selector or
change transfer signing, admissions or configured provider endpoints.

Under the same mount, `/v1/signing/agents` runs docs/specs/studio-create-and-fund-v1.md §4.1 as
prepare → passkey stamp in the browser → confirm, three times: Pickler's delegated user (first
agent only), the agent's wallet (no body, `{}` at most: a `handle` is refused; the wallet is named
"Agent wallet N", N the person's agent wallets plus one; confirm takes `{ signed }`), and that
wallet's policies (no body; core adds the delegated user's self-delete policy when none of the
person's wallets is linked to an agent yet, and a `first_agent` field is refused). The policies
prepare reads the wallet's balances first and answers 409 `wallet_underfunded` below either
minimum to start (10 AUSD, 0.5 MON), with `detail: { ausdMicro, monWei, minAusdMicro, minMonWei }`
as base-unit strings (a balance the chain did not answer is null). A read that fails, or answers
neither balance, is 503 `balances_unavailable`: an outage is never reported as underfunded. Each confirm is refused with 400
`invalid_signed_activity` before anything reaches Turnkey unless the stamped request is exactly
what its prepare built, apart from the timestamp. Prepares answer the
unsigned activity in add/prepare's shape; a wallet prepare while the person has an unlinked wallet
answers `{ existing: { wallet_id, address, policies_approved } }` instead, and the browser skips
that stamp, and the policies' too when `policies_approved` is true.
Confirms answer `delegated_user_id`, `{ wallet_id, address }` and `policy_ids`.
`GET /agents/state` answers `has_sub_organization` and `has_delegated_user`. The link to an agent
is written by the drafts route's transaction, not here.

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

`AgentLedger` (binding `AGENT_LEDGER`, SQLite-backed, one instance per agent id) replaces Relayer's Redis hash and `budget-check.lua`. Logic lives in `@pickler/core` (`createBudgetLedger`); the object wraps every operation in `ctx.storage.transactionSync`, schedules an alarm for the next reservation expiry and hydrates once, read-only, from `budget.budgets` and `agents.agents.status` through `PostgresBudgetSource` and `PostgresAgentRegistry` on a pool it opens from the same database binding as the request path and closes after the read.

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

`/v1/marketplace/markets` and `/v1/marketplace/markets/:symbol` answer from the board
`marketBoardFor(PERPL_BOARD_NETWORK)` composes in `growth/services.ts`: Perpl on `testnet` or
`mainnet` (`createPerplMarketBoard`, one request to the venue's public context, cached ten
seconds), or the sample board for any other value and for none. What the board remembers lives in
a module-level `PerplBoardMemory` per network, because services are composed per request. A venue
that cannot be read and has nothing recent held raises `MarketDataUnavailableError`, which the
error handler answers as 503 with `error: "MARKET_DATA_UNAVAILABLE"`; an empty list is never the
answer to a failure. Private research never feeds these routes. The detail
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

There is no model drafter: `POST /v1/studio/agents/draft` and `POST /v1/studio/agents` (an agent
created with its wallet, for `/studio/new`) were removed with that screen, together with the
`MODEL_*` variables this worker read for them. Studio routes (`/v1/studio`, in `src/routes/studio.ts`) use JWT-only research DTOs, intentionally preserving the research response family rather than product envelopes. Growth routes preserve their existing DTOs and cookies.

`POST /v1/studio/preview-runs` (JWT, research rights; 409 `ADMISSIONS_PAUSED` when admissions are
off) runs `preparePreview` on `previewRunRequestSchema` and queues a paper run of a brief with no
agent row through `services.previews` (`PostgresPreviewStore`, studio-brief-v1 §4), answering 202
`{ id }` and waking the research queue. An invalid brief is 400 `{ error: "INVALID_BRIEF", field,
reason }`; caps and leverage out of bounds are 400 `INVALID_INPUT`; the sixth run in a rolling hour
is 429 `{ error: "PREVIEW_RATE_LIMITED", retryAt }`. `GET /v1/studio/preview-runs/:id` answers
`previewRunResponseSchema` to the owner only (404 for anyone else and after 24 h). Without
`previews` composed, both answer 503 `PREVIEW_UNAVAILABLE`. The web no longer calls either (the
brief home that ran previews is gone); they stay until a separate cleanup removes them.

`GET /v1/studio/agents` and `GET /v1/studio/agents/:id` answer `studioAgentSchema`, composed in one
helper in `src/routes/studio.ts`: the profile's `accent` from `directory.list` ("lime" without a
profile row), the wallet linked to the agent (`wallets.findAgentWallet`, the
`PostgresCustodyStore`), its AUSD balance (`balances.read`), `canSchedule` from
`isReadyToSchedule` over `repository.readiness` plus the balance, and `canCreateAnother` over the
balances of every listed agent that has a wallet, drafts included, plus the number of private
drafts. A draft is created with its wallet (studio-create-simplified-v1), so a draft whose wallet
holds under 10 AUSD closes the lock with `unfunded_agent` like any agent. Agents created before
wallets, and drafts from before drafts came with one, have none and are not counted. Three drafts
(`MAX_DRAFTS_PER_WORKSPACE`) close the lock with `draft_limit`, after `unfunded_agent`. An agent with no linked wallet reads a balance of 0, so it cannot be scheduled and
turning its schedule on answers `NOT_FUNDED`. That is intended: every agent is now created with a
wallet, and nothing has launched. A balance read that fails fails the request (500); it is never
shown as zero. `GET /agents/:id` reads this agent's balance that way and the other agents' only
for the lock: another agent's balance that cannot be read is left out of `canCreateAnother` and
does not fail the page. The list and the draft create still require every read.
`PUT /agents/:id/schedule` with `enabled: true` refuses 409 `NOT_FUNDED` when the lock says
`unfunded`; `first_run` is still refused 409 `NOT_READY` by the repository inside its transaction.
Turning the schedule off reads no balance. The balance reader is `createAusdBalanceReader` on `CHAIN_ID`
(default 10143) and `MONAD_RPC_URL` (default that network's first public endpoint), kept per
isolate in `container.ts` so its 15 s cache outlives one request.

A `CHAIN_ID` that is not a number or not a chain `@pickler/chain` lists never fails composition:
`supportedChainId` in `container.ts` answers null and logs the variable's name, never its value.
Balances and deposits are then off and every other route serves. The studio's balance reader
throws `PilotError` `BALANCES_UNAVAILABLE`, so a studio read that needs a balance (an agent with a
wallet) answers 503 `{ error: "BALANCES_UNAVAILABLE" }`. The custody service is composed without a
deposit chain, so the deposit routes answer 503 `DEPOSITS_UNAVAILABLE`. `GET
/v1/signing/wallets/me` answers 503 with `error: "balances_unavailable"` in its envelope. The
passkey ceremonies read no chain and stay on.

`POST /v1/studio/drafts { name, handle, voice, avatar, sources, brief, caps, walletId }` (JWT,
manage rights; studio-create-simplified-v1 §4.1) creates a private draft with the agent wallet the
person made, funded and signed the policies of, and answers 201 `{ productId, agent }`. Sites in
`sources.web` are reduced to bare hosts by core's `classifyRead` ("https://www.CoinDesk.com/x" is
`coindesk.com`) before `prepareDraft` checks the request and builds the Perpl-shaped config and the
profile. The wallet's balances are then read on chain (`custody.walletBalance`), just before the
transaction and never inside it: a chain read must not hold row locks. A wallet that is not the
caller's has no reading and is left for the directory to refuse. `directory.createDraft` then, in
one transaction: replays the same create (same wallet, handle, name, config and profile) without
the lock; refuses `HANDLE_TAKEN`, then `WALLET_NOT_FOUND` (404: absent, another person's, or not
`kind='agent'`), `WALLET_ASSIGNED` (already linked, or the same wallet under other terms) and
`POLICIES_MISSING`; runs the admit callback, which holds the funding lock, the draft limit and that
reading to the minimums (409 `WALLET_UNDERFUNDED` with the same `detail` as the signing family's;
a read that failed or answered neither balance is 503 `WALLETS_UNAVAILABLE`, never underfunded);
and writes the draft, its profile (accent, avatar pattern,
voice name, venue `perps`) and the wallet's link with the approved policy ids. Every refusal from
the directory or the lock answers `{ error, message }`; the fourth draft in a workspace is 409
`{ error: "DRAFT_LIMIT", message: "At most 3 drafts at a time" }`. Without custody or a chain it is
503 `WALLETS_UNAVAILABLE`.

The wallet routes live in `src/routes/studio-wallets.ts`, mounted at `/wallets` by
`studioRoutes`, with their error mapping (`walletFailure`, used by the drafts route too).
`GET /v1/studio/wallets` answers the master wallet and every agent wallet of the person's, balances
as base-unit strings read on chain (null where a read failed), with each wallet's agent, caps and
whether its policies were approved. `POST /v1/studio/wallets/transfers/prepare|confirm { from, to,
token, amount }` moves AUSD or MON between the master (`"master"`) and one of the person's agent
wallets, either way; `amount` is a decimal string, checked and converted exactly to micro-AUSD or
wei by the route, so every malformed amount ("0", "0x10", "+1", too many decimals) is 400
`INVALID_TRANSFER`. Prepare answers the unsigned activity plus
`baseUnits`; confirm takes `signed` too and answers `{ txHash }`. These routes answer
`{ error, message }` in their own words: `INVALID_TRANSFER` (400), `WALLET_NOT_FOUND` (404),
`INSUFFICIENT_FUNDS`, `INSUFFICIENT_GAS`, `TRANSFER_ALREADY_RECORDED`, `NOT_SENDABLE`,
`NO_CUSTODY_ACCOUNT` (409), `FEE_TOO_HIGH`, `NONCE_GAP`, `INVALID_SIGNED_ACTIVITY`,
`SIGNED_ACTIVITY_REJECTED` (400), `SIGNING_UNAVAILABLE` (502) and `WALLETS_UNAVAILABLE` (503),
never the deposit's codes. A signed transaction that does not match is logged as "Signed
transaction mismatch" and answers 500 `SIGNED_TX_MISMATCH`, its own code because nothing was
broadcast. The
deposit routes keep theirs.

The draft's studio (docs/specs/studio-draft-dashboard-v1.md §4), all in `src/routes/studio.ts`
except the ledger. The studio agent DTO carries `visibility`, `publishedAt` (ISO or null) and
`xHandle` (the verified handle without "@", or null), from `directory.list`.

- `PUT /agents/:id/setup { expectedVersion, brief?, sources?, caps?, voice?, entry? }` (manage
  rights; `caps` may carry `maxOpenPositions` and `dayLossStopAusd`, stored as `config.risk`):
  any agent whose config has `perpl`, draft or public (409 `NOT_A_PERPL_AGENT` otherwise,
  docs/specs/studio-live-v1.md L11; the route refuses before core's `reviseSetup`, which must
  never see a config without `perpl`, and the store checks again with `perplOnly`), then
  `repository.updateConfig`, whose stale version is 409 `CONFLICT` (the same code `PUT /config`
  answers). With `caps` it passes `writeSpend`, so the new per-trade and per-day caps land in
  `spend` in the same transaction. It always passes `versionSummary: setupChangeSummary`, so the
  store records the new version in `agents.setup_versions` in that transaction, summarized by
  core from the two stored configs. Another owner's agent is 404 `NOT_FOUND`. A voice also
  renames the profile's voice through `directory.updateIdentity`. Answers the studio agent; 400
  `INVALID_BRIEF` / `INVALID_INPUT`.
- `GET /agents/:id/versions` (L10; manage rights, so a read-only member is 403): `{ versions:
[{ version, summary, at }] }` from `directory.versions`, newest first, at most 20, ISO `at`;
  another owner's agent is 404 `NOT_FOUND`. A version saved before migration 0026 has no row.
- `PUT /agents/:id/identity { name?, avatar?: { accent, pattern 0–5 } }`: the studio agent; 400
  `INVALID_INPUT`. `GET /agents/:id/activity` answers `{ events }` (ISO `at`).
- Connect X, composed as `services.studio.x` (`PostgresXStore`, `createXClient` on
  `X_BEARER_TOKEN`). The store checks no ownership, so every X route calls `agentScope` first.
  `GET /agents/:id/x` answers `{ account, challenge, available }` (a lapsed challenge is null).
  `POST /x/challenge { handle }`: 400 `INVALID_X_HANDLE`, 409 `X_ALREADY_CONNECTED`,
  `X_HANDLE_TAKEN`, 503 `X_UNAVAILABLE` (no token; checked before anything is saved).
  `POST /x/verify`: 404 `CHALLENGE_NOT_FOUND`, 409 `CHALLENGE_EXPIRED`, 503 `X_UNAVAILABLE`, then
  `XStore.claimCheck` (one atomic UPDATE; 429 `TOO_MANY_CHECKS` within 10 s) before X is read; a
  match connects (409 `X_HANDLE_TAKEN` if another agent won it). `DELETE /x`: 409
  `X_ON_PUBLIC_AGENT`. X's failures are 503 `X_UNAVAILABLE` without X's body.
- `POST /agents/:id/publish {}`: `directory.publish` with a check that reads the linked wallet's
  AUSD through `balances.read` outside any transaction; 409 `PUBLISH_BLOCKED` with
  `detail.blockers` (`KILLED`, `WALLET`, `FUNDS`), 409 `PUBLISH_CONFLICT` (the agent changed twice
  during the check), 503 `BALANCES_UNAVAILABLE`. Idempotent on a public agent.
- `GET /wallets/ledger` (`studio-wallets.ts`, `services.studio.transfers` over `listTransfers`):
  the caller's own transfers, newest first, at most 100; 503 `WALLETS_UNAVAILABLE` where not
  composed.

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

## Supabase is auth only

Every product-data port goes through the invocation's pool: profiles (`PostgresProfileRepository`),
workspaces and API keys (`PostgresWorkspaceDirectory`, `PostgresApiKeyDirectory`), agents and their
events (`PostgresAgentRegistry`, `PostgresAgentEventLog`), the waitlist and applications
(`PostgresWaitlist`, `PostgresApplicants`), and the ledger's hydration (`PostgresBudgetSource`).
Supabase is reached for auth alone: the JWKS verifier on `JWT_ISSUER`, and the admin client the
wallet sign-in uses for `auth.admin` and `verifyOtp`. So a local run, whose `DATABASE_URL` is the
Docker PostgreSQL, never reads or writes the hosted project's tables, and a profile created locally
is the one `onboard` reads next. No Supabase data adapter exists any more, and none is to be written for this Worker; in a
deployment the same tables are reached through `DATABASE` instead.

## Operator-enabled Studio access

The staging configuration keeps admissions enabled for operator-approved users. This flag is not
user authorization: PostgreSQL research access and workspace ownership remain mandatory. Keep
the API and consumer flags aligned. New agents still start with scheduling disabled. For an
emergency stop deploy both hosts with `--var ADMISSIONS_ENABLED:false`; restore only after checking
queued jobs, active schedules and enabled users. Never enqueue a paid run as a deployment check.

## Cloudflare trading pilot

Studio trading routes use user sessions and owner checks, the TRADING_EXECUTOR private binding and generic TRADING_QUEUE notifications. Keep signer/CLOB secrets exclusively in workers/trading. TRADING_ADMISSIONS_ENABLED is independent of research admission. See ../../docs/polymarket-worker-pilot.md.

## Paper resolution

Studio paper endpoints also expose POST /runs/:id/paper-order/settle (empty body, owner authorization, idempotent by position) and GET /agents/:id/paper-summary (workspace-scoped read). Settlement uses finalized public CTF data and never forwards a request to the live trading executor.

## Trading package boundary

Trading rules and financial ports are owned by `@pickler/trading` public subpaths. Core retains identity, configuration and research contracts. Hosts must not duplicate risk, fills or accounting.

The launch catalogue is mounted at `/v1/launches` using the request-scoped PostgreSQL pool. `/v1/console` and `/v1/demo` remain aliases of the authenticated Studio and public marketplace surfaces respectively. The Studio creation contract still requires the approved wallet introduced by this branch; the alias does not bypass that requirement.

## Generated OpenAPI

`GET /v1/openapi.json` publicly describes the mounted routes; the web delegates
`/api/v1/openapi.json` unchanged through its existing transport. Describe each explicit operation
beside its handler with `src/openapi/operation.ts`, using portable schemas from api-schema.
Descriptions must not change validation or authorization. New endpoints without documentation,
concrete response schemas or unique operation ids fail the coverage check. Optional groups are
included only when mounted. `npm run api:openapi -- --output /tmp/pickler-openapi.json` exports the
complete contract using non-executable services; the OpenAPI CI workflow validates and uploads it.
See [API contract](../../docs/api-contract.md) for extension and consumption instructions.

## Agent advice

`src/routes/advice.ts` mounts independent `/v1/agent-advice` routes with user-only authentication,
no-store responses, strict requests and OpenAPI metadata. Container admission requires explicit
ADVICE_ENABLED, valid reviewed USD policy and research Queue; reads remain mounted when disabled.
Never accept internal tenant/runtime IDs or models from consumers. Completed history is shared;
other statuses are requester-only. See [Agent advice](../../docs/agent-advice.md).

Advice admissions consume the same reviewed ADVICE_POLICY_JSON as Research. Policy v2 pins its forecast provider URL/model and limits; forecast credentials remain exclusively in Research. No new public DTO or database schema is introduced by the provider correction.

## Perpl paper runtime

`src/routes/studio-perps.ts` (mounted by `studioRoutes` at `/v1/studio` and its `/v1/console`
alias) serves docs/specs/perpl-paper-runtime-v1.md §4 over `services.studio.perps`
(`StudioPerpsServices`: `PostgresPerpsRuntimeStore`, `PostgresPerpsOwnerStore`,
`PostgresPerpsPaperStore`, the market board's marks via `perpsBoardMarks` in `container.ts`, and
`RESEARCH_QUEUE`); absent, every route is 503 `RUNTIME_UNAVAILABLE`. Reads need workspace
membership, writes `authorize(principal, true)` (403 otherwise); another workspace's agent, check,
position or proposal is 404 `NOT_FOUND`. DTOs are `src/perps-runtime.ts` in api-schema.

Actions that need a Perpl frame or touch paper positions run in the research worker, not here: the
API checks ownership and state, writes a durable owner action in the request
(`PostgresPerpsOwnerStore.createAction`, `pickler.perps_owner_actions`; an optional
`Idempotency-Key` answers the same action, a key used for another action is 409 `CONFLICT`, and
without one each request is its own action, keyed `auto:<uuid>`), sends the wakeup
`{ kind: "perps-action", actionId }` (a failed send is logged; the research Cron re-drives pending
actions) and answers 202 `{ actionId }`. The web polls `GET /perps/actions/:id`. Reads go through
the paper store's read-only `snapshot` (no row locks, no writes); the record's new margin today is
trading's `marginOpenedSince` over that same snapshot.

- `POST /agents/:id/perps/checks` (`Idempotency-Key` required): 409 `NOT_A_PERPL_AGENT`,
  `RUNTIME_DISABLED` (`PERPL_RUNTIME_ENABLED` is not "true"), `CHECK_RUNNING`, `AGENT_KILLED`
  (refused by `startCheck`); 429 `MANUAL_LIMIT`
  at 6 manual checks a UTC day (a replay after the sixth is also 429); else `startCheck` (trigger
  `manual`) and `{ kind: "perps-check", checkId }`, 202 `{ checkId }`.
- `GET /agents/:id/perps/checks?before=&kind=` (`kind`: comma-separated outcomes, 400 otherwise):
  `{ checks, nextCursor }`, 50 a page; `GET /perps/checks/:id` adds steps, `startedAt`, `finishedAt`.
- `GET /agents/:id/perps/positions`: `{ network, account, open, closed }`; open positions carry the
  board's mark and unrealized P&L (null without a fresh mark), stop, target, time stop and
  trading's `liquidationPrice`; closed are newest 50 with `realizedPnl` net of every fee the
  position paid (its open's `<id>:fee`, each size-up's fee and the close), which the record's
  `wins` and `hitRate` count too.
- `POST /perps/positions/:id/close`: the position's owner from `PostgresPerpsOwnerStore.findPosition`;
  409 `POSITION_CLOSED`; writes a `close` action; 202 `{ actionId }`.
- `POST /agents/:id/perps/stop`: pauses the agent at once (`repository.pause`, the existing pause
  path), then writes a `stop_all` action; 202 `{ actionId }`.
- `GET /agents/:id/perps/proposals`: pending ones. `POST /perps/proposals/:id/approve`: 409
  `PROPOSAL_DECIDED` (not pending), `PROPOSAL_EXPIRED` (past 15 minutes), `RUNTIME_DISABLED`,
  `AGENT_KILLED` (refused by `createAction`); writes an `approve` action, decides nothing itself;
  202 `{ actionId }`.
- `GET /perps/actions/:id` (members): `{ id, kind, status, positionId, proposalId, attempts,
lastError, checkId, createdAt, updatedAt }`; `checkId` is the latest attempt's `owner` check
  (its outcome says what happened); another workspace's action is 404.
  `POST /perps/proposals/:id/skip` is synchronous: `decideProposal(id, "skipped")` and an `owner`
  row "SKIPPED · ENTRY SHORT ETH"; answers `{ id, status }`.
- `GET /agents/:id/perps/record`: trading's `recordStats` (all-time checks and entries from
  `PostgresPerpsOwnerStore.counts`) plus `today` (new margin, realized, open count, leverage in use
  = highest open leverage, checks, manual checks and limit, cost in micro-USD) and `runtimeEnabled`.

`PERPL_RUNTIME_ENABLED` ("false" in `wrangler.staging.jsonc`, the deployed config, and in
`wrangler.jsonc` and `.dev.vars.example`) gates manual checks and approvals only; reads, closes and
stops stay on. Keep it equal to the research worker's: `npm run check:staging` asserts that
`wrangler.staging.jsonc` and `workers/research/wrangler.jsonc` set the same "true" or "false".
`workers/api/test/studio-perps-route.test.ts` covers every code, each action written and each
Queue payload. The OpenAPI description marks the actions' `Idempotency-Key` optional
(`idempotent: "optional"` in `src/openapi/operation.ts`).

## Studio strategy version 2

Studio setup selects a versioned common strategy; absent selection resolves combined@2.0.0.
New check results expose `strategyResult` with per-market proposals, three-state brief findings,
execution outcomes, funding status and incompleteness. Historical fields retain their recorded
values and are null/empty for new results rather than fabricated percentages. Model costs remain
USD micros, separately from virtual financial metrics; unknown daily costs stay null. The API
retains workspace authorization and generated OpenAPI. The web displays the strategy in both
agent studios and explicitly confirms clearing unsupported authored conditions for rules.
See [Studio perpetual execution](../../docs/studio-perps-execution.md).

Studio access-request routes inherit JWT-only authentication. GET/POST `access-request` provide
own status and owner-only idempotent submission; GET `access-requests` requires the verified
super-admin allowlist. All use private/no-store and generated OpenAPI schemas. Infrastructure
records the internal team inbox notification; no external message transport or automatic grant is
composed. Both Studio and its Console alias mount these operations.
