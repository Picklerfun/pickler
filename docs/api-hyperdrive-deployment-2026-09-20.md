# API Hyperdrive staging migration — September 20, 2026

## Deployment

API source: `b1ee99e0a608b1d8db5cce5808a368f8e3e33503`, based on merged PR #28.
The web remains at https://pickler-web-staging.gilbertsahumada.workers.dev.

| Worker                     | Final version after removing obsolete secrets |
| -------------------------- | --------------------------------------------- |
| `pickler-api-staging`      | `f98b71de-518c-41f1-bed4-8b873d4ff7f9`        |
| `pickler-research-staging` | `784e2c38-7244-410e-afd1-cb61041a4875`        |

The API code upload was `4599616f-0a1d-4f40-9c2f-6c3c7f45188e`. Research retains its previously
verified code from source `541cc75`; only obsolete secrets were removed in this deployment.
The web bundle was not changed. Both backend Workers have admissions closed.

Both backends bind `DATABASE` to `pickler-database-staging`
(`05150d06f7164d26a991288a88044710`). The verified resource configuration uses the Supabase
session pooler on port 5432, `verify-full`, the project CA, disabled query caching, and an
origin connection limit of ten. Per-invocation pools retain two connections and ten-second
timeouts. Neither hosted backend falls back to a direct database URL.

`DATABASE_URL` and `DATABASE_CA_CERT` were removed from both deployed Workers. Database
credentials remain in Hyperdrive and in the private operator configuration for migrations.
Do not bulk-upload historical secret files containing these retired keys. No schema migration,
data reset, domain change, production deployment, or paid provider call was performed.

## Validation

- Shared packages built successfully; all ten workspace type checks passed.
- Lint and repository formatting passed.
- Full local Supabase suite: 270 tests, 269 passed, zero failed, one opt-in test skipped.
- API and research Worker deployment bundles passed; committed staging topology passed.
- New tests cover hosted binding enforcement, rejection of direct fallback, local loopback
  validation, and independent API composition without model credentials or network calls.
- Remote checks through the public web's Service Binding authenticated both existing test users,
  executed onboarding twice per user to check transactional idempotency, verified workspace
  identity and disabled research access, read agents and historical runs/evidence, checked
  cross-tenant agent/run requests return 404, and repeated each run read five times.
- The remote API checks passed again after secret removal. Research Cron reconciliation on the
  final version completed with outcome `ok`, no exceptions, 385 ms wall time and 24 ms CPU.
- Private console responses retained `no-store`. The two earlier failed runs remain failed;
  this transport check does not turn them into successful research or decisions.

## Remaining acceptance and rollback

Paid end-to-end research acceptance remains pending. This migration does not authorize more
provider calls or enable schedules. The historical research failures and prior deployment
limitations remain documented in the earlier deployment record.

On an incident, keep admissions and schedules closed, retain all evidence and data, and deploy
a compatible Hyperdrive revision. Do not roll back to an old API version requiring plaintext
DATABASE_URL: those secrets and the exception have been retired. No database rollback is needed.
