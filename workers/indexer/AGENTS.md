# Indexer worker instructions

Read [the root instructions](../../AGENTS.md) and [infrastructure instructions](../../packages/infrastructure/AGENTS.md) first.

## Responsibility and current state

`@pickler/indexer-worker` runs the launch indexer on a cron trigger. It holds no logic of its own: a pass is `runIndexerPass` from `@pickler/infrastructure`, which is tested against a real PostgreSQL with a scripted chain. What lives here is the schedule, the bindings and the configuration check.

`src/config.ts` requires deployment identity and RPC endpoints; confirmations default to zero and the pass limit to 100 blocks. Without a factory address, a deployment block, a chain id and at least one RPC endpoint, the pass does not run and the worker says so. An address or a start block guessed wrong produces an index that looks populated and is not, which is harder to notice than an indexer that plainly never started. No Pickler contract is deployed, so today it refuses on every trigger — that is the intended behaviour, not a gap.

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

## Projection delivery

`runConfiguredPass` is the common scheduled pipeline tested with controlled chain data. It indexes factory, discovered curve and graduation events, then updates the catalogue, including when the cursor is caught up. Projection failures retry on a later cron pass. Store and projector share the invocation pool and only its owner closes it. No contracts or indexer are deployed by the integration fixes.
