# Repository instructions

## Read the local instructions first

Before inspecting, reviewing, planning changes to, or editing any app or package, read this file and that project's own `AGENTS.md`. Also read any more specific `AGENTS.md` files along the path to the files you will touch. Repeat this lookup whenever you move into another project, including dependencies affected by a change. Read the current files from disk rather than assuming earlier context is still up to date.

Root instructions apply throughout the repository. Local instructions supplement them within their directory; more specific instructions take precedence within their scope unless they conflict with an explicit user instruction. If an app or package has no local `AGENTS.md`, create one as part of work that establishes or changes that project.

Keep each project's `AGENTS.md` updated in the same change whenever its structure, public exports, responsibilities, commands, or architectural constraints change. Describe the actual implementation and label proposed examples clearly. All repository documentation and agent instructions must be written in English.

## Project map

| Project                      | Responsibility                                        | Required local instructions                       |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `apps/agent-service`         | Local Mastra Studio, API and research worker          | [AGENTS.md](apps/agent-service/AGENTS.md)         |
| `apps/web`                   | Next.js presentation and HTTP entry points            | [AGENTS.md](apps/web/AGENTS.md)                   |
| `workers/api`                | Public API on Cloudflare Workers, ported from Relayer | [AGENTS.md](workers/api/AGENTS.md)                |
| `packages/core`              | Business rules, use cases, and ports                  | [AGENTS.md](packages/core/AGENTS.md)              |
| `packages/infrastructure`    | Implementations of business ports                     | [AGENTS.md](packages/infrastructure/AGENTS.md)    |
| `packages/api-schema`        | Public HTTP DTOs                                      | [AGENTS.md](packages/api-schema/AGENTS.md)        |
| `packages/ui`                | Reusable React components and styles                  | [AGENTS.md](packages/ui/AGENTS.md)                |
| `packages/chain`             | Public blockchain metadata and future generated ABIs  | [AGENTS.md](packages/chain/AGENTS.md)             |
| `packages/typescript-config` | Shared compiler configuration                         | [AGENTS.md](packages/typescript-config/AGENTS.md) |
| `contracts`                  | Foundry/Solidity project                              | [AGENTS.md](contracts/AGENTS.md)                  |
| `supabase`                   | Local Supabase stack configuration                    | [AGENTS.md](supabase/AGENTS.md)                   |

See [README.md](README.md) for setup, [docs/architecture.md](docs/architecture.md) for architectural decisions, and [the agent runtime V1 specification](docs/specs/agent-runtime-v1.md) for the planned Mastra service, capability interfaces, tenant isolation, scheduling, and implementation phases. The research-only subset is implemented; read [the pilot guide](apps/agent-service/README.md) for actual commands, limits and exclusions.

## Architecture invariants

- Maintain three layers: presentation (`apps/web`), business (`packages/core`), and infrastructure (`packages/infrastructure`). Code dependencies point toward business: presentation → business ← infrastructure.
- Each executable app connects concrete adapters with use cases in its own server composition root. Today this is `apps/web/src/server`, protected with `server-only`. The agent service uses `src/composition/container.ts` and a Node server boundary; it must not depend on Next.js-specific guards.
- Keep Next.js, React, transport objects, database clients, and provider SDKs out of core. Use business-owned interfaces and dependency injection.
- Keep HTTP DTOs in `api-schema`; keep public on-chain artifacts in `chain`. Neither package carries credentials or server implementation details.
- Use declared workspace dependencies and public package exports. Do not bypass package boundaries with relative imports into another project's source.
- Drizzle in `packages/infrastructure` owns all database migrations, including product schemas. Use `npm run db:generate` and `npm run db:migrate`; never reset existing schemas to reconcile histories.
- The research runtime uses Mastra, configurable providers and private PostgreSQL persistence. The public frontend and Cloudflare API add Supabase login and product profiles; their agents are not yet linked to research tenants. Manual paper trading is opt-in. Real trading from PR #22 is outside this integration. Read `docs/frontend-integration.md` for current boundaries and the proposed connection. Do not describe controlled tests as live-provider validation.

## Branch and pull request workflow

- Never push directly to `main`, including corrective changes. Do not force-push `main`.
- Create a `codex/` feature branch before committing changes and submit changes through a pull request.
- Do not merge a pull request without explicit user authorization.

## Workflow and checks

Use Node 22.22+ and npm 10.9.3 with the committed lockfile. Install from the root with `npm ci`; use `npm install` when intentionally changing dependencies. Turborepo coordinates workspace tasks. All commands below run from the repository root:

```sh
npm run dev
npm run lint
npm run typecheck
npm run db:up # Local PostgreSQL for integration tests
npm test
npm run build
npm run contracts:build
npm run contracts:test
```

Run checks relevant to the change. Documentation-only changes require checking links, paths, examples, and command accuracy; they do not require a full application build. `npm test` builds shared packages and discovers the core, infrastructure, chain, `workers/api` and agent-service package-root test files; extend discovery when adding other suites. Core, infrastructure and API schemas export compiled ESM from `dist`; run `npm run build:shared` before direct consumers. `npm run dev:agent` does this automatically. The normal `npm run dev` starts only the web app. Foundry commands are separate from the web build and currently have no contracts to compile or test.

Never commit dependencies, build output, secrets, private keys, or local environment files. Keep changes scoped to the request and preserve unrelated work.

## Worktree deletion

- A sub-agent working in a worktree must never delete that worktree. Leave it intact and report its path to the parent.
- The main agent must ask for confirmation before removing a worktree that is its current working directory.
- From the repository root, the main agent may clean up only worktrees it created, never another agent's or user's worktree.

## Code formatting and readability

Use the root Prettier configuration for TypeScript, JavaScript, JSON, CSS, YAML and Markdown: two spaces, a 100-column print-width target, double quotes, semicolons and trailing commas. `.editorconfig` supplies matching editor defaults. Generated output, local data, environment files and the npm lockfile are excluded from Prettier. Solidity remains formatted by Foundry.

Run `npm run format` to format files and `npm run format:check` to verify them. Pull requests run the format check in GitHub Actions. `npm run lint:fix` applies supported ESLint fixes, including required braces on all conditional and loop bodies. Run formatting after lint fixes. ESLint retains the architecture restrictions; Prettier handles layout.

Write one statement per line and separate logical phases with blank lines. Expand schemas, transaction blocks and complex callbacks for readability. Prefer named predicates or explicit branches over nested ternaries. Write long SQL queries as multiline template literals without changing query semantics or parameter order. Separate test setup, action and assertions visually. Keep formatting-only changes distinguishable from behavior changes; do not add abstractions solely to satisfy a line-length target.

PostgreSQL is hosted by Supabase in deployed environments. Drizzle and database clients belong only in infrastructure. Use direct or session-pooler connections. Research ownership uses renewable per-run leases; concurrency admission uses a short transaction. Never expose `pickler`, `pickler_migrations`, or `mastra` through the Supabase Data API. Local PostgreSQL runs through `compose.yaml`; credentials there are disposable local development values only.

The full local Supabase stack is configured in `supabase/config.toml`; read `supabase/AGENTS.md` before changing it. Use `npm run supabase:start` and `npm run test:supabase` for the Supabase-specific integration run. Its database uses port 54522; the PostgreSQL-only Docker alternative uses 55432.

Manual paper trading is an opt-in plugin, with no model-executable tool. Read [the simulation guide](apps/agent-service/PAPER-TRADING.md) for permissions, reservations and exclusions.
