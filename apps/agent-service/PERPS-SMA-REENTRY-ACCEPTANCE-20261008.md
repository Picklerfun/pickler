# SMA continuity and hourly reopening acceptance — 2026-10-08

The implementation and controlled execution checks are delivered in
[PR #121](https://github.com/Picklerfun/pickler/pull/121), based on the still-open
[PR #114](https://github.com/Picklerfun/pickler/pull/114). Neither PR is merged by this delivery.
The single public qualification **failed: 15/30 complete eleven-market captures**, below 29/30.
Consequently, **the six-hour comparison was not started**. There is no new economic result,
profitability evidence, automatic repeat, model call, real order, deployment or monitor.

## Frozen public evidence

The public capture used clean commit `a6a9f54fa5272e1101834d3de02f3ef14c03bd64` in
`/private/tmp/pickler-sma-latency-reentry`. Subsequent delivery changes add ledger-based economic
reporting and its controlled tests; they do not change the captured data or turn the failed
qualification into acceptance. A future run cannot reuse this failed proof.

The fixed capture window was 2026-10-08 21:10:00–21:40:00 UTC (16:10–16:40 America/Bogota).
All thirty scheduled cycles were recorded, without recovery or extension. The diagnostic has its
own PostgreSQL record and does not create paper accounts or execute trades. The separately
prepared comparison remains `initialized`, with no start date, rounds, positions or attempts and
two untouched 1,000 virtual AUSD accounts. Pending economics is not a zero-return observation.

| Capture result                                       |                Observed |               Required |
| ---------------------------------------------------- | ----------------------: | ---------------------: |
| Complete eleven-market cycles                        |                   15/30 |         At least 29/30 |
| Valid individual market captures at the common clock |                 301/330 | Joint acceptance above |
| Data-unavailable cycles                              |                      15 |            At most one |
| Missed scheduled cycles                              |                       0 |            No recovery |
| Ownership/permission failures                        |                       0 |                      0 |
| Successful lease renewals                            |                      92 |   Continuous ownership |
| Lease release and cleared expiry                     | Confirmed in PostgreSQL |               Required |
| New model calls/tokens/reserves/API USD              |                 0/0/0/0 |                      0 |

| Market | Valid captures |
| ------ | -------------: |
| BTC    |          24/30 |
| MON    |          28/30 |
| ETH    |          29/30 |
| SOL    |          29/30 |
| HYPE   |          26/30 |
| ZEC    |          29/30 |
| LIT    |          30/30 |
| VVV    |          30/30 |
| PUMP   |          27/30 |
| NEAR   |          27/30 |
| UNI    |          22/30 |

The 505 recorded request diagnostics contain 501 HTTP 200 responses and four cancellations at the
joint deadline: one in the request queue and three while awaiting response headers. No HTTP
400/429 was recorded in this capture. The acquisition attempts include 112 incoherence checks
and three freshness checks, in addition to 301 valid checks. These are **attempt counts**, not
independent causes or additional failed cycles. The raw diagnostics retain original component
timestamps and skews; several ticker/book pairs remained more than five seconds apart despite
bounded public refreshes. Missing final components remain unavailable.

The acquisition median was 19,990.748 ms and p95 20,044.899 ms, including final validation and
cancellation bookkeeping. The largest successful lease-renewal duration was 26.301 ms. The
twenty-second acquisition, thirty-second age and five-second advance/skew controls were not
relaxed. Timestamp repetition is observed evidence; internal provider caching or publication
causes are not demonstrated. No DNS, TLS or server cause is inferred from a cancellation.

Read-only PostgreSQL verification at 21:51:22 UTC confirmed null owner and expiry for both
`sma-reentry-latency-20261008` and diagnostic `stability7-20261008T210917388`. The latter's existing
terminal representation is `interrupted` with `DIAGNOSTIC_ONLY`; the local qualification has
`error: null`, zero ownership failures and all thirty cycles. That administrative diagnostic state
does not mean a lease loss or process crash. Cleanup completed and the CLI exited with the
explicit `STABILITY_NOT_ACCEPTED` result. No historical state was rewritten.

## Controlled evidence

The initial relevant suite passed 441 controlled tests, including isolated PostgreSQL tests.
After the final economic-report extension, the focused 38-test suite passed with zero failures;
it includes the five new ledger-report cases and is not added to 441 as an independent total.
Controlled fixtures demonstrate confirmed opens and closes, independent portfolios, final-frame
parity, price-exit priority, unknown-funding preservation, immutable policies, transactional key
consumption, rollback, concurrency, idempotency and ownership rejection. These are not actual
decisions or exits from the unstarted public comparison.

The offline benchmark uses historical export payload hash
`f02793ae734902e322b310cf42ab559f4dff463f354a73d89416b96cb8e4ac18`, whose executed source commit is
`7c87ed691bca3ecb567de4a5b2580f965f8791ca`. PR #114's later fixes were not the code executing that
historical study. Thirty paired samples per scenario retained identical financial outputs.

| Controlled scenario                                                | Before median / p95 ms | After median / p95 ms |
| ------------------------------------------------------------------ | ---------------------: | --------------------: |
| Existing financial functions                                       |        0.0237 / 0.1769 |       0.0228 / 0.0819 |
| Price maintenance with injected 10 ms candle + 10 ms funding waits |      22.5020 / 26.7121 |       0.1266 / 0.2998 |
| Injected 20 ms report work on the critical path                    |      21.1830 / 21.7396 |       0.0588 / 0.2455 |
| Identical injected 5 ms query delay                                |        5.7206 / 5.9052 |       5.7248 / 8.9485 |

The last scenario flags a regression, rather than claiming PostgreSQL became faster. Thirty
controlled minute-overrun cases changed the next dispatch wait from 55,100 ms to 1 ms while
retaining durable slot admission. Injected delays test ordering and overhead, not actual
historical transport acceleration or economic causality. Both comparison portfolios would use
the improved executor; a future P&L difference would measure reopening, not latency.

Formatting, lint, architecture, affected types, Node compilation and Worker dry-run bundles were
checked. Tests and builds make no paid calls or deployments. The first rendered-design CI run
could not find the `/studio?section=brief` route marker; no web or design source is changed by this
PR. That separate CI gate is not silently counted as passed. The PR records its latest outcome.

## Inspectable artifacts and integrity

All local artifacts are ignored, private data under
`/Users/gilbertsahumada/projects/pickler-monorepo/apps/agent-service/.data/perps-studies/`.
The dedicated database-only environment file is never included in the reports or committed.

| Artifact                                   | Relative directory/file                                   | SHA-256 of file bytes                                              |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Capture JSON; CSV and HTML beside it       | `sma-reentry-capture-20261008/report.json`                | `c9f38902913680f2422fc69e71b50b9a4e5c44264a46695c25183df9157456cc` |
| Controlled timings; CSV and HTML beside it | `sma-reentry-timing-acceptance-20261008/timing.json`      | `3f5e3ebd78b110f201432ba9d0fe26165a3931cdc7eea2c50f7258ee2d9c499e` |
| Read-only export of unstarted comparison   | `sma-reentry-unstarted-export-20261008/audit-export.json` | `d833d169fe5223b43897827abb1ffc5b028d508846595736b53b03593d505816` |
| Exact prepared configuration               | `sma-reentry-latency-20261008/study.json`                 | `dddd5052f021dd1ac52ef43e16400d9af776594103a11f8fbbd54fce58141f57` |

The qualification's canonical configuration hash is
`235771e892e177c8cf3af496fbb8e1637895e713c570970d440277fd57fe951c`.
The unstarted export's canonical payload hash is
`adb4ac3d2ac43e3aa2078815099ae7e029b949adeb24ba44d3ab0782b943581a`.
The consolidated local `sma-reentry-acceptance-20261008` directory links these sources and contains
the resource-release proof plus a reproducible offline summary in HTML, CSV and JSON.

## Remaining acceptance

The economic phase and its 69/72 rounds, 753/792 common asset-slots, 342/360 valued observations,
held-minute coverage and exit-servicing criteria remain **not evaluated**, not passed. No live
position was available to certify stop servicing, and no actual reference winner or loser was
blocked by the new rule in this delivery. API cost is zero and no AUSD/USD equivalence is used.

The data-capture failure needs a separately reviewed acquisition correction or experimental
design before another public qualification. This delivery does not authorize repetition, relaxed
thresholds, replacing absent markets, changed strategies, or starting the six-hour comparison
despite failed qualification. Preserve the evidence and frozen parameters for that diagnosis.
