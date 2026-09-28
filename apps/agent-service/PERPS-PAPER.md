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
node --import tsx --test packages/core/test/perps-paper.test.ts packages/infrastructure/test/perps-paper.test.ts
```

Database tests use separate temporary PostgreSQL databases and actual migrations. They exercise
concurrent initialization/reservation, replay, lease expiry, revocation, isolation, full closes and
ledger reconciliation. Fixture fills establish accounting behavior, not Perpl execution fidelity.
