# Shared research runtime

Read the root and dependency AGENTS.md first. This package is the shared Mastra library
composition for local Node/Studio and the deployed Queue consumer. It is not an HTTP server.
Core owns policy and permissions; infrastructure owns providers and persistence. Never import
Next.js, dotenv, Studio, filesystem configuration or laboratory tokens. Startup must not seed
agents, change global configuration, or call providers. Provider checks are explicit operations.

Prompts retain immutable snapshots and versions when moved unchanged. Runtime tools obey the
same core guards, budgets, five-minute deadline and renewable per-run lease across hosts.
`composition/runtime.ts` builds real adapters; `workers/lease.ts` owns heartbeat cleanup;
`workers/background.ts` implements generic Queue wakeups and scheduled reconciliation. `consumeWakeup` takes an optional `PreviewExecution` (the runtime's `previews`: `PostgresPreviewStore` and the same research runner) and `claimNext` picks the job: a preview queued longer than core's `PREVIEW_PRIORITY_AFTER_MS` (two minutes), else a research run, else any preview (studio-brief-v1 §4), all inside the shared execution limits. The local runner in `apps/agent-service/src/workers/main.ts` uses `claimNext` too; the Cloudflare background experiment in `apps/agent-service` runs no previews. Previews get the runtime's observer like research runs.
No trading/signing tools or paid retries. Build shared dependencies before local consumers.

## Invocation database connections

Infrastructure exports databasePoolConfig and DatabaseConnectionOptions. Deployed hosts pass
APP_ENV and optional DATABASE_CA_CERT through composition; pools are invocation-local and limited
to two connections. Direct hosted connections require a validated Supabase pooler endpoint and verified TLS. Hosted research now uses the trusted Hyperdrive
transport described below; only explicit local mode permits plaintext loopback connections.
Historical Node callers retain their existing connection configuration. Never expose a test clock
or controlled provider adapter through deployed environment configuration.

## Hosted database transport

Both deployed backend Workers require the trusted `DATABASE` Hyperdrive binding. The origin
uses Supabase session port 5432, verify-full with its CA, and disabled query caching.
There is no hosted direct-secret fallback or plaintext staging exception. Keep pools scoped
to each invocation, limited to two connections, and close them on every outcome. Local development
uses explicit APP_ENV=local with a loopback DATABASE_URL. Migrations retain their separate
operator connection. Admission controls remain independent of transport.

`createRuntime` accepts optional trusted database connection options from its host. The research
Worker supplies Hyperdrive options and its binding URL; local Node callers retain direct/session
connections. Never derive the transport choice from model input or public agent configuration.

## Sources and skills

`AgentConfig` carries two person-authored fields. `sources.web` is `{ mode, sites }` or `null`
(web off); `sources.books` lists sportsbooks, empty meaning all. `skills` are `{ name, prompt }`
rules. `composition/run-scope.ts` binds them to each run inside `createRuntime().execute`; every
host that runs research through the runtime passes through it.

- The model reads `composeBrief(profile, skills)` in selection, research and the final decision.
- `plugins/exa.ts` keeps the studio's promise. `only` sends `includeDomains`, drops any result
  outside the list and never retries. `prefer` sends `includeDomains` and, when that finds
  nothing, searches once without it and records a `sources.fallback` run event. `anywhere`
  sends exactly the pre-existing request. A site matches itself and its subdomains.
- Off-list reads throw `INVALID_INPUT` "Outside the agent's site list" in the model's tool,
  before the runner's provider call, so a refusal is an answer rather than a provider failure.
  The reader refuses too, without calling Exa.
- In `only` mode, off-list market resolution-rule URLs are refused too; the list has no exceptions.
- `allowedHost` first requires a public http(s) URL without credentials (core's `publicSourceUrl`).
- With the web off, search returns no sources without calling Exa and no page reader is
  offered. Search stays offered because core requires supporting and contradicting searches.
- `plugins/odds.ts` keeps only chosen books. Books are core `SPORTSBOOKS` keys, which are The
  Odds API bookmaker keys, compared exactly; no match means `no_coverage`. An empty list leaves
  the adapter as is.

Tests live in `test`; the root `npm test` discovers them after building shared packages.

## Optional decision observation

`createRuntime` accepts a third options argument with an optional core `ResearchObserver`.
The model adapter emits an exact `DecisionInputSnapshot` immediately before the finalizer request;
core publishes the completed decision separately after persistence. Neither provider payloads nor
prompt versions change. The default and deployed composition remain uninstrumented. Local hosts
may inject a private file capture; never import that filesystem implementation into this package
or run paid observer calls inside the primary model/lease/budget path.

## Paper resolution

Runtime paper composition includes explicit settlement and summary operations using the same PostgreSQL pool and a read-only Polygon resolution adapter. Startup and research execution do not settle positions automatically or place real orders.

## Paper study model

`./composition/paper-study-model` exports the separate bounded local laboratory model adapter. Its versioned prompt lives in `src/prompts/paper-study-system.ts`. The base adapter uses one structured call for BTC and can produce a sports summary; the active Jev wrapper disables that redundant summary. Calls are byte/output bounded and guarded, with no retries or trading tools. Do not describe this protocol as the deployed production agent.

Paper-study prompt 1.1.0 consumes `btc-opening` as the Polymarket-published threshold and keeps current Coinbase reference prices distinct from live Chainlink TWAP. Never assert an opening threshold is missing when validated evidence supplies it.

`./composition/jev-study-model` is the active paper-study composition. Jev can resolve only clear
material-insufficiency abstentions; a single blind DeepSeek fallback handles full forecasts. It
skips the old sports summary, validates provider response/probabilities, persists started usage
through the caller and makes no automatic retries. Prompt/routing version 1.0.0 is a new readiness
task, distinct from laboratory claim-classification accuracy. No provider failures become abstentions.

Paper-study routing adapter 1.0.1 preserves Jev output token counts even though their tariff is zero.
Validate and persist pinned-model usage before answers; preserve only allowlisted validation stages
on failure, and never store raw rejected response fields. No automatic retry or old-study resume.

Routing adapter 1.0.2 adds optional `answerDiagnostics` on rejected Jev answers: fixed question/field/error-code labels, value shapes and key counts, capped at 16 issues. Never persist rejected values, unknown key names, raw paths or provider error messages. Validation, routing and stop rules are unchanged; this diagnostic change does not establish live-provider acceptance.

## Perpl public data plugin

`composition/perpl` is a public export creating a fresh bounded Perpl read session and four Mastra tools, without constructing a model. Runtime exposes `perpl(scope, signal)` and a Perpl plugin check. These tools are separate from the Polymarket research workflow; no model tool can configure an agent, move funds or submit orders.
