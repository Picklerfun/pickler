# Local universe WebSocket qualification — 2026-10-08

## Result

**Not accepted.** The one authorized qualification terminated after two valid acquisitions.
The remaining 28 scheduled identities were not admitted after interruption. They are not 28
failed network acquisitions. The acceptance threshold remains at least 29/30 complete valid
sets, with no stream validation or ownership failures. No repeat or economic comparison ran.

The diagnostic used clean commit `c6a5cc8217153adbfcc4bc542d87dd541014b43c`, configuration v7,
policy `stream-universe-20s-v1`, and a frozen eleven-market catalog. The independent PostgreSQL
record is `stability7-20261009T024311334`; its source study remains unstarted. The scheduled
window was 21:44–22:14 America/Bogota (02:44–03:14 UTC on 2026-10-09).

| Recorded fact                                                 | Result                                            |
| ------------------------------------------------------------- | ------------------------------------------------- |
| First acquisition, including cold metadata/open/subscriptions | 4,788.801 ms; all 11 valid                        |
| Second acquisition, same reader                               | 1,155.304 ms; all 11 valid                        |
| Successful market captures                                    | 22; 330 scheduled market identities exported      |
| Connection/subscriptions                                      | One connection; 13 subscriptions acknowledged     |
| Unexpected disconnects / ownership failures                   | 0 / 0                                             |
| Validated messages retained                                   | 2,498                                             |
| Retained capture                                              | 1,560,212 bytes; no truncation                    |
| Stop event                                                    | `PERPL_STREAM_MESSAGE_LIMIT`, 21:45:49.172 Bogota |
| Physical socket closure confirmed                             | 21:45:50.621 Bogota                               |
| PostgreSQL owner and expiry released                          | Both null, verified read-only                     |
| New accounts / decision rounds                                | 0 / 0                                             |
| Model calls / tokens / new USD reservations                   | 0 / 0 / 0                                         |

The stop occurred between acquisition slots. Capture and reconstruction bounds deliberately
abort the check rather than discard updates or return a potentially incomplete book. There was
no REST price fallback, deadline extension, threshold relaxation, restart, trading, signing,
deployment or automation.

## What the failure proves

The recorded error originated in the local reader's protection. In the frozen implementation,
that compatibility code covers a non-text message, a message above 2 MiB, or more than 32 pending
messages. The event did not contain the exceeded dimension or its counter. **Which dimension
failed is `NOT_VERIFIABLE`.** This capture cannot establish a Perpl outage or assign the cause
to network, database throughput, or message publication.

The largest retained validated message projection is 8,658 bytes. This does not establish the
size or type of the rejected, unretained message. All 2,498 retained messages replay through the
pure reconstruction without error, but a successful retained-prefix replay does not validate a
rejected update or the interrupted tail. The capture's conservative `reconstructionErrors: 1`
counts the stream protection error; it does not prove that an accepted book was reconstructed
incorrectly.

The frozen host also exposed a demonstrated reporting bug: Node's timer wait rejected with
`AbortError`, and the outer handler replaced the reader's reason with `STABILITY_FAILED`.
The original specific code remains in `stream.errors` and `events.jsonl`. The historical report
is retained unchanged.

## Corrections verified after the check

Controlled regressions now preserve the original cancellation code between slots and include
safe limit dimensions/counters in new errors. Queue and message-size cases retain the same
compatibility code and unchanged 32-message/2-MiB limits. No rejected payload is stored. A burst
of 33 controlled pending messages reports `message-queue`, observed 33, maximum 32; a controlled
2-MiB-plus-one-byte message reports `message-bytes` and its exact size. These are controlled
results, not a reconstruction of the missing historical dimension.

The offline v3 analyzer separately labels attempted acquisitions, missed windows and identities
not admitted after interruption. The correction and analyzer commits are later than the frozen
qualification commit and were not tested against a second public run.

Read-only hashes before and after the check match for all nine existing study documents,
19 paper accounts and 76 decision-round documents. Original unknown charges and reservations
are therefore retained unchanged. The diagnostic has two capture events, no account or decision
round, and terminal status `interrupted` with no owner or expiry.

## Controlled timing comparison

Thirty measurements per transport/scenario use identical controlled price/book inputs: 120 in
total, all yielding eleven valid markets. Simulated scheduling and actual local fixture processing
are different measurements. The wall times below were collected under concurrent validation
workload; they are not Internet latency measurements.

| Scenario | Reader             | n   | Simulated median / p95 (ms) | Fixture wall median / p95 (ms) |
| -------- | ------------------ | --- | --------------------------- | ------------------------------ |
| Cold     | REST coherent v2   | 30  | 12,200 / 12,200             | 64.168 / 190.358               |
| Cold     | Universe stream v1 | 30  | 200 / 200                   | 2.261 / 7.912                  |
| Warm     | REST coherent v2   | 30  | 13,000 / 13,000             | 41.644 / 125.125               |
| Warm     | Universe stream v1 | 30  | 100 / 100                   | 0.677 / 6.283                  |

Controlled percentiles use inclusive linear interpolation; raw repetitions and denominators
are published. The simulated difference demonstrates removing serialized REST price requests
under the injected schedule. It does not prove prospective availability, financial improvement,
or that a Cloudflare host would be faster. Historical public REST captures are not paired controls.

## Local evidence and next decision

All paths below are beneath `apps/agent-service/.data/perps-studies/` in the primary checkout;
private evidence is not committed:

- `perpl-universe-stream-config-20261008/`: frozen configuration and read-only before/after hashes.
- `perpl-universe-stream-qualification-20261008/`: original HTML/CSV/JSON, 330 market rows, snapshots,
  renewal diagnostics, and hashed `events.jsonl`.
- `perpl-universe-stream-audit-20261008/`: offline reconstruction using the frozen analyzer.
- `perpl-universe-stream-controlled-20261008/`: HTML/CSV/JSON and all 120 controlled measurements.

The acceptance failure leaves the six-hour economic comparison blocked by reader availability.
The next decision requires a separate plan to diagnose the bound with the new counters and prove
any throughput correction under the same protections. No successful availability, profitability,
production transport promotion, or Cloudflare performance claim follows from these two cycles.

See [the reader guide](PERPL-UNIVERSE-WEBSOCKET.md) for contracts and reproduction commands.
