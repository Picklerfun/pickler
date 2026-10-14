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

## Perpl testnet executor

`JWT_ISSUER` is an operator-managed Worker secret matching API. The Wrangler config has no
empty plaintext override. DTOs expose only public deposit requirements, independently of the
private policy, encrypted credentials and owner-stamped preparation.

`src/perpl.ts` composes the separate private Perpl execution service. Every /perpl HTTP request
requires the original independently verified Supabase user JWT; repository transactions recheck
persisted agent ownership. Configure JWT issuer/audience equal to API. `PERPL_ADMISSIONS_ENABLED`
defaults false; missing reviewed policy/encryption key leaves mutations unavailable. Parent
Turnkey credentials only read owner-stamped activities; signing remains the owner's passkey.
Never enable/deploy as a side effect of tests. Service Binding privacy does not replace auth.

Queue/Cron reconcile setup and orders even when new admissions close. Active/stopping sessions
request a generic 15-second wakeup; Cron is the recovery sweep. No wallet/account funding at
startup, no model tool and no withdrawal route. Public DTO projection explicitly excludes keys,
private preparation, leases and signal attribution. See [Perpl trading](../../docs/perpl-trading.md).

`/perpl/credentials/connect` independently verifies the owner JWT and uses authenticated GETs
to connect an existing key to the persisted agent wallet. It never starts or funds an account.
`PERPL_ACCOUNT_SETUP_ENABLED` separately gates setup preparation/confirmation, defaulting false
in hosted composition; it does not prevent existing-key sessions or required exits. No credential
input is logged or returned. The source staging operating state must preserve explicit approval.

The explicitly approved staging configuration enables bounded sessions only for connected keys;
account setup/funding stays disabled with `PERPL_ACCOUNT_SETUP_ENABLED=false`. No session starts
without the owner's action, persisted ownership, verified credential and saved limits.
