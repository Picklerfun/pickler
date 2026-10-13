# PTS captured final execution

## Preserved failure

The local `pts-fast-20261013-control-reads` trial at commit
`475fa615789672dab30f661dcab3dedbdc9bc095` stopped with `STALE_MARKET_DATA`.
It has 48 fully executed rounds, one partially executed round and one omitted slot.
PTS made no fills. SMA confirmed two openings in the partial round before interruption;
those positions remain pending in the original history. Do not resume that trial.

Offline validation of its original final frames at the recorded interruption marker shows a
5,805 ms copied heartbeat age. All ten available markets reject that proof; their native price
timestamps still pass their independent limits. The final set had been valid at copy and at the
two confirmed fills. This proves that a copied proof can expire during serial execution.
The original failure does not contain its exact validation clock or stack, so the replay does
not identify an unrecorded transport phase or the precise original throwing call.

The prior implementation committed each captured fill separately. No historical fill,
position, reservation, policy or result is rewritten by this repair.

## Bounded final phase

The optional business port `PerpsPaperRepository.withCapturedFrames` is restricted to local
PTS v8/v9 accounts with an explicit component-paper policy and bound study owner. The existing
profile runner uses it for the final phase only. Both accounts receive the exact same copied
frames; no heartbeat timestamp, price, candle, threshold or risk parameter is changed.

Infrastructure locks the study and both accounts in deterministic order. Inside that boundary,
the existing coordinator applies common marks, compulsory maintenance, final gates and fills.
Final gates and financial execution events use the same database client. The existing financial
functions retain admission, exact decimal accounting, fees, funding, setup consumption, partial
targets and stop semantics.

Account views and the trusted study record are retained only while those rows are locked.
Returned views are copies. Every child operation rechecks current ownership; the whole original
frame set is validated before execution and immediately before commit. Child operations use
savepoints so a permitted risk/depth refusal has the same effect as before without retaining a
provisional admission.

A confirmed full rollback caused by native/heartbeat aging becomes
`skipped_data_unavailable`, with safe original validation details. This describes only the final
phase; earlier committed observations or exits remain recorded. Identity, schema, permissions,
ownership, persistence failure and uncertain commit remain fatal. A failure after successful
commit but before execution-status persistence still requires reconciliation.

The completion event `perps-captured-execution-v1` contains the evidence digest and both account
identities. Concurrent identical keys replay completion with current account views, without fills
or callback execution. Changed evidence under the same key is rejected. Previously persisted serial final
gates without a batch completion marker are not resumable through this port.

The scoped context permits only account reads, common valuation, captured fills and allowlisted
execution events. It rejects overlapping financial operations and use after callback completion.
Pending work is drained before the outer rollback releases its client. Historical, Studio and
noncomponent execution paths retain their existing lifecycle.

## Verification and limits

The PostgreSQL tests use a separate disposable local server, never the physical server holding
the prospective campaign. Controlled scenarios demonstrate long and short PTS openings, all
three partial targets, setup preservation, a 5,805 ms expiry after two provisional SMA shorts,
joint rollback, rejected-admission savepoints, concurrent replay, changed inputs and owner expiry.

Validation on 2026-10-13 passed 47 controlled PostgreSQL/compatibility tests and 25 offline tests.
Repository formatting, lint, architecture, all 17 workspace type checks, shared/Node builds and
all four backend Worker dry builds plus the web Worker build passed. CI and new prospective
execution are separate from these local checks. Existing paired thirty-sample v7 benchmarks
remain regression checks, not performance measurements of this new v8/v9 batch.

These fixtures prove the circuit, not market profitability. A no-trade PTS result is zero
activity, not a profitable strategy. Positive recorded SMA results with pending positions are
not a final portfolio return. New prospective testing requires a clean frozen implementation
and a separately prepared fixed window; it cannot resume an interrupted record.

See [intraday PTS](PTS-INTRADAY-PAPER.md),
[fast intraday PTS](PTS-INTRADAY-FAST.md) and
[study control reads](PTS-STUDY-CONTROL-READS.md).
