# Lean study control reads and the preserved paper interruption

## Original outcome and diagnostic limits

The frozen local study `pts-fast-20261012-page-bounds`, commit
`6b9bbc781ce4b859cb53da5497178d7c6e626606`, exited with code 1 at
2026-10-13T05:27:01.958Z. PostgreSQL persisted `interrupted` with
`PERSISTENCE_QUERY_TIMEOUT`; a subsequent read-only inspection confirmed released ownership
and 100 completed, fully executed rounds. No restart or recovery is part of this repair.

PTS had no fills or positions and 1,000 virtual AUSD in cash. SMA had 33 fills, a recorded
realized net result of -29.195922 virtual AUSD, and three pending short positions: PUMP,
LIT and MON. Its final marked equity was not verifiable. The terminal report preserves those
positions, original funding state, configurations, signals and historical monetary reservations.
Zero model calls means zero new model costs, not a profitable PTS result.

The first financial query identified the full scoped study read by static SQL SHA-256
`2532c1f62163611849809f3f222077fee437175bffe8e760e8780fbc8d8c940d`:
backend 9634, SQLSTATE 57014, observed client duration 20,576.72 ms.
A second financial query used the same full read with `FOR UPDATE`, hash
`89bc5be8e73207146e3561fb277d00b1ba526b7c1de8b47ee2cef304dab2a171`,
backend 9598, duration 20,247.92 ms. The report worker timed out on the already materialized
event-fingerprint page, hash
`14f4f2acd8cdf057c7bb575515f2929069353d6b848e20ee707f2f60db0b7e17`,
backend 9637, duration 24,667.39 ms.

The financial pool recorded no waiting checkouts. Even its preceding read-only and write
`BEGIN` responses took 2.84 and 3.69 seconds. Server logs confirm three statement timeouts.
The checkpoint visible in the inspected window started after those timeouts, and the matching
macOS power log contains no sleep/wake event. These facts do not establish the original wait
type, blocker, CPU, disk or virtual-machine cause. Neither database counters read later nor
the absence of a logged sleep is a retrospective causal trace.

The database was PostgreSQL 17.6 with `log_lock_waits=off` and `track_io_timing=off`.
The existing statement timeout remains ten seconds. Observed client durations include driver
delivery and local scheduling; they are not a changed server timeout. All three failed
backends were absent on the later read-only inspection.

## Demonstrated avoidable control payload

The original study document serialized to 372,390 UTF-8 bytes; 370,954 bytes belonged to
`metadata`. Permission guards transferred and decoded this metadata even though they never
use it. Lease renewal transferred the full document despite requiring only identity,
owner, expiry and the database clock.

The permission guard now removes only the metadata key in its PostgreSQL projection. Every
other control field, including current configuration, agent IDs/versions and paid-stop fields,
retains its original JSON value and missing-field behavior. The guard still performs current
agent checks and uses a read-committed read-only transaction with a final fresh ownership
and liveness fence. No permission result is cached.

Renewal selects only identity/ownership fields under the same scoped `FOR UPDATE` lock.
It retains its 90-second duration, database clock, active-lease checks, final commit fence and
rollback semantics. It does not silently renew an expired or changed owner, mutate the study
document, or add a new permission policy. All financial mutations and full views/audit exports
keep their existing document reads. Other APIs, account policies, strategies, deadlines and
schemas are unchanged.

This reduces a demonstrated unnecessary transfer. It does **not** prove that the metadata
caused the original simultaneous timeouts or that the failure cannot recur.

## Controlled evidence and checks

The source-query benchmark uses a fresh disposable PostgreSQL database on the dedicated test
server, never the original financial server. It extracts the original and proposed SQL literals
from their respective TypeScript source files and records source/query hashes. Each scenario
uses 30 pairs, alternating query order over the same repeatable-read inputs. Original/proposed
control fields match in every pair. Metadata scenarios are empty, 372,390 synthetic bytes and
2 MiB of synthetic bytes. They are controlled fixtures, not prospective market evidence.

Private benchmark JSON retains all monotonic durations, median, nearest-rank p95, returned
byte counts and denominator. Query timings include driver transfer/decoding; they exclude
public data, complete guard transactions, report rendering and financial profitability.
Small-input timing differences and unchanged report work remain visible rather than being
reported as universal acceleration.
The exact source-literal measurements recorded for this repair are:

| Metadata bytes | Read    | Pairs | Original median ms | Projected median ms | Original p95 ms | Projected p95 ms | Original returned bytes | Projected returned bytes |
| -------------- | ------- | ----- | ------------------ | ------------------- | --------------- | ---------------- | ----------------------- | ------------------------ |
| 0              | guard   | 30    | 0.420              | 0.445               | 0.545           | 0.541            | 1471                    | 1412                     |
| 0              | renewal | 30    | 0.423              | 0.393               | 0.521           | 0.461            | 1471                    | 123                      |
| 372390         | guard   | 30    | 3.820              | 0.861               | 9.761           | 1.296            | 373861                  | 1412                     |
| 372390         | renewal | 30    | 3.560              | 0.600               | 7.916           | 1.804            | 373861                  | 123                      |
| 2097152        | guard   | 30    | 18.251             | 2.299               | 33.559          | 5.574            | 2098623                 | 1412                     |
| 2097152        | renewal | 30    | 18.915             | 0.885               | 31.122          | 2.208            | 2098623                 | 123                      |

Each path has thirty measured queries per scenario: 360 queries across all scenarios and paths.
The empty-metadata guard median increased from 0.420 to 0.445 ms; that small regression is
retained. The large-metadata improvements do not guarantee lower latency under every workload.
Original and proposed SQL hashes remain separate from source-file and financial-evidence hashes.

`packages/infrastructure/test/perps-study-control-reads.test.ts` verifies metadata exclusion,
unchanged original exports, historical paid admission, paper-only denial, current configuration
and plugin checks, pause, missing scope, expiry, wrong ownership, cancellation after renewal
updates, rollback and specific statement-timeout classification. The existing read-isolation
suite retains its concurrent renewal, changed-owner, snapshot, unknown-attempt and financial
compatibility checks; its gate recognizes either full or projected document reads.

All PostgreSQL checks must use the isolated controlled server. No provider, model, signer,
prospective run, original-history mutation, timeout increase or budget reset is authorized by
this repair. Frozen worktrees and the interrupted trial remain intact. Any later public trial
requires its own frozen, explicitly authorized attempt.
