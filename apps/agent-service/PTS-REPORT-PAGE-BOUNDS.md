# Bounded PostgreSQL fingerprints for local PTS reports

The `pts-fast-20261012-incremental` paper study interrupted after 36 saved rounds with
`PERSISTENCE_QUERY_TIMEOUT`. Its report worker identified a `SELECT` whose static SQL hash
matches the event-fingerprint page in `perps-audit-export.ts`. PostgreSQL returned SQLSTATE
`57014`; the recorded elapsed query duration was 11,985.24 ms. The report pool had one connection
and zero waiting clients. Those counters do not establish pool saturation.

The study and its frozen commit `a15351d52dc67b61a29a9e0e69afa84e7f995322` remain intact.
A later read-only inspection confirmed interrupted admission, released ownership, no PTS fills,
and four pending SMA long positions. The previously published 35-round report still said
`running`; that saved report is not process-liveness evidence. The authoritative study record
contains 36 rounds. Pending positions are not retrospectively closed or valued using later data.

## Demonstrated query defect

The original incremental query selected event fingerprints with `ORDER BY at,key LIMIT 16`.
That limit bounded returned rows, but PostgreSQL could evaluate the complete JSONB fingerprint
on every scanned row before sorting and limiting. Round fingerprints had the same defect with
`LIMIT 1`. Repeating those scans for successive pages serialized and hashed payloads that were
not part of the requested page.

Two PostgreSQL regressions force an unordered scan and replace only the SHA-256 function with
a test-only guard that rejects a body outside the independently selected page. Both regressions
fail on the original query with `OUT_OF_PAGE_FINGERPRINT` and pass on the corrected query.
They also verify original exported values, exact native fingerprints, full inventories, and
unchanged database contents.

The correction materializes the ordered page of keys before joining those keys to their original
JSONB rows. Only the selected row bodies enter the fingerprint projection. The existing
`REPEATABLE READ READ ONLY` transaction, scope, order, full current inventory, payload hashes,
update/deletion detection, source-reuse policy and nonincremental export stay unchanged.
It adds no tables, indexes, migration, timeout increase, financial change or strategy change.

This proves an inefficient execution plan and removes it. The original diagnostic did not retain
the page cursor, full server plan or concurrent workload of the failed query. It cannot establish
that this defect was the only contributor to that historical timeout. Existing key scans,
all-row revision checks, local file verification and full report replay/rendering still perform
work; reports are not constant-time as history grows.

## Controlled measurements

A separate disposable PostgreSQL database held 128 events in reverse chronological insertion
order, each with 262,144 bytes of additional synthetic payload. The benchmark extracted the old
query from the frozen checkout and the corrected query from this checkout. It alternated the
order of the two queries across 30 pairs, using the same inputs, page and read-only snapshot.
All 60 returned key/date/fingerprint arrays matched exactly. Durations use a monotonic clock;
p95 uses the nearest rank, with 30 measurements per path.

| Query                 | Measurements | Median (ms) | p95 (ms) | Bodies fingerprinted by the recorded plan |
| --------------------- | ------------ | ----------- | -------- | ----------------------------------------- |
| Original event page   | 30           | 138.9404    | 237.1501 | 128 before sort/limit                     |
| Materialized key page | 30           | 18.4234     | 31.8798  | 16 after key-page selection               |

Median query time decreased by 86.7% in this controlled scenario. The complete measurements,
query hashes and execution plans are retained in a private `probe.json` beside the original
timeout diagnosis. The original static query hash is
`de078093313d93f0505652892ade9383fe17ec68f0d65ddfbe0b6f6188ebe1bd`; the corrected query hash is
`14f4f2acd8cdf057c7bb575515f2929069353d6b848e20ee707f2f60db0b7e17`.

These are source-query timings on synthetic data. They exclude provider acquisition, complete
source capture, file verification, replay, rendering and publication. They neither measure
historical market latency nor demonstrate a profitable PTS signal. Earlier full/incremental
capture benchmarks remain separately interpreted in [incremental capture](PTS-REPORT-INCREMENTAL.md).

## Validation and continuation

`test/pts-audit-page-bounds.test.ts` contains the two plan regressions. The existing incremental
suite checks mutable, deleted and backdated rows, concurrent consistent snapshots, missing or
corrupt parts, canonical hashes, historical v1/v2 packets, both PTS configuration versions and
worker publication. Run these only against the isolated controlled PostgreSQL server.

The interrupted study, failed report artifacts, pending financial state and historical monetary
reservations are preserved. A corrected terminal report must use a new directory and identify
its analyzer commit separately from the original study commit. This repair does not restart the
study, recover missed slots, change signals or authorize writes to its paper portfolios.
Both strategies support long and short positions; the recorded absence of PTS fills is not
evidence that shorts are disabled.
