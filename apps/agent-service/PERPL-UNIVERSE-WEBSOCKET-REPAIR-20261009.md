# Eleven-market stream repair: technical continuity and failed availability

The local reader completed the 2026-10-09 repair measurement without a queue, reconstruction,
permission, or ownership failure. It did **not** pass availability: 17 of 30 joint cycles were
valid, below the unchanged 29/30 requirement. No economic comparison is enabled by this result.

## Frozen execution and scope

- Reader commit: `28d2b854684e3d6366fb2738bbd4873bc6d3e72c`.
- Adapter: `public-universe-stream-v3`; acquisition: `stream-universe-20s-v1`.
- Fixed window: 2026-10-09 04:28:00–04:58:00 UTC, thirty scheduled one-minute slots.
- Original twenty-second acquisition, thirty-second age, and five-second future/skew controls.
- One local public connection, thirteen acknowledged subscriptions, no REST price fallback.
- Independent PostgreSQL diagnostic record; no accounts, positions, decision rounds, models,
  signing, new monetary reservations, automation, merge, or deployment.

The operator separately authorized further local reader repair and verification. Every attempt
has a new directory. The original qualification and all later failed captures remain unchanged.

## Demonstrated client failure and repair

The v2 repair qualification at commit `75ff443886282d624bb7661ef3cea670449ba879` reproduced
`PERPL_STREAM_MESSAGE_LIMIT` with `component: message-queue`, `observed: 33`, `maximum: 32`.
It had received 11,832 messages and applied 11,800. Live database checks stalled a bounded
receive queue. Guarded batching reduced checks but did not eliminate that bottleneck.

V3 reconstructs public messages synchronously in a native-private replica. All existing wire,
identity, ordering, message-size, and book-state checks remain. Fresh ownership and permission
checks still gate connection, requests, and every delivered buffer; an idle guard also closes
a revoked reader. Reconstruction grants no authority to write financial records. Cancellation
and generation changes reject access and close transport without waiting for blocked SQL.

Repeated v2 subscriptions returned acknowledgements without new book snapshots. V3 no longer
sends those redundant requests. Neither acknowledgements nor heartbeats refresh component dates.

The exceeded dimension in the original 2026-10-08 capture was not recorded. The new queue
reproduction does not retrospectively prove that original failure had the same dimension.

## Thirty-minute result

| Measurement                                          | Observed result                            |
| ---------------------------------------------------- | ------------------------------------------ |
| Scheduled / attempted / missed slots                 | 30 / 30 / 0                                |
| Valid joint cycles                                   | 17/30; acceptance requires 29/30           |
| Valid market captures                                | 292/330                                    |
| Data-unavailable cycles                              | 13                                         |
| Invalid market captures                              | 38: 36 inconsistent-date, 2 stale-data     |
| Received / processed public messages                 | 38,216 / 38,216                            |
| Connections / unexpected disconnects                 | 1 / 0                                      |
| Receive queue peak                                   | 1 message                                  |
| Subscription requests / refresh requests             | 1 / 0                                      |
| Reconstruction / permission / ownership failures     | 0 / 0 / 0                                  |
| Successful / failed renewals                         | 90 / 0                                     |
| Socket and reader closed / PostgreSQL lease released | Confirmed / confirmed                      |
| Successful acquisition latency                       | Median 1,147.58 ms; p95 19,928.09 ms; n=17 |
| Capture bytes / truncation                           | 21,279,933 / none; 32 MiB ceiling          |
| Model calls / tokens / USD cost / new reserves       | 0 / 0 / 0 / 0                              |

The recorded primary technical error is null. The CLI exits with `STABILITY_NOT_ACCEPTED`
because availability failed. That exit does not indicate a new transport failure. All thirteen
unavailable acquisitions exhausted their fixed twenty-second deadline; they are not holds.

| Market | Valid captures | Invalid captures | Maximum recorded ticker/book skew |
| ------ | -------------- | ---------------- | --------------------------------- |
| BTC    | 23/30          | 7                | 15 seconds                        |
| MON    | 25/30          | 5                | 38 seconds                        |
| ETH    | 29/30          | 1                | 8 seconds                         |
| SOL    | 27/30          | 3                | 13 seconds                        |
| HYPE   | 22/30          | 8                | 22 seconds                        |
| ZEC    | 26/30          | 4                | 31 seconds                        |
| LIT    | 30/30          | 0                | 5 seconds                         |
| VVV    | 28/30          | 2                | 6 seconds                         |
| PUMP   | 26/30          | 4                | 16 seconds                        |
| NEAR   | 30/30          | 0                | 3 seconds                         |
| UNI    | 26/30          | 4                | 20 seconds                        |

These terminal per-market observations are not independent joint successes. Any invalid market
prevents a common executable set for that slot; component successes at different instants are
not combined into a fabricated joint capture.

## Provenance and limits of attribution

The existing offline auditor verified configuration, catalog, snapshot, and capture hashes and
replayed all 38,216 retained validated messages through the existing pure reconstruction. There
is no truncated tail. A separate date inspection matched all 330 recorded ticker/book date pairs
to the original messages available at their buffer-copy times, including all 38 invalid pairs.

For example, slot 15 recorded ZEC ticker time `1791520966000` and book time `1791520997000`, a
31-second difference. The retained public market-state message already carried that ticker time.
This difference was not introduced by unit conversion or the former database receive queue.
The observation does not establish why the provider published those components at those times,
whether an unchanged older value remained economically current, or the internal provider cause.

Offline replay also inspected intermediate states within the failed acquisition windows using
the existing business validation. Eleven failed slots had no joint-valid intermediate candidate
among the retained events. Slot 5 had three candidates within one clock millisecond, with no
resolvable positive duration; slot 13 had five candidates spanning five milliseconds. None was
an owned, delivered snapshot. These are sampling diagnostics, not upgraded historical successes
or proof that reducing polling delay would make this sample reach 29/30. They must not be hidden
when discussing availability or attributed solely to a provider failure.

Some terminal invalid-market receipt/block columns remain null in the frozen report because the
exporter projected those fields only from valid frames. The public capture and derived date proof
retain their provenance. The missing historical columns are not silently backfilled.

## Controlled verification

Under identical fixture data and an injected database delay, thirty paired bursts preserved exact
normalized books and component dates. Per-message processing used 33 guard checks per burst;
direct reconstruction used three. Median measured fixture time decreased from 42.93 to 4.73 ms;
p95 decreased from 64.48 to 9.95 ms; queue peak decreased from 30 to one. These are controlled
wall times, not public-network latency or an economic effect.

Regressions cover one thousand ordered updates during blocked SQL, no lost delta, no delivered
buffer before live ownership verification, cancellation, lease loss, and legacy compatibility.
Before the public measurement, 65 focused reader tests and the root PostgreSQL-backed suite
passed: 2,956 passes, zero failures, three skips. Format, lint, type checks, architecture, shared
builds, Node host build, and Workers dry-run builds also passed. No provider is called in CI.

## Local artifacts and reproduction

All directories below are under `apps/agent-service/.data/perps-studies/` in the main checkout,
not the managed repair checkout. They remain local and untracked:

- `perpl-universe-stream-direct-qualification-20261009`: original JSON/CSV/HTML and public capture.
- `perpl-universe-stream-direct-audit-20261009`: hash-verified offline report, CSV, and JSON.
- `perpl-universe-stream-direct-date-proof-20261009`: derived native-date and intermediate-window
  inspections, plus an independent repeatable-read, read-only PostgreSQL cleanup/isolation proof.
- `perpl-universe-stream-direct-benchmark-20261009`: thirty paired controlled measurements.
- `perpl-universe-stream-repair-qualification-20261009`: immutable reproduced queue-limit failure.

The canonical offline audit is reproducible from the frozen reader checkout, without an
environment file, database, provider, or model:

```sh
node --import tsx src/evaluate.ts reader-audit \
  --state /absolute/path/to/perpl-universe-stream-direct-qualification-20261009/report.json \
  --output /absolute/path/to/new-offline-audit-directory
```

## Remaining decision

Technical continuity is demonstrated for this thirty-minute capture; the availability gate is
not satisfied. The six-hour economic comparison remains blocked. Before changing data
eligibility, review the semantics and evidence requirements of a separately versioned stream
policy with the operator. Do not change the five-second rule, rewrite dates, select old matching
components, or start another unchanged qualification to seek a pass. Strategy and financial
behavior remain unchanged. This result establishes neither profitability nor Cloudflare speed.
