# Indexer CPU and memory diagnosis — 15 October 2026

## Evidence and scope

The user's October 1–15 API findings report 24.06 million CPU ms for this Worker (67.4% of
35.71 million across Workers), 10.53 million CPU ms on October 14 UTC, and 197 `exceededMemory`
invocations on October 15 at the original query cutoff. These aggregates were supplied, not
recomputed here. The billing panel's 20.44 million ms has a different/unverified period and cutoff;
it is not reconciled to the 35.71 million analytics total.

A read-only Cloudflare observability query at approximately 16:29 UTC confirmed a recent
`exceededMemory` invocation ending at `2026-10-15T16:20:27.701Z`: CPU 8,155 ms, wall time
106,186 ms. Nearby invocations returned `passes:[{kind:"busy"}]`, `stopReason:"busy"`, with
7–33 ms CPU. Some busy invocations also waited approximately 14–15 seconds in wall time;
wall time is not CPU time. This bounded sample is not a recomputation of daily totals.

The failing invocation identifies version `55bddc64-ed72-4090-a5e6-03419c285ef8`, created
`2026-10-15T02:16:18.944285Z`. Reading its uploaded code confirmed both full-history lock queries
and the token scheduler. Its public policy is version 2, 100 blocks, six passes per tick,
800 RPC requests per pass, 750,000 per UTC day, a 180-second lease and one curve per pass.
CPU limit is 300,000 ms. The observed CPU is far below that limit; increasing it cannot repair
this memory failure. No settings, Cron, deployment or remote database contents were changed.

The initial checkout was an older branch without this token path. The correction is isolated on
`codex/indexer-bounded-recovery`, based on local `origin/main` commit `3675e1f7` in
`/private/tmp/pickler-indexer-cpu`. The uploaded hot-path queries were independently verified;
this does not establish an exact Git commit for every byte of the deployed bundle.

## Cause and execution path

`workers/indexer/src/index.ts` selects the enabled token path and calls
`runScheduledTokenIndexing` (`token-schedule.ts`). It can call `runTokenIndexer`
(`packages/infrastructure/src/launch/indexer.ts`) six times in one tick. Every admitted pass:

1. Reserves the chain lease and verifies deployment code through admitted RPC reads.
2. Runs bounded contiguous 100-block ranges for factory, adapter, escrow, locker and selected curves.
3. Calls `PostgresLaunchProjector.project`, then the venue position projector.

The primary memory defect is in the final reconciliation transaction of
`PostgresUniswapProjector.project` (`src/launch/uniswap-projector.ts`):

```sql
SELECT hash FROM market.chain_blocks
WHERE chain='eip155:10143' AND NOT orphaned FOR SHARE
```

`pg.query` materializes every returned row and string in JavaScript even though the return value
is ignored. It reads and locks the growing entire canonical header history on every pass,
including passes with no graduation. The historical Kuru projector has the same defect.
Reaching the tip does not eliminate this query. Six passes can repeat it six times.
This is the strongest code-backed explanation for the admitted runs' CPU/memory pattern. A remote
heap/phase profile was unavailable, so the exact fraction of CPU attributable to this query,
versus event replay, transport parsing and GC, remains unmeasured.

A second growing cost is `PostgresLaunchProjector.project`
(`src/persistence/product/launch-projector.ts`): previously it selected every canonical event,
including decoded JSON, into one array and replayed every event. Idempotent inserts prevent
some duplicate effects, but do not prevent repeated queries, transaction fences, mapping reads,
launch upserts and decoding. V4/Kuru candidate selection excludes stored snapshots but previously
had no LIMIT. Their reconciliation writes are set operations in PostgreSQL; they do not require
exporting all headers to the Worker.

The block reader's `fetchRange` queues up to 100 headers per source, but token RPC admission
(`src/launch/indexer-rpc-admission.ts`) drains groups of at most four provider calls after quota
reservation. A per-pass map shares header reads across overlapping sources and is discarded after
the pass. This is bounded concurrency, not unlimited parallel RPC. There is no OFFSET pagination
bug in this route: the defects are unbounded result sets and historical replay.

## Progress, failure and busy behavior

`PostgresLaunchIndexStore.applyBatch` writes blocks, events, outbox and its stream cursor in one
transaction. `nextRange` starts at `cursor.lastBlock + 1` (or the deployment block only when
there is no cursor); `planAdvance` verifies the first parent's link to the stored cursor hash.
It does not restart at the factory deployment on every invocation. A crash before commit repeats only the uncommitted range;
a crash in the later projection cannot roll back previously committed source ranges. Backfill
therefore can advance while every invocation still dies replaying/reconciling an ever-growing
history. The sample alone does not prove that a particular block range is stuck indefinitely.

Lease acquisition atomically inserts/updates `launch.indexer_admission`, keyed by chain. Another
live owner returns `busy` before RPC. RPC group reservations extend expiry by the configured
180 seconds, using database time, while retaining the UTC daily counter. Mutation transactions
check owner and unexpired lease under a row lock. Normal completion/errors stop admission and
release only the matching owner in `finally`. A runtime memory termination may not run `finally`;
other ticks stay busy until 180 seconds after the last successful renewal. A new owner can then
claim once any outstanding database transaction releases its row lock; lease expiry is not a
cancellation mechanism for an open transaction. Old-owner writes/releases cannot take over or
clear the successor's lease. The CPU-heavy
memory failure can repeat after each lease recovery because expiry does not remove the
full-history query. The minute Cron exposes that defect repeatedly; it is not sufficient as the
root cause by itself.

## Local correction

- `launch/projection-locks.ts`: lock only canonical blocks referenced by the relevant stored
  graduation snapshots. Aggregate inside PostgreSQL and return one scalar, preserving transaction
  locks without materializing historical hashes in `pg`.
- V4/Kuru snapshot candidate queries: at most 100 rows per pass. Events without an attributed
  active token are filtered before LIMIT, so a foreign/deferred backlog cannot occupy the page
  ahead of eligible work or trigger unnecessary snapshot RPC reads. Existing snapshot rows remain
  durable progress; snapshot validation/commit and canonical reconciliation are retained.
- Scheduled generic projection: at most 101 pending events loaded, at most 100 applied. Existing
  token/pool/trade rows identify completed effects. It does not introduce a global block watermark
  that would miss late events from another source. Unknown event families are excluded from this
  scheduled path; explicit historical rebuild still reports skipped events as before.
- Ready trades wait for a known curve; earlier missing dependencies do not fill the page ahead of
  later ready launches. A post-write one-row lookahead detects work made ready by the current page.
  Legacy orphaned graduations are explicitly undone and can be restored on a returning branch.
- Source cursors and individual projection transactions remain durable. A failed page retries its
  unfinished suffix; successful metadata/trade effects are not replayed. No new migration is needed.
- Pass results include projection counters/backlog. Pending work prevents a false caught-up result.
- The host checks a 45-second elapsed budget before starting another pass. This is cooperative:
  it allows an in-flight pass to finish and is not a hard 45-second timeout. It leaves policy
  maxima, RPC/daily quotas, confirmations, CPU limit and the remote Cron unchanged.

## Validation and limits

Final validation: **67/67 tests passed, zero skips**, shared build (all five tasks), infrastructure
and indexer TypeScript checks, affected-file ESLint, Prettier, architecture/link checks and the
indexer Wrangler dry-run package all passed. Runtime: Node 24.19.0; lockfile installation used
npm 10.9.3. No root-wide application test/build or remote deployment acceptance is claimed.

Validation uses only controlled providers and a fresh local PostgreSQL 17.6 container on port
55461, never hosted Supabase or live chain operations. Tests cover a 100,000-header history,
100 foreign graduation events preceding an eligible snapshot in each venue,
100/100/5-event resume across a fresh projector, injected mid-page transaction failure and suffix
recovery, late earlier events, metadata failure recovery, orphaned trades/launches, legacy and
V4/Kuru returning branches, lease expiration/busy recovery, successor fencing, daily quotas,
four-call RPC admission, canonical range continuity and bounded scheduling.

A 100,000-header fixture makes the former query return 100,000 rows; the replacement returns one
aggregate row and locks zero unrelated headers. This is a deterministic data-volume regression,
not an estimate of Cloudflare's peak heap or post-deployment CPU savings.

The explicit operator rebuild API still permits full historical replay. PostgreSQL reconciliation
and candidate filtering can still scan growing tables server-side; database CPU/query plans and
future-scale throughput need separate measurement. Permanently invalid evidence remains a visible
failure requiring repair; the correction does not skip corrupt events to claim progress. A single
provider response is still parsed as JSON and the range is bounded by block count, not bytes.
No claim is made that arbitrarily large single-block payloads are now bounded.

Remote acceptance remains pending: observe per-phase/heap behavior, source and projection progress,
`time_limit`/`caughtUp`, CPU and `exceededMemory` after an explicitly authorized deployment.
The shorter cooperative schedule may reduce catch-up throughput; measure it against chain growth
rather than increasing budgets or changing Cron speculatively. No remote change was made here.
