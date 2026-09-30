# Perpl live v1: studio agents trade perps on Perpl with real collateral

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`
(products and wallets rule; decision 7: Perpl testnet first, then mainnet, a Pickler-held Ed25519
trading key per agent, every funding step and the enrollment signed by the owner's passkey, orders
only through the trading worker). Every decision is reversible until mainnet funds move.

Related specs: `go-public-v1.md` (caps and the venue manifest, D11-D13), `decision-resolution-v1.md`
(Perpl resolution §6.3, the live P&L record), `perpl-agent-runtime-v1.md` (the `perps-direction-v1`
protocol that produces Perpl decisions, paper first; conventions decision 12), `custody-v2.md` (the
agent → master withdrawal), `studio-create-and-fund-v1.md` (the agent wallet, its
policies and the deposit), `production-environment-v1.md` (production secrets).

## 1. Problem and users

Perpl is data and paper only today (`docs/product-map/research/02-trading.md` §1). There is:

- a public-data client (`packages/infrastructure/src/perpl/data.ts:86`, transport caps at
  `packages/infrastructure/src/perpl/transport.ts:65-87`) run from an operator CLI;
- a 1x paper account and simulator (`packages/trading/src/features/perps-paper/policy.ts:153-195`)
  that `apps/agent-service/PERPS-PAPER.md:50` forbids reusing as exchange risk;
- an agent Turnkey wallet that can sign nothing, because `VENUE_CONTRACTS = []`
  (`packages/core/src/features/wallets/domain/agent-wallet-policies.ts:28`);
- Perpl refused as a studio venue (`packages/core/src/features/studio/draft.ts:10`, `:127`).

Perpl's real flow does not fit the wallet as it is. Orders are Ed25519-API-key-signed requests the
exchange forwards on chain; the wallet only signs collateral `approve`, `createAccount(uint256)`,
`allowOrderForwarding(bool)` and an EIP-712 key-enrollment signature (Perpl API docs,
`github.com/PerplFoundation/api-docs` README and `integrations.md`, fetched 2026-09-30). The
delegated user's DENY on ERC-20 `approve` (`agent-wallet-policies.ts:150-155`) blocks funding, and
the venue ALLOW is destination-only (`:138-148`) and cannot match a typed-data signature. Studio
testnet deposits move AUSD (`packages/chain/src/networks.ts:71-73`); Perpl testnet collateral is a
different token, "USD" at `0xdf5b718d8fcc173335185a2a1513ee8151e3c027`.

Users: the **agent owner** in the studio (onboards, funds, watches, kills, withdraws); the **agent**
(its decisions become orders, sized by code); **Pickler operators** (admissions, reconciliation);
the **public record** (receipts and live P&L, through `decision-resolution-v1`).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reason                                                                                                                                                                                                                                                            | Reversible?                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| P1  | **One Perpl account per agent, owned by the agent's Turnkey wallet** (not the master wallet). Testnet 10143 first; mainnet 143 after the §9 testnet acceptance.                                                                                                                                                                                                                                                                                                                                                                                                              | Per-agent isolation of collateral, positions and P&L; the agent wallet already exists with its policies; a kill switch and a key revocation touch one agent.                                                                                                      | Yes.                                         |
| P2  | **Every onboarding and funding transaction is signed by the owner's passkey as root, from the agent wallet**: `approve(exchange, exact amount)`, `createAccount(amount)`, the account deposit, `allowOrderForwarding(true)`, the withdraw, and the transfer back to master. The delegated user's DENY on `approve`/`transfer` stays exactly as it is.                                                                                                                                                                                                                        | Conventions decision 7. The root quorum bypasses every policy (`agent-wallet-policies.ts:8-11`), so funding needs no ALLOW and the DENY keeps meaning "Pickler can never move the money". This is how the spec designs around the DENY.                           | Yes.                                         |
| P3  | **The key-enrollment signature is also root-signed**: Turnkey `SIGN_RAW_PAYLOAD_V2` from the agent wallet with `PAYLOAD_ENCODING_EIP712`, stamped by the passkey. The API rebuilds and byte-compares the stamped body, and checks the typed data field by field before forwarding (§8).                                                                                                                                                                                                                                                                                      | The destination-only ALLOW cannot cover a typed-data signature, and it should not: enrollment decides who may trade the account, which is the owner's call.                                                                                                       | Yes.                                         |
| P4  | **Round-two wallet policies grant the delegated user exactly one Perpl call: `allowOrderForwarding(false)`**, matched on exact calldata `0x7962f910` + 32 zero bytes, `eth.tx.to == exchange`, value 0, from this wallet. Nothing else is allowed; the three existing DENYs remain. Written in the onboarding ceremony as one root-stamped `CREATE_POLICIES`.                                                                                                                                                                                                                | The only thing Pickler must be able to do without the owner is stop trading on chain (the kill switch). Exact-calldata matching needs no uploaded ABI, so a Smart Contract Interface cannot be swapped under the policy.                                          | Yes (delete the policy with the passkey).    |
| P5  | **The Ed25519 trading key is generated in `workers/trading`**, per agent, scope `read\|trade` (mask 3), `expires_at` = enrollment + 90 days, no IP list, no builder code. The private key and the returned API token are encrypted with AES-256-GCM under `PERPL_KEY_ENCRYPTION_KEY` (versioned, like the delegated and X keys), AAD = `agentId ‖ publicKey`, stored in Postgres; only `workers/trading` holds the decryption key.                                                                                                                                           | Conventions decision 7 ("encrypted like the delegated key"). Workers have no fixed egress IPs, so an IP allow-list would break. Perpl never permits withdrawals via an API key (`integrations.md`, Key Scopes), which bounds a leak to trading.                   | Yes.                                         |
| P6  | **Orders go over REST** (`POST /api/v1/trading/orders`, batches of ≤ 100) from `workers/trading`, never WebSocket in v1. Every order is an intent row with a per-account monotonic request id `rq` persisted before sending, seeded from Perpl's `lfr`, and a last-execution block `lb = head + 150` (≈ 60 s).                                                                                                                                                                                                                                                               | A Cron/Queue Worker cannot hold a socket; REST batching is documented as equivalent for rate. Intent-before-send is the Polymarket pilot pattern (research 02 §3.1 item 6).                                                                                       | Yes (a Durable Object socket is v2).         |
| P7  | **Leverage means the ratio of notional to position collateral**, sent as `lv` in hundredths: `lv = 100 × min(brief.maxLeverage, PERPL_MAX_LEVERAGE, market max from initial_margin)`. `PERPL_MAX_LEVERAGE` is 5 on testnet and 2 for the mainnet pilot.                                                                                                                                                                                                                                                                                                                      | That is what `lv` is at Perpl (`types.md`: "1000 = 10x"). The brief stores 1-10 (`studio-brief-v1.md:53`); the venue cap keeps the pilot conservative without changing the owner's number.                                                                        | Yes (a var).                                 |
| P8  | **The brief's caps are margin caps**: `spend.perCallAusd` = most collateral one order may commit; `spend.perDayAusd` = most new collateral committed per UTC day. Notional ≤ margin × leverage. Enforced in `@pickler/trading/perpl` inside `workers/trading` before any request; the structural bound is the venue collateral, which only the passkey can raise.                                                                                                                                                                                                            | Perpl orders are not wallet transactions, so `go-public-v1` D11's Turnkey per-trade ALLOW cannot see them. Saying "the wallet enforces your per-trade cap" for Perpl would be false; the screen says "Pickler enforces; the venue holds only what you deposited". | Yes.                                         |
| P9  | **Live exits, in code** (this spec owns live positions and live exits, conventions decision 20): `workers/trading` closes a live position at the decision's stop-loss, take-profit or horizon (`perpl-agent-runtime-v1.md` §4) and on these risk stops: a position is closed when its unrealized loss reaches 50 % of its collateral or the mark comes within 25 % of the distance from entry to the liquidation price; no new opens after a 3 % equity loss in a UTC day; the kill switch trips at a 20 % drawdown from the account's high-water equity.                    | Liquidation at Perpl is a total loss of position collateral plus fees; code must exit first. Numbers mirror the paper policy's spirit (`perps-paper/policy.ts:99-121`) scaled for leverage, not reused.                                                           | Yes (versioned policy `perpl-live-risk-v1`). |
| P10 | **The kill switch** (owner button, automatic trips, operator global): stop admissions for the agent → cancel open orders → close positions with reduce-only IOC `CloseLong`/`CloseShort` → the delegated user signs `allowOrderForwarding(false)` → the key is marked `disabled`. Resuming needs the passkey (`allowOrderForwarding(true)`).                                                                                                                                                                                                                                 | Closing then revoking forwarding leaves no path for the key to trade even if Pickler's store were compromised afterwards. Revoking the key itself is web-UI only at Perpl (`integrations.md`, Revocation).                                                        | Yes.                                         |
| P11 | **Reconciliation every minute** against `GET /trading/positions`, `/orders`, `/fills` and `/account-history` (cursors). Any position or fill the ledger cannot explain freezes the agent (admissions off) and opens an issue; an `unknown` order is resolved only by the venue, never by resending the same `rq`.                                                                                                                                                                                                                                                            | Ambiguous acks are the dangerous case (research 02 §3.1 item 6).                                                                                                                                                                                                  | Yes.                                         |
| P12 | **Withdrawals go back to the master wallet in two root-signed transactions**: the Exchange's withdraw (venue → agent wallet), then the agent → master leg. For AUSD (mainnet) that leg is `custody-v2.md` C1 (its route, gas top-up C2 and `wallets.transfers` receipt, reused, not duplicated). For a collateral token custody does not accept (Perpl testnet USD; `custody-v2.md` checks the AUSD contract), this spec's own `return_to_master` step sends it, recorded in `perpl_steps` (cross-review C13). Allowed only for free collateral (no open position needs it). | Perpl withdrawals are wallet-only (`types.md`); root bypasses the transfer DENY. This spec owns the venue leg and the testnet-token leg; `custody-v2.md` owns the AUSD wallet leg.                                                                                | Yes.                                         |
| P13 | **Testnet collateral comes from a Pickler faucet**: `POST /v1/studio/perpl/faucet` sends 100 Perpl testnet USD and 0.2 MON to the owner's master wallet, once per account per 24 h, from an operator faucet wallet held by `workers/trading`. On mainnet the collateral is AUSD, the same token the studio already moves, and there is no faucet.                                                                                                                                                                                                                            | Resolves the AUSD/USD mismatch without pretending the tokens are the same; the studio labels balances by the manifest's symbol ("Perpl testnet USD").                                                                                                             | Yes.                                         |
| P14 | **A Perpl venue manifest in `@pickler/chain`** (`PERPL[chainId]`: exchange address, collateral token, API and WS base URLs, the Exchange ABI subset with selectors, block time) feeds `go-public-v1`'s `VENUE_MANIFEST` entry `perpl` with `delegatedSelectors: [allowOrderForwarding(false) exact calldata]` and `rootOnly: true` for funding.                                                                                                                                                                                                                              | One source for addresses, policy text and clients (`go-public-v1` D12).                                                                                                                                                                                           | Yes.                                         |
| P15 | **Live P&L is realized per position** (fills in and out, fees, funding paid/received) and written as rows of `pickler.decision_live_pnl` in `decision-resolution-v1.md` §5.7's shape for the decision that opened it (conventions decision 19); the receipt gains an `execution` block. Hit rate and Brier still resolve on the mark at the horizon (`decision-resolution-v1.md` §6.3).                                                                                                                                                                                      | One formula set across venues (`decision-resolution-v1` D15).                                                                                                                                                                                                     | Yes.                                         |
| P16 | **Live execution is offered per agent when testnet acceptance passes**, by a var: `PERPL_STUDIO_ENABLED` shows the live Perpl card. Perpl itself leaves `SOON_VENUES` earlier, for paper, under `perpl-agent-runtime-v1.md` (its `PERPL_PAPER_ENABLED` and `soonVenues(liveVenues)`); this spec only adds the live step on top.                                                                                                                                                                                                                                              | Paper first (conventions decision 12); turning live on or off is an operational decision.                                                                                                                                                                         | Yes.                                         |
| P17 | **No Pickler builder code in v1.** Orders omit `bf`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A fee on the owner's trades is a pricing decision (§12).                                                                                                                                                                                                          | Yes (re-enrollment with a builder id).       |
| P18 | **A live testnet agent is scored on testnet and labelled so** (conventions decision 20): its decisions resolve against the Perpl testnet mark, and its receipts, record and positions carry `network = 'testnet'`, shown as a "Testnet" label wherever its record appears.                                                                                                                                                                                                                                                                                                   | Scoring a testnet trade against mainnet prices would compare two markets; the label keeps testnet results from reading as real money.                                                                                                                             | Yes.                                         |

## 3. User flows

### 3.1 Enable Perpl for an agent (owner, studio)

Preconditions: the agent is public (`go-public-v1`), is a Perpl agent with at least 5 resolved paper
`perps-direction-v1` decisions (`perpl-agent-runtime-v1.md` §3.4), has a wallet with its three DENYs,
and live Perpl is enabled on this network (P16). The studio's Trading section shows a **Perpl card**: "Trade perps on
Perpl · testnet". **Set up** opens the onboarding sheet, a checklist of steps; each step is one
passkey prompt and shows its transaction link when done. Steps already satisfied are skipped
(the API derives them from chain state, not only from its rows).

1. **Get testnet funds** (testnet only, skipped when the master holds ≥ the chosen amount): the
   faucet (P13). No prompt.
2. **Move collateral to the agent** (skipped when the agent wallet already holds it): master →
   agent `transfer` of the collateral token, plus 0.05 MON gas when the agent's MON is below
   `PERPL_AGENT_GAS_FLOOR_MON` (0.02). One prompt per transaction; the deposit route of
   `studio-create-and-fund-v1.md` §6.2 generalised to the manifest's token.
3. **Approve the exchange**: `approve(exchange, amount)` from the agent wallet, exact amount.
4. **Open the Perpl account**: `createAccount(amount)`; the API reads the account id from the
   receipt's event and from `GET /trading/wallet` after enrollment.
5. **Let Pickler submit its orders**: `allowOrderForwarding(true)`.
6. **Enroll Pickler's trading key**: the trading worker generates the key, requests
   `POST /api/v1/api-key/payload`, the API wraps the returned typed data as the unsigned
   `SIGN_RAW_PAYLOAD_V2`, the passkey stamps it, the worker adds the proof-of-possession and calls
   `POST /api/v1/api-key/enroll` with `Origin: https://studio.pickler.fun`.
7. **Approve the kill switch rule**: the round-two policy (P4), one root-stamped `CREATE_POLICIES`.

The card then reads "Live on Perpl · {collateral} {symbol} · {leverage}x max". The agent's next
Perpl decision can become an order.

### 3.2 A decision becomes an order (automatic)

1. A `perps-direction-v1` run (`perpl-agent-runtime-v1.md` §4) ends with a decision
   `{ instrument, action: open-long | open-short | close | hold, probability, horizonHours,
stopLossBps?, takeProfitBps? }`. The model never sees sizes, keys or accounts. `close` and `hold`
   are not scored (cross-review C3); an open's position is closed by code at its horizon if no stop,
   take-profit or risk rule closed it first.
2. For an agent with a live Perpl account, the research worker enqueues
   `{ kind: "perpl-decision", agentId, runId }` on the trading queue (its existing producer binding).
   This queue is the only hand-off; there is no internal HTTP route for it (cross-review C17). The
   paper shadow of the same decision runs as `perpl-agent-runtime-v1.md` §3.3 describes.
3. `workers/trading` loads the decision, the account, the risk state and a fresh book and mark
   (book before ticker, `PERPL-DATA.md`), and `@pickler/trading/perpl` sizes it: margin =
   `min(perCallAusd × conviction fraction (perpl-agent-runtime-v1 §4), free collateral, remaining day cap)`, leverage per P7, notional = margin ×
   leverage converted to size at the market's scale, limit price = mark ± 50 bps, flags IOC.
   A refusal is recorded with a reason code (`DAY_CAP_REACHED`, `KILLED`, `STALE_MARK`,
   `BELOW_MIN_SIZE`, ...) and the decision stays a decision.
4. It writes the intent (`rq`, `lb`) and sends it; the response updates the row to `acked`,
   `filled`, `partially_filled`, `failed` or, on timeout or 5xx, `unknown`.
5. The reconciler resolves `unknown` within the next minute from order history by `rq`.

### 3.3 Watching, deposits, withdrawals, kill

- **Positions and orders** in the Trading section: market, side, size, entry, mark, liquidation
  price, unrealized P&L, collateral, leverage; orders with status and the Perpl order id; fills.
- **Add collateral**: approve + deposit, root-signed (two prompts), after step 2 if needed.
- **Withdraw to master**: amount ≤ free collateral; the venue withdraw (`withdraw` step), then the
  studio's existing agent → master Withdraw sheet from `custody-v2.md` §3.1, prefilled.
- **Stop trading** (kill switch): confirm sheet "Pickler will cancel open orders, close every
  position at market and turn off order forwarding. Funds stay in its Perpl account." No passkey
  needed; **Resume** needs one (`allowOrderForwarding(true)`).
- **Key expiry**: 7 days before `expires_at` the card asks the owner to re-enroll (step 6 again);
  on expiry the agent stops opening positions, closes nothing automatically, and says so.

## 4. API

All routes follow the conventions envelope, error codes and `Idempotency-Key` on money-moving POSTs.
Studio routes are `/v1/studio/*` with the studio session; the agent must belong to the caller.

| Method | Path                                                    | Auth            | Request                                                                                                                                                                                                      | Response                                                                                                                                                                                                                                           | Errors                                                                                                                                                                             |
| ------ | ------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/studio/venues`                                     | studio          | —                                                                                                                                                                                                            | `{ liveVenues: ["polymarket", "perpl"?], soonVenues }`                                                                                                                                                                                             | —                                                                                                                                                                                  |
| GET    | `/v1/studio/agents/:id/perpl`                           | studio          | —                                                                                                                                                                                                            | `PerplAccountDto`: network, `steps[]` with status, account id, collateral, free collateral, equity, positions, key `{ status, expiresAt }`, risk `{ dayCommittedMicro, dayCapMicro, killed, killReason }`                                          | 404 `AGENT_NOT_FOUND`, 503 `PERPL_UNAVAILABLE`                                                                                                                                     |
| POST   | `/v1/studio/perpl/faucet`                               | studio          | —                                                                                                                                                                                                            | `{ txHashes: { usd, mon } }`                                                                                                                                                                                                                       | 409 `FAUCET_COOLDOWN` (`retryAt`), 503 `FAUCET_EMPTY`, 400 `NOT_TESTNET`                                                                                                           |
| POST   | `/v1/studio/agents/:id/perpl/steps/:step/prepare`       | studio          | `{ amountMicro? }`; `:step` ∈ `fund_agent`, `gas`, `approve`, `create_account`, `deposit`, `allow_forwarding`, `enroll_key`, `policies`, `withdraw`, `return_to_master` (non-AUSD collateral only), `resume` | `{ stepId, activity }` the unsigned Turnkey activity to stamp (`SIGN_TRANSACTION_V2`, `SIGN_RAW_PAYLOAD_V2` or `CREATE_POLICIES`)                                                                                                                  | 409 `STEP_NOT_READY` (earlier step missing), `STEP_ALREADY_DONE`, `NOT_SENDABLE` (estimate failed), `WITHDRAW_EXCEEDS_FREE`; 400 `AMOUNT_OUT_OF_BOUNDS`                            |
| POST   | `/v1/studio/agents/:id/perpl/step-runs/:stepId/confirm` | studio          | `{ signed }` the stamped activity                                                                                                                                                                            | `{ status: "submitted" \| "done", txHash? }`                                                                                                                                                                                                       | 400 `SIGNED_BODY_MISMATCH`, 409 `STEP_EXPIRED`, `ALREADY_RECORDED`, 502 `PERPL_ENROLL_FAILED` (with Perpl's status 409/423 mapped to `KEY_ALREADY_REGISTERED`/`KEY_LIMIT_REACHED`) |
| POST   | `/v1/studio/agents/:id/perpl/kill`                      | studio          | `{ reason?: string }`                                                                                                                                                                                        | `{ killId, state: "stopping" }`                                                                                                                                                                                                                    | 409 `ALREADY_KILLED`                                                                                                                                                               |
| GET    | `/v1/studio/agents/:id/perpl/orders`                    | studio          | `?cursor&limit`                                                                                                                                                                                              | `PerplOrderDto[]` (intent, status, fills, reason)                                                                                                                                                                                                  | —                                                                                                                                                                                  |
| GET    | `/v1/studio/agents/:id/perps/positions`                 | studio          | `?source=paper\|live&state=open\|closed&cursor&limit`                                                                                                                                                        | `PerpsPositionDto[]`: instrument, side, entry, size, collateral, `closeReason`, realized P&L, fees, funding, the decision run id, `network` (`testnet` or `mainnet`); `source=paper` rows are read from `perpl-agent-runtime-v1`'s paper positions | 404 `AGENT_NOT_FOUND`                                                                                                                                                              |
| POST   | `/v1/internal/trading/perpl/keys`                       | service binding | `{ agentId, stepId }` (api → trading: generate, payload, later enroll with `signature`)                                                                                                                      | `{ typedData, mac }` then `{ enrolled: true, expiresAt }`                                                                                                                                                                                          | 502 `PERPL_ENROLL_FAILED`                                                                                                                                                          |
| POST   | `/v1/internal/trading/perpl/kill`                       | service binding | `{ agentId \| "all", reason, actor }`                                                                                                                                                                        | `{ state }`                                                                                                                                                                                                                                        | —                                                                                                                                                                                  |

Confirm-side checks, per step (the API rebuilds the activity from its own row and compares the
stamped body byte for byte, as `studio-create-and-fund-v1.md` §6.2 does for deposits):

| Step                          | Chain and destination            | Calldata                                                                                                                                                                                   | Other                                                     |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `approve`                     | manifest chain, collateral token | `approve(exchange, amountMicro)`; spender must be the manifest exchange                                                                                                                    | value 0, gas ≤ 100k                                       |
| `create_account`              | exchange                         | `createAccount(amountMicro)` (`0xcab13915`)                                                                                                                                                | only when no account exists                               |
| `deposit`                     | exchange                         | the Exchange deposit function from the pinned ABI, amount as prepared                                                                                                                      | account exists                                            |
| `allow_forwarding` / `resume` | exchange                         | `allowOrderForwarding(true)`                                                                                                                                                               | —                                                         |
| `enroll_key`                  | none (typed data)                | domain `chain_id` = manifest chain; `address` = agent wallet; `public_key` = the row's key; `scope_mask` 3; `expires_at` as generated; no `target_profile`, no `builder_id`, no `ip_cidrs` | the typed data equals Perpl's payload response, unchanged |
| `withdraw`                    | exchange                         | the Exchange withdraw function, amount ≤ free collateral at prepare                                                                                                                        | —                                                         |
| `return_to_master`            | collateral token (non-AUSD only) | `transfer(masterAddress, amount)`                                                                                                                                                          | recipient must be the owner's master                      |

DTOs in `packages/api-schema/src/perpl.ts` (new): `PerplAccountDto`, `PerplStepDto`,
`PerplOrderDto`, `PerplPositionDto`, `PerplKillDto`.

## 5. Data model and migrations

Migration **`perpl_live`** (number assigned at build time; next free is 0023). Tables go in the
schema that holds `live_orders` today (`pickler`; `runtime` after `schema-boundaries-v1.md:133`),
RLS enabled, never exposed through the Data API. Money in micro-units of the collateral token
(both AUSD and Perpl testnet USD have 6 decimals; the manifest asserts it); Perpl's scaled prices
and sizes are stored as `numeric(78,0)` with the market's decimals alongside.

| Table                                 | Columns (abridged)                                                                                                                                                                                                                                                                                                                                                                                                          | Notes                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `perpl_accounts`                      | `agent_id` PK, `chain_id`, `wallet_address`, `exchange`, `collateral_token`, `account_id numeric null`, `forwarding_enabled bool`, `status` (`onboarding`, `live`, `killed`, `closed`), `last_forwarded_rq numeric`, `next_rq numeric`, timestamps                                                                                                                                                                          | one per agent per network; `unique (chain_id, account_id)`               |
| `perpl_keys`                          | `id` PK, `agent_id`, `public_key`, `private_key_ciphertext bytea`, `api_token_ciphertext bytea null`, `key_version smallint`, `scope_mask`, `expires_at`, `status` (`generated`, `enrolled`, `disabled`, `expired`), `enrolled_at`, `disabled_at`                                                                                                                                                                           | at most one `enrolled` per agent (partial unique index)                  |
| `perpl_steps`                         | `id` PK, `agent_id`, `step`, `amount_micro bigint null`, `activity_body text`, `status` (`prepared`, `submitted`, `included`, `finalized`, `reverted`, `expired`, `done`), `tx_hash null`, `idempotency_key`, `failure_code null`, timestamps                                                                                                                                                                               | every passkey-signed step, the receipts of onboarding and funding        |
| `perpl_orders`                        | `id` PK, `agent_id`, `run_id null`, `position_id null`, `rq numeric`, `market_id int`, `order_type smallint`, `flags smallint`, `price_scaled`, `size_scaled`, `leverage_hundredths int`, `lb bigint`, `perpl_order_id null`, `status` (`intent`, `sent`, `acked`, `open`, `partially_filled`, `filled`, `cancelled`, `expired`, `failed`, `unknown`), `reason null`, `risk_snapshot jsonb`, timestamps                     | `unique (agent_id, rq)`; `reason` is a stable code                       |
| `perpl_fills`                         | `agent_id`, `perpl_order_id`, `fill_key text` PK (venue identity), `at`, `price_scaled`, `size_scaled`, `fee_micro`, `liquidity` (`maker`, `taker`)                                                                                                                                                                                                                                                                         | append-only                                                              |
| `perpl_positions`                     | `id` PK, `agent_id`, `run_id null`, `market_id`, `side`, `opened_at`, `closed_at null`, `entry_price_scaled`, `size_scaled`, `collateral_micro`, `realized_pnl_micro null`, `fees_micro`, `funding_micro`, `close_reason` (`decision`, `stop`, `take_profit`, `horizon`, `policy`, `kill`, `liquidation`, `deleveraging`; the first five are the paper set of `perpl-agent-runtime-v1.md` §6, the last three are live only) | the unit of live P&L (P15)                                               |
| `perpl_account_events`                | `agent_id`, `event_key` PK, `event_type smallint` (Perpl `et` 1-12), `market_id null`, `amount_micro`, `balance_micro`, `at`                                                                                                                                                                                                                                                                                                | deposits, withdrawals, funding, liquidations from `/account-history`     |
| `perpl_risk_state`                    | `agent_id` PK, `utc_day date`, `day_committed_micro`, `day_start_equity_micro`, `high_water_equity_micro`, `killed_at null`, `kill_reason null`, `policy_version`                                                                                                                                                                                                                                                           | updated in the same transaction as each intent                           |
| `perpl_reconciliation_issues`         | `id` PK, `agent_id`, `kind` (`unexplained_position`, `unexplained_fill`, `unknown_order`, `collateral_drift`), `detail jsonb`, `opened_at`, `resolved_at null`                                                                                                                                                                                                                                                              | any open issue freezes the agent                                         |
| `wallets.agent_wallet_venue_policies` | `agent_id`, `venue`, `policy_ids text[]`, `approved_at`; PK `(agent_id, venue)`                                                                                                                                                                                                                                                                                                                                             | the round-two policies (P4), beside `go-public-v1`'s `agent_wallet_caps` |

`pickler.decisions` (from `decision-resolution-v1` §5.1) gets its `venue` check extended to `perpl`
by that spec's owner. Live P&L goes to `pickler.decision_live_pnl`, whose shape and rules
`decision-resolution-v1.md` §5.7 owns (conventions decision 19). This spec writes one row per
closed position that has a `run_id`, with `source_ref` = `perpl:<position id>` plus the fill ids,
and describes nothing else about that table.

## 6. Integrations

### 6.1 Perpl

| Item         | Testnet (10143)                                            | Mainnet (143)                                      |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| Exchange     | `0x1964c32f0be608e7d29302aff5e61268e72080cc`               | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`       |
| Collateral   | USD `0xdf5b718d8fcc173335185a2a1513ee8151e3c027`           | AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`  |
| REST / WS    | `https://testnet.perpl.xyz/api`, `wss://testnet.perpl.xyz` | `https://app.perpl.xyz/api`, `wss://app.perpl.xyz` |
| Trading rate | 60 orders/min per wallet                                   | 120 orders/min per wallet                          |

Addresses from the Perpl README (fetched 2026-09-30); the manifest records each with its code hash
read from RPC, the way `packages/chain/src/deployments.ts` does for Uniswap. The account deposit and
withdraw function names are not in the public README: they are pinned from the verified Exchange
ABI into `packages/chain/src/abi/perpl-exchange.ts` at build time, and the policy and confirm checks
use their selectors from there. Endpoints used: `api-key/payload`, `api-key/enroll`,
`trading/orders` (POST, GET), `trading/positions`, `trading/wallet`, `trading/fills`,
`trading/order-history`, `trading/account-history`, `market-data/:id/book`, `market-data/:id/ticker`.
Request signing: `X-API-Key`, `X-API-Timestamp`, `X-API-Nonce`, `X-API-Signature` over
`[chainId, method, target, timestamp, nonce, bodyHash]` (README). **Perpl must whitelist
`https://studio.pickler.fun` and the staging studio origin for enrollment** (`integrations.md`,
Origin Whitelisting); this is an operator request to Perpl before §9.

### 6.2 Code placement

- `@pickler/trading/perpl` (new public subpath, `packages/trading/src/perpl.ts`): sizing, the
  `perpl-live-risk-v1` policy, the order state machine, P&L arithmetic. Pure; no transport. It
  does not import `perps-paper` (`docs/trading-architecture.md`: "An execution adapter cannot turn
  simulated margin into exchange margin rules").
- `packages/infrastructure/src/perpl/trading.ts`: the signed REST client (reuses `transport.ts`
  redirect and size guards, not its 12-request session cap); `perpl/enrollment.ts`;
  `persistence/perpl-live-store.ts`; `crypto/perpl-key-vault.ts` (AES-GCM, versioned).
- `packages/core/src/features/wallets/domain/agent-wallet-policies.ts`: a new
  `perplKillSwitchPolicy({ delegatedUserId, walletId, exchange })` beside `agentWalletPolicies`,
  with pinned-text tests like the existing ones.
- `workers/trading/src/index.ts`: the Perpl consumer (`perpl-decision`, `perpl-kill`), the minute
  Cron for reconciliation, risk stops and key expiry; today it composes Polymarket only
  (`workers/trading/src/index.ts:24-64`). The Polymarket path is unchanged.
- `workers/api`: the studio routes and the Turnkey activity builders; it never holds the Perpl key.

### 6.3 Env vars and secrets

| Name                                | Worker                         | Purpose                                                                                                                                                                  |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PERPL_ADMISSIONS_ENABLED`          | trading, api                   | Global gate, default `false`, separate from `TRADING_ADMISSIONS_ENABLED` (`workers/trading/wrangler.jsonc`)                                                              |
| `PERPL_STUDIO_ENABLED`              | api                            | Shows Perpl as a live studio venue (P16)                                                                                                                                 |
| `PERPL_CHAIN_ID`                    | trading, api                   | Override of the shared `CHAIN_ID` (`production-environment-v1.md`), kept because Perpl may reach mainnet before the launchpad (cross-review C22); defaults to `CHAIN_ID` |
| `PERPL_KEY_ENCRYPTION_KEY`          | trading (secret)               | 32 bytes, versioned `v1:`                                                                                                                                                |
| `PERPL_ENROLL_ORIGIN`               | trading                        | `https://studio.pickler.fun` (staging host on staging)                                                                                                                   |
| `PERPL_MAX_LEVERAGE`                | trading                        | 5 testnet, 2 mainnet pilot                                                                                                                                               |
| `PERPL_PILOT_MAX_COLLATERAL_MICRO`  | api                            | Most collateral the studio will prepare per agent: 1 000 USD testnet, 100 AUSD mainnet pilot                                                                             |
| `PERPL_TESTNET_FAUCET_PRIVATE_KEY`  | trading (secret, testnet only) | The faucet wallet (P13)                                                                                                                                                  |
| `PERPL_AGENT_GAS_FLOOR_MON`         | api                            | 0.02                                                                                                                                                                     |
| `TURNKEY_DELEGATED_API_PRIVATE_KEY` | trading (secret)               | Exists in `workers/api/src/env.ts:38`; the trading worker needs it only to sign the kill-switch transaction                                                              |

`scripts/check-staging.mjs` asserts `PERPL_ADMISSIONS_ENABLED` is `"true"` or `"false"` in both
configs and that the trading worker has no public route.

## 7. Design work

Surface: **studio** (web, `studio.pickler.fun`) only. The marketplace shows Perpl only through the
public record (receipts), specified elsewhere.

| Screen                           | States                                                                                                                                           | Canvas                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Trading section: Perpl card      | not available on this network, set up, onboarding (n of 7), live, paused by risk, killed, key expiring, key expired, frozen by reconciliation    | **Must be drawn**: new artboard on the studio canvas ("Pickler Studio Empty v4" family), beside the Polymarket Limits & funding card |
| Onboarding sheet (checklist)     | each step: waiting, needs passkey, signing, submitted, done, failed with retry; faucet cooldown                                                  | **Must be drawn**; reuse the passkey sheet from Go Public's wallet step                                                              |
| Positions table and order log    | empty, open positions, closed with realized P&L, unknown order being reconciled                                                                  | **Must be drawn**                                                                                                                    |
| Add collateral / Withdraw sheets | amount presets 10/25/50/100, over free collateral, two-step progress                                                                             | **Must be drawn**, derived from the existing deposit sheet (`studio-create-and-fund-v1.md` §6.2)                                     |
| Stop trading confirm and Resume  | confirm copy (§3.3), stopping progress (cancel, close, forwarding off), stopped                                                                  | **Must be drawn**                                                                                                                    |
| Brief: MAX LEVERAGE stepper      | the "Soon" tag goes with `perpl-agent-runtime-v1.md` §7; this spec adds the helper text "Live: capped at {PERPL_MAX_LEVERAGE}x during the pilot" | Existing canvas, copy change only                                                                                                    |
| Map: Perpl venue                 | owned by `perpl-agent-runtime-v1.md` §7 (paper); this spec adds nothing                                                                          | —                                                                                                                                    |

## 8. Security and abuse

- **What Pickler can do with its keys**: trade the agent's Perpl account within the collateral the
  owner deposited (the Ed25519 key); stop forwarding (the delegated user, P4). It cannot withdraw,
  transfer, approve, change policies or enroll another key without the passkey.
- **Enrollment tampering**: the API checks every typed-data field (§4 table) so a compromised
  server path cannot get the owner to sign a key with `target_profile`, a builder fee, or another
  address. The Turnkey passkey prompt shows the payload; the studio shows the same fields in plain
  words before the prompt.
- **Key custody**: private keys are encrypted at rest, decrypted only inside `workers/trading` per
  request, never logged, never returned by any route. Key rotation: new key, enroll, mark the old
  `disabled` (it expires at Perpl within 90 days; the owner may also revoke it on Perpl's web UI).
- **Blast radius of the shared delegated key** (research 02 §3.1 item 4): with P4 its only Perpl
  power is turning forwarding off, which is a denial of service at worst. Once Perpl is live,
  `TURNKEY_DELEGATED_API_PRIVATE_KEY` is held by `workers/trading`, and `workers/trading` is the only
  Worker that decrypts or uses it; `workers/api` keeps only the public half
  (`production-environment-v1.md` inventory; cross-review W10).
- **Runaway model**: the model outputs direction and probability only; sizing, leverage and stops
  are code (P7-P9); admissions can be closed globally or per agent.
- **Replay and duplicate orders**: `rq` is unique per account in the database and at Perpl; an
  `unknown` order is never resent with the same `rq`, and a new `rq` is used only after the old
  one's `lb` has passed and the venue shows no such order.
- **Faucet abuse**: one claim per studio account per 24 h, per-day global ceiling, testnet only.
- **Money boundary**: Perpl collateral is never counted as AUSD balance for the studio's schedule
  lock (`studio-create-and-fund-v1.md:405-407`); the lock reads wallet + venue collateral in the
  collateral token and says which.

## 9. Acceptance criteria and tests

Unit (`@pickler/trading/perpl`): sizing at caps and boundaries, leverage clamp, stop triggers,
day roll-over at UTC midnight, P&L with partial fills, fees and funding; order state machine
transitions including `unknown`.

Policy (core): pinned text of `perplKillSwitchPolicy`; it rejects a malformed exchange address.

Integration (infrastructure, local Postgres, scripted Perpl HTTP): intent persisted before send;
timeout → `unknown` → reconciled from order history; unexplained position freezes the agent;
key vault round trip and AAD mismatch failure.

Policy engine (the person, a Turnkey test sub-organization, like `studio-create-and-fund-v1.md`
Validation items 1-4): the delegated user **can** sign `allowOrderForwarding(false)` to the exchange
from the agent wallet; **cannot** sign `allowOrderForwarding(true)`, `approve`, `transfer`,
`createAccount`, a typed-data payload, or a transaction to any other address; the passkey can sign
all of them.

Testnet acceptance (the person, staging, recorded in `docs/perpl-live-acceptance-<date>.md`):

1. One agent onboards through all seven steps; every transaction hash and the enrolled key's
   public key are recorded.
2. With admissions open for that agent only, at least three decisions become orders; one is
   refused by a cap with its reason shown.
3. A forced stop closes a position; the kill switch cancels, closes and turns forwarding off on
   chain; resume works with the passkey.
4. Reconciliation runs 24 h without an unexplained issue.
5. Withdraw returns collateral to the master wallet.
6. A closed position's realized P&L appears in `pickler.decision_live_pnl` for its decision and in
   the studio receipt.

Mainnet gate: the testnet record, a mainnet dry run with 10 AUSD, `PERPL_MAX_LEVERAGE=2`,
`PERPL_PILOT_MAX_COLLATERAL_MICRO` = 100 AUSD, and the owner's go-ahead.

## 10. Rollout and dependencies

1. Manifest and ABI pin in `@pickler/chain`; policy builder in core (no dependency).
2. `@pickler/trading/perpl` and the infrastructure client, store and vault; migration `perpl_live`.
3. `workers/trading` composition with `PERPL_ADMISSIONS_ENABLED=false`; studio routes and screens.
4. Perpl origin whitelisting; faucet funded with Perpl testnet USD.
5. Testnet acceptance (§9); then `PERPL_STUDIO_ENABLED=true` on staging.
6. Mainnet pilot after the production environment exists.

Needs first: `go-public-v1` (public agents, the venue manifest shape, caps), `perpl-agent-runtime-v1`
(the `perps-direction-v1` protocol, the hosted Perpl data session and paper history; conventions
decision 12; this spec does not depend on `research-runtime-v2`), `custody-v2` (the AUSD withdrawal
leg, P12), PR #60/#63's acquisition reliability merged (research 02 §2 PR ledger),
`decision-resolution-v1` (the live P&L table and Perpl resolution through `PriceObservationSource`), `production-environment-v1` (mainnet secrets).

## 11. Out of scope

WebSocket order entry; limit orders resting on the book (v1 sends IOC only); markets beyond the ones
`perps-direction-v1` admits (BTC and ETH first); cross-margin between agents; a builder code;
Polymarket user custody; marketplace users trading Perpl (the `/markets` ticket stays as it is);
revoking a Perpl key through an API (Perpl offers none).

## 12. Open questions for the owner

1. **Testnet collateral**: will Perpl grant Pickler a testnet USD allocation for the faucet, or
   should we ask them for a public faucet? Without one, testnet onboarding cannot be funded.
2. **Mainnet pilot size**: is 100 AUSD per agent and 2x leverage the right first ceiling?
3. **Builder code**: should Pickler register a Perpl builder code and charge a fee on agents'
   trades (up to 0.1 %), or never take a cut of owners' trading?
4. **Prompt count**: onboarding is up to seven passkey prompts. Is that acceptable for v1, or do
   you want a Turnkey session (one prompt, a short-lived browser credential) that would change the
   "every step is a passkey signature" rule?
