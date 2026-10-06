# GitHub automation

Read the root instructions and the instructions for any workspace affected by a workflow.
Workflows must use the committed lockfile, Node 22.22+ and npm 10.9.3. Controlled tests must not
use provider or hosted database credentials.

`workflows/staging-deploy.yml` owns the opt-in coordinated release: checks/builds, reconciled
migrations, Research, Trading, API and Web. It runs only on main pushes/dispatch and requires the
explicit repository enable variable plus a staging environment. Keep credentials scoped to the
preflight/release steps, main-only environment branch restrictions and non-cancelling concurrency.
Never add pull-request deployment or automatic database reset/rollback. Do not cancel a running
release when a new push arrives. Keep independent Worker Builds disabled before enabling it.

Web builds receive the staging environment's public marketplace and Studio host variables.
Their fallbacks match the web's canonical two-host defaults; they are build settings, not
backend runtime secrets. Changing them requires a web rebuild and aligned DNS/auth callbacks.

Read [the deployment guide](../docs/staging-deployment-pipeline.md) and run the controlled
`scripts/cloudflare/deploy-staging.test.mjs` suite when changing gates, order or credentials.
Root tests discover that suite. A local dry run is not remote deployment acceptance.

`workflows/staging-migrations.yml` runs the canonical Supabase migrator on main pushes/dispatch
while the coordinated release is disabled. It preserves independent Cloudflare Builds, requires
no Cloudflare credential and scopes operator secrets to the hosted migration step. It tests against
disposable PostgreSQL first and shares non-cancelling release concurrency. There is deliberately no
migration-before-Cloudflare-build guarantee. The coordinated gate disables this standalone job.
