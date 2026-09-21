# Uniswap V4 spike — findings

LP-02 / deliverable A4 of [the launchpad development specification](../specs/launchpad-monad-v1.md). Executed 2026-09-21. Every claim below was produced by running code against a real chain, not by reading documentation; the tests are in `contracts/test/fork/` and the verified addresses in `packages/chain/src/deployments.ts`.

Run them with:

```sh
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz npm run contracts:test:fork
```

They are excluded from `npm run contracts:test`, so the offline suite stays offline.

## The finding that changes the plan

**There is no official Uniswap V4 on Monad testnet.** Uniswap's deployment page lists Monad mainnet (143) only, and `eth_getCode` at every one of those addresses on testnet 10143 returns zero bytes. The launchpad development specification said the work would meet on "Monad testnet 10143 once the V4 spike has passed"; that is not possible as written.

What exists on testnet instead is a **Monad-maintained V4 deployment**, published in `monad-developers/uniswap-v4-hooks-example` and explicitly described there as "not an official Uniswap deployment". It works — the whole graduation lifecycle runs against it, below — but it is a different build:

|                 | Monad mainnet 143 (official)      | Monad testnet 10143 (Monad-maintained) |
| --------------- | --------------------------------- | -------------------------------------- |
| PoolManager     | `0x188d586D…9F9eA8e`, 24009 bytes | `0x451D64ab…dc643d`, **34582 bytes**   |
| PositionManager | `0x5b7Ec4a9…72f4016`, 23877 bytes | `0x3Bb14E3D…676C31A`, 23877 bytes      |
| Permit2         | `0x00000000…c78BA3`               | same address, **different code hash**  |

The PoolManager code sizes differ by more than 10 KB, and the testnet one exceeds the 24576-byte EIP-170 limit that constrains the mainnet build. These are not the same contract. A passing test on testnet is evidence about testnet.

The Permit2 row is the sharper warning: an identical address across two chains holds different bytecode. Address equality proves nothing, which is why `packages/chain/src/deployments.ts` records a code hash per network and a test asserts these two differ.

Three options follow, and this is a product and engineering decision rather than something the spike can settle:

1. **Graduate on mainnet only**, and let testnet launches stop at `READY_TO_GRADUATE`. Honest, but the end-to-end demo never completes off mainnet.
2. **Deploy our own V4 to testnet** from the pinned commits, so the demo completes against contracts we control. Costs a deployment and its verification, and still is not the mainnet build.
3. **Use the Monad-maintained deployment for the demo**, labelled as such. Cheapest, and adequate for a demo that is already labelled testnet — provided nothing about it is described as a mainnet rehearsal.

## What the spike proved

Against the Monad-maintained deployment, forked at block 62279958 — the block Monad's own manifest records as verified, so the test reads the state Monad checked:

- **The pool opens at the price the curve closed at.** `test_thePoolOpensAtThePriceTheCurveClosedAt` initializes at a `sqrtPriceX96` derived from the LP allocation and target reserve, then reads `slot0` back and compares to the intended ratio within 0.1%. This is the join `PicklerCurveMath.deriveReserves` exists to guarantee, now checked in pool terms rather than only in curve terms.
- **A full-range position mints and holds liquidity.** `MINT_POSITION` + `SETTLE_PAIR` through the real PositionManager, with Permit2 approvals, full-range ticks aligned to the 200 spacing of the 1% fee tier.
- **Fees are collectable without releasing principal.** `DECREASE_LIQUIDITY` of zero followed by `TAKE_PAIR` moves accrued fees out while `getPositionLiquidity` is unchanged. This is the shape the locker needs, and it is the locker's entire claim, so it is now demonstrated rather than assumed.
- **A pre-initialized pool is detectable before liquidity is committed.** An attacker initializes the pool at four times our price; re-initializing reverts, and `slot0` reads back the attacker's price. The mitigation is therefore a mandatory pre-flight comparison in the adapter, not a salt: the pool's identity is its `PoolKey`, and anyone can open it first.

## What the adapter in A5 inherits

- **Currency order is decided by address, not by role.** Whether the agent token is `currency0` depends on how its address compares to the quote token's, which in turn depends on deployment. The adapter must handle both and must not assume the agent token sorts first. The spike's own price check overflowed `uint256` on the branch where the agent token is `currency1` — caught by testing both orders — and needed `FullMath.mulDiv` to carry the 512-bit intermediate.
- **Approvals are two-step.** `approve(Permit2)` on the ERC-20, then `Permit2.approve(token, positionManager, amount, expiry)`. A single ERC-20 approval to the PositionManager is not enough.
- **The fee tier is a measured choice, not a default.** The spike ran at 1% / spacing 200. Another tier changes usable tick bounds and the fee accrual the revenue model depends on; it must be re-measured, not assumed.
- **Gas, observed:** pool open plus full-range mint ≈ 550k; fee collection within an 808k lifecycle test including two swaps. Well inside a block, but these are the numbers `finalizeGraduation` has to fit atomically alongside withdrawing from the curve.

## Not covered

The locker contract itself, since it does not exist yet — the spike proved the PositionManager supports the operations the locker needs, not that our locker implements them safely. Swap-fee accrual to a specific recipient split. Mainnet execution of any kind. AUSD as the live quote asset: it is a proxy whose storage `deal` cannot reliably rewrite, so the spike used a 6-decimal mock in its place, reproducing decimals and ordering but not AUSD's own transfer behaviour. Testing against real AUSD needs a funded testnet account and belongs with the first testnet deployment.

## Sources

- [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments) — Monad mainnet 143; no testnet entry.
- [monad-developers/uniswap-v4-hooks-example](https://github.com/monad-developers/uniswap-v4-hooks-example) — the Monad-maintained testnet deployment, its manifest and its pinned commits.
- [monad-crypto/protocols#479](https://github.com/monad-crypto/protocols/pull/479) — the registry entry for that infrastructure.
