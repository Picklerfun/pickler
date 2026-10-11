# Agent service

Read ../../AGENTS.md and each affected package's AGENTS.md first.

This local research and manual-simulation host owns Mastra integration, Studio workflows, HTTP transport, and worker lifecycle. Core owns authorization and research/scheduling rules. Infrastructure owns provider and PostgreSQL adapters. Never add trading or signing tools to this pilot.

Bind only to loopback. Studio is privileged local operator tooling, not tenant authentication. Pickler API routes resolve distinct local tokens server-side. Never trust model-supplied tenant identifiers. No paid calls at import or startup. Database URLs and provider credentials must stay untracked.

Use package exports, not relative cross-workspace source imports. Keep this file and README current. Run relevant tests, typecheck, lint, and build before submitting a PR.

## Structure and commands

Read [README.md](README.md) for the actual workflow and API contract. `src/mastra/index.ts` registers operator workflows and `/pilot/*`; `src/api/app.ts` maps tenant tokens and validates DTOs; `src/composition` is the only production location constructing concrete provider/store/model adapters. `src/plugins/registry.ts` wraps business capabilities with validated Mastra tools. `src/workers/main.ts` runs the sequential Node executor; `src/workers/lease.ts` owns heartbeat and cancellation shared with Cloudflare; `launch.mjs` supervises it alongside Studio. `src/cli.ts` is an HTTP client and environment initializer.

`npm run dev:agent` at root builds shared ESM dependencies and starts Studio/worker. After shared source edits, rebuild and restart. `npm run agent -- init` creates an ignored environment file; all provider values must be supplied explicitly. Build must work without credentials and never contact paid providers. Use Node 22.22+.

Run root lint, typecheck, tests and build. Test files live in `test`. Test transports are fixtures only and must never be selected as a production fallback. Keep the researcher internal: exposing raw Mastra agent endpoints would bypass tenant queues and budgets. Studio workflows are the privileged operator entry point. Disable scheduling when provider identity or agent configuration changes. Preserve partial evidence on failure and interrupted work; never automatically repeat a started manual investigation.

Database setup: set `DATABASE_URL` for runtime and `DATABASE_MIGRATION_URL` for explicit Drizzle migrations. Use Supabase direct or session-pooler URLs, never the transaction pooler (port 6543). Run `npm run db:migrate` before startup. Mastra uses `@mastra/pg` with schema `mastra`; Pickler uses Drizzle with schema `pickler`. All executors use per-run leases. Recovery only fails expired leases; no global running-job recovery is allowed. Shared PostgreSQL policy defaults to five global and two per tenant, with one running job per agent.

## Versioned prompts

Research, selection and final-decision instructions live in `src/prompts/{research-system,market-selection-system,decision-system}.ts`. Definitions contain an immutable ID, semantic version, exact text and SHA-256 fingerprint. Bump their version when text or embedded schemas change. Core records all three snapshots in the first runtime event; historical records are not rewritten. User profiles and research summaries are untrusted data, never system instructions.

The adapter first researches with tools and plain text, then makes one tool-free structured decision call using original evidence, rules, quotes and that summary. Reserve one of the configured steps for finalization and one for automatic selection. All phases share the original deadline, token cap and lease/permission guards. Validate original final JSON and the structured object; never repair, retry or substitute a model. Keep the explicit JSON/schema instructions in selection and decision prompts only.

`src/composition/model-output.ts` classifies safe failures; `model-diagnostics.ts` allows metadata only; `model-probe.ts` contains the explicit controlled diagnostic and is never called by a research job. Step events preserve duration, finish reason, numeric usage, text size/object presence and reviewed tool names/status even if aggregate generation fails. Never persist raw output, reasoning, error messages, headers, unknown field names or credentials in diagnostics. `model_step_usage` is per-step usage; `model_usage` is its research-plus-decision aggregate, not additional consumption. Selection usage is separate. Do not sum diagnostics and usage events together.

`npm run diagnose --workspace=@pickler/agent-service -- combined|split` explicitly calls the configured model with a controlled tool fixture. The workspace command loads the app’s `.env`; from the app directory use `npm run diagnose -- split`. Reports are saved in ignored `.data`. This is not a real investigation or scheduling-readiness check and never calls Exa. No automatic retry is allowed. The reliability acceptance budget is at most three diagnostic invocations and two full investigations.

For DashScope endpoints (`dashscope.aliyuncs.com` and `dashscope-intl.aliyuncs.com`), market selection explicitly sends `enable_thinking: false` through provider options. Research and connectivity probes retain provider defaults; research allows up to 32,768 output tokens per call while selection and connectivity probes remain capped at 2,000. This is a request setting, not a prompt instruction. Other compatible providers need their own documented controls; do not send DashScope-specific options to them.

Individual model requests allow 180 seconds. Always combine this timeout with the incoming abort signal so the five-minute research deadline and cancellation still take precedence.

Decision prompt version 1.0.0 and connection schema probes use `modelAssessmentSchema`, not the persisted decision union. Only core creates the v2 final action and policy evaluation. The response retains final top-level fields for existing consumers and adds `schemaVersion`, original `modelAssessment`, and `policyEvaluation`. Probability ranges are subjective model estimates, not calibrated confidence intervals. No paid validation is implicit in schema changes.

The experimental Cloudflare runtime probe lives in `src/cloudflare`; read its local AGENTS.md and `CLOUDFLARE-PROBE.md` first. `wrangler.probe.jsonc` bundles the actual model and core runner for workerd. This is an operator-only compatibility experiment, not the production API, scheduler, tenant admission or a durable execution engine. Local PostgreSQL probes require an isolated database; remote ephemeral probes return evidence to the caller without remote persistence. No provider calls run on startup.

The separate local background experiment lives in `src/cloudflare/background`; read its local instructions and `CLOUDFLARE-BACKGROUND.md`. It reuses `createApi` with an optional queue notification hook and `createContainer` with explicit validated environment bindings. PostgreSQL admission remains durable if notification fails. Cloudflare Queue consumers claim and renew individual leases; scheduled events reconcile pending work. Keep this isolated from both the normal Node pilot database and the retained remote HTTP probe.

`npm run agent -- concurrency <global> <tenant>` is an explicit operator command using `DATABASE_URL`; it is not a tenant API. Values are persisted, never per-instance environment settings. Lowering limits preserves active work. Cloudflare's configured delivery concurrency is a separate ceiling. The model adapter calls the runner's ownership/permission guard through `prepareStep` before each research model step. On renewal failure abort new activity, await heartbeat cleanup and leave expired recovery to reconcile; never silently finish a lost lease.

Read [NFL-RESEARCH.md](NFL-RESEARCH.md) for configurable plugins, migration and bounded evaluation. `configure:nfl` explicitly updates both lab agents; `--sports` requires the optional operator keys. `evaluate:nfl -- --all-six` makes paid model calls on synthetic frozen evidence, never CI or production fallback data. The immutable NFL final prompt has its own snapshot and schema; legacy protocols retain their final prompt. Both Node and Cloudflare composition use the same plugin guards and adapters.

Manual simulation is documented in [PAPER-TRADING.md](PAPER-TRADING.md). The composition root binds `PostgresPaperStore` and the trading paper service into the same tenant API used by Node and Cloudflare. CLI commands `paper-buy` and `paper-result` require a run ID; requests remain manually initiated. The paper plugin has no LLM tool. Never detach this operation from its request or silently retry an interrupted attempt.

NFL context citations are produced by core's `researchReferences` and remain separate from retrieved sources. The final prompt lists their section restrictions; do not bypass attribution checks or turn plugin availability into sports evidence. Explicit evaluator `--attempt <label>` directories preserve previous results; `--case <id>` restricts a deliberate diagnostic. No default-ledger bypass or automatic paid retry is allowed. Read `NFL-LIVE-VALIDATION.md` for actual acceptance results and `NFL-SOURCES.md` before adding sports providers.

Read [MARKET-CATEGORIES.md](MARKET-CATEGORIES.md) for the catalog, v4 contracts and explicit `configure:categories` lab migration. `market-categories` in the CLI and `marketCategories` in Studio presets expose the core catalog; legacy provider categories remain available. `src/prompts/general-decision-system.ts` defines the immutable general final prompt and is snapshotted alongside NFL/legacy prompts. Protocol selection is core-owned; the adapter only chooses the corresponding structured schema.

## Shared runtime extraction

Mastra model, prompts, plugins and lease/background lifecycle now live in
`packages/agent-runtime`. The former files here re-export public package paths for local
compatibility. Change the shared implementation, not the forwarding files. Local composition
retains laboratory initialization; deployed composition never calls it. `validate:agent` is an
explicit paid operator command for a managed tenant/agent and validates readiness for that
configuration version. It does not initialize alpha/beta or change their global validation.

## Decision evaluation laboratory

`src/evaluate-decisions.ts` and `src/evaluation/decision-{cases,evaluation}.ts` implement the
isolated local comparison documented in [DECISION-EVALUATION.md](DECISION-EVALUATION.md).
`evaluate:decisions` defaults to an offline rules baseline; paid runs require an explicit unique
attempt, call limit and cost budget. No retries, runtime routing changes, database access or orders
are allowed. Never send expected labels to providers or treat missing usage as zero cost. Keep
synthetic development and holdout results separate; preserve started requests and failed attempts.
Version the rubric when its meaning changes. Monetary admission is an estimate, not a billing cap.

`prepare:decision-evidence` prepares unreviewed private datasets from explicit saved exports.
Graded `--dataset` evaluation requires recorded human labels, validates evidence timestamps/hashes and
prevents event/source leakage across splits. Synthetic and captured rubrics are separately versioned.
Never copy prior model judgments into reference labels or change historical paid evaluation records.
Independent-answer consistency flags are diagnostic only, not a production routing policy.

`--shadow --dataset` permits unscored captured replay with all provenance checks intact. It never
emits grades, even for reviewed input; accuracy and unsafe-finalization counts are null. This is a
laboratory replay, not runtime integration. Assistant annotations are not human-reviewed labels.

`prepare:decision-evidence --public-collection` imports explicit public excerpt snapshots; these
carry snapshot/event IDs rather than fabricated research run/market IDs. Optional
`--merge-dataset` validates the combined corpus. Event IDs prevent leakage across markets for
the same event. Public snapshots collected after a game are retrospective text tests, not pregame
captures. Coverage reports count explicit events, missing event IDs and reviewed cases.

`compare:decisions` reads only explicit local attempt directories, validates compatible rubric and
dataset fingerprints, rejects duplicate provider results, and simulates an exploratory Jev-first
cascade using paired responses. Missing pairs suppress savings projections; unknown research
cost and accuracy remain null. It makes no provider calls and never changes runtime routing.

## Local trading integration

The opt-in Polymarket pilot remains disabled by default. Read `../../apps/agent-service/LIVE-TRADING.md` for limits and acceptance gaps. No model tool or deployed signer is enabled by this change.

Person-authored `sources` and `skills` are honoured by `@pickler/agent-runtime`'s per-run scope
inside `createRuntime().execute`; read that package's AGENTS.md. The Cloudflare probe and
ephemeral-research entry points call core's runner directly on operator configuration and do not
apply them. Composed skills reach the model inside the profile, which prompts treat as data.

## Cloudflare trading pilot

Trading setup requires explicit TRADING_TENANT_ID/TRADING_AGENT_ID; it no longer assigns alpha. Node trading uses the same wallet-filtered claims and operator enablement as Cloudflare. See ../../docs/polymarket-worker-pilot.md.

## International Polymarket preproduction

The explicit `polymarket:preproduction` agent-service command only probes fixed public GET
routes. It loads no environment file, credentials, signer or database. The official environment
inherits chain 137; never equate its availability with Amoy or dummy-fund order acceptance.
See apps/agent-service/POLYMARKET-PREPRODUCTION.md from the repository root.

## Evaluator v2 laboratory

Read [DECISION-EVALUATION-V2.md](DECISION-EVALUATION-V2.md) for `prepare:decisions:v2` and
`evaluate:decisions:v2`. `src/evaluation/v2` owns context/fragments, five-question adapters,
evidence-backed blind fallback, fixed campaign accounting and per-event reports. All actual
execution remains local and opt-in. V2 paid calls require the complete jointly reviewed packet;
assistant proposals never count as human review. Preserve historical v1 text and attempt records.
The fixed campaign allows at most 176 calls and USD 0.50 additional accounted spend within USD 1.00
including historical reservations. Never reset its ledger, retry started calls, bypass unknown
charges or claim offline checks establish live-provider accuracy. No database or runtime changes.

V2 full-case reviews may explicitly use `kind: "assistant-delegated"` with an authorization record
when the user delegates review and execution. These can be scored in paid laboratory runs but
cannot pass the independent human-review acceptance gate. Never relabel delegated review as human.

V3 laboratory revision lives in `src/evaluation/v3` and `evaluate:decisions:v3`.
It preserves v2 files/results and closure checks, separates event relevance from truth, clarifies
practice versus game-status conflicts, and skips backups that cannot pass a hard veto. The LLM
control uses an explicitly versioned flat-JSON instruction, not the original v2 control prompt.
V3 shares v2's lock, USD 0.50 additional ceiling and 176 total started-call ceiling including
pending charges. Four selected development cases precede a 32-case replay; previously observed
cases must not be described as independent holdout validation. A v3 failure stops continuation.

V4 laboratory revision lives in `src/evaluation/v4` and `evaluate:decisions:v4`; read
[DECISION-EVALUATION-V4.md](DECISION-EVALUATION-V4.md). It keeps v3 prompts and closes only through
existing evidence checks. Coherent uncertainty skips backup. One synthetic diagnostic precedes
12 fresh retrospective cases; this is not the original independent acceptance sample. Safe
allowlisted metadata distinguishes failure stages; never persist raw diagnostic output. V4 reads
both v2 and v3 ledgers under their shared lock before admission. All revisions share the original
176-call/USD 0.50 ceilings and historical reservations. Any v4 failure stops further v4 calls.

## Runtime decision observation

`src/observation` and `observe:decisions` implement the separate opt-in local observation flow;
read [DECISION-OBSERVATION.md](DECISION-OBSERVATION.md). `createContainer` injects a file observer
only for explicit capture mode with a tenant/agent allowlist. It writes after the primary decision
is persisted and never calls providers, changes outcomes or grants trading access. Default is off.
Hosted Workers do not inject this observer. Keep exact original evidence hashes and unknown scope.

Paid observation is an explicit offline consumer of real runtime captures, with pinned campaign
configuration, carried-forward accounting, one control call, one Jev call and at most one blind
backup. It uses v3 questions/v4 policy without changing historical evaluator files. Persist started
calls before transport; unknown usage retains reservations and stops further work. Never auto-remove
STOP/LOCK, retry a started case, or initialize new ledgers to reset existing authorizations. Local
capture and paid replay are distinct modes, not autonomous production routing. No reference labels
are sent to providers and no accuracy/acceptance claim is made from paired agreement alone.

## Paper resolution

Paper CLI adds `paper-settle alpha|beta RUN_ID` and `paper-summary alpha|beta`. Settlement is explicit, reads finalized public contract state and persists only virtual results. No wallet or real trading key is needed. See PAPER-TRADING.md for historical compatibility and current sports-only scope.

## Continuous paper laboratory

## Evaluations

Read [EVALUATIONS.md](EVALUATIONS.md) and the [canonical architecture](../../docs/trading-architecture.md).
The single evaluation command dispatches frozen protocols through `@pickler/trading/evaluation`.
Local composition lives in `src/evaluation-host/local.ts`; shared scheduling, rounds and financial
rules belong in trading. Historical protocols expose only their documented read/reconciliation
commands. Never reintroduce old executable aliases or reset a paused session.

## Trading package boundary

Trading rules and financial ports are owned by `@pickler/trading` public subpaths. Core retains
identity, configuration and research contracts. Infrastructure implements the trading ports;
runtime composes adapters and models. Hosts must not duplicate risk, fills or accounting.

Perpl continuation runs retain the same tenant/network/database campaign budget. Read
[PERPS-STUDY.md](PERPS-STUDY.md) before starting one; never reset scope to obtain a fresh ceiling.

`evaluate stability --config FILE --env-file FILE --output DIRECTORY` runs one fixed thirty-minute Perpl public-data check (30 scheduled cycles). It uses a separate diagnostic PostgreSQL lease and existing agent permissions, never creates accounts or calls models. It parses only DATABASE_URL from the operator environment file. Reports are JSON/CSV/HTML; acceptance requires 29/30 valid joint BTC/ETH cycles and no lease/ownership failure. No automatic repeat or paid restart. The output directory has an exclusive STARTED marker. Paid Perpl run/resume requires a newly initialized record with coherent-20s-v1; historical report/settle remain available. macOS runs use the existing lid/idle-sleep guard, and persist local lease diagnostics.

Stability report v2 adds safe per-request connection observations and a single independent public
connectivity check after a failed acquisition with transport diagnostics. This check runs outside
the unchanged twenty-second acquisition deadline, takes at most three seconds of network time,
and requires current ownership. It never supplies market data or changes a cycle's validity.
Historical reports remain unchanged; no connection cause is inferred from a generic timeout.

Read [PERPL-STREAM-ACQUISITION.md](PERPL-STREAM-ACQUISITION.md) for evaluate data-diagnostic and stability --acquisition-choice. Ten fixed comparison opportunities freeze transport selection before one thirty-slot acceptance. Parse only loopback DATABASE_URL; no models/accounts/paid calls. Reports include bounded public captures and an offline cadence analyzer. New comparison preparation may explicitly freeze a choice; never upgrade historical sessions or automatically retry acceptance.

Read [PERPL-MODEL-DIAGNOSTIC.md](PERPL-MODEL-DIAGNOSTIC.md) for the explicit round-28 two-call
replay and its limits. It did not restart the comparison or resolve original unknown consumption.
JSONB context replay does not establish byte-identical request replay. Perpl deadlines now persist
MODEL_TIMEOUT; diagnostics are separate from executable decisions and preserve historical errors.

## Local four-way perpetual comparison

The explicit local `perps-four-way-v2` workflow and its three paid synthetic contract gates are documented in [PERPS-FOUR-WAY.md](PERPS-FOUR-WAY.md). Version 2 has four independent accounts and cannot resume a started comparison. Preserve the original USD 5 campaign and acknowledged unknown reservations; new unknown usage stops admission. Report commands do not call providers.

## Perpl decision audit

Read [PERPS-DECISION-AUDIT.md](PERPS-DECISION-AUDIT.md). The unified CLI exposes audit-export for an explicit loopback PostgreSQL read-only snapshot, and audit for an offline packet-only analysis. Audit dispatch must precede environment/provider composition. Never overwrite historical studies, reconstruct missing request bytes, call providers or reinterpret omissions as holds. The host owns packet integrity, safe diagnostics and HTML/CSV/JSON.

## Shared perpetual strategy preparation

Perpetual evaluation routes its four variants through the versioned
`@pickler/trading/strategies` registry. The host still owns files/configuration/report rendering;
never add a host-specific strategy switch or model route. Controlled boundary and PostgreSQL
replay tests cover this preparation. No Studio selector, paid session, restart or activation is
part of it; the v1 readiness protocol remains separately interpreted.

## Dynamic Studio markets

See the canonical selection/version, preservation and controlled acceptance boundaries below. No
runtime activation is implied.

See [agent-selected Perpl markets](../../docs/studio-perpl-markets.md).

## Private trading baseline

Read [TRADING-BASELINE.md](TRADING-BASELINE.md) for `evaluate baseline-export`, `baseline-verify`
and `baseline-restore-check`. Their dispatch precedes provider composition. Export consumes an
explicit inventory and loopback database configuration only; verify is offline; recovery uses
fresh directories and a separate PostgreSQL cluster. Never overwrite originals, omit changing
files silently, resume restored sessions, reset budgets or register the disabled PTS candidate.
Private artifacts stay outside Git. Source PTS bytes and prior strategy versions remain unchanged.

## Original SMA rules-only study

Read [SMA-ORIGINAL.md](SMA-ORIGINAL.md). Configuration v3 `perps-original-sma-v1` loads only loopback PostgreSQL and public Perpl data. Preserve hourly rules 1.0.0 and four-hour operator risk; no model clients, keys, reserves, fake arms or resume. The process writes reports each cycle; no automation is created.

## Local SMA review comparison

Read SMA-JEV-EXA.md for local v4 perps-sma-jev-exa-v1. One-shot synthetic validate uses an exclusive marker and run requires matching passed checks. Only PostgreSQL, public Perpl and explicitly authorized Jev/Exa are composed. Report/status call no providers. No automation, resume or real trading.

## Explicit SMA continuation

SMA v4 resume requires --allow-paid and a local operator-resume.json. It retains original checks, metadata, calls and portfolios and schedules only untouched slots with a new recorded clock segment. No automatic paid retry.

## Local universe comparison

Read [SMA-ALL-MARKETS.md](SMA-ALL-MARKETS.md) for configuration v5 and the one-shot eleven-market SMA/Jev/Exa comparison. `universe-data.ts` composes public data; `universe-report.ts` renders 264 identities offline. Synthetic contracts use their own record, renew ownership and exclude live news from controlled facts. USD 2.50 new retained reserves include checks, within the same USD 5 historical campaign. No resume, automation, merge or deployment.

## SMA profiles and selective exposure

Read [SMA-PROFILES-RISK.md](SMA-PROFILES-RISK.md). Configuration v6 exposes the four
profile/risk variants through the unified evaluator. `profiles-host.ts` parses only local
DATABASE_URL; `profiles-data.ts` composes the runtime public reader, and `profiles-report.ts`
renders 3,168 decision identities. No model/news/signing clients, paid validation, restart,
resume, automation, or deployment. The runner regenerates reports after observations and at
completion. Freeze commit, catalog, and configuration before the single six-hour run.
`profiles-resources.ts` attempts every cleanup and preserves the primary failure. Reports retain
the study commit separately from the report commit and export all execution/observation events,
including exits after admission slot 71. Read-only reporting never infers process liveness from
a persisted running state.
Risk summaries count the full confirmed mandatory-exit batch when an exposure breach initiated
it; they do not count only the first close whose pre-exit snapshot still exceeds the limit.
Individual exit conditions can coincide with that batch and are not independent causes.
Report hashes are memoized per immutable evidence object within one rendering; every decision
retains the same canonical digest without hashing a full snapshot again for each market/variant.
`audit-export` accepts the registered perpetual protocols; the historical model-decision
`audit` analyzer explicitly rejects unsupported profile protocols rather than fabricating arms.

## SMA reentry/latency comparison

[PERPS-SMA-REENTRY.md](PERPS-SMA-REENTRY.md) documents configuration v7 and the public-only two-portfolio protocol. `evaluate timing-check --state EXPORT --output NEW_DIRECTORY` runs offline before environment/provider composition and rejects environment/paid flags. `stability` performs one independent 30-minute eleven-market capture; `run` requires its passing proof matching commit/configuration, or the explicit pinned adoption for the separately authorized component paper policy below. `reentry-host.ts` composes only local PostgreSQL and public Perpl, emits compact per-observation status and coalesces full reports through `reentry-report-worker.mjs`. All file publication is atomic. Do not call models, restart, repeat qualification, extend deadlines, create monitors, merge or deploy automatically. Old monitors remain paused. New model calls/tokens/reservations are zero; historical budgets and records are unchanged. Tests include PostgreSQL atomic key consumption, common final evidence, mandatory price-exit priority and historical v6 parity.

The unified evaluation npm entry includes Node’s option separator before the script. Preserve it
so laboratory `--env-file` is handled by the application rather than preloaded by Node. V7 requires
a dedicated database-only file; offline timing and audit never load an environment.

V7 reports include `reentry-economics.json`/`.csv`, matching blocked keys to actual reference
positions and ledger postings. Pending funding and incomplete inputs remain unverifiable. Read
[the 2026-10-08 acceptance record](PERPS-SMA-REENTRY-ACCEPTANCE-20261008.md) before further public
work: the single qualification failed, so no six-hour comparison was started or authorized to
repeat automatically. Its artifacts and frozen qualification commit must remain intact.

Read [Perpl reader evidence](PERPL-READER-EVIDENCE.md) for the explicitly selected v7 acquisition
correction. `reader-audit` is offline and emits only allowlisted recorded facts in a new directory;
`reader-check` makes three public diagnostic captures with an independent local lease, never
qualification, trading or models. Its protocol cannot pass the six-hour run's qualification gate.
Preserve the failed acceptance and default v1 reader. The v2 selector, genuinely fresh bulk reads,
cache/network diagnostics and policy persistence are covered by controlled regressions. No
automatic acceptance repeat or strategy change is authorized by the correction.

## Local universe WebSocket qualification

Read [PERPL-UNIVERSE-WEBSOCKET.md](PERPL-UNIVERSE-WEBSOCKET.md) before public work with the
explicit v7 `stream-universe-20s-v1` selector. Stability v3 uses one continuous public reader,
independent diagnostic ownership, 30 slots, and 330 market rows. `stream-capture.ts` retains
at most a 32 MiB contiguous validated prefix with hashes and explicit truncation. Offline
reader-audit v3 verifies hashes and replays retained messages through pure reconstruction,
without environment, credentials or connections. Partial evidence cannot upgrade joint validity.
No economic run, paid call, restart, repeat, automation, merge or deployment is implicit.
Read [the one-shot result](PERPL-UNIVERSE-WEBSOCKET-ACCEPTANCE-20261008.md): it failed after two
valid cycles. Preserve the original generic summary and specific stream error. Post-check safe
limit counters and cancellation fixes have controlled validation only; missing historical limit
dimensions remain unverifiable and never authorize another public check.

The operator explicitly authorized further WSS repair and verification on 2026-10-08. Keep each
diagnostic and qualification in a new directory; preserve previous failed captures. `reader-check`
also accepts the explicit universe stream for three diagnostic reads and cannot pass economic
qualification. Stream v2 records processing/guard/queue counters and bounded snapshot requests.
Only a complete passing thirty-minute stability record establishes capture acceptance. This repair
authorization enables no trading, models, automation, merge, deployment, or economic comparison.

The universe stream v3 reconstructs messages synchronously and requires fresh guards
for buffer delivery. Its public repair qualification must preserve any failed earlier check.
Offline reader audit supports v2/v3 adapter captures and three-read stream diagnostics without
converting them to acceptance. No repeated subscription is considered evidence of fresh data.
Read [the v3 repair result](PERPL-UNIVERSE-WEBSOCKET-REPAIR-20261009.md): thirty slots completed
without transport or ownership errors, but only 17/30 joint captures were valid. Preserve that
failed availability gate and do not infer economic readiness from technical continuity.

Read [the component-policy record](PERPL-UNIVERSE-COMPONENT-POLICY-20261009.md) for the separately
authorized 2026-10-09 capture experiment `stream-universe-component-20s-v2`. Stability/audit v4
records its independent native freshness rule, heartbeat continuity, strict-rule counts and
`financialExecutable: false`. Financial host commands reject it before environment loading;
account initialization rejects it before writes. Preserve old captures and their failed gates.
Offline candidates never count as prospective acceptance or upgrade historical outcomes.

The component-policy public measurement at frozen commit `46bcca8c36d91edd0508ff05e3f6b6aedab304df`
passed 30/30 joint cycles and 330/330 market observations; the unchanged strict rule accepts
11/30 of the same snapshots. Independent offline/PostgreSQL proof confirmed hashes, closure,
release and zero diagnostic accounts/decision rounds. This is capture acceptance only.
That capture alone does not authorize financial execution or upgrade the old 17/30 failure.
Read the component-policy record for immutable artifact paths and limitations.

The operator separately authorized `stream-universe-component-paper-20s-v1` and one six-hour
v7 economic experiment on 2026-10-09. Read [the paper policy](PERPL-COMPONENT-PAPER.md).
It requires immutable account policy, native freshness and copied heartbeat proof through financial
validation and transactional admission. `component-qualification.ts` explicitly adopts a pinned,
complete capture with offline replay and unchanged transport source; it never invents historical
fills. New paper preflight is offline; financial-selector stability is rejected. Preserve capture
artifacts, strategies, historical reservations, one-shot deadlines and zero models/signers.

Component paper failures publish `financial-frame-validation-failed` with allowlisted reason,
frame hash and distinct receipt/database clocks; runtime status retains the same safe details.
The first execution stopped after four slots and remains interrupted with open positions.
The clock regression is proven in controlled tests; its exact historical triggering values were
not recorded. Preserve that distinction and the first run's evidence when continuing authorized
repair work. Never silently resume a started session or overwrite its history.

Component-paper controlled PostgreSQL tests include captured-frame atomic rollback, racing
closes, idempotency, hash/owner rejection and paired thirty-sample query-delay benchmarks.
Simulated clock delays are reported separately from monotonic measured durations. An interrupted
comparison with a partial account fill remains incomplete; never present it as a common round.

The third component-paper session at `b1bb7fb0226ba0f33b072f03f23e253684ceab42` remains
interrupted before its six-hour end with 68 complete slots. Recorded BTC ticker age advanced from
29,694ms at copy to 30,189ms at validation while sequential account valuation was in progress.
The corrected component-only runner uses a common transaction and records confirmed expiry
rollback separately from partial/uncertain writes. Preserve this session, its pending positions
and failure export. The controlled regression reproduces the dates with synthetic frame bodies;
it never claims to recover the rejected historical bytes or completes the interrupted trial.

A component-paper database timeout remains a fatal persistence interruption, with the specific
`PERSISTENCE_QUERY_TIMEOUT` code on corrected executions; a recognized connection deadline is
`PERSISTENCE_CONNECTION_TIMEOUT`. Never reinterpret an interrupted
historical generic code or pending positions as completed/closed. Keep database-load attribution
bounded by recorded evidence; a coincident checkpoint alone cannot identify every causal workload.
An explicitly authorized zero-model continuation may use a separate local physical server only
after restoring and verifying the complete existing campaign history, reservations and table
hashes. Keep the original server and failed sessions intact; never use duplicate copies as fresh
monetary budget authority. Controlled database tests must finish before freezing that runner.
