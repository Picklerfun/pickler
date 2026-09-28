# Core package instructions

Read [the root instructions](../../AGENTS.md) first. Read the local instructions of any other project you inspect or change. Keep this file aligned with actual business modules, exports, and tests.

## Responsibility

`@pickler/core` owns the business layer: domain entities and invariants, application use cases, authorization rules, and ports for external capabilities. It must remain usable without Next.js or any specific provider.

Current source includes `application/get-health.ts`, `ports/clock.ts`, `features/research/{types,policy,decision-policy,run-research}.ts` and the public product features ported from Relayer: `features/{access,agent-registry,budget,signing,profiles,agents,landing,markets,waitlist,applications}`. Public exports include research capability/repository ports, entities, configuration and schedule policy, decimal price comparison and `createResearchRunner`.

The runner owns permission rechecks, evidence attribution, bounded capability use and final quote verification. It accepts trusted scope from persisted jobs. API, Studio and scheduling share the same queue/runner. Core never accepts a model-supplied tenant or grants permissions from external content. Research failures and valid abstentions remain separate states.

## Rules

- No Next.js, React, HTTP request/response objects, ORM clients, provider SDKs, environment reads, or concrete infrastructure imports.
- Use plain input values and verified actor data. Enforce business authorization here, not only in UI or transport code.
- Define capability-specific ports here and inject implementations into use-case factories. Do not import infrastructure to construct a dependency.
- Domain models are not HTTP DTOs. Core may use `Date` or `bigint` internally; presentation maps them to public wire formats.
- Use typed business failures without HTTP status codes. Infrastructure should translate technical failures into errors the use case can understand.
- Keep public exports intentional in `src/index.ts`; use relative imports inside the package. Current lint rules prohibit dependencies on sibling runtime packages and agent SDKs from core. Relative imports use `.js` extensions for compiled Node ESM. `npm run build --workspace=@pickler/core` emits `dist`; public types resolve to source, runtime imports to compiled output.
- Do not add business rules that have not been specified by the product requirements.

## Checks

From root, run `npm test`, `npm run typecheck` and `npm run lint`. Root tests build shared packages first and include runner integration tests under infrastructure, which inject providers and use isolated PostgreSQL databases. Core health tests remain in `test`. Add framework-independent unit tests here for standalone domain policy. Do not move persistence implementations into core.

`ResearchModel.metadata()` includes research and market-selection `PromptSnapshot` values plus an optional final-decision snapshot for backwards compatibility: ID, version, SHA-256 and exact instructions. Core only persists these trusted adapter values in the first runtime event; prompt definitions and hashing stay in the agent service. Record metadata before permission checks/provider calls so failed started runs retain provenance too. This snapshot describes the runtime that starts a job, not a prompt version pinned at enqueue time.

Market eligibility requires an active, allowed market with a valid closing date strictly after the injected clock. Apply this before selection, after loading a manual or selected market, and on the final trade refresh. Missing dates are excluded conservatively. Preserve raw `candidates` and filtered `eligible_candidates` separately. `ResearchModel.select` receives the current UTC time. `ModelFailure` carries allowlisted adapter diagnostics; the runner persists `model_failure` before marking the run failed.

The research `outputTokens` cap is 32,768 per model call, including provider reasoning tokens. Core defaults to this cap; existing persisted agent configurations retain their values until explicitly updated. The agent-service caps selection and connection probes separately at 2,000.

Decision policy lives in `features/research/decision-policy.ts` and is exported as `evaluateDecision`. The model port returns `ModelAssessment` only. The runner saves `model_assessment`, validates existing evidence/market rules, refreshes quotes for trade proposals and applies deterministic policy before writing `DecisionV2`. Preserve the model proposal unchanged. Policy version 1.0.0 records its effective config, reason codes and evaluation time. Never upgrade model abstention or turn provider/schema failures into abstentions. Legacy configs without `uncertaintyPolicy` use conservative defaults; their snapshots are not rewritten. Legacy decisions remain readable without v2 claims.

The research runner requires `agent`, `event`, `finish` and `assertOwnership` repository methods. Admission, claims and process ownership remain responsibilities of its host; narrowing this dependency does not make the runner durable or permit bypassing production authorization.

Research ownership is checked before new provider/model operations, including the model adapter's `beforeStep` callback. Lease loss propagates without attempting a final decision write. Internal repository contracts include `renew` and operator-only `setConcurrency`; lease owner tokens must never enter model context or public DTOs. Hosts own heartbeat and recovery lifecycle; infrastructure owns atomic database fencing.

Discovery policy is optional for historical configs. Version 1 `pre-event` requires a verified Polymarket game start at least 15 minutes ahead and within seven days by default; it applies to discovery, manual selection and final trade refresh. `open-market` preserves existing behavior. Persist exclusions and return `NO_ELIGIBLE_MARKETS` without a model call when empty. Core filters/ranks at most 20 candidates after the adapter's bounded scan.

`publicSourceUrl` normalizes HTTP(S) resources conservatively and rejects explicit private/local hosts, literal IPs and credentials. The reader receives only exact URLs from retrieved search results or the selected market's `resolutionUrls`. This never grants domain-wide permissions or changes enabled tools. Preserve requested URL and rule-link provenance without claiming official status. Evidence limitations flag missing publication dates, truncation and publication older than seven days; they are evidence context, not automatic conclusions.

NFL research adds provider-neutral `SportsData`, versioned plugin permissions and `nfl-winner-v1` report validation. Plugins and individual tools must both be enabled. `effectivePlugins` interprets historical permissions without enabling sports sources. Optional sports integrations can be disabled; invoked failures remain failures. Decisions v3 preserve a separate forecast and coverage, including on abstention. Do not weaken uncertainty policy to obtain trades.

`features/paper/orders.ts` owns the manual paper capability contracts, eligibility and integer full-budget simulation. A paper order is never a model tool. Both paper and Polymarket permissions apply; unchanged configuration and a current policy-approved trade are mandatory. Ten virtual units include estimated fees; no partial fills or real orders. Recheck time/quote eligibility at atomic finalization.

`researchReferences` produces citable market, quote and plugin-availability context, distinct from external `Source` evidence. `validateReport` accepts these only in their declared sections; context cannot substantiate injuries or sporting advantage. The runner persists these references and retains the original provider events. Top-level decision source IDs still require retrieved sources. Keep historical reports readable without requiring a context-reference backfill.

`features/research/market-scope.ts` owns the version-1 two-level sports catalog, legacy-aware scope checks and automatic NFL/general protocol selection. Match versus award/season timing is enforced before selection, manual loading and final trade refresh. New scoped runs produce decision v4; legacy configs retain their protocols. General reports have eight sections, NFL nine. Provider classification is trusted only from the injected market adapter; model text never grants scope. Paper finalization supports reviewed NFL/soccer full-game winners through `features/paper/sports.ts`; general reports do not authorize arbitrary market types.

Product API-key authorization is deny-by-default for every key kind. `read:agents` grants read-only
product agent access; legacy broad labels grant no implied permissions. Budget reservations record
the actual commit period and reset generation. A refund may reduce current spend only when both
match; legacy unknown-period charges cannot credit the active balance. This product ledger is not
the research quota authority.

## Unified console access

`features/console/access.ts` owns user-session-only research authorization and the console directory port. Operator enablement is independent from registration. Only workspace owners administer research; permitted members read. New configurations require marketScope.

Event persistence failures use `PersistenceFailure` and a sanitized `persistence_failure` event,
not `provider_failure`. The discovery report callback obeys the same distinction. Preserve lease
and configuration errors unchanged. If diagnostics cannot be persisted, do not fabricate a
terminal result; the existing lease recovery path remains authoritative.

## Local trading integration

The opt-in Polymarket pilot remains disabled by default. Read `../../apps/agent-service/LIVE-TRADING.md` for limits and acceptance gaps. No model tool or deployed signer is enabled by this change.

## Markets

`features/markets` owns the perpetuals surface: a market is a grid of price levels away from the mark
crossed with how long a position is given. `LEVEL_STEPS` and `HORIZONS` are the rows and columns,
`levelPrice` and `levelSide` read a square, and `squareProblem` refuses one the market has never
reached inside its column — `hourlyReach` is per cent, on the same scale as a level. `MarketBoard`
is the port; `createListMarkets` orders by coverage before size and `createGetMarket` normalizes the
symbol and drops calls on squares the surface cannot take.

`READ_HORIZON` is why the feature exists in two places at once: a square can be a position or a paid
read, and a read always resolves a day after delivery whatever column drew it, so two answers on one
market stay comparable. `readQuestionAtLevel` in `features/agents` writes that sentence.

The arithmetic a ticket previews — size, liquidation, fee, the phrase — is not here. Nothing is sent
today, so it lives in the web feature that draws it against the mirrored limits in
`@pickler/api-schema`. It belongs here the day an order is placed, because then it decides money.

## Cloudflare trading pilot

Trading uses operator-enabled immutable accounts and provider-neutral NFL/soccer winner eligibility. The sign port accepts a final ownership guard. Automatic attempts are durably admitted once; confirmed autonomous purchases close the pilot. See ../../docs/polymarket-worker-pilot.md.

## Optional research observation

The model port may report `DecisionInputSnapshot` for the exact tool-free finalizer evidence.
The runner clones it and publishes `ResearchObservation` through an injected `ResearchObserver`
only after a successful final decision write. Observer failure and diagnostics cannot re-enter
research failure handling, mutate the primary result or create an abstention. Missing snapshots
are diagnostic gaps, never reconstructed from later evidence. Host observers must remain bounded
capture-only operations; paid comparison is a separately admitted operation. Core owns no files,
provider credentials or observer pricing, and the observer is not a decision-policy input.

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

`features/perps` exports separate perpetual-data contracts and `createPerpReadService`. Perpl config is optional and opt-in; preserve historical tool/plugin defaults. The service pins config version and rechecks tenant, tool, plugin and market permissions around reads. No probability schema, SDK, signer or persistence belongs here.

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
