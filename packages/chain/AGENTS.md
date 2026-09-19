# Chain package instructions

Read [the root instructions](../../AGENTS.md) first. Read [contract instructions](../../contracts/AGENTS.md) when dealing with ABIs or deployments, and the local instructions of any adapter or app you change.

`@pickler/chain` is the public boundary for blockchain artifacts. It exports `ContractDeployment` and, from `src/networks.ts`, Monad mainnet (143) and testnet (10143) metadata, the AUSD token (6 decimals, EIP-712 domain `Agora Dollar` / `1`, EIP-2612 and EIP-3009), `requireSupportedChain` (no fallback to other networks) and `toBaseUnits` (exact decimal → base units). Each value records its source and verification date; re-verify before launches that depend on them. No ABIs, SDK or generation scripts exist yet. Tests: `test/networks.test.ts`.

- Keep this package browser-safe and independent of Next.js, React, business logic, and infrastructure.
- Never include private keys, signer objects, secrets, or credential-bearing RPC endpoints.
- Generate future ABIs from compiler artifacts owned by `contracts`; never maintain hand-copied ABIs. Add a reproducible generation command and document it here when implemented.
- Key deployments by network chain ID and contract version. Record verified deployment addresses and blocks; never invent addresses or silently default to another network.
- Types alone do not validate addresses or networks. Validate untrusted values at their consuming boundary.
- `bigint` deployment blocks are internal JavaScript values, not JSON. Convert deliberately to strings in public HTTP DTOs when needed.
- Keep server RPC access in infrastructure and user wallet interaction in the web app. Share only public artifacts here.

From the root: `npm run typecheck --workspace=@pickler/chain` and `npm run lint`. Once generation is introduced, verify artifacts match the compiler output and validate all consuming packages. Keep these instructions current with the real artifact workflow.
