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

At initial PR publication, these changes had controlled-test validation only. They were not injected into the frozen running process. The later explicitly authorized final-code run is recorded below. The same data acquisition thresholds and strategies remain unchanged. Another explicitly authorized thirty-minute window with the lid open is needed to satisfy public acceptance. A new paid comparison remains out of scope and requires its own frozen configuration and historical-budget verification.

## Final controlled verification

Implementation commit `7aaeeb9c11b2b1659c37ad56aa303e0dfa984a0e` passed:

- `npm test`: 1,422 passed, zero failed, one explicitly gated local Workers/Supabase end-to-end test skipped. The PostgreSQL integration tests ran with isolated databases.
- `npm run lint`, `npm run typecheck` (14 workspaces), and `npm run format:check`.
- `npm run build:workers` and `npm run build --workspace=@pickler/agent-service`.
- Controlled total-deadline cancellation at approximately 20 seconds, expiry before commit, delayed DB renewal, synchronous interruption fencing while DB ownership still appears valid, and rejection of late renewal completion.

Read-back after the interrupted public probe confirmed released ownership, zero model rounds, zero paper accounts and sixteen diagnostic events. The incomplete diagnostic record remains `monitoring`; its local report records the terminal failure because the expired owner cannot write a new business outcome. No paid continuation or second public probe was started during the initial delivery.

## Authorized final-code run — 2026-09-29

The user explicitly authorized another public acceptance window. A startup attempt produced zero cycles because Docker Desktop/PostgreSQL was stopped (`ECONNREFUSED` verified separately). Its artifacts remain in `.data/perps-studies/stability-20260929-final`; it was not a completed market-data evaluation. Docker Desktop and the existing `pickler-monorepo-postgres-1` container were started without recreating/resetting the database.

The actual window used frozen commit `6a7057878b162daf724f6107240167b719c90802` and diagnostic identity `stability-20260929T153610445Z`:

| Measurement                                    | Result                                       |
| ---------------------------------------------- | -------------------------------------------- |
| UTC window                                     | 2026-09-29 15:36:10.566 through 16:06:10.587 |
| Scheduled / recorded cycles                    | 30 / 30                                      |
| Joint BTC/ETH valid cycles                     | 18 / 30 (60%)                                |
| Data unavailable                               | 12 consecutive cycles, slots 18–29           |
| Missed cycles                                  | 0                                            |
| Successful renewals / renewal failures         | 89 / 0                                       |
| Maximum renewal timer delay / duration         | 100 ms / 50 ms                               |
| Maximum valid acquisition time                 | 9,515 ms                                     |
| Maximum final component skew in acquired pairs | 4,000 ms                                     |
| Model calls / purchases                        | 0 / 0                                        |
| Acceptance                                     | **Failed: below 29/30**                      |

All twelve failed cycles stopped at the twenty-second acquisition boundary and were recorded as `DATA_UNAVAILABLE`, not strategy abstentions. Their 25 metadata requests recorded one transport failure, twelve timeouts and twelve deadline cancellations, without an HTTP response. The run otherwise recorded 91 HTTP-200 responses. It continued to the next scheduled slot and completed the full fixed window without losing ownership or restarting a failed slot.

Read-back confirmed `completed`, released ownership, thirty diagnostic events, zero model rounds and zero paper accounts for this diagnostic identity. JSON/CSV/HTML and append-only events are preserved under `.data/perps-studies/stability-20260929-final-ready` (ignored by Git). No source study/account/position, strategy, threshold or paid budget was changed.

A separate bounded connectivity check on 2026-09-30 returned HTTP 200 from the Perpl metadata endpoint (2.192 seconds), Perpl homepage (1.975 seconds), and a Cloudflare connectivity control (0.933 seconds). This proves later reachability only. The available historical diagnostics do not distinguish a provider outage from local connectivity/DNS/TLS problems; do not attribute the twelve-cycle failure to either without further evidence.

Continuity and normal lease renewal were observed on the final implementation; public availability did not pass. PR #63 remains draft. No third public window or paid study was started. Before another acceptance attempt, diagnose the transport interruption with safe connection-stage metadata; do not increase deadlines, relax timestamp checks or erase failed cycles to obtain a pass.

## Connection-diagnostic revision and authorized window — 2026-09-30

The subsequent user authorization covered safe connection diagnostics, an independent connectivity
control, controlled tests and exactly one new thirty-minute public window. The frozen code commit
was `485be086a0b906c3b02290550927006f33c5f06f`. Each revision commit changes one file.

Request records now distinguish the observed response-header, response-body and validation phases,
header latency, total duration and allowlisted nested network error codes. Generic timeout or socket
errors do not establish DNS/TLS causality. The control performs one guarded public Cloudflare read
only after an unavailable cycle with request errors; it cannot supply prices or change validity.
Its three-second network deadline is separate from the unchanged acquisition deadline.

Controlled validation passed: 37 focused tests; the full suite passed 1,428 tests with zero failures
and one explicitly gated local Workers/Supabase E2E test skipped. Isolated PostgreSQL tests ran.
Format, lint, typechecks, all Worker builds and the Node/Mastra build passed. Tests cover sanitized
nested/aggregate causes, unknown errors, header versus body failures, control timeout, no retries,
revoked ownership and cancellation. No paid calls occurred.

Diagnostic identity: `stability-20260930T102010101Z`.
Artifacts: `.data/perps-studies/stability-20260930-connectivity/{report.json,report.csv,report.html,events.jsonl}`.

| Measurement                                     | Result                                       |
| ----------------------------------------------- | -------------------------------------------- |
| UTC window                                      | 2026-09-30 10:20:10.272 through 10:50:10.292 |
| Scheduled / recorded cycles                     | 30 / 30                                      |
| Joint BTC/ETH valid                             | **26 / 30 (86.7%)**                          |
| Per-market valid at cycle reference time        | BTC 26/30; ETH 29/30                         |
| Omitted cycles (zero-based slots)               | 3, 7, 12, 18                                 |
| Missed cycles                                   | 0                                            |
| Successful renewals / failures                  | 89 / 0                                       |
| Public requests                                 | 192; all HTTP 200, no transport failures     |
| Maximum acquisition / maximum valid acquisition | 12.874 seconds / 10.991 seconds              |
| Connectivity controls                           | 0; no request failure triggered one          |
| Models, virtual purchases, real orders          | 0 / 0 / 0                                    |
| Acceptance                                      | **Failed: below 29/30**                      |

All four omissions exhausted the unchanged twelve-request session limit while attempting to repair
ticker/book timestamp skew. The observed skew in those slots reached 16, 7, 11 and 6 seconds,
respectively; the allowed maximum remains five seconds. Repeated successful ticker responses
retained the same timestamp during several attempts. Subsequent slots recovered, including a
successful slot that repaired an initial sixteen-second skew to four seconds. This establishes
intermittent temporal incoherence under the current acquisition rules, not a network outage or a
strategy abstention. It does not establish why the provider state timestamps stopped advancing.

Read-back confirmed `completed`, released ownership, thirty events, zero model rounds and zero
paper accounts for this diagnostic identity. No historical study or position was changed. The
process exited normally; no additional window or paid continuation was started.

The historical twelve-cycle transport outage was not reproduced and its cause remains unknown.
The new failure classifier and external control have controlled-test coverage, not live failure
validation in this window. The official [REST documentation](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md)
describes the ticker as the same market state published over WebSocket and each market's `at` as
its own as-of timestamp. Therefore, switching transports alone is not proven to fix this mismatch.
A follow-up should examine source update cadence and acquisition scheduling before choosing a
transport change. Do not relabel received-at time as market time, relax thresholds or rerun a paid
comparison to work around the failed availability criterion. PR #63 remains draft.
