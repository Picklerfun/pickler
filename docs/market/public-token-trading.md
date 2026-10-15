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

One compact, fixed-height (48px) primary button communicates the complete flow visually. Its wallet icon pulses
while the wallet is open; an indeterminate ring and subtle sweep show preparation, approval and
swap progress. A confirmed buy or sell draws a check inside the same button for 2.2 seconds, then
restores Buy/Sell without sending anything. Editing the form dismisses this feedback immediately.
Failures and actionable hints also appear inside that button; full sanitized descriptions remain
accessible to screen readers. Missing-hash submissions stay blocked. There are no separate visible
confirmation/error paragraphs, loading blocks or Check transaction controls. Reduced motion removes
all button animations. Expected/minimum rows reserve their space; stale quotes are hidden after an
edit. Approval and Buy/Sell hashes appear in separate compact rows below the button. Each real hash
links directly to the explorer and has an icon-only copy action. Both receipts survive completion,
swap preparation, cancellation and reload; historical single-hash attempts remain readable.
Preview hashes never link to an explorer. A swap first verifies its receipt through the public confirmation API, then refreshes the existing
database-backed market read. The browser supplies only wallet/hash; it never supplies prices or
reserve values. Confirmation appends canonical raw evidence without advancing cursors or rewriting
history. The indexer retains external activity, projection replay and reorg reconciliation. This
does not attribute a new token or update portfolio/accounting records.

## Runtime configuration

Configure the API Worker, never the frontend build:

| Binding                        | Meaning                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `TOKEN_PUBLIC_TRADING_ENABLED` | Explicit `true`; absent/false leaves public preparation closed                                         |
| `TOKEN_PUBLIC_RPC_DAILY_LIMIT` | Explicit integer 40–100,000, maximum reserved preparation/confirmation RPC calls per day               |
| `TOKEN_LAUNCH_POLICY_JSON`     | Existing reviewed testnet deployment/preset and gas limits; a fixture is invalid for remote activation |
| `MONAD_RPC_URL`                | Operator-selected RPC for bounded backend preparation                                                  |

Public trading has its own gate and does not enable issuance. The policy's creator launch allowlist
is not a buyer allowlist; any visitor may trade a confirmed published token of the reviewed preset.
Each preparation or unrecorded receipt confirmation reserves 40 calls against a shared daily ceiling before transport, regardless of
wallet, and allows at most six preparation/confirmation admissions per wallet per minute. Reservations are transactional
in the existing private `pickler.provider_quotas`; failures consume admitted daily reservations.
The driver independently caps each admitted operation at 40 calls. Recorded canonical receipts are idempotent and require no RPC admission. Denials return 429 with Retry-After.
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
- `/agents/halftime?stage=token-launched`: simulated approvals, buy, sell and confirmation; choose Success, Cancel, Failure or Slow network above the market.
- `/agents/halftime?stage=token-empty&wallet=username`: username recovery UI.

| Scenario                                                                                  | Evidence                                             | Acceptance                  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------- |
| Canonical identities, balances, allowance, decimals, inventory, gas and minima            | Injected core/RPC tests                              | Passed locally (controlled) |
| Public contract, strict inputs, disabled gate, quota errors and sanitized failures        | API tests                                            | Passed locally (controlled) |
| Global and per-wallet concurrent limits                                                   | Isolated PostgreSQL                                  | Passed locally (controlled) |
| Exact browser/Mera action, cancellation, lost response and key cleanup                    | Wallet tests                                         | Passed locally (controlled) |
| Continuous approvals/buy/sell, receipt recovery, reload, cancellation and preserved forms | Loopback browser harness at 1280/380/320 px          | Passed locally (controlled) |
| Button transitions, stable geometry, reduced motion and no separate status paragraphs     | Loopback browser harness                             | Passed locally (controlled) |
| Hosted acceptance of the continuous approval/trade flow                                   | Not run; real wallet and confirmed live token needed | Pending                     |
| DEX swaps after graduation                                                                | Separate integration                                 | Pending                     |
| Indexer changes                                                                           | Existing implementation unchanged                    | Deferred                    |

## Canonical trade publication

`POST /v1/marketplace/personas/:handle/token/confirm` accepts only `{ wallet, txHash }` and
returns `pending`, `confirmed` or `reverted`. It shares public trading admission and the reviewed
testnet policy. Before publication, the backend verifies the pinned factory, registered launch,
agent key, preset, quote/deployer bindings, sender, exact-input calldata and matching decoded
curve event at a stable policy-confirmed block. Provider preparation holds no PostgreSQL locks.
The short publication transaction rechecks canonical attribution and serializes with the indexer.
It only inserts absent headers/events. Conflicting branches, orphaned evidence or inconsistent
stored event contents remain pending for indexer reconciliation; public requests never rewrite
those records. Replays return the recorded result without signing, sending or advancing cursors.

The market merges recent receipt observations with bounded hourly history and the original
launch-price anchor. Two buys in the same hour are distinct graph observations. Price/FDV and curve
progress reuse core integer calculations; volume and actual reserve come from canonical events.

Controlled regression commands:

```sh
node --import tsx --test packages/infrastructure/test/public-trade-confirmation.test.ts packages/infrastructure/test/token-market-read.test.ts
node --import tsx scripts/design/public-token-trading.mjs http://localhost:3005
```

These tests use isolated loopback PostgreSQL and controlled RPC/wallet responses. They verify
buy/sell publication, replay, concurrency, unchanged cursors and historical conflict preservation.
Local acceptance does not establish deployed API availability. Both API and Web must publish
through the existing automatic release process; no manual deployment is part of this change.

## Receive estimates and browser reconnection

With a connected browser wallet, the form reads
`POST /api/v1/marketplace/personas/:handle/token/quote` after a 600 ms pause in valid input.
The receive field shows tokens when buying and AUSD when selling, alongside the server-calculated
minimum. Edits abort stale requests; failure shows an unavailable estimate instead of retaining
an unrelated amount. A confirmed swap refreshes the estimate. The endpoint shares preparation's
canonical verification and global RPC ceiling, but has its own six-per-wallet/minute bucket.
It returns before balance admission, nonce, gas/fee estimation or transaction encoding. No wallet
prompt or transaction is initiated by typing. Preview amounts remain labelled controlled fixtures.

Reload restores a remembered browser wallet from its extension permission independently of a
Pickler login. Delayed extension injection and native-balance reads are bounded; explicit
Disconnect, revoked access and superseded connections cannot be undone by a late response.
This does not authenticate account actions or prompt for a signature. Mera's existing restoration
and private account sign-in behavior stay separate.

Controlled regression checks include `apps/web/test/injected-resume.test.ts`, the public core,
driver/API tests, `scripts/design/public-token-trading.mjs` and `scripts/design/wallet-reload.mjs`.
The trading harness verifies receive amounts,
debounced/stale replies, buy/sell, receipt preservation and wallet reload; remote acceptance still
requires the automatically published API and Web. No manual deployment is part of this change.

```sh
node --import tsx scripts/design/wallet-reload.mjs http://localhost:3005
```

The wallet harness also runs against a loopback compiled web server. To reproduce the missing-auth
session case, build that local web with the fixture-only public values
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8799` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_controlled`, start it with the loopback API
transport, and pass its URL to the same harness. No real Supabase account or extension is used.

## Browser wallet selection and actionable failures

The chooser discovers extensions with EIP-6963 and keeps the selected provider pinned through
sign-in, switching, approval and swap. Legacy injected wallets remain supported. Reload remembers
the extension ID; a missing remembered provider never silently restores a different extension.
The selected extension's name appears beside the trade wallet address.

Switching to Monad testnet reads the actual wallet chain, including after adding the network and
requesting a second switch. Refused, unsupported, pending and disconnected requests remain visible
with a reviewed next step. Trade errors distinguish request cancellation, permission, nonce, gas,
simulation and transaction-parameter failures. Expandable details expose the method and RPC code,
never raw provider payloads. Known pre-send failures preserve the form and require fresh preparation
on retry. Missing send responses remain uncertain and blocked, including after reload.

These guarantees are covered with controlled EIP-1193/EIP-6963 wallets; they do not establish live
extension acceptance or authorize real transactions or deployment.
