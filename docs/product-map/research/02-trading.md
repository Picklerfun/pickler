# 02 — Trading venues and execution (Perpl, Polymarket, paper, live)

Research snapshot of `origin/main` at `c407fec` (2026-09-30), plus open PRs #60, #62 and #63.
Read-only: nothing was run, deployed or signed. "Deployed" means what the committed staging records
and Wrangler configs say. It was not checked live.

## 1. Summary

1. **Perpl (perps on Monad) is data and paper only.** There are guarded public-data tools
   (BTC/ETH, mainnet 143 and testnet 10143), a 1x virtual account with an exact ledger and
   simulator, and a local 3-arm comparison study (rules, DeepSeek, Jev). All of it runs from
   operator CLIs. None of it is in a deployed Worker or in the Studio (`SOON_VENUES = ["perpl"]`).
2. **Polymarket has two separate paths.** Paper buys and on-chain settlement are wired into the
   deployed Studio API. The live pilot (BUY/FOK, 5 pUSD per order, 10 pUSD lifetime) is deployed
   as `pickler-trading-staging` with admissions closed. It has no credentials, no bound account and
   no real order yet.
3. **Nothing lets an agent trade Perpl for real.** No Perpl account onboarding, no API-key
   enrollment, no order/cancel client, no Perpl reconciliation, no exchange risk model. The agent's
   Turnkey wallet cannot sign anything, because `VENUE_CONTRACTS = []`.
4. **The custody model as specified does not fit Perpl's real flow.** Perpl orders are
   Ed25519-API-key messages that the exchange forwards on-chain. The wallet signs only `approve`,
   `createAccount(deposit)`, `allowOrderForwarding` and a one-time key-enrollment signature. The
   wallet DENY on ERC-20 `approve` and the tx-destination-only ALLOW both block or miss parts of
   that flow. Studio testnet funds use a different token (AUSD) from Perpl testnet collateral (USD).
5. **Specs are missing** for Perpl live execution (account binding, key custody, order lifecycle,
   risk, reconciliation), venue funding, the Turnkey venue-policy round, a deployed Perpl
   runtime/agent path, and a real market board. PR #62 is a gap review. It is not a spec.

## 2. What exists

Legend: **P** = paper/virtual, **L** = live money, **D** = data only.

| Capability                                                                                                    | Spec (file:section)                                                                                      | Implemented? (evidence)                                                                                                                                                                                                                                                                                                                                                  | P/L         | Deployed?                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trading package boundary: `polymarket`, `perps`, `strategies`, `evaluation` subpaths                          | `docs/trading-architecture.md:15-31`; `packages/trading/AGENTS.md:1-18`                                  | yes: `packages/trading/src/{polymarket,perps,strategies,evaluation}.ts`; merged in #59                                                                                                                                                                                                                                                                                   | —           | library only                                                                                                                                                                                                                                                                                                                                 |
| Plugin catalog (`paper-trading`, `polymarket-trading`, `perpl`, `perps-paper`), tool → plugin map             | `docs/trading-architecture.md:48-59`                                                                     | yes: `packages/core/src/features/research/plugins.ts:8-30`                                                                                                                                                                                                                                                                                                               | —           | catalog is in all hosts                                                                                                                                                                                                                                                                                                                      |
| **Perpl public data**: markets, snapshot, L2 book, candles, funding history                                   | `apps/agent-service/PERPL-DATA.md:1-94`                                                                  | yes: `packages/agent-runtime/src/plugins/perpl/{index.ts:6-17,tools.ts:16-62}`; transport caps at `packages/infrastructure/src/perpl/transport.ts:65` (12 requests), `:73` (10 s), `:80` (no redirect), `:87` (2 MiB); `PerplMarketData` `packages/infrastructure/src/perpl/data.ts:86`                                                                                  | D           | **no**. Operator CLI only (`apps/agent-service/src/perpl-data.ts`). No Worker composes it (grep over `workers/*/src`)                                                                                                                                                                                                                        |
| Perpl public acceptance (mainnet/testnet captures)                                                            | `PERPL-DATA.md:120-145`                                                                                  | yes: 2026-09-28 probes, 18 GETs, 0 model calls, 0 txs                                                                                                                                                                                                                                                                                                                    | D           | n/a                                                                                                                                                                                                                                                                                                                                          |
| Perpl data reliability (book-before-ticker, deadlines, transient recovery, lease fencing)                     | PR #60 `docs/perpl-validation-follow-up.md`; PR #63 `apps/agent-service/PERPL-RELIABILITY-VALIDATION.md` | **open PRs**. #60: read order plus a shared USD 5 campaign cap. #63, stacked on #60: 20 s guarded acquisition, skipped slots, `lease-heartbeat.ts`, `evaluate stability`. #63's public probe **failed** (14/30 cycles, `LEASE_LOST` after the laptop slept)                                                                                                              | D/P         | no                                                                                                                                                                                                                                                                                                                                           |
| **Perps paper account** (1,000 virtual AUSD, `conservative-1x-v1`)                                            | `apps/agent-service/PERPS-PAPER.md:1-70`                                                                 | yes: initial account `packages/trading/src/features/perps-paper/policy.ts:182-195`; limits at `:153` (100 AUSD notional), `:99` (3% daily), `:100` (5% drawdown), `:120-121` (2% adverse stop); store `packages/infrastructure/src/persistence/perps-paper-store.ts:31`; migration `0012_stale_exiles.sql` (accounts, attempts, movements, positions; RLS)               | P           | no (local CLI `apps/agent-service/src/perps-paper.ts`)                                                                                                                                                                                                                                                                                       |
| Perps paper simulator (full-depth, 50 bps bound, fees, sampled mark risk, estimated funding, sticky disputes) | `PERPS-PAPER.md:72-165`                                                                                  | yes: `simulation.ts:30-65` (freshness 30 s, skew 5 s), `:71-89` (50 bps, sizing), `:155` observations; runtime `packages/agent-runtime/src/plugins/perps-paper/index.ts:12-58`; migration `0013_breezy_raza.sql` (observations)                                                                                                                                          | P           | no                                                                                                                                                                                                                                                                                                                                           |
| Perps comparison study (rules SMA20/50, DeepSeek, Jev; 15-min slots; USD 5 model budget)                      | `apps/agent-service/PERPS-STUDY.md`; `EVALUATIONS.md`                                                    | yes: `packages/trading/src/features/evaluation/perps-runner.ts:37`; rules `perps-study/policy.ts:84`; migration `0014_square_robbie_robertson.sql` (studies, rounds, events). Merged via #59, which superseded #58. The first study `perps-20260928-v1` stopped on `INCONSISTENT_MARKET_DATA` (PR #60 doc)                                                               | P           | no. Local foreground process                                                                                                                                                                                                                                                                                                                 |
| Model proposes, code sizes                                                                                    | `packages/trading/AGENTS.md:11`, `:52-55`                                                                | yes: `perps-runner.ts:66-102` maps a proposal (`hold/open-long/open-short/close`) to fixed-notional paper fills                                                                                                                                                                                                                                                          | P           | no                                                                                                                                                                                                                                                                                                                                           |
| **Polymarket paper buy** (10-unit budget, FOK-like full fill, fee curve)                                      | `apps/agent-service/PAPER-TRADING.md:1-40`                                                               | yes: `packages/trading/src/features/paper/orders.ts:73` (`PAPER_BUDGET_AUSD = 10`), `:82-95` (per-call and daily caps from `spend`); `packages/infrastructure/src/persistence/paper-store.ts:110-120`; migration 0004                                                                                                                                                    | P           | **yes**: Studio API `workers/api/src/routes/studio.ts:684-708`, composed at `workers/api/src/container.ts:416`                                                                                                                                                                                                                               |
| Polymarket paper settlement (CTF payout read on Polygon) and summary                                          | `PAPER-TRADING.md:48-117`                                                                                | yes: `packages/trading/src/features/paper/settlement.ts`; migration `0011_cuddly_shocker.sql`; routes `studio.ts:663-682`. Explicit call only, no scheduler                                                                                                                                                                                                              | P           | yes (API). A real-market end-to-end run is still pending (`PAPER-TRADING.md:114-117`)                                                                                                                                                                                                                                                        |
| Paper spend limits (`perCallAusd` / `perDayAusd`)                                                             | `docs/specs/studio-create-and-fund-v1.md` §6.3                                                           | yes for paper: `SPEND_ENFORCED = true` at `packages/core/src/features/research/types.ts:91-95`. Its comment says real-money limits are future Turnkey value caps. PR #62 (older main) still says `false`; that is out of date                                                                                                                                            | P           | yes                                                                                                                                                                                                                                                                                                                                          |
| **Polymarket live pilot** (Deposit Wallet, BUY/FOK, manual then one automatic)                                | `apps/agent-service/LIVE-TRADING.md`; `docs/polymarket-worker-pilot.md`                                  | yes: service `packages/trading/src/features/trading/service.ts:48` (≤ 5 pUSD per order), `:84-173` (includes automatic candidates); store `packages/infrastructure/src/persistence/trading-store.ts:137`, `:354` (10 pUSD lifetime); provider `packages/infrastructure/src/polymarket/trading.ts:60`; migrations `0009_polymarket_trading.sql`, `0010_far_vengeance.sql` | L           | **Deployed, closed.** `workers/trading/wrangler.jsonc:25` has `TRADING_ADMISSIONS_ENABLED=false` and a Cron every minute (`:23`). API `workers/api/wrangler.staging.jsonc:16` (Service Binding), `:21` (admissions false). Per the staging record (`polymarket-worker-pilot.md:163-175`) there are no secrets, no bound account and no order |
| Trading Worker (private signer host, Queue wakeups, Cron reconcile)                                           | `workers/trading/AGENTS.md`; `polymarket-worker-pilot.md:9-12`                                           | yes: `workers/trading/src/index.ts:24-64` (static Polymarket env signer), `:82` (admissions gate), `:134-154` (queue/cron). **Polymarket only**, no venue abstraction                                                                                                                                                                                                    | L           | yes (staging version `950da5ec…`, `polymarket-worker-pilot.md:189`)                                                                                                                                                                                                                                                                          |
| Studio trading section (Limits & funding, preview/confirm, history)                                           | `polymarket-worker-pilot.md:54-73`                                                                       | yes (Polymarket). Only a browser harness test; the hosted walkthrough is pending (`:171-172`)                                                                                                                                                                                                                                                                            | L           | yes, closed                                                                                                                                                                                                                                                                                                                                  |
| Polymarket preproduction diagnostic                                                                           | `apps/agent-service/POLYMARKET-PREPRODUCTION.md`                                                         | yes. CLOB `/time` 200, Gamma 503 (2026-09-26). There is no testnet or sandbox for the international integration                                                                                                                                                                                                                                                          | D           | n/a                                                                                                                                                                                                                                                                                                                                          |
| **Agent Turnkey wallet and policies**                                                                         | `docs/specs/studio-create-and-fund-v1.md` §4.1; `turnkey-passkey-custody-v1.md` §12                      | partial: `packages/core/src/features/wallets/domain/agent-wallet-policies.ts:28` (`VENUE_CONTRACTS = []`), `:138-148` (the ALLOW is written only when venues are non-empty, destination-only, no selector), `:150-155` (DENY on ERC-20 `transfer`/`approve`), `:157-162` (only root edits policies); wired at `workers/api/src/container.ts:216`                         | —           | Code deployed. The spec's validation (§Validation, items 1-4) says the real ceremony and policy-engine test are unverified                                                                                                                                                                                                                   |
| Delegated user key (private half held by Pickler, "unused until live trading")                                | `studio-create-and-fund-v1.md:195-200`                                                                   | partial: public key only (`container.ts:118`). No signer code uses the private half                                                                                                                                                                                                                                                                                      | —           | —                                                                                                                                                                                                                                                                                                                                            |
| Agent wallet funding (master → agent AUSD transfer on 10143)                                                  | `studio-create-and-fund-v1.md` §6.2                                                                      | yes (records the broadcast hash; balance cache 15 s). Uses testnet AUSD `0xa9012a05…` (`packages/chain/src/networks.ts` ~l.73)                                                                                                                                                                                                                                           | L (testnet) | code yes; a real deposit is unverified                                                                                                                                                                                                                                                                                                       |
| Perpl on the Studio map / brief (`maxLeverage`)                                                               | `studio-create-and-fund-v1.md` §2.3 ("Perpl — Soon"); `studio-brief-v1.md:53-57`, `:236`                 | stub: `packages/core/src/features/studio/draft.ts:10` (`SOON_VENUES`), `:127` (refused as `venue:perpl`); `packages/api-schema/src/studio.ts:166`; web mirror `apps/web/src/features/studio/create/draft.ts:42`, `map.ts:39`; `maxLeverage` stored only (`research/types.ts:76`)                                                                                         | —           | UI shows "Soon"                                                                                                                                                                                                                                                                                                                              |
| Public `/markets` perps board and trade ticket                                                                | PR #32 (design `Pickler Market Web.dc.html`)                                                             | stub: `workers/api/src/growth/services.ts:38-39` ("Stays sample: there is no venue table"). Ticket cannot submit (#32 body)                                                                                                                                                                                                                                              | —           | sample data deployed                                                                                                                                                                                                                                                                                                                         |
| BTC Up/Down Polymarket paper studies (quant, policy comparison, benchmark)                                    | `packages/trading/AGENTS.md:57-76`; `QUANT-PAPER.md`, `COMPARISON-PAPER.md`, `BTC-DECISION-BENCHMARK.md` | yes: `features/paper-study/*`. #53 merged (2 h study: central P&L −4.84 virtual). #52/#56 were superseded by #59; #56 acceptance is incomplete (`JEV_INVALID_ANSWERS`)                                                                                                                                                                                                   | P           | no (local)                                                                                                                                                                                                                                                                                                                                   |

### PR ledger (trading-relevant)

| PR  | State                           | What it did or proposes                                                                                                                                                                                                   |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #18 | merged                          | Manual Polymarket paper orders (migration 0004), tenant-scoped reservations                                                                                                                                               |
| #22 | closed                          | Original local Polymarket live pilot; ported by #39                                                                                                                                                                       |
| #39 | merged                          | Local live pilot restored on the current runtime (migration 0009)                                                                                                                                                         |
| #43 | merged                          | Private Cloudflare trading Worker, console trading, soccer, migration 0010; staging deployed closed                                                                                                                       |
| #46 | merged                          | Paper settlement from Polygon CTF payouts (0011), virtual P&L                                                                                                                                                             |
| #52 | closed                          | BTC quant with Jev review; superseded by #59                                                                                                                                                                              |
| #53 | merged                          | BTC central vs conservative paper-policy comparison; 32/32 markets resolved                                                                                                                                               |
| #54 | merged                          | Perpl public-data plugin 1.0 (BTC/ETH, 4 tools, capture CLI)                                                                                                                                                              |
| #55 | merged                          | Perps paper accounts and 1x risk policy (0012)                                                                                                                                                                            |
| #56 | closed                          | BTC A/B/C/D Jev benchmark; superseded by #59, acceptance incomplete                                                                                                                                                       |
| #57 | merged                          | Perps simulator, funding reconciliation, funding-history tool (plugin 1.1.0), 0013                                                                                                                                        |
| #58 | closed                          | Rules/DeepSeek/Jev perps comparison (0014); superseded by #59                                                                                                                                                             |
| #59 | merged                          | Extracted `@pickler/trading`, normalized plugins, a single `evaluate` CLI                                                                                                                                                 |
| #60 | **open**                        | Perpl book-before-ticker read order, evidence validation before model admission, USD 5 cap shared per tenant/network (advisory lock). Adds `docs/perpl-validation-follow-up.md` with the six real-execution prerequisites |
| #63 | **open, draft**, stacked on #60 | Guarded 20 s acquisition, skipped slots, transactional ownership fencing, heartbeat diagnostics, `evaluate stability`. The public stability probe failed; it needs another run with the laptop lid open                   |
| #62 | **open** (docs only)            | `docs/studio-perpl-launch-review.md`: gap map for custody, Perpl, launchpad and indexer. Proposes stages A-G (Perpl integration is E) and 10 acceptance journeys (#7 covers Perpl)                                        |

## 3. Gaps

### 3.1 What it takes for an agent to trade perps on Perpl for real

Each step lists what exists and what is missing.

1. **Data.** Public data exists (`perpl/tools.ts`). Missing:
   - private account reads (collateral, positions, open orders, fills, funding paid);
   - the WebSocket trading channel;
   - reliable sustained acquisition (#60/#63 not merged; the #63 probe failed);
   - markets beyond BTC/ETH;
   - hosting data sessions in a Worker (today it is only a foreground Node CLI with a 12-request
     session cap, `transport.ts:65`, which cannot run continuously).
2. **Decision.** A paper proposal contract exists (`perps-runner.ts:66-102`, rules at
   `perps-study/policy.ts:84`) but only inside the local study. Missing:
   - a production decision protocol for a Studio Perpl agent (the research runtime is
     Polymarket/sports: `draft.ts:127` refuses Perpl);
   - scheduling;
   - `maxLeverage` use (stored only, `research/types.ts:76`).
3. **Sizing and risk.** `conservative-1x-v1` exists, but only for simulation. `PERPS-PAPER.md:50`
   and #60's follow-up (item 5) both forbid reusing it as exchange risk. Missing:
   - Perpl's real margin, liquidation, fee-tier and partial-fill semantics (the margin fields are
     left raw, `PERPL-DATA.md:74-75`);
   - wiring of `spend.perCallAusd/perDayAusd` to live orders (paper only, `orders.ts:82-95`);
   - any mapping from `maxLeverage` to real leverage.
4. **Signing and custody.** This is the largest gap.
   - Per Perpl's API docs (github.com/PerplFoundation/api-docs README, fetched 2026-09-30), orders
     are **not wallet-signed transactions**. They are Ed25519 API-key-signed requests with a
     `trade` scope. The exchange forwards them on-chain and pays gas.
   - The wallet must sign on-chain: collateral `approve`, `createAccount(uint256)` with the first
     deposit, and `allowOrderForwarding(true)`. It must also make a one-time wallet signature to
     enroll the API key (scheme not documented in the README).
   - Consequences for `agent-wallet-policies.ts`:
     - The DENY on `approve` (`:150-155`) blocks the delegated user from funding Perpl. Root
       (passkey) must sign `approve` + `createAccount`, or the policy must change.
     - The ALLOW (`:138-148`) matches `activity.action=='SIGN'` + `eth.tx.to` only. It does not
       cover the typed/raw message signature enrollment needs, and it has no function-selector
       bound, which the spec itself requires (`studio-create-and-fund-v1.md:180-181`).
     - Existing wallets were created without a venue ALLOW. Adding one needs a new
       passkey-approved policy round per wallet ("Only root changes the rules", `:157-162`).
   - The Ed25519 trade key needs its own custody: per agent, stored in infrastructure, revocable.
     Nothing like it exists. `workers/trading` holds only static Polymarket env secrets
     (`index.ts:11-23`).
   - PR #62 also flags the blast radius of one delegated platform key shared across all
     sub-organizations.
5. **Funding the agent's Perpl account.**
   - Studio deposits move **testnet AUSD** (`0xa9012a05…`, chain 10143) into the agent wallet.
   - Perpl testnet collateral is a different token ("USD", `0xdf5b718d…`). Mainnet AUSD
     (`0x00000000eF…`) does match.
   - Even with the right token, funds in the wallet are not Perpl collateral until
     `createAccount`/deposit (PR #62 §2).
   - Missing: a venue-funding state machine (receipt, finality, credit confirmation), gas (MON) for
     the agent wallet, and a withdraw path back to master (explicitly out of scope,
     `studio-create-and-fund-v1.md:487`).
   - The "schedule lock ≥ 10 AUSD" reads the wallet balance, not venue collateral.
6. **Order lifecycle.** Missing:
   - per-account monotonic request IDs, persisted intent before send, and expiry
     (#60 follow-up item 4);
   - place, cancel, amend;
   - reconciliation of ambiguous acks against orders, fills and chain;
   - kill switch and admissions flag per venue.

   The Polymarket pilot's patterns (hash-first intent, unknown keeps its reservation, Cron
   reconcile) are the template, but its tables (`live_orders`, `trading_accounts`) are
   Polymarket-shaped (`0009`).

7. **Settlement, P&L and receipts.** Missing:
   - live Perpl P&L, funding paid/received and liquidation events;
   - receipt storage (tx hashes for approve/createAccount/forwarding, fill IDs);
   - the public projection (the marketplace board is sample, `growth/services.ts:38`).

   Paper P&L exists only in local study reports.

8. **Deployment.** Nothing Perpl-related is in any Worker. There is no Perpl admissions flag, and
   no operator runbook for testnet then funded acceptance (#60 follow-up item 6; PR #62 stage F/G).

### 3.2 Polymarket gaps (documented by the docs themselves)

- Live pilot acceptance is entirely pending (`polymarket-worker-pilot.md:138-143`, `:171-175`):
  - Builder/CLOB credentials, Deposit Wallet, approvals, funding;
  - an authenticated account link and the hosted walkthrough;
  - one manual purchase, then at most two automatic researches.
- The pilot has one operator wallet, and product tenants must not share it
  (`LIVE-TRADING.md:133-137`). **Per-user Polymarket custody is not specified.** The Turnkey agent
  wallets are Monad; Polymarket is Polygon/pUSD (`studio-create-and-fund-v1.md:488-489` lists it
  as open).
- Live has no sells, no event redemption, no withdrawals and no exact fee accounting;
  `costUpperBound` is not the actual charge (`LIVE-TRADING.md:101`, `:123`).
  `settled` ≠ event resolved.
- Paper settlement is manual (no scheduler, `PAPER-TRADING.md:75`). Real-market end-to-end paper
  acceptance is pending: Gamma resets and 503s (`PAPER-TRADING.md:114-117`,
  `POLYMARKET-PREPRODUCTION.md:36-40`).
- No sandbox. Preproduction inherits chain 137 production contracts
  (`POLYMARKET-PREPRODUCTION.md:17-24`).
- BTC Up/Down is not in the paper scope (`PAPER-TRADING.md:101-102`).

### 3.3 Acceptance gaps admitted by each doc

| Doc                                                         | Admitted gap                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PERPL-DATA.md:7-10`, `:112-114`                            | Data milestone only; "does not yet satisfy the bounty's real on-chain trading requirement"                   |
| `PERPS-PAPER.md:143-146`, `:157-159`                        | Public simulation path only; no funding event spanned; not venue fills                                       |
| `PERPS-STUDY.md` (Persistence/Controlled acceptance)        | No completed 24 h result; real on-chain activity is a "separate future signer/custody/execution deliverable" |
| PR #60 follow-up doc                                        | Six prerequisites before funded acceptance; paper results do not satisfy the on-chain goal                   |
| PR #63                                                      | Stability acceptance failed (sleep → `LEASE_LOST`); needs a rerun                                            |
| `PAPER-TRADING.md:40`, `:114-117`                           | No live paper fill yet; real-market end-to-end pending                                                       |
| `LIVE-TRADING.md:123`; `polymarket-worker-pilot.md:138-143` | No real order; operator acceptance pending                                                                   |
| `studio-create-and-fund-v1.md` Validation, items 1-4        | Turnkey ceremony, policy engine and deposit unverified with real credentials                                 |
| `trading-architecture.md:61-70`                             | Controlled replay proves compatibility, not reliability or profitability                                     |

## 4. Specs to write

1. **`perpl-live-execution-v1`.** Scope:
   - binding each agent to exactly one Perpl account (chain, exchange address, collateral token
     manifest per network);
   - Ed25519 trade-key enrollment via wallet signature, the key's custody, rotation, revocation and
     scope (`trade` only);
   - order intent persistence with monotonic request IDs and expiry, WebSocket submission,
     cancel/close;
   - ambiguous-ack reconciliation against orders, fills and chain;
   - Perpl-specific margin, fees, partial fills and liquidation, kept distinct from the paper
     policy;
   - account/position/funding reconciliation, tables, admissions flag, kill switch;
   - testnet then funded acceptance with receipts.

   Depends on specs 2 and 3, on #60/#63's acquisition module, and on
   `docs/trading-architecture.md` rules (reuse the engine, no host copies).

2. **`agent-wallet-venue-policies-v2`** (Turnkey round two for trading). Scope:
   - exact policies for Perpl: an ALLOW bounded by contract and selector for `createAccount`,
     deposit, `allowOrderForwarding`, withdraw-to-master (if any), and the enrollment signature
     (payload type and constraints);
   - resolving the conflict with the `approve` DENY: either root signs funding, or a narrowly
     scoped `approve(spender == exchange, amount ≤ cap)`;
   - value caps as the real form of `perCallAusd/perDayAusd`;
   - the re-approval ceremony for existing wallets;
   - per-creator and per-agent revocation, and the blast radius of the shared delegated key;
   - the policy-engine test matrix against a real test sub-organization.

   Depends on `studio-create-and-fund-v1` §4.1 and `turnkey-passkey-custody-v1` §12.

3. **`venue-funding-v1`.** Scope:
   - the state machine master → agent wallet → Perpl collateral (and back), with receipts,
     finality, reorg handling and recovery of orphaned external effects;
   - gas (MON) provisioning for agent wallets;
   - network/token manifest: Studio testnet AUSD vs Perpl testnet USD, or choosing mainnet;
   - locks re-expressed on venue collateral, not the wallet balance;
   - the withdraw screen ("account work" in §6.3);
   - money-boundary separation (PR #62 §3 "Money boundaries").

   Depends on spec 2 and on `packages/chain` manifests.

4. **`perpl-agent-runtime-v1`** (Studio Perpl agent, removing `SOON_VENUES`). Scope:
   - the brief/config for a Perpl agent (markets, `maxLeverage` semantics, style → risk policy);
   - the decision protocol (from `perps-comparison-v1`: model proposes, code sizes);
   - scheduling cadence and a hosted data session without the 12-request CLI cap;
   - a paper-first mode (hosted `perps-paper`) before live;
   - run trace / Studio UI for positions and P&L;
   - Worker composition (research vs trading Worker).

   Depends on spec 1 for live; paper can ship first. It also needs the #60/#63 merge.

5. **`perps-market-board-real-data-v1`.** Scope: replace `createSampleMarketBoard` with Perpl
   public data (and eventually agent positions); define the board's freshness/staleness semantics
   and what "Trade" on a square means (whose money, via which account), or remove the ticket.
   Depends on spec 4 and on `docs/specs/marketplace-real-data-v1.md`.
6. **`polymarket-user-custody-v1`** (only if Polymarket live is meant for users, not just the
   operator pilot). Scope: per-user Deposit Wallet/signer on Polygon, versus Turnkey (Monad-only
   today); pUSD funding; replacing the static operator signer in `workers/trading`; sell,
   redemption and withdraw; exact fee accounting. Depends on an owner decision (Q3).
7. **`trading-receipts-and-pnl-v1`.** Scope: one ledger model for live P&L, fees, funding and
   receipts across venues (Polymarket `live_orders`, future Perpl), separate from paper and model
   cost; public projection rules. Depends on specs 1 and 6.

## 5. Open questions for the owner

1. **Perpl network for the first live acceptance.** Testnet (collateral "USD" ≠ Studio's testnet
   AUSD) or bounded mainnet (AUSD matches)? This decides the funding token and manifest.
2. **Who signs Perpl funding.** Is it acceptable that every Perpl deposit and `approve` needs the
   creator's passkey (root)? Or should the delegated user get a narrowly scoped `approve`,
   relaxing the current "never approve" DENY?
3. **Polymarket's future.** Does Polymarket live stay an operator-only pilot (single wallet), or
   must users trade it with their own custody? Today the Turnkey agent wallets are Monad only.
4. **Trade-key custody.** Where should per-agent Ed25519 Perpl keys live (Worker secrets per
   agent? KMS? Turnkey-held keys?), and does the platform or the creator own enrollment?
5. **`maxLeverage`.** Should it be real exchange leverage, or stay capped at 1x like the paper
   policy for the first live release?
6. **Merge plan for #60/#63.** The #63 stability probe needs a rerun. Is it a gate for any hosted
   Perpl work?
7. **Real-money caps.** What are they for the first Perpl live pilot (the Polymarket analogue is
   5/10 pUSD)? Should they be enforced in the Turnkey policy, the DB ledger, or both?
8. **Public "Trade" squares.** Should the `/markets` Trade squares ever place real user orders, or
   only show agent activity?

## 6. Sources read

- `AGENTS.md` (root), `packages/trading/AGENTS.md`, `workers/trading/AGENTS.md`
- `docs/trading-architecture.md`, `docs/polymarket-worker-pilot.md`
- `apps/agent-service/{PERPL-DATA,PERPS-PAPER,PERPS-STUDY,PAPER-TRADING,LIVE-TRADING,POLYMARKET-PREPRODUCTION}.md`
- `docs/specs/studio-create-and-fund-v1.md` (§2.3, §4.1, §6, §10, Validation);
  `docs/specs/turnkey-passkey-custody-v1.md` (headings, §9, §12); `docs/specs/studio-brief-v1.md` (leverage lines)
- Code:
  - `workers/trading/src/index.ts`, `workers/trading/wrangler.jsonc`, `workers/api/wrangler.staging.jsonc`
  - `workers/api/src/container.ts` (216, 380-416), `workers/api/src/growth/services.ts`, `workers/api/src/routes/studio.ts` (paper routes)
  - `packages/agent-runtime/src/plugins/{perpl,perps-paper}/*`
  - `packages/trading/src/features/{perps-paper,perps-study,evaluation,paper,trading}/*` (targeted)
  - `packages/core/src/features/{studio/draft.ts,research/types.ts,research/plugins.ts,wallets/domain/agent-wallet-policies.ts}`
  - `packages/infrastructure/src/{perpl/transport.ts,persistence/trading-store.ts,persistence/paper-store.ts}`
  - `packages/chain/src/networks.ts`
  - migrations `0009`, `0010`, `0012`, `0013`, `0014`
- PRs: `gh pr view` for #32, #43, #52-#60, #62, #63; the PR #62 doc `docs/studio-perpl-launch-review.md`
  and the PR #60 doc `docs/perpl-validation-follow-up.md` read from their branches;
  `docs/product-map/research/_prs.txt`
- External: PerplFoundation api-docs README (fetched 2026-09-30) for the API-key, createAccount,
  forwarding and collateral-token facts. The enrollment signature scheme and withdraw function are
  not documented there.
