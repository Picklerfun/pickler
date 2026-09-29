# Perpl reliability validation

## Historical incident

The perps-20260929-v2 log ends with `LEASE_LOST: Study ownership expired`. Last reported valid observation: 2026-09-29 05:59:13 UTC; timeout: 05:59:48 UTC. macOS power logs record `Entering Sleep state due to Clamshell Sleep` at 2026-09-29 07:59:42 +0200 (05:59:42 UTC), with a 900-second sleep interval and a maintenance dark wake at 08:14:42 +0200.

A documented system sleep exceeded the 90-second lease by a large margin and coincided with observation ending. This demonstrates an interruption incompatible with continued lease renewal; the old runner did not record its last renewal, so the exact failed renewal/DB instant cannot be reconstructed. The public-data skew incident occurred separately and is not explained away by sleep. No provider, model, price or timestamp is substituted.

## Changes under validation

Joint public acquisition, transient data omission before execution, atomic paper-write fencing by study lease, unchanged lease duration/cadence, and local renewal diagnostics. Historical sessions and monetary budgets are preserved. No trading, paid calls, or deployment is authorized by this validation.

## Acceptance run

The single authorized run started at 2026-09-29 09:54:49.427 UTC and stopped at 10:11:00.353 UTC. It did not complete thirty minutes and was not restarted.

- Frozen public-run commit: `94d6422bfa2fdd530a7ae9811079d79549e4b7ce`.
- Diagnostic identity: `stability-20260929T095449336Z`.
- Local artifacts: `.data/perps-studies/stability-20260929-reliability/report.json`, `report.csv`, `report.html`, and `events.jsonl` (excluded from Git).
- 14 jointly valid cycles out of 30 planned; 2 missed cycles, 1 lease-failed cycle and 13 not reached.
- Longest acquisition: 13,020 ms. Maximum final component skew among acquired pairs: 4,000 ms.
- 83 public HTTP requests, including one after wake; zero model calls and zero purchases. No old study/account/position was modified.
- Acceptance: **failed**, with `LEASE_LOST`. Do not treat the 14 successful cycles as a passed availability test.

The power log records `Clamshell Sleep` at 12:08:15 +0200 (10:08:15 UTC), lasting 153 seconds, then a dark wake at 12:10:48 +0200. The `caffeinate` idle-sleep assertion was active. A later maintenance sleep lasted 329 seconds; lid-open wake occurred at 12:16:26 +0200. Idle-sleep protection cannot override closing the lid.

Last ordinary renewal completed at 10:08:09.782 UTC, with PostgreSQL expiry 10:09:39.776 UTC. After wake, the timer was 140,180 ms late. A renewal returned at host time 10:10:50.008 UTC with reported expiry 10:09:49.785 UTC, already behind host time. This demonstrates a host/database clock discrepancy during wake; the underlying clock synchronization mechanism is not established by these logs. The subsequent guard reported `LEASE_LOST`. Two missed slots and one public request were observed before termination. Therefore, this run does **not** establish the requested zero-resumption guarantee after suspension.

## Corrections after the frozen public run

Additional controlled tests cover expiry immediately before transaction commit, delayed PostgreSQL renewal, and partial observation writes. The final implementation checks elapsed local time since the last successful renewal (or startup) before requests, model admission, execution and diagnostic writes. A gap of 90 seconds aborts locally with `PROCESS_INTERRUPTED`, without attempting renewal; it never extends the PostgreSQL lease or replaces its ownership authority. A pending renewal completing after such an interruption cannot restore liveness. Original errors survive rollback/cleanup failures.

These changes have controlled-test validation only. They were not injected into the frozen running process, and no second public run was made. The same data acquisition thresholds and strategies remain unchanged. Another explicitly authorized thirty-minute window with the lid open is needed to satisfy public acceptance. A new paid comparison remains out of scope and requires its own frozen configuration and historical-budget verification.
