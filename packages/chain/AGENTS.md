# Chain package instructions

Read [the root instructions](../../AGENTS.md) first. Read [contract instructions](../../contracts/AGENTS.md) when dealing with ABIs or deployments, and the local instructions of any adapter or app you change.

`@pickler/chain` is the public boundary for blockchain artifacts. It exports `ContractDeployment` and, from `src/networks.ts`, Monad mainnet (143) and testnet (10143) metadata, the AUSD token (6 decimals, EIP-712 domain `Agora Dollar` / `1`, EIP-2612 and EIP-3009), `requireSupportedChain` (no fallback to other networks) and `toBaseUnits` (exact decimal → base units). Each value records its source and verification date; re-verify before launches that depend on them. Tests: `test/networks.test.ts`.

`src/abi/` is generated output, produced by `npm run contracts:abi` from Foundry artifacts and never hand-edited. Each contract file exports its ABI `as const` plus a sha256 `…AbiHash`; record that hash alongside decoded logs so a log stays interpretable after the contract changes. CI regenerates the directory and fails on a diff. `src/deployments.ts` records verified external deployments — currently Uniswap V4 on Monad mainnet and testnet — each with the keccak256 of its deployed bytecode at a pinned block. Verify against the code hash, never the address alone: Permit2 occupies the same address on both networks with different bytecode. The isolated testnet acceptance has a public receipt registry linked below; hosted product
deployment is not configured. No SDK exists.

- Keep this package browser-safe and independent of Next.js, React, business logic, and infrastructure.
- Never include private keys, signer objects, secrets, or credential-bearing RPC endpoints.
- Generate ABIs from compiler artifacts owned by `contracts` with `npm run contracts:abi`; never maintain hand-copied ABIs. Add a contract to the `CONTRACTS` list in `scripts/generate-abi.mjs` when external consumers need it.
- Key deployments by network chain ID and contract version. Record verified deployment addresses and blocks; never invent addresses or silently default to another network.
- Types alone do not validate addresses or networks. Validate untrusted values at their consuming boundary.
- `bigint` deployment blocks are internal JavaScript values, not JSON. Convert deliberately to strings in public HTTP DTOs when needed.
- Keep server RPC access in infrastructure and user wallet interaction in the web app. Share only public artifacts here.

From the root: `npm run typecheck --workspace=@pickler/chain` and `npm run lint`. Once generation is introduced, verify artifacts match the compiler output and validate all consuming packages. Keep these instructions current with the real artifact workflow.

## Launch factory authorization ABI

The generated `PicklerLaunchFactory` ABI uses the mandatory Pickler `LaunchGrant` entrypoint,
operator-controlled authority rotation, grant digest and replay state. The EIP-712 domain version
is `2`; there is no grant-free legacy overload. Regenerate with `npm run contracts:abi` after Solidity
changes. This ABI is not a deployment record or an operational signer. See
[the token guide](../../docs/agent-token-preview.md); a testnet acceptance deployment is recorded below, without hosted activation.

## Reference precision ABI

The generated curve ABI includes `marginalPriceWad` for precision policy 2, and preset/factory ABIs
include unknown-policy, invalid-reference and quote-decimal errors. The struct shape and config
hash commitment are unchanged. Generation is compiler-owned; existing external deployments are
not evidence that a Pickler factory or DEX configuration has been deployed.

## Controlled Kuru artifacts

Compiler output now exports the independent Kuru passive interfaces, adapter, curve deployer,
per-launch position vault, liquidity locker, policy and exact-receipt escrow. Factory venue
commitments apply only to new preset versions. No passive Kuru deployment entry is verified;
see [readiness](../../docs/market/kuru-passive-readiness.json) and
[integration](../../docs/market/kuru-passive-integration.md). Runtime hashes cannot establish
unchanged proxy implementations. Never install the pinned UNLICENSED SDK or mark a controlled
account/market model as operational acceptance.

## V4 V2 public artifacts and verification

Generated exports include the separate V4 V2 adapter/locker/deployer and minimal read/router
interfaces. `UNISWAP_V4_TESTNET_REVERIFICATION` records the current two-RPC observation and pinned
Monad-maintained manifest; it does not call this an official Uniswap testnet. Universal Router
runtime size is 24,546 bytes at that observation. Public isolated Pickler deployment addresses,
blocks/hashes and receipts are in [the acceptance record](../../docs/market/uniswap-v4-testnet-acceptance.json),
not an enabled hosted deployment configuration. Never import keys or operational journals here.
