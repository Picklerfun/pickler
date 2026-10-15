> Trading and evaluation ownership is defined in [Trading architecture](trading-architecture.md).

# Architecture

## Three layers and dependency direction

1. **Presentation** (`apps/web`): pages and an HTTP facade to the authenticated API. It does not import business or infrastructure packages.
2. **Business** (`packages/core` and `packages/trading`): core owns research, identity and shared contracts; trading owns financial rules, execution ports and evaluation. Trading depends on core, never the reverse.
3. **Infrastructure** (`packages/infrastructure`): repositories and provider adapters implement the business ports. Business never imports infrastructure.

Hono composes adapters in `workers/api/src/container.ts`; the research/trading Workers retain their
own scoped composition. `apps/web/src/server` is an HTTP client facade. Agent-runtime composes shared
plugins and models; the local evaluation host supplies files, process signals and reports to the
portable trading engine. Read [Trading architecture](trading-architecture.md) for the dependency graph.

`api-schema` contains public HTTP contracts only. `ui` knows nothing about use cases, authentication, wallets, or providers. Keep interactive client boundaries small instead of making the entire UI library client-only.

## Next.js

Use App Router, Server Components by default, and Node.js Route Handlers. Server Components can call the server facade directly without making an HTTP request to their own API. Clients and external consumers use `/api/v1/*`. Use cases receive plain data and verified identity, never `NextRequest`, cookies, or framework session objects.

As business operations are introduced, add runtime validation for inputs and external responses, use-case authorization, typed errors, and a shared HTTP error mapper. Do not expose internal exception details. Choose caching explicitly for each endpoint; health currently returns `no-store`.

See [the web app instructions](../apps/web/AGENTS.md) for a folder example and a walkthrough of the existing three-layer implementation.

## External services

Define a port for each required business capability, such as `PaymentGateway`, then implement an adapter after choosing a provider. Avoid a generic abstraction for unrelated providers. Configuration and credentials stay on the server; only public values may use `NEXT_PUBLIC_*`.

Adapters should provide timeouts, response validation, and normalized errors. Retry only safe operations or operations protected by idempotency keys. Verify webhook signatures against the original body and deduplicate events. Introduce a separate worker for long-running tasks or indexers when required; do not keep a Next.js request running indefinitely.

## On-chain boundary

`contracts` is the source of truth for Solidity code. Once contracts exist, generate ABIs from compiler artifacts into `packages/chain`, rather than copying them manually. Record addresses and deployment blocks by chain ID and contract version. Public packages must not contain private keys or credential-bearing RPC URLs.

Server-side reads use infrastructure adapters implementing business ports. Wallet connection and user signing belong to the frontend and must never require sending the user's private key to the backend. Operational server signing, if required, needs an explicit custody and permissions design.

A submitted transaction is not a finalized operation. When implementing writes, model pending, confirmed, and failed states; account for network-specific confirmations, replacements, and reorganizations. Deduplicate events by network, transaction hash, and log index. Off-chain storage and blockchain writes are not atomic: introduce persistent state, idempotency, and reconciliation when these operations are added.

Monad remains the launcher direction; its on-chain contracts are outside the research pilot. The optional local Polymarket execution adapter is a separate Node capability, not a research tool.

## Independent agent service

`apps/agent-service` hosts Mastra Studio, local token-authenticated HTTP routes and a separate supervised worker. `src/composition/container.ts` injects Exa, Polymarket, PostgreSQL and a configured Mastra model adapter into the framework-independent research runner. The web frontend is unchanged.

Core owns profiles, capability ports, config validation, schedule/quota policy and research orchestration. Infrastructure performs scoped PostgreSQL transactions, durable job claims and provider response normalization. Runtime DTO validation lives in `api-schema`. Studio and HTTP enqueue the same persistent jobs; the worker handles manual and periodic jobs with the same runner. Raw model agents are not exposed as an alternative execution path.

PostgreSQL stores each tenant's configuration and history, including config snapshots and partial evidence. A short policy-row transaction enforces global/per-tenant capacity, renewable per-run leases fence execution and writes, a partial unique index prevents simultaneous work per agent, and persistent occurrence keys deduplicate schedules. Recovery only interrupts expired leases. The operator supplies separate local tenant tokens; Studio is privileged loopback tooling, not production authentication. External content and model outputs cannot choose tenant scope or enable tools.

See [the pilot guide](../apps/agent-service/README.md) for current endpoints, limits, readiness and restart semantics. [Runtime V1](specs/agent-runtime-v1.md) remains the broader direction; public login and adaptive scheduling are not implemented. Manual paper trading is available; the disabled local trading pilot adds explicit operator wallet setup and a dedicated execution adapter. See [the trading guide](../apps/agent-service/LIVE-TRADING.md) for custody, permissions, persistence and pending live acceptance.

The network, contracts, authorization rules, and confirmation policy remain undefined. No blockchain SDK or RPC provider has been provisioned.

## Data storage

Supabase Postgres (project `pickler`) holds one schema per domain: `identity`, `agents`, `budget`, `audit`, `growth` (see `supabase/AGENTS.md`). Servers reach it with a server-only secret key, through tables or `security definer` functions (the waitlist uses `growth.join_waitlist`); tables have row-level security enabled with no public policies. Agent tokens are modelled in `market` (see [market/token-launch.md](market/token-launch.md)); landing and agent board data stay sample content until the indexer fills it. Adapters use plain `fetch`, so they also run on Cloudflare Workers. Redis is not used; add it only as a cache behind the same port if measured load requires it. Without Supabase configuration the app serves labelled sample data.

## Future backend extraction

The existing `workers/api` composes core, trading, infrastructure and API schemas. New transports must reuse those business services and preserve authentication, admission and budgets. No additional evaluation transport is enabled by the trading extraction.

Core, infrastructure and API-schema expose compiled ESM runtime exports and source type declarations. Their build configurations emit `dist`, and package file lists include those artifacts for Mastra packaging. UI and chain retain source exports. Root Turborepo builds dependencies before their consumers.

## Validation and documentation

Turborepo coordinates builds and type checks. ESLint checks conventions and import boundaries. Tests cover the health use case, tenant HTTP authorization, a Mastra tool/structured-output transport fixture, provider contracts, durable PostgreSQL scheduling and research decisions. Provider test fixtures never stand in for a live connection check. Solidity requires unit, fuzz, and invariant testing before deployment; current contract directories are empty.

Read the root and relevant project `AGENTS.md` before working in any project. Update local instructions alongside changes to structure, exports, commands, or responsibilities. Keep documentation in English and distinguish working code from proposed examples.

References: [Next.js backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend), [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Turborepo internal packages](https://turborepo.dev/docs/core-concepts/internal-packages).

## Agent-owned X authorization

[Studio X OAuth](studio-x-oauth.md) replaces proof posts with confidential OAuth2 PKCE. Supabase
identity remains authoritative. Core coordinates read-only linking and publication, infrastructure
owns private encrypted tokens and resource reservations, API composes JWT-owner routes plus one
state/cookie callback, and Web presents consent/manual posts. X content never reaches the trading
engine or public feed. Publication/disconnect/refresh share transaction fences; old public agents
keep visibility. The old proof-post specifications are historical.
