# Research Worker

Read the root and packages/agent-runtime instructions first. This is the deployed Queue and
Cron host, distinct from the protected local experiment in apps/agent-service. Do not remove
that experiment's database/loopback guards. No HTTP handler, Studio, or tenant tokens here.

Use request-scoped PostgreSQL via DATABASE_URL and the Supabase session pooler (5432), with verified TLS. Await one leased research per
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
