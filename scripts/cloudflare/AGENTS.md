# Cloudflare build operations

Read the root instructions before changing this directory. The [build guide](README.md)
documents the dashboard configuration for the four existing staging Workers; it does not
provision resources, enable admissions, or run migrations.

Keep commands consistent with the committed Wrangler configurations and staging operations
guide. Never include actual provider keys, Supabase credentials, or private environment files.
Distinguish build variables, runtime bindings, and GitHub Actions deployment credentials.
Documentation checks are sufficient for changes to this guide.
