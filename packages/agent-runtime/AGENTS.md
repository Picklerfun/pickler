# Shared research runtime

Read the root and dependency AGENTS.md first. This package is the shared Mastra library
composition for local Node/Studio and the deployed Queue consumer. It is not an HTTP server.
Core owns policy and permissions; infrastructure owns providers and persistence. Never import
Next.js, dotenv, Studio, filesystem configuration or laboratory tokens. Startup must not seed
agents, change global configuration, or call providers. Provider checks are explicit operations.

Prompts retain immutable snapshots and versions when moved unchanged. Runtime tools obey the
same core guards, budgets, five-minute deadline and renewable per-run lease across hosts.
`composition/runtime.ts` builds real adapters; `workers/lease.ts` owns heartbeat cleanup;
`workers/background.ts` implements generic Queue wakeups and scheduled reconciliation.
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
- With the web off, search returns no sources without calling Exa and no page reader is
  offered. Search stays offered because core requires supporting and contradicting searches.
- `plugins/odds.ts` keeps only chosen books. Books are core `SPORTSBOOKS` keys, which are The
  Odds API bookmaker keys, compared exactly; no match means `no_coverage`. An empty list leaves
  the adapter as is.

Tests live in `test`; the root `npm test` discovers them after building shared packages.
