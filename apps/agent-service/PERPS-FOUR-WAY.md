# Four-way Perpl paper comparison

`perps-four-way-v2` is a local, two-hour experiment with eight fifteen-minute slots, BTC and ETH,
and four independent accounts starting with 1,000 virtual AUSD. It does not sign or submit orders.
Use the unified `evaluate` entry point. PostgreSQL tables and public HTTP contracts are unchanged.

## Frozen decision contracts

- `rules`: existing SMA20/50 decisions without models.
- `jev-only`: six independent Choice questions (long support, short support and existing-position
  invalidation for each asset). Exactly one supported direction at selected probability >= 0.70
  opens a position. An existing position closes only when invalidation reaches 0.70. Otherwise hold;
  no within-round reversal. Confidence does not add another decision gate.
- `deepseek-only`: the existing bounded DeepSeek action contract and its own account.
- `deepseek-jev`: a separate DeepSeek proposal using this account, followed by six Jev questions
  about identity, evidence and costs/funding. Only a material contradiction with selected probability
  and confidence both >= 0.90 vetoes that asset. Uncertainty is recorded, not approval.

Jev distributions describe answers to bounded questions, not financial success probabilities.
All arms retain deterministic permissions, execution limits, fees, funding and conservative 1x risk.
Initial evidence is shared. Model arms run concurrently; the combined review follows its proposal.
Every arm, including SMA, waits for one validated final BTC/ETH snapshot. Model request deadlines are
20 seconds; the entire model phase is bounded by 45 seconds. No automatic retry or fallback exists.

## Operator workflow

Prepare a new ignored config using version 2, protocol `perps-four-way-v2`, hours 2 and budgetUsd
`"5"`; retain the original tenant/network/database and verified pricing fields. Session identifiers
must leave room for the `-probe` suffix. Supply `acknowledgedUnknownCalls` only for the expressly
acknowledged historical failed calls: sessionId, roundKey, lane, requestHash and reservationUsd.
Their reservations remain fully charged; their historical cost remains unknown. The store refuses
new unrecognized unknown usage, mismatched acknowledgments and acknowledgments of active owners.

From `apps/agent-service`, with shared packages built:

```sh
node --import tsx src/evaluate.ts prepare --config PATH --env-file ENV
node --import tsx src/evaluate.ts validate --config PATH --env-file ENV --allow-paid
node --import tsx src/evaluate.ts preflight --config PATH --env-file ENV
node --import tsx src/evaluate.ts run --config PATH --env-file ENV --allow-paid
node --import tsx src/evaluate.ts report --config PATH --env-file ENV --output DIRECTORY
```

Use `--acquisition-choice FILE` consistently when pinning the previously accepted REST transport.
`validate` creates a separate `-probe` record and runs exactly three paid synthetic contract checks:
DeepSeek, Jev decision and Jev review. Synthetic data is explicit operator validation, never a live
provider fallback. The flat scenario expects holds and no material review veto. A technical failure
or incompatible decision blocks the real run. Checks cannot be repeated for that session.

All reservations share the original USD 5 campaign ceiling. The cap of 35 admissions covers three
checks plus up to 32 prospective calls; reservations are made together before each round. Estimates,
unknown reservations and virtual AUSD are different measures. Never reset the tenant or database
as a way to admit more calls. CI uses only controlled transports.

## Failure and closure

`active` means decision admission is possible; `closing` means only deterministic virtual exits
and public observations remain. A model timeout, HTTP/transport failure, invalid response or unknown
usage stops new model calls and new openings for every arm. Closure lasts at most fifteen minutes,
finishing early if positions and funding are clear. Completed failures are `interrupted`, not a
healthy continuing comparison. Loss of ownership or persistence failure aborts immediately.

A data-unavailable slot is separately recorded and never recovered. Reports distinguish omissions,
holds, technical failures, pending funding and unresolved positions. The original study is never
rewritten. Report exports are `report.json`, `report.html`, aggregate `report.csv` and `rounds.csv`.
Round JSON includes original proposals, reviews, executable decisions and per-call consumption;
execution events preserve the actual virtual fills. No absent historical arm is reconstructed.

Monitor the process, lease and progress every ten minutes, without provider/model calls or restart.
Notify an interruption once and stop the monitor when the process dies or the study terminates.
Two hours validate the circuit, not profitability; compare only valid common rounds.
