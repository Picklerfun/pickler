# Perpetual paper accounts

The `perps-paper` plugin is an explicit local operator capability, separate from Polymarket paper
orders and the real monetary budget. Version `conservative-1x-v1` starts each tenant/agent/session/
network account with exactly 1,000 virtual AUSD. It has no wallet, transfer, liquidation, or model
execution tool. This first milestone provides accounts, reservations, risk evaluation and trusted
simulator contracts; market operations are exercised only in controlled tests until the simulator
milestone is delivered.

## Setup and commands

Use the existing `DATABASE_URL` in the agent-service environment and an existing agent already
configured for Perpl on the desired network. Apply the generated Drizzle migration using the
operator's `DATABASE_MIGRATION_URL`; commands never migrate or seed automatically.

```sh
npm run db:migrate
npm run build:shared
npm run perps:paper --workspace=@pickler/agent-service -- account-init --tenant TENANT --agent AGENT --session SESSION --network mainnet --expected-version 3 --enable-plugin
npm run perps:paper --workspace=@pickler/agent-service -- status --tenant TENANT --agent AGENT --session SESSION --network mainnet
npm run perps:paper --workspace=@pickler/agent-service -- risk-check --tenant TENANT --agent AGENT --session SESSION --network mainnet --kind open --symbol BTC --side long
```

Replace IDs/version with stored values. `--enable-plugin` explicitly enables the paper plugin and
policy through the existing optimistic config update, which disables scheduling. If already enabled,
it does not update again. The account pins the resulting version. Repeating initialization never
credits again; changing a configuration does not upgrade a historical session. Read the resulting
version before further configuration changes. Use a new session when deliberately starting a new
comparison, never to hide losses or reset a paid authorization.

Status remains readable after revocation. Risk-check evaluates the stored virtual account (and
uses a one-unit illustrative fee reserve); it is not a venue quote or execution authorization.
No network or model calls are made by these three commands.

## Accounting and risk

Core owns plain contracts, exact fixed-point arithmetic and risk/fill validation. Infrastructure's
`PostgresPerpsPaperStore` locks the agent and account rows, checks scope/configuration, and records
attempts, movements and position projections atomically. All four new tables use private schema
`pickler` with RLS enabled and no public Data API policies. Internal lease tokens are never included
in DTOs or account status.

Amounts use decimal strings with up to 18 fractional places internally; cash postings round down
to collateral micros, avoiding over-credit or undercharge. Initial capital, fees and realized P&L
are ledger movements. Position margin is a reservation, not an expense. Equity is cash plus open
P&L; available capital uses the lesser of cash and equity, less position margin and pending reserves.
Unknown or stale marks produce unknown equity/availability and block openings.

Policy limits: 100 AUSD opening notional, total exposure at most 50% of equity, full entry-notional
margin (1x), one position per market, 3% daily equity loss, 5% session drawdown, 2% adverse mark stop,
and four-hour maximum holding time. Triggers request controlled exits; they never fabricate fills.
Negative equity/cash is retained, not converted into a synthetic liquidation. Closing a full position
is allowed despite opening-risk blocks. Config/plugin revocation still prevents all new execution.

A single pending attempt per account prevents competing reservations. A request key binds a semantic
intent; replay returns the original result, while changed intent conflicts. Leases last 60 seconds.
Expired attempts become interrupted and release virtual reservations without re-execution. An old
owner cannot finalize. Finalization rechecks permission and risk and consumes the reservation in the
same transaction as cash postings. Failure can release an owned reservation even after revocation.

## Verification

```sh
npm run build:shared
node --import tsx --test packages/trading/test/perps-paper.test.ts packages/infrastructure/test/perps-paper.test.ts
```

Database tests use separate temporary PostgreSQL databases and actual migrations. They exercise
concurrent initialization/reservation, replay, lease expiry, revocation, isolation, full closes and
ledger reconciliation. Fixture fills establish accounting behavior, not Perpl execution fidelity.

## Simulator milestone

Migration 0013 adds immutable observation records. The operator commands now include `open`,
`close`, `tick` and `report`. Mutations require `--key`; opens/closes also require `--symbol BTC|ETH`
and `--side long|short`. They use public GET requests and virtual money only. Run `tick` regularly
while positions are open; a foreground operator command is not a background risk monitor.

```sh
npm run perps:paper --workspace=@pickler/agent-service -- tick --tenant TENANT --agent AGENT --session SESSION --network mainnet --key observation-001
npm run perps:paper --workspace=@pickler/agent-service -- open --tenant TENANT --agent AGENT --session SESSION --network mainnet --key open-001 --symbol BTC --side long
npm run perps:paper --workspace=@pickler/agent-service -- close --tenant TENANT --agent AGENT --session SESSION --network mainnet --key close-001 --symbol BTC --side long
npm run perps:paper --workspace=@pickler/agent-service -- report --tenant TENANT --agent AGENT --session SESSION --network mainnet
```

The agent also needs the explicit `getPerpFundingHistory` Perpl tool permission. Add it before
initializing a new session; old configurations are not silently upgraded. `perpl:data configure`
includes all current data tools when explicitly invoked.

Execution consumes asks for buys and bids for sells, with a 50-bps bound from the best observed
price and venue size precision. Open quantity is conservatively sized from the worst upper price
and the 100-AUSD ceiling. The entire quantity must fit the observed depth or the attempt fails.
There are no resting orders, partial positions or fills at the mark. Public base-tier taker fees
are charged on actual simulated notional. Unsupported negative taker fees fail explicitly.
Open fees cannot exceed their reservation; reducing close fees can debit cash below zero rather
than blocking an exit merely for insufficient capital.

Both ticker and book must have known blocks/times, be at most 30 seconds old, no more than five
seconds ahead, and differ by no more than five seconds. Fill evidence retains the complete normalized
frame, its SHA-256, consumed levels, spread and slippage. Failed fills preserve the observed frame
when available. A 55-second operation deadline fits inside its 60-second lease. Models have no tool
for calling this service directly.

`tick` persists marks and funding before requesting full closes for risk triggers. Failed exits
remain explicit failed attempts; a later observation may deliberately request a new exit. Replaying
an observation key never repeats provider calls or exit processing. Unknown/stale valuation blocks
openings; risk exits still require admissible fresh execution evidence.

The day baseline is the first observed equity around midnight UTC, admitted only within 90 seconds
of midnight with an observation in the preceding 90 seconds. A gap leaves the new baseline unknown
and blocks openings for that day. This sampled laboratory baseline and minute-level stops are not
continuous exchange guarantees. Daily/session breaches latch; changing marks does not undo them.

### Funding model

`getPerpFundingHistory` queries at most four pages of 1,023 published funding intervals under the
existing twelve-request transport session ceiling. It preserves event block, application time,
index, signed rate, source provenance and unresolved estimates. Empty history is incomplete, not
an assumed zero rate. A mature event must be behind the observed chain head and at least 60 seconds
past its application timestamp before this simulator posts it.

The versioned `quantity-index-rate-v1` estimate debits longs and credits shorts for positive rates,
reversing the signs for negative rates. It is not a replica of Perpl's contract funding-sum arithmetic.
Positions participate when `entryBlock < eventBlock <= exitBlock`, with no upper bound while open.
This also reconciles closed positions. Each position/event pair is posted once. If a previously
charged rate, index or application timestamp changes, the account retains a sticky funding dispute,
stops further funding postings and blocks openings; historical ledger entries remain unchanged.
Missing/incomplete history remains pending. Marks-only trusted host refreshes do not claim funding
reconciliation and preserve the previous funding status.

Official semantics: [funding history](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md)
and [funding event identity](https://github.com/PerplFoundation/api-docs/blob/main/types.md).

### Explicit public simulation probe

```sh
node --import tsx apps/agent-service/test/perps-public.probe.ts mainnet UNIQUE_ATTEMPT
node --import tsx apps/agent-service/test/perps-public.probe.ts testnet UNIQUE_ATTEMPT
```

This creates/migrates a disposable PostgreSQL test database, uses only its fixture identities, opens
and closes virtual BTC-long and ETH-short positions against actual public books, and saves private
results/original response hashes before deleting that database. It does not touch existing alpha/beta
agents or sign/send orders. Captures live under `.data/perps-public-probes` in agent-service and
existing attempts are never overwritten. This proves a public-data simulation path, not venue fills,
a long-running funding settlement, profitability or on-chain activity.

### Public acceptance record — 2026-09-28

| Attempt             | Outcome                                                                      | Public GETs | Virtual positions                   | Final virtual cash |
| ------------------- | ---------------------------------------------------------------------------- | ----------- | ----------------------------------- | ------------------ |
| mainnet-20260928-01 | Opens/closes filled; reconciliation rejected a 6-second ticker/book mismatch | 19          | BTC long and ETH short, both closed | 999.853644 AUSD    |
| mainnet-20260928-02 | Complete; no pending funding                                                 | 19          | BTC long and ETH short, both closed | 999.804719 AUSD    |
| testnet-20260928-01 | Complete; no pending funding                                                 | 19          | BTC long and ETH short, both closed | 999.840180 AUSD    |

The first incomplete attempt is preserved; the second was an explicit separate acceptance run,
not an automatic retry. All trades above are virtual, brief round trips rather than strategies.
No position spanned an eligible funding event in these probes; actual funding charges were validated
with controlled histories. No model or on-chain calls occurred.

Private `result.json` SHA-256 values:

- mainnet-20260928-01: `95d9b0ee3b566f72adf14d4f1438d8b7374422de295cae42a9b9a6e7a1b32841`
- mainnet-20260928-02: `849046c21e7436b46bf6c3bc4e5e1f38cf58570fbce095cf1464c6e0fe981b36`
- testnet-20260928-01: `f5507a47e8c6e7d197e2a0d41243ffffbc56cb54f9e01f27d0f8e08439207e48`
