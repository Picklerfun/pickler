# Chain package instructions

Read [the root instructions](../../AGENTS.md) first. Read [contract instructions](../../contracts/AGENTS.md) when dealing with ABIs or deployments, and the local instructions of any adapter or app you change.

`@pickler/chain` is the public boundary for blockchain artifacts. It exports `ContractDeployment` and, from `src/networks.ts`, Monad mainnet (143) and testnet (10143) metadata, the AUSD token (6 decimals, EIP-712 domain `Agora Dollar` / `1`, EIP-2612 and EIP-3009), `requireSupportedChain` (no fallback to other networks) and `toBaseUnits` (exact decimal → base units). Each value records its source and verification date; re-verify before launches that depend on them. Tests: `test/networks.test.ts`.

`src/abi/` is generated output, produced by `npm run contracts:abi` from Foundry artifacts and never hand-edited. Each contract file exports its ABI `as const` plus a sha256 `…AbiHash`; record that hash alongside decoded logs so a log stays interpretable after the contract changes. CI regenerates the directory and fails on a diff. `src/deployments.ts` records verified external deployments — currently Uniswap V4 on Monad mainnet and testnet — each with the keccak256 of its deployed bytecode at a pinned block. Verify against the code hash, never the address alone: Permit2 occupies the same address on both networks with different bytecode. Pickler's own contracts are absent because none are deployed. No SDK exists.

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
[the token guide](../../docs/agent-token-preview.md); Pickler factory deployments remain absent.
