# Decision resolution v1: every decision meets its market

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`
(autonomous decisions 1 and 2). Every decision below is reversible unless the table says otherwise.

## 1. Problem and users

A research run ends in a decision: `TRADE` or `ABSTAIN`, with a probability band, a price and a
policy verdict (`packages/core/src/features/research/decision-policy.ts:59-157`). The decision is
stored in `pickler.runs.decision` (`packages/infrastructure/src/persistence/schema.ts:58`) and then
nothing ever looks at it again. No field says whether it was right
(`docs/specs/marketplace-real-data-v1.md` §3), so every figure the marketplace promises has no
source: the adapter hard-codes `resolved: 0`, `hitRate: null`, `net: 0`, `calibrationGap: null`,
an empty leaderboard and a null pick
(`packages/infrastructure/src/persistence/agent-directory.ts:122-125,191-203,233-238,303-306`).

What exists is narrow. Paper settlement reads the Polymarket CTF payout on a finalized Polygon block
(`packages/infrastructure/src/polymarket/paper-resolution.ts:22-140`), but only for a filled paper
order, only when someone presses a button (`workers/api/src/routes/studio.ts:663`), and only
because the buy captured the condition id at fill time
(`packages/trading/src/features/paper/orders.ts:23`). Abstentions, policy-held trades and trades
without a paper fill are never scored. Brier and calibration exist only in laboratory reports
(`apps/agent-service/BTC-DECISION-BENCHMARK.md:115-125`).

The brief's exit rules have the same shape of gap: the model sets `exitArmed`
(`decision-policy.ts:40`) and nothing acts on it (`docs/product-map/research/04-runtime.md` §2,
"Exit rules act on an open position").

Users:

- **The agent owner** (studio) needs to know whether the agent is any good, per decision and in
  aggregate (`docs/specs/studio-decision-review-v1.md`).
- **Marketplace visitors and buyers of reads** need an honest public record
  (`docs/specs/public-record-v1.md`).
- **Pickler** needs one source of truth for the leaderboard, receipts and, later, read evaluation.

This spec owns the job, the tables and the formulas. The two specs above own what is shown.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                           | Reason                                                                                                                                                                                             | Reversible?                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| D1  | **Every completed run with a decision is enrolled**, TRADE and ABSTAIN alike, including policy-held trades. Failed runs and preview runs (`pickler.preview_runs`, migration 0022) are not decisions and are never enrolled.                                                                                                                                                        | Conventions decision 2. Scoring only trades lets an agent hide bad forecasts behind abstentions.                                                                                                   | yes                                    |
| D2  | **The only resolution authority for a Polymarket decision is the CTF payout vector on a finalized Polygon block**, read exactly as `PolymarketPaperResolution.resolutionFor` does today. Gamma (`closed`, `umaResolutionStatus`) only tells the job _when_ to look and whether a dispute is open. Sports data providers (balldontlie, The Odds API) are never a resolution source. | The payout vector is what money settles on. A sports score can disagree with how a market resolves (rules, voids, overtime clauses). One authority per venue keeps the record defensible.          | yes                                    |
| D3  | **Resolution identity is captured at enrollment**, minutes after the decision: the job reads Gamma `/markets/:id` for the `conditionId`, outcome index and outcome count, the same fields `PolymarketMarketData.conditions` parses (`packages/infrastructure/src/polymarket/market-data.ts:218-262`). A paper fill's own identity wins when present.                               | Today only paper fills carry an identity (`orders.ts:23`), so abstentions cannot be resolved. `Market` (`packages/core/src/features/research/types.ts:145-159`) has no condition id.               | yes                                    |
| D4  | **Calibration is scored with the Brier score**, not log loss. Per decision `(p − y)²`; per agent the mean. The public "calibration gap" is the expected calibration error over ten equal-width buckets, in points.                                                                                                                                                                 | Brier is bounded (0–1), so one confident miss cannot dominate a small record; log loss needs clamping at 0 and 1, which is an arbitrary knob. The laboratories already report Brier.               | yes (the formulas are versioned, §5.4) |
| D5  | **Virtual P&L is 1 AUSD staked per TRADE at the fresh ask the policy saw** (`observedPrice`), fees excluded: `y / ask − 1`. Paper P&L comes from paper settlement; live P&L from live orders.                                                                                                                                                                                      | Every TRADE has an ask; not every TRADE has a paper fill. A fixed stake makes agents comparable regardless of their paper settings. Fees are venue-specific and would make P&L depend on settings. | yes                                    |
| D6  | **Voided or split markets are resolved as `void`**: any payout fraction other than 0 or 1 for the decision's outcome. A void is excluded from hit rate, Brier and calibration, and included in P&L at its actual payout.                                                                                                                                                           | A 50/50 split is not evidence of skill either way; money still moved, so P&L tells the truth.                                                                                                      | yes                                    |
| D7  | **Resolutions are append-only.** One row per `(run_id, revision)`; revision 1 is written by the job. A higher revision is written only by an operator command with a reason, and it writes an `audit.events` row.                                                                                                                                                                  | A CTF payout is immutable once reported, so corrections should be vanishingly rare, but the record must never be silently rewritten.                                                               | no (append-only is the point)          |
| D8  | **Aggregates are recomputed from scratch per agent** in the same transaction that writes a resolution, into `pickler.agent_records`, with two scopes: `owner` (every enrolled decision) and `public` (decisions made while the agent was public, D11).                                                                                                                             | Per-agent resolution counts are in the hundreds to low thousands; a full recompute is milliseconds and cannot drift, unlike incremental counters.                                                  | yes                                    |
| D9  | **The leaderboard score is the existing `agentScore`** (`packages/core/src/features/agents/domain/reads.ts:158-167`) with its inputs now defined (§5.4), and an agent is ranked only with ≥ 20 scored decisions, ≥ 5 resolved trades and a decision in the last 30 days.                                                                                                           | The formula is already published by the design ("calibration first, volume second, money last"); what was missing was its inputs. Minimums keep one lucky week off the top.                        | yes                                    |
| D10 | **The job runs in `workers/research`** on a second Cron trigger every 5 minutes, beside the existing one-minute research Cron (`workers/research/wrangler.jsonc:27`, `workers/research/src/worker.ts:46`). It holds no signer and uses the trusted `DATABASE` Hyperdrive binding.                                                                                                  | It is background, read-only work against public chain data. `workers/trading` holds the signer and must stay small; `workers/api` serves requests.                                                 | yes                                    |
| D11 | **"Public at decision time" comes from `agents.agents.published_at`**, which `docs/specs/go-public-v1.md` (D1, D2) adds, sets on publish and backfills to `created_at` for agents already public. Decisions before it, and every decision of a private agent, count only in the owner scope.                                                                                       | A draft's decisions were never offered to the public; counting them would let an owner curate a record in private and publish only the good stretch. The reverse is also true, so both are kept.   | yes                                    |
| D12 | **Each decision gets a public commitment at enrollment**: `sha256` of the canonical JSON of its public projection (the fields `public-record-v1` §5 lists). The hash can be shown immediately; the content is revealed at resolution and anyone can recompute the hash.                                                                                                            | It proves the record was not written with hindsight, without revealing the pick before it resolves (conventions decision 1).                                                                       | yes                                    |
| D13 | **Open paper positions are exit-monitored** (§3.4): an exit check every 30 minutes evaluates the brief's `exitsWhen` lines from the config the position was opened under, and closes the paper position at the best bid when one turns true. Resolution auto-settles paper positions, replacing the manual settle button as the normal path.                                       | The brief says "the first line that turns true closes it" (`docs/specs/studio-brief-v1.md` §2), and today nothing does.                                                                            | yes                                    |
| D14 | **Exit checks are a small model call with no search**: the position, the entry decision, a fresh book and the exit lines in; one boolean and one sentence per line out. They are not research runs and do not take the one-running-agent lock (`schema.ts`, `one_running_agent`).                                                                                                  | Exit rules are written in plain language and cannot be parsed into price triggers in general. No search keeps the cost at a few cents per check. A research run would block scheduled research.    | yes                                    |
| D15 | **Live orders and Perpl are designed in, built later.** `live_pnl_micro` is computed for a settled Polymarket live order when its market resolves; Perpl decisions resolve against the Perpl mark price at their horizon (§6.3) once a Perpl agent exists.                                                                                                                         | Keeps one table and one formula set across venues without blocking v1 on venues that are not live.                                                                                                 | yes                                    |

## 3. User flows

### 3.1 A decision is enrolled

1. A run finishes with `status = 'completed'` and a non-null `decision` (`run-research.ts:512-513`).
2. Within 5 minutes the resolution Cron finds it (`LEFT JOIN pickler.decisions ... WHERE d.run_id IS NULL`).
3. It reads, from the run and its events: the market question and outcome labels (`selection`,
   `eligible_candidates`, `market` events), the market's close or start time, the web sources
   (`source` events), and the outcome's best bid and ask at the `initial_quote` event
   (`run-research.ts:248`), whose midpoint is the **market price at decision**.
4. It fetches the resolution identity from Gamma (D3), unless the run's paper order already has one.
5. It writes one `pickler.decisions` row with `state = 'awaiting'`, the decision hash, the public
   commitment (D12) and `next_check_at` (§3.2).
6. If Gamma cannot give an identity (market gone, malformed), the row is written with
   `state = 'identity_missing'` and retried with backoff for 7 days, then left as
   `unresolvable`. Such a decision counts as a decision in totals and never in scores.

### 3.2 A decision resolves

1. Each Cron tick claims up to 50 due rows (`next_check_at <= now()`, state `awaiting` or
   `disputed`) with `FOR UPDATE SKIP LOCKED` and a 4-minute lease.
2. For each, it checks Gamma first (one GET): if the market is not `closed`, it reschedules.
   If `umaResolutionStatus` says disputed, it sets `state = 'disputed'` and reschedules.
3. If closed, it reads the CTF payout (D2). `payoutDenominator = 0` means not reported yet:
   reschedule.
4. Reported: it computes `y`, the outcome (`won`, `lost`, `void`), the per-decision metrics (§5.4),
   builds the receipt (§5.3) and, in one transaction:
   - inserts `decision_resolutions` revision 1 (`ON CONFLICT DO NOTHING`, so a double claim is a
     no-op);
   - sets `decisions.state` to `resolved` or `void`;
   - settles the run's filled, unsettled paper order through the existing
     `PaperSettlementRepository.settle` path (`packages/trading/src/features/paper/settlement.ts:42-51`)
     with the same `PaperResolution`, so the paper order and the record agree by construction;
   - recomputes both `agent_records` rows for the agent (D8);
   - hands the decision to publication (`public-record-v1` §3.1), which writes the public activity
     row when the agent was public at decision time.
5. Backoff for `next_check_at`, from the market's expected end (`closesAt`, or `startsAt` + 4 h for
   a match market):
   - before the expected end: at the expected end;
   - first 6 h after it: every 15 min;
   - to 48 h: hourly;
   - to 30 days: every 6 h (at 30 days, `stale_at` is set and an ops alert fires);
   - to 180 days: daily; after that `state = 'unresolvable'`.

### 3.3 The owner sees it

The studio reads the owner-scope record and each decision's resolution
(`studio-decision-review-v1`). Nothing in this spec changes a screen by itself.

### 3.4 Exit monitoring of an open paper position

1. A paper order is **open** when `status = 'filled'`, `settlement IS NULL` and `exit IS NULL`.
2. Every 30 minutes (a third branch of the same Cron, at most 20 positions per tick, oldest check
   first), for each open position whose run config has a non-empty `brief.exitsWhen`:
   - fetch a fresh order book for the held outcome;
   - if the market is closed or no bid exists, skip (resolution will settle it);
   - call the exit model (D14) with: the entry decision's thesis and probability band, the entry
     price, the fresh best bid and ask, the time left to close, the `exitsWhen` lines of the
     **config version the position was opened under** (`runs.config`, immutable), and which line
     was armed (`exitArmed`);
   - validate the answer strictly: one entry per line, in order, `{ rule, true, why }`, exactly as
     `briefVerdict` validates entries (`decision-policy.ts:26-56`). A misaligned answer is a failed
     check (recorded, no action).
3. If any line is true, close the position with a **paper sell of the full quantity at the best bid
   walk** (same full-fill-or-nothing rule and fee curve as the paper buy,
   `packages/trading/src/features/paper/orders.ts:171-280`). The order's `exit` column records the
   rule, the check id, the fill and the realized P&L. The position is no longer open, so the
   `one_open_paper_position` index frees the market for a new entry.
4. A closed position's decision still resolves normally: the **decision** is scored on the market
   outcome (the forecast); the **paper P&L** is the realized exit P&L, not the payout.
5. Limits: at most 48 exit checks per agent per UTC day; exit-check model spend is charged exactly
   as research spend is (the research budget in `docs/specs/research-runtime-v2.md`). With the agent paused or killed, checks
   stop; with paper trading disabled for the agent (`assertPaperSettlementAccess`,
   `settlement.ts:54-59`), checks stop and resolution still settles.
6. Live positions are out of scope: the live pilot has no sells (`LIVE-TRADING.md:101,123`).

## 4. API

This spec adds only internal and operator routes. The public and studio reads are in
`public-record-v1` §4 and `studio-decision-review-v1` §4. Envelope and errors follow the conventions.

| Method | Path                                        | Auth                             | Request                                                                                      | Response                                                                  | Errors                                                               |
| ------ | ------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/v1/internal/resolutions/tick`             | service binding only             | `{ now?: string }` (tests only; ignored in prod)                                             | `{ data: { enrolled, checked, resolved, voided, disputed, exits } }`      | 503 `DATABASE_UNAVAILABLE`                                           |
| GET    | `/v1/internal/resolutions/health`           | service binding only             | —                                                                                            | `{ data: { awaitingDue, oldestDueAt, stale, identityMissing, lagP95s } }` | —                                                                    |
| POST   | `/v1/internal/resolutions/:runId/revisions` | service binding + operator claim | `{ reason: string (10–500), payout: {numerator, denominator}, evidence }`, `Idempotency-Key` | `{ data: ResolutionDto }` (the new revision)                              | 404 `DECISION_NOT_FOUND`, 409 `NOT_RESOLVED`, 400 `INVALID_REVISION` |
| POST   | `/v1/internal/resolutions/backfill`         | service binding + operator claim | `{ since: string, limit ≤ 1000 }`                                                            | `{ data: { enrolled, skipped } }`                                         | 400 `INVALID_INPUT`                                                  |

The Cron calls the same use case the `tick` route exposes; the route exists so staging acceptance
can drive a tick deterministically. `/v1/internal/*` is never routed by the web proxy.

`POST /v1/studio/runs/:id/paper-order/settle` (`studio.ts:663`) stays for the owner as "check now";
it calls the same resolution use case for that one decision and returns the paper order, so it can
never disagree with the job.

DTOs in `packages/api-schema/src/resolutions.ts` (new): `ResolutionDto`, `AgentRecordDto`,
`CalibrationBucketDto`, `ReceiptDto`. `AgentRecordDto` is shared by the public and studio specs.

## 5. Data model and migrations

One Drizzle migration, **`decision_resolutions`** (number assigned at build time; 0023 is next at
the time of writing), plus one for exit monitoring, **`paper_position_exits`**. Both in
`packages/infrastructure`. All new tables are in the private `pickler` schema, RLS enabled, never
exposed through the Supabase Data API (root `AGENTS.md`, "Never expose `pickler`").

### 5.1 `pickler.decisions` (enrollment and resolution state)

| Column                             | Type                        | Notes                                                                                                                  |
| ---------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `run_id`                           | text PK → `pickler.runs.id` | one row per decision                                                                                                   |
| `tenant_id`, `agent_id`            | text                        | FK to `pickler.agents`; `agent_id` equals the product agent uuid as text (`schema-boundaries-v1` §2)                   |
| `config_version`                   | integer                     | copied from the run                                                                                                    |
| `venue`                            | text                        | `polymarket` in v1; `perpl` later; check constraint                                                                    |
| `market_id`, `outcome_id`          | text, text null             | `outcome_id` null for an abstention that named none                                                                    |
| `market_question`                  | text                        | from the trace; `Market <id>` when none, never invented (`apps/web/src/features/studio/sections/picks.tsx:15-40` rule) |
| `outcome_label`                    | text null                   |                                                                                                                        |
| `model_action`, `final_action`     | text                        | `TRADE`/`ABSTAIN`; legacy decisions copy `action` into both                                                            |
| `policy_reasons`                   | text[]                      | `policyEvaluation.reasonCodes`, empty for legacy                                                                       |
| `stopped_by`                       | jsonb null                  | `{ kind, rule }` from `briefVerdict` (`decision-policy.ts:18`)                                                         |
| `p_estimate`, `p_lower`, `p_upper` | numeric(7,6) null           | `modelAssessment.probability`, else legacy `estimatedProbability` (estimate only)                                      |
| `ask_at_decision`                  | numeric(7,6) null           | `observedPrice` (TRADE and policy-held TRADE only)                                                                     |
| `market_price_at_decision`         | numeric(7,6) null           | midpoint at `initial_quote`; null when one side of the book was empty                                                  |
| `limit_price`                      | numeric(7,6) null           |                                                                                                                        |
| `decided_at`                       | timestamptz                 | `runs.finished_at`                                                                                                     |
| `expected_end_at`                  | timestamptz null            | `closesAt` or `startsAt + 4h`                                                                                          |
| `resolution_identity`              | jsonb null                  | `{ conditionId, outcomeIndex, outcomeCount }`                                                                          |
| `identity_source`                  | text null                   | `paper_fill` \| `enrollment` \| `backfill`                                                                             |
| `decision_hash`                    | text                        | sha256 hex of canonical JSON of `runs.decision`                                                                        |
| `public_commitment`                | text                        | sha256 hex of canonical JSON of the public projection (D12)                                                            |
| `public_id`                        | text unique null            | `dcs_` + 20 base32 chars; set at publication (`public-record-v1`)                                                      |
| `public_at`                        | timestamptz null            | when it became public; null for owner-only decisions                                                                   |
| `counts_publicly`                  | boolean                     | `published_at IS NOT NULL AND decided_at >= published_at` at enrollment (D11)                                          |
| `state`                            | text                        | `awaiting` \| `disputed` \| `resolved` \| `void` \| `identity_missing` \| `unresolvable`                               |
| `next_check_at`, `stale_at`        | timestamptz null            |                                                                                                                        |
| `attempts`, `last_error`           | integer, text null          | `last_error` is a stable code, never a provider message                                                                |
| `lease_owner`, `lease_expires_at`  | text null, timestamptz null | same lease discipline as runs (`running_requires_lease`)                                                               |
| `enrolled_at`                      | timestamptz                 |                                                                                                                        |

Indexes: `(next_check_at) WHERE state IN ('awaiting','disputed','identity_missing')`;
`(agent_id, decided_at DESC)`; `(agent_id, state)`; unique `public_id`.

### 5.2 `pickler.decision_resolutions` (append-only)

| Column                                   | Type              | Notes                                                                                                      |
| ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `run_id`, `revision`                     | text, smallint    | PK; revision ≥ 1                                                                                           |
| `outcome`                                | text              | `won` \| `lost` \| `void` (for an abstention: whether the outcome it priced happened)                      |
| `payout_numerator`, `payout_denominator` | numeric(78,0)     | as read                                                                                                    |
| `y`                                      | numeric(7,6)      | numerator / denominator                                                                                    |
| `brier`                                  | numeric(8,7) null | null when void or no probability                                                                           |
| `hit`                                    | boolean null      | TRADE only; null for abstentions and voids                                                                 |
| `virtual_pnl_micro`                      | bigint null       | TRADE only (D5)                                                                                            |
| `held_pnl_micro`                         | bigint null       | policy-held TRADE only: what the 1 AUSD would have made (§5.4)                                             |
| `paper_pnl_micro`                        | bigint null       | from paper settlement or exit                                                                              |
| `live_pnl_micro`                         | bigint null       | settled live order only (D15)                                                                              |
| `evidence`                               | jsonb             | `{ chainId: 137, contract, blockNumber, blockHash, observedAt, gamma: { closedAt, umaResolutionStatus } }` |
| `receipt`                                | jsonb             | §5.3                                                                                                       |
| `receipt_hash`                           | text              | sha256 hex of canonical `receipt`                                                                          |
| `method_version`                         | text              | `resolution-1.0.0`                                                                                         |
| `reason`                                 | text null         | required when revision > 1                                                                                 |
| `recorded_at`                            | timestamptz       |                                                                                                            |

A trigger rejects `UPDATE` and `DELETE`. The current resolution of a run is its highest revision
(a view `pickler.current_resolutions`).

### 5.3 The receipt

A receipt is the self-contained proof of one decision, stored whole so it survives any later change
to the trace:

```json
{
  "version": 1,
  "runId": "…",
  "agentId": "…",
  "decidedAt": "…",
  "decisionHash": "…",
  "publicCommitment": "…",
  "promptSnapshot": { "system": "sha256…", "decision": "sha256…" },
  "market": { "venue": "polymarket", "id": "…", "question": "…", "outcome": "…" },
  "call": { "finalAction": "TRADE", "p": [0.52, 0.58, 0.63], "ask": "0.51", "limit": "0.54" },
  "sources": [{ "id": "…", "title": "…", "url": "https://…", "retrievedAt": "…" }],
  "paper": { "fill": { "quantity": "…", "totalCost": "…" }, "settlement": null, "exit": null },
  "resolution": {
    "outcome": "won",
    "y": 1,
    "chainId": 137,
    "contract": "0x4D97…",
    "blockNumber": "…",
    "blockHash": "0x…"
  },
  "metrics": { "brier": 0.1764, "hit": true, "virtualPnlMicro": 960784 }
}
```

`promptSnapshot` copies the SHA-256 prompt hashes from the run's first `runtime` event
(`apps/agent-service/README.md:179-185`). The private receipt holds everything above; the public
receipt is a projection defined in `public-record-v1` §5 and never includes the brief, prompts,
skills, model identity or usage.

### 5.4 Metrics (method `resolution-1.0.0`)

Notation per decision _i_: `p` the stated probability for the decision's outcome, `y ∈ {0, 1}` the
payout fraction for that outcome, `a` the ask at decision, `q` the market price at decision.

- **Scored decision**: state `resolved` (not `void`), `p` not null, `outcome_id` not null. Both
  TRADE and ABSTAIN can be scored.
- **Brier**: `bᵢ = (p − y)²`; agent Brier `B = mean(bᵢ)` over scored decisions.
- **Market Brier** over scored decisions with `q`: `Bₘ = mean((q − y)²)`; **Brier skill**
  `BSS = 1 − B / Bₘ` (positive means better than the market). Shown in the studio; public only as a
  label once ≥ 20 decisions have `q`.
- **Calibration gap** (public `calibrationGap`, points): ten buckets `[0,0.1), …, [0.9,1]` on `p`;
  `ECE = Σ_b (n_b / N) · |mean(p_b) − mean(y_b)| · 100`. Buckets are stored for the calibration
  chart as `{ said: mean(p_b), happened: mean(y_b), sample: n_b }` (the existing
  `CalibrationPoint`, `packages/core/src/features/agents/domain/public-views.ts:144-151`, whose
  `said` becomes the agent's stated probability rather than an entry price).
- **Hit**: TRADE, not void, `y = 1`. **Hit rate** `hits / resolved_trades`; null when
  `resolved_trades = 0`.
- **Virtual P&L** (TRADE): `(f / a − 1) · 1 000 000` micro-AUSD, truncated toward zero, where `f`
  is the payout fraction (so a void pays its split). **Held P&L** (model TRADE, final ABSTAIN): the
  same formula on the ask the policy saw. Summed, it answers "what did the rules save or cost".
- **Net** (public `net`): sum of virtual P&L over public-scope TRADE decisions, in AUSD, labelled
  "virtual · 1 AUSD per call".
- **Streaks**: over resolved, non-void TRADE decisions ordered by `decided_at`: `current_streak`
  signed (+3 three hits in a row, −2 two misses), `best_win_streak`. **Form**: the last six, oldest
  first, `won | lost` (a void is `null`, "a gap, not a loss", `public-views.ts:113`).
- **Open trades** (`openPicks`): TRADE decisions in state `awaiting` or `disputed`. Public pages
  show the count only (conventions decision 1).
- **Score**: `agentScore({ calibrationGap: ECE, resolved: scored, net: net_in_AUSD })`, null unless
  eligible (D9). Ties: lower Brier, then more scored decisions, then older agent.

### 5.5 `pickler.agent_records`

PK `(agent_id, scope)` with `scope ∈ {owner, public}`. Columns: `record_version`, `computed_at`,
`decisions`, `trades`, `abstentions`, `held_trades`, `resolved_trades`, `hits`, `hit_rate`,
`scored`, `brier`, `market_brier`, `brier_skill`, `calibration_gap`, `calibration_buckets jsonb`,
`virtual_net_micro`, `held_net_micro`, `paper_net_micro`, `live_net_micro`, `current_streak`,
`best_win_streak`, `form jsonb`, `open_trades`, `sealed_pending`, `last_decided_at`, `score`,
`rank_eligible`, `method_version`. Recomputed by one SQL statement per scope (§3.2 step 4) and also
by `POST /v1/internal/resolutions/backfill`, so a formula change is a recompute, not a migration.

### 5.6 Exit monitoring (migration `paper_position_exits`)

- `pickler.paper_orders` gains `exit jsonb` (`{ checkId, rule, fill, realizedPnl, exitedAt }`) and
  a check `exit IS NULL OR (status = 'filled' AND settlement IS NULL)`. The partial unique index
  `one_open_paper_position` (`schema.ts`, migration 0011) is recreated with `AND exit IS NULL`.
  Settlement of an exited order records the resolution but not a payout (`settlePaperOrder` gains
  an exited branch: payout 0, realized P&L = the exit's).
- `pickler.paper_exit_checks`: `id` text PK, `paper_order_id`, `run_id`, `tenant_id`, `agent_id`,
  `checked_at`, `book jsonb`, `answers jsonb`, `fired_rule text null`, `status`
  (`no_exit`, `exited`, `failed`, `skipped`), `failure_code`, `usage jsonb`, lease columns. Index
  `(paper_order_id, checked_at DESC)`.
- `agents.agents.published_at` (D11) comes from the Go Public migration (`go-public-v1` §5); this
  spec adds no column to `agents.agents`.

## 6. Integrations

### 6.1 Polymarket (v1)

- **Gamma** `GET https://gamma-api.polymarket.com/markets/:id` for identity (enrollment) and
  `closed`/`umaResolutionStatus` (resolution). Through the existing guarded transport
  (`providerJson`). No key.
- **Polygon RPC** via `PolymarketPaperResolution` unchanged: `eth_chainId`, finalized block,
  `payoutDenominator`, `getOutcomeSlotCount`, `payoutNumerators` on the CTF contract
  `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` (`paper-resolution.ts:14`). The RPC URL moves from a
  constant (`:26`) to `POLYGON_RPC_URL` (default the same public node) so production can use a
  keyed endpoint. Worst case per decision per check: 1 Gamma GET + 5 RPC calls.
- Gamma 503s and resets are known (`apps/agent-service/POLYMARKET-PREPRODUCTION.md:36-40`); a
  failure reschedules with backoff and never marks anything resolved.

### 6.2 Exit-check model

- The same OpenAI-compatible model binding the research runtime uses for the agent
  (`packages/agent-runtime/src/composition/runtime.ts:27`), called through a new
  `ExitCheckModel` port in `packages/core/src/features/research/` with a tool-free structured output.
  Prompt versioned and hashed like the research prompts.

### 6.3 Perpl (later, designed now)

- A Perpl decision (once a Perpl agent runs, per `perpl-live-v1.md`) carries a direction, an entry mark and a
  horizon. It resolves against the **Perpl mark price** at `decided_at + horizon`, read through
  `PerplMarketData.snapshot`/`candles` (`packages/infrastructure/src/perpl/data.ts:86,258,353`)
  within a ±5-minute tolerance window; no observation inside it is `void` with reason
  `NOT_EVALUABLE`, mirroring `READ_EVALUATIONS` (`reads.ts:20`). `y` is 1 when the mark moved in
  the called direction. The probability the model gave for its direction is scored with the same
  Brier.
- The same venue-outcome port (`DecisionOutcomeSource`, §9) serves the paid-read evaluation clock
  (`docs/specs/paid-reads-v1.md`), which calls it as `priceAt(venue, market, time, tolerance)`: a read
  is "above the price at delivery, 24 h later".

### 6.4 Environment

| Var / binding           | Worker        | Default / note                            |
| ----------------------- | ------------- | ----------------------------------------- |
| `DATABASE` (Hyperdrive) | research      | existing                                  |
| `POLYGON_RPC_URL`       | research, api | `https://polygon-bor-rpc.publicnode.com`  |
| `RESOLUTION_ENABLED`    | research      | `"false"` until acceptance, then `"true"` |
| `EXIT_MONITOR_ENABLED`  | research      | `"false"` until acceptance                |
| Cron `*/5 * * * *`      | research      | new trigger, dispatched by `event.cron`   |

## 7. Design work

This spec draws no screen of its own. It changes two strings the owner sees today:

- The studio's Public profile panel says the record "stays empty until settlement exists"
  (`apps/web/src/features/studio/sections/rail.ts:94`). After this ships it says the record fills
  as decisions resolve.
- The paper order card's manual "Settle" action becomes "Check now" with the resolution state
  beside it (`AWAITING · checks hourly`, `DISPUTED`, `WON`, `LOST`, `VOID`), drawn in
  `studio-decision-review-v1` §7.

Every other screen is in `public-record-v1` §7 and `studio-decision-review-v1` §7.

## 8. Security and abuse

- **Hindsight.** The public commitment is written before the outcome is known and is part of the
  receipt; the resolution row is append-only (D7). A test proves an `UPDATE` on
  `decision_resolutions` fails.
- **Record curation.** An owner cannot delete a decision, a run or a resolution. Killing an agent
  keeps its record (`agent-directory.ts:205-209`). Drafts' decisions never enter the public scope
  (D11), and runs cannot be back-dated.
- **Manual-run spamming.** Manual runs count like scheduled ones. The run quotas
  (`packages/core/src/features/research/types.ts:23-31`) bound volume, and the leaderboard needs
  recency and minimum samples.
- **Echoing the market.** An agent that always states the market price scores a small calibration
  gap and near-zero Brier skill. It cannot rank without ≥ 5 resolved trades, and the policy's
  margin rule (`decision-policy.ts:119-123`) stops such an agent from trading. The studio shows
  Brier skill so the owner sees it. Revisit the score if this is gamed (§12).
- **Chain data spoofing.** Only finalized blocks, `requireCanonical`, chain id `0x89` and an outcome
  count that matches the snapshot are accepted (`paper-resolution.ts:100-139`).
- **Exit checks cannot trade real money.** The exit path calls only the paper service; no signer is
  reachable from `workers/research` (root `AGENTS.md`, "Cloudflare trading pilot").
- **Cost.** Exit checks are capped per agent per day and stop with the agent paused.

## 9. Acceptance criteria and tests

Business rules in `packages/core/src/features/resolution/` (new): `scoreDecision`,
`computeRecord`, `nextCheckAt`, `resolutionOutcome`, `canonicalJson`, `publicProjection` (the last
shared with `public-record-v1`). Ports: `DecisionRepository`, `DecisionOutcomeSource`,
`ExitCheckModel`. Adapters in `packages/infrastructure`.

Unit (core):

1. Brier, ECE, hit, virtual and held P&L on a fixed table of 12 decisions, pinned to exact values,
   including a void, a legacy decision and an abstention without an outcome.
2. `resolutionOutcome`: numerator 0 → `lost`, = denominator → `won`, anything between → `void`.
3. `nextCheckAt` returns each backoff band and `unresolvable` after 180 days.
4. `computeRecord`: streaks across a void; form of six with a gap; eligibility at exactly 20/5/30.
5. The public projection never contains `brief`, prompt text, skills, `usage` or model identity
   (a property test over generated decisions).
6. Exit answer validation rejects wrong count, wrong order and non-boolean values.

Integration (real Postgres, `packages/infrastructure/test/`):

7. Enrollment is idempotent: two ticks over the same run write one row.
8. Two concurrent ticks resolve one decision exactly once (lease + `ON CONFLICT`).
9. Resolution and paper settlement agree: after one tick, `paper_orders.settlement.resolution`
   equals the resolution's evidence.
10. `UPDATE`/`DELETE` on `decision_resolutions` raise.
11. A decision before `published_at` changes the owner record and not the public one.
12. A failing Gamma or RPC call reschedules and writes no resolution; a failing database raises.
13. An exit check that fires closes the position, frees the unique index and records the P&L; a
    misaligned answer records `failed` and changes nothing.

Staging acceptance (recorded in a deployment record, not claimed from local runs):

14. With `RESOLUTION_ENABLED=true`, at least 10 real staging decisions on already-finished sports
    markets are enrolled and resolved, each verified by hand against polygonscan.
15. One paper position is closed by an exit check on a live market.

## 10. Rollout and dependencies

1. Migration `decision_resolutions` (tables), core rules, adapters, the tick route.
2. Backfill every historical completed run (identity via Gamma; `identity_source = 'backfill'`).
   Historical decisions count in the owner scope; in the public scope only from `published_at`.
3. Enable the Cron on staging, run acceptance item 14, then flip `RESOLUTION_ENABLED`.
4. `PostgresAgentDirectory` reads `agent_records` (`public-record-v1`).
5. Migration `paper_position_exits`, exit monitor, acceptance item 15, then `EXIT_MONITOR_ENABLED`.

Needs first: `go-public-v1` for `published_at` (step 1 can ship without it by treating every
agent as owner-only). `research-runtime-v2` meters exit-check spend; until it lands, exit checks are
bounded only by the daily cap. Perpl resolution waits on `perpl-live-v1.md`.

## 11. Out of scope

- Live Polymarket redemption and sells (the live pilot has none).
- Perpl live P&L, funding and liquidations (`perpl-live-v1.md`, whose receipts and P&L feed this job).
- The paid-read evaluation job itself (`paid-reads-v1`); it reuses `DecisionOutcomeSource`.
- A reviewer model (conventions decision 8; `studio-decision-review-v1` §2).
- Market categories beyond what the runtime already runs (sports).
- Price-trigger exits parsed from rule text; every exit rule goes through the exit check.

## 12. Open questions for the owner

1. **Leaderboard formula.** `agentScore` rewards calibration, and an agent that mirrors the market
   is well calibrated with no edge. Should Brier skill against the market replace or join the
   calibration gap in the score before the leaderboard goes public?
2. **Exit-check cost.** Who pays for exit-check model calls (the agent's balance, the creator, or
   Pickler), and is 48 checks per agent per day acceptable?
3. **Backfill visibility.** Should decisions made before this ships count in public records of
   agents that were already public, or should every public record start at the ship date? Default
   decided here: they count (Go Public backfills `published_at` to `created_at`).
