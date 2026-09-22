# Solidity project instructions

Read [the root instructions](../AGENTS.md) first. Read [chain package instructions](../packages/chain/AGENTS.md) before changing public artifacts and any affected adapter's instructions before integration work.

## Current state

This is an independent Foundry project, not an npm workspace. `foundry.toml` pins Solidity 0.8.30, enables optimization with 200 runs, and configures 256 fuzz runs, 64 invariant runs at depth 128, and write access to `../packages/core/test/fixtures` for the parity fixture below.

Implemented, in the order the launchpad specification builds them:

- `src/libraries/PicklerCurveMath.sol` — all curve arithmetic: exact-input buy, exact-input sell, exact-output buy, remaining inventory, marginal price, and the derivation of virtual reserves from a sale allocation, an LP allocation and a target reserve. Rounding is directional: the quote reserve is floored and anything subtracted from a reserve is ceilinged, so rounding always favours the curve. Tests cover hand-computed values, the derivation's price-continuity property under fuzzing, and invariants over random buy/sell sequences.
- `src/libraries/PicklerPreset.sol` — the economic configuration a launch is fixed to, plus the validation that refuses an incoherent one, including a price below the precision floor the curve fuzzing found.
- `src/PicklerAgentToken.sol` — a fixed-supply ERC-20 with no mint, owner, pause or transfer tax.
- `src/PicklerLaunchFactory.sol` — creator authorization (EIP-712, replay-protected, ERC-1271 aware), one canonical token per agent key, and immutable published presets. It obtains a curve through `ICurveDeployer` and knows nothing else about it.
- `src/PicklerBondingCurve.sol` — buying, selling and the end of the curve. Keeps the reserve, the accrued fees and the LP allocation strictly apart, tracked in storage rather than read from balances, so a donation moves no price and credits no one. Exhausting the sale allocation sets `READY_TO_GRADUATE`; graduation is a separate call that only the adapter may make.
- `src/PicklerCurveDeployer.sol` — deploys a curve and binds it to its token in one call, which is the only window in which binding is possible.
- `src/PicklerGraduationAdapterV4.sol` and `src/PicklerLiquidityLocker.sol` — permissionless, atomic graduation into a Uniswap V4 pool, and a locker that holds the position forever while letting only its fees out. The adapter deploys its own locker, so neither needs the other's address first.
- `src/PicklerFeeEscrow.sol` — splits each launch's fees between its creator and the protocol and pays them out. Attribution is atomic with the transfer that funds it, and a claim debits only the caller.
- `test/fork/` — the Uniswap V4 spike (LP-02) and graduation end to end (A5, A6). These fork Monad testnet at a pinned block and run only when `MONAD_TESTNET_RPC_URL` is set, so `npm run contracts:test` stays offline; run them with `npm run contracts:test:fork`. Read [the spike findings](../docs/market/uniswap-v4-spike.md) before touching graduation: there is no official Uniswap V4 on Monad testnet, and the Monad-maintained one is a different build from mainnet's.

Not implemented: networks and deployment scripts.

Deployment order is fixed by what each contract needs: fee escrow, graduation adapter (which creates the locker), curve deployer, launch factory, then `escrow.initialize(factory, locker)`. Every binding after construction is one-time and restricted to the deployer. See [the launchpad development specification](../docs/specs/launchpad-monad-v1.md) for what each one owes and in what order.

Dependencies are git submodules pinned by commit in `foundry.lock`: forge-std `v1.11.0`, and v4-periphery `3231810e` with v4-core, permit2 and solmate nested under it, at the commits the Monad testnet deployment was built from. Remappings live in `remappings.txt`. A fresh clone needs `git submodule update --init --recursive` before `forge build`.

Contracts currently carry `SPDX-License-Identifier: UNLICENSED` as an explicit placeholder. Choose a real license before anything is deployed.

## Organization and rules

- Put Solidity source in `src/`, tests in `test/`, and explicit deployment scripts in `script/`. Keep generated `out/`, `cache/`, and local broadcast output untracked.
- Define product rules, actors, permissions, assets, and target network requirements before implementing business contracts. Do not invent a token, custody model, upgrade mechanism, or administrator role.
- Keep compiler and dependency choices reproducible. Document any added libraries and changes to compiler or EVM target settings.
- Treat on-chain behavior as a separate execution boundary. Do not assume off-chain writes and transactions are atomic or that submission means finality.
- Test access control, expected state transitions, invalid inputs, failure paths, and relevant invariants. Add fuzz testing for meaningful input ranges and adversarial edge cases.
- Generate public ABIs from compiler artifacts into `packages/chain` with `npm run contracts:abi` from the repository root. Add a contract to the `CONTRACTS` list in `scripts/generate-abi.mjs` when external consumers need to decode or call it. Never hand-edit the generated output; CI regenerates it and fails on a diff.
- `test/CurveVectors.t.sol` writes `packages/core/test/fixtures/curve-vectors.json`, which the TypeScript preview in `packages/core` is tested against. Regenerate it whenever curve arithmetic changes; CI fails on a diff. The chain is the source of those numbers, never the TypeScript port.
- Record deployments by chain ID and contract version with verified address and block information. Never commit keys or signing credentials.
- Deployment must be explicit, never a side effect of build or test. Confirm the intended network and deployment parameters before irreversible on-chain actions unless they are already explicitly authorized.

## Commands

From the repository root, with Foundry installed:

```sh
npm run contracts:build
npm run contracts:test      # Offline: unit, fuzz and invariant suites
npm run contracts:test:fork # Requires MONAD_TESTNET_RPC_URL; forks a real chain
npm run contracts:abi       # Regenerate public ABIs into packages/chain
```

If a test suite disappears from a run rather than failing, suspect a stale build cache and re-run with `forge build --root contracts --force`. A vanished suite reports as a pass, so check the suite count, not just the colour.

For formatting, use `forge fmt --root contracts --check`, and for static analysis `forge lint --root contracts`. Both run in `.github/workflows/contracts.yml` alongside the test suite and the two generated-artifact drift checks. Empty directories do not provide contract validation coverage. When introducing tests, ensure they run rather than treating an empty test result as success. Update this file alongside any change to the contract layout, dependencies, commands, or deployment process.
