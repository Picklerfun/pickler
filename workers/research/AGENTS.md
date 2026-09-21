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
