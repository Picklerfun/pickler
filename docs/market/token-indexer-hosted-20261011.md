# Hosted testnet indexer readiness — 11 October 2026

## Scope and launch gates

The reviewed version-2 Uniswap V4 policy allows only product agent
`80c2e814-db8a-474b-85d2-6a86a4959c34` (`teterabob`) on Monad testnet (10143).
The API launcher and on-chain factory remain disabled. The owner's registered master wallet
is still the direct transaction sender; Pickler's dedicated grant authority only signs eligibility.
No new token, passkey activity, trading activation or mainnet deployment occurs in this task.

[Launch policy](token-launch-policy-testnet-20261011.json) and
[indexer policy](token-indexer-policy-testnet-20261011.json) are public configuration, not secrets.
Provision their minified JSON as backend runtime bindings. Never provision the private grant key
in the indexer, web build, documentation or Git. The minified launch policy is 4,695 bytes,
below Cloudflare's 5-KiB variable limit.

## Reviewed limits

- Launch: at most 4,000,000 gas, 120 gwei and 0.48 test MON per exact transaction. This ceiling
  exceeds the observed 2,969,157-gas factory launch plus 20% padding; it is not a gas quote.
- Owner operation: 400 RPC calls, with the existing 100-call recovery reservation retained.
- Indexer: 100 blocks per source/pass, at most six passes per tick, 800 calls per pass and
  750,000 calls per UTC day. Four concurrent RPC calls and a 180-second renewable lease.
- At most one attributed pre-graduation curve per pass, rotated by cursor progress.
- One free public transport: `https://rpc.ankr.com/monad_testnet`. No fallback, paid API,
  implicit budget increase, hole skipping or cursor fast-forward.
- Five confirmations; every header and parent is verified before canonical commit.

The daily ceiling includes backfill and ongoing chain growth. It is an explicit hard ceiling,
not a promise of unlimited throughput. Exhaustion stops work; it never increases automatically.
The existing Workers account uses the Standard usage model; no plan or paid RPC was purchased.

## Contract and transport preflight

The production driver checked all runtime hashes, AUSD implementation, contract relationships,
complete preset 1/version 4 and venue commitment against real testnet. It then correctly refused
`POLICY_CHANGED` because the factory is closed. Separate reads confirmed the dedicated authority,
unchanged operator and false launch gate. This is read-only configuration validation, not an
owner launch or simulated successful readiness response.

Pickler source hashes and creation blocks come from the existing canonical acceptance receipts.
External PoolManager/PositionManager/StateView creation blocks were obtained from MonadVision's
Sourcify deployment records. AUSD and Permit2 creation transactions were located through
MonadScan and confirmed with the official free testnet RPC. The earlier public registry's
external `deploymentBlock` entries describe its observation block; this policy uses creation
blocks rather than copying that observation date as a deployment date.

Ankr and the official RPC both returned the original factory block and event-block token name.
Ankr refused much older arbitrary historical-state queries and omitted the old AUSD creation
receipt; the official RPC returned that receipt. These checks do not justify a runtime fallback.
The configured indexer must fail on unavailable historical evidence.

## Deployment and capacity evidence

[The machine-readable evidence](token-indexer-hosted-20261011.json) records the exact runtime
versions, policy hashes, source commits, public API response and six observed Cron runs. The API
settings-only version `368de971-af7c-4f22-9741-8d2730c9e339` preserves all 35 prior binding names
and types and adds four reviewed runtime values. No grant key is present in the indexer.

The first indexer version `d135b20d-925e-4285-93fe-e42917c4999b` performed canonical recovery
beginning at the actual creation blocks. It processed six passes/600 blocks per source in 287–298 seconds,
with 810 calls per ordinary tick. Three consecutive ticks advanced only about 120 blocks/minute
including Cron gaps, below the measured chain growth of 198.73 blocks/minute. This failed capacity
acceptance; increasing RPC budgets or skipping history would not correct it.

`PostgresLaunchIndexStore.applyBatch` formerly issued one insert for each header: four sources
meant 400 PostgreSQL header statements per pass. The correction inserts each bounded source
range with one statement, retaining its transaction, lease fence, ancestry checks, first evidence,
upserts, event/outbox/cursor atomicity and reorg behavior. No migration, range increase, new
provider, changed concurrency or higher budget was introduced.

Corrected source commit `eec28a898f318407214afdeac0c5437381db08da` is deployed as version
`7a59bf87-ecfe-4baf-b241-63650dfd9021`, deployment `e6bf94bd-df47-4df2-99d2-8f9ed53d019f`.
Three consecutive real ticks completed in 83.5–84.9 seconds, still with exactly 810 RPC calls and
600 blocks per source. Because overlapping minute ticks correctly refused the live lease, actual
cursor throughput including Cron gaps was 300.18 blocks/minute over the recorded window, above
chain growth. No exceptions, holes or duplicate launches were observed. This is a bounded
three-run capacity observation, not long-term acceptance at future agent scale.

The public catalogue returned HTTP 200 and the original test token
`0x066c47cde99397869809e0da2d0d4fe40b14b375`, fixed supply 21 million and `agentId:null`. It must
remain unattributed: no owner product grant exists for that historical faucet-funded launch.
This does not prove the hosted owner grant → metadata freeze → passkey → new launch path or a
product-attributed V4 position. The existing public `stale` flag measures recent cursor writes;
`stale:false` during active backfill does **not** mean caught up. Use the explicit block and
indexer `caughtUp` result for readiness. The historical catalogue phase is not owner graduation
acceptance.

At the final chain read, roughly 123,000 blocks remained behind the confirmed tip. At this short
window's observed net rate the estimate was about 20 hours; this is not an SLA and changes with
RPC latency, chain rate, outages and the hard daily quota. The bounded Cron continues recovery.
Both the API launcher and factory remain closed; the fresh factory read confirmed false. No
transaction or passkey activity was created in this task. Full catch-up and the owner's explicit
launch walkthrough remain pending. Never enable launches automatically when recovery completes.

## Local validation and reproducible commands

The 37 affected scheduling, configuration and real PostgreSQL tests passed without skips,
including full 100-header replay, first-evidence retention, returning-branch finality and complete
rollback when a header or later event violates a database constraint.
Shared build, infrastructure/API/indexer types, affected lint, repository format, architecture,
staging topology and API/indexer dry-run packaging passed before publication. Tests create isolated
local databases; they do not target the hosted Supabase database or query live providers.

The shared port 55432 belonged to another session and refused connections during recovery.
Do not restart it or reset its volume. This run used its own disposable PostgreSQL 17.6 container
on loopback port 55440, creating and removing a separate database per test:

```sh
docker run --pull never --detach --name pickler-indexer-readiness-20261011 \
  --memory 256m --cpus 1 --publish 127.0.0.1:55440:5432 \
  --env POSTGRES_USER=pickler --env POSTGRES_PASSWORD=pickler_local_only \
  --env POSTGRES_DB=pickler --health-cmd 'pg_isready -U pickler -d pickler' \
  --health-interval 2s --health-timeout 3s --health-retries 20 postgres:17.6
# Wait for this container's health status to be healthy before starting tests.
npm run build:shared
TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55440/pickler \
  node --import tsx --test --test-concurrency=1 workers/indexer/test/*.test.ts packages/infrastructure/test/launch-indexer.test.ts packages/infrastructure/test/uniswap-indexer.test.ts
npm run typecheck --workspace=@pickler/indexer-worker
npm run build:worker --workspace=@pickler/indexer-worker
docker rm --force --volumes pickler-indexer-readiness-20261011
```

Normal committed Worker configuration retains `TOKEN_INDEXER_ENABLED=false`. The explicit
operator-only deployment supplies the two committed public policies again; do not assume a
normal Wrangler deployment preserves previously uploaded plaintext variables:

```sh
npx wrangler deploy --config workers/indexer/wrangler.jsonc \
  --var TOKEN_INDEXER_ENABLED:true \
  --var "TOKEN_LAUNCH_POLICY_JSON:$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync("docs/market/token-launch-policy-testnet-20261011.json", "utf8"))))')" \
  --var "TOKEN_INDEXER_POLICY_JSON:$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync("docs/market/token-indexer-policy-testnet-20261011.json", "utf8"))))')"
```

This command publishes the indexer and its minute Cron, not the API or factory. Confirm the
trusted `DATABASE` Hyperdrive binding, policy hashes, source commit and resulting deployment
before observing progress. Do not use a preview fixture or test database as hosted evidence.

## Scenario matrix

| Scenario                                                          | Evidence                                                              | Status                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| Dedicated grant authority, unchanged operator and closed factory  | Canonical registration plus fresh production-driver/read-only checks  | Passed remotely                |
| One-agent V4 policy, API binding preservation, fixed gas ceilings | Runtime settings and reviewed chain economics                         | Passed remotely/read-only      |
| Old header-by-header persistence below chain rate                 | Three actual 287–298-second ticks                                     | Confirmed and corrected        |
| Complete batch replay, first evidence, finality, atomic rollback  | 37 isolated PostgreSQL/schedule/configuration regressions             | Passed locally                 |
| Public API → hosted PostgreSQL → recovered historical test token  | HTTP 200, canonical block, fixed supply, `agentId:null`               | Passed remotely                |
| Corrected capacity above current chain growth                     | Three consecutive ticks, unchanged 810 calls/tick                     | Passed for bounded observation |
| Complete historical recovery and sustained future-scale capacity  | Approximately 123,000 blocks still behind; no future-agent acceptance | In progress / pending          |
| Owner JWT → R2 freeze → master passkey → new launch → attribution | No hosted owner walkthrough                                           | Pending                        |
| General launch/mainnet                                            | API and on-chain launch gates remain closed                           | Disabled                       |
