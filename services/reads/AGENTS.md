# Reads service instructions

Read [the root instructions](../../AGENTS.md) first, then [README.md](README.md), which holds the
commands and is in Spanish like the rest of the record imported with the mobile app.

`services/reads` is the backend of Ask in the mobile app: six Supabase Edge Functions (Deno) and
the SQL of schema `mobile`, in the Supabase project this repository's API also uses. A wallet signs
`pickler-reads:<address>:<ts>` once a day; the functions charge a simulated credit, ask the model
for a read, and a per-minute cron resolves it against Perpl's mark and sends the push. It is not an
npm workspace: it has its own lockfile and installs with `npm ci --prefix services/reads`.

- **Schema `mobile` only.** The project is shared with the product schemas that Drizzle in
  `packages/infrastructure` owns. No `supabase db push`, `db reset`, `migration repair`, no
  `drizzle-kit` from here, and no DDL outside `mobile` except `create extension if not exists`.
  Migrations go through `npm run migrate` here, which keeps its own ledger, `mobile.migrations`.
- Do not change project settings in the dashboard, and do not use a Supabase MCP connection for
  this project.
- Secrets live in `.env.pickler` at the repository root, which is ignored. Names are in
  `.env.example`; values never enter a tracked file. Function secrets are set with
  `npx supabase secrets set`, as the README shows.
- Deploying a function, running a migration and changing the cron are outward-facing: do them only
  when asked.
- This service and `workers/api` are two backends for one marketplace. Moving reads behind
  `workers/api` is planned and not started; until then, do not add a second caller to these
  functions.

Checks: `npm test --prefix services/reads` runs the Node tests of `scripts/` and, with Deno 2
installed, the Deno tests of `supabase/functions/_shared/`.
