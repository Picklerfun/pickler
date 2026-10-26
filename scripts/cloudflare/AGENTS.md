# Cloudflare build operations

Read the root instructions before changing this directory. The [build guide](README.md)
documents the dashboard configuration for the staging backend Workers and the public web Worker; it does not
provision resources, enable admissions, or run migrations.

Keep commands consistent with the committed Wrangler configurations and staging operations
guide. Never include actual provider keys, Supabase credentials, or private environment files.
Distinguish build variables, runtime bindings, and GitHub Actions deployment credentials.
Indexer Builds must preserve its reviewed runtime policy variables using the committed
`keep_vars=true`, remain main-only and retain its trusted Hyperdrive, minute Cron and RPC budgets.
The independent indexer is not part of the optional four-Worker coordinated release. No build
credential or connection alone establishes remote catch-up or public trade acceptance.
Documentation checks are sufficient for guide-only changes. `deploy-staging.mjs` owns the gated
main release adapter, with an injected command runner for controlled tests. It must migrate before
any publication, preserve the checked commit, stop on failures/cancellation and separate migration
credentials from deployment children. It never calls business providers or changes admissions.
Root tests include `deploy-staging.test.mjs`. Read the
[coordinated deployment guide](../../docs/staging-deployment-pipeline.md) before changing it.

The workflow guard tests also cover standalone `staging-migrations.yml`: main-only, no Cloudflare
credential/publication, local checks before hosted SQL, secret isolation and an inverse coordinated
gate. Independent Builds may run concurrently with this migration-only job by user decision.
