# Indexer worker instructions

Read [the root instructions](../../AGENTS.md) and [infrastructure instructions](../../packages/infrastructure/AGENTS.md) first.

## Responsibility and current state

`@pickler/indexer-worker` runs the launch indexer on a cron trigger. Canonical pass logic is owned by infrastructure: the historical/default path uses `runIndexerPass`; the gated token path uses `runTokenIndexer` with bounded host scheduling. Both are tested against real PostgreSQL with a scripted chain. The Worker owns scheduling, bindings and configuration checks.

`src/config.ts` defaults nothing. Without a factory address, a deployment block, a chain id and at least one RPC endpoint, the pass does not run and the worker says so. An address or a start block guessed wrong produces an index that looks populated and is not, which is harder to notice than an indexer that plainly never started. The isolated acceptance factory is recorded separately; without reviewed hosted deployment
configuration this path deliberately refuses rather than guessing an address.

`wrangler.jsonc` now binds the existing trusted staging Hyperdrive and the single free testnet RPC.
The normal deploy keeps `TOKEN_INDEXER_ENABLED=false`; the reviewed public launch/indexer policies
are provisioned separately as runtime bindings. Explicit operator activation and its capacity record
are documented in [the hosted readiness guide](../../docs/market/token-indexer-hosted-20261011.md).
Never infer launch activation from the indexer or isolated deployment receipts.

## Rules

- Keep indexing logic in `packages/infrastructure`. A rule that only exists in this worker cannot be tested without deploying it.
- Use the trusted `DATABASE` binding. Never fall back to a hosted secret outside `local`.
- A gap and a reorg are outcomes, not failures: log them and let the next pass continue. A gap means a range was refused rather than applied with a hole; a reorg means a branch was unwound.
- Ranges are small on purpose. Every block in a range is fetched so each parent is verified, which is what stops a reorg passing unnoticed between sparse samples. Widen `MAX_BLOCKS_PER_PASS` only with that cost in mind.

## Commands

From the repository root:

```sh
npm test                 # includes workers/indexer/test
npm run typecheck
npm run build:workers    # dry-run build, no deploy
```

## Passive Kuru indexing

The separate `TOKEN_INDEXER_ENABLED` path composes `runTokenIndexer` with the complete reviewed
launch policy, one RPC transport and explicit per-pass/daily budgets. It indexes factory, adapter,
locker, escrow and registered curves in ranges of 100 blocks under one renewable private lease,
then projects canonical launch identity and Kuru position snapshots. No legacy fallback is
allowed on this path. The Kuru deployment manifest remains blocked; this does not activate Kuru.
See [Token operations](../../docs/market/token-launch-operations.md).

## Separate V4 indexing

Reviewed V4 policy 2 routes canonical V4 V2 graduation logs through the infrastructure-owned
Uniswap projector. It reads exact event-block locker/NFT/pool/liquidity state outside SQL, rechecks
canonicality and fences the private lease before commit. Historical Kuru and old V4 streams retain
their existing identity. A controlled PostgreSQL catch-up pass is not proof of hosted throughput.
The dated public V4 policy pins the actual isolated factory deployment block and one product agent.
Its runtime binding does not enable the API launcher or the on-chain factory.

## Versioned bounded schedule

`src/token-schedule.ts` is host scheduling only. It parses the infrastructure-owned strict policy
before work: version 1 runs one pass, version 2 permits 1–6 passes through `maxPassesPerTick`.
Stop at the confirmed snapshot, explicit tick limit, busy lease, gap, reorg or thrown error. Never
immediately retry a gap/reorg or swallow an RPC/quota error. Each pass independently reserves
its infrastructure lease and per-pass/daily RPC budget; no SQL lock spans provider work.
`test/token-schedule.test.ts` covers bounded/historical behavior and failure stops. Ranges stay
at 100 blocks. The [readiness record](../../docs/market/token-launch-readiness-20261010.md) distinguishes
controlled PostgreSQL catch-up from the still-pending sustained hosted capacity acceptance.
