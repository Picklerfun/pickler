# Research Worker

Read the root and packages/agent-runtime instructions first. This is the deployed Queue and
Cron host, distinct from the protected local experiment in apps/agent-service. Do not remove
that experiment's database/loopback guards. No HTTP handler, Studio, or tenant tokens here.

Use invocation-scoped PostgreSQL through the DATABASE Hyperdrive binding. Hyperdrive verifies
origin TLS against the Supabase CA on session-pooler port 5432, with query caching disabled. Await one leased research per
Queue delivery, including heartbeat cleanup and database closure. Generic wakeup messages
never authorize a tenant. PostgreSQL controls admission, quotas, ownership and configuration.
No automatic paid retries; a redelivery can claim another queued run, never restart a running
or terminal research. Cron only reconciles durable jobs. Admission shutdown preserves data.

Use the shared runtime and prompts, not a duplicate model implementation. Do not seed lab
agents or change operator configuration during startup. Connection checks are explicit operator
commands. Credentials stay in Worker secrets. Production deployment is outside this release.

The staging Wrangler config caps Queue concurrency at five and reconciles every minute.
Build with `npm run build:worker --workspace=@pickler/research-worker`. Use the root staging checks and operations guide before any deployment.

`src/worker.ts` owns host lifecycle with constructor dependency injection; `src/index.ts` always
uses the real runtime. `test/fixture-worker.ts` and `test/wrangler.jsonc` are local-only controlled
provider entry points, never deployment configs. They are not imported by production.
`test/fixture-repository.ts` validates a dedicated loopback database on port 55522 and checks
`CONTROLLED_TEST_DATABASE_ID` against its private identity marker before every claim, recovery,
or schedule tick, then delegates to the unchanged production repository algorithm.
`test/prepare-controlled-stack.mjs` creates a unique temporary Supabase configuration and
initializes its marker before migrations; it refuses existing application schemas. Never use the
normal local database with synthetic providers. `test/fixture-isolation.test.ts` verifies rejected
connections preserve foreign queued work and history. The flow cleanup helper tracks created
users immediately, attempts access revocation for every user, and closes the pool even if setup
or revocation fails. `worker.test.ts` runs in the normal suite; `worker-flow.test.ts` additionally
requires an explicitly running local three-Worker stack. See the staging guide for commands.

Fresh controlled stacks initially expose only the default public API schemas so PostgREST can
start before application migrations. After initialize and the reconciled migrator, the explicit
marker-guarded expose-api setup step enables product schemas only in that disposable database.
The setup regression creates configuration files only; it never starts containers.

## Hosted database transport

Both deployed backend Workers require the trusted `DATABASE` Hyperdrive binding. The origin
uses Supabase session port 5432, verify-full with its CA, and disabled query caching.
There is no hosted direct-secret fallback or plaintext staging exception. Keep pools scoped
to each invocation, limited to two connections, and close them on every outcome. Local development
uses explicit APP_ENV=local with a loopback DATABASE_URL. Migrations retain their separate
operator connection. Admission controls remain independent of transport.

## Hosted database binding and explicit diagnostic

`src/database.ts` resolves the binding for both Queue and Cron; hosted execution fails closed if
it is missing and never falls back to DATABASE_URL. Only APP_ENV=local uses DATABASE_URL.
No plaintext override or database-origin credentials are needed by the hosted research Worker.
The API transport remains separately configured.

`test/database-probe.ts` is an explicitly invoked remote-preview diagnostic. It round-trips a
large synthetic JSONB payload using the production pool options and Drizzle, within a rolled-back
transaction and temporary table. It never invokes providers, creates agents or modifies application
history. Do not import it into the deployed Worker or configure a public diagnostic endpoint.
See docs/cloudflare-staging.md for invocation and deployment validation.

## Operator-enabled Studio access

The staging configuration keeps admissions enabled for operator-approved users. This flag is not
user authorization: PostgreSQL research access and workspace ownership remain mandatory. Keep
the API and consumer flags aligned. New agents still start with scheduling disabled. For an
emergency stop deploy both hosts with `--var ADMISSIONS_ENABLED:false`; restore only after checking
queued jobs, active schedules and enabled users. Never enqueue a paid run as a deployment check.

## Cloudflare trading pilot

After a completed consumer invocation, the optional TRADING_QUEUE producer emits only a generic wakeup. Trading independently authorizes persisted candidates; notification failure never repeats research. No signer belongs here.

## Trading package boundary

Trading rules and financial ports are owned by `@pickler/trading` public subpaths. Core retains
identity, configuration and research contracts. Infrastructure implements the trading ports;
runtime composes adapters and models. Hosts must not duplicate risk, fills or accounting.

## Advice jobs

The existing Queue distinguishes `advice-wakeup` from research. Advice uses its own runtime,
private cost reserves and three-minute/60-second execution leases; it never sends TRADING_QUEUE
notifications. Default ADVICE_ENABLED=false. Cron recovers/expires jobs even while off and retains
unknown costs; failed advice reconciliation does not stop ordinary research supervision. Keep
ADVICE_JEV_API_KEY exclusively here; forecasts reuse the existing MODEL_BASE_URL, MODEL_ID and
MODEL_API_KEY. A reviewed matching v2 policy pins the provider base URL and model. Changing either
refuses execution before model transport; no separate DeepSeek key is accepted.
See [Agent advice](../../docs/agent-advice.md).

## Perpl paper runtime

The Queue also carries `{ kind: "perps-check", checkId }` (the API's manual checks and the hourly
dispatcher). Each delivery calls the runtime's `consumePerpsCheck` with `perpsAdmission(env)`:
off, the check is claimed and refused `RUNTIME_DISABLED` without reading Perpl or asking the
model. The minute Cron always runs `superviseChecks` beside advice and research supervision
(`Promise.allSettled`, each on its own pool, so a slow venue never delays them; a Perpl or advice
failure is logged and never stops the others, and only research's failure fails the invocation): the stuck-check sweep, the exits job, proposal expiry and the
re-drive of pending owner actions run whether or not the runtime is on, and only the hourly
dispatcher waits for `PERPL_RUNTIME_ENABLED` "true". Off: no model calls and nothing opens; exits,
closes and recovery still run. Vars in `wrangler.jsonc`: `PERPL_RUNTIME_ENABLED` "false" (the API's
`wrangler.staging.jsonc` carries the same value; `npm run check:staging` asserts they match) and
`PERPL_RUNTIME_DAILY_CHECKS` "500"; optional `CHAIN_ID` and `MONAD_RPC_URL` choose where agent
wallets' AUSD is read (default Monad testnet, as the API). The model reuses `MODEL_*`, the web
`EXA_API_KEY` (missing enabled evidence sources fail without a model retry).
Apply migrations 0027 and 0028 before deploying this composition. A reviewed explicit
`PERPS_RUNTIME_POLICY_JSON` and `PERPS_JEV_API_KEY` additionally configure Studio version 2.0.0;
see [Studio perpetual execution](../../docs/studio-perps-execution.md). No paid acceptance or activation is implied. `test/perps-runtime.test.ts` runs checks end to end over
real PostgreSQL with fake Perpl, board, wallet and model.

The Queue also carries `{ kind: "perps-action", actionId }`: a wakeup for an owner action (approve,
close, stop) the API wrote durably in `pickler.perps_owner_actions`. It is routed to
`consumePerpsAction` over `perpsActions(env)` (the same `createPerpsRuntime`), whether or not the
runtime is on (closing is always allowed; an approve while off ends blocked). The delivery claims
the row, waits up to 45 s for a running check to free the agent and carries it out; still busy, it
leaves the action `pending` and acknowledges the message, and the Cron re-drives pending actions
older than 30 s (`perpsRuntime(env).owner.pendingActions`). Only a host failure retries the
message (30 s). `test/perps-actions.test.ts` covers the actions, the wait, the re-drive and two
concurrent deliveries of one approve.
