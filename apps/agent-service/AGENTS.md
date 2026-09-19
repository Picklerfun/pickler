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
