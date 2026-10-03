# Perpl paper runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/specs/perpl-paper-runtime-v1.md`: studio Perpl agents check hourly (and on demand), decide with the model inside the brief's rules and the caps, trade on paper, exit on stop/target/time, and show it in the live and draft studios.

**Architecture:** Pure rules in `packages/trading/src/features/perps-runtime/` (decision schema, outcome, sizing, exits, day-loss, record stats). Storage in `packages/infrastructure` (migration `0027_perps_checks`, a `PostgresPerpsRuntimeStore`, perps paper store changes). Execution in `packages/agent-runtime` (a check runner reusing advice's data acquisition and the configured model provider) wired into `workers/research` (Queue kind `perps-check`, hourly dispatcher and exits job on the minute Cron). Routes in `workers/api` with DTOs in `packages/api-schema`. Web in `apps/web/src/features/studio/live/` and `draft/`.

**Base:** branch `codex/perpl-paper-runtime`, created from `codex/studio-live` (PR #86, unmerged), worktree `/Users/Juvenal/Development/Pickler/pickler-perpl-runtime`.

**Repo rules (all tasks):** read the root `AGENTS.md` and every `AGENTS.md` along the paths you touch first; update them in the same change when structure, exports or responsibilities change. Respect the three layers (trading/core business; infrastructure implements ports; runtime composes). Commit by path (`git commit -m "..." -- <paths>`), never `git add -A`, `git stash`, `reset --hard`, `checkout .`, `clean`. Never push. No dev servers except Task 7's `design:check`. Postgres for tests is Docker on 127.0.0.1:55432 (isolated databases); never touch a remote database; never call a real model, Perpl or Exa in tests (fakes only). `npm run build:shared` before dependants' tests. New routes must be described for OpenAPI (`docs/api-contract.md`). CSS uses `var(--pk-*)` tokens only. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Checks before every commit:** the task's tests, typecheck of the touched packages (`npx tsc --noEmit -p <pkg>`; `npm run typecheck` when possible), `npx eslint <changed>`, `npx prettier --check <changed>`, `npm run check:architecture`; web tasks also `npm run design:source`.

---

### Task 1: Trading rules (pure)

**Files:** `packages/trading/src/features/perps-runtime/{decision.ts,outcome.ts,sizing.ts,exits.ts,record.ts,index.ts}`, the trading public subpath export (follow how `perps` / `advice` are exported), `packages/trading/test/perps-runtime-*.test.ts`, `packages/trading/AGENTS.md`.

- `decision.ts`: zod `perpsCheckDecisionSchema` per spec R4 with clamping (`parseCheckDecision(raw) → { ok, decision } | { ok: false, code: "MODEL_INVALID" }`); constants `HORIZONS = [4, 24, 72]`, stop/TP bounds and defaults (300/600).
- `outcome.ts`: `decideOutcome(input) → { outcome, text, margin?, leverage?, proposals? }` implementing R6 in order, with input `{ decision, brief (counts), paused, position (for instrument) | null, openCount, risk, spend, maxLeverage, entry, newMarginToday, realizedToday, freeEquity }`; texts like "ENTRY 2 HELD", "NEVER 1", "LOW CONVICTION", "BLOCKED BY CAP · 3 OPEN", "BLOCKED BY CAP · PER DAY", "DAY-LOSS STOP", "NO FREE AUSD", "PAUSED".
- `sizing.ts`: R7 (`marginFor(probability, perCallAusd)`, notional, opposite-open → close then open).
- `exits.ts`: R10 levels from entry price, side, bps (`exitLevels`), `exitDue(position, mark, now) → reason | null`; R11 `dayLossReached(realizedToday, risk)`; proposal expiry (15 min).
- `record.ts`: R13 stats from closed positions + movements, equity series, drawdown.
- [ ] Table-driven tests for every branch; commit "Trading: the Perpl paper runtime's rules".

### Task 2: Storage — migration 0027, runtime store, product paper accounts

**Files:** `packages/infrastructure/drizzle/0027_perps_checks.sql` + meta (`drizzle-kit generate --name perps_checks`, then hand grants like 0013's runtime tables), `src/persistence/schema.ts` (tables/columns), new `src/persistence/perps-runtime-store.ts` (`PostgresPerpsRuntimeStore`: `startCheck`, `appendStep`, `finishCheck`, `listChecks(scope, before, kind)`, `getCheck`, `dueAgents(now)` (published, perpl, not paused, no check in the last hour, staggered by id, no live lease), `claimAgent`/`renewAgent`/`releaseAgent` leases, proposals CRUD with expiry, `checksToday`, `manualChecksToday`, `globalChecksToday`, cost sums), changes to `src/persistence/perps-paper-store.ts` (product session `sessionId = "product"` not version-pinned; position columns `check_id`, `config_version`, `stop_price`, `take_profit_price`, `exit_due_at`, `close_reason`; `openDuePositions(now)`; `closePosition(id, reason, frame)` idempotent from `open`), `packages/trading/src/features/perps-paper/{policy.ts,service.ts,types.ts}` (notional parameter instead of hard-coded 100; `assertPerpsPaperAgent` skips the version pin for product sessions), ports in trading/core as the layering requires, `packages/infrastructure/test/perps-runtime-store.test.ts`, AGENTS.md files.

- [ ] Postgres tests: check lifecycle, steps order, listing pages, due list (stagger, paused, lease), proposals (pending → approved/skipped/expired), product account across config versions, open/close with exits columns, close exactly once, stop-all; existing perps paper tests still pass (operator sessions still pinned). Commit "Storage: Perpl checks, proposals and product paper accounts (migration 0027)".

### Task 3: Runtime — the check runner and the research worker

**Files:** `packages/agent-runtime/src/composition/perps-check.ts` (+ model prompt `perps-check` next to advice's in `advice-model.ts` pattern), `packages/agent-runtime/src/workers/perps.ts` (`consumePerpsCheck`, `dispatchDueChecks`, `runExits`, `expireProposals`), `workers/research/src/{worker.ts,index.ts,env.ts}` (Queue kind `perps-check`; Cron calls dispatcher + exits + expiry when `PERPL_RUNTIME_ENABLED`), `workers/research/wrangler*.jsonc` vars (`PERPL_RUNTIME_ENABLED: "false"`, `PERPL_RUNTIME_DAILY_CHECKS: "500"`), `packages/infrastructure/src/perpl/transport.ts` (session cap option, 24 for checks), tests in `packages/agent-runtime/test/` and `workers/research/test/`, AGENTS.md files.

- A check: claim lease → load agent + config → ensure product paper account (first check: equity = agent wallet AUSD via the existing balance reader; < 10 → `blocked` "FUND ITS WALLET") → acquire data (reuse `composition/advice.ts` acquisition for each instrument; web via Exa when `sources.web`) → one model call (configured provider; record usage) → `parseCheckDecision` → `decideOutcome` → act on paper (open / close / proposals) → day-loss check (pause + system row) → finish with steps, cost. Every step appends a timed trace line ("Read the brief · 3 entries, 2 exits, 3 never", "Read Perpl BTC, ETH · 1.4s", "Asked the model · 2.1s", "Entry 1 and 2 met · 3 held", outcome).
- Exits job: marks from the market board (`createPerplMarketBoard`), close due positions with `close_reason`, write an `exited` check row per close.
- [ ] Tests with fake Perpl data, fake model, fake store or real Postgres: entered / held / blocked / proposed / failed (malformed model output) / exits at stop, target, time / day-loss pause / ceiling / disabled. Commit "Runtime: Perpl checks in the research worker".

### Task 4: API and DTOs

**Files:** `packages/api-schema/src/perps-runtime.ts` (+ index), `workers/api/src/routes/studio.ts` (or a new `studio-perps.ts` mounted under `/v1/studio`), `workers/api/src/container.ts`, `workers/api/src/env.ts`, `.dev.vars.example`, `workers/api/test/studio-perps-route.test.ts`, `docs/api-contract.md` if it lists routes, AGENTS.md files.

- Routes per spec §4 with OpenAPI descriptions; manual check enqueues `{ kind: "perps-check", checkId }` on RESEARCH_QUEUE (like advice wakeups); owner-only writes; workspace members read; `record` includes `runtimeEnabled`.
- [ ] Route tests for every code; OpenAPI export + test pass. Commit "API: Perpl checks, paper positions, proposals and record".

### Task 5: Live studio wiring

**Files:** `apps/web/src/features/studio/api.ts` (client functions), `live/use-live.ts` (reads: checks, positions, record, proposals; writes: runCheck, approve, skip, closePosition, stopAll; polling while a check runs and every 30 s on Overview/Positions/Decisions), `live/{overview,positions,record,decisions,live-strip,controls,live-studio}.tsx`, `live/model.ts` (+ new pure helpers in `live/runtime-model.ts`), `live/fixture.ts` (populated stages), `home/stage.ts`, tests, AGENTS.md.

- With `runtimeEnabled` false, keep today's honest copy; with it true: strip from the last check; Overview "Waiting on you" (proposals with Enter/Skip and countdown) and "Its positions"; Positions with stop/target meter and time stop, Close now (no passkey, paper), and WHAT IT WATCHES; Record (stats, equity sparkline, closed list); Decisions feed with filters and expandable steps; Controls: "Stop · close all" enabled on paper, meters real, Health "Model cost today ≈ $x"; stats tiles real (TODAY, OPEN, PUT IN TODAY). Positions/Decisions rail badges.
- [ ] Commit "Web: the live studio shows the Perpl runtime".

### Task 6: Draft Console wiring

**Files:** `draft/{console.tsx,trades.tsx,run-model.ts,use-draft.ts}`, fixture/stage, tests.

- "Run it on paper" enabled when `runtimeEnabled` (else today's Soon); "What it did" polls the check's steps and shows the outcome card; Trades lists paper positions.
- [ ] Commit "Web: the draft Console runs on paper".

### Task 7: Design harness and full verification

**Files:** `scripts/design/routes.mjs` (routes for the new populated stages).

- [ ] Run `npm run build:shared`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:architecture`, `npm run design:source`, OpenAPI export + test, `npm run design:check` (ports 3001/8799 free; wait on PID; stop servers). Look at screenshots. Commit "Design harness: the Perpl runtime's staged states".
