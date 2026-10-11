# Testnet launcher and versioned venue operations

## Current boundary

The launcher composes a dedicated backend EIP-712 grant authority, immutable R2 metadata,
Studio's existing Turnkey passkey, a direct master-wallet factory transaction, private durable
operations and a bounded indexer. Ordinary composition remains disabled. Mainnet is rejected.

The current launcher supports the separate reviewed Uniswap V4 policy version 2. Its
[real contract acceptance](uniswap-v4-testnet-integration.md) completed, but hosted Studio/passkey,
metadata freeze and indexer acceptance are still pending. The private R2 binding/public
reads and hosted migrations have since [passed separately](token-launch-readiness-20261010.md). [Passive Kuru readiness](kuru-passive-readiness.json)
remains blocked after [live verification](kuru-verification-20261010/verification.md). Historical
Kuru policy version 1 stays readable; never substitute legacy addresses or a fixture policy.

## Configuration and preflight

API Worker runtime only:

| Binding                      | Meaning                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOKEN_LAUNCH_ENABLED`       | Explicit `true` after readiness and operator approval; absent means disabled                                                                                                                                                                                                                             |
| `TOKEN_LAUNCH_POLICY_JSON`   | Strict venue-discriminated versions 2/3 for V4 (historical Kuru version 1), chain 10143, complete deployment/source/implementation records and evidence, approved venue/preset hashes, authority/treasury, explicit agent admission, metadata origin, gas ceilings, RPC allowance and confirmation depth |
| `TOKEN_LAUNCH_AUTHORITY_KEY` | Dedicated grant-only secret; never the operator, treasury or master-wallet key                                                                                                                                                                                                                           |
| `TOKEN_METADATA`             | R2 bucket binding; no public write endpoint                                                                                                                                                                                                                                                              |

Existing `MONAD_RPC_URL`, Turnkey parent reader credentials and the registered Studio relying
party are reused. Each owner’s registered master wallet calls the factory directly. The dedicated
backend grant key and protocol fee treasury are separate roles, not deployment wallets. There is
no relayer, marketplace/Mera signer or new passkey registration.
No secret belongs in Next.js, `chain`, OpenAPI, Git or a transaction URL.

The V4 policy enumerates factory, curve deployer, adapter, escrow, locker, PoolManager,
PositionManager, StateView, Permit2 and AUSD. Historical Kuru policy keeps its own router/account
fields. AUSD requires its reviewed proxy implementation slot and runtime hash. Each record includes deployment block, runtime hash, source reference,
implementation slot/hash where applicable and an administration review. All readiness evidence
must be true. Historical policies 1/2 require a non-empty `allowedAgents` list of at most ten
approved testnet agent UUIDs. Policy 3 requires `admission: "eligible_creators"` and rejects
`allowedAgents`: every agent may pass the host scope check, but core still requires current creator
access, workspace ownership, actual publication, a registered master and no existing/pending token.
Mainnet, unknown modes and implicit admission defaults remain rejected. See
[the eligible-creator activation](token-launch-eligible-creators-20261011.md). Before a grant and again during preparation/submission, live reads check that
these contracts are bound to one another, the authority and treasury match, the preset commits
the approved venue hash, precision is version 2 and the fixed economics match.

Gas is estimated for the exact factory/action calldata and padded by 20%, then checked against
`maxGas`, `maxFeePerGas` and `maxGasCost`. Fee quoting bounds the usual twice-base-fee headroom by
that reviewed per-gas ceiling, while retaining the provider's full suggested priority fee. If the
current base fee plus that tip exceeds the ceiling, preparation refuses rather than lowering the
tip, raising the policy or retrying transport. Owner preflight rechecks the current base against
the exact prepared maximum and tip before signing and submission. Public curve preparation uses
the same bounded quote; deposit and wallet-transfer defaults remain unchanged. No default
commercial gas allowance is invented.

The 2026-10-11 read-only diagnosis confirmed `GAS_LIMIT_EXCEEDED` in an unsent owner operation:
no prepared transaction, passkey activity or transaction hash existed. A three-call public testnet
sample at block 70155537 returned a 100-gwei base and 2-gwei tip. The old reader proposed 202 gwei,
which always exceeded the reviewed 120-gwei ceiling despite the current 102-gwei requirement.
Controlled regressions now prepare a 3,000,000-gas estimate with 20% padding, a 120-gwei maximum
and a 0.432-MON worst-case cost, inside the unchanged 4,000,000-gas/0.48-MON policy. They also
refuse excessive current fees, gas units, total cost and fee rises after preparation. This proves
the calculation correction, not a deployed owner launch; the user's exact failed gas estimate was
not retained. No stored grant was sent to a provider for diagnosis and no real transaction or
manual deployment was performed.
The operation RPC allowance must be at least 250; execution uses the allowance minus 100,
leaving 100 reserved calls for explicit canonical receipt recovery. Exhaustion is an explicit
error, never a reason to retry transport or issue a new grant.

Indexer Worker runtime only:

- `TOKEN_INDEXER_ENABLED=true`, otherwise retain the existing unconfigured legacy path.
- The same `TOKEN_LAUNCH_POLICY_JSON` and a single reviewed `RPC_URLS` endpoint.
- `TOKEN_INDEXER_POLICY_JSON`: strict version 1 preserves one pass per tick. Strict version 2
  adds `maxPassesPerTick` (1–6). Both require `maxBlocks:100`, explicit
  `rpcRequestsPerPass`, `rpcRequestsPerDay`, `leaseSeconds` and `maxCurvesPerPass`. Version 2
  can catch up in bounded passes; it never increases the daily RPC budget automatically.
- Trusted `DATABASE` Hyperdrive binding, or an explicit loopback database in local mode.

The [dated hosted configuration record](token-indexer-hosted-20261011.md) pins the restricted
agent, policy hashes, deployment identities, gas ceilings and explicit indexer activation command.
It distinguishes provisioning from completed historical recovery and owner acceptance.

The chain-wide renewable lease and UTC daily RPC reserve are private PostgreSQL records.
Every call is reserved before transport. At most four RPC calls run concurrently; queued calls
stop after a failure and admitted calls drain before releasing the lease. Ranges remain at most 100 blocks; deployment blocks
are mandatory. Concurrent passes refuse admission. Lease loss prevents batch commit.
Older curves are rotated by cursor progress rather than permanently selecting the first agents.
Scheduling stops when every selected source reaches the pass snapshot, or on busy/gap/reorg/error.
A single 100-block pass per minute cannot keep up with the [measured testnet rate](token-launch-readiness-20261010.md#indexer-correction-and-capacity-boundary).
A controlled catch-up test or one public RPC sample does not establish sustained hosted capacity.

## Owner API and recovery

All Studio operations require a user JWT and ownership. API keys, HMAC, arbitrary wallets,
contracts, network changes and browser calldata are rejected.

| Method and suffix under `/v1/studio/agents/:id/token` | Action                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /`                                               | Private draft, confirmed token, indexed venue/fees and most recent operation    |
| `PUT /draft`                                          | Existing versioned name/ticker save                                             |
| `POST /authorize`                                     | Existing idempotent platform grant                                              |
| `POST /operations`                                    | Enumerated action, expected version and idempotency key                         |
| `POST /operations/:operationId/confirm`               | Exact passkey activity, or explicit submission of already retained signed bytes |
| `GET /operations/:operationId`                        | Explicit reconciliation of the same activity/transaction                        |
| `POST /operations/:operationId/cancel`                | Cancellation before signing admission                                           |

Actions are `launch`, `graduate`, `collect_curve_fees`, `collect_lp_fees`, and `claim_fees` with the
server-resolved AUSD or agent token. A master-scoped short transaction reserves intent before
external work. Active `(chain,sender,transactionNonce)` uniqueness prevents different agents
from preparing competing master-wallet nonces. Providers never run under PostgreSQL locks.

Preflight runs before the signing claim; refusal is a known unsent failure. Expired unforwarded
preparations are recovered by an explicit status read.

Signing has a durable one-time claim. Exact raw bytes and their verified sender/hash are stored
before a separate one-time submission claim. A delayed Turnkey activity is queried explicitly;
its same bytes can be submitted without another grant or passkey signature. An uncertain send
is only reconciled: there is no replacement, automatic rebroadcast or automatic launch retry.
If the signing response lost its activity identity entirely, operator investigation is required;
repeating the signing request is deliberately unavailable.

A canonical receipt with configured depth finalizes the transaction, but **does not attribute a
token**. Only a canonical confirmed factory event matching a registered grant does that. Until
indexing confirms it, a successful launch transaction remains token-confirmation pending.
Reorgs preserve history and remove orphaned active interpretations.

## Metadata, principal and fees

Preparing a launch freezes name, ticker and the current static avatar. JSON and SVG are written
under their content hashes with conditional creation and then verified. `/v1/token-assets/:file`
is public, immutable, hash-verified read access only (web path `/api/v1/token-assets/:file`).
Confirmed token cards read the frozen image, independent of subsequent agent edits.

The new V4 adapter/locker uses actual curve backing, committed hookless full-range liquidity
and permanent principal custody. Historical Kuru uses independent committed bands. No rescue, principal withdrawal, generic call or upgrade is
exposed. Remainders and donations cannot be counted as fee receipts. Actual collected LP fees are divided 50/50
in the received asset without an additional Pickler trading tax or conversion.

`claim(AUSD,master)` is the escrow's aggregate beneficiary/asset claim across that master's
agents. Studio labels it **Claim master AUSD fees**. Indexed balances show their block; they
are not current RPC quotes. The ledger queries only the configured escrow's canonical events.
Graduation is an explicit enumerated master-wallet action to the fixed adapter; it is available
only after canonical `CurveCompleted` evidence and on-chain preflight. No automatic call is made.
Token fee claims refer to that token asset. Historical V4 escrows retain their interpretation.

## Validation, previews and remote activation

See [the current integration guide](uniswap-v4-testnet-integration.md#acceptance-matrix-and-remaining-activation-work)
for the scenario matrix, four previews, reproducible commands, pinned sources and 34 independently
reconciled real testnet receipts. Offline/controlled checks and actual contract acceptance are
separate from the still-pending hosted JWT/passkey/metadata-freeze/indexer walkthrough.
[The readiness follow-up](token-launch-readiness-20261010.md) records hosted R2 reads, applied
migrations and ten additional buy/sell receipts without reinterpreting the earlier acceptance.

Use disposable local PostgreSQL with CREATEDB permission. Never target a deployed database in the
controlled acceptance suites. Run Next.js builds/type generation and rendered harnesses sequentially
in one checkout. `studio-loading.mjs` owns its servers. `DESIGN_BASE_URL` can reuse one fixture
server for token-preview, routing and sidebar checks; install Playwright globally, not in package.json.

The original implementation introduced no hosted activation. The readiness follow-up attached
R2 to the existing API without uploading source or enabling launch. Hosted migrations ran through
the separate main workflow. Product activation still requires approved economics, dedicated keys, immutable R2 metadata, reviewed policy,
restricted allowlist and verified indexer capacity. The test factory was explicitly disabled after
its faucet-funded contract acceptance.

## Preparation feedback and recovery

Studio shows **Preparing launch…** with a spinner and disables repeat clicks while the request is
in progress. The form remains mounted. Stored failures display one reviewed reason for RPC
availability/admission, gas ceilings, simulation refusal or immutable metadata storage; unknown
provider errors stay generic. Provider prose, signed bytes and private payloads are never rendered.

A known unsent preparation failure returns one durable `failed` operation and a null activity.
It does not sign, submit or widen gas/RPC budgets. Core admission/context/version errors still
reject. A lost response triggers only a database state read; an uncertain attempt retains its
idempotency key. **Refresh status** is explicit and does not sign or send. No automatic retry or
replacement launch is introduced.

Controlled checks cover delayed responses, one error announcement, preserved form DOM, legacy
HTTP failure recovery and reuse of the same request key after a lost response. Run:

```sh
node --import tsx scripts/design/studio-loading.mjs
node --import tsx scripts/design/token-preview.mjs http://localhost:3005
```

The hosted failed attempt inspected on 2026-10-11 had `PREPARATION_FAILED`, no prepared transaction,
no master-wallet activity and no transaction hash. Its original provider cause was not retained;
these controlled regressions do not establish that a real hosted launch succeeds. A historical
simulation was blocked by automatic approval review because it would send the stored signed grant
to the RPC provider; it was not executed.

## Owner curve trading (controlled acceptance)

The Token route now includes owner-only `buy`, `sell`, `approve_buy` and `approve_sell` through the
existing operations endpoints. This connects the registered Studio master wallet; the public
marketplace wallet prototype and post-graduation DEX swaps remain outside this change.

The request supplies only `trade.amount` in atomic units and explicit `trade.slippageBps` (1–100).
Buy amounts use six-decimal AUSD; sell amounts use the fixed 18-decimal agent token. Contracts,
recipient, chain and curve come from the confirmed factory launch, registered owner/master,
agent/network key and reviewed preset. No browser calldata, infinite allowance or provider settings
are accepted. Migration 0046 extends only the private action constraint and preserves old records.

Review obtains the on-chain quote (fees included), balance, allowance and remaining inventory.
The minimum received amount rounds up, keeping tolerance within the selected bound. Approvals
permit exactly the entered input amount and do not buy/sell. They require a separate explicit
passkey transaction. Existing sufficient allowance is detected without requesting another signature.
After approval confirms, the owner explicitly reviews and signs the trade. Both assets stay in the
master wallet; the agent's trading wallet is not used. A signed swap's recipient and minimum cannot
be changed when its status is checked. Exact simulation runs again before signing and submission;
transport uncertainty still requires reconciliation of the same activity/transaction.

Curve completion blocks curve swaps. Exact-output remainder purchase and DEX wallet swaps
remain pending. Public visitor curve trading is now a separate non-custodial surface documented in
[Public token trading](public-token-trading.md). No launcher/indexer activation, remote migration or real transaction is performed by
this change; the existing indexer is unchanged and its redesign is deferred.

Controlled validation commands, from the repository root:

```sh
npm run build:shared
node --import tsx --test packages/core/test/token-operations.test.ts packages/infrastructure/test/uniswap-operation-driver.test.ts apps/web/test/token-preview.test.ts
TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55440/pickler node --import tsx --test --test-concurrency=1 packages/infrastructure/test/token-operations.test.ts packages/infrastructure/test/token-launch.test.ts workers/api/test/studio-token-route.test.ts
node scripts/design/token-preview.mjs http://localhost:3005
```

The database command requires a separate disposable loopback PostgreSQL with CREATEDB. Never use
remote credentials. Local previews retain the four existing links. Start from
`/studio/agents/preview-live/token?stage=perpl-token-empty`, save, complete the simulated launch,
then review fixed simulated approvals/buy/sell. Fixture quotes are generated by
`npm run tokens:fixtures` using the Solidity-parity core math; no provider, passkey or transaction
runs in the preview.

| Scenario                                                                             | Evidence                                         | Status                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------- |
| Exact amounts, tolerance, changed-token fence, idempotency and one-time signing      | Controlled core/driver tests                     | Passed locally            |
| Separate approval/buy/sell, owner isolation and concurrent confirmation              | Disposable PostgreSQL and injected API transport | Passed locally            |
| Mobile/desktop review, cancellation, preserved forms, keyboard and no provider calls | Local rendered preview harness                   | Passed at 1280/380/320 px |
| Types, lint, format, architecture, OpenAPI and Web/API compilation                   | Local checks and API dry-run                     | Passed locally            |
| Full Design surfaces, tokens, contrast and type                                      | 434 source files and 126 rendered routes         | Passed locally            |
| Hosted owner passkey launch, buy/sell and fee actions                                | Human passkey and restricted runtime activation  | Pending                   |
| Canonical indexer recovery and hybrid scheduling                                     | Existing worker; no changes in this delivery     | Deferred to the end       |
| DEX swaps and exact-output final inventory                                           | No production implementation in this change      | Pending                   |
