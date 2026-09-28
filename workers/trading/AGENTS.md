# Trading worker

Read the root and infrastructure instructions before changes. This private Worker owns the
pilot signer and CLOB credentials. No HTTP route is public; the API uses a Service Binding.
Queue messages are generic wakeups, never signed orders. PostgreSQL owns admission, budgets,
idempotency and leases. Cron reconciles ambiguous submissions even when admissions are closed.
Never create wallets, grant approvals or fund accounts during startup. Provider injection is
only for tests. Secrets must not appear in logs, responses, prompts or configuration snapshots.
Run root tests, typecheck and `npm run build:worker --workspace=@pickler/trading-worker`.

## Trading package boundary

Trading rules and financial ports are owned by `@pickler/trading` public subpaths. Core retains
identity, configuration and research contracts. Infrastructure implements the trading ports;
runtime composes adapters and models. Hosts must not duplicate risk, fills or accounting.
