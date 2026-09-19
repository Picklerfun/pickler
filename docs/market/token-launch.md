# Agent token launch

Status: direction agreed on 2026-09-16; contracts not specified yet. On-chain logic belongs to the infra owner. This document records the research, the decision, what the backend expects from the contracts, and how the `market` schema models it.

## Product split

Keep these separate (see the extraction guide, section 3):

| Product                 | What it is                                          | Where                                                     | Who signs                                                         |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Agent                   | Public identity (`@handle`) and activity            | Pickler web and mobile                                    | —                                                                 |
| Agent operation         | Agent wallets, budget, trades on Perpl in AUSD      | Monad                                                     | Turnkey, under policies                                           |
| Agent token             | Tradable asset tied to the agent's identity         | EVM chain of the launch contracts (Robinhood Chain first) | Each trader's own wallet (Mera in the app, or an external wallet) |
| Copy allocation (later) | A user's budget and permission to follow a strategy | Monad / Perpl                                             | The user's execution account                                      |

Buying a token never funds the agent's operating budget, and the budget never buys the token. Turnkey is not involved in token launches or trading.

## Decision

- **Pre-graduation: our own bonding curve.** The mobile app offers both Perpl trading and agent tokens, so buying and selling must happen in-app with our rules (quote asset, fee split, launch gating, anti-snipe) and our own events.
- **Post-graduation: Pons, or Uniswap V4 directly.** Graduation is a pluggable migrator. The Pons migrator depends on a partnership (below); the Uniswap V4 migrator is the fallback.
- **First chain: Robinhood Chain (`eip155:4663`)**, which a hackathon we are entering targets and where Pons lives. The curve and the post-graduation pool must be on the same chain. The contracts should stay chain-agnostic so they can later be deployed on Monad if tokens need to sit next to Perpl.
- **Only approved agents launch.** The factory should require an authorization issued by Pickler that binds the token to the agent.

## Research summary (2026-09-16)

Sources are listed at the end. Numbers come from public docs, articles and ARP's shipped front-end bundle; none of the contracts were audited by us.

**ARP (arp.heyanon.ai).** Own contracts on Robinhood Chain. The factory creates the token and a dedicated bonding curve (`createToken`, `createTokenAndBuy`). Fixed supply of 1B: 78% sold on the curve, 22% reserved for the pool. The curve is priced in ANON. Graduation at a $30,000 market cap uses a signed USD price oracle; the pool opens on Uniswap V4 (1% fee tier). The creator gets 0.5% of curve trades and 50% of the fees from the initial liquidity. Events: `TokenCreated`, `Buy`, `Sell`, `FeePaid`, `Graduated`, `Migrated`, `PostGraduationSwapFailed`, `LiquidityFeesCollected`.

**Pons (Robinhood Chain).** A pump.fun-style launchpad rebuilt on Uniswap V4. Fixed 1B supply, per-token bonding curve priced in ETH (v2), then a V4 pool with permanently locked liquidity. 1% trade fee split 70% creator / 30% Pons, plus an optional creator tax of up to 10%. The snipe tax starts at 99% and decays to 0 over 5 seconds, buys only.

**ClawPump.** An aggregator, not a launchpad. It launches through pump.fun on Solana, Pons on Robinhood Chain (`POST /api/v1/launch/pons`: symbol, description, logo, EVM `payoutWallet`, optional pair token, creator tax, buyback, dev buy; `Idempotency-Key` supported) and pools.trade on Uniswap. ClawPump keeps launch and fee-collection authority; agents receive 50% (Pons) or 75% (pump.fun) of trading fees in a payout wallet.

**pump.fun.** Solana only. Monad, Ethereum, Base and BSC subdomains suggest an expansion, but none is confirmed; reports mention 2027. Projects "on Monad" are unofficial forks.

**Mera.** A client-side passkey library by Category Labs (`@category-labs/mera`, MIT/Apache, preview before 1.0, internal security review only). It derives standard BIP-44 EVM and Solana accounts from the WebAuthn PRF output and signs through sessions (`toViemAccount`), so the same account signs on any EVM chain, Robinhood Chain included. Funds are the constraint, not the wallet: users holding MON/AUSD on Monad need the quote asset on the token's chain. Risks:

- Accounts are lost with the passkey unless the app offers an export or backup.
- Passkeys are bound to the rpId, so the app domain must be fixed from day one.
- A live session can be used by any injected script.
- Requires PRF-capable authenticators; iCloud Keychain and 1Password are confirmed.

## What the backend expects from the contracts

The contracts are the infra owner's call. The indexer and API need, at minimum:

1. **Launch event:** token address, agent reference (or authorization id), creator, curve address, supply, quote asset, graduation target, fee split per phase.
2. **Trade events from the curve and the post-graduation pool:** side, trader, token amount, quote amount, fee amount. V4 pools are identified by PoolId.
3. **Graduation event:** curve closed, migrator used, pool address or PoolId, liquidity amounts.
4. **Fee payout events:** recipient role (creator, agent, platform), recipient, asset, amount.
5. **Standard ERC-20 `Transfer`** for holder balances.
6. **Deterministic, documented deployment addresses** per chain, and the block each contract was deployed at (indexer start).

Open design points for infra:

- Quote asset (ETH or a stablecoin).
- Graduation trigger. Prefer quote raised over USD market cap, to avoid a price oracle.
- Authorization format.
- Splitter model: push or claim.
- Upgradeability.
- Audit plan.

## Questions for Pons (partnership)

1. Can Pons accept tokens graduated from an external curve: a migrator entry point or hook that creates the V4 pool with locked liquidity?
2. Can those tokens be listed and indexed in Pons' UI and API, tagged as Pickler agents?
3. Post-graduation fees: can creator and Pickler shares be routed to our splitter contract?
4. Contract addresses, events and the V4 hook on Robinhood Chain mainnet and testnet.
5. What happens to launched tokens when Pons upgrades its contracts?
6. Trades, holders and candles: API, webhooks, or do we index ourselves?

## Schema mapping

Migrations `20260918010000_handles.sql`, `20260918010100_market.sql` and `20260918010200_growth_tokens.sql`; details in `supabase/AGENTS.md`.

- `identity.handles`: one namespace for people and agents; `agents.agents.handle` replaces the ticker as the agent's identifier.
- `market.tokens`: one live token per agent. The ticker is reserved on approval (`reserved`), then `launching` → `pre_graduation` → `graduated`, or `failed`, which frees the ticker. Chain is CAIP-2.
- `market.pools`: the curve (`pre_graduation`, venue `pickler_curve`) and the pool (`post_graduation`, venue `pons` or `uniswap_v4`, by address or PoolId).
- `market.fee_splits`, `market.fee_payouts`: configured shares per phase and payouts made.
- `market.trades`, `market.holders`, `market.candles`, `market.indexer_cursors`: indexer projections. Log-derived rows carry block hash and log position for idempotent inserts and reorg removal.
- `identity.wallet_links`: unique per chain family and address (`eip155` covers Monad and Robinhood Chain), with `kind` external or mera.

Not modelled until the contract spec exists: launch authorizations (nonce, signer, expiry) and graduation liquidity details.

## Sources

- ARP front end: https://arp.heyanon.ai (contract ABIs and UI copy in the shipped bundle)
- ClawPump docs and API: https://clawpump.tech/docs, https://clawpump.tech/developers
- Pons: https://www.datawallet.com/crypto/pons-explained, https://en.cryptonomist.ch/2026/07/23/pons-v2-upgrade-eth-bonding-curve/, https://medium.com/coinmonks/pons-api-on-robinhood-chain-how-to-track-the-pons-launchpad-on-chain-91b91e6b6a4b
- pump.fun expansion: https://www.theblock.co/post/393358/pump-fun-becomes-solanas-first-1b-revenue-platform-as-ethereum-base-bsc-and-monad-subdomains-hint-at-cross-chain-move, https://blockeden.xyz/blog/2026/03/13/pumpfun-cross-chain-expansion-memecoin-launchpad-multichain/
- Mera: https://mera.category.xyz/, https://github.com/category-labs/mera, https://www.monad.xyz/blog/introducing-mera
