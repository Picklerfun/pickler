# Live Kuru testnet verification — 2026-10-10

## Result

**Verification completed; passive integration not approved.** The officially published testnet
Router, MarginAccount, MON-USDC market and the prior Pickler/AUSD probe market use the legacy
implementation. They do not expose the passive account/position/fee interface required by the
current Pickler adapter. No independently verifiable deployment of the newer generation was
found in the public official sources examined. This does not prove that no private or unlisted
deployment exists.

This is an incompatibility finding, not a successful graduation acceptance and not an unperformed
verification. Real launches remain disabled. Controlled adapter tests remain valid only against
their explicit model; they are not evidence of compatibility with the available remote contracts.

## Live evidence

- Network: Monad testnet, chain ID **10143**.
- Primary observation: **2026-10-10T14:09:45.114Z**.
- Pinned block: **69845383**, hash `0x0d63c4c8bd1ee8b09bd4adbe1d02cdb8f5d29c7c15e20c4e9144b61562e9e9d1`.
- Primary endpoint: `https://rpc.ankr.com/monad_testnet`.
- Independent endpoint: `https://testnet-rpc.monad.xyz`.
- Both endpoints returned the same block hash and identical code for all four implementations.
- Total: **49 read-only RPC calls**, within the explicit 100-call inspection ceiling.
- New transactions, signatures, gas spending and fiat spending: **zero**.

| Role   | Published/probe address                      | EIP-1967 implementation                      | Implementation keccak256                                             |
| ------ | -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| router | `0x7EFbE105Ca7415dE98F96622173458ac1c054630` | `0xaaa0f0c4d49d09ef33ae758d88afab810ecbe1ed` | `0xadf3e1f5d9bc07f55d68556f5cca8b9c68381716f932f9b49169e152690583b9` |
| margin | `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` | `0xf10af40f060b7ae54a2d5da682becc981dfb52c3` | `0xc7fe37d8820177aadb71ffaf4d8616da30140609b79c1eafd189c9ae8cca55fd` |
| market | `0xa5d691EEd28D8623721221ECC54B74424435D702` | `0x72cae0a99c19b574e8a6de558f43fc1d019c9374` | `0x24c5974f233021f00d607bfa191d430f79565663fb90805ebcfca52de7333500` |
| vault  | `0x38d61895B5Cecc6689A58fC181A23CF40Ea7ae93` | `0x4d54e0d60cab0cec0100cda8e00897bc933c5bb6` | `0xde0b16a79cf8f711403e89093c1e82ce0e7813949dd0f5041b41da324fdd3dc3` |

The official MON-USDC market at `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9` resolves to the same legacy OrderBook
implementation. `getMarketParams()` succeeded and returned the legacy structure.
`accountCore()`, `getPassivePosition(uint64)` and `claimPassiveFees(uint40,uint64)` all reverted
with empty revert data. Their selectors were also absent from the implementation code. Selector
scanning alone is a heuristic; it is corroborated here by successful legacy getters, failed
passive getters/call, implementation identity and the published legacy source/ABI.

The published Router's `orderBookImplementation()`, `kuruAmmVaultImplementation()`,
`marginAccountAddress()` and `owner()` succeeded. `spotBalanceAccountAddress()` reverted.
The published MarginAccount's passive token metadata/admission getters reverted. The probe
AUSD still reports six decimals; Pickler token reports eighteen and exactly 21 million supply.
These asset checks do not establish passive-generation admission.

## Source and discovery evidence

1. [Official contract addresses](https://docs.kuru.io/contracts/Contract-addresses) still publish
   the legacy Router and MarginAccount for testnet, with official MON-USDC market.
2. [Legacy vault documentation](https://docs.kuru.io/contracts/KuruAMMVault) describes redemption
   by burning LP shares. The [pinned source](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/2060bb2736080c175d80d568bfdb6226bb5abd04/contracts/KuruAMMVault.sol)
   has no fee-only claim path: embedded earnings and principal exit together through share
   redemption. That path cannot implement permanent principal locking with separately claimed LP
   fees as agreed.
3. [Current SDK metadata](https://github.com/Kuru-Labs/ts-sdk/blob/8588784c4d54183a04029cb1b513910c806905a9/src/generated/metadata.ts)
   pins contract source revision `cdac5ae1311ce4793f80d604d25f9713fcfed57d`.
   Its current main is still `8588784c4d54183a04029cb1b513910c806905a9`.
   The [ABI](https://github.com/Kuru-Labs/ts-sdk/blob/8588784c4d54183a04029cb1b513910c806905a9/src/generated/abis.ts)
   declares separate passive claim/burn and token whitelist/configuration functions, but an ABI
   does not establish the implementation semantics, permissions or a live deployment.
4. Public organization repository inventory and indexed Solidity/source-revision searches did not
   expose reproducible AccountCore/SpotRouter/passive OrderBook implementation sources or a
   deployment registry for that revision. The SDK examples require caller-supplied addresses;
   they are not a deployment manifest. GitHub search is discovery evidence with indexing and
   visibility limitations, not proof of worldwide absence.
5. Fifty scripts from the official public `www.kuru.io` landing page were inspected. Its active
   configuration is mainnet chain 143 with legacy Router/MarginAccount, and does not supply the
   required testnet passive addresses. This check covers the loaded landing-page scripts, not
   every possible deferred page. `testnet.kuru.io` did not resolve; the documented relay root
   returned HTTP 404. Neither observation proves the contracts are absent.

No SDK was installed, no upstream implementation code was incorporated into Pickler, and no
product contract, database, deployment or admission flag was changed.

## What would resolve this finding

Kuru must supply a canonical passive-generation testnet deployment (AccountCore, SpotRouter,
OrderBook implementation and any authority/beacon/limiter dependencies), deployment blocks,
matching reproducible implementation sources, and the admission path for AUSD and each new
Pickler token. Then verify atomic units, actual band/fee parameters, administration/freeze/upgrade
powers and an actual fee-only claim that leaves positions/principal intact. A canonical address
without these checks is not enough.

**Do not point the current adapter at legacy addresses, do not mark the passive gate green, and
do not reuse the legacy redemption operation as a fee-only claim.** The integration can only be
accepted after those upstream prerequisites and the real Pickler graduation/claim walkthrough.

## Artifacts and reproduction

- [Primary on-chain observation](onchain.json)
- [Independent RPC observation](second-rpc.json)
- [Official market and code equality checks](official-market.json)
- [Repository inventory](public-repositories.json)
- [Passive function discovery](passive-function-search.json)
- [Solidity source discovery](passive-solidity-search.json)
- [Pinned source revision discovery](contract-source-revision-search.json)
- [SDK head](sdk-head.json)
- [Public surface observations](public-surfaces.json)
- [Public UI inspection](public-ui-inspection.json)

The observations are public, pinned-block RPC and source-discovery evidence. No credentials or
private operational artifacts are included. Revalidate the documented addresses, EIP-1967 slots,
code hashes and ABI calls before accepting a future passive deployment.
