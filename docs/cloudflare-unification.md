# Cloudflare unification

## Delivery status

The API/data branch introduces the private console API and PostgreSQL coordination.
The current Next.js routes remain until the runtime/console follow-up switches their transport.
This document does not claim a deployed staging environment or live-provider acceptance.

Target deployment consists of a Next.js/OpenNext web Worker, a Hono API Worker, and a
Queue research consumer. Node and Studio remain local operator tools. PostgreSQL and
Supabase Auth are hosted in a separate staging project. API and research use a Hyperdrive
binding with query caching disabled. Database clients are scoped to an invocation.

## Identity and ownership

Completing a profile provisions one personal workspace idempotently. Existing completed
profiles can use `POST /api/v1/console/onboard`. The operation never enables research.
The operator explicitly runs, with a direct/session PostgreSQL connection:

```sh
DATABASE_MIGRATION_URL=... npm run research-access --workspace=@pickler/infrastructure -- USER_UUID enable
DATABASE_MIGRATION_URL=... npm run research-access --workspace=@pickler/infrastructure -- USER_UUID disable
```

Do not put secrets in shell history; supply the connection through the operator environment.
Only enabled owners can create agents or mutate research. Admin, manager, developer and
auditor members can read; membership alone does not grant research administration.
Console endpoints accept verified user sessions only, never legacy HMAC/API-key authority.
The API checks fresh persisted access. Execution ownership also checks current operator
access; revocation prevents new claims and late evidence/results. Expired recovery retains
previous evidence. No paid research is retried automatically.

`pickler.workspace_tenants` and `pickler.product_agents` hold explicit unique links.
New records reuse UUIDs; lab tenants are never assigned during onboarding. The runtime
configuration in `pickler.agents` is authoritative. Product registry rows carry identity,
not a second editable executable configuration. Creating an agent and its handle, config
and mapping is transactional and idempotent; schedules start disabled.

Managed agents require connection validation for their exact config version and a completed
manual investigation before enabling schedules. The lab's global connection flag cannot
satisfy that requirement. Checking a connection is an explicit operator action.

## HTTP contracts

The public prefix is `/api/v1`; the API Worker internally mounts `/v1`. The web binding
will transport requests and cookies without business logic. Response families intentionally
retain their existing formats:

- Product/auth/profile routes: existing success/error envelopes.
- Growth routes: existing DTOs and `{ error: { code, message, fields? } }` errors.
- `/console`: research DTOs and `{ error: CODE }` errors; all private responses use no-store.

Console routes include onboarding, current access, catalog, agent creation/list/detail,
versioned configuration, manual runs, run history/detail/events, pause and scheduling.
Creation requires `Idempotency-Key`. Research admission returns `202` with `runId` and
`status`. History returns at most 50 records, with an optional millisecond `before` cursor.
Run DTO validation removes internal lease fields. Tenant identifiers are never accepted
from model output or request bodies as authorization.

Growth routes preserve `pk_apply`: HttpOnly, Secure outside local development, SameSite=Lax,
Path=/, thirty-day expiry. Mutation origins must match ALLOWED_ORIGINS when present;
cross-site browser requests are rejected. The bearer token never appears in JSON.
Demo landing/market data stays sample-labeled; moving transport does not implement trading,
paid reads or ranking computation.

## Budget migration

New mapped agents use PostgreSQL budget reservations and per-agent row locks. Core remains
responsible for amounts, periods, generation-aware refunds and idempotency. Expired holds
are released when the ledger is read or mutated, before admitting new spend. Research
counts and monetary micro-USD amounts remain separate; provider costs are never invented.

Legacy Durable Object data is retained. The new adapter refuses to import legacy agents or
existing budget projections automatically (`BUDGET_IMPORT_REQUIRED`). A verified export and
reconciliation is required before switching their authority. Never run two authorities for
the same agent. No legacy tables or Durable Objects are removed by these migrations.

Apply the reconciled migrator against an isolated database first. The tests cover empty,
research-only and product-only histories. Keep all private Pickler schemas out of the
Supabase Data API. Never provide database/provider credentials to the web Worker.
