# Manual paper trading

Paper trading is a reviewed, per-agent `paper-trading` plugin. It exposes no Mastra tool and cannot be invoked by the model. No wallet, signing, real order, sale or settlement is implemented.

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

Migration 0004 creates private `pickler.paper_orders` with tenant/agent/run identity, immutable configuration/decision snapshots, a private owner token and a sixty-second reservation. One attempt is allowed per research; one pending or filled position is allowed per agent/market. A different key for an existing attempt returns conflict. The same key returns the original attempt without provider calls.

States are `pending`, `filled`, `not_filled`, `failed`, `interrupted`. The operation has a 55-second deadline inside its 60-second lease and is awaited by the HTTP handler. No background promise survives the request by design. Recovery interrupts only expired paper reservations, without re-execution. Node and Cloudflare reconciliation also recover these expired reservations; status reads reconcile the relevant agent.

Before every provider operation, verify the reservation and current configuration. Successful finalization repeats these checks atomically under the agent lock, including decision expiry and temporal/quote freshness. A disabled plugin cannot finalize a new purchase. Recording a failure still requires valid ownership; old owners cannot write after expiration. Provider requests already sent may still consume quota.

The original research record is never changed by paper execution. Fill snapshots retain book levels, market/rules, conditions, fees, quantity, average price and total cost. Filled positions remain open until the deferred settlement feature exists (#11).

## Upgrade and validation

Stop old executors, apply Drizzle migrations, and restart the upgraded runtime. Migrations must pass on isolated databases first; never reset the lab database or expose private schemas through Supabase Data API. No trading keys are required.

Controlled tests cover exact decimal calculations, multiple levels, inadequate depth, price/tick constraints, missing fees, expiration, concurrent duplicate requests, open-position uniqueness, lease loss, revocation in flight, tenant isolation, HTTP validation and preservation of research. Live fill acceptance requires a genuine current approved trade. Do not invent one or weaken research policy to exercise this endpoint.

## Validation record (2026-09-17)

The final controlled suite passed 109 tests on PostgreSQL and Supabase, using isolated databases and actual migrations. Format, lint, types, workspace/Node builds and both Cloudflare dry-run bundles passed. Migrations 0003/0004 were then applied to the local laboratory after stopping the old executor. Both agents were explicitly updated to NFL configuration (alpha version 6, beta version 3), preserving Exa/Polymarket permissions, leaving optional sports plugins off and schedules disabled. The updated Node worker was restarted after confirming no queued or running research.

No live paper order was created: this delivery produced no new eligible real trade. The first research delivery's failed synthetic report acceptance remains pending, as documented in NFL-RESEARCH.md. No additional model calls, complete live investigations, remote deployment or merge occurred during paper implementation.
