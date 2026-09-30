# Perpl agent runtime v1: the perps-direction-v1 protocol, paper first

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`
(decision 12: perps decisions get their own protocol spec, and both `research-runtime-v2.md` and
`perpl-live-v1.md` depend on it; decision 13: prices come from `decision-resolution-v1`'s
`PriceObservationSource`; decision 15: product jobs in `workers/jobs`). It resolves cross-review
G1, K1 and C3. Every decision is reversible.

## 1. Problem and users

A studio agent cannot decide on perps today. The pieces exist but only in laboratories:

- the Perpl public-data plugin (`packages/agent-runtime/src/plugins/perpl/tools.ts:16-62`: markets,
  snapshot, order book, candles, funding history), run from an operator CLI with a 12-request
  session cap (`packages/infrastructure/src/perpl/transport.ts:65`);
- the perps paper account and simulator (`packages/trading/src/features/perps-paper/policy.ts:153-195`,
  migrations `0012_stale_exiles.sql`, `0013_breezy_raza.sql`), used only by local CLIs;
- the comparison study's proposal contract, model proposes and code sizes
  (`packages/trading/src/features/evaluation/perps-runner.ts:66-102`), local only;
- Perpl refused as a studio venue (`packages/core/src/features/studio/draft.ts:10`, `:126-128`), and
  the brief's `maxLeverage` stored but unused (`packages/core/src/features/research/types.ts:76`).

Three specs assumed a protocol nobody defined (cross-review C3): `decision-resolution-v1.md` §6.3
wants a horizon, `research-runtime-v2.md` R7 names `perps-direction-v1`, and `perpl-live-v1.md`
consumes its decisions. This spec is that protocol, the hosted data session it needs, and the
paper-first path that lets a studio agent trade perps before any real collateral moves.

Users: **agent owners** who pick Perpl in the studio; **agents** (the model decides direction, code
does everything else); **readers of the record** (hit rate, Brier, paper and live P&L).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reason                                                                                                                                                                                                                                     | Reversible?                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| A1  | **`perps-direction-v1` decision** = `{ instrument, action, probability, horizonHours, stopLossBps?, takeProfitBps?, rationale }` (§3.5). The model never outputs size, leverage, price, account or keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Model proposes, code sizes (`packages/trading/AGENTS.md:11`; `docs/trading-architecture.md`: "Models never control capital, risk limits, credentials or repositories").                                                                    | Yes (a v2 protocol).                              |
| A2  | **Instruments: BTC and ETH perps** on Perpl, the two the data plugin and its acceptance cover (`apps/agent-service/PERPL-DATA.md`). The owner picks one or both in the brief.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Proven data path; more markets need their own acceptance.                                                                                                                                                                                  | Yes (a list in core).                             |
| A3  | **Horizon: allowed set {4, 24, 72} hours, default 24.** The model picks from the set; out of set or missing means 24. The horizon is both the scoring clock and the maximum holding time: code closes the position at `decided_at + horizon` if nothing closed it earlier.                                                                                                                                                                                                                                                                                                                                                                                                   | 24 h matches the paid-read clock (`research-runtime-v2.md` row for perps) and the funding cycle; 4 h and 72 h give styles room without making scoring arbitrary. One clock for scoring and exit keeps P&L and hit rate about the same bet. | Yes.                                              |
| A4  | **Entry is observed by code, not proposed**: the entry mark is the Perpl mark price read at decision time through the book-before-ticker order (`PERPL-DATA.md`); the model sees it as evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A model-quoted price is unverifiable; the record needs one entry per decision.                                                                                                                                                             | Yes.                                              |
| A5  | **Stops and take-profit**: the model may propose `stopLossBps` in [100, 1500] and `takeProfitBps` in [100, 5000] of the entry mark; out-of-range values are clamped; missing values take the style's defaults: careful 300/600, balanced 500/1000, bold 800/2000.                                                                                                                                                                                                                                                                                                                                                                                                            | The model's view of volatility is useful; unbounded values are not. Defaults tie to the existing three styles (`packages/core/src/features/research/style.ts:4-11`).                                                                       | Yes.                                              |
| A6  | **Sizing within the brief's caps, by conviction**: margin = `spend.perCallAusd × f`, where `f` = 1.0 when the probability for the called direction is ≥ 0.65, 0.5 when ≥ 0.55; below 0.55 the policy turns the open into an ABSTAIN (`LOW_CONVICTION`). The day cap `spend.perDayAusd` bounds the sum of margins opened in a UTC day.                                                                                                                                                                                                                                                                                                                                        | Reuses the caps the owner already sets (`studio-brief-v1.md:45-51`); coarse steps avoid pretending a probability is a precise edge.                                                                                                        | Yes (policy version `perps-direction-policy-v1`). |
| A7  | **`close` and `hold`**: `close` closes the agent's open position on that instrument; `hold` does nothing. **Neither is scored** (no hit rate, no Brier); both appear in the owner's trace. Only `open-long` and `open-short` are scored decisions.                                                                                                                                                                                                                                                                                                                                                                                                                           | Cross-review C3: they have no direction to score. A close still changes P&L, which the position records.                                                                                                                                   | Yes.                                              |
| A8  | **Resolution: the Perpl mark price at `decided_at + horizonHours`**, on the agent's Perpl network (A16): a testnet agent is scored on the testnet mark and labelled "Testnet" (conventions decision 20, `perpl-live-v1.md` P18), through `decision-resolution-v1`'s `PriceObservationSource` (conventions decision 13), ±5 minutes; `y = 1` when the mark moved in the called direction from the entry mark; no observation in the window is `void` (`NOT_EVALUABLE`). Brier scores the probability for the called direction.                                                                                                                                                | One authority per venue, as `decision-resolution-v1` D2 does for Polymarket; this spec supplies the horizon that spec's §6.3 needed.                                                                                                       | Yes.                                              |
| A9  | **Paper first, always**: every Perpl agent runs on the existing perps paper tables and simulator with the unchanged `conservative-1x-v1` policy (1x, 1 000 virtual AUSD, `policy.ts:182-195`). The brief's leverage applies only to live execution; the studio says "Paper runs at 1x". A live agent keeps its paper shadow.                                                                                                                                                                                                                                                                                                                                                 | The research asked to reuse the paper tables; changing the simulator's risk model is its own work. The shadow gives every live agent a like-for-like paper record.                                                                         | Yes (a leveraged paper policy is v2).             |
| A10 | **One venue per agent**: an agent is a Polymarket agent or a Perpl agent (`AgentConfig.venue`), chosen on the studio map; its protocol follows the venue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A mixed agent needs a mixed protocol and mixed caps; nothing asks for it yet.                                                                                                                                                              | Yes.                                              |
| A11 | **Perpl leaves `SOON_VENUES` for paper when `research-runtime-v2.md` R9 passes for this protocol** (20 staging paper runs, 18 reaching a decision, resolution wired, owner sign-off). The switch is a var, `PERPL_PAPER_ENABLED`: `SOON_VENUES` becomes `soonVenues(liveVenues)` in core, fed by the API's `GET /v1/studio/venues` (defined in `perpl-live-v1.md` §4), so the web mirror (`apps/web/src/features/studio/create/draft.ts:42`) stops hardcoding it.                                                                                                                                                                                                            | R9 is the product's existing soon → live rule; a var lets operators turn a venue off.                                                                                                                                                      | Yes.                                              |
| A12 | **Hosted data session**: runs in `workers/research` inside the run, with a per-run budget of 40 Perpl requests and a 20 s acquisition deadline, reusing the guarded acquisition of PR #60/#63 (read order, deadlines, transient recovery). The CLI's 12-request session cap stays for the CLI.                                                                                                                                                                                                                                                                                                                                                                               | The model's tool calls plus the evidence snapshot need more than 12 requests; a per-run budget still bounds load on Perpl.                                                                                                                 | Yes (vars).                                       |
| A13 | **Cadence**: a Perpl agent's schedule defaults to every 6 hours (conventions decision 20: it leaves runs for follow-ups) and is a `research-runtime-v2` schedule like any other; at most one open position per instrument per agent (paper: `perps_paper_open_symbol`, `0012_stale_exiles.sql:45`). An `open-*` on an instrument with an open position in the same direction is a `hold`; in the opposite direction it closes and reopens.                                                                                                                                                                                                                                   | Four runs a day leave room in the budget for follow-ups; one position per instrument keeps attribution to one decision.                                                                                                                    | Yes.                                              |
| A14 | **Exits**: paper stops, take-profits and horizon exits are checked by a `workers/jobs` Cron every minute (conventions decisions 15 and 18), which calls an internal API route; live positions and live exits belong to `perpl-live-v1.md` (P9, conventions decision 20) and run in `workers/trading`, because only that Worker holds the trading key.                                                                                                                                                                                                                                                                                                                        | Decision 15 puts exit checks in jobs; a live close needs the signer, and `workers/jobs` holds no secret (`production-environment-v1.md`).                                                                                                  | Yes.                                              |
| A15 | **Live eligibility**: `perpl-live-v1` onboarding is offered only to a public Perpl agent with at least 5 resolved paper `perps-direction-v1` decisions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A record before money; small enough not to stall the pilot.                                                                                                                                                                                | Yes.                                              |
| A16 | **One Perpl network per agent, fixed at creation**: `perps.network` = the network of `PERPL_CHAIN_ID` when the agent is created (`testnet` during the testnet phase, `mainnet` after). The data session, the paper account (and a live agent's paper shadow), live execution and scoring all use that network. The Perpl plugin config carries it: `createPerplSession(..., { network })` selects the base URL from `PERPL_NETWORKS` (`packages/infrastructure/src/perpl/transport.ts:2-5`: `https://testnet.perpl.xyz/api` for testnet, `https://app.perpl.xyz/api` for mainnet), with `PERPL_DATA_TESTNET_URL` / `PERPL_DATA_MAINNET_URL` overriding them per environment. | A testnet agent reading mainnet prices would decide on one market and be scored and executed on another (scope map item 8). Fixing it at creation keeps each record on one network.                                                        | Yes.                                              |

## 3. User flows

### 3.1 Choosing perps (owner, studio)

1. On the studio map the owner picks **Perpl** (drawn "Soon" until A11). The brief then shows:
   instruments (BTC, ETH, both), style (careful, balanced, bold), PER TRADE and PER DAY (margin,
   AUSD), MAX LEVERAGE ("applies when it trades for real; paper runs at 1x").
2. Create runs the existing ceremony and the first run (`studio-create-and-fund-v1.md` §4). The
   first run is a `perps-direction-v1` run on paper.

### 3.2 A run

1. Schedule or manual trigger (`research-runtime-v2.md` schedules and budgets).
2. The runtime opens the hosted data session (A12), collects the evidence snapshot per instrument
   (ticker, book, 1h and 4h candles, funding history) and hands the model the Perpl tools for
   follow-up reads.
3. The model returns one decision per instrument in the brief (§3.5 schema). Structured output is
   validated; an invalid decision is an ABSTAIN with `INVALID_DECISION`.
4. Core policy rechecks it: brief entry and never rules (as `studio-brief-v1`), style uncertainty
   policy, conviction (A6), stale evidence (> 30 s, `PERPS-PAPER.md` freshness), day cap. A refusal
   becomes an ABSTAIN with its reason.
5. The decision is stored on the run and enrolled by `decision-resolution-v1` with `venue = 'perpl'`,
   `market_id = instrument`, `expected_end_at = decided_at + horizon`.

### 3.3 Execution

- **Paper (every agent)**: in the same run, `@pickler/trading/perps` opens the paper position with
  notional = margin (1x, A9), capped by `conservative-1x-v1` (100 AUSD notional, `policy.ts:153`),
  and records the decision's `run_id`, stop, take-profit and horizon on the position.
- **Live (agents onboarded by `perpl-live-v1`)**: the research worker also enqueues
  `{ kind: "perpl-decision", agentId, runId }` on the trading queue; `perpl-live-v1.md` §3.2 does
  the rest.

### 3.4 Watching and going live

The studio's Picks and Activity show each Perpl decision with instrument, direction, probability,
horizon, entry, stop and take-profit; the paper position's P&L; after the horizon, the resolution.
When A15 is met the Trading section offers "Trade it for real on Perpl" (`perpl-live-v1.md` §3.1).

### 3.5 The protocol

`perps-direction-v1` joins `ResearchProtocol` (today `"nfl-winner-v1" | "general-market-v1"`,
`packages/core/src/features/research/market-scope.ts:7`).

```ts
// packages/core/src/features/research/perps-direction.ts (decision)
export const PERPS_INSTRUMENTS = ["BTC", "ETH"] as const;
export const PERPS_HORIZONS_HOURS = [4, 24, 72] as const;
export const DEFAULT_PERPS_HORIZON_HOURS = 24;

export interface PerpsDirectionDecision {
  protocol: "perps-direction-v1";
  instrument: (typeof PERPS_INSTRUMENTS)[number];
  action: "open-long" | "open-short" | "close" | "hold";
  /** Probability that the mark is higher (long) or lower (short) at the horizon; 0.5-1. */
  probability: number | null;
  horizonHours: (typeof PERPS_HORIZONS_HOURS)[number];
  stopLossBps: number | null;
  takeProfitBps: number | null;
  rationale: string; // ≤ 600 chars, owner-only until publication rules apply
}

/** Code-observed, stored beside the decision; never model output. */
export interface PerpsEntryObservation {
  marketId: number; // Perpl market id from /pub/context
  markPrice: string; // decimal string at the market's price decimals
  observedAt: string; // ISO 8601
  bookSpreadBps: number;
}
```

Rules in `@pickler/trading/strategies` (policy `perps-direction-policy-v1`): clamp stop and
take-profit (A5), conviction to size fraction (A6), same-direction open → hold and opposite-direction
open → close then open (A13), and the refusal codes `LOW_CONVICTION`, `STALE_EVIDENCE`,
`DAY_CAP_REACHED`, `INSTRUMENT_NOT_IN_BRIEF`, `INVALID_DECISION`, `BRIEF_NEVER_RULE`.

Resolution in `decision-resolution-v1`: the Perpl implementation of `PriceObservationSource`
(conventions decision 13) reads the mark at the target time through
`PerplMarketData.snapshot`/`candles` (`packages/infrastructure/src/perpl/data.ts:86`) within ±5 min;
`y` and Brier per A8. That spec's §6.3 cites this section for the horizon.

## 4. API

No new public route; the owner's views use the existing studio run, picks and activity routes, whose
DTOs gain the Perpl fields. New and changed:

| Method | Path                                                                            | Auth                             | Request                                                               | Response                                                                                                                                                                                                                                           | Errors                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/studio/venues`                                                             | studio                           | —                                                                     | `{ liveVenues, soonVenues, perpl: { paper: boolean, live: boolean, network } }`; `paper` from `PERPL_PAPER_ENABLED` (this spec, which ships first), `live` added by `perpl-live-v1` from `PERPL_STUDIO_ENABLED`                                    | —                                                                                                                                                        |
| POST   | `/v1/studio/agents/draft`                                                       | studio                           | unchanged                                                             | the draft's `unsupported` no longer lists `venue:perpl` when paper is enabled                                                                                                                                                                      | unchanged                                                                                                                                                |
| PUT    | `/v1/studio/agents/:id/config` (exists, `workers/api/src/routes/studio.ts:530`) | studio                           | config gains `venue` and, for a Perpl agent, `perps: { instruments }` | the config                                                                                                                                                                                                                                         | 400 `INVALID_CONFIG` (`detail.fields`: instruments empty or not in `PERPS_INSTRUMENTS`); 409 `VENUE_FIXED` (the venue cannot change after the first run) |
| GET    | `/v1/studio/agents/:id/perps/positions`                                         | studio                           | `?source=paper\|live&state=open\|closed&cursor&limit`                 | `PerpsPositionDto[]`: instrument, side, entry, size, stop, take-profit, `exitDueAt`, `closeReason`, realized P&L, the decision run id, `network`. This spec serves `source=paper`; `perpl-live-v1` §4 adds `source=live` (conventions decision 20) | 404 `AGENT_NOT_FOUND`; 400 `LIVE_NOT_ENABLED` for `source=live` before `perpl-live-v1` ships                                                             |
| POST   | `/v1/internal/perps/paper/exits`                                                | service binding (`workers/jobs`) | —                                                                     | `{ checked, closed: { stop, takeProfit, horizon } }`                                                                                                                                                                                               | —                                                                                                                                                        |

DTOs in `packages/api-schema` (decision): `PerpsDecisionDto` (the §3.5 decision plus the entry
observation), `PerpsPositionDto`, the `venue` and `perps` fields of the config DTO.

## 5. Data model and migrations

Migration **`perps_direction`** (number assigned at build time; next free is 0023):

- `pickler.perps_paper_positions`: `ADD COLUMN run_id text null REFERENCES pickler.runs(id)`,
  `ADD COLUMN stop_loss_bps int null`, `ADD COLUMN take_profit_bps int null`,
  `ADD COLUMN exit_due_at timestamptz null`, `ADD COLUMN close_reason text null CHECK (close_reason
IN ('decision','stop','take_profit','horizon','policy'))`; index `(exit_due_at) WHERE closed_at IS
NULL`. The position document stays the simulator's source of truth; the columns are what the exit
  job queries.
- Paper accounts for product agents use `session_id = 'product'` and `network` = the agent's
  `perps.network` (A16) in the existing unique scope (`0012_stale_exiles.sql:44`).
- `AgentConfig` (JSON, no migration): `venue: 'polymarket' | 'perpl'` (default `polymarket` for
  every existing agent), `perps: { instruments: string[], network: 'testnet' | 'mainnet' }`, and the existing `maxLeverage`.
- `pickler.decisions` (`decision-resolution-v1`): `venue = 'perpl'` rows with
  `market_id = instrument`, `expected_end_at = decided_at + horizon`, and the entry observation in
  `resolution_identity`; the check constraint is that spec's change.

## 6. Integrations

| System / setting                                                       | Use                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Perpl public API (data plugin)                                         | markets, snapshot, book, candles and funding history through the existing tools (`packages/agent-runtime/src/plugins/perpl/tools.ts:16-62`), on the agent's network (A16)                                    |
| `PERPL_DATA_TESTNET_URL`, `PERPL_DATA_MAINNET_URL`                     | `workers/research` vars; default to `PERPL_NETWORKS` in `packages/infrastructure/src/perpl/transport.ts:2-5`; the session checks `/v1/pub/context`'s chain id against the network, as `data.ts:103-106` does |
| `PERPL_CHAIN_ID`                                                       | the network new Perpl agents are created on (A16); shared with `perpl-live-v1.md` §6.3                                                                                                                       |
| `PERPL_PAPER_ENABLED`                                                  | `workers/api` var (A11)                                                                                                                                                                                      |
| `PERPL_SESSION_MAX_REQUESTS` (40), `PERPL_SESSION_DEADLINE_MS` (20000) | `workers/research` vars (A12)                                                                                                                                                                                |
| `PriceObservationSource` (Perpl)                                       | `decision-resolution-v1`'s port, reading the mark on the decision's network (A8)                                                                                                                             |
| `workers/jobs`                                                         | dispatches the paper exit check every minute to `POST /v1/internal/perps/paper/exits` (A14; conventions decision 18)                                                                                         |

## 7. Design work

Surface: **studio** only (the marketplace shows resolved Perpl decisions through `public-record-v1`).

| Screen                     | States                                                                                                                    | Canvas                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Map: Perpl venue           | Soon → selectable when `liveVenues` has `perpl`                                                                           | Existing (`studio-create-and-fund-v1.md` §2.3); state change only                                                |
| Brief for a Perpl agent    | instrument chips (BTC, ETH), MAX LEVERAGE without "Soon" and with "paper runs at 1x"; margin wording on PER TRADE/PER DAY | **Must be drawn**: a Perpl variant of the brief artboard on the studio canvas ("Pickler Studio Empty v4" family) |
| Pick card, perps           | long/short chip, probability, horizon countdown, entry, stop and take-profit, paper P&L; resolved hit/miss/void           | **Must be drawn**, beside the Polymarket pick card                                                               |
| Positions list (paper)     | open, closed with reason (stop, take-profit, horizon, decision)                                                           | **Must be drawn**; shares its layout with `perpl-live-v1`'s live positions table                                 |
| "Trade it for real" prompt | locked (n of 5 resolved), available                                                                                       | **Must be drawn**, links to `perpl-live-v1.md` §7's Perpl card                                                   |

## 8. Security and abuse

- The model has read tools only (the Perpl data plugin); no execution tool exists for it
  (`docs/trading-architecture.md`, Plugins: "Execution factories expose operator services, never
  model execution tools").
- Every model field is validated and clamped (A3, A5); a malformed decision is an ABSTAIN.
- The hosted session's request budget and deadline (A12) bound load on Perpl per run; the
  research worker's run concurrency (`one_running_agent`, `0000_research_persistence.sql:55`) bounds it per agent.
- Paper money is virtual and labelled so everywhere; paper P&L is never shown as live P&L.

## 9. Acceptance criteria and tests

- Core: schema validation of `PerpsDirectionDecision` (horizon default and set, clamps, instruments),
  policy refusals and size fractions, open/close/hold rules (A13).
- Trading: paper open with stop and take-profit; each exit reason closes at the right mark; horizon
  exit at `exit_due_at`.
- Infrastructure: the hosted session honours 40 requests and 20 s, and reads the book before the
  ticker; migration round trip.
- Resolution: a long resolved up is `y = 1`; a missing observation is `void NOT_EVALUABLE`; `close`
  and `hold` are never enrolled as scored.
- Staging (R9 for this protocol): 20 paper runs on BTC and ETH, ≥ 18 reaching a decision, every
  scored decision resolved at its horizon, recorded in `docs/staging-acceptance-perps-<date>.md`;
  then `PERPL_PAPER_ENABLED=true`.

## 10. Rollout and dependencies

1. Protocol types and policy in core and trading; migration `perps_direction`.
2. Hosted data session in `workers/research` (after PR #60/#63 merge).
3. Paper exit job in `workers/jobs` with its internal route.
4. Studio screens; R9 acceptance; `PERPL_PAPER_ENABLED=true` on staging.
5. `perpl-live-v1` builds on it for live execution.

Needs first: `decision-resolution-v1` (the `PriceObservationSource` port and Perpl enrollment),
`research-runtime-v2` (schedules, the money budget, the R9 rule; it lists this protocol in its
catalog and does not define it), `studio-brief-v1` (the brief), `production-environment-v1`
(`workers/jobs`). Consumed by: `research-runtime-v2.md` (R7 category), `perpl-live-v1.md`
(decisions to execute), `decision-resolution-v1.md` §6.3 (horizon), `paid-reads-v1.md` (a perps
read uses the same resolution at the read's clock).

## 11. Out of scope

Leveraged paper; instruments beyond BTC and ETH; mixed-venue agents; limit or resting orders;
funding-rate strategies as a separate protocol; a model-chosen size.

## 12. Open questions for the owner

1. Is **24 hours** the right default horizon for perps decisions, with 4 h and 72 h as the other
   choices?
2. Should paper runs apply the brief's leverage (a leveraged paper policy) before live, or is
   "paper runs at 1x" acceptable for v1?
