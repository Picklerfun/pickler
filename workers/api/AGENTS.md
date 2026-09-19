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
  budget/agent-ledger.ts    # AgentLedger Durable Object: budget authority per agent
  budget/sql-ledger-store.ts# LedgerStore over Durable Object SQLite (amounts as decimal TEXT)
  budget/budget-gateway.ts  # What routes use from the ledger
test/                       # Route and middleware tests with injected services
```

Routes:

| Route                                                                                    | Auth                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /health`                                                                            | none (liveness only)                                                    |
| `GET /v1/auth/me`                                                                        | signed-in user; API keys refused                                        |
| `GET /v1/handles/:handle/availability`                                                   | none (sign-up form)                                                     |
| `GET /v1/profile`, `POST /v1/profile`                                                    | signed-in user (JWT); API keys refused                                  |
| `GET /v1/agents`, `GET /v1/agents/:id`, `GET /v1/agents/:id/audit`                       | JWT or API key + `agent` module + `read Agent`                          |
| `GET /v1/agents/:id/status`, `GET /v1/agents/:id/analytics`, `GET /v1/agents/:id/budget` | agent HMAC (own id only) or JWT/API key + `agent` module + `read Agent` |

Agent HMAC follows `@relayerfi/agent-sdk`: headers `x-agent-id`, `x-agent-auth`, `x-request-timestamp`; payload `METHOD + /v1/path + timestamp + sha256(JSON.stringify(body) or "")`, ±60 s. Agent secrets (`agents.agent_credentials`) are decrypted with `ENCRYPTION_KEY`; the format is byte-compatible with Relayer's, so the key only has to equal Relayer's when importing Relayer data. Agent write endpoints are not ported yet.

## Budget ledger

`AgentLedger` (binding `AGENT_LEDGER`, SQLite-backed, one instance per agent id) replaces Relayer's Redis hash and `budget-check.lua`. Logic lives in `@pickler/core` (`createBudgetLedger`); the object wraps every operation in `ctx.storage.transactionSync`, schedules an alarm for the next reservation expiry and hydrates once, read-only, from `budget.budgets` and `agents.agents.status`.

- Spend goes through `reserve` → `commit` or `release`, idempotent by reservation id. Post-hoc telemetry uses `record`, deduplicated by event id.
- Tables are created synchronously in the constructor. Do not move migrations into `blockConcurrencyWhile(async …)`: a spike showed methods could run before the tables existed.
- The ledger does not write to Postgres yet. A write-behind projection to `budget.budgets` and `budget.ledger_entries` comes next.
- The legacy `POST /v1/agents/:id/budget` (API key can raise limits) is intentionally not ported; limit changes arrive with the passkey prepare/confirm flow (Turnkey wave).
- Verified in local workerd: 50 concurrent reserves of 70 against a limit of 1000 accept exactly 14; retries with the same ids add nothing; the alarm releases expired holds.

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

The new request-scoped composition uses PostgreSQL through a cache-disabled Hyperdrive binding (local DATABASE_URL only when APP_ENV=local). It does not import Mastra or require LLM credentials. Console routes use JWT-only research DTOs, intentionally preserving the research response family rather than product envelopes. Growth routes preserve their existing DTOs and cookies.

The earlier Durable Object budget description is legacy: new mapped agents use PostgresBudgetLedger. Keep the exported legacy class/data intact; do not bind it in staging. PostgreSQL drivers use Workers nodejs_compat; no standalone Node server is deployed. Current migration boundaries and operator commands are documented in ../../docs/cloudflare-unification.md.
