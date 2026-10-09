# Agent token launch admission and previews

This delivery prepares launch admission and presentation. It does not deploy contracts, compose
an operational signer, request a passkey, send transactions or enable an indexer. Funding wallets,
publishing agents and editing token names cannot activate launch execution.

## Boundaries

Core's `createTokenLaunchService` owns creator access, workspace ownership, publication, master
registration, absence of a confirmed/pending token and versioned intent. Infrastructure implements
short PostgreSQL transactions and confirmed projection reads. The API composes these ports and
exposes owner-only user-JWT routes; it deliberately omits `TokenGrantIssuer`. The browser only edits
name and ticker. Network, agent key, creator/fee recipient, avatar snapshot, factory, preset, nonces
and deadlines come from the server. API keys and HMAC cannot use these routes.

The factory requires both Pickler's EIP-712 `LaunchGrant` and creator authorization (or a direct
creator call). The domain is `Pickler`, version `2`, with the actual chain ID and factory address.
`paramsHash` includes hashes of name, symbol and metadata URI, metadata hash, preset ID/version/hash,
creator nonce and creator deadline. The grant additionally binds agent key, creator, fee recipient,
its own unique nonce and expiry. Grants last at most five minutes. Operator-only authority rotation
invalidates signatures from the old authority. The original creator replay checks remain. There is
no legacy grant-free overload. No factory has been deployed by this delivery.

Agent keys are `keccak256(abi.encode("pickler.agent.v1", uint256(chainId), bytes16(agentUuid)))`.
The UUID has its hyphens removed before encoding. The private mapping and recorded grant must match
before a confirmed canonical `LaunchCreated` event can attribute a token. A browser transaction hash
cannot confirm launch. Orphaned, observed or incomplete evidence never shows a confirmed token.
Public profile token reads use the API's configured custody chain, not a browser-selected network.
Read errors remain errors; they are never converted to absence. Confirmation windows compare the
issued time at whole-second precision, matching EVM block timestamps, including a transaction mined
in the grant's own second.

## Persistence and HTTP

Drizzle migrations 0036 and 0037 append private `launch.agent_keys` and `launch.grants`, unique
agent/network draft identity and one launched token per agent/network. Existing SQL migrations and
historical rows are unchanged. RLS is enabled with no anonymous/authenticated policies or grants.
New parent indexes precede their foreign keys in the SQL migration. The migration fails rather than
rewriting conflicting historical records. Draft edits use `expectedVersion`; an identical retry
returns the existing result. Workspace/access/agent locks serialize concurrent save and grant
requests. An unexpired grant prevents editing or issuing a different authorization for that agent.
Expired retries require a new request. A changed owner cannot retrieve the previous owner's grant.

| Method | Route                                       | Result                                                                                |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/api/v1/studio/agents/:id/token`           | Network, draft, blockers, confirmation state, confirmed token and preset availability |
| PUT    | `/api/v1/studio/agents/:id/token/draft`     | Private name/ticker draft with optimistic version                                     |
| POST   | `/api/v1/studio/agents/:id/token/authorize` | Controlled-only grant; requires `Idempotency-Key` and `expectedVersion`               |

Every response is private and `no-store`. There is no receipt-confirmation or broadcast endpoint.
Ordinary composition always returns `LAUNCH_UNAVAILABLE` for authorization. The controlled signer
is exported only through `@pickler/infrastructure/testing/token`, refuses remote PostgreSQL and is
never imported by a host. Its public fixture key is not an operational credential.

## Local presentation

Studio's existing `/studio/agents/:id/token` route is present in draft and live rails. Drafts show
**Go public first**. Owners can keep a private name/ticker draft; hosted **Review launch** stays
disabled. The current agent avatar is used in both cards; its portable accent/pattern accompany the confirmed public summary. The shared card shows name, ticker, explicit network, copyable
address and available links. Public profiles place it below the header; absence has no launch CTA.
Pending confirmation and failed reads are distinct from absence. No trading chart, purchase,
holders or fee-claim control is introduced in this card.

With `npm run dev --workspace=@pickler/web -- --port 3005` (or the existing local server), open:

- [Studio without token](http://localhost:3005/studio/agents/preview-live/token?stage=perpl-token-empty)
- [Studio with token](http://localhost:3005/studio/agents/preview-live/token?stage=perpl-token-launched)
- [Public profile without token](http://localhost:3005/agents/halftime?stage=token-empty)
- [Public profile with token](http://localhost:3005/agents/halftime?stage=token-launched)

All fixtures are refused in production. Supply, allocations, fees and cost in review are labelled
simulated demo economics, not an approved quote. Explicit buttons advance awaiting signature,
confirming, failure, retry and cancellation; no timers, passkeys or provider calls do so. The explorer link uses the confirmed address and explicit network; it is disabled for fictitious
preview addresses. Ticker-only token detail routes cannot distinguish duplicate symbols across
agents/networks, so this card does not infer a detail link from the ticker. Forms remain mounted during reads, errors and review, with
Skeletons for loading and in-memory Studio drafts across navigation.

## Reproducible acceptance

Use Node 22.22+ and npm 10.9.3, the committed lockfile and local PostgreSQL (`npm run db:up`). If port
55432 is already occupied by the repository's local database, reuse it. Never target a remote
`TEST_DATABASE_URL` with the controlled token suite.

```sh
npm run build:shared
node --import tsx --test packages/core/test/token-launch.test.ts packages/infrastructure/test/token-launch.test.ts workers/api/test/studio-token-route.test.ts apps/web/test/token-preview.test.ts
npm run contracts:test
npm run contracts:abi
node scripts/design/token-preview.mjs http://localhost:3005
node --import tsx scripts/design/studio-loading.mjs
node scripts/design/studio-routing.mjs
node scripts/design/sidebar-motion.mjs
npm run typecheck
npm run lint
npm run format:check
npm run check:architecture
npm run api:openapi -- --output /tmp/pickler-token-openapi.json
npm run build
npm run build:workers
npm run design:check
```

| Scenario                                                                    | Acceptance boundary                             | Status                    |
| --------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------- |
| Permissions, private agent, missing master, disabled issuer                 | Core and isolated PostgreSQL                    | Passed locally            |
| Concurrent saves/grants, retries, expiry, private migration                 | Isolated PostgreSQL                             | Passed locally            |
| Altered signed parameters, wallet/chain/factory, rotation, replay           | Offline Foundry unit/fuzz/invariant tests       | Passed locally            |
| Canonical confirmation, wrong factory, orphaned evidence, public summary    | Simulated indexed events in isolated PostgreSQL | Passed locally            |
| Both cards, review/cancel/error/confirmation, keyboard/mobile               | Local web fixtures and Design                   | Passed locally            |
| Real metadata persistence, operational signing, passkey/broadcast           | Not composed                                    | Pending next delivery     |
| Contract deployment, remote migrations, indexer activation, live acceptance | Not performed                                   | Pending explicit delivery |

Corrections verified during acceptance: migration indexes now precede composite foreign keys;
ambiguous master accounts block grants; canonical attribution respects EVM timestamp precision;
fixture manifests and the public profile's Design proof now target the shared token card; stale
versions preserve inputs and prevent overwriting a newer draft. Full root tests passed (2,864 passed,
8 external opt-in tests skipped, no failures); targeted PostgreSQL/API acceptance passed again after
the timestamp correction. Foundry passed 118 offline tests. Rendered Design passed all 130 routes (surfaces, tokens, contrast and typography). Studio loading,
routing, sidebar motion and the final token preview walkthrough passed. Compilation results are
recorded in the PR with their commands.

Controlled results do not establish deployed readiness. Before activation, implement durable public
metadata storage, an operational signer and reviewed authority custody, passkey signing/submission,
verified factory deployments and the indexer's configured activation and reorg lifecycle. Review
actual presets, recipient policy and costs separately; this preview does not approve them.
