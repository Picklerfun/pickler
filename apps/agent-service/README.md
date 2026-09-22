# Pickler research pilot

Local Mastra Studio and a tenant-scoped HTTP API for research-only decisions. Polymarket supplies markets, resolution rules and order books; Exa supplies web search and page content. The configured OpenAI-compatible model chooses one candidate and returns a validated `TRADE` proposal or `ABSTAIN`. Research itself does not submit orders or expose signing tools. Optional manual simulation and the separately disabled Node trading integration are documented below.

## First local run

Use Node **22.22+** (Node 24 also works) and npm 10.9.3. From the repository root:

```sh
npm ci
npm run agent -- init
```

Edit `apps/agent-service/.env`. `init` generates distinct random laboratory tokens without printing them and refuses to overwrite an existing file. Supply both database URLs described below and all four provider settings:

- `MODEL_BASE_URL`: the exact OpenAI-compatible API base URL, including its version path when required.
- `MODEL_ID`: the exact model identifier accepted by that endpoint.
- `MODEL_API_KEY`: that endpoint's API key.
- `EXA_API_KEY`: your Exa key.

No default model, fallback provider or trading key is used. HTTPS is required except for a model hosted on loopback. Compatibility depends on tool calling and structured output support; the explicit connection check verifies both with your chosen model.

Configure PostgreSQL and run `npm run db:migrate` using the instructions below before starting.

```sh
npm run dev:agent
```

Open **http://127.0.0.1:4111**. This starts Studio and one worker. Use this exact address rather than `localhost`: Host and Origin checks protect the privileged operator surface. Keep the terminal and computer running for scheduled work. No paid provider calls occur merely on startup, but previously enabled schedules and pending jobs can run.

In Studio, open **Workflows**:

1. Run `lab-presets` with `{}` to inspect both agents, their current configuration versions, the first 100 Polymarket tags and the two internal plugins. Tags serve as configurable categories; a known Polymarket tag ID can also be configured directly.
2. Run `configure-agent` with the preset `alpha` or `beta`, its current `expectedVersion` and a full `config`. Copy the existing config and replace `categoryIds` with selected IDs. Empty categories grant no market access. Each edit increments the version and disables scheduling.
3. Run `check-connections` with `{"runPaidCheck":true}`. This intentionally calls the model twice, invokes a harmless tool, validates a structured model assessment, and checks Exa search/read and the public category API. A failed check does not choose another model.
4. Run `research` with `{"preset":"alpha","requestKey":"my-first-research"}`. Use a new request key for new work; reuse it to observe the original job. Optionally add a numeric `marketId` to research a specific market within the same permitted categories.
5. Inspect the workflow result: run ID, status, decision and persisted events including candidates, selection, rules, quotes, search queries, evidence and reported model usage. `failed` is not a research abstention. If the workflow reports `poll-via-api`, continue polling its run ID; it does not enqueue another job.

Studio is privileged **local operator access**, not a tenant login. Raw researcher agents are intentionally not registered as independently callable Studio agents: that would bypass the persistent queue and quotas. The workflow exposes the reviewed plugin catalog and recorded tool results. Both presets, the API and scheduler enter the same queue and core runner.

## PostgreSQL, Supabase and migrations

Use one PostgreSQL database with separate `pickler` and `mastra` schemas. Supabase hosts PostgreSQL; this backend connects using the PostgreSQL connection string, not the Supabase browser client, anon key, or service-role API key.

1. In your Supabase project's **Connect** panel, copy the **Direct connection** URL when your network supports it, or the **Session pooler** URL for IPv4. Use session mode on port 5432, not transaction mode on port 6543: worker ownership requires a persistent PostgreSQL session.
2. Set `DATABASE_URL` in `apps/agent-service/.env`. Keep the provider's TLS settings and enable SSL enforcement in Supabase. Never disable certificate verification. URL-encode special characters in the database password.
3. Set `DATABASE_MIGRATION_URL` to a direct or session connection with schema creation privileges. For this operator-only pilot, both URLs can use the same database owner. Runtime must own the Pickler tables (or have BYPASSRLS) because no tenant-facing SQL policies are installed. Mastra currently initializes its own schema at startup, so its connection also needs schema/table creation privileges.
4. Run `npm run db:migrate` from the repository root. This applies committed Drizzle migrations; running it again is safe. Run one migration process per deployment. Start the agent afterwards; startup seeds the two lab agents idempotently.

The database schemas are server-only. Do not add `pickler`, `pickler_migrations`, or `mastra` to Supabase's exposed Data API schemas or grant browser roles access. Pickler tables enable RLS without public policies as a default denial for non-owner roles. The privileged backend bypasses RLS and enforces tenant scope in repository queries and the API; these are not Supabase Auth policies. Public login and production role separation remain separate work.

### Full local Supabase stack

Install Docker and the Supabase CLI (verified with version 2.111.0), then run from the repository root:

```sh
npm run supabase:start
npm run agent -- init # Once; refuses to overwrite an existing .env
```

Set both database URLs in `apps/agent-service/.env` to `postgresql://postgres:postgres@127.0.0.1:54522/postgres`, then run:

```sh
npm run db:migrate
npm run test:supabase
```

Studio is at http://127.0.0.1:54523 and the local Supabase API is at http://127.0.0.1:54521. These ports are isolated from the default Supabase ports. `pickler` and `mastra` remain outside the exposed API schemas. Drizzle remains the owner of Pickler migrations; do not duplicate them under `supabase/migrations` or run database resets to apply application changes.

`npm run supabase:stop` preserves local data. `npm run supabase:status` shows service endpoints and local development keys; do not paste its full output into public logs. Database integration tests require no model/Exa credentials. Starting the research agent still requires the four provider variables. Supabase Studio and Mastra Studio are separate applications.

### PostgreSQL-only alternative

For local development without Supabase:

```sh
npm run db:up
```

Set both database URLs to `postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler`, then run `npm run db:migrate`. These credentials are only for the loopback Docker development service. `npm run db:down` stops the container and preserves its named volume.

To change tables, edit `packages/infrastructure/src/persistence/schema.ts`, run `npm run db:generate`, review the generated SQL and commit the migration and snapshots. Apply with `npm run db:migrate`. Do not use schema push against shared databases. Mastra manages its own tables; Drizzle owns only `pickler`.

Integration tests use real PostgreSQL and create a randomly named `pickler_test_*` database per test, apply migrations, then remove only that database. They default to the local Docker connection. Set `TEST_DATABASE_URL` to override with a **dedicated test server** and a role with `CREATEDB`; never use production. No Supabase account or paid model credentials are required for these tests.

This migration starts a fresh PostgreSQL pilot. Existing ignored SQLite files are left intact; their data is not automatically imported. If a previous pilot contains valuable history, retain those files and perform a separately reviewed data import before switching environments.

References: [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Drizzle with Supabase](https://orm.drizzle.team/docs/get-started/supabase-new), [Mastra PostgreSQL](https://mastra.ai/integrations/databases/postgresql).

## CLI and API

All commands below run at repository root, with the service running. CLI tokens come from the app's `.env`; do not put tokens in URLs or commit them.

```sh
npm run agent -- agents alpha
npm run agent -- categories alpha
npm run agent -- check alpha
npm run agent -- configure alpha config.json
npm run agent -- run alpha
npm run agent -- run alpha 2252242
npm run agent -- result alpha RUN_ID
npm run agent -- events alpha RUN_ID
npm run agent -- schedule alpha on
npm run agent -- schedule alpha off
npm run agent -- pause alpha
npm run agent -- resume alpha
```

The market ID above illustrates syntax, not a durable recommendation. `config.json` is resolved relative to `apps/agent-service` by the CLI. Example configuration update (replace category IDs with your selection and use the version returned by `agents`):

```json
{
  "expectedVersion": 1,
  "config": {
    "profile": "Read resolution rules and research both supporting and contrary evidence. Abstain when uncertain.",
    "categoryIds": ["2"],
    "tools": ["searchWeb", "readPage", "getMarketRules", "getOrderBook"],
    "uncertaintyPolicy": {
      "blockHighUncertainty": true,
      "requireCompleteInformation": true,
      "minProbabilityMargin": 0.01,
      "maxProbabilityRangeWidth": 0.2
    },
    "intervalHours": 4,
    "limits": {
      "searches": 3,
      "pageReads": 5,
      "steps": 12,
      "durationMs": 300000,
      "outputTokens": 32768,
      "dailyRuns": 6
    }
  }
}
```

HTTP base: `http://127.0.0.1:4111/pilot`. Send `Authorization: Bearer <tenant-token>` on every endpoint. Tokens resolve to a fixed tenant on the server; neither JSON input nor model context can choose the API tenant.

| Method | Path                   | Behavior                                                                             |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/categories`          | First 100 provider tags; response states the catalog limit                           |
| GET    | `/agents`              | Only the authenticated tenant's agent                                                |
| GET    | `/agents/:id`          | Configuration, version, pause and next occurrence                                    |
| PUT    | `/agents/:id/config`   | Full config and `expectedVersion`; stale writes return 409                           |
| POST   | `/agents/:id/runs`     | `{}` or `{ "marketId": "..." }`; required `Idempotency-Key` header; 202 with `runId` |
| GET    | `/runs/:id`            | Poll status, safe failure code and decision                                          |
| GET    | `/runs/:id/events`     | Persisted partial evidence and diagnostic events                                     |
| PUT    | `/agents/:id/schedule` | `{ "enabled": true }` or false                                                       |
| PUT    | `/agents/:id/pause`    | `{ "paused": true }` or false                                                        |
| POST   | `/connections/check`   | Explicit paid model/Exa diagnostics                                                  |

Use the same idempotency key to retry an ambiguous dispatch. Reusing a key with a different market returns 409. Cross-tenant resource access returns 404; missing/invalid tokens return 401. Public schemas live in `@pickler/api-schema`. Times in run/config DTOs are Unix milliseconds; evidence and decision timestamps are ISO UTC. Prices are decimal strings expressing fractions of one unit of outcome payout per share. They are proposals, not executable amounts.

## Execution and persistence

- `pickler` PostgreSQL schema: tenant configuration, queued jobs, immutable config snapshots, JSONB events and decisions, accessed through Drizzle and `pg`.
- `mastra` PostgreSQL schema: framework storage through `@mastra/pg`, initialized by Mastra. It is operator-visible, not a public tenant resource.
- PostgreSQL enforces five active investigations globally, two per tenant and one per agent by default. Claims use a short policy-row transaction; each investigation holds a renewable 60-second lease. Node remains sequential per process, but multiple executors may safely share a migrated database. Evidence and finalization require ownership. See [concurrency validation and migration](CLOUDFLARE-BACKGROUND.md).

A job ID is its run ID. Scheduled occurrence is encoded in its unique persistent request key (`schedule:CONFIG_VERSION:DUE_TIMESTAMP`), alongside the agent's persisted `nextDueAt`. Duplicate ticks cannot enqueue duplicate work. Missed intervals collapse into one current run. An existing queued/running job prevents a new periodic enqueue. Six jobs per rolling 24 hours is the default; failed/cancelled jobs also consume the conservative admission quota.

Running jobs with expired leases become `failed/INTERRUPTED` during reconciliation and retain their events. They are never automatically retried. Unstarted manual jobs remain pending. Pausing cancels pending jobs and prevents future tool calls in running jobs; it cannot undo a provider call already in flight. Resuming keeps the configured schedule, coalescing missed occurrences. A config edit cancels stale pending work at claim time and blocks subsequent calls from an old running version.

Scheduling starts disabled. Enabling it requires a successful connection check plus completed manual research for the agent's current config. Changing model endpoint, model ID or provider credentials invalidates readiness and disables schedules. Restarting with the same settings preserves scheduling. The default interval is four hours, configurable from one hour to seven days.

Limits can be reduced (at least two searches and three model steps) but cannot exceed the pilot caps: three searches, five page reads, twelve total model steps (one reserved for candidate selection), five minutes and 32,768 output tokens per research model call (selection and connectivity probes remain capped at 2,000); six jobs per rolling day. Market discovery returns at most 20 candidates, ranked by reported liquidity; it queries up to 20 per selected tag, deduplicates and retains the top 20. Selected market tags are independently fetched before research. Rules cannot exceed 16,000 characters; larger rules fail rather than being silently cut. Exa content is capped at 6,000 characters per source and marked when truncated. HTTP provider responses have a two-megabyte cap and 20-second timeout; individual model requests have a 180-second timeout within the overall run deadline. Reported usage is stored when available, not invented when absent. These are usage bounds, not a guaranteed monetary budget.

The runner checks permissions again before every capability call. Mandatory rules, order book and search capabilities must be enabled to begin research. Page reads are restricted to URLs discovered in that run. Provider failures cannot be converted to successful abstentions by the model. A `TRADE` proposal rechecks market eligibility and refreshes the outcome's ask; a missing/stale quote fails the run, and a fresh ask above the proposed limit yields an explained abstention. Source IDs must refer to retrieved evidence. Both a supporting and a contradicting search intent are required before a decision can complete; queries and intent are persisted for review. Research quality still needs human review; the pilot validates operation, not profitability.

## System prompts and user customization

System instructions live in `src/prompts/research-system.ts` and `src/prompts/market-selection-system.ts`. Each definition contains a stable ID, a semantic version and its exact instructions; the service computes a SHA-256 fingerprint of the UTF-8 text. Increment the version whenever editing the instructions. The initial extraction is version `1.0.0` and preserves the previous prompt text.

Every started investigation saves both configured definitions (ID, version, fingerprint and full text) under `prompts` in its first `runtime` event, before permissions/provider calls. Read them with `npm run agent -- events alpha RUN_ID` or the authenticated events endpoint. Snapshots survive subsequent code changes and failed research. Recording a selection prompt does not imply selection occurred: manual-market runs skip that step. Queued jobs use the installed runtime when they start; they do not pin code at enqueue time. Jobs cancelled before starting and historical runs do not acquire new snapshots retroactively.

User customization remains `config.profile`, versioned per agent and copied into each run. It is sent as task data alongside the market/candidates, never appended to the trusted system prompt. Profiles can express research preferences but cannot grant tools, expand categories or change quotas. Evidence is persisted per investigation; this does not introduce automatic memory between runs. Connectivity-check prompts remain separate diagnostic fixtures.

Prompt snapshots use existing JSONB events; no new tables or migration are required.

## Code map and extension

```text
src/
  mastra/index.ts          # Studio workflows and loopback HTTP host
  api/app.ts               # Token resolution, request validation and HTTP mapping
  composition/container.ts # Wires core, providers, PostgreSQL and the configured model
  composition/model.ts     # Mastra implementation of ResearchModel
  prompts/                 # Versioned system instructions and SHA-256 snapshots
  config/env.ts            # Required server-only configuration
  plugins/registry.ts      # Reviewed research@1.0.0 and prediction-markets@1.0.0
  workers/main.ts          # Sequential leased executor and expired-job recovery
  cli.ts                   # Operator commands
../../packages/core/src/features/research/
  types.ts                 # Entities and capability/repository ports
  policy.ts                # Quotas, schedule readiness, intervals and decimal comparison
  run-research.ts          # Framework-independent research orchestration
../../packages/infrastructure/src/
  research/exa.ts          # WebSearch and PageReader
  polymarket/market-data.ts
  persistence/schema.ts       # Drizzle tables, JSONB types, constraints and indexes
  persistence/research-store.ts # Transactional PostgreSQL adapter
  persistence/migrate.ts      # Explicit migration runner
  ../drizzle/                # Committed SQL migrations and Drizzle snapshots
```

To add Firecrawl, implement `WebSearch` and `PageReader`, run the provider contract tests against that adapter, and select it in composition. Core and plugin tool contracts should not change. No dynamic installation of external plugin code is supported.

Shared packages compile to ESM `dist` with declarations; Mastra packages those artifacts. `npm run dev:agent` builds them first. After editing a shared package, rebuild it and restart the agent. From root:

```sh
npm run lint
npm run typecheck
npm run db:up
npm test
npm run build
npm run start --workspace=@pickler/agent-service
```

The production build command still starts a local laboratory host, not a hardened deployment. Do not expose Studio through a public tunnel. Public login, production scheduling/queues and on-chain contracts remain separate work. The optional local trading integration is not a hardened production deployment.

Tests use controlled clocks, isolated PostgreSQL databases and explicitly injected test transports. They do not call paid providers or manufacture production results. Run the real `check` and a manual research job after supplying credentials; automated offline tests do not establish compatibility of an untested remote model.

Provider references: [Mastra workflows](https://mastra.ai/docs/workflows/overview), [custom routes](https://mastra.ai/docs/server/custom-api-routes), [PostgreSQL storage](https://mastra.ai/integrations/databases/postgresql), [Exa search](https://exa.ai/docs/reference/search), [Polymarket markets](https://docs.polymarket.com/api-reference/markets/list-markets), [market tags](https://docs.polymarket.com/api-reference/markets/get-market-tags-by-id).

## Market dates and model diagnostics

The pilot only researches active markets in the configured categories with a known, valid future closing date. A date equal to the current time is already closed. Missing dates are excluded conservatively; this also applies to manually supplied market IDs. The runner checks eligibility before selection, when loading the selected market, and again before finalizing a trade proposal. Provider `active` flags alone are insufficient. Discovery retains both the provider candidates and the filtered `eligible_candidates` event. The selector receives the current UTC time from the runner clock.

Inspect failures with `npm run agent -- events alpha RUN_ID` and `npm run agent -- result alpha RUN_ID`. A `model_failure` event identifies `selection` or `research` and includes available HTTP status, finish reason and numeric token counts. Codes distinguish `MODEL_HTTP_<status>`, `MODEL_TIMEOUT`, `MODEL_CANCELLED`, `MODEL_OUTPUT_TRUNCATED`, `MODEL_INVALID_JSON`, `MODEL_INVALID_OUTPUT`, `MODEL_NO_STRUCTURED_OUTPUT`, and `MODEL_CONTENT_FILTERED`. Unrecognized errors remain `MODEL_FAILURE`; never infer a cause from that code alone. Provider error text, response bodies and reasoning text are not persisted. These failures do not create abstention decisions or trigger automatic retries. Historical generic failures cannot be reconstructed retroactively.

For DashScope endpoints (`dashscope.aliyuncs.com` and `dashscope-intl.aliyuncs.com`), market selection explicitly sends `enable_thinking: false` through provider options. Research and connectivity probes retain provider defaults; research allows up to 32,768 output tokens per call while selection and connectivity probes remain capped at 2,000. This is a request setting, not a prompt instruction. Other compatible providers need their own documented controls; do not send DashScope-specific options to them.

## Decision v2 and uncertainty policy

New decisions have `schemaVersion: 2`. Top-level action, explanation, prices and citations describe the final result. `modelAssessment` preserves the model's original proposal, including `probability: { lower, estimate, upper }` (or null), `uncertaintyLevel` and `missingInformation`. `policyEvaluation` stores policy version `1.0.0`, effective configuration, final action, reason codes and evaluation time. Only core creates the policy verdict; model output cannot supply or override it. Top-level `estimatedProbability` mirrors the model's estimate for compatibility, not an independently verified probability.

The conservative defaults block high uncertainty and any reported missing material information. They require a probability range no wider than 0.2 (20 percentage points) and a lower probability estimate strictly greater than the worse of refreshed ask and proposed limit plus 0.01 (one percentage point). These are configurable product thresholds, not evidence of profitability, calibrated confidence intervals or exact fee estimates. Ordering must satisfy `0 <= lower <= estimate <= upper <= 1`. Missing probability blocks a trade; malformed ranges fail the run. A refreshed ask above the proposed limit also forces abstention. A model abstention is never promoted to a trade.

Policy fields are configured through the existing agent configuration endpoint or `configure-agent` workflow. The configuration is versioned per agent, copied into new runs, and edits disable scheduling and invalidate old pending work. Omitted policy settings on legacy configs resolve to conservative defaults, recorded in runtime and evaluation events. Legacy decisions remain unversioned, readable and unchanged; they are not retroactively treated as evaluated by the new policy. JSONB storage requires no SQL migration.

For a Vinicius-like proposal with estimate 0.003, range 0.0005–0.01, HIGH uncertainty, missing facts and a price of 0.001, the final action becomes ABSTAIN with `HIGH_UNCERTAINTY`, `MISSING_INFORMATION` and `INSUFFICIENT_CONSERVATIVE_MARGIN`. The original TRADE proposal remains in `modelAssessment`. Inspect `model_assessment` and `policy_evaluation` through the existing run events endpoint. Provider failures, absent quotes and invalid output remain failed runs, not policy abstentions.

## Cloudflare compatibility experiment

See [CLOUDFLARE-PROBE.md](CLOUDFLARE-PROBE.md) for the isolated workerd experiment, verified live local research, interruption behavior and remaining remote/production boundaries. This does not change the normal Studio or worker startup.

For the separate local `202 + runId` → Queue consumer → PostgreSQL → status polling experiment, see [Cloudflare background research](CLOUDFLARE-BACKGROUND.md). It uses an isolated Supabase database and does not change the retained remote probe or the normal Node pilot.

Operator concurrency configuration (no provider calls):

```sh
npm run agent -- concurrency 5 2
```

Arguments are the global and default per-tenant limits; values are persisted in PostgreSQL. Existing work is not aborted when lowering limits. No new environment variables are required. Stop old executors before applying migrations 0001/0002 and restart only updated binaries. Migrations preserve queued work/history and interrupt old unleased running jobs; the database guard rejects legacy recovery of another execution's valid lease.

See [research reliability](RELIABILITY.md) for the two-phase model flow, pre-event Sports policy, safe diagnostic events and explicit model diagnostic commands.

See [Configurable NFL research](NFL-RESEARCH.md) for plugin configuration, structured sources, decision v3 and explicit evaluation commands.

See [Manual paper trading](PAPER-TRADING.md) for the optional paper plugin, endpoints, CLI, migration and simulation assumptions.

## Sports categories

See [MARKET-CATEGORIES.md](MARKET-CATEGORIES.md) for category/subcategory configuration, automatic NFL/general research protocols, decision v4, compatibility and local validation.

## Optional local trading integration

See [LIVE-TRADING.md](LIVE-TRADING.md) for the separately disabled Node pilot, explicit operator wallet/setup commands, API/CLI contracts and controlled-test status. This does not enable trading for existing agents or establish live-provider acceptance.
