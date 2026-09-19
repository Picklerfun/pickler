# Architecture

## Three layers and dependency direction

1. **Presentation** (`apps/web`): pages, product-specific components, and HTTP adapters. Route Handlers validate input, obtain authenticated identity, call a use case, and map its result to a DTO and HTTP status. They do not contain business rules or direct provider calls.
2. **Business** (`packages/core`): entities, rules, use cases, and ports for persistence, external services, and blockchain operations. No Next.js, React, ORM, or provider SDK imports. The current layout has `domain`, `application`, and `ports`; organize future business features under `features/<feature>/{domain,application,ports}` when needed.
3. **Infrastructure** (`packages/infrastructure`): implementations of the ports, including repositories and provider/RPC adapters. Infrastructure depends on business; business never depends on infrastructure.

Runtime flow is HTTP → use case → adapter. Code dependencies are inverted through interfaces: presentation → business ← infrastructure. `apps/web/src/server/container.ts` is the current composition root, protected by `server-only`. The independent agent service has its own server composition root at `src/composition/container.ts`; both hosts consume the same business ports and rules. ESLint checks direct imports across key boundaries; these checks are guardrails, not a substitute for reviewing transitive dependencies. Next.js rejects importing the protected server boundary into a Client Component.

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

Monad remains the launcher direction; on-chain contracts, wallets and trading execution are outside the research pilot.

## Independent agent service

`apps/agent-service` hosts Mastra Studio, local token-authenticated HTTP routes and a separate supervised worker. `src/composition/container.ts` injects Exa, Polymarket, PostgreSQL and a configured Mastra model adapter into the framework-independent research runner. The web frontend is unchanged.

Core owns profiles, capability ports, config validation, schedule/quota policy and research orchestration. Infrastructure performs scoped PostgreSQL transactions, durable job claims and provider response normalization. Runtime DTO validation lives in `api-schema`. Studio and HTTP enqueue the same persistent jobs; the worker handles manual and periodic jobs with the same runner. Raw model agents are not exposed as an alternative execution path.

PostgreSQL stores each tenant's configuration and history, including config snapshots and partial evidence. A short policy-row transaction enforces global/per-tenant capacity, renewable per-run leases fence execution and writes, a partial unique index prevents simultaneous work per agent, and persistent occurrence keys deduplicate schedules. Recovery only interrupts expired leases. The operator supplies separate local tenant tokens; Studio is privileged loopback tooling, not production authentication. External content and model outputs cannot choose tenant scope or enable tools.

See [the pilot guide](../apps/agent-service/README.md) for current endpoints, limits, readiness and restart semantics. [Runtime V1](specs/agent-runtime-v1.md) remains the broader direction; paper/live trading, wallets, public login and adaptive scheduling are not implemented.

The network, contracts, authorization rules, and confirmation policy remain undefined. No blockchain SDK or RPC provider has been provisioned.

## Data storage

Supabase Postgres (project `pickler`) holds one schema per domain: `identity`, `agents`, `budget`, `audit`, `growth` (see `supabase/AGENTS.md`). Servers reach it with a server-only secret key, through tables or `security definer` functions (the waitlist uses `growth.join_waitlist`); tables have row-level security enabled with no public policies. Agent tokens are modelled in `market` (see [market/token-launch.md](market/token-launch.md)); landing and agent board data stay sample content until the indexer fills it. Adapters use plain `fetch`, so they also run on Cloudflare Workers. Redis is not used; add it only as a cache behind the same port if measured load requires it. Without Supabase configuration the app serves labelled sample data.

## Future backend extraction

Create `apps/api` when needed. It will consume the same `core`, `infrastructure`, and `api-schema` packages, provide its own composition root, and expose the same `/api/v1` contract. Next.js can retain a facade or consume the new backend over HTTP. Use cases remain unchanged; transport, sessions, configuration, and deployment still need adaptation. Do not create an extra process merely to simulate a future migration.

Core, infrastructure and API-schema expose compiled ESM runtime exports and source type declarations. Their build configurations emit `dist`, and package file lists include those artifacts for Mastra packaging. UI and chain retain source exports. Root Turborepo builds dependencies before their consumers.

## Validation and documentation

Turborepo coordinates builds and type checks. ESLint checks conventions and import boundaries. Tests cover the health use case, tenant HTTP authorization, a Mastra tool/structured-output transport fixture, provider contracts, durable PostgreSQL scheduling and research decisions. Provider test fixtures never stand in for a live connection check. Solidity requires unit, fuzz, and invariant testing before deployment; current contract directories are empty.

Read the root and relevant project `AGENTS.md` before working in any project. Update local instructions alongside changes to structure, exports, commands, or responsibilities. Keep documentation in English and distinguish working code from proposed examples.

References: [Next.js backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend), [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Turborepo internal packages](https://turborepo.dev/docs/core-concepts/internal-packages).
