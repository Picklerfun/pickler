# Pickler hosted database upgrade — 2026-09-19

The existing `pickler` project in Sherry Labs (`yvdipvcrpbqvofayteqf`, us-east-1) was upgraded
at 2026-09-19T20:34:06Z using migration source commit
`3a37d588b514a8253c6fd2aba7d6a57881caf1cf`. No other Supabase project was modified.

## Applied migrations

The database already had the original research persistence and product schema/functions
migrations (0000, 0005, 0006). Their hashes and original timestamps matched the repository.
The reconciled migrator applied the six missing entries:

- 0001: research leases and shared concurrency policy.
- 0002: protection against legacy executor recovery.
- 0003: public-provider cache and coordinated quotas.
- 0004: manual paper-order persistence.
- 0007: console identity links, operator research access and PostgreSQL monetary budgets.
- 0008: budget state default and workspace/tenant consistency constraint.

The journal now contains nine recognized migrations. The existing migrateDatabase function
ran through a session-pooler connection on port 5432, with the CLI's delegated postgres role,
verified TLS using the Supabase CA, and the existing advisory-locked transaction. The second
execution was a no-op. No schema reset, implicit history adoption or historical row rewrite
was performed. A temporary CLI credential expired before one connection attempt; that attempt
failed before opening a session and applied no SQL. It was refreshed before the successful run.

## Verification and backup

- Three isolated local migration-history tests passed: fresh, research-only, product-only.
- No active research or legacy executor lock existed before the upgrade.
- All fourteen research tables have row-level security enabled.
- Concurrency policy remains global 5 and per-tenant 2; the per-agent running uniqueness guard
  remains part of the research schema.
- Users, product/research agents, runs, evidence events, waitlist entries and applications were
  zero before and after; no laboratory tenants or sample users were provisioned remotely.
- A private custom-format backup of the nine application/migration schemas was created before
  applying changes. pg_restore successfully read its 310 archive entries. The backup remains
  local at `/tmp/pickler-staging-before-20260919.dump` (117149 bytes), outside Git.
- Public-key Data API probes returned PGRST106 for pickler, pickler_migrations, mastra and
  internal: those schemas remain unexposed.

## Remaining configuration

The Data API also rejects growth because the product schemas have not yet been enabled.
The attempted allowlist update did not execute: automatic approval review requires explicit
confirmation for exposing identity, agents, budget, audit, growth and market through PostgREST.
Existing database grants and RLS are not a substitute for that pending approval. No private
research schema is proposed for exposure.

This report establishes the hosted database upgrade only. Cloudflare provisioning, Worker
versions, HTTPS authentication and the capped live research acceptance are still pending.
See [staging operations](cloudflare-staging.md) for the remaining deployment sequence.
