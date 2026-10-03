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

`features/perps-study` exports the independent comparison contracts, exact model reservation math
and deterministic SMA20/50 policy. Unknown/missing candles imply hold, not a fabricated neutral
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

## Perpetual advice

The `perps` export includes `features/advice`: provider-neutral evidence validation, routing
coordination and exact USD model reservation arithmetic. Require 60 closed hourly candles and
existing snapshot/book coherence. Only coherent insufficiency becomes wait; data/provider failures
fail. Models and data ports are injected; no positions, wallets or trading executors are reachable.
See [Agent advice](../../docs/agent-advice.md) and deterministic advice tests.

Advice policy v2 validates and freezes the HTTPS forecast base URL alongside its reviewed model/rates. Version 1 remains bound to direct DeepSeek. Reject credential-bearing/query/fragment URLs; reserve using the job’s frozen rates.
