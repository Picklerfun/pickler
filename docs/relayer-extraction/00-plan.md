# Relayer → Pickler extraction plan

Source: Relayer `develop` at `bb6bb1226e9289f675e355e7c022530e1e790fd9` (2026-06-25). Relayer-agent-kit at `9d9c0afec52f`.
Target runtime: Cloudflare Workers. Database: Supabase project `pickler` (separate from Relayer, which is left intact), one schema per domain; see `supabase/AGENTS.md`.

Detailed findings, per-file decisions and ordering live in:

| Report                                         | Area                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [01-identity-auth.md](01-identity-auth.md)     | Supabase Auth, API keys, integrators and members, CASL permissions, shared helpers                     |
| [02-turnkey-signing.md](02-turnkey-signing.md) | Turnkey sub-orgs, wallets, policies, approvals, EVM transactions                                       |
| [03-agents-budget.md](03-agents-budget.md)     | Agent lifecycle, budgets, events, original `pickler` schema proposal (superseded by schema-per-domain) |
| [04-mastra-runtime.md](04-mastra-runtime.md)   | Mastra agents, agent SDK, skills, Cloudflare feasibility, minimal vertical slice                       |

These reports come from reading code only. Nothing was executed against Relayer, Turnkey or the database.

## Ground rules

1. **Copy logic, replace the runtime.** Business rules, data formats (encryption, amounts in micro-USD, Turnkey payloads) and table/column names are preserved. NestJS DI, guards, interceptors, Redis, `@nestjs/schedule`, `ws` and `node:crypto` are replaced.
2. **Record provenance.** Every ported file starts with `// Ported from Relayer <path> (commit bb6bb1226e92).` and notes any intentional behaviour change.
3. **Do not port known defects silently.** Each defect listed below is either fixed with a test during the port or excluded; the choice is written in the ported file.
4. **Own database, schema per domain.** (Changed 2026-09-16: Relayer is no longer developed, so Pickler does not share its project.) Relayer's tables are redesigned into `identity`, `agents`, `budget`, `audit` and `growth`, keeping Relayer's rules and formats; column names change where the model changed (integrator → workspace). Turnkey data will live in `wallets` (not `custody`), Perpl in `trading`, launches in `market`. Migrations are tested on a Supabase branch before the main project.
5. **Out of scope:** `payout`, `kyc`, `kyb`, Bridge, Solana-only signing, Avalanche/Uniswap routers, Mongo, Relayer's x402 payment approvals.

## Runtime mapping

| Relayer (NestJS on Render)                                 | Pickler (Cloudflare)                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Controllers, guards, interceptors                          | Hono routes and middleware in `workers/api`                                                                |
| `class-validator` DTOs                                     | zod schemas                                                                                                |
| Redis budget Lua script                                    | One Durable Object per agent: idempotent reserve/commit/release, alarm sync to Postgres                    |
| Redis two-step state (prepare/confirm, passkey challenges) | Durable Object or single-use Postgres rows (not KV)                                                        |
| Redis cache, throttler                                     | KV cache, Cloudflare Rate Limiting                                                                         |
| `@nestjs/schedule` crons                                   | Cron Triggers → Queues                                                                                     |
| `ws` gateway                                               | Durable Object with WebSocket Hibernation                                                                  |
| `node:crypto` scrypt/AES-GCM/ECDH/Ed25519                  | `@noble/*` + WebCrypto (byte-compatible)                                                                   |
| `@turnkey/sdk-server`                                      | `@turnkey/http` or a WebCrypto request stamper (spike first)                                               |
| ethers v5                                                  | viem                                                                                                       |
| Mastra on a VPS with pm2, `node-cron`, LibSQL              | Workers + Cloudflare Workflows; Containers only if the Mastra bundle does not run on Workers (spike first) |

## Defects found in Relayer

Production-relevant for Relayer itself (report to the Relayer owners now):

- **Invite acceptance can be forged** (01): accepting an invite does not require a stored invite or a matching email, and the token is unsigned. A signed-in user with an organization can likely gain admin membership in another organization.
- **Hard-coded RPC provider key** in `blockchain/config/rpc.config.ts` (02): rotate it; never copy it.
- **Agent SDK ignores the response envelope** (04): the kill switch flag is never read, approval polling times out, and co-signed payments are treated as refused.

Defects to fix while porting (details in the cited report):

- `/auth/me` resolves the owner instead of the caller; signup API key stored encrypted instead of hashed; `integrator_keys` expiry not enforced (01).
- ERC-20 transfers use 18 decimals instead of token decimals (breaks AUSD); agent policy rows use old types; confirm step does not match the signed activity to the prepared transaction; second-admin approvals never broadcast; transactions never marked `confirmed`; `signing.policies` drifts from Turnkey (02).
- Negative payment amounts add budget; limit changes reset spend; kill reconciles stale DB values over live spend; approvals cancelled on the wrong schema; `agent_policy_meta` never written; chain defaults to Base/Sepolia/Solana (03).

## Porting waves

Each wave compiles, has tests, and leaves the web app working.

| Wave | Content                                                                                                                                                                                                                                             | Status                                                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | AES-256-GCM, byte-compatible with Relayer (`packages/infrastructure/src/crypto`); verified inside workerd against a Relayer-produced ciphertext                                                                                                     | Done                                                                                                                                                                                                                                                                                                                                          |
| 1    | Error types and response envelope, auth constants, CASL abilities, principal, Supabase JWT verifier (`jose`), IP allowlist without `net.BlockList`                                                                                                  | Done                                                                                                                                                                                                                                                                                                                                          |
| 2    | `workers/api` (Hono): Supabase client factory, integrator and API-key repositories, membership resolution, combined-auth/module/permission middleware, `/v1/auth/me`; runs under `wrangler dev`                                                     | Done (not yet tested against the real Supabase project)                                                                                                                                                                                                                                                                                       |
| 3    | Pickler identity and creator model: one identity across web and mobile, creator workspace = integrator, many agents per creator; schema migrations (profiles, versioned configs, waitlist, applications)                                            | Schema done and applied to `pickler` (identity, agents, budget, audit, growth); adapters read the new tables. Writes (workspace creation, agent configs) pending.                                                                                                                                                                             |
| 4    | Agents: repositories, lifecycle (draft → confirm-user → confirm-policies → active/paused/killed), events (append-only), analytics; public read endpoints for the web                                                                                | Read side done: `agent.agents`/`agent_events` repositories, list/get/status/analytics/audit routes, agent SDK HMAC auth. Lifecycle writes wait for waves 5–6; public web endpoints wait for the `market` schema.                                                                                                                              |
| 5    | Budget Durable Object replacing the Lua script, with the reserve/commit/release semantics and fixes above                                                                                                                                           | Done: `AgentLedger` DO + core ledger, `GET /v1/agents/:id/budget`; concurrency, idempotency and alarm expiry verified in workerd. Postgres write-behind and the budget prepare/confirm endpoint wait for waves 3 and 6.                                                                                                                       |
| 6    | Turnkey client spike on Workers, then wallets, policies, EVM transactions on Monad with AUSD (verify chain id, AUSD address, decimals)                                                                                                              | In progress. Step 0 done: stamping verified in workerd (see Turnkey findings); P-256 keygen and Ed25519 verify via WebCrypto; Monad/AUSD verified. Ported: parent-key reader and passkey activity forwarder with scope checks. Next: activity mapping, ERC-20 SCI ABI, policy synthesis, EVM tx builder, then wallets/transactions use cases. |
| 7    | Mastra spike on Workers; minimal slice: `market-analyst` agent with `get-trading-limits` and `propose-trade`, decisions tied to config version and prompt hash, `TradeAuthorizationService` returning `pending_approval`/`rejected` without signing |                                                                                                                                                                                                                                                                                                                                               |
| 8    | Perpl venue adapter: orders, fills, positions, reconciliation                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                               |

The web app switches from its sample/Supabase adapters to `workers/api` in waves 2–4, keeping the same core ports.

## Turnkey on Workers (spike, 2026-09-16)

- `@turnkey/api-key-stamper` produces valid `X-Stamp` signatures in workerd with every backend (node detection under `nodejs_compat`, WebCrypto, pure JS). Pickler pins WebCrypto.
- `@turnkey/http` `TurnkeyClient` request methods fail in workerd (`redirect: "error"` is not supported). Its `stamp*` methods work; requests are sent with our own fetch (`redirect: "manual"`).
- P-256 keygen (JWK → compressed public key hex) and Ed25519 raw-key verification work with WebCrypto, replacing `generateKeyPairSync`, `createECDH` and `KeyObject` usage.

## Verified network constants (2026-09-16)

- Monad mainnet chain id 143 (`https://rpc.monad.xyz`), testnet 10143 (`https://testnet-rpc.monad.xyz`) — docs.monad.xyz.
- AUSD mainnet `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, testnet `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` — docs.agora.finance.
- On-chain: 6 decimals; EIP-712 domain name `Agora Dollar`, version `1`, chain id bound; EIP-2612 `nonces` and EIP-3009 `authorizationState`/standard typehash respond on mainnet.

## Open items to verify

- Whether a Turnkey root user can bypass sub-org policies.
- Mastra `@mastra/core` bundling on Workers (Node built-ins in agent/workflow entry points).
- `public.clients.agent_api_private_key`: current consumer and storage format.
