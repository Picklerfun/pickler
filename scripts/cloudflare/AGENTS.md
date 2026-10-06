# Cloudflare build operations

Read the root instructions before changing this directory. The [build guide](README.md)
documents the dashboard configuration for the four existing staging Workers; it does not
provision resources, enable admissions, or run migrations.

Keep commands consistent with the committed Wrangler configurations and staging operations
guide. Never include actual provider keys, Supabase credentials, or private environment files.
Distinguish build variables, runtime bindings, and GitHub Actions deployment credentials.
Documentation checks are sufficient for guide-only changes. `deploy-staging.mjs` owns the gated
main release adapter, with an injected command runner for controlled tests. It must migrate before
any publication, preserve the checked commit, stop on failures/cancellation and separate migration
credentials from deployment children. It never calls business providers or changes admissions.
Root tests include `deploy-staging.test.mjs`. Read the
[coordinated deployment guide](../../docs/staging-deployment-pipeline.md) before changing it.

The workflow guard tests also cover standalone `staging-migrations.yml`: main-only, no Cloudflare
credential/publication, local checks before hosted SQL, secret isolation and an inverse coordinated
gate. Independent Builds may run concurrently with this migration-only job by user decision.
