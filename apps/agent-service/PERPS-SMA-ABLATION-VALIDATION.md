# SMA ablation validation record

## Controlled verification

- Repository regression suite with isolated PostgreSQL: 2,790 passed, one skipped,
  zero failures (2,791 discovered). No paid provider calls.
- Final targeted SMA, multiframe, historical study and audit regressions: 48 passed.
- Nine SMA-specific cases cover activity ablation, exact trend threshold, zero momentum,
  shared final validation, independent long/short fills and thirty-minute exits, durable missed
  slots, post-expiry ownership rejection, no model access, forbidden paid lanes/environment
  fields, deterministic safe reports and unknown funding.
- Root type checking: all 17 workspaces passed. Agent-service type checking repeated after
  the final host safeguards.
- Root lint and Prettier checks passed; architecture/link checks passed.
- Shared package compilation, Node Mastra build and local Worker dry-run builds passed.
  These are local builds, not deployments or remote acceptance.

The PostgreSQL coordinator scenarios use controlled providers and clocks. They prove virtual
execution mechanics, not decisions observed on live markets. Historical strategy gates and
model request fingerprints remain covered by the unchanged compatibility suites.

## Prospective experiment

Exactly one six-hour run is authorized under `perps-sma-ablation-v1`, with frozen commit and
configuration, 24 slots, three independent accounts and zero permitted model calls. Its result
is stored locally in a new study directory; no historical study is rewritten. Initial reports
are provisional until the runner terminates and positions/funding are reconciled or explicitly
pending. Do not describe launch, continuity or controlled fills as a completed live comparison.

The runner regenerates JSON, CSV and HTML locally. Inspect its persisted status, local process
state/errors, missed/omitted slots and unknown funding before drawing a conclusion. Any outcome,
including no openings, is valid; no automatic repeat or parameter adjustment is authorized.

## Interrupted first prospective attempt

The only authorized attempt, `perps-sma-20261004-2350`, used original frozen commit
`2742f5ae8477f84177371a377fe74b4e2d7e6c9c`. It began its first slot at
2026-10-05T00:01:00Z. The hourly arm proposed long BTC and ETH; both were rejected with
`DAY_BASELINE_PENDING`. Both directional arms held because `DIRECTION_NOT_CONFIRMED`.
There were zero virtual fills and zero model calls/reservations. The operator stop preserved
the first slot and terminated the process; it is not a completed six-hour comparison.

The demonstrated cause is the preparation-to-start gap spanning UTC midnight without any
pre-midnight valuation. The original daily-risk rule correctly rejected an unverifiable
baseline. The correction samples before admission and fails closed if the baseline remains
pending, without changing SMA, costs, risk limits, budgets or historical records. Twelve
SMA-specific controlled cases now include this reproduction, the full real coordinator and
heartbeat with a controlled clock, and terminal admission rejection. A new prospective run
requires separate authorization; no automatic repetition or historical restart occurred.

Post-correction repository suite: 2,795 passed, one skipped, zero failed (2,796 discovered).
All 17 workspace type checks and Node/Worker builds passed again. The new traces exclude
disabled checks from coincident rejection counts; the original stored trace retains its
explicit `enforced` flags and is not rewritten. No live repetition has been started.
