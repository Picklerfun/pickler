# Launchpad on Monad — development specification

Status: written 2026-09-21 against commit `397863a`. All of track A (A1 to A6) and D0 are implemented on `codex/launchpad-development-spec`; track B is not. Each section notes its own state.

This document translates the product specification "Pickler — Launchpad en Monad" into engineering deliverables against this repository. The product specification owns _what_ the launchpad is and which economic rules govern it. This document owns _what we build, in what order, and how we know a piece is finished_. Where the two disagree about the current state of the code, this document is authoritative about the code and the product specification is authoritative about the rules.

It does not approve economic parameters, claim any contract is deployed, or substitute for an independent contract review.

## 1. Current state, verified

Everything in this section was read from the working tree, not inferred. It is the baseline the plan builds on.

**Already usable.**

- The `market` schema is fully modelled and nothing writes to it. `packages/infrastructure/src/persistence/product/market.ts` defines `tokens`, `pools`, `fee_splits`, `trades`, `fee_payouts`, `holders`, `candles` and `indexer_cursors`; the DDL is applied in `packages/infrastructure/drizzle/0005_product_schemas.sql:279-419`. `trades` is unique on `(pool, tx_hash, log_index)`, `pools` carries `pool_key` for a Uniswap V4 `PoolId`, `indexer_cursors` stores `last_block_hash` for reorg detection, and `0006_product_functions_and_grants.sql:247-249` already grants `delete` on `trades` and `fee_payouts` to `service_role` so a reorg can be unwound.
- `packages/chain/src/networks.ts` carries Monad mainnet (143) and testnet (10143), and AUSD on both networks with 6 decimals, an EIP-712 domain and EIP-2612/EIP-3009 support, each with a recorded verification date. `requireSupportedChain` throws instead of falling back, and `toBaseUnits` converts exact decimals without floating point.
- `contracts/foundry.toml` pins solc 0.8.30, optimizer at 200 runs and 256 fuzz runs.
- `workers/research` is a working Cloudflare Queue + Cron + Hyperdrive worker. Its wiring, not its logic, is the template for the indexer.
- `identity.wallet_links` (`packages/infrastructure/src/persistence/product/identity.ts:94-124`) models `eip155`/`solana`, `siwe`/`siws` and `external`/`mera` links. Nothing writes it.
- `growth.ticker_available` and `workers/api/src/growth/tickers-availability.ts` already reserve a ticker when an application is approved.

**Absent.** Every Solidity contract — `contracts/src/` holds only `.gitkeep`, and `contracts/lib/` does not exist, so `forge build` cannot compile. No ABI generation pipeline. No deployment addresses: `ContractDeployment` in `packages/chain/src/index.ts:2-6` is a type with no instances. No viem, ethers or wagmi anywhere in the monorepo; the only chain access is raw JSON-RPC `fetch`. No on-chain log indexer, and no writer for `market.*` or `identity.wallet_links`. No launchpad endpoint: `/tokens` in the web app is served from `/v1/demo/*` sample data, and `markets.ts` in `@pickler/api-schema` describes Perpl perpetuals, not launch tokens.

That baseline is a snapshot of commit `397863a`, kept as written so the plan can be read against what it was planning from. Since then D0's ABI pipeline and deployment records, A1's curve library and A4's spike have landed; sections 4, 5 and 7 note what is done.

**Two contradictions this specification resolves.**

1. `docs/market/token-launch.md:18` names Robinhood Chain (`eip155:4663`) as the first launchpad chain. The product specification puts Robinhood out of v1 and targets Monad. That document is superseded on the choice of chain and on the Pons migrator being the primary path; its research summary and its list of backend requirements remain useful. A note to that effect belongs at the top of that file, added by the first deliverable that touches it.
2. `apps/web/src/features/wallet/lib/mera-signer.ts` discards the passkey session after deriving an address, so the web app cannot sign a transaction today. v1 of the launchpad therefore targets an injected EIP-1193 wallet only. Restoring a signing-capable Mera session is a separate specification and a blocker for the mobile flow, not for this one.

## 2. Constraints

- Documentation in English, Prettier defaults from the root, work on a `codex/` branch, no direct push to `main` (`AGENTS.md`).
- Migrations are additive and owned by Drizzle in `packages/infrastructure`. Existing schemas are never reset to reconcile histories.
- Layering holds: presentation → business ← infrastructure. `packages/core` stays free of transport objects, database clients and provider SDKs.
- `@pickler/chain` stays browser-safe and dependency-free. Generated ABIs and deployment records belong there; RPC clients belong in `packages/infrastructure`; wallet interaction belongs in `apps/web`. viem is therefore a dependency of `infrastructure` and `web`, never of `chain` or `core`.
- No deadline. Sequencing follows dependency and risk, not a demo date.
- Economic parameters are injected, not hardcoded. Nothing in this plan requires the preset to be approved before contracts can be written or tested, and nothing in this plan may be deployed against real funds while a parameter is still a placeholder.

## 3. Shape of the work

Deliverable 0 freezes the interface between the two tracks. After it, track A (contracts) and track B (data, indexer, API) proceed in parallel and meet on a local chain running the real contracts.

```
D0  frozen interface: ABIs, event surface, preset descriptor, environment manifest
     |
     +--> Track A: A1 math --> A2 token+factory --> A3 curve --> A5 adapter+locker --> A6 escrow
     |                                                  ^
     |            A4 Uniswap V4 spike (starts at D0) ----+
     |
     +--> Track B: B1 rpc client --> B2 migrations --> B3 indexer --> B4 repositories
                                                          --> B5 DTOs --> B6 API --> B7 web
     |
     +--> M  meeting point: anvil with real contracts, then Monad testnet 10143
```

The V4 spike (A4) starts at the same time as A1, not after A3. It carries the highest external risk, and its exit criteria decide the shape of A5.

## 4. Deliverable 0 — frozen interface

Everything downstream of this is written against these artifacts, so they are reviewed once and then changed only through an explicit version bump.

In `packages/chain`:

- `src/abi/` — ABIs generated from Foundry artifacts, exported `as const`, with an `abiHash` per contract. Never hand-copied; `contracts/AGENTS.md` already requires this and records that the generation command does not exist yet. The command is added here, wired as `npm run contracts:abi`, and CI fails when the committed ABI differs from a fresh `forge build`.
- `src/preset.ts` — the economic preset as a type plus a versioned JSON descriptor and its `configHash`: `presetId`, `version`, `quoteToken` with decimals, `totalSupply`, `saleAllocation`, `lpAllocation`, `virtualTokenReserve`, `virtualQuoteReserve`, `buyFeeBps`, `sellFeeBps`, `protocolShareBps`, `launchFee`, `lpFeeTier`, `lpCreatorShareBps`, adapter and locker addresses, and `roundingPolicyVersion`. Values stay placeholders until product closes LP-01; the shape does not.
- `src/deployments.ts` — one record per environment: `chainId`, address, `deploymentBlock`, `abiHash`, `codeHash`, contract version. Populated only from a verified deployment; an unverified address is absent, never guessed.
- `src/events.ts` — the twelve event names and field lists from the product specification, as types the decoder and the indexer share.

Exit criteria: `npm run contracts:abi` regenerates identical files from a clean checkout; `packages/chain` still declares no runtime dependencies; a test asserts every event in `events.ts` exists in the generated ABI with matching field names and types, so an event rename cannot pass CI silently.

## 5. Track A — contracts

Deps first: `contracts/lib/` pinned by commit, not by tag — forge-std, OpenZeppelin 5.x, and v4-core/v4-periphery at the revision the spike validates. Licenses recorded. A fork of an audited library does not inherit its audit.

**A1 — `PicklerCurveMath`.** A pure library in integer arithmetic: buy exact-input, buy exact-output, sell exact-input, and the derivation of `X0`, `Q0` and `L` from a chosen sale allocation, LP allocation and target reserve. Rounding is directional — required input up, delivered output down — and the direction is part of the tested contract, not an implementation detail. The library is the only place curve arithmetic exists in Solidity.

A companion script emits the preset descriptor from chosen inputs and proves price continuity at graduation, `R_end / L ≈ p_end` within a stated tolerance, with `R_end` excluding fees. This script is how LP-01 gets closed later without touching contract code: product supplies numbers, the script validates them and produces the descriptor and its `configHash`.

Exit criteria: unit tests for each direction; fuzz across the full range of decimals and amounts; invariant tests asserting no round-trip profit from rounding, that virtual reserves are never spendable, and that a direct token donation changes neither price nor phase; accumulated error measured over long random sequences and bounded; dust accounted explicitly.

**A2 — token, factory, registry.** `PicklerAgentToken` is a fixed-supply ERC-20 with no mint after construction, no transfer tax, no rebase, no blacklist and no creator privilege. `PicklerLaunchFactory` creates the token and curve, pins an immutable preset version per launch, and enforces creator authorization: `creator == caller`, or a valid EIP-712 authorization with a consumable nonce, `chainId`, `verifyingContract`, `paramsHash` and a deadline. One canonical token per `agentKey` per factory per network; `agentKey` derives from the creator namespace and a stable identifier, never from the ticker. A gas sponsor does not become the creator, and replaying an authorization does not create a second launch.

Exit criteria: supply and allocation sums hold; no caller and no admin can mint or withdraw protected funds; authorization replay, `agentKey` impersonation, wrong `chainId`, smart-wallet signatures and a recipient different from the payer are all covered; factory bytecode size and launch gas measured against the block limit.

**Done, 2026-09-22.** `PicklerAgentToken`, `PicklerPreset` and `PicklerLaunchFactory`, with `ICurveDeployer` separating the factory from what a curve is. A launch costs ~830k gas; the factory sits under the size limit; both are asserted rather than measured once. The preset gate refuses a configuration below the precision floor A1 found.

**A3 — `PicklerBondingCurve`.** `buyExactInput`, `buyExactOutput`, `sellExactInput`, `quoteBuy`, `quoteSell`, `getCurveState`. Exact-input that exceeds remaining inventory reverts with `ExceedsRemainingSupply`; the quote returns `remainingTokens` and an exact-output alternative with `maxQuoteIn`, charging only what is required and returning any excess in the same transaction. The purchase that exhausts the sale allocation sets `READY_TO_GRADUATE`; it does not create the pool.

Exit criteria: the four reserve compartments never mix — no amount counted as both reserve and fee; fee-on-transfer and rebasing quote assets rejected rather than mishandled; reentrancy covered; `minOut`, `maxIn` and `deadline` enforced; the last-purchase and concurrent-purchase paths tested including the revert that a competing buy causes.

**Done, 2026-09-22.** `PicklerBondingCurve` and `PicklerCurveDeployer`, with 20 unit tests, 4 invariants over 8192 calls each, and an integration suite running factory → curve → trading → handoff with no stubs. The curve exposes `releaseForGraduation` for A5 and `remitFees` for A6, so both can land without changing it.

**A4 — Uniswap V4 spike.** Starts at D0. On a fork of the target environment, with the real deployed V4 contracts rather than mocks: create a pool, mint a full-range position, lock it, collect fees without reducing liquidity, and swap. Resolve asset ordering, decimals, `sqrtPriceX96`, tick spacing and valid full-range bounds, fee tier, mint slippage bounds, and the unlock/callback and approval flow for the actual PositionManager version. Produce a working answer to pool pre-initialization by an attacker; a salt is not assumed to be sufficient. Verify bytecode against the environment manifest before using any address — the official deployment list covers Monad mainnet 143 and those addresses do not transfer to testnet.

Exit criteria: a passing fork test for every step above, the anti-pre-initialization mitigation demonstrated rather than asserted, and a written note recording the PositionManager version, the addresses used and their code hashes. If the spike fails, A5 does not start and the finding goes back to product, because the post-graduation revenue model depends on it.

**Done, 2026-09-21.** Six fork tests pass in `contracts/test/fork/`; addresses and code hashes are recorded per network in `packages/chain/src/deployments.ts`; the findings, the inherited constraints for A5, and the one blocking decision the spike surfaced are in [the spike report](../market/uniswap-v4-spike.md).

**A5 — graduation adapter and locker.** `finalizeGraduation` is permissionless, valid only in `READY_TO_GRADUATE`, and atomic: withdraw exactly `R_end` and `L`, create or verify the pool, add liquidity, lock the position. Any failure reverts and the funds stay in the curve. The phase becomes `POOL_ACTIVE` only after the pool and the locker's ownership are verified. Pre-flight rejects an existing pool whose price, hook or conditions deviate beyond tolerance. The locker holds the principal permanently and exposes fee collection only — no generic `execute`, no `delegatecall`, no rescue of the LP NFT, and no upgrade path that could add one later. Mint dust goes to an immutable locked-reserve destination, never to discretionary revenue.

Exit criteria: finalization succeeds exactly once; a DEX failure reverts with no loss and the retry remains permissionless; a maliciously pre-initialized pool is rejected; initial pool price, ticks and decimals are coherent; the locker demonstrably collects fees without reducing liquidity or releasing principal.

**Done, 2026-09-22.** `PicklerGraduationAdapterV4` and `PicklerLiquidityLocker`, exercised by five fork tests against the real deployment. Which venue a testnet launch graduates into is still the open decision below; the contracts take their addresses as constructor arguments, so that choice is configuration rather than code.

**A6 — `PicklerFeeEscrow`.** Credits and claims per asset, checks-effects-interactions, reentrancy protected, and `claim` debits only the caller's balance so a wallet that rejects transfers cannot block anyone else. Changing a fee recipient affects future accruals only; already accrued balances are never reassigned.

**Done, 2026-09-22.** `PicklerFeeEscrow`, plus a two-step creator fee recipient transfer on the factory. Attribution is atomic with the transfer that funds it, so two launches sharing a quote asset cannot have their fees confused.

There is no administrative pause on existing trading and no `ownerWithdraw`. A permanently ungraduatable launch is a known residual risk the product specification accepts in exchange for having no administrative power to drain reserves; the plan does not quietly add one.

## 6. Track B — data, indexer, API

**B1 — RPC client.** viem in `packages/infrastructure`, with a primary and a secondary endpoint, `chainId` verified on connect, block-pinned reads so a multi-call view is internally consistent, and backoff under quota. A business port in `packages/core` describes what the domain needs; the viem client implements it. `packages/core` does not import viem.

**B2 — migrations.** Additive, generated by `npm run db:generate`. `market.*` already covers trades, holders, candles, pools, fee payouts and cursors. What is missing: `launch_drafts`, `launch_presets`, `launch_metadata_versions`, `transaction_requests` and an `outbox` — these describe drafting, preparation and delivery, so they belong in a new `launch` schema rather than widening `market`, which is a projection schema. `chain_blocks` and `chain_events` — raw log, parent hash, finality and orphan status — belong next to `indexer_cursors` in `market`. Every `uint256` is stored as exact decimal wide enough for 78 digits, never a 64-bit integer and never a float. RLS on, grants by ownership and scope, no service-role key reachable from the frontend.

**B3 — `workers/indexer`.** A new Cloudflare worker copying the proven Queue + Cron + Hyperdrive wiring of `workers/research`. It bootstraps from each contract's `deploymentBlock`, not from server start; discovers curves from factory events and backfills each from its creation block including operations in the same transaction; identifies a log by `chainId + blockHash + txHash + logIndex`; keeps parent hash and ordering so an orphaned block can be rolled back and its projections and outbox rebuilt; commits projection and outbox atomically; and distinguishes `observed`, `confirmed` and `finalized` under a policy measured against Monad rather than a guessed confirmation count. Websocket accelerates; polling and backfill guarantee completeness. Post-graduation swaps are indexed from the PoolManager by `poolId`, starting at the graduation block so a swap in that same block is not lost, and a liquidity addition is never counted as a purchase.

Exit criteria: a replay from the first block reconstructs an identical catalogue; duplicate delivery does not change volume; a simulated reorg on a local chain reverts projections; reconciliation against on-chain reads at the same block reports no drift in phase, supply, inventory, reserve or claims.

**B4 — repositories.** The first writers for `market.*`, in `packages/infrastructure`, behind ports in a new `packages/core/src/features/launch`. Idempotent by log identity.

**B5 — DTOs.** A new module in `@pickler/api-schema` for launches, curve state, quotes and preparation. `markets.ts` stays untouched — it is Perpl. Amounts serialize as strings with explicit decimals; every asset identity carries its `chainId`; the error codes of the product specification become one discriminated union, and custom Solidity reverts decode into those same codes so an error is never invented at the HTTP layer.

**B6 — API.** The read routes and the quote/prepare routes of the product specification, in `workers/api`. Every read response carries `asOfBlock`, `asOfBlockHash`, `indexedAt`, `finality` and `stale`. Quoting is refused, not estimated, when fresh chain state is unavailable. `Idempotency-Key` is required on creation, preparation and transaction registration, scoped to user plus route plus key with a payload hash, and a different payload under the same key is a conflict. The API never custodies funds and never signs.

**B7 — web.** `/tokens` and `/tokens/[ticker]` stop reading `/v1/demo/*` and read the real routes behind a flag, with explicit states for testnet, provisional, stale and absent data. Launch and trade flows use an injected EIP-1193 wallet. Buy confirmation shows maximum spend, expected and minimum tokens, average price, estimated impact, itemized fees, gas, destination, spender and expiry.

## 7. Meeting point

A deployment script brings the real contracts up on a local anvil chain. The indexer and the API are developed against that from the moment the curve compiles — real logs, real reverts, real reorg tests via anvil's block manipulation — not against invented fixtures.

**Revised 2026-09-21 by the A4 spike.** The plan said Monad testnet 10143 would follow. It cannot, as written: there is no official Uniswap V4 on 10143 — every address on Uniswap's deployment page returns zero code there, and the page lists Monad mainnet only. What exists is a Monad-maintained V4, which works but is a different build (its PoolManager is 34582 bytes against mainnet's 24009). The full graduation lifecycle passes against it; see [the spike findings](../market/uniswap-v4-spike.md). Choosing between graduating on mainnet only, deploying our own V4 to testnet, or demoing on the Monad-maintained one is now an open decision below, and A5 cannot be called finished until it is made.

## 8. Rules that cross every deliverable

**The quote is on-chain.** `quoteBuy` and `quoteSell` by `eth_call` at a block are the authority. A TypeScript port of the curve math exists only to preview in the UI, lives in `packages/core` as pure functions, and is bound by parity tests: the Solidity fuzz run writes its vectors to a committed JSON fixture, and the TypeScript test asserts identical results on the same vectors. A quote is never served from a stale cache, and a quote never locks a price.

**A receipt is the truth.** An HTTP 200, a returned transaction hash, or an application event is not proof that a trade happened. Only a canonical receipt and its logs are. A reverted transaction emits no event, so a pending `READY_TO_GRADUATE` is detected from state and failed receipts, never from an imagined failure event.

**Separate the four compartments** — curve reserve, token inventory, fee escrow, locked LP — in code, in the schema and in the UI. The agent's operating wallet touches none of them. No projection may present market capitalization as available cash.

## 9. Testing

Each deliverable carries the exit criteria stated above, and they gate the next one. Beyond those:

- `npm test` discovery in `package.json` is extended for each new suite; `AGENTS.md` requires this and an unrun test is not coverage.
- Solidity: unit, fuzz and invariant tests, plus fork tests against real verified contracts. A mock does not establish V4 compatibility.
- Parity: TypeScript against Solidity on shared vectors.
- Indexer: replay, duplicate, reorg and reconciliation, on a local chain.
- API: idempotency distinguishes payloads; user A can neither edit B's agent nor read its secrets; a failed lookup returns an error, never a zero balance.
- Integrated: create an agent, review the preset, sign the launch, two wallets buy and sell, view trades and candles, consume the remainder, finalize the pool, trade post-graduation, collect and claim fees, and read all of it back through the API. Separately, show Perpl activity funded by the creator's budget and prove it does not move the curve reserve.

No mainnet criterion is met by this plan alone. Mainnet additionally requires approved economic parameters, a threat model, an independent contract review, a verified manifest, measured RPC and finality behaviour, explicit acceptance of the failed-graduation policy, and an operational runbook.

## 10. Out of scope

Research, Perpl and the `markets.ts` DTOs, budget, Turnkey, `apps/agent-service`, Mera signing, Robinhood Chain, bridging, a second canonical market per token, treasury or dividends or buybacks, token-weighted voting, copy trading, a custom V4 hook that taxes all swaps, and any administrative pause or withdrawal path.

## 11. Open decisions

These block specific deliverables, not the start of work.

| Decision                                                        | Blocks                      | Owner                          |
| --------------------------------------------------------------- | --------------------------- | ------------------------------ |
| Preset numbers: supply, LP split, fees, target                  | Deployment, not development | Product, via the A1 script     |
| Quote asset confirmed as AUSD on 10143                          | B1, A2                      | Product and engineering        |
| Where a testnet launch graduates, given no official V4 on 10143 | A5, the demo                | Product and engineering        |
| V4 fee tier — the spike measured 1% / spacing 200               | A5                          | Product, informed by A4        |
| Finality policy and staleness thresholds                        | B3, B6                      | Engineering, measured on Monad |
| Acceptance of the no-admin-recovery policy                      | Mainnet                     | Product and security review    |
| Launch protection and MEV posture                               | Mainnet                     | Product and security           |

## 12. Mapping to the product backlog

| Product item   | Deliverable here                                                  |
| -------------- | ----------------------------------------------------------------- |
| LP-01          | A1 script; numbers stay with product                              |
| LP-02          | A4                                                                |
| LP-03          | A2 authorization; wallet link writer in B4; Mera signing excluded |
| LP-04          | A1                                                                |
| LP-05          | A2                                                                |
| LP-06          | A3                                                                |
| LP-07          | A5                                                                |
| LP-08          | A6                                                                |
| LP-09          | B2, largely already modelled                                      |
| LP-10          | B3                                                                |
| LP-11          | B5, B6                                                            |
| LP-12          | B6 prepare routes, B7 wallet                                      |
| LP-13          | B7                                                                |
| LP-14          | D0, plus OpenAPI in B6                                            |
| LP-15          | B3 cron and alerting; runbooks with the first testnet deployment  |
| LP-16          | Section 9                                                         |
| LP-17 to LP-22 | Not planned here                                                  |
