# Research runtime v2: a money budget, markets beyond sports, better schedules

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`. Every
decision is reversible unless the table says otherwise.

This spec covers five follow-ups to `docs/specs/agent-runtime-v1.md` that research 04
(`docs/product-map/research/04-runtime.md`) found unbuilt: a monetary research budget that the
runner actually reserves against, the next market categories after sports, calendar schedules and
agent-requested follow-ups, a decision on the dormant agent HMAC API, and the paid staging
acceptance record that is still missing. Decision resolution, public picks, decision review and
exit monitoring are other specs in this session and are not repeated here.

## 1. Problem and users

**Users.** Agent owners in the studio, who need to know what research costs and to control when an
agent runs. The Pickler operator, who pays the providers today and needs spend to be bounded.

**Problem.**

1. **No money limit on research.** The runner bounds counts (`MAX_LIMITS`: 3 searches, 5 page reads,
   12 steps, 32 768 output tokens, 6 runs a day, `packages/core/src/features/research/types.ts:23-30`),
   but "usage bounds, not a guaranteed monetary budget" (`apps/agent-service/README.md:173`). A
   micro-USD reservation ledger exists (`packages/core/src/features/budget/domain/ledger.ts:161`,
   `packages/infrastructure/src/studio/budget.ts:23`, tables `budget.budgets` and
   `budget.ledger_entries`), and only a read route uses it (`workers/api/src/routes/agents.ts:50-60`).
   `run-research.ts` reserves nothing before its search (`:262`) or model (`:375`) calls.
2. **Sports only.** `MarketScope` is `{ version: 1, category: "sports" }`, and `assertMarketScope`
   refuses anything else (`packages/core/src/features/research/market-scope.ts:7-12,41-52`). The BTC
   and Perpl work exists only in laboratories.
3. **Scheduling is a fixed interval** (1–168 h, `types.ts:741-743`) with a boolean and a next-due
   time on `pickler.agents` (`packages/infrastructure/src/persistence/schema.ts:30-31`). There are no
   timezone, calendar or follow-ups, although agent-runtime-v1 "Scheduling and autonomous follow-ups"
   (lines 228-234) specifies all three.
4. **The agent HMAC API is dormant.** There is a verifier
   (`packages/core/src/features/agent-registry/application/authenticate-agent.ts:72-116`), a
   middleware (`workers/api/src/middleware/agent-auth.ts:26-70`) and three read routes
   (`routes/agents.ts:38-60`). Nothing issues a secret: `agents.agent_credentials` is written only by a
   test (research 04 §2). No Pickler agent calls it, because the runtime runs in-process.
5. **No successful paid run on staging is recorded.** The only record shows two failed manual runs
   (`docs/staging-deployment-2026-09-20.md:163-190`), and the acceptance protocol in
   `docs/cloudflare-staging.md:166-175` has never completed.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Reason                                                                                                                                                                                | Reversible?                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| R1  | **One reservation per run, for the worst case, before the first paid call.** The runner computes the run's ceiling from its limits and the tariff, and reserves it on the agent's ledger. It commits the actual cost when the run ends and releases the rest. A refused reservation fails the run as `BUDGET_EXHAUSTED` with no provider call.                                                                                                                                                                                                                                                                     | The limits already bound the worst case. One reservation cannot overshoot, is idempotent by run ID, and needs no step-level ledger round trip.                                        | yes                                                           |
| R2  | **Unknown cost is charged as the full reservation.** If a provider reports no usage, or the tariff has no price for the model, the commit is the reserved amount. A run whose model has no tariff entry is refused before it starts (`TARIFF_MISSING`).                                                                                                                                                                                                                                                                                                                                                            | Fail closed (agent-runtime-v1 l.145; research 04 spec 5). Provider costs are never invented downwards (`docs/cloudflare-unification.md:70`).                                          | yes                                                           |
| R3  | **Categories.** Model tokens go to `tokens`. Search, page reads and data providers (Exa, the odds and sports APIs) go to `infra`. `payments` stays for paid reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | They are the ledger's existing categories (`ledger.ts:24`), and the owner sees the two costs apart.                                                                                   | yes                                                           |
| R4  | **Who pays in v1: Pickler.** Each agent gets a platform research allowance, `RESEARCH_MONTHLY_ALLOWANCE_MICRO_USD` (default 5 000 000 = $5 a month), split `tokens` 80% and `infra` 20%. The owner may **lower** the limit, never raise it above the allowance. It is not charged to the agent's AUSD wallet.                                                                                                                                                                                                                                                                                                      | The ledger cannot debit an on-chain balance, and the delegated user can sign nothing (studio-create-and-fund-v1 §4.1). Charging owners is a pricing decision (§12).                   | yes                                                           |
| R5  | **Paid-read runs use a separate `reads` budget scope** (conventions decision 11). A read run never touches the agent's ledger or its monthly allowance. It reserves against **that read's compute ceiling**, which `paid-reads-v1.md` sets (default: the lower of 20% of the price and 2 AUSD) and stores on the read. Pickler pays it out of the read fee. A read whose ceiling is below one run's ceiling (§3.1 formula) is refused at purchase by paid-reads-v1, not failed at run time. AUSD is converted to micro-USD at 1:1 (AUSD is a USD stablecoin).                                                      | A buyer's read must not fail because the scheduled runs spent the month, and an owner's research budget must not pay for a buyer's question (cross-review C2).                        | yes                                                           |
| R6  | **Tariffs** are a versioned JSON var `RESEARCH_TARIFFS` on `workers/research` and `workers/api`: micro-USD per million input and output tokens per model ID, per search and per page read per provider. The `runtime` event records the tariff version.                                                                                                                                                                                                                                                                                                                                                            | Prices change. A run must say what it was charged under.                                                                                                                              | yes                                                           |
| R7  | **Next category: crypto up/down** (Polymarket daily "BTC above X" and "ETH above X"). It uses the BTC laboratory's protocol ported to a product protocol `crypto-updown-v1`, and a spot price plugin. **Then Perpl perps**, whose protocol `perps-direction-v1` (instrument, direction, entry, horizon, resolution by Perpl mark price) is defined in `perpl-agent-runtime-v1.md` (conventions decision 12). This spec only adds the category to the catalog. Politics and general Polymarket categories come later.                                                                                               | Crypto has the most laboratory evidence (BTC v3 paired comparison, research 04 §2). One protocol spec breaks the cycle between `perpl-live-v1.md` and this one (cross-review C3, K1). | yes                                                           |
| R8  | **`MarketScope` v2** holds several categories: `{ version: 2, categories: [{ id: "sports", subcategories }, { id: "crypto", assets: ["BTC","ETH"] }] }`. v1 is read and upgraded in memory, and is never rewritten in stored runs.                                                                                                                                                                                                                                                                                                                                                                                 | An agent may cover more than one category. Old runs keep the config they ran under.                                                                                                   | yes                                                           |
| R9  | **Soon → live rule** for a category: the protocol is merged; 20 paper runs on staging with at least 18 reaching a decision (TRADE or evidence-backed ABSTAIN) without a provider failure; a resolution source wired in `decision-resolution-v1.md`; and the owner's sign-off recorded in the acceptance doc. Until then the catalog marks it `soon`.                                                                                                                                                                                                                                                               | Stops a category going live on a prompt alone.                                                                                                                                        | yes                                                           |
| R10 | **Calendar schedules** join intervals. They have an IANA timezone, local times (at most 4 a day) and weekdays. DST follows agent-runtime-v1 l.232: a nonexistent local time is skipped, a repeated one runs once. Intervals stay UTC durations.                                                                                                                                                                                                                                                                                                                                                                    | agent-runtime-v1 "Scheduling". Owners think in "8am before the games".                                                                                                                | yes                                                           |
| R11 | **Follow-ups** are requested by the model in the structured decision (`followUp?: { afterMinutes, reason }`, decision schema v5) and are approved by a core service: minimum 60 minutes, maximum 72 h, one pending per agent and market, counted against `dailyRuns` and the budget. The owner can cancel one.                                                                                                                                                                                                                                                                                                     | agent-runtime-v1 l.234. The decision phase is tool-free (`packages/agent-runtime/AGENTS.md:9-12`), so a field is used, not a tool.                                                    | yes                                                           |
| R12 | **Retire the agent HMAC API.** Remove `agentScoped`, `agent-auth.ts`, `authenticate-agent.ts` and the `/:id/status`, `/:id/analytics` and `/:id/budget` routes. The workspace list `GET /v1/agents` and `/:id/audit` stay behind the Supabase JWT. Drop `agents.agent_credentials` in a later migration, after a zero-row check on every environment. Update conventions.md's route groups.                                                                                                                                                                                                                        | No external runtime is a product. The runtime is in-process, and a credential path with no issuer is attack surface with no user (research 04 open question 5).                       | code: yes (git). The table drop: **no**, but it holds no rows |
| R13 | **The paid staging acceptance** runs at most **three paid runs plus one refused run**. The refused run is an agent whose limit sits below its ceiling, which proves `BUDGET_EXHAUSTED` with no provider call. It is recorded in `docs/staging-acceptance-research-<date>.md`.                                                                                                                                                                                                                                                                                                                                      | The existing protocol (`docs/cloudflare-staging.md:168`) plus proof that the budget fails closed, at zero provider cost.                                                              | yes                                                           |
| R14 | **Read admission lane** (cross-review G7). A read run is enqueued on `RESEARCH_QUEUE` the moment `paid-reads-v1.md` marks the read paid. It does not wait for the one-minute Cron tick. It is exempt from the `one_running_agent` lock, which becomes `status = 'running' and trigger <> 'read'`, and has its own `one_running_read_per_agent` index (one read at a time per agent) and a global cap of 3 concurrent read runs outside the per-tenant cap of 2. Its duration limit is 240 s. So **the shortest delivery deadline a read may offer is 10 minutes**: 240 s of run, plus queue latency and one retry. | A scheduled run in progress must not block a paid read, and the deadline has to cover the worst honest case.                                                                          | yes                                                           |

## 3. User flows

### 3.1 A run under a budget

1. A run is claimed (lease as today). The runner loads the agent's config and the tariff.
2. It computes the ceiling: `outputTokens × out price + inputEstimate × in price` (the input
   estimate is `steps × 24 000` tokens, tuned from recorded runs), plus `searches × search price` and
   `pageReads × read price`. It reserves `tokens` and `infra` separately under the IDs
   `run:<runId>:tokens` and `run:<runId>:infra`, with TTL `durationMs + 10 min`.
3. A refused reservation writes a `budget_refused` event, and the run ends `failed / BUDGET_EXHAUSTED`.
   The studio shows "Research budget used up for <Month> · resets <date>".
4. During the run the counts are enforced as today. The `model_usage` event (`run-research.ts:410`)
   and the search results (Exa `costDollars` when present) accumulate the actual cost.
5. On any terminal state (completed, failed, cancelled, lease lost and swept) the runner or the
   lease sweeper commits the actual cost (or the full reservation, R2) and releases the remainder. A
   `budget_committed` event records `{ reservedMicroUsd, committedMicroUsd, tariffVersion }`.

**A read run** (R5, R14) follows the same steps with one difference: step 2 reserves one amount against
the read's ceiling under the ID `read:<readId>`, and a refusal there is an operator alarm, because
paid-reads-v1 checked the ceiling at purchase.

### 3.2 The owner and the budget

Studio → the agent → **Limits** section gains a "Research spend" card: month to date, limit, a bar,
the per-run ceiling, "Paid by Pickler during the beta", and a field to lower the monthly limit. The
Activity section shows each run's cost.

### 3.3 Scheduling

Studio → the agent → schedule panel: **Every N hours** (today) or **At set times** (timezone
defaulting to the browser's, up to 4 times, weekdays). The next three due times are shown in local
time. The funding lock (`studio.ts:717-733`) is unchanged.

### 3.4 Follow-ups

A decision may carry `followUp`. The service approves it, defers it (clamping it to the minimum), or
rejects it (because of budget, daily runs, an existing pending follow-up, or a paused agent), and
records a `follow_up_requested` event with the verdict. The Cron consumer dispatches due follow-ups
as runs with `trigger = 'follow_up'` on the same market. The owner sees pending follow-ups in the
schedule panel and can cancel them.

### 3.5 A new category going live

The operator merges the protocol and plugin with the category marked `soon`, runs the 20 staging
paper runs (R9), records them, and gets the owner's sign-off. Then a one-line catalog change marks it
`live`, and the brief's category picker (`MARKET_CATALOG`, `market-scope.ts:26-40`) offers it.

## 4. API

All studio routes use a Supabase JWT, and the caller must be the agent's owner (the
`access.authorize` and `directory.agentScope` pattern, `studio.ts:711-735`).

| Method | Path                                             | Request                                                                                                                      | Response `data`                                                                                                                                            | Errors                                                                            |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/v1/studio/agents/:id/research-budget`          | none                                                                                                                         | `{ periodKey, allowanceMicroUsd, limitMicroUsd, categories: [{ category, limit, spent, reserved, remaining }], perRunCeilingMicroUsd, paidBy: "pickler" }` | 404                                                                               |
| PUT    | `/v1/studio/agents/:id/research-budget`          | `{ monthlyLimitMicroUsd }` (≤ allowance, ≥ one run's ceiling or 0 to stop research)                                          | the same as GET                                                                                                                                            | 400 `LIMIT_ABOVE_ALLOWANCE`, 400 `LIMIT_BELOW_ONE_RUN`                            |
| GET    | `/v1/studio/agents/:id/runs` (changed)           | as today                                                                                                                     | each run gains `costMicroUsd: string \| null` (null while running)                                                                                         |                                                                                   |
| PUT    | `/v1/studio/agents/:id/schedule` (changed)       | `{ enabled, kind?: "interval" \| "calendar", intervalHours?, calendar?: { timezone, times: ["HH:MM"], weekdays: (1-7)[] } }` | `{ enabled, kind, nextDueAt[] (3 ISO instants) }`                                                                                                          | 400 `INVALID_TIMEZONE`, 400 `INVALID_CALENDAR`, 409 `NOT_READY`, 409 `NOT_FUNDED` |
| GET    | `/v1/studio/agents/:id/follow-ups`               | `?state=pending`                                                                                                             | `[{ id, marketId, dueAt, reason, state, parentRunId }]`                                                                                                    |                                                                                   |
| DELETE | `/v1/studio/follow-ups/:id`                      | none                                                                                                                         | `{ cancelled: true }`                                                                                                                                      | 404, 409 `FOLLOW_UP_NOT_PENDING`                                                  |
| GET    | `/v1/studio/market-categories` (changed)         | none                                                                                                                         | catalog v2: each category gains `status: "live" \| "soon"`                                                                                                 |                                                                                   |
| —      | `/v1/agents/:id/status`, `/analytics`, `/budget` | **removed** (R12)                                                                                                            |                                                                                                                                                            | 404 after removal                                                                 |

Money is a string of micro-USD in JSON, and every field is named `*MicroUsd` (cross-review C15). This
departs from conventions.md's `*_micro_ausd` on purpose: provider costs are billed in USD, not AUSD,
and a read's AUSD ceiling is converted at 1:1 (R5). The existing studio
routes answer `{ ok: true }` without the envelope (`studio.ts:715`). The new routes use the envelope.

## 5. Data model and migrations

Numbers are assigned at build time (the next free number is 0023).

**`research_run_costs`**

- `pickler.run_costs (run_id text pk references pickler.runs(id), product_agent_id uuid not null, tariff_version text not null, reserved_tokens_micro_usd bigint not null, reserved_infra_micro_usd bigint not null, committed_tokens_micro_usd bigint, committed_infra_micro_usd bigint, input_tokens int, output_tokens int, searches int, page_reads int, provider_reported_micro_usd bigint, state text check in ('held','committed','released'), created_at, settled_at)`.
- The ledger rows stay in `budget.*` and `pickler.budget_state` (`studio/budget.ts:30-60`).
  `run_costs` is the per-run receipt that the studio reads.
- The runner reaches the ledger through a new core port `ResearchBudget { reserve, settle }`. Its
  infrastructure adapter maps `(tenant_id, runtime_agent_id)` to `product_agent_id` through
  `pickler.product_agents` (`console-schema.ts:45-56`). A runtime agent with no product mapping (the
  laboratories) uses `UnmeteredResearchBudget`, which is allowed only when `APP_ENV=local`.

**`research_calendar_and_follow_ups`**

- `pickler.agents`: add `schedule_kind text not null default 'interval' check in ('interval','calendar')`,
  `schedule_timezone text`, `schedule_calendar jsonb` (`{ times, weekdays }`), and
  `check (schedule_kind = 'interval' or (schedule_timezone is not null and schedule_calendar is not null))`.
- `pickler.runs`: widen `run_trigger` to `('manual','schedule','follow_up','read')`
  (`schema.ts:85`), and add `parent_run_id text null references pickler.runs(id)`. **This migration owns
  the trigger change** (cross-review D2). `paid-reads-v1.md` adds only `read_id` and orders its migration
  after this one. Replace `one_running_agent` with `where status = 'running' and trigger <> 'read'`, and
  add `one_running_read_per_agent (tenant_id, agent_id) where status = 'running' and trigger = 'read'` (R14).
- `pickler.run_costs` (above) gains `scope text not null default 'agent' check in ('agent','read')` and
  `read_id text null`, with `check (scope = 'agent' or read_id is not null)`. A read-scope row reserves
  against the read's ceiling, never the agent's `budget.*` rows (R5).
- `pickler.follow_ups (id text pk, tenant_id text, agent_id text, parent_run_id text not null, market_id text not null, due_at bigint not null, reason text not null check (char_length(reason) <= 280), state text check in ('pending','dispatched','rejected','cancelled'), verdict text, created_at bigint)`,
  with a unique partial index `(tenant_id, agent_id, market_id) where state = 'pending'` and index
  `(due_at) where state = 'pending'`. It has a foreign key to `pickler.agents (tenant_id, id)`.

**`retire_agent_credentials`** (shipped at least 30 days after the code removal, and only after
`select count(*) from agents.agent_credentials` returns 0 on staging and production, recorded in the
PR): `drop table agents.agent_credentials`.

## 6. Integrations

| System                             | Use                                                | Config                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model provider (OpenAI-compatible) | token usage for the commit                         | existing `MODEL_*`; tariff entry per model ID in `RESEARCH_TARIFFS`                                                                                                   |
| Exa                                | search and page reads; `costDollars` when reported | existing key; tariff entries `exa.search`, `exa.contents`                                                                                                             |
| Spot price for crypto (R7)         | reference and current price for `crypto-updown-v1` | the Perpl public-data client (`packages/infrastructure/src/perpl/`), or a public spot ticker behind a new `SpotPrice` port; the choice is recorded in the protocol PR |
| Polymarket                         | crypto up/down market discovery (tag mapping)      | existing plugin; a new classifier mapping version `2.0.0`                                                                                                             |
| Workers Cron                       | follow-up dispatch in the same 1-minute tick       | `workers/research/wrangler.jsonc` `* * * * *` (unchanged)                                                                                                             |
| API and research workers           | allowance and tariffs                              | vars `RESEARCH_MONTHLY_ALLOWANCE_MICRO_USD=5000000`, `RESEARCH_TARIFFS` (JSON with `version`)                                                                         |

### 6.1 What each next category needs

| Category                    | Protocol                     | Plugins                         | Resolution source                                                        | Extra                                                       |
| --------------------------- | ---------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Crypto up/down (next)       | `crypto-updown-v1`           | polymarket, exa, spot price     | Polymarket resolution (UMA) on Polygon                                   | a volatility context tool, read-only                        |
| Perpl perps (after trading) | `perps-direction-v1`         | per `perpl-agent-runtime-v1.md` | Perpl mark price at the horizon that `perpl-agent-runtime-v1.md` defines | `maxLeverage` from the brief; `perpl-live-v1.md` for orders |
| Politics (later)            | `general-market-v1` (exists) | polymarket, exa                 | Polymarket resolution                                                    | news-recency rules; a stricter source policy                |

## 7. Design work

All of these are **studio** (dark surface). There is no marketplace or mobile work.

| Screen                                   | States                                                                                                                          | Canvas                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Limits → Research spend card             | healthy, warning (≥ 80%), exhausted with reset date, owner-lowered limit, loading, failed                                       | **draw**, added to `Pickler Studio v4`                         |
| Schedule panel v2                        | interval, calendar (timezone, times, weekdays), next three runs, locked (not ready or unfunded), pending follow-ups with Cancel | **draw**, added to `Pickler Studio v4`                         |
| Activity row cost and `BUDGET_EXHAUSTED` | a run's cost, a refused run, a follow-up run (with a link to its parent)                                                        | extend the existing Activity section, no new canvas            |
| Category picker with Soon                | live, soon (disabled with its reason)                                                                                           | extend the brief's reads/markets row in `Pickler Studio Empty` |

`scripts/design/routes.mjs`: the Limits section with a fixture at 85% and one exhausted; the schedule
panel in calendar mode.

## 8. Security and abuse

- **Overshoot.** A reservation is atomic under the agent's row lock (`studio/budget.ts:30`), so
  concurrent runs cannot jointly overspend. The TTL release covers a crashed worker. The lease
  sweeper settles a swept run's cost as the full reservation (R2).
- **The owner raising spend.** The PUT caps at the allowance, and the allowance is a server var.
- **Follow-up loops.** At most one pending follow-up per market, a 60-minute minimum, the `dailyRuns`
  cap across every trigger, and the budget. A follow-up cannot request a follow-up sooner than its
  own minimum.
- **Calendar abuse.** At most 4 times a day. The `dailyRuns` cap (6) still bounds everything.
- **HMAC removal.** It removes a credential verifier that nothing issues credentials for. The table is dropped only
  once it is verified empty.
- **Cost leakage.** Run costs are shown only to the owner. The marketplace never shows them.

## 9. Acceptance criteria and tests

1. Core: the ceiling formula, reserve before the first provider call (a fake search port that throws
   if called before `reserve`), commit of the actual cost, commit of the full reservation on unknown
   usage, `TARIFF_MISSING`, and `BUDGET_EXHAUSTED` with zero provider calls.
2. Core: the calendar next-due calculation across the DST boundaries of `Europe/Madrid` and
   `America/New_York` (a skipped 02:30 and a repeated 01:30), and follow-up approve, defer and reject.
3. Infrastructure: the migrations on 0022; the partial unique index refuses a second pending
   follow-up; `run_costs` settles once.
4. API: the new routes and errors; the removed HMAC routes answer 404; `check:architecture` passes
   without the retired files.
5. The lease sweeper settles an abandoned run's reservation (integration test on local PostgreSQL).
6. **Staging acceptance record** `docs/staging-acceptance-research-<date>.md` with: commit SHA, Worker
   version IDs (api, research, web), Supabase project ref, URL, two isolated tenants, and run IDs with
   timestamps and terminal status for (a) one manual run per tenant and (b) one scheduled run for a
   validated agent; (c) one refused run with `BUDGET_EXHAUSTED` and no provider event; each run's
   reserved and committed micro-USD; and schedules paused afterwards. At most three paid runs.
   Failed runs are recorded as failures and not retried (`docs/cloudflare-staging.md:166-175`).

## 10. Rollout and dependencies

1. **Budget first** (`research_run_costs`, the port, the runner and the studio card). The allowance
   starts on staging.
2. **Then the acceptance record** (R13), which proves the budget and the transport correction together.
3. **Then scheduling** (calendar and follow-ups). Follow-ups need decision schema v5, so the studio's
   `decision.ts` learns a fifth shape.
4. **HMAC retirement** can go at any time. The table drop comes 30 days later.
5. **Crypto up/down** after `decision-resolution-v1.md` (R9 needs a resolution source).
   **Perps** after `perpl-agent-runtime-v1.md`, which owns `perps-direction-v1`.

Depends on: `PostgresBudgetLedger` (exists); `decision-resolution-v1.md` (for R9);
`perpl-agent-runtime-v1.md` (perps, R7); `paid-reads-v1.md` (the per-read ceiling of R5 and its
minimum deadline of R14).

## 11. Out of scope

Charging owners for research; event-triggered runs (price moves, kick-off minus N); a Jev reviewer
in the hosted path; exit monitoring; a run cancel endpoint and event cursors (useful, but a separate
small change); live trading tools for the model.

## 12. Open questions for the owner

1. **Who pays for research after the beta**: Pickler, the owner (by topping up a research balance),
   or a share of read revenue? R4 makes Pickler pay $5 per agent per month until you decide.
2. **Authorization for the staging acceptance**: up to three paid runs plus one refused run (R13).
   May the operator run them?
