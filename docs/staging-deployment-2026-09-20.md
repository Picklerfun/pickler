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

### Confirmed diagnosis: certificate trust

The pooler's leaf certificate is `*.pooler.supabase.com`, issued by
`Supabase Intermediate 2021 CA`, with expiry March 11, 2030. Its trust chain requires the
Supabase root CA supplied by the operator. The password is valid and the certificate is not expired.

A controlled A/B experiment ran the **same production pg connection configuration** and
`SELECT 1` in two local workerd instances. Both received the same DATABASE_URL and
DATABASE_CA_CERT. Only the host runtime's trusted CA store differed:

| Runtime      | Certificate trust                                 | Result                               |
| ------------ | ------------------------------------------------- | ------------------------------------ |
| Node / pg    | Explicit Supabase CA, verification enabled        | Query succeeds; TLS 1.3, authorized  |
| Node / pg    | Default system CAs, verification enabled          | `SELF_SIGNED_CERT_IN_CHAIN`          |
| workerd / pg | Default runtime CAs; CA present in pg SSL options | `Connection terminated unexpectedly` |
| workerd / pg | Supabase CA added to the host runtime trust store | Identical query succeeds             |

This isolates certificate trust as the connection blocker; database credentials, SQL, migrations,
TCP reachability and pg's query execution are not the cause of this reproduced failure.

The installed pg version is 8.20.0 with pg-cloudflare 1.4.0. pg chooses CloudflareSocket in
Workers and delegates TLS to `cloudflare:sockets`. Its pg SSL `ca` option does not install a
trusted root in that runtime. Supplying DATABASE_CA_CERT as a Worker secret therefore does not
have the same effect as passing that CA to Node's TLS client.

For the successful diagnostic only, Miniflare reads the host process's `NODE_EXTRA_CA_CERTS`
and injects its PEM certificates into workerd's `internet.network.tlsOptions.trustedCertificates`.
This changes the **local host runtime**, not the Worker application. Setting a similarly named
secret on a hosted Worker is not an equivalent fix. No such secret, application TLS bypass,
transport replacement, or remotely deployed diagnostic endpoint was introduced.

The earlier native `node:tls` experiment's initial `authorized: true` flag was misleading: the
connection failed when exchanging the PostgreSQL startup message. Acceptance must require a real
query; that early flag is insufficient.

The remote deployment remains unchanged, admissions closed. The successful local trust-store
experiment confirms the diagnosis, **not** a working hosted solution. A compatible hosted TLS
trust path must be established before completing remote acceptance.

References: [Workers sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/),
[Workers TLS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/),
[Supabase SSL verification](https://supabase.com/docs/guides/platform/ssl-enforcement),
[workerd TLS implementation](https://github.com/cloudflare/workerd/blob/main/src/node/internal/internal_tls_wrap.ts).

## Transaction-pooler follow-up

At the operator's request, the same Supabase shared-pooler host was tested on port `6543`
(transaction mode) before changing deployment settings. The password and certificate validation
requirements were unchanged. No application data was written.

- Node with the supplied CA: query and transaction succeed; TLS is authorized.
- A transaction-local `set_config(..., true)` remains visible inside the transaction and clears
  after rollback. A `pg_advisory_xact_lock` succeeds and is released by transaction completion.
- workerd with default runtime certificate trust: `Connection terminated unexpectedly`.
- Identical workerd probe with the Supabase CA added to its local host trust store: query,
  transaction-local setting and transaction-scoped advisory lock succeed.

Transaction mode therefore does **not** resolve the TLS blocker. These focused checks establish
only the tested transaction behavior, not full application compatibility or remote acceptance.
The deployed DATABASE_URL and session-mode guard were left unchanged rather than rolling out
an endpoint that fails under the same deployed trust constraints. No paid provider calls occurred.
Migrators continue to require the separately configured direct or session connection.

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
