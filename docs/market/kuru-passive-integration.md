# Kuru passive graduation: controlled integration and activation gate

## Current evidence

The [versioned readiness record](kuru-passive-readiness.json) is **blocked**. The
[legacy testnet probe](kuru-testnet-probe.md) proves standalone market compatibility, not Pickler
graduation or fee-only collection. The official address page still lists legacy Router and Margin
Account on testnet. The pinned public ABI exposes `claimPassiveFees`, but no reproducible passive
generation deployment or implementation source has been verified. No SDK package is installed or
copied: minimal interfaces are independently authored from public signatures. The SDK pin is
`8588784c4d54183a04029cb1b513910c806905a9`; its package is `UNLICENSED`.

Sources: [official addresses](https://docs.kuru.io/contracts/Contract-addresses),
[pinned ABI](https://github.com/Kuru-Labs/ts-sdk/blob/8588784c4d54183a04029cb1b513910c806905a9/src/generated/abis.ts),
[pinned package declaration](https://github.com/Kuru-Labs/ts-sdk/blob/8588784c4d54183a04029cb1b513910c806905a9/package.json).

## Implemented controlled boundary

`PicklerGraduationAdapterKuru` is testnet-only (10143). An immutable policy commits router, account
core, their runtime hashes, precision, limits, fees and deterministic bands. New factory preset
versions additionally commit that venue hash; historical preset hashes retain their exact original
meaning. `PicklerCurveDeployerKuru` rejects a mismatched escrow and any missing venue commitment.
The new exact-receipt escrow checks all deployment bindings before its one-time initialization.

Graduation checks the canonical factory record, token admission, decimals and every returned
market parameter. It uses the actual real backing and reserved token allocation, never the
reference terminal reserve. Funding, market creation, position creation and registration happen
atomically; failed checks revert the curve release. Tick representation must be within one basis
point of the normalized closing price. Invalid fixed-profile precision/bands fail construction.

The locker creates a separate `PicklerKuruPositionVault` and root account per launch. It cannot
withdraw principal, burn or transfer positions, delegate account access, execute arbitrary calls,
rescue assets or upgrade. Allocated and unallocated principal remain in that account forever.
Preexisting unreserved deposits are recorded as locked donations, preventing predictable-address
donation griefing. Direct token donations to custody or escrow are never attributed as fees.

Collection operates only on recorded position IDs and verifies owner, prices, shares, reserved
balances, ledger deltas and physical receipts, including after withdrawals. Exactly those receipts
are pulled into `PicklerFeeEscrowV2`. It splits actual AUSD or agent-token revenue 50/50, without
conversion or an additional Kuru trading fee. Claiming debits only the caller. Curve fee attribution
uses a monotonic remittance receipt, preserving separation from donations and other launches.
Historical V4 and escrow behavior are unchanged.

## Assumptions that must be verified before any real launch

The controlled account model uses atomic ERC-20 units for account balances, mint amounts, claim
returns and withdrawals. The passive band model uses `high = low + spreadTicks * tickSize`. These
are explicit hypotheses requiring source and on-chain verification, **not statements about the
unverified Kuru deployment**. The tests prove our rejection and accounting logic against this
controlled model; they do not establish upstream equivalence, real band pricing, notional rules,
trading economics or custody safety.

Runtime code hashes do not pin proxy implementations. Readiness must record proxy addresses,
implementation addresses/hashes, deployment blocks, reproducible sources, storage/version layout,
account/operator permissions, upgrade and freeze authorities, and the market creation/admission
policy. Verify admission for AUSD and each new agent token. Prove fee claims preserve positions and
principal and establish the exact 6/18 decimal normalization, fee PPS scale, min/max notional and
initial band-price continuity. Review the deterministic band distribution and fees, then commit its
approved hash. Controlled test numbers are illustrative and cannot be reused as commercial policy.

If any proof is missing, launching stays disabled. There is no automatic legacy fallback. Upstream
upgrade powers remain a custody dependency even though Pickler's locker has no upgrade function.
No claim of permanently inaccessible principal against a hostile upgraded protocol is made.

## Reproducible offline validation

From the repository root, with the pinned Node/npm and Foundry tools:

```sh
forge test --root contracts --offline --no-match-path 'test/fork/*'
forge fmt --root contracts --check
forge lint --root contracts
npm run contracts:abi
npm run typecheck --workspace=@pickler/chain
```

`PicklerKuruGraduation.t.sol` tests reference-curve exhaustion, atomic handover, donations,
per-launch isolation, failed/mutated markets, precision, corrupted fee responses, principal
conservation through withdrawal, repeated collection and explicit claims. Three fuzz tests each
run 256 cases. Existing curve solvency/inventory invariants and grant tampering/expiry/reuse tests
remain enabled. No fork, provider call, real signature, paid request or remote transaction occurs.

| Scenario                                                                    | Evidence                   | Status                      |
| --------------------------------------------------------------------------- | -------------------------- | --------------------------- |
| Factory → reference curve → passive model → locked positions → escrow claim | Controlled Solidity        | Passed                      |
| Donation griefing and mismatched escrow discovered in review                | Controlled regressions     | Corrected                   |
| Historical preset/grant/curve/V4 behavior                                   | Existing offline suites    | Passed                      |
| Legacy standalone Kuru market/liquidity/trades/redemption                   | Canonical testnet receipts | Recorded separately         |
| Passive Kuru generation deployment, source and token admission              | External verification      | Pending, activation blocked |
| Pickler testnet graduation and separate LP fee collection                   | Real testnet acceptance    | Pending, activation blocked |
| Launcher passkey, R2, durable transaction recovery, indexer and UI          | Next PR in this delivery   | In progress                 |

The later testnet run must first record an explicit gas ceiling from a preflight, then capture
balances, positions and canonical receipts before/after launch, curve trades, graduation and fee
claims. No fiat budget, mainnet activation or general launch admission is implicit.

## Live verification, October 10, 2026

[The completed verification](kuru-verification-20261010/verification.md) found the published
testnet contracts use legacy implementations without the required passive fee-only interface.
This is a confirmed incompatibility of the examined deployments, not an unperformed check and
not proof that no unlisted deployment exists. The readiness gate stays blocked. The current
launcher uses a separate [Uniswap V4 implementation](uniswap-v4-testnet-integration.md); old Kuru
contracts, records and controlled tests retain their original meaning.
