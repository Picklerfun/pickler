# Contract acceptance tooling

Read the root and `contracts/AGENTS.md` instructions first. These are explicit operator tools, not
build hooks, runtime hosts or unattended deployment jobs.

`uniswap-testnet-acceptance.mjs` performs the isolated faucet-funded Uniswap V4 contract acceptance.
It requires an explicit local preflight or testnet broadcast mode, a private key file and an output
directory outside the checkout. It refuses other networks, unreviewed code, excessive gas and an
expired or mismatched preflight. No arguments only prints help. Normal tests never send transactions.

Keep private journals, raw signed transactions, generated authority/treasury keys and local env files
outside Git. Store intent before sending; reconcile uncertain sends using the same hash rather than
replacing or repeating transactions. The script does not enable hosted Studio, R2, passkey or indexer.

Use `node --test scripts/contracts/*.test.mjs` for offline CLI guards. Follow
[the integration guide](../../docs/market/uniswap-v4-testnet-integration.md) for explicit acceptance.
