# Local PTS study read isolation

This correction removes exclusive row locks from study inspection and explicitly selected local
PTS account reads. Financial admission, observations, fills, partial reductions and lease writes
retain their existing exclusive locks and ownership checks. It does not change either strategy,
funding arithmetic, price acquisition, query deadlines or historical records.

## Reproduced failure

The frozen study `pts-fast-20261012-report-isolated` at commit
`328ef96fb0c68c3ab85f5a979c93e81e864049c5` stopped after 90 recorded rounds with
`PERSISTENCE_QUERY_TIMEOUT`. Its original diagnostic identifies a timed-out study-row locking
query. PostgreSQL server facts independently confirm a statement timeout. The available original
evidence does not identify the blocking transaction, call site or server wait phase.

Controlled regressions on an isolated PostgreSQL server reproduce one specific mechanism:
a delayed study/account read holds the study row's exclusive lock while lease renewal or release
waits. Seven study-read cases and four account-read cases fail before the correction. The
fixture shortens only its writer's statement deadline to 500 ms; production limits are unchanged.
An independent `pg_blocking_pids` witness identifies the controlled legacy account reader as
the actual blocker. This proves the reproduced mechanism, not the cause of the historical timeout.

## Study reads and permission checks

`PostgresPerpsStudyStore.view` and `cycleView` use a read-only repeatable-read transaction without
`FOR UPDATE`. Record, rounds and events therefore belong to one consistent database cut.
The v8/v9 cycle projection, historical complete views, ordering and cutoffs remain unchanged.

`guard` uses explicit read-committed read-only isolation. Its final ownership check sees a
concurrent release or expiry rather than a repeatable-read ownership snapshot. Mutating methods
continue to use their original exclusive study lock, final fence and local liveness callback.

## Opt-in PTS account reads

The local PTS host sets `studyOwner.readPolicy = "pts-snapshot-v1"` for its lease-bound paper
repository. Only trusted v8/v9 study records and their pinned account policies admit this path.
The option cannot be supplied by a financial intent, cross the bound study identity or grant PTS
exceptions to a historical SMA or Studio account.

A guarded account view performs:

1. Fresh read-committed read-only ownership and policy checks.
2. The existing read-only repeatable-read account/attempt/movement snapshot.
3. Fresh read-committed read-only checks after the snapshot, followed by local cancellation checks.

The final checks occur outside the repeatable-read transaction so concurrent revocation is visible.
Expired attempts are projected as interrupted without rewriting them. Their stored unknown fields
and reservations remain intact. Actual mutations retain recovery, admission, account locks,
transactional policy checks and final ownership fences. Callers without the opt-in keep their
historical `view` behavior.

## Controlled measurements

The benchmark uses the same initialized account and verified financial result, alternates order
and records 30 actual measurements for each path in each scenario. Durations use the monotonic
clock. The delayed scenario injects a 50 ms pause after the account read; it is a controlled
interference test, not a reconstruction of production latency.

| Scenario and operation      | Reference median / p95 (ms) | Corrected median / p95 (ms) |
| --------------------------- | --------------------------- | --------------------------- |
| Uncontended account read    | 4.19 / 5.83                 | 6.84 / 10.34                |
| Uncontended renewal         | 2.29 / 4.44                 | 2.33 / 2.90                 |
| Renewal during delayed read | 59.38 / 63.74               | 3.98 / 10.36                |

The additional fresh guards cost time for an uncontended read. The corrected read no longer
holds the exclusive lock while delayed; the lease can renew independently. These measurements
do not establish trading profitability, market availability or a universal latency improvement.

## Verification and limitations

`packages/infrastructure/test/perps-study-read-isolation.test.ts` covers both PTS versions,
both accounts, consistent cuts, concurrent release, exact expiry, cancellation, changed policy,
historical-policy rejection, unchanged persisted financial evidence and unknown fields.
The real PTS coordinator suite uses the opt-in path and checks openings, closes and partials.

All contention probes and test writes use disposable databases on a separate controlled physical
PostgreSQL server. Never block, terminate or stress a prospective or historical study backend.

The original study remains interrupted; pending positions are not fabricated as closed.
A successful controlled test does not resume it or authorize a retry. A future prospective study
requires a new identity and a separately frozen tested commit/configuration. The complete report's
growing historical export remains a separate scalability concern; this repair does not claim to
make that export incremental.
