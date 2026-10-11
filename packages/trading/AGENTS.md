# Trading engine

Read the root and core instructions first. This package owns trading business rules and ports:
Polymarket execution and paper settlement, perpetual paper accounting/risk/simulation, strategy
policies and evaluation coordination. Public subpaths are `polymarket`, `perps`, `strategies` and
`evaluation`. Core retains agent configuration, identity, permissions and market-data contracts.

Depend only on core and language/platform primitives. Never import Node modules, environment,
files, HTTP clients, Mastra, provider SDKs, infrastructure, runtime or applications. Inject data,
models, repositories, clock, cancellation, scheduling and event persistence. Keep binary and
perpetual accounting separate. Models propose; code owns sizes, limits and execution admission.

Infrastructure owns transactions, leases and migrations. Preserve existing serialized versions,
unknown costs, reservations, idempotency and stopped sessions. This extraction authorizes no
paid calls, deployments or real orders. New strategies must reuse the existing execution/risk
services and include deterministic replay tests. Never add a second implementation in a host.

Build with `npm run build --workspace=@pickler/trading`; run root tests, typecheck and lint.

## Preserved domain behavior

## Paper resolution

Paper settlement lives in `features/paper/settlement.ts`; it applies finalized payout fractions to immutable fills, calculates virtual P&L with integer arithmetic and never signs or sends orders. `features/paper/sports.ts` restricts new scoped buys to reviewed NFL/soccer game winners. Settlement is explicit, idempotent and permission-checked; open costs are not realized losses.

## Local paper studies

`features/paper-study` exports provider-independent study contracts, BTC window eligibility, bounded prospective attempts and settlement coordination. This operator laboratory does not expand the production sports catalog or tenant permissions. Reuse conservative decision and virtual-fill policies. Persist before paid calls, never replay started cases, and never infer payouts from prices or elapsed time.

Each new local study case snapshots its model/prompt metadata so an explicit operator upgrade can retain historical attribution without resetting the ledger.

Paper study reservations include one Jev screen and one possible full forecast plus sports search
costs. Jev pricing must be supplied explicitly for new runs. `StudyUsage.routing` attributes providers
separately; `hasUnsettledStudyRouting` blocks further admission after incomplete/unknown routed
calls. Keep historical cases/configuration readable without rewriting their reservations.

Study routing records may carry an allowlisted Jev validation stage. Token counts and prices are
distinct: free output can have nonzero tokens, and known usage survives rejected answers.

Routing adapter 1.0.2 adds optional `answerDiagnostics` on rejected Jev answers: fixed question/field/error-code labels, value shapes and key counts, capped at 16 issues. Never persist rejected values, unknown key names, raw paths or provider error messages. Validation, routing and stop rules are unchanged; this diagnostic change does not establish live-provider acceptance.

## Perpl public data plugin

Core retains `features/perps`, which exports perpetual-data contracts and `createPerpReadService`. Perpl config is optional and opt-in; preserve historical tool/plugin defaults. The service pins config version and rechecks tenant, tool, plugin and market permissions around reads. No probability schema, SDK, signer or persistence belongs here.

## Perpetual paper accounts

`features/perps-paper` owns the opt-in virtual account contracts, exact decimal arithmetic, conservative 1x risk policy and trusted simulator fill transitions. Margin is reserved, never a cash expense; preserve negative balances and unknown marks. No signer, model tool or Polymarket decision dependency.

Perpetual simulation adds `simulatePerpsFill`, `applyPaperObservation` and `createPerpsPaperService`: full-depth 50-bps virtual execution, sampled mark risk, versioned estimated funding and sticky discrepancies. No inferred zero funding or liquidation. Trusted marks-only refreshes preserve funding status; model proposals cannot call the store.

Product paper sessions (`PRODUCT_PAPER_SESSION = "product"`, perpl-paper-runtime-v1 R9) are not
pinned to a config version in `assertPerpsPaperAgent`; operator sessions still are. In a product
account `paperRisk` keeps only the ledger rules (margin = notional / leverage via
`paperOpenReserve`, reservations, one position per market, insolvency): caps, stops and day-loss
belong to the runtime, so the 100 cap, exposure, day baseline, drawdown and the conservative
close requests do not apply, and unknown marks do not block. Product positions record `leverage`,
`margin`, `checkId`, `configVersion`, exits and `closeReason`; operator documents keep their shape
and refuse leverage (`LEVERAGE_NOT_ALLOWED`). `createPerpsPaperService().trade` takes
`{ notional, leverage, checkId, exits }` (default 100 at 1x). Intents take leverage within core's
`LEVERAGE_BOUNDS` (1–10) and a lowercase-UUID `checkId`. A product open's fee reserve is
`productFeeReserve(notional, takerFee)` = notional × the frame's taker fee × 1.5, rounded up to
micro-AUSD (10 bps without a frame); operator opens keep 1 AUSD, and a reserve may exceed 10 AUSD
only up to 1% of the notional. Closes check only the scope (`assertPerpsPaperScope`: tenant and
agent), never the agent's current plugins, policy, network or markets, so an owner's edit never
strands a position; opens keep the full `assertPerpsPaperAgent`. `features/perps-paper/checks.ts`
owns the runtime's storage port `PerpsRuntimeRepository` (checks, steps, leases, proposals, daily
counts) and `perpsCheckMinute`; `PerpsProductPaperRepository` adds `closePosition`,
`openDuePositions`, `newMarginSince` and the read-only `snapshot` to the paper port;
`marginOpenedSince(positions, since)` is the pure new-margin sum hosts compute from a snapshot.
`PerpsOwnerActionRepository` is the port of the owner's durable actions (`PERPS_OWNER_ACTION_KINDS`
`close` | `stop_all` | `approve`, statuses `pending` → `running` → `done` | `failed`, a 180 s claim
`PERPS_ACTION_LEASE_MS`, re-drive after `PERPS_ACTION_REDRIVE_MS` 30 s, at most
`PERPS_ACTION_MAX_ATTEMPTS` 30). `pauseAgent` is idempotent (null when already paused). In a product
account `applyPaperFill` caps a close's loss (realized P&L plus its fee) at the position's margin:
isolated margin, so a fill past the liquidation estimate is a liquidation and cash never goes
negative. Due agents carry their `slot` and the
dispatcher keys hourly checks `hourlyRequestKey(slot)` (one check per slot); `recoverChecks` is
the Cron's sweep of stuck checks. An approval goes `pending → approving` (`decideProposal`) and
only `settleProposal(id, opened)` makes it `approved` (or puts it back to `pending` when the open
was refused); expiry also ends approvals stuck five minutes past their time.

`features/perps-study` exports the independent comparison contracts, exact model reservation math
and study budget policy. SMA20/50 and atomic Jev policies live in `features/perps-strategies`. Unknown/missing candles imply hold, not a fabricated neutral
signal. Paper accounts may permanently close admissions while permitting reducing exits. Study
models never choose size or receive repository/configuration access.

## Quantitative BTC paper pilot

`features/paper-study/quant` and `quant-session` own the separate btc-quant-jev-v1 laboratory: reproducible two-outcome probabilities, sensitivity assumptions, fee-aware proposals, review admission and final refresh. They do not alter hosted research policy. Resolution identities also support forecasts without orders. Paid failures retain reservations and stop further paid admissions.

`features/paper-study/comparison.ts` owns version-3 paired-policy cases, joint review admission, slot bookkeeping and independent virtual settlement. `quantProposal` accepts an explicit policy without modifying forecast bounds; historical calls default to conservative. Hosts provide serialized admission/persistence. Preserve shared review accounting and distinguish blocked paid proposals from no-edge abstentions. The experimental ticker guard tolerates at most one second of future skew without rewriting provider timestamps.

`benchmark.ts` adds isolated version-4 A/B/C/D execution, joint reservations and separate reviewer
identities. All variants share initial and refreshed inputs, including vetoed cases and the no-veto
control. Technical paid-stop blocks every variant's purchase. `benchmark-metrics.ts` owns shared
forecast scores, realized-only economics, labeled review metrics and seeded paired hour-block
bootstrap. Missing/pending/failed observations are never silently zero; synthetic labels are not
human judgments. Preserve the older protocols and never alter quantitative formulas for this study.

Explicit benchmark continuations carry prior v4 reservations and review counts into the original
USD 1.25 / 386-call ceilings. Starting a new study does not reset these limits.

The optional local benchmark `invalidAnswerPolicy: "block-case"` isolates only
JEV_INVALID_ANSWERS with known bounded usage outside contract probes. All variants are blocked
for that market; transport, usage, contract and budget failures still stop the study. The default
remains stop-study. Evaluation with isolated failures is completed_with_errors, never a pass.

`features/evaluation/coordinator.ts` owns the frozen evaluation protocol registry and shared
command/paid admission boundary. Hosts inject protocol adapters; the engine does not access files,
providers or process arguments. Binary and perpetual accounting policies remain distinct.

Perpetual evaluation validates evidence freshness again after candle preparation, before model
reservation. Common execution frames are persisted as `execution-input` before valuation, including
rejected frames. Preserve the 30-second freshness and five-second component-skew limits.

Perpl data policy `coherent-20s-v1` bounds joint acquisition to twenty seconds without changing freshness/skew thresholds. `claimSlot` persists attempts before evidence/model work; `skipped_data_unavailable` is neither a hold nor a completed execution. `startLeaseHeartbeat` injects safe renewal diagnostics; study leases remain 90 seconds with 20-second renewal. Do not retry model calls or recover skipped slots.

The evaluation heartbeat exposes a synchronous liveness check. Hosts and runner admissions must call it before new work: a ninety-second local renewal gap aborts even before a delayed timer fires. This is a fail-closed process-interruption guard, not a replacement for PostgreSQL ownership or a lease extension.

Perpl acquisition also supports explicitly frozen `rest-paced-20s-v1` and `stream-20s-v1`. `transport-choice.ts` owns the predeclared 9/10-and-strict-superiority rule. Preserve 30-second age, five-second future/skew, twenty-second joint deadline, twelve REST requests and original historical policy. REST repeated timestamps consume a two-second wait; no model retry or automatic transport fallback.

## Local four-way perpetual comparison

`perps-four-way-v2` owns the frozen Jev-only support/invalidation policy and DeepSeek-to-Jev material veto policy in `features/perps-strategies`. Keep the legacy three-arm protocol readable. The shared runner refreshes BTC/ETH once for all four accounts, bounds models to 45 seconds and enters closing-only state on technical failure. Jev selected probabilities are answer measures, never financial win probabilities.

## Perpl decision audit

The evaluation export includes auditPerpsDecisions and canonicalAudit. features/perps-study/audit.ts is a pure offline replay of existing policies and fill simulation, with an injected digest. Missing inputs remain NOT_VERIFIABLE; no provider, filesystem, database or model clients belong here. Keep hourly candle repetition distinct from stale data, omission slots distinct from holds, and observed decisions distinct from controlled fixtures.

## Perpetual advice

The `perps` export includes `features/advice`: provider-neutral evidence validation, routing
coordination and exact USD model reservation arithmetic. Require 60 closed hourly candles and
existing snapshot/book coherence. Only coherent insufficiency becomes wait; data/provider failures
fail. Models and data ports are injected; no positions, wallets or trading executors are reachable.
See [Agent advice](../../docs/agent-advice.md) and deterministic advice tests.

Advice policy v2 validates and freezes the HTTPS forecast base URL alongside its reviewed model/rates. Version 1 remains bound to direct DeepSeek. Reject credential-bearing/query/fragment URLs; reserve using the job’s frozen rates.

## Studio execution and historical reading

`features/perps-runtime/studio-check.ts` coordinates product checks through injected ports.
`studio-execution.ts` owns fixed creator sizing and approval admission; `studio-costs.ts` owns
frozen USD reservation arithmetic. Existing paper services own fills, funding and accounting.
New positions use a 3% stop, 6% target and 24-hour deadline with the existing leverage clamp.
Opposite proposals close only; compulsory exits precede strategies and run again on final data.
Funding pending/unknown blocks additional exposure. Every financial write is transaction-fenced.
`decision.ts` is a historical perps-check-v1 reader only. No new executor uses its probability,
stop or horizon. The old conviction sizing and decideOutcome policy are removed.
See [Studio perpetual execution](../../docs/studio-perps-execution.md).

## Versioned perpetual strategies

The `strategies` export owns `PERPS_STRATEGIES`, `resolvePerpsStrategy` and
`executePerpsStrategy`, including their input, model and call-gate ports. IDs are `rules`,
`deepseek`, `jev` and `combined`, laboratory policy version 1.0.0 and distinct Studio versions 2.0.0 and 2.1.0. Provider/prompt versions remain
separate. Unknown selections and missing capabilities fail closed before model calls.
Execution clones and recursively freezes evidence/account inputs; never mutate another strategy's
portfolio. Every model operation passes through an injected durable call gate using the existing
reserved lane and request/usage hooks. The gate is mandatory; it is not an optional logging hook.
Risk, sizing, fills and accounting remain outside strategy decisions.

The evaluator uses the registry for v2 and the explicit `perps-study/legacy-strategy.ts` adapter
for historical v1 readiness -> blind forecast. Preserve serialized lanes, answers and proposals.
The evaluation export retains historical policy/type names backed by the same implementations.
No new persisted harness plugin IDs are introduced. Studio uses separate 2.0.0 historical and 2.1.0 dynamic contracts.

## Studio strategy version 2

The common registry identifies strategies by both id and version. Version 1.0.0 keeps laboratory behavior; `executeStudioPerpsStrategy` requires the separate `studio-perps-strategy-v2` context and matching version 2.0.0 or 2.1.0. Studio proposals carry complete three-state brief evaluations and evidence references, never probabilities, sizes or leverage. Unknown conditions cannot establish an entry or authored exit. Opposite openings become close-only proposals. Combined invokes its own direct proposal and material-veto review; it cannot reuse another account response. Every model invocation goes through the injected reservation/call gate. These contracts alone do not enable product execution.

## Dynamic Studio markets

The registry adds four dynamic Studio 2.1.0 descriptors while preserving 1.0.0 and 2.0.0. Complete
selected evidence and remaining public/model-input bounds precede paid transports. Product fills
persist market identity; selected markets authorize exposure, recorded positions remain supervised
and closeable. No financial formula, threshold or lab protocol changes.

See [agent-selected Perpl markets](../../docs/studio-perpl-markets.md).

## Original SMA laboratory

`perps-original-sma-v1` selects one rules 1.0.0 arm and configuration v3. Reuse the original hourly inputs and conservative four-hour operator risk; no multiframe exits. The common runner accepts no models for this protocol, uses an empty call map and reports each cycle through an injected callback. Paid and historical protocols retain their interpretations.

## Local SMA review comparison

Configuration v4 perps-sma-jev-exa-v1 owns three explicit SMA review arms, entry-only material veto and common final gates in features/perps-study/sma-review.ts. Reuse original SMA/risk versions. The fixed eight slots, 27-call limit and USD 0.50 new reservation ceiling include contract checks; no retries.

## Explicit SMA continuation

perpsSlotClock uses recorded operator continuation segments; the original start and completed slots remain unchanged. Runner release carries safe interruption codes for administrative terminal reporting.

## Local universe comparison

Evaluation v5 `perps-sma-jev-exa-all-markets-v1` owns exact SMA separation ranking, at most five positions, common invalid-asset exclusions and asset-specific review lanes in `perps-study/universe.ts`. `perps-paper/universe-acquisition.ts` validates the bounded partial universe. Original risk, sizing and hourly policy remain unchanged. No replacement after veto, resume or paid repeat.

## SMA profiles and selective exposure laboratory

Local `perps-sma-profile-risk-v1` configuration v6 has four independent variants:
`hourly-legacy`, `hourly-selective`, `fast-legacy`, and `fast-selective`. It composes no
model, news, signer, or real order capability. Preserve v1–v5 records and monetary reservations.
The new optional account `riskManagement` is assigned from the trusted study at initialization;
absence retains historical collective exposure exits. No intent can change it.

Trading exports versioned profiles through `strategies`/`evaluation`, and the bounded selective
planner through `perps`. The profile runner serializes public observations, full ledger closes,
common final refreshes, and four portfolio executions; no host may duplicate these policies.
Selective accounts admit projected post-fill exposure at most 40% of marked equity and reduce
strictly above 50% using full closes. Global emergency exits and historical risk stay intact.

Read [the local guide](../../apps/agent-service/SMA-PROFILES-RISK.md) for frozen parameters,
commands, one-shot execution, and report limitations. Tests never make paid provider calls.
All registered perpetual protocols permit a read-only audit export. Export support does not
authorize running an older model-decision analyzer against a new profile protocol.
The profile runner accepts an injected sleep port for controlled scheduling tests. If a cycle
finishes in a newer minute, it immediately checks that minute instead of sleeping past an
unexpired admission. Durable slot fencing still rejects duplicates, late slots and recovery.
Confirmed exits fence reopening by both the originating cycle slot and the confirmation's
decision slot, including observations that cross an admission boundary.

`acquireUniverseV2` is the opt-in `rest-universe-coherent-20s-v2` acquisition policy. The injected
absolute deadline includes metadata work before acquisition. Every batch snapshot operation must
perform a fresh guarded bulk ticker request; returned states update all pairs, and a missing state
discards that asset's prior snapshot. One recovery operation can precede an unread book, followed by
that book's turn. Repeated timestamps postpone only their component by two seconds; ready work
continues instead of a global sleep. Timestamp regressions permanently exclude the affected asset.
Revalidate the latest components at one final clock and keep all historical v1 behavior unchanged.
Transport still owns one-second serialized starts and the twenty-four-request cap. Controlled
counterexamples demonstrate scheduling corrections, not live availability or economic improvement.
Transient request failures are recorded with their operation code. Previously received components
may remain eligible only with their original provenance and the final freshness/coherence checks;
a failed request never advances their dates. A successfully received batch missing a symbol is
different: it discards that symbol's previous snapshot instead of substituting it.

`auditUniverseCapture`, exported through `evaluation`, owns the pure `perpl-reader-audit-v2`
analysis of versioned public captures. It emits allowlisted facts and never invokes data ports.
Recovery intervals require both original ticker and book dates; ticker-only initialization is
excluded. Optional per-request market IDs remain absent for historical captures. Missing request
bytes, cache attribution or transport targets are unverifiable, not reconstructed evidence.

## SMA reopening and timing protocol

Configuration v7 (`perps-sma-reentry-latency-v1`) adds `sma-reference` and `sma-once-bar`, both hourly/selective. `features/perps-study/reentry.ts` owns immutable entry policies and the final hourly key; apply its gate after selection, never rerank replacements. `reentry-metrics.ts` checks common slots, pre-maintenance valuation and detected exits. The shared profile runner prioritizes price maintenance before funding/candle preparation and uses `nextPriceCycleDelay` after overruns. Preserve v6 actions and risk semantics. Infrastructure must atomically persist confirmed fills and consumed keys; hosts must not manufacture either. See [local protocol guide](../../apps/agent-service/PERPS-SMA-REENTRY.md).

`reentryEconomics` matches blocked keys only to confirmed reference openings in the same common
valid slot, direction and final hourly bar. It reads the existing fee, realized-P&L and funding
postings; missing/duplicate postings or pending funding cannot establish a net result. These are
actual reference positions, not hypothetical P&L for a blocked proposal or causal fee savings.

## Explicit universe stream acquisition

`perps-paper/stream-universe.ts` owns transport-neutral joint validation and the explicit
`stream-universe-20s-v1` policy. All components come from a copied generation and one clock;
no matching historical component is selected. The reader audit accepts stream capture v3 and
emits `perpl-reader-audit-v3` while preserving older interpretations. No strategy, risk or
financial calculation changes are part of this selector. See the local WebSocket guide in
`apps/agent-service/PERPL-UNIVERSE-WEBSOCKET.md`.
Stream acquisition accepts an injected bounded snapshot-refresh port after invalid evidence.
The transport owns subscription rate limits; trading revalidates the new components under the
same clock/deadline and never treats a refresh request as proof that a price timestamp advanced.

The offline reader auditor accepts recorded universe adapter versions 1, 2 and 3. Three-read
stream diagnostics remain explicitly `DIAGNOSTIC_ONLY_NOT_ACCEPTANCE`; admitting their offline
analysis never makes them qualification or upgrades a recorded outcome.

The separate capture-only `stream-universe-component-20s-v2` policy checks native component age
and future bounds independently and requires advancing heartbeat continuity within five seconds.
It records ticker/book skew without applying that gate. Historical financial `validatePaperFrame`
and fill simulation retain their original skew rule. Stream report/audit v4 preserves the descriptor,
strict-rule market/cycle counts and nonfinancial admission; reject contradictory metadata.
Capture success never admits financial execution or changes a historical outcome.

The separately authorized `stream-universe-component-paper-20s-v1` financial laboratory policy
is selected by the account's immutable `marketDataPolicy`, never an intent. `simulation.ts`
validates independently fresh native components plus a copied live heartbeat proof, and hashes
that proof with the frame. `validatePaperFrameSet` rejects mixed generations/reference clocks;
historical accounts and product sessions retain strict behavior. Financial math, risk, signals,
funding and exits are unchanged. `perps-study/component-qualification.ts` revalidates an explicitly
pinned complete capture at its original clocks; it reconstructs no historical trades and performs
no I/O. See [paper policy](../../apps/agent-service/PERPL-COMPONENT-PAPER.md).

Component paper validation accepts a separate trusted receipt clock for local heartbeat/copy
proof. Native component freshness and financial dates retain the financial clock. Equal clocks
remain the pure-function default; legacy/product formulas and codes are unchanged.
`PerpsFrameValidationFailure` exports safe allowlisted clock provenance and a bounded reason
union, never raw provider content. Do not infer missing historical failure clocks.

Component-paper services may use the optional captured-frame execution port to admit, simulate
and confirm one shared frame in a single fenced transaction. The runner reuses its committed
view only for this explicit policy; historical and product paths retain their prior lifecycle.
The port does not acquire fresh data, alter proof timestamps, change prices or financial rules.

Component-paper common observations use the optional `observeCommon` port for both v7 accounts.
One copied input and financial/receipt clock precede all maintenance; a confirmed transaction
rollback on demonstrated native/heartbeat aging records an unavailable observation or slot.
`isComponentFrameExpiry` classifies aging only, never identity/schema, future-date or ownership
failures. Initial/final marks and funding reuse the common port. A partially committed observation,
financial maintenance failure or uncertain commit cannot become an omission. Legacy paths remain
unchanged. Controlled six-hour tests use synthetic evidence and do not establish live availability.

## Experimental PTS public contract

`@pickler/trading/pts` exports deterministic PTS 0.2.0 detectors, UTC aggregation, dated strict
pivots, exact ratio/channel/ATR comparisons, sizing, management and offline reproduction.
`src/features/pts/` owns these rules; `@pickler/trading/testing/pts` is controlled test data only.
Evaluation config v8 (`perps-pts-sma-v1`) uses explicit `sma-reference`/`pts-basic` maps and the
existing profile coordinator. It has no model arms or monetary reservations.

PTS account policy alone permits native explicit-quantity partials. Keep initial basis/quantity,
remaining amounts, block-ordered reductions, consumed setup/targets and non-widening stop state.
Same-block funding uses the quantity before reduction; later blocks use the reduced quantity,
including reconciliation after final close. Historic full closes and SMA/Studio rules are unchanged.
The pure ptsFinancialAudit reads confirmed ledger postings and quantity/funding invariants for replay and audit.
No candle-only financial return or hypothetical evolving portfolio belongs in signal replay.
Keep decisions and revisions bounded by information time and the original missing-evidence labels.
See [the local guide](../../apps/agent-service/PTS-BASIC-PAPER.md).

The pure inspectPtsHistory is evidence inspection only: retain invalid original bars and mark
projections NOT_VERIFIABLE. Its diagnostic counts cannot admit a strategy or repair an OHLC bar.

PTS financial audit distinguishes posted ledger components from final net results; pending or disputed funding keeps final funding and net P&L null.

Intraday PTS has independent identity 0.1.0 and configuration v9 (`perps-pts-intraday-sma-v1`),
with `sma-reference`/`pts-intraday` maps. `temporal-profile.ts` binds trusted native roles/minima/
expiry, six-hour holding and UTC day-end close; default PTS functions retain basic 0.2.0 semantics.
`@pickler/trading/testing/pts-intraday` exposes controlled native fixtures only. Setup, position and
intent versions must match immutable account policy; no relabeling or user-supplied role overrides.
Offline intraday replay evaluates each closed 5m window and never computes candle-only profit.

canonicalAuditChunks yields exactly the historical canonicalAudit bytes without joining a whole
snapshot; hashing/files remain host responsibilities. auditPtsDecisionRows reuses the PTS policy
for an explicit original slot subset. auditPtsStudy preserves its original full-window rows and
financial audit; evidence hashes are computed once per original initial/final object. No action,
reason, signal, financial policy or historical hash interpretation changes with segmented export.

Independent fast intraday prerelease 0.2.0-fast.1 is an explicit v9 candidate with native 4h/1h/15m/5m roles. Correction and entry share one 180-bar 5m series; existing geometry, expiry, six-hour/day-end and financial rules are reused. ptsCandidateVersion/ptsConfigVersion/ptsPolicy reject unknown identities and preserve old policy hashes. The test-only testing/pts-intraday-fast subpath provides synthetic data, never live evidence.
