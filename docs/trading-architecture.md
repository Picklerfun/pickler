# Trading architecture

This is the current ownership and dependency contract. Historical validation documents describe
past runs; they do not authorize execution or supersede this guide.

```mermaid
flowchart TD
  Host[CLI and existing hosts] --> Runtime[agent-runtime: plugins and model adapters]
  Runtime --> Trading[trading: strategies, risk, simulation and evaluation]
  Runtime --> Infrastructure[infrastructure: providers and persistence]
  Infrastructure --> Trading
  Trading --> Core[core: identity, permissions and common market contracts]
```

## One business implementation

`@pickler/trading/polymarket` owns live execution contracts, paper fills and settlement.
`@pickler/trading/perps` owns virtual perpetual accounts, exact arithmetic, margin, funding and
risk. `@pickler/trading/strategies` owns binary study/benchmark policies.
`@pickler/trading/evaluation` owns protocol admission, model ports, perpetual rounds, prospective
BTC scheduling and historical reconciliation. It accepts data, models, repositories, clocks,
cancellation and persistence callbacks. It does not import Node, transport, Mastra or storage.

Core retains identity, agent configuration, plugin permissions, research and public market-data
contracts. It never imports trading. Runtime owns prompts and composes capability adapters.
Infrastructure implements business ports with transactions, leases, HTTP and database access.
API-schema remains portable DTOs, independent from business implementations.

Hosts adapt arguments, environment, files, process signals and report rendering. They freeze
configuration, supply persistence and invoke the shared engine. The local hosts still supply
protocol-specific configuration checks and artifact IO; this is not a deployed web evaluation API.

```mermaid
flowchart LR
  Data[Perpl data plugin] --> Evidence[Evidence and isolated account]
  Evidence --> Strategy[Rules or model strategy]
  Strategy --> Proposal[Proposal]
  Proposal --> Risk[Trading risk and sizing]
  Risk --> Execution[Execution adapter]
  Execution --> Ledger[Persisted account and evidence]
```

Binary and perpetual strategies use separate types and accounting. An execution adapter cannot
turn simulated margin into exchange margin rules. Models never control capital, risk limits,
credentials or repositories. Manual operations and evaluations reuse the same business services.
The existing real-trading signer remains confined to its existing host with admissions unchanged.

## Plugins

Each existing ID has a directory under `packages/agent-runtime/src/plugins` and one factory entry.
Core owns the declarative catalog; runtime binds identities to factories without duplicating it.
Research factories expose only injected read capabilities. Execution factories expose operator
services, never model execution tools. Jev and DeepSeek remain model providers, not added IDs.

To add a strategy, define its versioned policy and typed inputs in trading, inject model/data
ports if required, register its evaluation protocol, and replay existing captured inputs. To add
a plugin, update the core catalog, implement its runtime factory and infrastructure adapters,
and test exact registration, permissions and absence of disabled tools. Do not copy risk or
accounting into either a plugin or a host.

## Compatibility and validation

Persisted IDs, versions, prompts, balances, reservations and migrations are unchanged. No schema
migration, automatic restart, paid acceptance, deployment or new live-order authorization is
part of this extraction. Unknown costs retain reservations. Historical STOP files remain intact.

[Evaluation operations](../apps/agent-service/EVALUATIONS.md) documents the sole evaluation CLI.
Run `npm run check:architecture`, root tests (including isolated PostgreSQL), types, lint,
format and shared/service/Worker builds before publishing changes. Controlled replay establishes
compatibility, not provider reliability or profitability.
