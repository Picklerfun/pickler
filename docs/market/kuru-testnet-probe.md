# Kuru legacy compatibility probe — Monad testnet

Executed on 2026-10-10 UTC (2026-10-09 in America/Bogota). All eleven signed transactions succeeded on Monad testnet, chain ID **10143**. Public receipt verification and **86 historical accounting checks** passed through `https://rpc.ankr.com/monad_testnet`. The primary Monad RPC failed during the historical read pass; no transaction was resent to resolve that read failure.

This is a standalone compatibility probe using the actual `PicklerAgentToken` compiler artifact and actual testnet AUSD. It does not launch an agent through Pickler's factory or demonstrate curve graduation, liquidity locking, fee escrow, the indexer, mainnet, or Kuru's newer passive-position system. Operational launch remains disabled.

The public machine-readable record is [kuru-testnet-probe.json](kuru-testnet-probe.json). It contains receipts, canonical block hashes, raw balance checks, code hashes, deployed implementation addresses and source hashes. It contains no credentials or signing material.

## Contract licensing and provenance

Pickler-authored Solidity in `contracts/src/` and `contracts/test/` now uses the [MIT license](../../contracts/LICENSE). This permits reuse, modification and commercial distribution while retaining the notice. Dependencies keep their original licenses; this does not relicense Kuru's SDK or the rest of the monorepo.

The token was built with Solidity 0.8.30, optimization enabled with 200 runs, from base commit `ee3652f968586fa6c6581c1b5c6e00eccbec3bf3` plus MIT headers. Every compiled source hash matched the files used for deployment. Deployed runtime bytecode exactly matched the token compiler artifact: `0xe2faa0b753d4fe77966602659b666dad378882276495398d346aacbf5b1c2bb1`. No logic was changed for this probe.

The legacy ABI subset was transcribed from the official [Kuru contracts](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/tree/2060bb2736080c175d80d568bfdb6226bb5abd04), revision `2060bb2736080c175d80d568bfdb6226bb5abd04`. This subset is not a generated production ABI. Upstream implementation addresses and bytecode hashes were captured, but their source-to-deployed-bytecode equivalence has not been independently reproduced.

## Network and deployed identities

| Role                     | Testnet address                              |
| ------------------------ | -------------------------------------------- |
| Probe wallet             | `0xD8F3EdB29A5c9B00747e58431C005cff5F6f4eaD` |
| Pickler token PKKP       | `0x609879264a37427f56bc18985b9ec27f86f17ce0` |
| AUSD quote asset         | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| Legacy Kuru Router       | `0x7EFbE105Ca7415dE98F96622173458ac1c054630` |
| MarginAccount            | `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` |
| Created PKKP/AUSD market | `0xa5d691EEd28D8623721221ECC54B74424435D702` |
| Created AMM vault        | `0x38d61895B5Cecc6689A58fC181A23CF40Ea7ae93` |

The token has 18 decimals and a fixed supply of 21,000,000 PKKP; AUSD has six decimals. For this standalone probe, the initial supply went to the probe wallet. Product launches still allocate initial supply to their curve. Market and vault addresses were derived from the actual Router-emitted `MarketRegistered` event and compared with the Router, MarginAccount and market getters.

## Parameters and results

The isolated market used size and price precision `100000000`, tick size `1`, minimum order size `100000000` (one token), maximum size `10000000000000000`, taker fee 30 bps, maker rebate 10 bps and AMM spread 100 bps. These are compatibility-test settings, not approved Pickler post-graduation fees. The existing 1% curve fee and 50/50 creator/protocol split remain unchanged; post-graduation fees still require review.

| Operation                                                                                                                     | Confirmed result                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [deploy-token](https://testnet.monadexplorer.com/tx/0xc704c949239f9a402c8d8ef97a1d68d5f6c2fc83941590c34b30b8966b698839)       | Actual fixed-supply Pickler token deployed                                               |
| [create-market](https://testnet.monadexplorer.com/tx/0x68b90131895c73a7623358ff14fa6e088955fd937e6e0228798043ffdd9e1fc2)      | PKKP/AUSD market and vault registered                                                    |
| [deposit-liquidity](https://testnet.monadexplorer.com/tx/0x1f810d7347ac53c7b1b6f602f6a6cf795326e1a973ba7259df04fcb5a61d73a7)  | 1,000 PKKP and 7.619048 AUSD deposited                                                   |
| [buy](https://testnet.monadexplorer.com/tx/0xe6a1145d11f0f4387161a9f4cac9bca50ac1dcf749825ed17995e5dbf01899f9)                | 0.01 AUSD spent; 1.30856243021 PKKP received                                             |
| [sell](https://testnet.monadexplorer.com/tx/0x6431f6771b56a6de3942c65f42273a99ecdb5d827f85afc10cc483ec544fa61a)               | 1 PKKP sold; 0.007520 AUSD received                                                      |
| [withdraw-liquidity](https://testnet.monadexplorer.com/tx/0x7110aa5cd97f57e6fe974ea7f86ff54742c386d1e9b646b6f1635a2d3569385a) | All probe-owned LP shares burned; 999.688812558473546012 PKKP and 7.621511 AUSD returned |

The first deposit found zero LP supply and assets. It minted `87287158275575` shares to the probe wallet and 1,000 minimum shares to MarginAccount. Buy and sell balance deltas matched decoded trade sizes, directional fee rounding and maker rebates; neither trade changed LP supply. Both used external settlement, fill-or-kill and a minimum output derived from a current quote.

Withdrawal matched the previous-block, partial-fill-aware preview. The wallet ended with zero LP shares; total LP supply remained 1,000 minimum shares, backed by `0.000000011456453988` PKKP and `0.000001` AUSD dust. All four exact-amount token approvals ended at zero.

Final probe balances were **4.510064318 testnet MON**, **9,999.999983 testnet AUSD** and **20,999,999.997374988683546012 PKKP**. Token supply remained exactly 21 million. The eleven probe transactions consumed **0.489935682 testnet MON**. These are test assets, with no paid provider API calls or mainnet transactions.

## Transaction ledger

| Transaction                                                                                                                   | Block    | Gas cost in testnet MON |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| [claim-ausd](https://testnet.monadexplorer.com/tx/0xd91c94ef8468fea879bb95110db9d01cfdae988230810a1835606b8e1e367743)         | 69682695 | 0.017158440             |
| [deploy-token](https://testnet.monadexplorer.com/tx/0xc704c949239f9a402c8d8ef97a1d68d5f6c2fc83941590c34b30b8966b698839)       | 69684693 | 0.074881770             |
| [create-market](https://testnet.monadexplorer.com/tx/0x68b90131895c73a7623358ff14fa6e088955fd937e6e0228798043ffdd9e1fc2)      | 69684880 | 0.170553996             |
| [approve-base-lp](https://testnet.monadexplorer.com/tx/0x16ed6d4106fd63db1238001733c6cb9c47f48602a085a116e365114e057fd3c3)    | 69685023 | 0.007261686             |
| [approve-quote-lp](https://testnet.monadexplorer.com/tx/0x01d74e0b34c798da2a47622eafb11fce5b2be33323620da936766f5fded4a3dc)   | 69685047 | 0.009575046             |
| [deposit-liquidity](https://testnet.monadexplorer.com/tx/0x1f810d7347ac53c7b1b6f602f6a6cf795326e1a973ba7259df04fcb5a61d73a7)  | 69685071 | 0.075402072             |
| [approve-buy](https://testnet.monadexplorer.com/tx/0x563505bd07bf67ac41afb12bf21cbcdd06924ef592f8ccad8119444dddc0d1c4)        | 69685142 | 0.009573516             |
| [buy](https://testnet.monadexplorer.com/tx/0xe6a1145d11f0f4387161a9f4cac9bca50ac1dcf749825ed17995e5dbf01899f9)                | 69685166 | 0.036340764             |
| [approve-sell](https://testnet.monadexplorer.com/tx/0x355d5deb3bb2f8fe654eadb238f4c320d2892d954854e62392935fde21d31879)       | 69685191 | 0.007260156             |
| [sell](https://testnet.monadexplorer.com/tx/0x6431f6771b56a6de3942c65f42273a99ecdb5d827f85afc10cc483ec544fa61a)               | 69685216 | 0.036389010             |
| [withdraw-liquidity](https://testnet.monadexplorer.com/tx/0x7110aa5cd97f57e6fe974ea7f86ff54742c386d1e9b646b6f1635a2d3569385a) | 69685276 | 0.045539226             |

The MON faucet transfer was supplied separately by the official faucet and is excluded from the probe's gas total. Its transaction was [the initial 5 testnet MON funding](https://testnet.monadexplorer.com/tx/0x38b3b65ef49fa8f1d90e7f2d822c2791eb79874b6847e388d9437fd44c461c21). AUSD came from the official testnet faucet contract; the signed claim is included above.

## What remains to integrate

- Implement and test a Kuru graduation adapter instead of reusing the existing Uniswap V4 adapter or locker.
- Choose the exact Kuru generation and verify its deployments and market admission rules. Success with this legacy testnet deployment does not establish availability for the new-generation SDK or mainnet.
- Resolve custody and fee claims. The legacy vault returns principal and embedded earnings together when LP shares burn. This probe does not establish fee-only collection with permanently locked principal or the Pickler 50/50 payout path. Calculated protocol fees in the record are source-derived, not verified credits to a fee collector.
- Verify curve-to-market price continuity, order precision and residual inventory using the full 4.2-million-token / approximately 32,000-AUSD graduation allocation. This small probe does not validate the full launch preset.
- Complete operational launch signing, metadata, passkey submission, canonical indexing and public attribution before enabling launches.

Upstream proxy ownership and upgrade authority remain part of the custody review. No pool, vault or LP position from this probe is registered as a product deployment.

## Rechecking public evidence

With Foundry installed, the following commands only read the testnet:

```sh
cast chain-id --rpc-url https://rpc.ankr.com/monad_testnet
cast receipt 0x68b90131895c73a7623358ff14fa6e088955fd937e6e0228798043ffdd9e1fc2 --rpc-url https://rpc.ankr.com/monad_testnet
cast call 0x609879264a37427f56bc18985b9ec27f86f17ce0 'totalSupply()(uint256)' --rpc-url https://rpc.ankr.com/monad_testnet
cast call 0x38d61895B5Cecc6689A58fC181A23CF40Ea7ae93 'balanceOf(address)(uint256)' 0xD8F3EdB29A5c9B00747e58431C005cff5F6f4eaD --rpc-url https://rpc.ankr.com/monad_testnet
```

Any ledger hash can be checked the same way. Historical balance checks in the JSON use receipt-block and previous-block boundaries; another transfer in the same block could affect such deltas, so preserve log attribution and transaction ordering when investigating a mismatch.

Local validation also passed the token's eight unit/fuzz tests, contract compilation and formatting. Regenerated public ABIs were unchanged. No UI, database, dependency, deployed product configuration or runtime activation changed.
