# Testnet launcher and versioned venue operations

## Current boundary

The launcher composes a dedicated backend EIP-712 grant authority, immutable R2 metadata,
Studio's existing Turnkey passkey, a direct master-wallet factory transaction, private durable
operations and a bounded indexer. Ordinary composition remains disabled. Mainnet is rejected.

The current launcher supports the separate reviewed Uniswap V4 policy version 2. Its
[real contract acceptance](uniswap-v4-testnet-integration.md) completed, but hosted Studio/passkey,
R2 and indexer acceptance is still pending. [Passive Kuru readiness](kuru-passive-readiness.json)
remains blocked after [live verification](kuru-verification-20261010/verification.md). Historical
Kuru policy version 1 stays readable; never substitute legacy addresses or a fixture policy.

## Configuration and preflight

API Worker runtime only:

| Binding                      | Meaning                                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOKEN_LAUNCH_ENABLED`       | Explicit `true` after readiness and operator approval; absent means disabled                                                                                                                                                                                                                        |
| `TOKEN_LAUNCH_POLICY_JSON`   | Strict venue-discriminated version 2 for V4 (historical Kuru version 1), chain 10143, complete deployment/source/implementation records and evidence, approved venue/preset hashes, authority/treasury, restricted agent UUIDs, metadata origin, gas ceilings, RPC allowance and confirmation depth |
| `TOKEN_LAUNCH_AUTHORITY_KEY` | Dedicated grant-only secret; never the operator, treasury or master-wallet key                                                                                                                                                                                                                      |
| `TOKEN_METADATA`             | R2 bucket binding; no public write endpoint                                                                                                                                                                                                                                                         |

Existing `MONAD_RPC_URL`, Turnkey parent reader credentials and the registered Studio relying
party are reused. There is no relayer, marketplace/Mera signer or new passkey registration.
No secret belongs in Next.js, `chain`, OpenAPI, Git or a transaction URL.

The V4 policy enumerates factory, curve deployer, adapter, escrow, locker, PoolManager,
PositionManager, StateView, Permit2 and AUSD. Historical Kuru policy keeps its own router/account
fields. AUSD requires its reviewed proxy implementation slot and runtime hash. Each record includes deployment block, runtime hash, source reference,
implementation slot/hash where applicable and an administration review. All readiness evidence
must be true. `allowedAgents` lists at most ten approved testnet agent UUIDs; every other agent
remains unable to launch even when the host gate is enabled. Before a grant and again during preparation/submission, live reads check that
these contracts are bound to one another, the authority and treasury match, the preset commits
the approved venue hash, precision is version 2 and the fixed economics match.

Gas is estimated for the exact factory/action calldata and padded by 20%, then checked against
`maxGas`, `maxFeePerGas` and `maxGasCost`. No default commercial gas allowance is invented.
The operation RPC allowance must be at least 250; execution uses the allowance minus 100,
leaving 100 reserved calls for explicit canonical receipt recovery. Exhaustion is an explicit
error, never a reason to retry transport or issue a new grant.

Indexer Worker runtime only:

- `TOKEN_INDEXER_ENABLED=true`, otherwise retain the existing unconfigured legacy path.
- The same `TOKEN_LAUNCH_POLICY_JSON` and a single reviewed `RPC_URLS` endpoint.
- `TOKEN_INDEXER_POLICY_JSON`: strict version 1, `maxBlocks:100`, explicit
  `rpcRequestsPerPass`, `rpcRequestsPerDay`, `leaseSeconds` and `maxCurvesPerPass`.
- Trusted `DATABASE` Hyperdrive binding, or an explicit loopback database in local mode.

The chain-wide renewable lease and UTC daily RPC reserve are private PostgreSQL records.
Every call is reserved before transport. At most four RPC calls run concurrently; queued calls
stop after a failure and admitted calls drain before releasing the lease. Ranges remain at most 100 blocks; deployment blocks
are mandatory. Concurrent passes refuse admission. Lease loss prevents batch commit.
Older curves are rotated by cursor progress rather than permanently selecting the first agents.
A controlled catch-up test does not establish that a remote RPC can keep up with testnet.

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
separate from the still-pending hosted JWT/passkey/R2/indexer walkthrough.

Use disposable local PostgreSQL with CREATEDB permission. Never target a deployed database in the
controlled acceptance suites. Run Next.js builds/type generation and rendered harnesses sequentially
in one checkout. `studio-loading.mjs` owns its servers. `DESIGN_BASE_URL` can reuse one fixture
server for token-preview, routing and sidebar checks; install Playwright globally, not in package.json.

No hosted migration, admission flag, app deployment or mainnet launch is introduced. Product
activation requires approved economics, dedicated keys, immutable R2 metadata, reviewed policy,
restricted allowlist and verified indexer capacity. The test factory was explicitly disabled after
its faucet-funded contract acceptance.
