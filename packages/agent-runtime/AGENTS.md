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
to two connections. Direct hosted connections require a validated Supabase pooler endpoint and verified TLS unless
the explicit staging exception is enabled. Hosted research now uses the trusted Hyperdrive
transport described below; only explicit local mode permits plaintext loopback connections.
Historical Node callers retain their existing connection configuration. Never expose a test clock
or controlled provider adapter through deployed environment configuration.

## Temporary staging transport exception

The operator authorized plaintext PostgreSQL for staging pending Hyperdrive integration.
`ALLOW_INSECURE_STAGING_DATABASE=true` is an explicit deployment override, permitted only
with `APP_ENV=staging` and a validated Supabase shared-pooler host. It does not weaken
endpoint/query-parameter guards. TLS remains the default; production rejects this override.
The staging runtime uses transaction-pooler port 6543 during this exception; port 5432 remains
supported for session connections. Keep migrations and local Studio on their existing direct
or session connections. No named prepared statements or session-scoped locks are used by
the deployed research repositories; ownership settings and locks must remain transaction-local.
Remove this exception when Hyperdrive with verified TLS is accepted. Database traffic during
the exception is unencrypted. See docs/cloudflare-staging.md from the repository root.

`createRuntime` accepts optional trusted database connection options from its host. The research
Worker supplies Hyperdrive options and its binding URL; local Node callers retain direct/session
connections. Never derive the transport choice from model input or public agent configuration.
