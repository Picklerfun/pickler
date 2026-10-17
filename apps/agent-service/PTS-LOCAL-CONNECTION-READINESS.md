# Local PTS connection readiness

## Original evidence and limits

The independent `pts-fast-20261013-final-batch` attempt froze commit
`1fde9ac36a3669d3a3dbb60a39f65f3910119023`. Its first slot was omitted after
confirmed full final-phase rollback: a copied heartbeat was 5,386 ms old at receipt validation.
Both accounts remained at 1,000 virtual AUSD with zero attempts, fills, fees or model calls.

The foreground process exited with code 1 at 2026-10-13T12:47:21.515Z. Its specific error was
`PERSISTENCE_CONNECTION_TIMEOUT`: a new client exhausted 10,004.287 ms. The driver's branch
was `new-client`, not `pool-queue`; recorded capacity was two clients, zero idle/waiting and a
limit of four. Successful retained operations also had long tails: median 1.058 ms, p95
2,241.810 ms and maximum 7,793.520 ms among 127 retained successes. The snapshot is truncated;
these denominators do not describe the full run.

The matching active SELECT fingerprint identifies the existing study permission read. Empty
container logs in the failure window and a currently running container do not identify the
failed socket phase or prove historical server health. TCP, authentication, protocol readiness
and event-loop causes are NOT_VERIFIABLE in that attempt. Do not attribute the failure to
Perpl, pool exhaustion or a specific network/server cause without additional evidence.

The original database row can retain a running projection and expired owner after failed
release. The new terminal report keeps that source state and separately declares process
interruption using its terminal record and absent PID. No recovery, retry, budget reset,
hypothetical fill or historical status rewrite is authorized.

## Pre-admission readiness

The restricted infrastructure `/perps-lab` export adds `warmLocalPerpsLabStore`. Only stores
created for local execution can use it. It holds and verifies four separate clients in
read-only transactions before study claim, then releases them to the existing pool.

Execution retains those four clients across the unchanged 30-second idle timeout. Maximum
capacity remains four execution plus one report connection; both 10-second deadlines remain
unchanged. Legacy construction, report-only and hosted pools retain their behavior. This
removes ordinary idle-driven cold connection creation from the admitted execution path; it
does not guarantee that an existing connection cannot fail.

Readiness failures preserve their specific error, discard partial acquisition and do not
start the financial calendar. Cancellation and cleanup remain explicit. Readiness is not an
ownership grant or a cached permission result; every existing financial fence remains.

The local PTS host performs this check for preflight and one-shot run before admission.
Preflight publishes the versioned readiness record alongside its original evidence.
No provider, model, signer, financial transition or strategy parameter belongs in this check.

## Captured-record reuse

Within the existing final PTS transaction, both account policy checks reuse the one trusted
study record already read under the study lock. Account/agent locks and fresh owner checks
remain. There is no cross-transaction configuration or permission cache. Common final input,
original timestamps, heartbeat/native limits and all financial functions stay unchanged.

## Passive connection and host evidence

Local composition can observe the installed driver's original client lifecycle without overriding
connection, query or authentication behavior. Version 1 phases are `created`, `socket-connected`,
`authentication-observed`, `protocol-ready`, `transport-error` and `closed`. Authentication observed
includes the protocol's trust acknowledgement; it is not a claim that credentials were requested.
Record only local dates, monotonic elapsed time, workload/client identity, known backend PID and
allowlisted driver codes. Addresses, credentials, authentication bodies, backend secrets, SQL and
error messages are excluded. Observer and metadata-access failures cannot alter driver outcomes.

The host retains the latest 64 connection events, declares truncation and preserves its separate
first query failure. It publishes this evidence alongside the existing query diagnostic on
completion or interruption. No historical missing phase is reconstructed.

Run-only event-loop diagnostic version 1 uses an unreferenced one-second timer and a bounded
64-sample record. It measures timer lateness, elapsed time, process CPU deltas and RSS, separately
from financial/market clocks. A snapshot also measures the pending timer before it fires; stopping
clears it and freezes that final sample. CPU is process-wide, including other threads, and neither
timer delay nor CPU alone identifies a socket, server or market-data cause. Default deadlines and
calendar timing are unchanged; test-only short intervals are not runtime configuration.

## Verification

Controlled tests use the separate disposable PostgreSQL server and synthetic loopback sockets,
never the physical server holding historical/prospective studies. They cover four-client
readiness, idle retention, unchanged capacity/deadlines, read-only inspection, cancellation,
legacy/report rejection, stalled startup and cleanup. Financial compatibility and protected
record reuse must also pass before freezing another public attempt.
Connection tests distinguish a real isolated PostgreSQL handshake from a controlled socket that
never authenticates. Host tests cover delayed timers before callbacks, immutable bounded records
and cleanup. Neither synthetic failure proves the unrecorded historical cause.

The selected persistence/financial run verified 74 existing/new regressions, including the full
controlled six-hour coordinator, partials, shorts, unknown reservations, ownership failures and
captured-record reuse. Its three connection lifecycle tests were rerun successfully after fixing
the test's synchronization with individual socket-end events; pool removal finishes earlier.
Twenty-one pure diagnostic/financial/fast-signal checks also passed. These results are controlled
tests, separate from public continuity and economic acceptance.

## Signal evidence is separate from persistence

The preserved `pts-fast-20261013-control-reads` terminal report contains 48 common completed
rounds across ten eligible markets. All 480 original PTS traces stopped at `HOURLY_ALIGNMENT`:
their native 4h primary trend was long, while 1h channel trend was short in 279 evaluations and
neutral in 201. This is the saved policy's explicit alignment gate, not a missing short executor.
The coordinator and PostgreSQL tests cover actual controlled long and short fills. Readiness
does not change these signals, thresholds or their historical decisions, and these abstentions
do not establish profitability.

This is an execution mitigation, not proof of the unrecorded socket cause or profitable PTS.
The failed attempt remains frozen. No public trial is started by this change.
