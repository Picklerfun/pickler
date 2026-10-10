# Uniswap V4 testnet launcher and acceptance

## Result and evidence boundary

On October 10, 2026, a real faucet-funded Pickler launch completed on Monad testnet **10143**:
factory authorization, fixed-supply token, curve buy/sell, complete inventory exhaustion, atomic
Uniswap V4 graduation, Universal Router buy/sell, separate fee collection and creator/protocol
claims in AUSD and the agent token. Permanent LP principal remained unchanged.

[Public receipt/balance record](uniswap-v4-testnet-acceptance.json) contains **34 successful
transactions**, 22,974,522 gas charged and **2.343401244 MON** gas cost. The approved worst-case
ceiling was 25 million gas at 120 gwei, or **3 test MON**; no fiat or paid-provider purchase occurred.
A [second public RPC reconciliation](uniswap-v4-testnet-reconciliation.json) independently verified
all receipt/block hashes, deployed code hashes, locker ownership, liquidity and the disabled
factory gate at block **69,861,150**. The test factory has `launchesEnabled=false` after acceptance.

This proves the **contract flow**. It does not prove remote Studio JWT ownership, the user's
passkey, production R2 metadata, hosted database migration, hosted indexer throughput or general
activation. Acceptance used an EOA faucet wallet and dedicated test grant authority/treasury;
metadata is explicitly `urn:pickler:controlled-testnet-acceptance`, not a production URI.
Mainnet and general launches remain disabled. Private keys and raw signing journals are excluded.

Key transactions on [Monad testnet explorer](https://testnet.monadexplorer.com/):

- [Launch](https://testnet.monadexplorer.com/tx/0x65a6de6a6974265b0fa176b591b0a7a4bf482c109212e22b10c61eb3f595e9c4)
- [Atomic graduation](https://testnet.monadexplorer.com/tx/0x161c3428516ec1a0de5356192134dcc66a4df43e68084f0a1e21e06bd1bc3d6e)
- [Fee-only collection](https://testnet.monadexplorer.com/tx/0xb31e82d9ec6f6c6f7f11698221c028acb95e6410a30bc2d3eadd9f69e7e75b29)
- [Creator AUSD claim](https://testnet.monadexplorer.com/tx/0xc267adae2ba98d3b4ee7c23d8cf3ee77d6ae7d80f1e56a60746716f78f42948d)

The permanent locker is `0x94184bE43584d6106E4eeEd20f1BD53784d365FF`, owning PositionManager
NFT **101**, liquidity **366606052182305575** before and after collection. Actual curve backing
was **31,999.999999 AUSD** after the preliminary buy/sell cycle; graduation uses the real amount,
not the reference fixture's 31,999.999998. Locked dust is **595 atomic AUSD units** and **1,324,435
atomic token units**. Donations and dust never become fee receipts.

## Verified external generation

This is the **Monad-maintained testnet deployment**, not an official Uniswap testnet deployment.
The [pinned manifest](https://github.com/monad-developers/uniswap-v4-hooks-example/blob/c3cc78a88f10e5ba141cd6fb632f31db83c0daf8/shared-deployment-10143.json)
and [two-RPC observation](uniswap-v4-testnet-verification.json) pin runtime identities and bindings
at block **69,853,802**, hash
`0xf9c9fe2b9a6794f002a8a99cac318c5945580b619426603cd6422cd2fa49e914`.
The registry includes PoolManager, PositionManager, StateView, Quoter, Universal Router and Permit2.
PositionManager and StateView both resolve the recorded PoolManager; PositionManager resolves
Permit2. PoolManager owner and protocol-fee controller were zero at the observed block.

Pinned upstream source revisions are Universal Router `999d561c3ad58fb5cab91b602911f3c75591a9c7`,
V4 periphery `3231810e39b8c4d569b9d66907fa4ef8cd2cec22`, and V4 core
`59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`. Existing Foundry submodule pins are unchanged.
The router's exact-input-single tuple has **six fields**, including `minHopPriceX36`; the minimal
Pickler interface and fork/real acceptance use the actual deployed router, not an upstream
UNLICENSED helper. Only public minimal interfaces are added; no Kuru SDK is installed.

AUSD is the [Agora-published testnet asset](https://docs.agora.finance/developer/contract-deployments),
`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, six decimals. Its EIP-1967 implementation is
`0xc1e3c7d486d6a92fbe920232e439eec2ceb112da`, runtime hash
`0x2e612fde7bb56c8b5c52e68eb50ded8302e686c5dd42b84f71a9f9d52bc99a90`.
The proxy admin is `0x2ffb5584c3c8ad18b3fc8872b91aa49a2ac8d169`. Issuer upgrades/freeze remain an
external asset dependency; a proxy runtime hash alone is insufficient. Runtime preflight checks
the reviewed implementation slot and hash as well as the proxy, decimals and contract bindings.
The [faucet guide](https://docs.agora.finance/instant-settlement/guides/getting-testnet-tokens)
provides the testnet source. Acceptance respected spacing of at least 62 seconds between requests;
no faucet actors or rate-limit bypasses were introduced.

Kuru was [verified first](kuru-verification-20261010/verification.md): published testnet legacy
implementations cannot satisfy the required separate passive claim with permanent principal.
The old controlled Kuru implementation and its records remain independent and blocked. No
silent legacy fallback or reinterpretation of historical V4/Kuru projections is allowed.

## Fixed new profile and custody

`PicklerGraduationAdapterV4V2`, `PicklerLiquidityLockerV2` and `PicklerCurveDeployerV4V2` are a
separate testnet-only generation. Preset version **4** commits the full V4 venue hash and precision
policy **2**. Economics remain 21 million fixed supply, 80/20 curve/LP, zero creator allocation,
AUSD quote, MON gas, 1% curve trades, 50/50 curve fees and zero launch fee.

The controlled V4 profile is hookless, full range, **1% native LP fee** (`fee=10000`), tick spacing
**200**, and maximum pre-existing square-root price deviation **5 bps**. Those terms are
hash-committed. The product operator must explicitly approve them through `economicsApproved`
before general composition; acceptance is not an implicit approval of future commercial settings.
There is **no additional Pickler swap tax** after graduation. Actual collected LP fees are split
50/50 in the asset received, without conversion. Odd atomic units are handled by the existing
escrow; the public receipt record shows the exact split.

Graduation checks canonical factory identity, preset/venue, ready curve, deployed bindings and
code hashes, exact actual reserve transfers, normalized price continuity and liquidity use.
Any failure rolls back curve release and NFT creation atomically. Exact temporary ERC-20/Permit2
approvals are revoked. Remainders are limited and permanently accounted for. The immutable locker
has no withdrawal, NFT transfer/approval, third-party delegation, generic call, rescue or upgrade.
A zero-liquidity decrease collects fees, verifies unchanged owner/liquidity and remits only its
balance delta to the exact-receipt V2 escrow. Principal, donations and remnants stay locked.

## API, indexer and local preview

[Token operations](token-launch-operations.md) retains owner JWT, private optimistic drafts,
backend-only EIP-712 authority, immutable R2, existing master-wallet passkey and durable exact-byte
submission/recovery. New policy **2** explicitly selects `uniswap_v4`; historical policy **1**
retains Kuru meaning. A private configuration hash fences preparation against policy changes.
State adds optional planned venue/native LP fee and confirmed pool ID/NFT information; the browser
receives prepared data and never chooses contracts, networks, preset or financial formulas.

Drizzle **0045** adds private canonical V4 graduation snapshots without changing prior migrations.
The indexer reads exact event-block NFT/key/liquidity data before SQL, checks canonical block hash
again, fences the lease, reserves RPC before transport and commits the registered grant/launch
projection. Replay and reorg restoration retain history without cross-venue attribution.
The existing 100-block ranges, four-call transport concurrency and explicit daily budgets remain.
Hosted catch-up capacity must be measured before activation.

The compact launcher shows Uniswap, permanent liquidity lock, pool/NFT, native 1% fee and actual
50/50 receipts. Actions remain explicit. Local fixture controls never call providers/passkeys or
open fabricated explorer links. The four previews are:

1. [Studio without token](http://localhost:3005/studio/agents/preview-live/token?stage=perpl-token-empty)
2. [Studio confirmed fixture](http://localhost:3005/studio/agents/preview-live/token?stage=perpl-token-launched)
3. [Public profile without token](http://localhost:3005/agents/halftime?stage=token-empty)
4. [Public profile confirmed fixture](http://localhost:3005/agents/halftime?stage=token-launched)

## Reproduction and explicit real-transaction gate

Offline checks never contact providers:

```sh
npm run db:up
npm run build:shared
npm test
npm run contracts:test
npm run contracts:abi
node --test scripts/contracts/*.test.mjs
npm run typecheck
npm run lint
npm run format:check
npm run check:architecture
npm run api:openapi -- --output /tmp/pickler-token-openapi.json
npm run build:workers
npm run design:check
node scripts/design/token-preview.mjs
node scripts/design/studio-routing.mjs
node scripts/design/sidebar-motion.mjs
node --import tsx scripts/design/studio-loading.mjs
```

The explicit fork checks need an archive-capable testnet endpoint and do not send real transactions:

```sh
MONAD_TESTNET_RPC_URL=https://rpc.ankr.com/monad_testnet forge test --root contracts --match-path 'test/fork/*V4Reference.t.sol'
```

These new reference checks use pinned block 69,853,802. Older fork tests keep their historical
pins; if an RPC cannot serve an old block, use an archive-capable endpoint, never replace the pin
with latest or claim those tests passed remotely.

To repeat faucet-funded contract acceptance, first build and start a **task-owned** Anvil fork.
Use a fresh directory outside Git and a mode-600 env file containing `DEPLOYER_PRIVATE_KEY`.
The EOA needs at least 3 test MON plus the separate 0.05 MON transfer to its own test treasury.
Do not put a secret in a command argument. These commands are **not ordinary tests**:

```sh
anvil --fork-url https://rpc.ankr.com/monad_testnet --fork-block-number 69853802 --port 8555
node scripts/contracts/uniswap-testnet-acceptance.mjs --preflight --rpc http://127.0.0.1:8555 --key-file /private/operator.env --output /private/acceptance
# Only after explicit operator authorization and inspection of the successful preflight:
node scripts/contracts/uniswap-testnet-acceptance.mjs --broadcast-testnet --key-file /private/operator.env --output /private/acceptance
```

No arguments prints help without reading a key or starting transport. Other networks/endpoints,
missing modes, stale preflights, changed compiler bytecode/wallet, gas excess and provider identity
changes are refused. The journal persists exact signed bytes before send; uncertainty stops for
same-hash reconciliation. It never replaces transactions or automatically repeats grants. Private
journals and generated test authority/treasury keys stay outside Git. Only filtered public receipts
belong in the repository. The acceptance script is a reproducible operator tool, not the hosted
launcher, deployment automation or a production metadata writer.

## Acceptance matrix and remaining activation work

| Scenario                                                                                                                     | Evidence                                                                                    | Status                |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------- |
| Curve solvency/inventory/rounding, donations, grants, replay/rotation and principal isolation                                | 163 offline Solidity tests in 18 suites, including fuzz/invariants                          | Passed                |
| V4 canonical owner/key/liquidity validation, tampered price/code, failed mint/rollback, approvals and fee/remnant separation | Controlled adversarial contract tests                                                       | Passed                |
| Historical behavior, owner/version/concurrency, exact-byte recovery, R2, migration, V4 projection/reorg and RPC admission    | Local PostgreSQL and scripted providers                                                     | Passed                |
| Root TypeScript/API/web suites                                                                                               | 3,056 passed, 9 intentionally skipped; additional V4 indexer and CLI guards pass separately | Passed                |
| Real factory/curve/graduation/swaps/50-50 claims                                                                             | 34 canonical testnet receipts; 2.343401244 MON; independently reconciled                    | Passed                |
| Native router tuple and minimum output                                                                                       | Corrected six-field encoding, local fork plus real swaps                                    | Corrected and passed  |
| Token UI/navigation/mobile/keyboard and design                                                                               | Local fixtures; final check record in PR                                                    | Controlled validation |
| Kuru passive readiness                                                                                                       | Published legacy testnet implementations examined                                           | Blocked; no fallback  |
| Hosted JWT/master passkey, immutable production R2 and operator key rotation                                                 | Controlled ports implemented; remote product acceptance not run                             | Pending activation    |
| Hosted migration 0045, factory/preset allowlist and economics approval                                                       | No hosted changes performed                                                                 | Pending activation    |
| Hosted indexer finality/reorg recovery and measured catch-up/RPC budget                                                      | Controlled indexer passed; remote throughput not measured                                   | Pending activation    |
| Mainnet or general launch                                                                                                    | Disabled                                                                                    | Outside this delivery |

Before enabling even an allowlisted hosted agent, rotate from test keys to a dedicated backend
only grant authority, approve full economics, verify immutable metadata origins/R2, apply append-only
migrations, set reviewed deployment blocks/hashes and configure trusted indexer/database bindings.
Then run one explicitly budgeted hosted Studio → passkey → launch → indexed confirmation acceptance.
Do not enable general launch or mainnet based solely on the contract acceptance above.
