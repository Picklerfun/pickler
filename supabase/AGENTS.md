# Local Supabase instructions

Read the root AGENTS.md before changing this directory. This configuration starts an isolated local Supabase stack for Pickler (CLI 2.111.0 verified). API, PostgreSQL and Studio use ports 54521, 54522 and 54523; preserve separation from other projects on this host.

Drizzle in packages/infrastructure owns Pickler migrations. Do not duplicate its SQL here or reset databases to apply application changes. Mastra initializes its own private schema. Expose only the configured public API schemas, never pickler, pickler_migrations or mastra. Local Supabase Auth is not integrated into Pickler's laboratory token authentication.

Use root npm scripts supabase:start, supabase:stop, supabase:status, db:migrate and test:supabase. Stop without deleting volumes. Generated .temp and .branches content must remain ignored. Never commit environment files or copy generated keys into documentation.

## Product schemas and the hosted project

The product schemas the Hono API reads (`identity`, `agents`, `budget`, `audit`, `growth`, `market`)
are defined in `packages/infrastructure/src/persistence/product/` and applied by the same Drizzle
pipeline as the research tables: `npm run db:generate` writes the SQL, `npm run db:migrate` applies
it. `drizzle/0006_product_functions_and_grants.sql` is a custom migration for what Drizzle does not
model: the `internal` helper schema, triggers, deferrable foreign keys, the references to
`auth.users`, the security-definer functions the Hono API calls, and the grants. It detects whether
Supabase roles and `auth.users` exist, so the same migration runs on the local Docker PostgreSQL and
on Supabase.

There is no SQL in this directory any more. Never apply schema changes from here.

Never drop existing product schemas to reconcile migrations. Use the hash-aware Drizzle wrapper
through `npm run db:migrate`; see [the upgrade guide](../docs/frontend-integration.md).
Manually provisioned schemas without recognized journal entries require explicit provenance
reconciliation. The wrapper refuses unknown history rather than adopting or deleting it.
No hosted migration is implied by local tests. Connection URLs and service keys are operator supplied.

Data API: the hosted project exposes `identity`, `agents`, `budget`, `audit`, `growth` and `market`
so the service role can read them over PostgREST. Never expose `internal`, `pickler`,
`pickler_migrations` or `mastra`.

The local Data API allowlist now includes the six product schemas above, matching the hosted
configuration. Research schemas remain private. Existing running local stacks need a PostgREST
configuration reload or a non-destructive Supabase restart after changing the allowlist.
