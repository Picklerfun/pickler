# Perpl transport and availability validation — 2026-10-01

## Result

One ten-minute comparison completed, followed by exactly one thirty-minute acceptance.
REST and WebSocket each achieved 10/10 valid joint BTC/ETH opportunities. The frozen rule
requires WebSocket to **exceed** REST, so `rest-paced-20s-v1` was selected. Acceptance passed
with **30/30** joint cycles, zero missing slots and zero lease/ownership failures. No thresholds,
strategies, prompts or budgets were changed. There were no model calls, buys, or deployments.

| Measure                           | Ten-minute comparison                      | Thirty-minute acceptance                   |
| --------------------------------- | ------------------------------------------ | ------------------------------------------ |
| Frozen commit                     | `01ee0c31e1a11207674f46dc5631bd8efde61ff6` | `01ee0c31e1a11207674f46dc5631bd8efde61ff6` |
| Start UTC                         | 2026-10-01T18:21:10.299000+00:00           | 2026-10-01T18:31:54.461000+00:00           |
| Finish UTC                        | 2026-10-01T18:31:10.364000+00:00           | 2026-10-01T19:01:54.498000+00:00           |
| Valid joint opportunities         | REST 10/10; WS 10/10                       | REST 30/30                                 |
| Successful renewals               | 29                                         | 89                                         |
| Renewal failures                  | 0                                          | 0                                          |
| Recorded PostgreSQL slots         | 10                                         | 30                                         |
| Database status / owner           | completed / released                       | completed / released                       |
| Reader closed                     | yes                                        | yes                                        |
| New model rounds / paper accounts | 0 / 0                                      | 0 / 0                                      |
| Acquisition average / maximum     | 4786.1 / 6691 ms                           | 4759.0 / 8043 ms                           |
| Cycles requiring coherence repair | 1                                          | 4                                          |

The original thirty-second age, five-second future and five-second component-skew controls were
preserved, as were the twenty-second acquisition deadline, twelve-request REST sessions,
one-second request starts and ninety-second lease / twenty-second renewal. PostgreSQL readback
confirmed zero model rounds and zero paper accounts for both independent diagnostic records.
Existing study identities, positions, results, STOP states and reservations were not modified.

## What the evidence shows

WebSocket's average first-valid latency was 341.9 ms, versus 4,780.8 ms for REST. Its initial
connection opportunity took 2,534 ms; warmed opportunities reused the continuously validated
buffer. That is the declared transport comparison, not a claim of equal connection lifecycle cost.
Both first-valid sets were revalidated at a common time; neither received a replacement snapshot
after the other finished. Availability tied, so speed alone did not change the frozen choice.

The continuous capture observed gaps over five seconds between ticker updates while books kept
advancing. During part of the comparison the BTC ticker message gap reached 13,383 ms; repeated
provider timestamps also occurred. A responsive transport therefore does not guarantee a valid
ticker/book pair. This demonstrates the mechanism for component skew in this sample; it does not
prove the precise cause of every earlier incident. REST sampling intervals are not estimates of
the server's publishing cadence. Per-second timestamp granularity can also yield repeated dates
while blocks advance, and is kept separate from regression.

Offline replay reconstructed 6,634 validated public messages, two book snapshots, 2,798 book
updates and 4,816 removed levels without an error. Its capture SHA-256 is
`62f7a6695061504b43cee41b3f8e04637957e5fcb9b8eb0c859e617d2bf243d6`.
The bounded capture was not truncated. The validation did not encounter a public disconnect,
sequence discontinuity, permission revocation, or lease failure; those failure cases were tested
with controlled sockets/clocks and PostgreSQL ownership tests.

After the measured windows, final controlled coverage completed duplicate subscription-ACK
handling, bounded resubscription after a demonstrated heartbeat gap, rejection of unknown
policies, and cancellation of a blocked ownership lookup at the joint deadline. These fault
cases were not encountered in the measured REST window; its successful acquisition path and
recorded inputs remain unchanged. No public measurement was repeated. The measured commit above is intentionally
retained instead of relabeling the run as having tested a later PR documentation/fault-test commit.

## Artifacts

Private workspace outputs, not checked-in generated data:

- `apps/agent-service/.data/perps-studies/transport-20261001-comparison/`: report.json, report.csv,
  report.html, events.jsonl, choice.json, offline-replay.json and database-verification.json.
- `apps/agent-service/.data/perps-studies/stability-20261001-paced-rest/`: report.json, report.csv,
  report.html, events.jsonl and database-verification.json.

Configuration hash: `b1ffa71fcaf9a46288a8f005fb1d349794001dd34c1e30dc63854f22ac291a18`.
Diagnostic study: `transport-20261001T182110193Z`. Acceptance study: `stability-20261001T183154372Z`.
Both reference the existing `perps-lab` mainnet study; no new campaign budget was initialized.
Read [the command and safety guide](PERPL-STREAM-ACQUISITION.md) before any new session.

## Remaining limits

This is one availability sample, not proof that the two-second delay caused the improvement over
an earlier day's run, not uninterrupted multi-day reliability, and not strategy profitability.
WebSocket is implemented and publicly measured, but is not selected for this session. A paid
comparison needs a separately authorized new window, frozen configuration and historical budget
verification. Do not restart any stopped study or automatically repeat acceptance.
