# Bounded product reads

This change coordinates the API, web and mobile consumers. Existing catalogue and run/event-list
paths change their response DTOs in the same release; there are no legacy array endpoints to
maintain. A previously installed mobile build must be upgraded before this API contract ships.
No deployment, hosted migration, cron change, admission change or new public cache is included.

## Catalogue

`GET /v1/marketplace/agents` and `/directory` return `{ items, nextCursor }`, defaulting to 20
entries and allowing at most 50. `q`, `theme`, `available` and `adviceForSale` filter in SQL before
the lookahead limit. Cursors bind the endpoint, normalized filters, configured network and stable
creation/id order. The current persisted domain has no settled performance or open read service:
its performance/service ordering is tied, and `available=true` therefore returns no entries.
Future settlement or service implementations must extend the SQL ordering and cursor together.

Canonical token proof is read once for the selected directory page. `/marketplace/tokens` supplies
at most eight confirmed tokens to the landing page, filtering canonical proof before its cap.
Clients expose explicit Load more and label counts as shown/loaded entries. They do not drain all
pages or infer whole-market totals from a partial page. Public responses use `no-store`.

## Execution reads

Private run lists use `{ items, nextCursor }` summaries, default 20/max 50. Configuration snapshots
and decisions are excluded from SQL projection. Research and preview `/status` endpoints and the
Advice recommendation `/status` endpoint return lightweight identity, status, timing, public error,
result availability and last event ID. Full results remain explicit detail reads.

Research and preview `/events` accept exclusive decimal-string `after` IDs and `limit` (50 default,
100 maximum). Each page also stays within 256 KiB including the JSON envelope. A large event is an
explicit reference, not a truncated body; its complete type/data is available through the named
individual event route after the same owner/tenant/preview-expiry checks. Event IDs stay strings
to preserve PostgreSQL bigint precision in JavaScript. Active research/advice polls run every three
seconds, research discovery every 20 seconds. The web reader drains event pages serially, including
terminal tails, deduplicates IDs, and fetches a selected complete result once per view. Hidden-page,
background and owner changes cancel read requests. Private responses remain `private, no-store`.

Mobile Reads retains the existing 50-row list and selects DTO columns explicitly. The list hook is
single-flight, discards late replies and aborts on background/account changes. Its deadline covers
the response body. Advice GET cancellation never retries a POST or a payment.

## Studio and authentication

Studio lists batch authorized runtime snapshots/readiness and wallet links. A selected agent reads
its own product identity, configuration, readiness and balance, without loading fleet configs or
balances. Fleet creation eligibility has its own operation and creation rechecks it authoritatively.
Known eligibility in the client is preserved across a single-agent refresh. Balance reads deduplicate
addresses and admit at most four transports concurrently within one invocation.

The public JWKS resolver registry retains at most eight trusted issuer/URL/audience combinations per
isolate and preserves jose key rotation. JWT claims, principals, sessions, balances and database pools
are not cached across requests.

## Controlled evidence

The tests use disposable local databases and fabricated transport/provider fixtures, never hosted
traffic or provider acceptance. Catalogue tests traverse 65 agents with tied timestamps exactly
once and check server filters and cursor isolation. Execution tests traverse 125 historical runs
with 200 KB snapshots while returning only narrow summaries (first-page JSON below 20 KB). Event
tests preserve all 121 events including a 600 KB detail, bound rows and bytes, preserve decimal IDs
and retrieve a late append. Studio tests return exactly the requested 40 configs in one SQL query
and issue one wallet-link batch query. JWT tests cover identity/audience isolation, eight-entry
LRU eviction and real key rotation against a local JWKS server. Balance tests cover address
deduplication, four concurrent reads and invocation isolation. Mobile tests cover stalled response
bodies, overlapping refreshes, stale-account replies and background Advice cancellation/resumption.

These checks establish bounds and correctness, not a production egress reduction percentage. Measure
Supabase origin egress and normalized query calls after an explicitly approved coordinated rollout.
