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

## Operator position persistence regression

The corrected startup attempt `perps-sma-20261005-0053` stopped on its first BTC opening.
Offline replay of its saved execution frame produced a valid fill. Read-only schema inspection
showed the laboratory database retained the original five position columns, while shared
persistence attempted to write eight Studio-only columns. No fill or model charge occurred.
Operator persistence now writes only the historical columns; product sessions retain their
extended schema contract. This correction adds no migration and does not rewrite either attempt.
A PostgreSQL regression removes the product-only columns in its isolated database and checks
an operator open and close through the actual repository.

## Independent process supervision acceptance

The 12-round study `perps-sma-20261005-1405` ended abruptly at 2026-10-05 17:14:12 UTC.
The macOS power log records the runner's caffeinate client ending at the same time; no caught
runner error or terminal signal survived. This proves termination, not its initiating cause.
Its 12 common rounds, 23 hourly opens/closes and seven direction opens/closes are preserved.
Both active variants had negative net virtual results; these are not a completed six-hour run.

Supervision controlled checks now use actual one-shot launchd jobs and real Node processes.
The first killed supervisor ended its child through launchd process-group cleanup; the separate
watchdog recorded RUNNER_DIED and an interrupted report. A second canary deliberately enabled
AbandonProcessGroup only in its synthetic plist: after SIGKILL of the parent, the independent
watchdog detected SUPERVISOR_DIED, signaled the orphaned child, confirmed its termination and
recorded a single terminal notice. Both pairs of synthetic jobs were unloaded. No provider,
database account, model call or order was involved. Local canary acceptance JSON remains in
ignored `.data/sma-supervision-canary*/`; these are controlled lifecycle results, not strategy
or live-provider acceptance. Production plists retain normal process-group cleanup.

Final supervision checks: the repository suite discovered 2,800 tests, with 2,799 passing,
one skipped and zero failures. The final targeted suite passed all 16 cases, including a
PostgreSQL read-only projection of interrupted remaining slots. All 17 workspace type checks,
root lint, formatting, architecture links, Node compilation and Worker dry-run builds passed.
A controlled macOS notification submission succeeded; visible delivery remains NOT_VERIFIABLE.
The operator's explicit continuation goal authorizes one newly frozen independently supervised
run after these corrections. It does not authorize restarting any historical study.

## Independently supervised prospective result

Study `perps-sma-20261005-1819-independent` froze code commit
`1d954c4c226a5c14cfa6db701e27a62e9c69893b` and configuration hash
`28251463a45a7eb45c4114f9ab41f227afa1359611ec82d882a776b4120f542f`.
Its planned decision window was 2026-10-05 18:31 through 2026-10-06 00:31 UTC.
It stopped admissions at approximately 00:01:08 UTC and finished interrupted at approximately
00:02:19 UTC. **The six-hour prospective acceptance failed.** Controlled checks remain separate
from this interrupted public-market sample.

The 144 decision rows classify all 24 scheduled slots: 19 complete common rounds, three
`DATA_UNAVAILABLE` omissions, one `STARTUP_BLOCKED` admission failure and one `NOT_ADMITTED`
future slot. The latter two slots were not evaluated successfully. An omission or interruption
is not a strategy hold or a comparable zero return.

| Variant          | Opens / closes | Gross realized AUSD | Fees AUSD | Recorded funding AUSD | Net realized cash AUSD |
| ---------------- | -------------- | ------------------- | --------- | --------------------- | ---------------------- |
| `sma-hourly`     | 32 / 32        | -0.189285           | 2.170336  | 0.011693              | -2.347928              |
| `sma-direction`  | 13 / 13        | 0.198242            | 0.883410  | 0.011767              | -0.673401              |
| `sma-multiframe` | 0 / 0          | 0                   | 0         | 0                     | 0                      |

All positions closed and no funding remained pending or disputed. Each portfolio started with
1,000 virtual AUSD. Net returns on that defined initial capital were -0.2347928%, -0.0673401%
and 0%, respectively. Observed marked drawdowns were 0.2347928%, 0.0673401% and 0%; these are
sampled verified marks, not continuous valuations. Model calls, model cost and new model
reservations were all zero. API USD is not converted into virtual AUSD.

Across the 38 valid asset/round observations, the hourly arm proposed 32 long entries and six
position holds; direction proposed 13 long entries, six position holds and 19 holds for missing
directional confirmation. In its own flat portfolio, multiframe held 19 times for directional
confirmation and 19 times for the activity hurdle. Replaying all policies on the same original
hourly portfolio instead gives multiframe 19 directional blocks, 13 activity blocks and six
position holds. These diagnostic proposal counts are separate from evolving portfolio results;
overlapping predicates are not independent causes.

The direction arm earned positive gross price P&L but its fees exceeded that gain. The hourly
arm had both negative gross P&L and higher turnover costs. No policy demonstrated positive net
performance. The inactive arm's zero result does not establish profitability or superiority.
All live entries were long, and both short momentum features can measure the same fifteen-minute
span at aligned endpoints; they are not independent confirmations. Common exits also mean the
hourly arm is an old-entry comparison, not a complete replay of the historical strategy.

## Demonstrated midnight interruption

The last successful pre-midnight observation was at 23:58:13.934 UTC; the 23:59 observation
failed with `DATA_UNAVAILABLE`. The next successful observation was at 00:00:26.256 UTC.
The preceding valuation was older than midnight minus ninety seconds, so the unchanged
[daily baseline guard](../../packages/trading/src/features/perps-paper/simulation.ts) recorded
`dayEquity: null` in every portfolio. The
[runner admission guard](../../packages/trading/src/features/evaluation/perps-runner.ts) then
stopped the next slot with `DAY_BASELINE_PENDING`.

The historical phase label is `startup`, although this occurred during a later UTC day rollover.
Preserve that label and explain the actual timing rather than rewriting the record. The gap and
guard interaction are demonstrated; the underlying provider reason for unavailable data is not
established by the code alone. Initial pre-start sampling corrected the earlier startup gap but
did not guarantee continuous public-data sampling across a later midnight.

The independent supervisor recorded `RUNNER_EXIT_WITHOUT_COMPLETION`, and the persisted study
and final report both remain `interrupted`. Live processes and healthy lease renewals before the
failure never established full-window acceptance. PostgreSQL owner and expiration were null at
terminal verification. Runner, supervisor, watchdog and their awake guard were absent, and only
this study's two one-shot launchd jobs were unloaded. Frozen checkouts remain intact.

## Local result evidence and remaining acceptance

Ignored artifacts are under
`apps/agent-service/.data/perps-studies/perps-sma-20261005-1819-independent/` in the operator's
primary checkout. They include `report.html`, `report.csv`, `report.json`,
`terminal-snapshot.json`, `terminal-incident-and-results.json`,
`terminal-artifact-verification.json`, `terminal-lease-verification.json` and
`terminal-resources-verification.json`. The snapshot is a consistent read-only PostgreSQL export.
The artifact verifier checks row uniqueness, CSV/JSON parity, common execution frames, exact
ledger arithmetic and HTML safety. Visual rendering was not verified.

Closed-position checks link original positions to filled opening/closing attempts and reconcile
consumed depth notional, collateral-micro rounding, fees and explicitly attributed funding.
Some horizon exits filled roughly fifty-five seconds after thirty minutes because minute
observations and valid frames govern execution; do not describe them as exact wall-clock fills.
Source data, historical reservations, stopped studies and unknown consumption remain unchanged.

The implementation and controlled lifecycle results are reviewable, but the complete six-hour
prospective gate remains unmet. No automatic repeat, restart, risk-rule relaxation, strategy
promotion, merge or deployment is authorized by this report. A future run needs a separately
reviewed way to satisfy the daily-risk continuity requirement and explicit operator authorization.

## Explicitly authorized single-day continuation

The operator explicitly authorized one new run with “sigue, te autorizo”. Study
`perps-sma-20261006-0150-single-day` retains frozen code
`1d954c4c226a5c14cfa6db701e27a62e9c69893b`, with configuration hash
`05cfc77de23049fa5e1b994bd879f839e440b8b1d2dd88cc4cb5ea3542f99934`.
Its fixed decision window is 2026-10-06 02:01–08:01 UTC, with virtual exits permitted until
08:16 UTC at most. This avoids another UTC day rollover without changing daily risk,
strategies, costs, acquisition thresholds or model budgets. The preceding failed study remains
intact and is not pooled as a paired control.

The runner failed at 2026-10-06 07:40:17.488 UTC with `INVALID_MARKET_DATA`, after
five hours, thirty-nine minutes and seventeen seconds of the planned decision window.
The supervisor recorded child exit code 1 with no signal. **Six-hour acceptance failed.**
The terminal report contains 144 unique decision rows: eighteen complete common slots,
five `DATA_UNAVAILABLE` omissions (4, 11, 12, 17 and 18), and one `NOT_ADMITTED` slot (23).
Four omissions occurred before initial evidence was available; slot 4 failed during final
refresh and retained its initial proposals. These are not strategy holds or zero returns.

| Variant          | Opens / closes | Gross realized AUSD | Fees AUSD | Recorded funding AUSD | Net realized cash AUSD |
| ---------------- | -------------- | ------------------- | --------- | --------------------- | ---------------------- |
| `sma-hourly`     | 14 / 14        | -0.272574           | 0.953118  | 0                     | -1.225692              |
| `sma-direction`  | 5 / 5          | -0.064646           | 0.341072  | 0                     | -0.405718              |
| `sma-multiframe` | 0 / 0          | 0                   | 0         | 0                     | 0                      |

All nineteen positions closed; no funding remained pending. The eighteen common rounds
provide thirty-six asset/round observations. Offline replay matches all 108 initial proposals
and traces, 108 final actions and 108 final risk projections. A consistent read-only snapshot
reproduces all 38 filled attempts, original position projections and exact cash ledgers through
the frozen business simulator and transitions. Model calls, cost and new reservations are zero.
Both active variants lost money after fees; the inactive variant's zero does not establish
superiority. Earlier samples are not pooled as paired controls.

The last recorded price pairs before the error passed their checks: BTC skew was one second,
ETH skew zero. Renewal succeeded before the failure and its confirmed expiration was still
in the future. The failure record preserves only the safe code and time, without the rejected
payload, predicate or validation phase. The exact rejected component and underlying cause are
`NOT_VERIFIABLE`. Do not infer a transport timeout or relax schema validation from this evidence.
Safe stage/predicate diagnostics with bounded rejected public evidence are proposed future work,
not a demonstrated fix or permission to repeat the run.

The local report is `interrupted` and the process is dead. The PostgreSQL document remains
historically `running` with no stop reason; the read-only audit preserves that discrepancy.
PostgreSQL owner and expiration are null. Runner, supervisor, watchdog and awake guard are gone;
both study-specific one-shot jobs were unloaded. No restart, provider request, historical state
rewrite or worktree removal was performed during this diagnosis.

Ignored evidence in the new study directory includes `report.html`, `report.csv`, `report.json`,
`interrupted-terminal-snapshot.json`, `interrupted-artifact-verification.json`,
`interrupted-decision-replay-verification.json`, `interrupted-final-risk-replay-verification.json`,
`interrupted-fill-ledger-replay-verification.json`, `interrupted-postgresql-lease-release.json`
and `interrupted-resource-release-verification.json`. Artifact checks prove row identity,
CSV/JSON parity, shared data, exact ledger sums and HTML safety; visual rendering is unverified.
The complete six-hour prospective gate remains unmet. No automatic repetition is authorized.

## Exit deadline regression discovered during continuation

An isolated PostgreSQL test demonstrated that the frozen runner checks the exit deadline
before observation acquisition but did not recheck it after that acquisition. When a controlled
read advanced the clock from one second before the deadline to one second after it, every
variant recorded two late virtual close attempts. This is a lifecycle defect, not evidence of
better or worse strategy performance.

The delivery code now rechecks the SMA exit deadline after observation acquisition, before
observation or execution writes, and completes with unresolved positions left pending. The
controlled regression uses the real coordinator, simulator and isolated repositories, with no
provider or model calls. The interrupted run retained its original frozen commit; this correction
was not injected into that process. All 38 recorded attempts passed their admission and exit
deadline checks. That timestamp evidence does not prove the corrected boundary behavior was
exercised prospectively. No automatic repeat or restart is authorized.

## Delivery visual-check readiness correction

On delivery head `1e3317b0`, the first rendered CI attempt reported nine contrast failures in
wallet screens while opacity was 0.24 or 0.79. One diagnostic repetition on the same commit
passed contrast over all 108 routes but could not prove two Studio screens. These failures and
their logs remain separate from the live SMA comparison; they did not stop or restart it.

The design harness previously counted proof selectors immediately and waited only for
post-click CSS transitions. Its readiness repair now waits up to ten seconds for each existing
proof selector and up to five seconds for finite animation/transition completion before
measurement. Infinite decoration is excluded from that wait. A missing screen or motion timeout
remains blocked. Selectors, colours, contrast thresholds and product UI are unchanged.

All 83 controlled design tests passed locally. An isolated Chromium fixture reproduced a delayed
mount and active entry animation (opacity 0.582989), then measured opacity 1 after completion;
it also verified that a missing screen and paused finite animation remain blocked. It made no
provider calls and did not use the app ports occupied by another process. This demonstrates the
readiness defect and correction, without proving every historical CI failure's internal cause.
All nine CI checks passed on delivery commit `fc766ebdfe8a41d25f0e37b3e4c535168775c8c4`,
including the full rendered check, PostgreSQL integration, lint, types, repository tests,
Node compilation and Worker dry-run builds. This does not establish completion of the
interrupted prospective study on its separate frozen commit.

## Controlled simulator round-trip coverage

The existing long/short horizon scenario originally checked an actual opening fill and the
common close proposal. It now also applies the actual closing fill to the account for all
three variants in both directions, using a fresh controlled frame at the horizon. Every
position closes and the controlled unchanged-price spread/fee round trip reduces cash.
These six round trips are synthetic execution checks, not provider decisions or prospective P&L.

All fourteen SMA scenarios passed again with isolated PostgreSQL, zero skips and zero failures.
Agent-service types, targeted lint and formatting also passed. No strategy, threshold, provider
or frozen-run code changed. All nine CI checks passed on exact delivery commit
`d3591a96a949c046e9ceb28ed50b8afb9d8b22e8`, including PostgreSQL integration, lint, types,
repository tests, Node/Worker builds and rendered design checks. Later result-documentation
changes require their own formatting and link checks; this CI evidence remains tied to that commit.

## Explicit continuation and safe rejection diagnostics

The operator reiterated authorization to continue through results on 2026-10-06. A new
prospective study may be prepared after controlled verification; previous studies remain
immutable. This authorization does not change entries, exits, risk, timestamps, budgets or
permit model calls or real trading.

The runner now emits `data-failure` version 1 diagnostics with a fixed cycle phase, original
safe error code and an allowlisted predicate label. Unknown exception messages remain
`NOT_VERIFIABLE`; no raw message, credentials or arbitrary response fields are logged. The
SMA host records diagnostic version `safe-phase-predicate-v1` in new preparation metadata.
A failing diagnostic callback cannot replace the original error. Historical generic failures
remain unverifiable; this change cannot retroactively identify the earlier rejected payload.

All sixteen SMA tests passed with isolated PostgreSQL, zero failures/skips and no external
providers or models. The added real-coordinator regression rejects crossed evidence before
execution, records `evidence-validation` / `CROSSED_BOOK`, preserves the original error even
when the diagnostic sink throws, and verifies no account has an execution attempt. Targeted
lint, agent-service types, shared compilation and architecture/link checks passed. Full-window
prospective acceptance remains pending for the newly frozen study.

## Interrupted diagnostic continuation on 2026-10-06

Study `perps-sma-20261006-1205-diagnostic` used frozen commit
`93fc1bd7fc3b75145b8cef32a378b66970d8b559` with a fixed 12:16–18:16 UTC window.
It ended with 19 complete common rounds, one omitted slot (14), and four future slots that
were not admitted. The terminal local phase was `observation-read` at 17:05:49.527 UTC,
with `STUDY_OPERATION_FAILED` / `NOT_VERIFIABLE`; the runner exited with code 1 at
17:05:54.577 UTC. This is another interrupted comparison, not six-hour acceptance.

The omitted slot's BTC ticker/book timestamps remained eight seconds apart, exceeding the
unchanged five-second maximum. ETH was coherent. The whole slot was skipped before decision
preparation, without execution or model calls; the next scheduled slot completed. All 114
saved decisions from the 19 complete rounds reproduced exactly. Each initial action was a
hold under the common neutral hourly trend. There were no virtual fills, open positions or
pending funding, and each independent portfolio retained 1,000 AUSD.

The last successful PostgreSQL renewal took 22,756 ms; an earlier timer was 13,431 ms late.
These observations do not establish the cause of the native exception. Version-1 diagnostic
records retain neither its native category nor its immediate cause, and the original request
payload is absent. The root cause remains unverifiable. A read-only PostgreSQL check confirmed
that the original owner and expiry were cleared; its historical document still says running,
while the report explicitly projects the dead process as interrupted. No record was rewritten
to claim completion.

New diagnostic version 2 preserves fixed exception categories and reviewed transport/PostgreSQL
codes for the exception and immediate cause, without messages, stacks, credentials or arbitrary
fields. It does not evaluate exception code/cause getters. The SMA host identifies this format
as `safe-phase-predicate-native-v2`. Unknown causes remain unknown, and native errors still
propagate unchanged rather than becoming holds or recoverable omissions. This fixes missing
diagnostic identity, not a demonstrated historical network or database cause. Full prospective
acceptance remains pending.

Read-only macOS power evidence records clamshell sleep at 17:04:42 UTC, before the
17:05:49 terminal diagnostic, followed by partial wakes and further sleep cycles. Host
suspension is demonstrated; the precise native exception and its causal transport/database
phase remain unverifiable. Idle-sleep protection cannot prevent closing the lid. A local
six-hour continuation requires the lid to remain open; no global sleep setting is changed.

All eighteen controlled SMA tests passed with isolated PostgreSQL, zero failures or skips,
including native transport/database categories, unknown identities, getter rejection, safe
redaction and unchanged propagation through the real coordinator without account writes.
