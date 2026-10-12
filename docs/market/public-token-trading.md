# Public token curve trading

## Scope

The public agent profile renders Buy/Sell below the confirmed token card. Visitors use their own
browser wallet or the existing Mera passkey wallet. Studio master-wallet operations remain separate;
public trades never use Turnkey, the grant authority or a server-held signing key.

Buy input is six-decimal AUSD, sell input is the eighteen-decimal agent token, and gas is MON.
Only active curves on Monad testnet (10143) are supported. Curve completion refuses preparation;
DEX swaps and exact-output final inventory purchases remain separate work. Mainnet is unavailable.
The staging source explicitly enables testnet public preparation with a 10,000-call
daily RPC reserve ceiling. At 40 calls reserved per preparation, this admits at most 250 reviews
per day. Wallet signatures remain explicit; this setting never enables mainnet.
The indexer source retains its already-enabled testnet gate; its existing admission policy
and cursors remain unchanged.

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

Buy token / Sell token starts one continuous user-initiated flow. Preparation happens on that
click, never while typing. Approval grants exactly the entered amount, not an unlimited allowance.
After canonical approval confirmation, the app prepares the same trade with a fresh nonce and quote
and opens the second wallet request automatically. Approval and swap still require separate wallet
confirmations. If the refreshed minimum is worse, the app shows the updated quote for explicit
confirmation. Changed token, curve, wallet, amount, side or tolerance cannot continue the flow.
Signing checks sender, network, nonce, token, AUSD, recipient, target, calldata, minimum output and
five-minute expiration, then simulates the exact action. There is no public relayer or broadcast API.

Browser wallets receive one `eth_sendTransaction`. Mera signs the prepared EIP-1559 transaction
locally, wipes PRF/key material and ends its session before one raw broadcast. No key or signed
bytes are persisted. JavaScript cannot guarantee erasure of strings, bigints or SDK internal copies.

Public unsigned attempts and hashes are stored in sessionStorage before opening the wallet.
Reloading a submitting attempt restores an uncertain state, never resends it. Failure to persist
before signing prevents submission; storage failure after sending preserves the hash in memory.
Known hashes are observed automatically using the existing canonical-block and two-confirmation
checks. Observation is serial, with at most thirty reads three seconds apart and a two-minute
deadline per transaction. Transient RPC failures retry reads only. Hidden pages pause reads;
navigation or wallet/network changes abort them. Reloading a pending hash resumes observation
without another send. A restored approval prepares the swap for explicit confirmation, never a
wallet prompt from an effect. A lost browser-wallet response without a hash remains blocked and
directs the user to wallet activity; it cannot safely be rebroadcast. At the observation ceiling,
the original hash remains visible as pending. No broadcast retry or replacement is added.

The primary button communicates preparation, wallet confirmation and chain confirmation with one
spinner. There is no routine Check transaction button or additional loading block. Final messages
are concise; the hash links to the explorer and has an icon-only copy action. A confirmed swap
refreshes the existing database-backed market read; indexing remains a separate canonical projection.
Receipt display itself does not attribute the token or update portfolio/accounting records.

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

Automatic receipt observation and Mera preflight use the public wallet RPC defined in
`@pickler/chain`. One observation read can make up to three RPC calls, so its thirty-read ceiling
allows at most ninety calls per transaction. Browser wallets use their own provider. These
user-initiated flows never share backend credentials or enable model/provider spending. Remote public activation and an actual visitor
purchase/sale still require operator readiness and human wallet confirmation.

## Landing discovery

The landing reads `/api/v1/marketplace/directory` alongside public activity. Its Agent tokens
section displays only the optional `launchedToken` summary, checked against canonical confirmed
LaunchCreated events, stored grants and the configured network in one batched database query.
Cards lead to `/agents/:handle`, where the existing public Buy/Sell form resolves the token again.
Private, unconfirmed, orphaned and unattributed launches are excluded. A failed directory read
shows unavailable rather than an empty token claim. No RPC request runs merely to view the landing.

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
node --import tsx --test packages/core/test/public-token-trading.test.ts packages/infrastructure/test/public-token-trading.test.ts apps/web/test/public-token-transaction.test.ts apps/web/test/public-trade-flow.test.ts apps/web/test/public-trade-memory.test.ts apps/web/test/mera-token-transaction.test.ts apps/web/test/claim-handle.test.ts workers/api/test/public-token-trading-route.test.ts
TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55440/pickler node --import tsx --test packages/infrastructure/test/public-token-rpc-quota.test.ts
node --import tsx scripts/design/public-token-trading.mjs http://localhost:3005
npm run build --workspace=@pickler/web
node --import tsx scripts/design/token-discovery.mjs
```

The PostgreSQL command requires a disposable loopback database with CREATEDB. The rendered harness
requires the loopback fixture API and web server, and globally installed Playwright as documented
by Design. Omitting the URL starts its own servers on 8799/3001; existing servers are not replaced.
`token-discovery.mjs` starts its own production web on 3012 and a strict loopback fixture API
on 8802. It checks empty, unavailable and confirmed listings, keyboard navigation to the public
Buy/Sell panel, and overflow at 390/1280 pixels. It refuses occupied ports and external requests,
stops only the processes it created and writes diagnostics under
`scripts/design/.shots/diagnostics/token-discovery`. It needs the production web build above.

All wallet requests, quote responses and receipt RPCs are controlled. Unknown/external requests
are refused. The fixture-only `/agents/public_trade` exercises the actual unsigned wallet path;
it is not a production token or a provider acceptance claim.

Public preview links on the development server:

- `/agents/halftime?stage=token-empty`: no token and no trade action.
- `/agents/halftime?stage=token-launched`: simulated approvals, buy, sell and confirmation.
- `/agents/halftime?stage=token-empty&wallet=username`: username recovery UI.

| Scenario                                                                                  | Evidence                                             | Acceptance                  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------- |
| Canonical identities, balances, allowance, decimals, inventory, gas and minima            | Injected core/RPC tests                              | Passed locally (controlled) |
| Public contract, strict inputs, disabled gate, quota errors and sanitized failures        | API tests                                            | Passed locally (controlled) |
| Global and per-wallet concurrent limits                                                   | Isolated PostgreSQL                                  | Passed locally (controlled) |
| Exact browser/Mera action, cancellation, lost response and key cleanup                    | Wallet tests                                         | Passed locally (controlled) |
| Continuous approvals/buy/sell, receipt recovery, reload, cancellation and preserved forms | Loopback browser harness at 1280/380/320 px          | Passed locally (controlled) |
| Hosted acceptance of the continuous approval/trade flow                                   | Not run; real wallet and confirmed live token needed | Pending                     |
| DEX swaps after graduation                                                                | Separate integration                                 | Pending                     |
| Indexer changes                                                                           | Existing implementation unchanged                    | Deferred                    |
