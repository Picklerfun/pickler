# Frontend and research integration

The [architecture comparison](diagrams/frontend-integration.html) shows the existing research runtime,
PR #21 and the proposed joined product. The target architecture is a proposal, not a deployed or
completed end-to-end integration. PR #22 (live trading) is excluded.

## Current boundaries

| Surface               | Runtime                                    | Current responsibility                                                     |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Product pages         | Next.js, `apps/web`                        | Design system, public pages, signup/signin; labelled sample agent views    |
| Growth endpoints      | Next.js Route Handlers, `/api/v1/*`        | Landing, waitlist, applications, ticker availability                       |
| Product API           | Hono on Cloudflare, `workers/api`, `/v1/*` | Supabase JWT/API-key authorization, profiles, registered-agent reads       |
| Research host         | `apps/agent-service`                       | Local Studio, tenant-token API, CLI, Node executor                         |
| Background experiment | Cloudflare Worker, Queue and Cron          | Same research use cases, leased executions, local validation only          |
| Research authority    | Private PostgreSQL `pickler` schema        | Configuration, jobs, quotas, evidence, decisions and paper orders          |
| Product budget        | Per-agent Durable Object SQLite            | Reservation ledger, separate from research quotas; no PostgreSQL writeback |

Next.js does not proxy every request to the Worker. Browser authentication uses Supabase Auth and
profile requests use the public Worker. Growth requests use Next.js. Even in Supabase mode, the
public agent directory currently uses sample adapters. Product agent IDs and workspace IDs must
not be assumed to equal research agent IDs and tenant IDs.

## Integration target and remaining work

Preserve the UI, authentication and growth flows. Add authorized research endpoints to the public
Worker that reuse core admission/configuration/query use cases. Resolve the user through a verified
JWT and workspace membership, then use an explicit persisted workspace-to-tenant and
product-agent-to-research-agent mapping. Validate both sides and tenant ownership; never accept a
browser-selected tenant as authority or send laboratory tokens to a browser.

Use Cloudflare Queue to notify the research consumer after durable admission. PostgreSQL remains
the authority on capacity, leases, permissions and execution state. Return `202 + runId`; the UI
polls the authorized API for results. Private research schemas remain outside the Supabase Data API.
Do not expose raw Mastra agents or Studio to product users. Node remains local operator tooling.

Next.js growth routes can remain until there is a concrete reason to move them. The product budget
ledger does not replace research quotas. Connecting it to provider billing requires explicit unit,
period, reservation and reconciliation rules. Token purchases, paid reads, rankings and settlement
remain separate incomplete capabilities; existing sample data must stay visibly labelled.

This correction branch reconciles code and migrations, fixes key authorization, period-safe budget
refunds and the Node 22 timeout test. It does not claim the proposed authenticated research bridge
or production frontend data integration is implemented.

## API key permissions

All API keys, including legacy `integrator`, `internal` and `admin` keys, pass explicit permission
checks. Broad labels alone grant no route permissions. Issue `read:agents` for read-only product
agent endpoints; it grants no writes and does not authorize research endpoints. Existing narrow
signing scopes retain their explicit mappings. No database key is silently upgraded.

## Safe database upgrade

Stop old executors before upgrading and use a backup for any non-disposable database. Do not drop
schemas or reset application data. `npm run db:migrate` uses Drizzle-generated SQL and the same
`pickler_migrations.__drizzle_migrations` journal. Its wrapper checks original SHA-256 hashes and
creation timestamps, applies missing migrations in dependency order in one transaction, and takes
an advisory lock to serialize upgrades. It refuses unrecognized history or a live legacy executor.

The research branch had migrations 0000–0004; the product branch had 0000 plus product schema and
function migrations with later timestamps. Product files are now numbered 0005/0006; their SQL and
original timestamps are unchanged. The wrapper checks every migration identity, so later product
history cannot hide missing lease/cache/paper migrations. Use the root migration command, not a
bare timestamp-only Drizzle migrator. Test databases use this same wrapper.

An existing manually provisioned schema without matching journal entries is not automatically
adopted. Inspect and reconcile its exact provenance before upgrading; the command fails and rolls
back rather than deleting data or guessing that a schema matches. No hosted database is changed
by this correction. The isolated upgrade tests cover fresh, research-only and product-only histories.

## Budget upgrade

Durable Object schema updates add the actual commit month and spend-generation to reservations.
Refunding a previous month or a pre-reset charge does not credit the current balance. Holds committed
across a month boundary are attributed to the commit month. Releases remain idempotent. Older
committed reservations with unknown charge periods remain queryable but cannot credit active
spend; do not infer their commit time from their creation time. This is internal budget bookkeeping,
not a user payment refund or a reversed bet.

## Validation of this correction

- `npm test`: 232 tests passed against disposable PostgreSQL databases.
- `npm run test:supabase`: 232 tests passed against disposable databases on the local Supabase server.
- Timeout adapter tests: 8 passed on Node 22.22.0, matching CI's runtime.
- Formatting, lint, workspace types and workspace builds passed.
- Public API Worker and background research Worker dry-run bundles passed; neither was deployed.
- `npm run db:generate` reports no schema drift after combining the snapshots.

No paid provider research, hosted migration, live order or browser authentication acceptance was
performed. The browser tool blocked the local HTML diagram URL, so its browser preview was not
visually verified. The frontend build succeeds; this does not establish a working end-to-end
product-to-research connection.
