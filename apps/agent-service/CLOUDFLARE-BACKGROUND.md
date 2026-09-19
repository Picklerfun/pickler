# Local Cloudflare background research experiment

This experiment runs the existing tenant Hono API and Mastra-backed research runner in Cloudflare's local workerd runtime, with local Queues and a separate database inside Supabase. It does not deploy a public API or alter the retained remote runtime probe.

## Flow

1. `POST /agents/:id/runs` authenticates the lab token and durably enqueues a PostgreSQL job using the existing admission rules and idempotency key.
2. The API sends a generic queue wakeup and returns `202 { runId, status }`. It never awaits research. If wakeup delivery fails, the accepted PostgreSQL job remains queued for reconciliation.
3. The consumer recovers only expired leases and claims one eligible job under the shared capacity policy. It renews that job’s 60-second lease every 15 seconds while awaiting the core runner. Every event and final result requires current ownership. No research is detached through HTTP `waitUntil()`.
4. The caller polls `GET /runs/:runId`, for example every three seconds, until `completed`, `failed`, or `cancelled`. Polling only reads state. `GET /runs/:runId/events` returns evidence scoped to the authenticated tenant.
5. Each claimed job sends a wakeup before research and another after completion so other agents can use spare capacity. A periodic scheduled event creates due jobs and sends a wakeup, repairing missing notifications and interrupted consumers.

Messages contain only `{ kind: "research-wakeup" }`. Tenant identity, permissions, configuration, quotas, evidence and decisions come from PostgreSQL. Duplicate notifications can claim only unstarted jobs; they cannot repeat a running or terminal research. Provider failures are terminal failed runs, not valid abstentions or automatic paid retries. A crash after claim conservatively marks the run `INTERRUPTED` after its lease expires and reconciliation runs, preserving partial evidence.

## Local commands

From the repository root, with Supabase running and provider credentials configured in `apps/agent-service/.env`:

```sh
npm run build:shared
node apps/agent-service/src/cloudflare/background/client.mjs prepare
npx wrangler dev --config apps/agent-service/src/cloudflare/background/wrangler.jsonc --ip 127.0.0.1 --port 8799 --test-scheduled
```

Preparation creates `pickler_cf_queue_<random>` with explicit Drizzle migrations, seeds lab tenants, selects Sports (`1`) for both tenants and leaves schedules disabled. Credentials are written to ignored files with owner-only permissions. It refuses to overwrite existing configuration. The worker rejects non-loopback database hosts and database names outside this isolated prefix. Do not run the Node worker against this database.

In a second terminal:

```sh
# Explicit paid diagnostics; required before enabling schedules.
node apps/agent-service/src/cloudflare/background/client.mjs check
# Explicit paid research; returns before completion.
node apps/agent-service/src/cloudflare/background/client.mjs run
# Read-only: repeat with the returned runId until terminal.
node apps/agent-service/src/cloudflare/background/client.mjs poll <runId>
# Simulate a Cron event locally; may execute already admitted/due work.
node apps/agent-service/src/cloudflare/background/client.mjs tick
```

Polling saves the current run and evidence under the ignored `.data/` directory and validates completed decision v2 documents. Set `RUN_KEY` to reuse an admission key intentionally. Distinct tenant tokens are generated locally; neither the model nor request bodies select a tenant. Existing schedule and pause API routes are unchanged. Enabling a schedule still requires successful connection checks and a completed manual investigation for the current configuration.

Wrangler does not automatically run local Cron events. Invoke `tick` to test reconciliation. The every-minute Cron declaration describes the intended deployed trigger, not an active local timer. The computer and Wrangler process must remain running for this local test.

## Guarantees and limits

- Default active limits: five globally, two per tenant, one per agent. A short policy-row transaction serializes claims, not investigations. This is a functional pilot, not a thousands-agent throughput design.
- Queue retries retry the wakeup; they never rewind a previously started investigation. Automatic recovery needs another queue delivery or scheduled event.
- Consumer concurrency is configured as one, but Cloudflare's local Queue emulator does not enforce that setting; the database lock remains necessary.
- Drizzle migrations add private lease columns and shared execution policy; existing queued job rows remain the durable pending-work record. Admission and notification are not one distributed transaction; reconciliation closes that gap.
- All polls currently create a request-scoped pool and initialize/check provider identity. This favors isolation and reuse in the experiment, not optimized production polling throughput.
- Retain the existing five-minute research deadline. Cloudflare documents a 15-minute Queue consumer wall-time limit; this does not prove capacity, production latency or provider budget.
- Public deployment, hosted Supabase wiring, production authentication, large-scale throughput validation, operational alerts and remote Queue recovery testing remain separate work.

References: [local Queues](https://developers.cloudflare.com/queues/configuration/local-development/), [delivery retries](https://developers.cloudflare.com/queues/configuration/batching-retries/), [Queue limits](https://developers.cloudflare.com/queues/platform/limits/).

## Historical PR #8 validation

`npm run test:supabase` includes offline lifecycle integration tests using real isolated PostgreSQL databases. They verify durable acceptance after notification failure, polling and tenant isolation, duplicate wakeups, per-run ownership and expiry, evidence preservation, pause and unconditional pool cleanup. Provider fixtures in those tests are never selected by the runtime.

Live validation on 2026-09-17 used the configured `deepseek-v4.1-flash` model, real Exa and Polymarket, local workerd Queues and the isolated Supabase database:

- First admission returned 202 in 79 ms. Run `b8517642-45ba-4a70-88f9-92f56b7db05a` failed with `MODEL_INVALID_OUTPUT` after 16.382 seconds; 13 events remained stored. The queue acknowledged the terminal failure without retrying the research.
- Explicit connection diagnostics passed model tool calling, structured output, Polymarket categories and Exa search/read.
- A new explicit admission returned 202 in 80 ms. Run `0426271e-e3dc-4dc8-acc8-00b08d7dacc1` completed in 92.142 seconds with a validated v2 `ABSTAIN`, eight cited source IDs and 26 persisted events. Polling observed both running and completed states after the admission process had exited.
- A simulated Cron event returned 200 during that research. Only the two explicitly admitted runs existed afterward: one failed and one completed. No extra research was created by the additional wakeup.
- Unauthenticated polling returned 401; beta polling alpha's completed run returned 404.
- All 57 automated tests, formatting, lint, types, workspace builds and the Cloudflare dry-run bundle passed.

This validates local asynchronous execution and persistence. It does not establish remote Queue behavior, production throughput, profitability or automatic recovery of paid research. The failed first model output remains a real limitation, not a successful decision.

## Concurrent execution and operator commands

The policy is stored once in `pickler.execution_policy`. To update the normal pilot database, use `npm run agent -- concurrency 5 2`. To update this isolated experiment:

```sh
node apps/agent-service/src/cloudflare/background/client.mjs policy 5 2
LAB_TENANT=alpha node apps/agent-service/src/cloudflare/background/client.mjs run
LAB_TENANT=beta node apps/agent-service/src/cloudflare/background/client.mjs run
LAB_TENANT=beta node apps/agent-service/src/cloudflare/background/client.mjs poll <betaRunId>
```

Limits must be integers with `1 <= tenant <= global <= 250`. Lowering them blocks new claims as necessary but preserves active investigations. Cloudflare delivery concurrency remains a separate configured ceiling of five; raising database limits alone does not increase that ceiling. No new environment variables are required.

The observed local Queue emulator processes consumer invocations serially. To reproduce cross-host overlap, start the updated Node executor against the same isolated database in another terminal while work is pending:

```sh
node apps/agent-service/src/cloudflare/background/client.mjs worker
```

Node remains sequential per process. It uses exactly the same per-run reservation protocol as the Cloudflare consumer. It must never run old global recovery. A heartbeat failure revokes local ownership and aborts further model/tool activity. Requests already sent to a provider can still consume usage. Expired manual investigations are failed, never automatically requeued; partial evidence remains available.

## Upgrade procedure

1. Stop all executors targeting the database, including Node and local Wrangler. Do not mix old binaries with the new schema.
2. Apply `npm run db:migrate` with `DATABASE_MIGRATION_URL` pointing to that database. Migration 0001 adds leases/policy and interrupts existing unleased running jobs without removing queued/history records. Migration 0002 refuses to run while an old session owner remains and blocks legacy recovery/finalization against a valid lease.
3. Rebuild shared packages and start only updated executors. Per-run leases use PostgreSQL time, not caller-supplied timestamps. A store's owner token never appears in HTTP DTOs or model context.
4. Confirm limits and trigger reconciliation. On restart, valid leases remain active until expiration; only expired jobs are interrupted. Roll back application changes only together with an explicit compatible migration plan, never by restarting legacy executors.

## Concurrency validation: 2026-09-17

Real Sports research used the configured `deepseek-v4.1-flash`, Exa and Polymarket in a newly migrated isolated Supabase database. Both admission calls returned 202 (41 ms alpha, 46 ms beta).

| Tenant / executor    | Run                                    | Result                        | Duration | Evidence                        |
| -------------------- | -------------------------------------- | ----------------------------- | -------- | ------------------------------- |
| Alpha / Node         | `15c8770e-225d-46b3-80c7-6193cd38cc79` | `failed/MODEL_INVALID_OUTPUT` | 12.235 s | 11 preserved events             |
| Beta / workerd Queue | `1e06b4d4-c36c-4e76-8f58-efe4d9314aff` | Validated v2 `ABSTAIN`        | 95.581 s | 27 events, six cited source IDs |

Execution timestamps overlap for **12.235 seconds**. Alpha's model failure neither interrupted beta nor caused an automatic retry. Beta's lease renewed during research. The explicit connection check passed before admission. Results remain in the isolated database and ignored `.data/` artifacts. This is evidence of concurrent execution and failure isolation, **not two successful research decisions**, and not a remote Cloudflare concurrency benchmark.

Automated tests exercise concurrent claims across independent PostgreSQL connections, shared capacity changes, lease expiration and renewal, stale write rejection, legacy recovery rejection, heartbeat cleanup/failure, and queue fanout before the first job finishes. Controlled clocks and provider fixtures are used only in tests.

All 65 automated tests passed against local Supabase. Formatting, lint, types, workspace builds and the Cloudflare dry-run bundle passed. The operator command was verified against the isolated database with limits 5/2. Local test executors were stopped after validation; neither the normal pilot database nor the retained remote deployment was migrated or redeployed.
