# Manual paper trading

Paper trading is a reviewed, per-agent `paper-trading` plugin. It exposes no Mastra tool and cannot be invoked by the model. It supports virtual purchase and explicit resolution; no wallet, signing, real order, sale or on-chain redemption is performed.

## Enable and request

Enable `paper-trading` and `polymarket` in the agent's versioned plugin configuration, retaining `getMarketRules` and `getOrderBook` tool permissions. Then complete a new research run under that configuration. Enabling the plugin after an old trade changes configuration and intentionally makes that old decision ineligible.

```sh
npm run agent -- paper-buy alpha RUN_ID REQUEST_KEY
npm run agent -- paper-result alpha RUN_ID
```

CLI requests go to the local Studio `/pilot` API. `POST /runs/:id/paper-order` requires the tenant bearer token and `Idempotency-Key`; the body is empty or `{}`. `GET /runs/:id/paper-order` returns the attempt, including after plugins are disabled. A finished synchronous request returns 200; a duplicate request observing an in-flight attempt returns 202. Poll that same resource. Research dispatch continues to use its existing `202 + runId` contract.

Only completed, policy-approved, unexpired `TRADE` decisions with unchanged configuration and an active agent qualify. Historical v2 decisions can qualify if all requirements hold. Raw legacy decisions without a policy verdict cannot qualify.

## Simulation model

Each attempt has a fixed budget of ten virtual currency units, including estimated fees. It consumes ascending ask levels up to the approved limit, using integer decimal arithmetic. The outcome must belong to the selected market. Quantities use six decimal places; fee estimates round to five decimal places per consumed level. Rounding may leave at most 0.00001 of the budget unspent. The entire remaining amount must be fillable, otherwise no position is created. There are no partial or resting orders.

Market rules, temporal eligibility, tick size, minimum USDC notional, explicit fee settings and book depth are rechecked. Books and conditions must be no older than thirty seconds. The initial adapter supports the documented exponent-one fee curve, `shares × rate × price × (1-price)`, from explicit per-market Gamma metadata. It does not infer a fee from category or treat missing fees as zero. An explicitly fee-disabled market is distinct from missing metadata. Unsupported curves or incomplete conditions fail explicitly. A simulated fill is a snapshot estimate, not a promise that a real exchange would fill it.

Relevant primary documentation: [market trading constraints and fee metadata](https://docs.polymarket.com/market-data/market-details), [fee formula and precision](https://docs.polymarket.com/trading/fees).

## Persistence and cancellation

Migration 0004 creates private `pickler.paper_orders` with tenant/agent/run identity, immutable configuration/decision snapshots, a private owner token and a sixty-second reservation. One attempt is allowed per research; one pending or unresolved filled position is allowed per agent/market. A different key for an existing attempt returns conflict. The same key returns the original attempt without provider calls.

States are `pending`, `filled`, `not_filled`, `failed`, `interrupted`. The operation has a 55-second deadline inside its 60-second lease and is awaited by the HTTP handler. No background promise survives the request by design. Recovery interrupts only expired paper reservations, without re-execution. Node and Cloudflare reconciliation also recover these expired reservations; status reads reconcile the relevant agent.

Before every provider operation, verify the reservation and current configuration. Successful finalization repeats these checks atomically under the agent lock, including decision expiry and temporal/quote freshness. A disabled plugin cannot finalize a new purchase. Recording a failure still requires valid ownership; old owners cannot write after expiration. Provider requests already sent may still consume quota.

The original research record is never changed by paper execution. Fill snapshots retain book levels, market/rules, conditions, fees, quantity, average price and total cost. Filled positions remain open until the explicit resolution check described below commits a virtual settlement.

## Upgrade and validation

Stop old executors, apply Drizzle migrations, and restart the upgraded runtime. Migrations must pass on isolated databases first; never reset the lab database or expose private schemas through Supabase Data API. No trading keys are required.

Controlled tests cover exact decimal calculations, multiple levels, inadequate depth, price/tick constraints, missing fees, expiration, concurrent duplicate requests, open-position uniqueness, lease loss, revocation in flight, tenant isolation, HTTP validation and preservation of research. Live fill acceptance requires a genuine current approved trade. Do not invent one or weaken research policy to exercise this endpoint.

## Validation record (2026-09-17)

The final controlled suite passed 109 tests on PostgreSQL and Supabase, using isolated databases and actual migrations. Format, lint, types, workspace/Node builds and both Cloudflare dry-run bundles passed. Migrations 0003/0004 were then applied to the local laboratory after stopping the old executor. Both agents were explicitly updated to NFL configuration (alpha version 6, beta version 3), preserving Exa/Polymarket permissions, leaving optional sports plugins off and schedules disabled. The updated Node worker was restarted after confirming no queued or running research.

No live paper order was created: this delivery produced no new eligible real trade. The first research delivery's failed synthetic report acceptance remains pending, as documented in NFL-RESEARCH.md. No additional model calls, complete live investigations, remote deployment or merge occurred during paper implementation.

## Resolution and virtual results

New scoped simulations support NFL and soccer full-game winners with explicit regulation or
extra-time rules. Awards, season markets and BTC Up/Down are not part of this sports protocol.
The existing research policy must still produce `TRADE`; an abstention never creates a position.
This is paper trading, not a testnet, and does not prove CLOB acceptance or profitability.

Apply migration `0011_cuddly_shocker` using the normal operator migrator before running the new
binary. It adds nullable settlement evidence without rewriting existing orders or research.
Legacy fills without buy-time condition/outcome identity remain readable but cannot be settled
by guessing an identity. Existing completed fills retain their execution status `filled`;
`settlement: null` means open and a settlement document means resolved virtually.

After buying with `paper-buy`, explicitly check resolution:

```sh
npm run agent -- paper-settle alpha RUN_ID
npm run agent -- paper-result alpha RUN_ID
npm run agent -- paper-summary alpha
```

The same endpoints are exposed through authenticated local `/pilot` and deployed
`/api/v1/studio` transports:

- `POST /runs/:id/paper-order/settle`: empty body; idempotent by the persisted position.
- `GET /agents/:id/paper-summary`: read-only virtual results for the authorized agent.

Settlement is an explicit operation, not an automatic scheduler in this delivery. Checking an
unresolved market leaves it open. No clock-based win, price-based win, synthetic refund or
provider-error fallback exists. Repeating a completed settlement makes no provider call and
cannot credit it twice. Provider errors preserve the open position and surface as errors.

The reader uses public Polygon RPC (`polygon-bor-rpc.publicnode.com`) and only `eth_chainId`,
`eth_getBlockByNumber` and `eth_call`. It reads the official CTF contract's payout denominator,
outcome count and selected numerator at a finalized, canonical block pinned by hash. The
condition and outcome index are captured from Gamma at purchase. Zero denominator means no
final payout yet. Fractional payouts are preserved; they are not assumed to refund the entry
cost. The snapshot records the contract, chain, block, payout fraction and observation time.
See [Polymarket contracts](https://docs.polymarket.com/resources/contracts) and
[CTF mechanics](https://docs.polymarket.com/trading/positions/how-positions-work).

Both plugins and the market-rules permission are required before fetching and committing a new
settlement. Configuration changes during a check reject its commit. Pausing buys or allowing
the original proposal to expire does not erase an existing position. Disabled plugins block new
checks; persisted history and summaries stay readable. This never signs, sends or redeems any
real token. Model and Exa calls used for new research may still incur their normal charges.

`paper-summary` separates total entry cost, open cost, virtual payouts, realized P&L and net cash
flow. Open positions are not counted as realized losses. Net cash flow is payouts minus all
entry costs; it is **not** a funded wallet balance or a mark-to-market valuation. No arbitrary
starting bankroll or automatic top-up is added. Fees remain part of each entry's cost. Gamma's
`orderMinSize` is enforced as a minimum share quantity, separately from legacy notional limits.

BTC Up/Down needs its own scope, short-horizon research/data protocol and timing tests. Do not
route it through the sports classifier just to obtain faster simulated outcomes.

## Validation record (2026-09-27)

- Full repository suite: 325 passed, zero failures, one existing opt-in local Workers flow skipped.
- Isolated PostgreSQL: new schema plus fresh, original research/product and pre-settlement
  migration histories; duplicate finalization, loss, fractional payout, provider failure,
  plugin revocation, tenant isolation, expiry and soccer response validation.
- Format, lint and all workspace types passed. Shared libraries, Node/Mastra and API/research/
  trading Worker dry runs passed; OpenNext web Worker compilation also passed.
- A public read-only Polygon probe returned a finalized block and zero payout denominator for
  the zero condition. This proves RPC/CTF read compatibility only, not a real market settlement.
- Gamma requests from this environment failed with connection resets. No live paper purchase,
  model research, real order, signature, wallet funding, production migration or deployment was
  performed. Real-market end-to-end acceptance remains pending; controlled fixtures are not
  investment-performance evidence.
