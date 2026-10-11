# Public token curve trading

## Scope

The public agent profile renders Buy/Sell below the confirmed token card. Visitors use their own
browser wallet or the existing Mera passkey wallet. Studio master-wallet operations remain separate;
public trades never use Turnkey, the grant authority or a server-held signing key.

Buy input is six-decimal AUSD, sell input is the eighteen-decimal agent token, and gas is MON.
Only active curves on Monad testnet (10143) are supported. Curve completion refuses preparation;
DEX swaps and exact-output final inventory purchases remain separate work. Mainnet is unavailable.
No indexer configuration, migration, remote gate or real transaction is changed by this delivery.

## Preparation and signing

`POST /api/v1/marketplace/personas/:handle/token/prepare` is public and private/no-store. It accepts
only wallet address, side, positive atomic amount and explicit 1–100 bps tolerance. It needs no
creator JWT: the returned transaction is unsigned and cannot spend anything without the visitor's
wallet. Studio's owner endpoints retain their JWT and ownership checks.

Core admits the public action. API composition resolves the published persona's confirmed token.
Infrastructure checks the canonical factory record, agent key, preset, chain, pinned deployment
hashes, AUSD implementation, curve identity, phase and decimals. It reads balance, allowance,
quote and inventory at one block. Existing core policy computes the minimum received by rounding
up, without browser financial formulas. Gas estimates receive the existing 20% padding and the
reviewed gas/fee/cost ceilings; insufficient MON refuses preparation.

The form requests preparation only on Review buy/sell. Approval grants exactly the entered amount,
not an unlimited allowance. Approval and swap require separate explicit wallet confirmations.
Signing checks sender, network, nonce, token, AUSD, recipient, target, calldata, minimum output and
five-minute expiration, then simulates the exact action. There is no public relayer or broadcast API.

Browser wallets receive one `eth_sendTransaction`. Mera signs the prepared EIP-1559 transaction
locally, wipes PRF/key material and ends its session before one raw broadcast. No key or signed
bytes are persisted. JavaScript cannot guarantee erasure of strings, bigints or SDK internal copies.

Public unsigned attempts and hashes are stored in sessionStorage before opening the wallet.
Reloading a submitting attempt restores an uncertain state, never resends it. Failure to persist
before signing prevents submission; storage failure after sending preserves the hash in memory.
A known hash can be checked explicitly, with canonical block and two-confirmation checks. A lost
browser-wallet response without a hash remains blocked and directs the user to wallet activity;
it cannot safely be retried automatically. No polling, automatic retry or replacement is added.
This manual receipt display is not indexer attribution or a portfolio/accounting projection.

## Runtime configuration

Configure the API Worker, never the frontend build:

| Binding                        | Meaning                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `TOKEN_PUBLIC_TRADING_ENABLED` | Explicit `true`; absent/false leaves public preparation closed                                         |
| `TOKEN_PUBLIC_RPC_DAILY_LIMIT` | Explicit integer 40–100,000, maximum reserved preparation RPC calls per day                            |
| `TOKEN_LAUNCH_POLICY_JSON`     | Existing reviewed testnet deployment/preset and gas limits; a fixture is invalid for remote activation |
| `MONAD_RPC_URL`                | Operator-selected RPC for bounded backend preparation                                                  |

Public trading has its own gate and does not enable issuance. The policy's creator launch allowlist
is not a buyer allowlist; any visitor may trade a confirmed published token of the reviewed preset.
Each preparation reserves 40 calls against a shared daily ceiling before transport, regardless of
wallet, and allows at most six preparations per wallet per minute. Reservations are transactional
in the existing private `pickler.provider_quotas`; failures consume admitted daily reservations.
The driver independently caps each preparation at 40 calls. Denials return 429 with Retry-After.
Changing wallet addresses cannot increase the global allowance. These controls limit resources;
a public address is not proof of identity and this is not an anti-Sybil admission mechanism.

Manual receipt checks and Mera preflight use the public wallet RPC defined in `@pickler/chain`.
Browser wallets use their own provider. These are explicit user actions and never share backend
credentials or enable model/provider spending. Remote public activation and an actual visitor
purchase/sale still require operator readiness and human wallet confirmation.

## Username recovery

The username field remains editable after a taken-name response. Choose another username clears
and focuses it, including when the current name already occupies the fifteen-character maximum.
Availability and claim requests time out after ten seconds. Malformed/failed availability is unknown,
not taken; stale responses and failures are scoped to the requested handle. A synchronous claim
guard prevents duplicate submissions, and disconnect/unmount prevents late claim completion from
closing a different wallet's chooser. Existing-account linking and Disconnect remain available.

## Controlled validation

From the repository root, using Node 22.22+:

```sh
npm run build:shared
node --import tsx --test packages/core/test/public-token-trading.test.ts packages/infrastructure/test/public-token-trading.test.ts apps/web/test/public-token-transaction.test.ts apps/web/test/public-trade-memory.test.ts apps/web/test/mera-token-transaction.test.ts apps/web/test/claim-handle.test.ts workers/api/test/public-token-trading-route.test.ts
TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55440/pickler node --import tsx --test packages/infrastructure/test/public-token-rpc-quota.test.ts
node --import tsx scripts/design/public-token-trading.mjs http://localhost:3005
```

The PostgreSQL command requires a disposable loopback database with CREATEDB. The rendered harness
requires the loopback fixture API and web server, and globally installed Playwright as documented
by Design. Omitting the URL starts its own servers on 8799/3001; existing servers are not replaced.
All wallet requests, quote responses and receipt RPCs are controlled. Unknown/external requests
are refused. The fixture-only `/agents/public_trade` exercises the actual unsigned wallet path;
it is not a production token or a provider acceptance claim.

Public preview links on the development server:

- `/agents/halftime?stage=token-empty`: no token and no trade action.
- `/agents/halftime?stage=token-launched`: simulated approvals, buy, sell and confirmation.
- `/agents/halftime?stage=token-empty&wallet=username`: username recovery UI.

| Scenario                                                                           | Evidence                                             | Acceptance                  |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------- |
| Canonical identities, balances, allowance, decimals, inventory, gas and minima     | Injected core/RPC tests                              | Passed locally (controlled) |
| Public contract, strict inputs, disabled gate, quota errors and sanitized failures | API tests                                            | Passed locally (controlled) |
| Global and per-wallet concurrent limits                                            | Isolated PostgreSQL                                  | Passed locally (controlled) |
| Exact browser/Mera action, cancellation, lost response and key cleanup             | Wallet tests                                         | Passed locally (controlled) |
| Username recovery, public approvals/buy/sell, reload and preserved forms           | Loopback browser harness at 1280/380/320 px          | Passed locally (controlled) |
| Hosted public activation and an actual visitor purchase/sale                       | Not run; real wallet and confirmed live token needed | Pending                     |
| DEX swaps after graduation                                                         | Separate integration                                 | Pending                     |
| Indexer changes                                                                    | Existing implementation unchanged                    | Deferred                    |
