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
to two connections. Staging requires the Supabase session pooler on port 5432 and verified TLS.
Only explicit local mode permits plaintext loopback connections. No Hyperdrive binding is used.
Historical Node callers retain their existing connection configuration. Never expose a test clock
or controlled provider adapter through deployed environment configuration.
