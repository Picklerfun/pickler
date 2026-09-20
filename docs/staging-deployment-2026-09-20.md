# Staging deployment — September 20, 2026

## Status

The three Workers and dedicated Queue are deployed. **End-to-end research acceptance is blocked**
by the hosted PostgreSQL connection from workerd. Admissions remain closed on both backends.
No paid provider checks or research executions were performed; the three-run acceptance budget
is untouched. This record does not claim the agent flow is operational remotely.

Web: https://pickler-web-staging.gilbertsahumada.workers.dev

Deployed source: `cb65ea4` (based on main `10ee144`). Public Supabase build configuration targets
project `yvdipvcrpbqvofayteqf`. Cloudflare account: `bc8d4adf4860284fda426b24e7377bc2`.
No Hyperdrive, container, VM, public Mastra server or real trading was introduced.

| Resource                         | Version                                |
| -------------------------------- | -------------------------------------- |
| `pickler-web-staging`            | `6b4eff4b-a893-4338-897b-bde03a655e10` |
| `pickler-api-staging`            | `938ed081-0b21-432a-b600-6675d7fe3b77` |
| `pickler-research-staging`       | `52ca240e-c35c-4abb-acf0-0bfa5e9a80ae` |
| `pickler-research-staging` Queue | Dedicated producer/consumer resource   |

The API and consumer have workers.dev and preview URLs disabled. The web reaches the API
through its Service Binding. Backend secrets were uploaded using native Wrangler `--secrets-file`
with private, ignored per-destination files. The web received only public Auth build values.
No new environment loader or root environment convention was added.

## Verified

- Hosted history matches all nine committed Drizzle migration hashes and timestamps. No migration,
  schema reset, data deletion or historical rewrite was required.
- The supplied permanent session-pooler connection works from Node with the Supabase CA,
  certificate verification and hostname verification enabled. The TLS socket reports authorized.
- Format, lint, types and all three Worker builds passed. Supabase suite: 260 passed,
  zero failed, one opt-in controlled Worker flow skipped. That controlled flow was verified in
  PR #26; it was not rerun as part of this remote acceptance attempt.
- Public home and landing API return 200; unauthenticated console agents return 401.
- Browser inspection confirms the deployed landing renders, including its sample-data label.
- Supabase password authentication works for a dedicated confirmed acceptance user. No signup
  email was sent. The product profile was persisted and is retrievable through the deployed API.
- Supabase site URL and callback allowlist now target the staging web and `/auth/callback`.
  Native config diff/push changed only those two declared properties, preserving unrelated settings.
- Private product Data API profile access works. Private research schemas were not exposed.

## Connection blocker

The deployed profile POST returns 500 after the product profile is saved because workspace
onboarding uses the PostgreSQL transport. Explicit `/console/onboard` also returns 500.
The identical idempotent onboarding transaction succeeds from the operator's Node connection.
The acceptance user's research access remains disabled.

A loopback-only workerd probe against the same hosted pooler reproduces
`Connection terminated unexpectedly` using the production pg configuration. A native
`node:net`/`node:tls` probe initially reports `authorized: true`, but fails with
`Network connection lost` when it sends the PostgreSQL startup message. That early flag is
**not** evidence of a successful database handshake. No transport substitution was committed.

The checked pg version is 8.20.0 with pg-cloudflare 1.4.0. pg selects CloudflareSocket in Workers;
its TLS upgrade delegates to `cloudflare:sockets`. The inspected workerd native TLS upgrade also
delegates to that socket API, rather than installing the supplied CA as Node does. This is evidence
of a TLS compatibility limitation, but the generic connection-close error does not by itself prove
the exact remote handshake rejection. Do not disable verification or claim changing libraries has
resolved it without a successful query and negative hostname/certificate tests.

References: [Workers sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/),
[Workers TLS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/),
[Supabase SSL verification](https://supabase.com/docs/guides/platform/ssl-enforcement),
[workerd TLS implementation](https://github.com/cloudflare/workerd/blob/main/src/node/internal/internal_tls_wrap.ts).

## Remaining acceptance and rollback

Resolve the verified-TLS PostgreSQL transport first, retaining the agreed no-Hyperdrive architecture
unless the operator explicitly changes it. Then finish two-user onboarding, agent/config isolation,
browser session lifecycle and remote transactions. Only then enable admissions for the bounded
manual/manual/scheduled research acceptance and pause schedules afterward.

Keep `ADMISSIONS_ENABLED=false` in both backend configurations. No queued research was created.
All initial Workers are deployed from this first staging release, so there is no previously verified
remote agent version to roll back to. For subsequent compatible releases, use native Wrangler
rollback with the version IDs above and the matching configuration. Retain database and Queue data;
never reverse migrations or roll back to an executor with legacy global recovery.
