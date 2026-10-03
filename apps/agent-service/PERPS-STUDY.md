# Prospective perpetual comparison

This local operator laboratory compares independent `rules`, `deepseek`, and `jev` agents on
Perpl BTC/ETH. Each dedicated agent has 1,000 **virtual AUSD**, its own paper account and the same
versioned conservative 1x risk policy. Model spending is recorded separately in **USD**. There is
no exchange wallet, signing, actual order, liquidation, web interface or deployment.

## Preparation

Use Node 22.22+ and the repository lockfile. Apply the infrastructure-owned Drizzle migrations
explicitly to the intended private local PostgreSQL database, then build shared packages:

```sh
DATABASE_MIGRATION_URL=... npm run db:migrate
npm run build:shared
npm run evaluate -- --help
```

Startup does not apply migrations or seed alpha/beta. `init` creates exactly three dedicated agents
under the specified tenant identifier, with Perpl and perpetual-paper plugins and all five data
permissions enabled. Their schedules stay disabled. Existing agents and studies are not modified.
Initialization is idempotent only when configuration and protocol metadata match exactly.

Save this reviewed configuration in an ignored private file. Replace the session and tenant with
explicit identifiers. Recheck official tariffs before a paid start; never change a started session's
model, instructions, pricing or capital. A new session is a new experiment, not additional spending
authorization. The operator must not create multiple sessions to evade the agreed total budget.

```json
{
  "version": 1,
  "protocol": "perps-comparison-v1",
  "tenantId": "perps-lab",
  "sessionId": "comparison-20260928",
  "network": "mainnet",
  "hours": 24,
  "budgetUsd": "5",
  "deepseek": {
    "model": "deepseek-v4.1-flash",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "inputPerMillion": "0.30",
    "outputPerMillion": "1.20"
  },
  "jev": {
    "model": "jev-1.13.0",
    "inputPerMillion": "0.042",
    "outputPerMillion": "0"
  },
  "pricingVerifiedAt": "2026-09-28T16:35:00Z",
  "pricingSources": [
    "https://www.alibabacloud.com/help/en/model-studio/deepseek-v4-1-flash",
    "https://docs.typesafe.ai/models"
  ]
}
```

The example uses the September 28, 2026 Singapore international **busy-hour** tariff, ignoring
cache discounts and idle-hour reductions. Usage-based costs are conservative estimates, not actual
billing invoices. Jev output tokens are recorded but have a zero tariff. No AUSD/USD conversion is
assumed. The config review must be within seven days at run/resume time.

The private environment file must contain `DATABASE_URL`, `MODEL_API_KEY`, `MODEL_ID`,
`MODEL_BASE_URL` and `TYPESAFE_API_KEY`. Model ID/base URL must match the frozen config. No key belongs
in JSON configuration, reports, source control or command arguments.

```sh
npm run evaluate -- prepare --config /absolute/private/study.json --env-file /absolute/private/study.env
npm run evaluate -- preflight --config /absolute/private/study.json --env-file /absolute/private/study.env
npm run evaluate -- run --config /absolute/private/study.json --env-file /absolute/private/study.env --allow-paid
```

`preflight` reads public market data and authenticated model catalogs; it does not perform inference.
Catalog availability does not establish paid-provider acceptance or validate a trading strategy.
The runner is a foreground local process. Keep the host awake and PostgreSQL available.

```sh
npm run evaluate -- resume --config /absolute/private/study.json --env-file /absolute/private/study.env --allow-paid
npm run evaluate -- stop --config /absolute/private/study.json --env-file /absolute/private/study.env
npm run evaluate -- report --config /absolute/private/study.json --env-file /absolute/private/study.env --output /absolute/private/report
```

`stop` durably ends the decision window and allows up to 15 minutes of controlled exits. An active
runner must process those exits. SIGINT/SIGTERM interrupts the process; it does not fabricate fills
or reset state. Resume retains the original end, capital and budget. Expired study leases recover
started rounds as interrupted without repeating calls. Incomplete post-model execution also stops
new decisions. An unstarted stopped session cannot be run.

## Protocol

- Observe public data every minute; decide once per 15-minute slot, during its first minute. Missed
  slots are not reconstructed. The initial and hourly-refreshed inputs contain 60 closed hourly
  candles. All three agents receive the same immutable market packet and their own saved portfolio.
- Rules use SMA20/SMA50 and a strict 0.1% gap; unknown or discontinuous candles imply hold. A position
  closes when a valid signal no longer supports it. No same-round reversal, including risk exits.
- DeepSeek returns only the two asset proposals: hold, open-long, open-short or close, with evidence
  references. Code owns quantity, capital, leverage, risk and execution.
- Jev's new perpetual sufficiency prompt permits a skip only for coherent insufficiency, material
  missing/conflicting evidence and matching scope, with every confidence/selected probability at
  least 0.98. Other valid answers use one blind DeepSeek call with the identical direct prompt.
  This is a new experimental routing protocol, not previously validated Polymarket behavior.
- Run direct and routed arms in parallel; each HTTP call has a 20-second deadline and the model
  phase has 45 seconds. No automatic retries, repair, model replacement or malformed-output hold.
- Reserve both DeepSeek calls and Jev before either arm starts. At the example tariffs the maximum
  reservation is USD 0.051904512 per round: 65,536 input tokens per call, 4,096 output tokens per
  DeepSeek call, free Jev output. Ninety-six maximum reservations total USD 4.982833152.
- Requests are limited to 30,000 UTF-8 bytes and responses to 1 MiB. Persist call start and request
  hash before HTTP; persist verified usage before interpreting output. Unknown usage retains the
  reservation. Any model failure stops new decisions for **all three** strategies; observations and
  independent risk exits continue. No external investigation costs are included.
- After successful proposals, obtain common fresh books and tickers. Each strategy uses those same
  levels as an independent scenario. Refresh marks, recheck risk and apply the existing full-fill
  simulator. A fill/rejection is durable and attributable; do not sum liquidity across scenarios.
- At the end, permanently close account admissions and attempt full exits for up to 15 minutes.
  Missing public data can prevent exits. Remaining positions and funding discrepancies stay visible.

See [PERPS-PAPER.md](PERPS-PAPER.md) for exact margin, mark freshness, stop, execution and funding
semantics. Funding is a versioned laboratory estimate; the account does not reproduce contractual
margin or liquidation mechanics. Risk stops are sampled and do not guarantee an exit price.

## Persistence and reports

Migration 0014 adds private RLS-enabled study, round and event tables. Study identity is tenant,
session and network; every lane/portfolio maps to its dedicated agent. The 90-second study lease
renews every 20 seconds; paper transactions retain their own 60-second fenced attempts. Agent
configuration and permissions are checked throughout. Models receive no repository, credentials,
lease, configuration controls or executable trading tools.

`report` regenerates JSON, HTML and CSV from PostgreSQL. It includes independent equity/cash,
return, sampled drawdown/exposure, filled/rejected attempts, risk exits, pending funding, virtual
fees/funding/P&L, spread/slippage diagnostics, model usage costs, latency, incomplete rounds and
unobserved time beyond a 90-second observation tolerance. Spread/slippage diagnostics are already
embedded in fill prices and must not be subtracted from P&L a second time. The exported metadata
contains the complete pinned prompts and hashes. Private rounds preserve normalized market data,
source identifiers, each agent's original portfolio and accepted model output.

Missing rounds, unknown costs, open final positions, unresolved funding, interrupted executions or
observation gaps prevent a complete comparison. Reports do not rank profitability. A no-trade run
can validate operation only; twenty-four hours cannot demonstrate profitability. Real on-chain
activity required by the bounty is a separate future signer/custody/execution deliverable.

## Controlled acceptance

`test/perps-study.test.ts` uses real isolated PostgreSQL and simulated model/public transports.
It covers concurrency, unique credits, scope separation, fixed model/cost records, lease recovery,
unknown charge reservations, both-arm budget rejection, blind inputs, malformed output without
retry, Jev routing, deadlines, baseline fills and risk supervision after a model failure. It also
checks admission closure, missing observations and interrupted execution. These tests perform no
paid inference and establish no live strategy performance.

Acceptance checkpoint (September 28, 2026): the full suite passed 452 tests, with zero failures and
one opt-in integration test skipped; ten focused comparison tests passed. Type, lint, formatting,
shared-library, service and Worker builds passed. Public preflight returned 60 closed candles per
asset and both configured model catalogs without paid inference. This checkpoint is not a completed
24-hour prospective result; session output remains private and is reported separately.

## Continuations and rejected data

The USD 5 ceiling covers all sessions in the same tenant/network/database, including historical
costs and reservations. A new session does not renew authorization. Unknown started usage in an
older session stops admission with `CAMPAIGN_USAGE_UNVERIFIED`. Do not change scope or database
to bypass that authorization. Trading returns and per-session model costs remain separate.

The engine validates frames again after candle preparation and before paying models. It retains
common refreshed execution frames in `execution-input` events even if the simulator rejects them.
Inspect provider timestamps, blocks and hashes there; a historical error without a saved execution
frame is not enough to establish its root cause. No timestamp is rewritten and no retry is added.

Paper acquisition reads the book before the ticker to reduce added delay when ticker state lags.
This does not guarantee synchronized exchange data. Both provider timestamps must still satisfy
the unchanged bounds; failed public captures and interrupted studies remain evidence, not passes.

## Four-way successor

The separate two-hour version 2 protocol is documented in [PERPS-FOUR-WAY.md](PERPS-FOUR-WAY.md). Legacy records retain their original three-arm interpretation and budget reservations.
