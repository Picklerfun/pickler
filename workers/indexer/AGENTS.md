# Indexer worker instructions

Read [the root instructions](../../AGENTS.md) and [infrastructure instructions](../../packages/infrastructure/AGENTS.md) first.

## Responsibility and current state

`@pickler/indexer-worker` runs the launch indexer on a cron trigger. It holds no logic of its own: a pass is `runIndexerPass` from `@pickler/infrastructure`, which is tested against a real PostgreSQL with a scripted chain. What lives here is the schedule, the bindings and the configuration check.

`src/config.ts` defaults nothing. Without a factory address, a deployment block, a chain id and at least one RPC endpoint, the pass does not run and the worker says so. An address or a start block guessed wrong produces an index that looks populated and is not, which is harder to notice than an indexer that plainly never started. The isolated acceptance factory is recorded separately; without reviewed hosted deployment
configuration this path deliberately refuses rather than guessing an address.

`wrangler.jsonc` carries no Hyperdrive id for the same reason. Add the binding and the two `LAUNCH_FACTORY_*` vars together, when the contracts land.

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
allowed on this path. The deployment manifest remains blocked; no remote activation is configured.
See [Token operations](../../docs/market/token-launch-operations.md).

## Separate V4 indexing

Reviewed V4 policy 2 routes canonical V4 V2 graduation logs through the infrastructure-owned
Uniswap projector. It reads exact event-block locker/NFT/pool/liquidity state outside SQL, rechecks
canonicality and fences the private lease before commit. Historical Kuru and old V4 streams retain
their existing identity. A controlled PostgreSQL catch-up pass is not proof of hosted throughput.
The isolated testnet acceptance factory is not automatically configured in this Worker; gates and
bindings remain disabled until a reviewed allowlisted product deployment.
