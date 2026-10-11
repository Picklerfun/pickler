# Testnet launcher readiness — 10 October 2026

## Wallet responsibilities

Each authenticated owner's **own registered master wallet** calls the factory directly through
Studio's existing passkey. There is no central deployment wallet or relayer. Pickler's dedicated
backend grant key authorizes eligible launches; it cannot replace the creator's authorization or
spend their funds. The protocol fee treasury receives the protocol share and is a separate role.
The faucet operator used in the receipt evidence below is a test buyer, not a user deployment wallet.

## Hosted R2 and database evidence

Created the private Standard R2 bucket `pickler-token-metadata-testnet` and bound it as
`TOKEN_METADATA` to `pickler-api-staging`. The settings-only update inherited all 33 existing
bindings. It uploaded no Worker source and enabled no launcher gate. The committed API
configuration retains this binding for subsequent releases. Wrangler 4.133.0 supported these
operations; no CLI update was required.

Generated frozen SVG/JSON with production `createTokenMetadata`, uploaded them through operator
Wrangler, and read both through the existing public, hash-verified route. Exact bytes, content
hash, immutable cache policy, MIME, `nosniff` and sandbox CSP matched; an unknown hash returned 404.
The bucket itself has no public write endpoint. The assets say **Pickler R2 acceptance — not launched**;
they are not an emitted agent token. This verifies operator writes and hosted reads, not the
still-pending hosted grant-freeze write path.

- [Frozen acceptance metadata](https://app.pickler.fun/api/v1/token-assets/a785d45341a6cf25f76d83302b3c94e5f65cf6443376c3b17ab4191dd2a13637.json)
- [Frozen acceptance avatar](https://app.pickler.fun/api/v1/token-assets/7dcc750381f98bbed6f1a753d67a66a84abc85b0218357812953da7348d46e3a.svg)

The [main migration workflow](https://github.com/Picklerfun/pickler/actions/runs/38074591474)
succeeded for `f8ba538ee60c735254f2ce751ea8baa4055f6bf4`: 46 migrations applied, zero pending,
including 0041–0045. No additional migration was created or manually replayed in this follow-up.

## Real buy/sell acceptance

Used the existing graduated token `0x066C47CdE99397869809E0DA2d0d4FE40b14B375` in Monad testnet
(10143), with testnet AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`. Verified the pinned
router, Permit2, quoter, PositionManager and token runtime hashes, plus the AUSD proxy
implementation hash and six decimals. A local fork preflight preceded submission.

The initial local preflight refused the fee estimate before signing: the provider's fee padding
exceeded 120 gwei. The revised test capped the estimate at the original 120-gwei ceiling only
while the current base fee plus priority still fit. The 0.18 test MON gas budget was not increased.

| Item                                            | Observed result                                              |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Purchase input                                  | 1 AUSD                                                       |
| Tokens received                                 | 129.744613920264130273                                       |
| Sale input                                      | Exactly the purchased tokens                                 |
| AUSD returned                                   | 0.980100                                                     |
| Actual gas, including approvals and revocations | 0.09844734 test MON                                          |
| Gas ceiling                                     | 0.18 test MON; 1,500,000 gas at at most 120 gwei             |
| Locked NFT 101 liquidity before/after           | 366606052182305575, unchanged                                |
| Final token balance                             | Same as before the round trip                                |
| ERC-20 and Permit2 allowances                   | Zero for both assets after the test                          |
| Independent reconciliation                      | Ten successful canonical receipts, at least 12 confirmations |

- [Purchase receipt](https://testnet.monadscan.com/tx/0x1d9eea64c8270098219455a099f1b8280b4bb06af0409520f9122ebb9f8ce32c)
- [Sale receipt](https://testnet.monadscan.com/tx/0x2157a5297c3492b3673880ec5aafed3bc379539714c86865857e35a3ae4a1b07)

The two swaps and eight exact approvals/revocations used 140 RPC requests; independent
read-only reconciliation used 29. No paid model/X calls or fiat assets were used. Raw signed
bytes and private intent journals remain local and are excluded from the public evidence.
This is direct contract purchase acceptance. It does not establish a browser buy/sell flow or
hosted owner passkey launch. Earlier factory/curve/graduation/fee acceptance remains recorded
unchanged in [the V4 guide](uniswap-v4-testnet-integration.md).

## Indexer correction and capacity boundary

Measured about **198.675 testnet blocks/minute** over 1,000 blocks. A single scheduled 100-block
range per minute cannot keep up. Indexer policy version 1 keeps its historical one-pass behavior;
version 2 explicitly adds `maxPassesPerTick` (integer 1–6). Each infrastructure pass still owns
its renewable lease, per-pass and UTC daily RPC admission, at most four concurrent requests,
canonical projection and at-most-100-block ranges.

The Worker stops at the confirmed snapshot, tick limit, busy lease, gap, reorg or error.
An error remains an error; a gap/reorg waits for the next Cron instead of immediately retrying.
The controlled PostgreSQL regression advances four canonical cursors across multiple ranges,
replays without duplicate blocks and verifies admission/lease release. Scheduling tests exercise
historical version 1, bounded version 2 and quota/failure stops.

One public RPC sample fetched 100 contiguous headers with four concurrent calls in 11.961 seconds,
using 102 total requests including the two rate-measurement reads. Parent continuity passed.
This sample excludes hosted PostgreSQL/projection/Worker costs and is **not sustained throughput
acceptance**. Deployment, daily budget sizing, catch-up and finality/reorg recovery remain pending.
No runtime quota was increased and the correction was not remotely deployed in this record.

## Scenario matrix

| Scenario                                                                         | Evidence                                                                                 | Status                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| User master is the direct factory caller                                         | Existing creator and transaction authorization contracts; responsibility clarified above | Implemented; hosted signing pending |
| Private R2 binding and public integrity-checked reads                            | Actual Cloudflare binding/read results                                                   | Passed remotely                     |
| Hosted database through migration 0045                                           | Successful main Actions run, 46 applied / zero pending                                   | Passed remotely                     |
| Buy and sell the graduated token                                                 | Ten independently reconciled testnet receipts, unchanged principal                       | Passed remotely                     |
| Bounded indexer scheduling and canonical replay                                  | Controlled schedule tests and isolated PostgreSQL                                        | Corrected and passed locally        |
| Sustained hosted indexer capacity                                                | One bounded RPC sample only; no hosted activation                                        | Pending                             |
| Complete Studio → owner JWT → passkey → frozen metadata → launch → indexed token | No complete hosted walkthrough yet                                                       | Pending                             |
| General launch/mainnet                                                           | Gates remain disabled                                                                    | Outside acceptance                  |

## Local validation

All 34 affected indexer/config/scheduling tests passed without skips against a dedicated disposable
PostgreSQL 17.6 on loopback port 55433. The shared build, infrastructure/indexer TypeScript,
affected lint/format checks, architecture, staging topology and API/indexer Worker dry-run builds
passed. An initial run lost the shared local database connection; the complete suite then passed
sequentially in the isolated database. No hosted schemas were modified by these tests.
No UI, HTTP contract, dependency or Solidity source changed in this follow-up.

## Reproducible read-only and controlled checks

Run from the repository root, using Node 22.22+ and disposable local PostgreSQL:

```sh
npm run build:shared
node --import tsx --test workers/indexer/test/*.test.ts packages/infrastructure/test/launch-indexer.test.ts packages/infrastructure/test/uniswap-indexer.test.ts
npm run typecheck --workspace=@pickler/infrastructure
npm run typecheck --workspace=@pickler/indexer-worker
npm run check:architecture
npm run check:staging
npm run build:worker --workspace=@pickler/api
npm run build:worker --workspace=@pickler/indexer-worker
curl -i https://app.pickler.fun/api/v1/token-assets/a785d45341a6cf25f76d83302b3c94e5f65cf6443376c3b17ab4191dd2a13637.json
```

[The public JSON record](token-launch-readiness-20261010.json) includes exact units, all ten
receipt hashes, reconciliation, settings deployment identifiers and the bounded RPC sample.
These commands do not re-run swaps, enable gates or deploy source. See
[the operations guide](token-launch-operations.md) before preparing an allowlisted hosted launch.
