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
  core/src/                 # Business: domain, use cases, and ports
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

`npm run dev` starts only the frontend. The agent has its own terminal and Studio at `http://127.0.0.1:4111`. Core, infrastructure and API schemas compile to ESM; root development/build/test commands build dependencies in order. Read the [pilot guide](apps/agent-service/README.md) before running paid connection checks or research. The broader [runtime specification](docs/specs/agent-runtime-v1.md) also describes future capabilities outside this pilot.

The landing page reads a snapshot through `GET /api/v1/landing` and accepts signups through `POST /api/v1/waitlist`, which then opens the creator application at `/apply`. The public board lives at `/tokens`, with token, agent, analytics and leaderboard pages beside it. By default it serves sample data (labelled in the footer). To use Supabase, copy `apps/web/.env.example` to `apps/web/.env.local` and set `PICKLER_DATA_SOURCE=supabase`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`, against the hosted project described in `supabase/AGENTS.md`. The health endpoint checks that the application responds; it does not check external dependencies. No wallet or business contracts are connected yet.

See [architecture decisions](docs/architecture.md) and [repository agent instructions](AGENTS.md). Every app and package has its own `AGENTS.md`; read it before working in that project and update it when the project changes. Repository documentation is maintained in English.

## Solidity

Foundry configuration and directories are included. Contracts remain undefined until their business rules, permissions, and target network are established. These commands require Foundry:

```sh
npm run contracts:build
npm run contracts:test
```

On-chain deployments run explicitly, never as a side effect of `build`. Solidity has its own toolchain; contract commands are independent of web tasks. The current source and test directories are empty.

## Formatting

The monorepo uses Prettier for consistent formatting and ESLint for code quality and architecture boundaries. Editor defaults are in `.editorconfig`; configure your editor to use the repository's Prettier installation when formatting on save.

```sh
npm run format
npm run format:check
npm run lint:fix
```

Run `format` after applying lint fixes. The pull request formatting check must pass. Generated output, local databases, environment files and the npm lockfile are excluded. Solidity uses `forge fmt --root contracts --check` separately. See the root `AGENTS.md` for readability conventions.
