# Agent token launch admission and previews

Launch admission and presentation now include the opt-in operational testnet composition described
in [Token operations](market/token-launch-operations.md). Its dedicated grant signer, immutable R2
metadata, existing Studio passkey, durable transactions and bounded indexer remain disabled until
the complete reviewed venue gate is configured. A separate Uniswap V4 contract acceptance has
completed; hosted product acceptance remains pending. See [the evidence](market/uniswap-v4-testnet-integration.md).
Funding wallets, publishing agents and editing token names cannot activate launch execution.

## Boundaries

Core's `createTokenLaunchService` owns creator access, workspace ownership, publication, master
registration, absence of a confirmed/pending token and versioned intent. Infrastructure implements
short PostgreSQL transactions and confirmed projection reads. The API composes these ports and
exposes owner-only user-JWT routes. It composes `TokenGrantIssuer` only behind the complete
reviewed testnet policy and restricted agent allowlist. The browser only edits
name and ticker. Network, agent key, creator/fee recipient, avatar snapshot, factory, preset, nonces
and deadlines come from the server. API keys and HMAC cannot use these routes.

The factory requires both Pickler's EIP-712 `LaunchGrant` and creator authorization (or a direct
creator call). The domain is `Pickler`, version `2`, with the actual chain ID and factory address.
`paramsHash` includes hashes of name, symbol and metadata URI, metadata hash, preset ID/version/hash,
creator nonce and creator deadline. The grant additionally binds agent key, creator, fee recipient,
its own unique nonce and expiry. Grants last at most five minutes. Operator-only authority rotation
invalidates signatures from the old authority. The original creator replay checks remain. There is
no legacy grant-free overload. The isolated testnet factory in the public acceptance record is deployed with general launches
disabled; it is not a configured hosted product deployment.

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

| Method | Route                                       | Result                                                                                   |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/v1/studio/agents/:id/token`           | Network, registered master, draft, blockers, confirmation, token and preset availability |
| PUT    | `/api/v1/studio/agents/:id/token/draft`     | Private name/ticker draft with optimistic version                                        |
| POST   | `/api/v1/studio/agents/:id/token/authorize` | Gated grant; requires `Idempotency-Key` and `expectedVersion`                            |

Every response is private and `no-store`. The [operation endpoints](market/token-launch-operations.md#owner-api-and-recovery)
prepare strictly enumerated transactions, accept the exact existing-passkey activity and reconcile
that same activity/transaction explicitly. Ordinary composition returns `LAUNCH_UNAVAILABLE` until
the policy, dedicated authority, R2 and verified versioned venue are configured. The controlled signer
is exported only through `@pickler/infrastructure/testing/token`, refuses remote PostgreSQL and is
never imported by a host. Its public fixture key is not an operational credential.

## Local presentation

Studio's existing `/studio/agents/:id/token` route is present in draft and live rails. Drafts show
**Go public first**. Owners can keep a private name/ticker draft. Details are always visible beneath
the form and update locally while typing, without fetching, submitting, or simulating transactions.
**Launch token** remains disabled in ordinary composition; non-production fixtures can exercise
controlled signature, cancellation, failure and confirmation states without providers. Total supply is exactly **21,000,000**
18-decimal tokens, enforced by core, preset validation and token construction. All supply is minted
once; there is no later minting, burning or token owner/admin. The registered master wallet is the
creator and receives creator fees; it does not gain privileged control over the ERC-20. A prepared launch freezes its avatar and content-addressed image; confirmed cards use that
snapshot even after the agent changes. Its portable accent/pattern accompany the public summary. The shared card shows name, ticker, explicit network, copyable
address and available links. Public profiles place it below the header; absence has no launch CTA.
Pending confirmation and failed reads are distinct from absence. No trading chart, purchase,
holders or fee-claim control is introduced in this card.

With `npm run dev --workspace=@pickler/web -- --port 3005` (or the existing local server), open:

- [Studio without token](http://localhost:3005/studio/agents/preview-live/token?stage=perpl-token-empty)
- [Studio with token](http://localhost:3005/studio/agents/preview-live/token?stage=perpl-token-launched)
- [Public profile without token](http://localhost:3005/agents/halftime?stage=token-empty)
- [Public profile with token](http://localhost:3005/agents/halftime?stage=token-launched)

All fixtures are refused in production. Explicit local preview controls represent launch phases,
cancellation, failure and confirmation. They do not request passkeys, start timers or call providers. Fictitious
addresses never open an explorer. Forms remain mounted during reads and errors, with Skeletons,
explicit retry and memory-only drafts across navigation. The full creator wallet is available in
its address title. The owner edits only name/ticker; the current agent avatar is reused.

## AUSD reference curve, precision policy 2

These are the approved reference parameters. They are informational terms, not a deployed preset
or executable quote. The API resolves chain and reviewed AUSD metadata from its configuration and
returns optional versioned `economics` independently of signer availability. Missing economics
remain unavailable; legacy state without the field stays readable. No endpoint or migration is
introduced for the reference profile.

| Parameter                                 | Reference                                 |
| ----------------------------------------- | ----------------------------------------- |
| Fixed supply, 18 decimals                 | 21,000,000 tokens                         |
| Curve / liquidity                         | 16,800,000 / 4,200,000 tokens (80% / 20%) |
| Creator / project reserve                 | 0 tokens                                  |
| Quote / gas                               | AUSD (6 decimals) / MON                   |
| Initial full-supply valuation             | Approximately 10,000 AUSD                 |
| Full-supply valuation at curve completion | Approximately 160,000 AUSD                |
| Net backing at curve completion           | 31,999.999998 AUSD                        |
| Buy / sell fees                           | 1% / 1%                                   |
| Trade fee split                           | 50% creator / 50% Pickler                 |
| Launch fee                                | 0 AUSD                                    |
| Post-migration venue and fees             | Uniswap V4; actual LP fees split 50/50    |

Initial valuation is price times the entire supply, not a required deposit or money raised. There is
no oracle or USD conversion. The virtual reserves are **22,400,000 tokens** and
**10,666.666666 AUSD**; they shape the curve and are not withdrawable funds. The net backing, virtual
quote reserve and accrued fees remain separate. Normalized whole-token prices are scaled by
`1e18`: initial `476190476160714`, final `7619047618571428`. Displayed values round to approximations.

`PicklerPreset.validate` dispatches on `roundingPolicyVersion`. Version 1 retains its original
price precision gate and directional trade rounding. Version 2 fixes the reference distribution,
reserves and trade fees, requires launch fee zero, and checks a normalized precision floor.
Factory admission and direct curve construction also require a deployed quote token reporting six
decimals. Unknown precision versions, mismatched decimals or altered reference parameters fail.
Preset hashes still commit to every field and both launch authorizations; published presets are
immutable. Existing historical math vectors and persisted rows are unchanged.

`PicklerCurveMath.marginalPriceWad` uses a full-precision `mulDiv` intermediate rather than scaling
an already truncated legacy price. Solidity exports vectors for derivation, buys, sells, fees,
exact-output remainder and normalized prices. Core's pure BigInt calculations must match all
53 reference vectors, alongside the unchanged legacy vectors. The browser only formats prepared
results. Its checked-in reference JSON is generated by `npm run tokens:fixtures`; the web test
compares it with core and reviewed chain metadata.

Exhausting curve inventory still closes both buys and sells. Controlled tests transfer precisely
the real backing and reserved tokens to a test adapter while retaining fees. This alone does not establish remote DEX readiness.
[Passive Kuru integration](market/kuru-passive-integration.md) adds controlled atomic graduation
and permanently locked principal with separate collection of actual LP fees. The old V4 generation remains historical. The separate
[Uniswap V4 V2 implementation](market/uniswap-v4-testnet-integration.md) is the current testnet venue.

The live form groups supply/distribution, valuation/backing, creator wallet and fees into a compact
summary. Gas is paid separately in MON without an invented estimate. The master wallet receives
creator fees and has no token-admin privileges. After graduation, the UI shows the indexed Uniswap or historical Kuru venue, permanent liquidity lock and available
fees. The economic summary explains the 50/50 split of actual collected LP fees without another
Pickler trading tax. There is no **Simulate** or **Review launch** action.

## Reproducible acceptance

Use Node 22.22+ and npm 10.9.3, the committed lockfile and local PostgreSQL (`npm run db:up`). If port
55432 is already occupied by the repository's local database, reuse it. Never target a remote
`TEST_DATABASE_URL` with the controlled token suite.

```sh
npm run build:shared
npm run tokens:fixtures -- --check
node --import tsx --test packages/core/test/curve-math.test.ts packages/core/test/token-economics.test.ts packages/core/test/token-launch.test.ts packages/infrastructure/test/token-launch.test.ts workers/api/test/studio-token-route.test.ts apps/web/test/token-preview.test.ts
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

| Scenario                                                                                                | Evidence boundary                                | Status                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| Legacy and normalized math, 53 reference vectors, full-precision intermediate                           | Offline Solidity and core                        | Passed locally                    |
| Buys, sells, exact remainder, fee separation, donations, no rounding cycle gain                         | Offline unit/fuzz/invariant suites               | Passed locally                    |
| Inventory conservation, solvency and controlled adapter handover                                        | Offline contracts; no DEX                        | Passed locally                    |
| Ownership, concurrent saves/grants, version conflicts, historical persistence and canonical attribution | Isolated PostgreSQL and API                      | Passed locally                    |
| Altered grants, other wallet/chain/factory, expiry, replay and authority rotation                       | Offline contract suites                          | Passed locally                    |
| Optional economics without signer, old responses and unknown version rejection                          | Core/API/web contracts                           | Passed locally                    |
| Four previews, desktop/mobile, keyboard, navigation, live edits and disabled launch                     | Local UI and Design                              | Passed locally                    |
| R2, dedicated signer, exact passkey/broadcast and bounded indexer                                       | Controlled ports and local database              | Implemented; remote gate off      |
| Uniswap V4, separate LP fees and permanent principal custody                                            | Controlled contracts and real testnet            | Passed; hosted activation pending |
| Real Uniswap contract flow                                                                              | 34 independently reconciled testnet transactions | Passed; hosted product pending    |

The isolated contract acceptance used faucet assets and explicit gas limits; no hosted migration,
app deployment, product activation or mainnet changes occurred. Complete the hosted operational
acceptance before enabling allowlisted launches.
