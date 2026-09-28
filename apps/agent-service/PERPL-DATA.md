# Perpl public data plugin

Perpl plugin 1.0.0 provides BTC/ETH public perpetual data through the Pickler harness. It is
opt-in per tenant/agent, independent of the Polymarket research workflow, and disabled in historical
defaults. It supports mainnet (chain 143, default when configuring) and testnet (chain 10143).

This is the data milestone: no model invocation, account lookup, wallet, balance allocation,
position management, order submission, simulation, or live strategy is implemented here. It does
not yet satisfy the bounty's real on-chain trading requirement. Existing web demo market data is
unchanged; these decimal contracts are separate from prediction-market probabilities.

## Enable and inspect

Run from the repository root with Node 22.22+ and the committed npm lockfile. Build shared exports
first. The commands use `apps/agent-service/.env` (or the process environment) for `DATABASE_URL`;
no model or Perpl API credential is required. Use a local/operator database connection, not a public
HTTP endpoint. Existing tenant and agent records must already exist. These commands never migrate
or seed the database.

```sh
npm run build:shared
npm run perpl:data --workspace=@pickler/agent-service -- --help
npm run perpl:data --workspace=@pickler/agent-service -- configure --tenant TENANT --agent AGENT --expected-version 3 --network mainnet --markets BTC,ETH
npm run perpl:data --workspace=@pickler/agent-service -- check --tenant TENANT --agent AGENT
npm run perpl:data --workspace=@pickler/agent-service -- capture --tenant TENANT --agent AGENT --attempt mainnet-001
```

Replace the IDs and expected version with actual stored values. `configure` preserves other
configuration fields, adds the plugin and its four tools, uses optimistic version checking, and
**disables scheduling** through the existing config update policy. It returns the resulting version
and schedule state. It does not enable scheduled perps research. Use `--network testnet` to configure
a separate agent or explicitly change an existing one. `check` and `capture` always use stored
configuration; they cannot override network or permitted markets.

`capture` defaults to `.data/perpl` relative to the command's working directory (npm workspace
commands run in `apps/agent-service`). `--directory` may specify an absolute private directory.
Every attempt creates a new directory; existing attempts are rejected. Files are mode 0600 and
new directories 0700. Keep captures private and ignored by Git.

## Harness contract

`@pickler/agent-runtime/composition/perpl` exports `createPerplSession(repository, scope, signal)`.
It returns a guarded service and four Mastra read tools. Runtime composition exposes the same
session through `runtime.perpl(scope, signal)` and the public context check through
`checkPlugin(scope, "perpl")`. No Perpl tools are injected into Polymarket research.

| Tool               | Data                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `listPerpMarkets`  | Allowed BTC/ETH identifiers, exchange/collateral, precision, configuration and base-tier fees |
| `getPerpSnapshot`  | Separate mark, index, last, bid/ask, open interest and funding components                     |
| `getPerpOrderBook` | Best-first L2 snapshot; 20 levels by default, maximum 100 per side                            |
| `getPerpCandles`   | Aligned `[from,to)` Unix-millisecond range, at most 1,024 intervals                           |

Core owns `PerpMarketData`, configuration and permission guards. Infrastructure owns public REST
transport and normalization. API-schema owns portable DTOs; runtime owns Mastra tool composition;
agent-service owns the operator CLI and filesystem evidence. Provider/clock injection is for
trusted host tests only and is never configurable by agents.

Each session pins the configuration version. Tenant/agent identity, enabled plugin/tool and allowed
market are checked before and after operations, including cached reads and each network request.
The scope comes from the host, never model arguments. A version change stops use of that session.
These sessions are operator-driven and do not grant research jobs, monetary budgets or trading
permissions. The bounded session must not be recreated automatically to bypass its request cap.

## Data meaning and limits

- IDs and decimals are discovered from public context, never hard-coded. Empty BTC symbols require
  corroborating name and size unit. Ambiguous identities or wrong chain IDs fail closed.
- Prices, sizes, volumes and rates are exact decimal strings. Unsafe JSON numeric integers fail
  validation. Candle volume is in collateral units; open interest and book size use base units.
- Funding retains the published interval (which need not be one hour), application timestamp/block,
  and whether its application block is ahead of the context chain head. Missing funding is null.
  Funding and ticker timestamps are independent; no annualization or hourly conversion is implied.
- Fees are the published base tier, not account-specific fees. Margin parameters remain raw because
  documentation units need separate verification before deriving leverage or liquidation rules.
- Provenance records network, chain, URL, received time, provider time/block and plugin version.
  Unknown time/block is null. Ticker/book data older than 30 seconds is marked stale; more than five
  seconds in the future is rejected. A future funding application time is allowed.
- Empty books stay empty; depth is always marked limited. No guaranteed fill or slippage estimate.
- Candle gaps are reported, never filled. Current candles are flagged open. Invalid OHLC, duplicate
  timestamps and out-of-range data fail rather than being silently corrected. Supported resolutions
  in seconds: 60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400.
- Context alone is cached for 30 seconds per adapter/network. Ticker and book are not cached.
- Only fixed official HTTPS hosts are used. Requests are GET-only, redirects rejected, body capped
  at 2 MiB and timeout at 10 seconds. One request runs at a time, starts are at least one second
  apart, and a session permits at most 12 requests. No retries or background polling.
- `capture` normally makes seven requests: context and ticker/book/24 closed hourly candles per
  market. It stops on the first failure and preserves an incomplete manifest. Stale data or candle
  gaps remain visible even when transport capture completes; complete does not mean trade-ready.

Evidence includes original JSON bodies, normalized files, SHA-256 hashes, URL/receipt times, exact
agent configuration/version, summary and completion/failure status. HTTP/transport failures retain
safe error codes; no raw error body is logged. Abrupt process termination may leave `started` and
partial files; never overwrite them. There are no paid calls or automatic repairs.

## Verification

```sh
npm run build:shared
node --import tsx --test apps/agent-service/test/perpl-data.test.ts
```

The automated suite uses controlled provider fixtures. Explicit public acceptance probes use an
in-memory verification agent and the actual same session/capture implementation, without loading
`.env`, opening a database or changing a real agent's configuration:

```sh
node --import tsx apps/agent-service/test/perpl-public.probe.ts mainnet mainnet-UNIQUE
node --import tsx apps/agent-service/test/perpl-public.probe.ts testnet testnet-UNIQUE
```

These commands make real public GET requests and save evidence under
`apps/agent-service/.data/perpl-public-probes`. They do not establish authenticated account access,
on-chain execution, strategy profitability, persistent tenant enablement or deployed readiness.

Official contracts: [REST endpoints](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md),
[wire types](https://github.com/PerplFoundation/api-docs/blob/main/types.md), and
[developer documentation](https://docs.perpl.xyz/resources/for-developers).

## Public acceptance record — 2026-09-28

The explicit probes completed using this implementation and ephemeral verification identities:

| Network | Market | Ticker/book | Book bid/ask levels | Closed 1h candles | Missing |
| ------- | ------ | ----------- | ------------------- | ----------------- | ------- |
| Mainnet | BTC    | Fresh/fresh | 20/20               | 24                | 0       |
| Mainnet | ETH    | Fresh/fresh | 20/14               | 24                | 0       |
| Testnet | BTC    | Fresh/fresh | 20/20               | 24                | 0       |
| Testnet | ETH    | Fresh/fresh | 9/8                 | 24                | 0       |

Both complete captures used seven GET requests. The first mainnet attempt stopped after four:
the provider rounded an upper candle bound of `to - 1ms` up and returned the next candle. The
adapter now requests the last desired open time (`to - resolution`), retaining strict range
validation. That failed attempt remains intact. In total verification made 18 public requests,
zero model calls and zero on-chain transactions. These are point-in-time observations.

Private manifest SHA-256 values (raw captures are excluded from Git):

- `mainnet-20260928-01` (incomplete): `24414ea4c0596fcc0e80f42c67d5f2d6bae9526b4bbd9c8855cb238bfdd3c1db`
- `mainnet-20260928-02` (complete): `07697884d10cece43e2f02781e27c4dfcb9b11c960af227d3716de62173072b0`
- `testnet-20260928-01` (complete): `17f4dbba2ae5befdca72d17d7bd5ae737e86417a53631c4e8227c5ea6639d667`
