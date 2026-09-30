# Token trading v1: buying and selling an agent token in the marketplace

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md` (the
products and wallets rule: marketplace web signs with Mera or an injected EOA, the mobile app with
Mera only; Turnkey never appears here). Every decision is reversible.

Stands on `launchpad-deploy-v1.md` (the deployed factory, the manifest, indexer v2 with holders,
candles and fee payouts, D13 attribution) and on `marketplace-wallets-v1.md` (the `"mera"` signer,
SIWE sign-in, the confirmation sheet of its §3.6). The mobile contract is `mobile-backend-v1.md`
§3.4 and §4.2; this spec owns the trade and portfolio routes listed there and keeps every field it
lists. Launching a token and claiming creator fees are `token-launch-v1.md` (studio).

## 1. Problem and users

A buyer cannot trade an agent token today, even on a deployed launchpad:

- **The token page reads the agent profile, not the launch.** `/tokens/[ticker]` loads
  `services.getAgentProfile(ticker)` (`apps/web/src/app/tokens/[ticker]/page.tsx:12,28`), which is
  `market.tokens` joined to an agent. The projector writes every launch with no agent
  (`packages/infrastructure/src/persistence/product/launch-projector.ts:136`), so the board lists a
  launch and the click 404s (`apps/web/src/features/agents/components/launch-board.tsx:55`).
- **The trade panel is a placeholder.** It prices in MON (`trade-panel.tsx:61,65`) while the
  preset's quote is AUSD, uses a fake depth constant (`:30-32`), and its button is permanently
  disabled once connected (`:83`).
- **Nothing quotes, builds or tracks a trade.** The API serves only `/v1/launches`, `/:id`,
  `/:id/trades` (`workers/api/src/launches/routes.ts:18-66`).
- **Both sides need an ERC-20 approval.** A buy pulls AUSD with `safeTransferFrom`
  (`contracts/src/PicklerBondingCurve.sol:385-393`, via `_collectQuote` at `:208`); a sell pulls
  the agent token with `safeTransferFrom` (`:288`). The curve has no permit entry point and the
  agent token is a plain ERC-20 with no permit (`contracts/src/PicklerAgentToken.sol:14`).
- **The web offers only an injected wallet** (`apps/web/src/features/wallet/lib/signer.ts:14`);
  Mera returns with `marketplace-wallets-v1.md` D1.

Users: marketplace visitors (read-only), signed-in marketplace accounts on the web (Mera or EOA)
and on iOS (Mera), and the agent's owner, who sees their holders and volume.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                 | Reason                                                                                                                                                                                                              | Reversible? |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| T1  | **The token page reads the launch.** New public route `GET /v1/marketplace/tokens/:ticker` answers from `market.tokens` and the launch read model, left-joined to the agent. An unlisted token (no `launch.agent_keys` row, `launchpad-deploy-v1` D13) renders with "No linked agent" and is hidden from `/tokens`.      | A launch the chain has is real whether or not we know its agent (`market.ts:45-52`). Hiding it from the board keeps squat-like tokens out of discovery; its page stays reachable by address for honesty.            | yes         |
| T2  | **Quotes are on-chain, at the latest block, never cached and never locked.** The API runs `eth_call` on `quoteBuy`, `quoteBuyExactOutput`, `quoteSell` and `getCurveState`, and refuses with `503 QUOTE_STALE` when the RPC head is older than 30 s or the indexer lags the head by more than 60 s.                      | `launchpad-monad-v1.md` §8 "The quote is on-chain". The TypeScript port (`packages/core/src/features/launch/domain/curve-math.ts:26,45`) only previews while the person types.                                      | yes         |
| T3  | **The trade quote is the prepare step.** `POST /v1/me/trades/quote` (mobile contract) returns a `quoteId`, the unsigned approval (or null) and the unsigned trade transaction. The server builds calldata; the client signs and broadcasts; the server never holds a buyer key.                                          | The page never composes calldata (`marketplace-wallets-v1.md` §3.6). One route for web and mobile. The parent brief's `/v1/me/tokens/:ticker/trades/prepare` is merged into this route to keep the mobile contract. | yes         |
| T4  | **Approvals are exact-amount**, to the curve (buy: AUSD; sell: the agent token), and only when the current allowance is short. No unlimited approvals.                                                                                                                                                                   | A compromised curve could otherwise drain every approving wallet. Costs one extra signature per trade when allowance is short; the sheet says why.                                                                  | yes         |
| T5  | **Slippage default 1 %, maximum 5 %, deadline now + 120 s.** `minOut` (exact-in) or `maxIn` (exact-out) is computed by the API from the on-chain quote.                                                                                                                                                                  | Curve trades are deterministic given state; slippage only covers state moving between quote and inclusion. 5 % caps what a sandwich can take.                                                                       | yes         |
| T6  | **Modes**: buy exact-in (spend N AUSD), buy exact-out (get N tokens), sell exact-in (sell N tokens). When an exact-in buy would exceed `remainingTokens()`, the quote answers `remainder: true` with a `buyExactOutput` for exactly the remaining tokens.                                                                | The curve reverts rather than partially filling (`PicklerBondingCurve.sol:185-187,201-203`); offering the remainder is the honest alternative.                                                                      | yes         |
| T7  | **Trade states** `quoted → submitted → included → confirmed`, or `reverted` / `expired` / `dropped`. `confirmed` means the indexer projected the trade at its `CONFIRMATIONS`. The sheet never shows a fill before `included`.                                                                                           | Never fake a charge (`marketplace-wallets-v1.md` §3.6). A receipt, not a hash, is the truth.                                                                                                                        | yes         |
| T8  | **Graduation is kept moving by a keeper.** `READY_TO_GRADUATE` shows "Graduating". A Cron in `workers/trading` calls the permissionless `finalizeGraduation(curve)` (`PicklerGraduationAdapterV4.sol:100`) from a gas-only EOA within a minute; the page also offers "Finalize" to any connected wallet as a fallback.   | Nobody has a reason to pay gas for graduation; a stuck token is a broken market. The keeper holds only MON and can do nothing but call a public function.                                                           | yes         |
| T9  | **After graduation, trades go through the Uniswap V4 Universal Router recorded in `packages/chain` for that chain.** On testnet, the Monad-maintained V4 has no Universal Router recorded in `packages/chain/src/deployments.ts`: v1 shows the pool price and an explorer link, read-only, labelled "Trades on the DEX". | Only verified, code-hashed addresses are used (`deployments.ts:3-11`). Building a V4 swap path against an unverified router on a testnet build that differs from mainnet proves nothing about mainnet.              | yes         |
| T10 | **Portfolio = holdings of every wallet linked to the account** (`identity.wallet_links`), from `market.holders`, valued at the last trade price, with cost basis from the account's `market.trades` rows (average cost, FIFO not needed in v1).                                                                          | One account, several wallets (`marketplace-wallets-v1.md` D12). Indexed data, not per-request RPC.                                                                                                                  | yes         |
| T11 | **Prices and amounts in the API are integers in base units** (`amountMicro` for AUSD, `amountWei`-style base units for the 18-decimal token, as decimal strings). Candles are quote per whole token as decimal strings.                                                                                                  | Conventions "Money: integers in micro-units"; token amounts exceed `bigint` JSON safety, so strings.                                                                                                                | yes         |
| T12 | **Mobile trades use the same routes**; the app broadcasts with the Mera SDK's `signTransaction` and posts the hash.                                                                                                                                                                                                      | `mobile-backend-v1.md` §3.4.                                                                                                                                                                                        | yes         |

## 3. User flows

### 3.1 Browse

1. `/tokens` (exists) lists listed launches. Each row links `/tokens/<TICKER>`.
2. `/tokens/<TICKER>` renders the token page (§7) from `GET /v1/marketplace/tokens/:ticker`,
   candles, trades and holders. With no session, the ticket shows "Connect to trade".

### 3.2 Buy on the curve (web, Mera or EOA)

1. The person picks Buy, types an amount in AUSD (or toggles to "tokens"). The panel previews with
   the TypeScript curve math against the last `getCurveState` the page fetched.
2. On pause (400 ms) or "Review", the page calls `POST /v1/me/trades/quote` with the amount,
   side, mode and slippage. The API returns the on-chain quote, `minOut`, fees, the approval if
   the AUSD allowance is short, the trade tx, and `expiresAt` (= the deadline).
3. The confirmation sheet (`marketplace-wallets-v1.md` §3.6, "Trade a token") shows: maximum
   spend, expected and minimum tokens, average price, estimated impact, itemized fees (buy fee,
   of which protocol share), gas in MON, destination "Pickler launchpad · curve 0x…", spender for
   the approval, and expiry (`launchpad-monad-v1.md:128`). The page checks `to`, `value`,
   `chainId` and the decoded amount against what it displays (`SIGNING_MISMATCH` otherwise).
4. If an approval is needed: the wallet signs and broadcasts the approve; the page waits for its
   receipt (polling the RPC through the API's `GET /v1/me/trades/:id`, which also watches the
   approval hash).
5. The wallet signs and broadcasts the trade. The page posts `POST /v1/me/trades { quoteId,
txHash }`. The sheet shows "Sent · waiting for Monad".
6. The API watches the receipt: `included` on a successful receipt (the sheet shows the tokens
   received from the `CurveBought` log in the receipt), `confirmed` when the indexer projected it,
   `reverted` with the decoded error (`SlippageExceeded`, `DeadlinePassed`,
   `ExceedsRemainingSupply`, `CurveClosed`, `NotReady`) and a plain sentence for each.
7. The page refreshes the position, trades and candles.

A quote older than its deadline is refused by the page before signing ("Price moved · refresh").

### 3.3 Sell

The same, with the agent token approval (exact amount) and `sellExactInput(tokensIn, minQuoteOut,
recipient, deadline)` (`PicklerBondingCurve.sol:265`). Selling is allowed only while the curve is
`CURVE_ACTIVE`; after graduation, the pool.

### 3.4 Last tokens

An exact-in buy that would exceed the remaining supply comes back with `remainder: true`,
`remainingTokens`, and a `buyExactOutput` quote for all of them. The ticket says "Only N tokens
left · buy them all for X AUSD". A buy that completes the curve moves it to `READY_TO_GRADUATE`
(`PicklerBondingCurve.sol:395-400`).

### 3.5 Graduation

1. The curve is `READY_TO_GRADUATE`: the ticket is replaced by "Graduating · the pool opens
   shortly", with a "Finalize" button for any connected wallet.
2. The keeper (§6.3) calls `finalizeGraduation` within a minute. The indexer projects
   `LaunchGraduated`; the token becomes `graduated` and gets a `post_graduation` pool.
3. Mainnet: the ticket trades through the Universal Router. Testnet (T9): read-only price and
   "Trades on the DEX" with the pool's explorer link.

### 3.6 Portfolio

`/portfolio` (web) and the Portfolio tab (mobile) list, per linked wallet: MON and AUSD balances,
each token held with amount, value, average cost and unrealized P&L, and the account's recent
trades. Balances that cannot be read show "—", never 0 (`mobile-backend-v1.md` §4.2,
`CHAIN_UNAVAILABLE`).

### 3.7 Mobile

The token screen, trade sheet and portfolio tab call the same routes. Signing is the Mera sheet of
`marketplace-wallets-v1.md` §3.3. Universal links `/tokens/*` and `/portfolio` open the app
(`mobile-backend-v1.md` M10).

## 4. API

All under `/v1`, envelope and errors per conventions. Public routes need no credentials; `/me/*`
needs the marketplace Supabase JWT.

### 4.1 Public

| Method | Path                                  | Request                                                                   | Response `data`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Errors                                                                                   |
| ------ | ------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/marketplace/tokens/:ticker`         | ticker without `$`, case-insensitive; or `?address=0x…`                   | `TokenDetailDto { launchId, ticker, name, imageUrl, description, chainId, address, decimals, totalSupply, quote: { address, symbol, decimals }, phase: "curve" \| "graduating" \| "pool", curve: { address, netSold, remaining, realQuoteReserve, graduationTarget, progressBps }, pool: { venue, poolId, explorerUrl, tradable } \| null, price, marketCapMicro, volume24hMicro, holders, agent: { handle, name, avatarUrl } \| null, listed, freshness: { block, at, stale } }` | 404 `TOKEN_NOT_FOUND`                                                                    |
| GET    | `/marketplace/tokens/:ticker/trades`  | `?cursor=&limit=`                                                         | `[{ side, trader, tokenAmount, quoteAmountMicro, feeMicro, price, txHash, blockTime }]`                                                                                                                                                                                                                                                                                                                                                                                           | 404                                                                                      |
| GET    | `/marketplace/tokens/:ticker/candles` | `?interval=5m\|1h\|4h\|1d&from=&to=` (max 500 buckets)                    | `[{ bucketStart, open, high, low, close, volumeMicro }]`                                                                                                                                                                                                                                                                                                                                                                                                                          | 400 `INVALID_INTERVAL`, 404                                                              |
| GET    | `/marketplace/tokens/:ticker/holders` | `?cursor=&limit=`                                                         | `[{ address, balance, shareBps, label: "creator" \| "agent" \| null }]`, `meta.count`; curve, adapter, locker and PoolManager excluded                                                                                                                                                                                                                                                                                                                                            | 404                                                                                      |
| GET    | `/marketplace/tokens/:ticker/quote`   | `?side=buy\|sell&mode=exactIn\|exactOut&amount=<base units>&slippageBps=` | `{ block, amountIn, amountOut, minOut \| maxIn, feeMicro, priceImpactBps, averagePrice, remainder: { remainingTokens, grossQuoteIn } \| null, expiresAt }` — informational, no tx                                                                                                                                                                                                                                                                                                 | 400 `INVALID_AMOUNT`, 409 `CURVE_NOT_ACTIVE`, 503 `QUOTE_STALE`, 503 `CHAIN_UNAVAILABLE` |

`/v1/launches*` stay as they are (`routes.ts:18-66`) for the board and the mobile app.

### 4.2 Signed in (owns the rows of `mobile-backend-v1.md` §4.2)

| Method | Path               | Request                                                                                                                                       | Response `data`                                                                                                                                                                                                | Errors                                                                                                                                                          |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/me/trades/quote` | `{ launchId, side, mode?: "exactIn" \| "exactOut" (default exactIn), amountInMicro? , amountOut?, wallet, slippageBps? }` + `Idempotency-Key` | `{ quoteId, minOutMicro, maxInMicro?, quote: <as 4.1>, approval: TxRequest \| null, tx: TxRequest, expiresAt }` where `TxRequest = { to, data, value: "0", chainId, gas, maxFeePerGas, maxPriorityFeePerGas }` | 400 `INVALID_AMOUNT`, 403 `WALLET_NOT_LINKED`, 409 `LAUNCH_NOT_TRADABLE`, 409 `INSUFFICIENT_BALANCE` (AUSD or token), 409 `INSUFFICIENT_GAS`, 503 `QUOTE_STALE` |
| POST   | `/me/trades`       | `{ quoteId, txHash, approvalTxHash? }` + `Idempotency-Key`                                                                                    | `TradeDto { id, launchId, ticker, side, wallet, status, amountIn, amountOut, minOut, txHash, revertReason, createdAt, confirmedAt }`                                                                           | 404 `QUOTE_NOT_FOUND`, 409 `QUOTE_EXPIRED`, 409 `TX_MISMATCH` (the broadcast tx's `to`, `from`, calldata differ from the quote), 409 `TRADE_ALREADY_RECORDED`   |
| GET    | `/me/trades`       | `?cursor=&limit=&launchId=`                                                                                                                   | `TradeDto[]`                                                                                                                                                                                                   | —                                                                                                                                                               |
| GET    | `/me/trades/:id`   | —                                                                                                                                             | `TradeDto` plus `approval: { txHash, status }`                                                                                                                                                                 | 404                                                                                                                                                             |
| GET    | `/me/portfolio`    | —                                                                                                                                             | `mobile-backend-v1.md` §4.2 shape, with each `tokens[]` entry extended by `{ averageCostMicro, unrealizedPnlMicro, phase }` and a top-level `trades: TradeDto[]` (last 20)                                     | 503 `CHAIN_UNAVAILABLE` (balances `null`, holdings still served from the index)                                                                                 |

`TX_MISMATCH` is checked by fetching the transaction by hash and comparing `from` with `wallet`,
`to` with the curve and `input` with the quote's calldata byte for byte. `wallet` must be linked to
the account (`identity.wallet_links`); the trade's `recipient` is always `wallet`.

DTOs: `packages/api-schema/src/token-trading.ts` (new) — `TokenDetailDto`, `CandleDto`,
`HolderDto`, `TokenQuoteDto`, `TradeQuoteRequest`, `TradeQuoteDto`, `TxRequestDto`, `TradeDto`,
`PortfolioDto`. Business rules (slippage bounds, mode selection, remainder, `minOut` rounding
toward the protocol) in `packages/core/src/features/launch/domain/trade.ts`; RPC through the
existing chain-reader port (`packages/core/src/features/launch/ports/chain-reader.ts`).

## 5. Data model and migrations

### Migration `token_trade_requests` (number assigned at build time; the next free is 0023)

```sql
create type market.trade_request_status as enum
  ('quoted', 'submitted', 'included', 'confirmed', 'reverted', 'expired', 'dropped');

create table market.trade_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.profiles(user_id) on delete cascade,
  wallet text not null,                       -- ^0x[0-9a-f]{40}$
  token_id uuid not null references market.tokens(id) on delete restrict,
  venue text not null check (venue in ('pickler_curve', 'uniswap_v4')),
  side market.trade_side not null,
  mode text not null check (mode in ('exactIn', 'exactOut')),
  amount_in numeric(78,0) not null,
  amount_out_quoted numeric(78,0) not null,
  limit_amount numeric(78,0) not null,        -- minOut or maxIn
  slippage_bps smallint not null check (slippage_bps between 1 and 500),
  quote_block bigint not null,
  calldata_hash text not null,                -- keccak256 of the trade calldata
  approval_calldata_hash text,
  deadline timestamptz not null,
  idempotency_key text not null,
  status market.trade_request_status not null default 'quoted',
  approval_tx_hash text,
  tx_hash text,
  trade_id bigint references market.trades(id),  -- set when the indexer projects it
  revert_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create unique index trade_requests_tx_key on market.trade_requests (tx_hash) where tx_hash is not null;
create index trade_requests_user_idx on market.trade_requests (user_id, created_at desc);
create index trade_requests_open_idx on market.trade_requests (status) where status in ('submitted', 'included');
```

RLS on, no Data API exposure, `service_role` grants as `0016_launch_grants.sql`. Reorg: a
`confirmed` row whose `market.trades` row is deleted by the projector's rollback returns to
`submitted` and is re-watched (the foreign key is `on delete set null` in the build; written here as
a plain reference for readability).

No new projection tables: `market.holders`, `market.candles`, `market.trades` and
`market.fee_payouts` are filled by indexer v2 (`launchpad-deploy-v1.md` D14, §5.2). Portfolio
reads join `identity.wallet_links` (`packages/infrastructure/src/persistence/product/identity.ts:124`)
to `market.holders` on `address`.

### Jobs

- **Trade watcher** (Cron every minute in `workers/api`'s scheduled handler, or the research
  Worker's Cron if `workers/api` has none at build time): for `submitted` rows, read the receipt;
  set `included` or `reverted` (decode the revert with the curve ABI); after the deadline plus
  5 minutes with no receipt and no pending tx, `dropped`. For `included` rows, link the projected
  `market.trades` row by `(tx_hash, log_index)` and set `confirmed`.
- **Quote expiry**: `quoted` rows past their deadline become `expired`.

## 6. Integrations

### 6.1 Contracts (no changes)

| Call                                                                               | Where                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `quoteBuy`, `quoteBuyExactOutput`, `quoteSell`, `remainingTokens`, `getCurveState` | `PicklerBondingCurve.sol:133-180`, via `eth_call`          |
| `buyExactInput`, `buyExactOutput`, `sellExactInput`                                | `PicklerBondingCurve.sol:188,222,265`                      |
| ERC-20 `approve`, `allowance`, `balanceOf` on AUSD and the agent token             | `packages/chain/src/networks.ts:62-80` for AUSD            |
| `finalizeGraduation(curve)`                                                        | `PicklerGraduationAdapterV4.sol:100`                       |
| V4 Universal Router `execute` (mainnet only, T9)                                   | address from `packages/chain/src/deployments.ts` per chain |

Addresses come from the Pickler manifest `packages/chain/src/deployments/pickler-<chainId>.ts`
(`launchpad-deploy-v1.md` §5.3); curve addresses from `market.pools`.

### 6.2 Wallets

- Web: `SignerKind = "injected" | "mera"` (`signer.ts:14`; `marketplace-wallets-v1.md` D1). EOA
  uses `eth_sendTransaction`; Mera builds from the `TxRequest`, `signTransaction`, then the page
  broadcasts through the API-provided RPC (`eth_sendRawTransaction` on `NEXT_PUBLIC_MONAD_RPC_URL`).
- Mobile: the Mera React Native client, same `TxRequest`.
- Gas: the buyer pays MON. `INSUFFICIENT_GAS` is answered before signing when
  `balance < gas × maxFeePerGas × (approval ? 2 : 1)`.

### 6.3 Keeper

- `workers/trading` gains a Cron step `graduation-keeper` (every minute): list tokens whose curve
  phase is `READY_TO_GRADUATE` from the index, confirm with `getCurveState`, and send
  `finalizeGraduation`. It never sends a second tx while one is pending for the same curve.
- Secret `LAUNCH_KEEPER_PRIVATE_KEY` (gas-only EOA, holds ≤ 5 MON; an alert fires under 0.5 MON);
  var `LAUNCH_KEEPER_ENABLED` (default `false` until the launchpad is deployed). The keeper key is
  not the launch authority and not the operator.

### 6.4 Env vars

| Name                          | Where                      | Purpose                                             |
| ----------------------------- | -------------------------- | --------------------------------------------------- |
| `RPC_URLS`                    | `workers/api`              | quotes and receipts (shared with the launch routes) |
| `QUOTE_MAX_HEAD_AGE_SECONDS`  | `workers/api`, default 30  | T2                                                  |
| `QUOTE_MAX_INDEX_LAG_SECONDS` | `workers/api`, default 60  | T2                                                  |
| `TRADE_DEADLINE_SECONDS`      | `workers/api`, default 120 | T5                                                  |
| `NEXT_PUBLIC_MONAD_RPC_URL`   | `apps/web`                 | Mera broadcast                                      |
| `LAUNCH_KEEPER_*`             | `workers/trading`          | §6.3                                                |

## 7. Design work

Existing canvases (Claude Design project `c03aadb4-…`): `Pickler Public.dc.html` draws `/tokens`
and the token page with a trade panel (the panel in code today); `Portfolio Light` draws the
portfolio; the mobile flows canvas has token and portfolio frames. None draws the trade states
below; `design-system-v2.md:337-338` puts "the agent-token curve UI" out of its scope.

| Surface         | Screen                     | States                                                                                                                                                                                             | Canvas                                                                                                     |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| marketplace web | Token page                 | curve (progress to graduation), graduating, pool (mainnet tradable / testnet read-only), no linked agent, stale data banner, not found                                                             | Exists in `Pickler Public`; **amend** with the phase header, graduation progress, and the unlinked variant |
| marketplace web | Trade ticket               | disconnected, wrong network, quoting, quote ready, stale quote, remainder offer, needs approval, insufficient AUSD / tokens / MON, graduating (Finalize), pool read-only                           | **draw** "Pickler Token Trade" (new canvas, light surface)                                                 |
| marketplace web | Confirmation sheet — trade | max spend, expected and min out, average price, impact, fees, gas, destination, spender, expiry; approval step 1 of 2; sent · waiting; included; confirmed; reverted with reason; mismatch refused | Belongs to "Pickler Signing Sheet" (`marketplace-wallets-v1.md` §7); **draw** its trade frames there       |
| marketplace web | Chart, trades, holders     | 5m/1h/4h/1d, empty (no trades yet), holders with creator label                                                                                                                                     | Exists in `Pickler Public`; check against real shapes                                                      |
| marketplace web | Portfolio                  | no wallet, wallets with tokens, balances unavailable, pending trade row                                                                                                                            | Exists (`Portfolio Light`); **amend** with average cost, P&L and pending                                   |
| mobile          | Token screen               | as web token page                                                                                                                                                                                  | **draw** in the mobile flows canvas                                                                        |
| mobile          | Trade sheet                | as web ticket and confirmation, one sheet with steps                                                                                                                                               | **draw** in the mobile flows canvas                                                                        |
| mobile          | Portfolio tab              | as web portfolio                                                                                                                                                                                   | extend the mobile flows canvas                                                                             |

Code: `trade-panel.tsx` is rewritten against the quote route (AUSD unit, no depth constant);
`scripts/design/routes.mjs` gains fixtures for the ticket in "quote ready", "needs approval" and
"graduating", and the existing `/tokens/half` route (`routes.mjs:167-176`) switches its fixture to
the new token route.

## 8. Security and abuse

- **Calldata integrity**: the server builds calldata; the client checks it against the sheet; the
  server checks the broadcast tx against the quote (`TX_MISMATCH`). `recipient` is always the
  signing wallet, so a tampered page cannot redirect tokens without the mismatch check failing.
- **Approvals**: exact-amount only (T4). The sheet names the spender and says "exactly X".
- **Sandwiching**: bounded by the 5 % slippage cap and the 120 s deadline; default 1 %. No private
  mempool in v1.
- **Wrong token**: the ticker resolves only to listed tokens on the board; the page of an unlisted
  token carries a warning "Not linked to a Pickler agent".
- **Quote abuse**: `POST /me/trades/quote` is rate limited to 30/min per user and 120/min per IP
  (429 with `retryAt`); the public quote to 60/min per IP.
- **Keeper**: a gas-only key calling a public function; worst case is wasted MON.
- **Privacy**: holders are public chain data; the portfolio is private to the account.

## 9. Acceptance criteria and tests

- Core: slippage bounds; `minOut` rounds down and `maxIn` rounds up; remainder detection; mode
  selection; parity of the preview with the Solidity vectors (existing fixture).
- API: quote against an anvil deployment returns the same number as a direct `eth_call`;
  `QUOTE_STALE` when the head is old; `TX_MISMATCH` on altered calldata, recipient or sender;
  `WALLET_NOT_LINKED`; idempotent `POST /me/trades`.
- Watcher: included, reverted (each decoded error), dropped, and a reorg returning a confirmed
  trade to submitted.
- Web: `/tokens/<ticker>` of an unlinked launch renders (no 404); the ticket never enables "Buy"
  without a fresh quote; the unit is AUSD; Playwright route checks for the new fixtures.
- End to end on 10143 with the deployed launchpad: two wallets (one Mera, one MetaMask) buy and
  sell; holders and candles update within 2 minutes; one buy consumes the remainder; the keeper
  finalizes graduation within 2 minutes; the token page shows the pool read-only.
- Mobile: the app completes a buy on 10143 with Mera through the same routes.

## 10. Rollout and dependencies

1. `launchpad-deploy-v1` deployed on 10143 with indexer v2 (holders, candles).
2. `marketplace-wallets-v1` (Mera signer, SIWE, signing sheet).
3. `token-launch-v1` (for tokens that exist and are linked).
4. This spec: migration, routes, watcher, web ticket; behind `NEXT_PUBLIC_TOKEN_TRADING=on|off`
   (default off) until the end-to-end run passes.
5. Keeper on (`LAUNCH_KEEPER_ENABLED=true`).
6. Mobile app release using the same routes (`mobile-backend-v1`).

## 11. Out of scope

Post-graduation trading on testnet (T9); limit orders; a private mempool or MEV protection beyond
slippage and deadline; creator fee claims (`token-launch-v1`); agents trading their own token
(their wallets deny `approve`, `packages/core/src/features/wallets/domain/agent-wallet-policies.ts:150-155`);
fiat on-ramp; trading from the studio.

## 12. Open questions for the owner

1. **Mainnet post-graduation trading**: route through the Uniswap Universal Router inside Pickler
   (T9), or always send people to an external DEX interface once a token graduates?
2. **A Pickler fee on marketplace trades** on top of the preset's buy and sell fees: none in v1.
   Do you want one?
