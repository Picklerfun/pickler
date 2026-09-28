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

Manual simulation is documented in [PAPER-TRADING.md](PAPER-TRADING.md). The composition root binds `PostgresPaperStore` and the core paper service into the same tenant API used by Node and Cloudflare. CLI commands `paper-buy` and `paper-result` require a run ID; requests remain manually initiated. The paper plugin has no LLM tool. Never detach this operation from its request or silently retry an interrupted attempt.

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

Read [PAPER-STUDY.md](PAPER-STUDY.md) before changing `src/paper-study`. `paper:study` runs an explicit local operator session with atomic JSON persistence, a single-writer lock and HTML/CSV reports. It is separate from production tenant research, never uses signer credentials, and requires explicit paid approval plus configured rates. No paid calls on import or preflight. Preserve interrupted attempts and original budget/time windows on resume.

`paper:study run` now uses active Jev-first routing automatically, with explicit paid admission and
both credentials. Require verified `jevInputPerMillion`; no hidden activation flag. Preserve separate
Jev/DeepSeek usage, stop after unknown routed charges and retain all old study snapshots. See
PAPER-STUDY.md for the readiness gate, full-forecast fallback and historical resume boundary.

Routing adapter 1.0.2 adds optional `answerDiagnostics` on rejected Jev answers: fixed question/field/error-code labels, value shapes and key counts, capped at 16 issues. Never persist rejected values, unknown key names, raw paths or provider error messages. Validation, routing and stop rules are unchanged; this diagnostic change does not establish live-provider acceptance.

## Perpl public data plugin

Read [PERPL-DATA.md](PERPL-DATA.md) for the opt-in `perpl:data configure|check|capture` operator command. It uses an existing scoped database agent, no model/key, and never seeds/migrates. Configure is version-checked and disables scheduling. Captures use exclusive private attempt directories, original bodies, hashes and incomplete manifests. `test/perpl-public.probe.ts` is an explicit public-network probe with an in-memory verification agent; it is excluded from automatic tests and never modifies real configurations.
