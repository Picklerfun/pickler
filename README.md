# Pickler

A monorepo using npm workspaces, Turborepo, Next.js App Router, and strict TypeScript.

## Development

Use Node 22.22 or newer and npm 10.9.3. Run from the repository root:

```sh
npm ci
npm run dev
```

Web: http://localhost:3000. Liveness endpoint: `/api/v1/health`.

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

## Repository structure

```text
apps/agent-service/         # Local Mastra research pilot (independent of frontend)
apps/web/src/
  app/                      # Presentation: pages and Route Handlers
    api/v1/health/route.ts
  server/container.ts       # Server-only composition and dependency injection
packages/
  core/src/                 # Research, identity and common business contracts
  trading/src/              # Trading rules, financial ports, strategies and evaluation
  infrastructure/src/       # Clock, PostgreSQL, Exa and Polymarket adapters
  api-schema/src/           # Public, serializable HTTP DTOs
  ui/src/                   # Product-independent React components and styles
  chain/src/                # Public types; future ABIs and per-network deployments
  typescript-config/        # Shared TypeScript configuration
contracts/                  # Independent Foundry project
  src/                      # Solidity contracts
  test/                     # Unit, fuzz, and invariant tests
  script/                   # Deployment scripts
```

The web health endpoint remains a liveness check. The independent [agent research pilot](apps/agent-service/README.md) adds tenant-scoped PostgreSQL jobs, Exa research, Polymarket market data and Mastra Studio. It produces research decisions without placing orders. Credentials and the exact compatible model must be configured locally.

```sh
npm run agent -- init
# Fill in apps/agent-service/.env, then:
npm run dev:agent
```

`npm run dev` starts only the frontend. The agent has its own terminal and Studio at `http://127.0.0.1:4111`. Core, trading, infrastructure and API schemas compile to ESM; root development/build/test commands build dependencies in order. Read the [pilot guide](apps/agent-service/README.md) before running paid connection checks or research. The broader [runtime specification](docs/specs/agent-runtime-v1.md) also describes future capabilities outside this pilot.

The landing page reads a snapshot through `GET /api/v1/landing` and accepts signups through `POST /api/v1/waitlist`, which then opens the creator application at `/apply`. The public board lives at `/tokens`, with token, agent, analytics and leaderboard pages beside it. By default it serves sample data (labelled in the footer). To use Supabase, copy `apps/web/.env.example` to `apps/web/.env.local` and set `PICKLER_DATA_SOURCE=supabase`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`, against the hosted project described in `supabase/AGENTS.md`. The health endpoint checks that the application responds; it does not check external dependencies. No wallet or business contracts are connected yet.

See [architecture decisions](docs/architecture.md) and [repository agent instructions](AGENTS.md). Every app and package has its own `AGENTS.md`; read it before working in that project and update it when the project changes. Repository documentation is maintained in English.

## Solidity

The independent Foundry project implements the fixed-supply agent token, authorized launch factory, AUSD bonding curve, permanent Uniswap V4 liquidity custody and fee escrow. Read [the Solidity instructions](contracts/AGENTS.md) for responsibilities, pinned dependencies and validation commands. These commands require Foundry:

```sh
npm run contracts:build
npm run contracts:test
```

On-chain deployments run explicitly, never as a side effect of `build`. Solidity has its own toolchain; contract commands are independent of web tasks. Ordinary contract tests remain offline; explicit fork and testnet acceptance commands are documented separately.

### Verified Monad testnet contracts

The following Pickler contracts were deployed for isolated, faucet-funded acceptance on **Monad testnet (chain ID 10143)**. On **October 10, 2026**, all seven received **exact creation and runtime bytecode matches** in Sourcify. Their live runtime hashes also match the [public acceptance record](docs/market/uniswap-v4-testnet-acceptance.json).

| Contract                       | Deployed address                             | Verified source and ABI                                                                |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `PicklerLaunchFactory`         | `0xD9FFd2Aa682283e3521c7629dBEA24273676559D` | [Sourcify](https://repo.sourcify.dev/10143/0xD9FFd2Aa682283e3521c7629dBEA24273676559D) |
| `PicklerGraduationAdapterV4V2` | `0xB2407b6F624EAdf1B58d0D246727aFCE22147BBE` | [Sourcify](https://repo.sourcify.dev/10143/0xB2407b6F624EAdf1B58d0D246727aFCE22147BBE) |
| `PicklerLiquidityLockerV2`     | `0x94184bE43584d6106E4eeEd20f1BD53784d365FF` | [Sourcify](https://repo.sourcify.dev/10143/0x94184bE43584d6106E4eeEd20f1BD53784d365FF) |
| `PicklerCurveDeployerV4V2`     | `0xE58Ffb0df26F8490E302798B0EDcfB51fc1EE5C0` | [Sourcify](https://repo.sourcify.dev/10143/0xE58Ffb0df26F8490E302798B0EDcfB51fc1EE5C0) |
| `PicklerFeeEscrowV2`           | `0x6a7111eD6F39F0CEBa4ea49A475cb34feDFdB23f` | [Sourcify](https://repo.sourcify.dev/10143/0x6a7111eD6F39F0CEBa4ea49A475cb34feDFdB23f) |
| `PicklerAgentToken`            | `0x066C47CdE99397869809E0DA2d0d4FE40b14B375` | [Sourcify](https://repo.sourcify.dev/10143/0x066C47CdE99397869809E0DA2d0d4FE40b14B375) |
| `PicklerBondingCurve`          | `0xe5E5bb8f99D78c8a290De17C3A0a3c964251c034` | [Sourcify](https://repo.sourcify.dev/10143/0xe5E5bb8f99D78c8a290De17C3A0a3c964251c034) |

Verification reproduced Solidity **0.8.30+commit.73712a01**, optimizer **200 runs**, EVM **Osaka**, the original source paths and IPFS metadata. The token and curve above belong to the acceptance launch; they are not shared addresses for every agent. These are Pickler deployments; the Monad-maintained Uniswap contracts and AUSD are separate external dependencies recorded in [the integration evidence](docs/market/uniswap-v4-testnet-integration.md#verified-external-generation).

The MonadVision Sourcify service also accepted all seven contracts, with runtime-only confirmation for the internally created locker. Public Sourcify confirmed both creation and runtime for that locker. Additional Etherscan/Monadscan forwarding was not confirmed because the upstream service reported its daily submission limit.

The [34 real testnet receipts and remaining activation work](docs/market/uniswap-v4-testnet-integration.md#acceptance-matrix-and-remaining-activation-work) cover launch, curve trades, graduation, Uniswap swaps and fee claims. The test factory was disabled again after acceptance. Hosted Studio/passkey, immutable R2 metadata and indexer acceptance remain pending; mainnet and general launches remain disabled. See [token launch operations](docs/market/token-launch-operations.md) for the configuration and recovery boundaries.

## Formatting

The monorepo uses Prettier for consistent formatting and ESLint for code quality and architecture boundaries. Editor defaults are in `.editorconfig`; configure your editor to use the repository's Prettier installation when formatting on save.

```sh
npm run format
npm run format:check
npm run lint:fix
```

Run `format` after applying lint fixes. The pull request formatting check must pass. Generated output, local databases, environment files and the npm lockfile are excluded. Solidity uses `forge fmt --root contracts --check` separately. See the root `AGENTS.md` for readability conventions.

Trading and plugin ownership: [Trading architecture](docs/trading-architecture.md).
