# Testnet launcher and passive Kuru operations

## Current boundary

The launcher composes a dedicated backend EIP-712 grant authority, immutable R2 metadata,
Studio's existing Turnkey passkey, a direct master-wallet factory transaction, private durable
operations and a bounded indexer. Ordinary composition remains disabled. Mainnet is rejected.

[Passive readiness](kuru-passive-readiness.json) is **blocked**. The legacy transaction record
is compatibility evidence only. No passive deployment, admission for arbitrary Pickler tokens,
fee-only collection or end-to-end Pickler graduation has been accepted remotely. Do not turn on
any gate by copying legacy addresses or a controlled policy fixture.

## Configuration and preflight

API Worker runtime only:

| Binding                      | Meaning                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOKEN_LAUNCH_ENABLED`       | Explicit `true` after readiness and operator approval; absent means disabled                                                                                                                                                                 |
| `TOKEN_LAUNCH_POLICY_JSON`   | Strict version 1, chain 10143, complete deployment/source/implementation records and evidence, approved venue/preset hashes, authority/treasury, restricted agent UUIDs, metadata origin, gas ceilings, RPC allowance and confirmation depth |
| `TOKEN_LAUNCH_AUTHORITY_KEY` | Dedicated grant-only secret; never the operator, treasury or master-wallet key                                                                                                                                                               |
| `TOKEN_METADATA`             | R2 bucket binding; no public write endpoint                                                                                                                                                                                                  |

Existing `MONAD_RPC_URL`, Turnkey parent reader credentials and the registered Studio relying
party are reused. There is no relayer, marketplace/Mera signer or new passkey registration.
No secret belongs in Next.js, `chain`, OpenAPI, Git or a transaction URL.

The policy must enumerate the factory, Kuru curve deployer, adapter, escrow, locker, passive
router and account core. Each record includes deployment block, runtime hash, source reference,
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

The new Kuru adapter/vault/locker path uses actual curve backing, deterministic committed bands,
and permanent principal custody. No rescue, principal withdrawal, generic call or upgrade is
exposed. Remainders and donations cannot be counted as fee receipts. Kuru fees are divided 50/50
in the received asset without an additional Pickler trading tax or conversion.

`claim(AUSD,master)` is the escrow's aggregate beneficiary/asset claim across that master's
agents. Studio labels it **Claim master AUSD fees**. Indexed balances show their block; they
are not current RPC quotes. The ledger queries only the configured escrow's canonical events.
Graduation is an explicit enumerated master-wallet action to the fixed adapter; it is available
only after canonical `CurveCompleted` evidence and on-chain preflight. No automatic call is made.
Token fee claims refer to that token asset. Historical V4 escrows retain their interpretation.

## Controlled acceptance and remote checklist

Run from the repository root with Node 22.22+ and npm 10.9.3:

```sh
npm run db:up
npm run build:shared
node --import tsx --test packages/core/test/token-*.test.ts packages/infrastructure/test/token-*.test.ts workers/api/test/studio-token-route.test.ts
FOUNDRY_OFFLINE=true npm run contracts:test
FOUNDRY_OFFLINE=true npm run contracts:abi
npm run api:openapi -- --output /tmp/pickler-token-openapi.json
npm run typecheck
npm run lint
npm run format:check
npm run check:architecture
npm run build:workers
npm run design:check
node scripts/design/token-preview.mjs
node scripts/design/studio-routing.mjs
node scripts/design/sidebar-motion.mjs
node --import tsx scripts/design/studio-loading.mjs
```

The four non-production fixtures remain:

1. `/studio/agents/preview-live/token?stage=perpl-token-empty`
2. `/studio/agents/preview-live/token?stage=perpl-token-launched`
3. `/agents/halftime?stage=token-empty`
4. `/agents/halftime?stage=token-launched`

Fixtures can cancel, fail, continue and confirm a simulated operation. They never stamp a real
passkey, fetch a provider or open an explorer with a fictional address.

| Scenario                                                                                            | Status              | Evidence boundary                                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| Fixed economics, curve rounding/solvency, grants, Kuru atomic rollback and fee/principal separation | Passed              | 151 offline Solidity tests across 17 suites; no remote fork                              |
| Owner isolation, drafts, master admission, signing/send recovery and immutable R2 objects           | Passed              | Controlled ports and isolated PostgreSQL                                                 |
| Canonical Kuru attribution, reorg recovery, RPC admission and four-stream catch-up                  | Passed              | Controlled logs/receipts and isolated PostgreSQL; bounded concurrency and budgets        |
| Keyboard, preserved form, mobile/desktop, launch/cancel/failure/confirmation and four token states  | Passed              | Local browser fixtures at 320, 380 and 1280 pixels; all API/provider requests prohibited |
| Studio loading/errors, market retry and wallet regressions                                          | Passed              | Synthetic Auth/API responses; no provider calls                                          |
| Surfaces, tokens, contrast and typography                                                           | Passed              | Design checks over all 126 local fixture routes                                          |
| Driver's escrow beneficiary address assertion                                                       | Corrected           | Case-insensitive address comparison; all five driver tests passed after correction       |
| Prior Kuru legacy buy/sell/redeem                                                                   | Historical evidence | Real testnet transactions already recorded; no Pickler graduation claim                  |
| Passive generation, token admission, units, administration and separate fee claim                   | External pending    | Readiness remains blocked                                                                |
| Full faucet launch, fill, graduation, Kuru buy/sell and claims; remote indexer throughput           | External pending    | Requires a verified passive deployment and approved RPC/gas budget                       |

Use a disposable PostgreSQL database with `CREATEDB` permission. Override `TEST_DATABASE_URL`
when the default port is occupied; this acceptance used a task-owned container on loopback port
55433 and did not reset any existing database. The broad local suite encountered intermittent
PostgreSQL connection timeouts under host resource pressure; do not interpret it as a fully
passing broad run. The corrected driver suite and affected database scenarios are checked
separately, and PR checks provide the final repository-wide result.

Run rendered harnesses and Next.js type generation/builds sequentially in one checkout.
`studio-loading.mjs` owns its servers and must not run alongside another Next.js development
server in that checkout. A shared fixture server can be passed through `DESIGN_BASE_URL` to
`token-preview.mjs`, `studio-routing.mjs` and `sidebar-motion.mjs`. Install Playwright globally
as required by the repository instructions; do not add it to application dependencies.

Before remote acceptance, approve a reproducible passive deployment and full venue economics,
apply migrations through the operator connection, configure R2/secret/bindings and verify the
indexer from the actual factory deployment. Preflight sets an explicit gas ceiling. Record
transaction receipts, canonical blocks, balances and positions before/after every step. Use
faucet assets only; no fiat or implicit paid transport. Do not merge, enable general launches
or deploy mainnet as part of controlled acceptance.
