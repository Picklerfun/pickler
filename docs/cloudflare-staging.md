> Configuration update: maintain only the root `.env`; see [the environment guide](environment.md). For the controlled stack, put its values in the root `LOCAL_*` section. Generated fixture identity/status files are disposable test state. Do not create persistent per-app `.env.local` or `.dev.vars` files.

# Cloudflare staging operations

## Status and scope

Three Worker configurations and local Worker builds are implemented. A successful dry run is
not a remote deployment. Until an acceptance record with a staging URL and deployed versions
is attached to the deployment PR, remote acceptance remains pending.

The only public entry point is `pickler-web-staging` on workers.dev. It delegates `/api/v1/*`
to `pickler-api-staging` through `API`; `pickler-research-staging` only consumes Queue and Cron
events. Node and Studio remain local tools. The retained local experiment is not a deployment
entry point. PR #22 real trading is excluded.

## Local Worker verification

```sh
npm ci
npm run build:shared
npm run check:staging
npm run build:workers
```

Configure the root `LOCAL_*` settings for public Auth, backend database and API identity.
Start the compiled three-Worker host; each receives only its selected variables:

```sh
npm run dev:workers
```

This runs the OpenNext output with bindings under workerd. Rebuild after changes. No paid
provider checks run at startup. Enable consumer admissions only for an explicitly authorized
research test. An enqueued job is not evidence of completed research.

## Controlled end-to-end suite

The synthetic consumer requires its own disposable Supabase stack, on ports 55520–55529,
with a unique database identity. It rejects the normal Supabase database (54522), the Node
pilot database (55432), and databases without the matching identity **before** claims,
expired-lease recovery, or schedule reconciliation. It reuses the production repository
algorithms after this check. Never put ordinary local jobs or provider credentials in this stack.

Create a fresh configuration from the repository's Supabase configuration. The setup script
writes into a new temporary directory and never modifies or resets an existing stack. It starts
with only `public` and `graphql_public` exposed: the product schemas do not exist until migrations
run, and exposing them sooner prevents a fresh PostgREST instance from becoming healthy:

```sh
CONTROLLED_STACK=$(node workers/research/test/prepare-controlled-stack.mjs prepare)
npx --yes supabase@2.111.0 start --workdir "$CONTROLLED_STACK" \
  --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
(umask 077; npx supabase@2.111.0 status --workdir "$CONTROLLED_STACK" --output json > "$CONTROLLED_STACK/status.json")
node workers/research/test/prepare-controlled-stack.mjs initialize "$CONTROLLED_STACK"
```

Initialization requires an empty application database and creates a private identity marker.
It writes the consumer's bindings to `$CONTROLLED_STACK/consumer.dev.vars`. Keep the
`status.json` file private: it includes local credentials. Initialize before applying Pickler
migrations. Set `DATABASE_MIGRATION_URL` from this status file's `DB_URL` using an ignored
root environment section, then run `npm run db:migrate` against that dedicated database. After
migrations succeed, enable the product Data API schemas:

```sh
node workers/research/test/prepare-controlled-stack.mjs expose-api "$CONTROLLED_STACK"
```

This explicit step checks the dedicated database identity and requires every product schema to
exist. It updates only that database's PostgREST role setting, sends configuration/schema reload
notifications, and updates the generated Supabase configuration for future restarts. Research,
migrations, test-marker and internal schemas remain private. The role-setting reload follows
[PostgREST's in-database configuration](https://docs.postgrest.org/en/v14/references/configuration.html#in-database-configuration).

Use `workers/research/test/wrangler.jsonc` for the controlled consumer; it must never be
deployed. Set the root `LOCAL_*` values to the dedicated database/API/public Auth settings and
`LOCAL_CONTROLLED_TEST_DATABASE_ID` to the generated identity. Enable local admissions only for
this controlled test. Rebuild the web. Keep ordinary local values safely recoverable while
switching the single file; do not create per-app environment files. No provider secrets are
passed to the fixture target.

Start all three compiled Workers with the controlled consumer:

```sh
npm run dev:workers -- --fixture
```

The launcher creates owner-only temporary binding files from the root environment, deletes
them on normal shutdown or setup failure, and never changes the source file. A forced OS kill
may leave its temporary directory; those artifacts can be removed after the process is stopped.

In another terminal, set `CONTROLLED_STACK` to the temporary directory printed during setup:

```sh
export CONTROLLED_TEST_DATABASE_ID=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).identity' "$CONTROLLED_STACK/controlled-stack.json")
TEST_WORKERS_URL=http://127.0.0.1:8790 \
SUPABASE_LOCAL_STATUS_FILE="$CONTROLLED_STACK/status.json" \
npm run test:workers-local
```

The test validates the dedicated endpoints and identity before creating users. It creates
labelled disposable users/agents, revokes every created user's research access afterward
(including failures during setup), and always closes its database pool. Results remain in this
dedicated stack for inspection. The scenarios use synthetic market IDs 1 (abstain), 2 (trade
proposal), and 3 (technical failure), never actual provider forecasts. The ordinary suite skips
this flow unless `TEST_WORKERS_URL` is supplied; its isolation regression separately proves
that a refused fixture connection leaves foreign queued jobs and historical evidence unchanged.

Stop the controlled Workers afterward, then stop only this dedicated Supabase stack with
`npx supabase@2.111.0 stop --workdir "$CONTROLLED_STACK"`. Do not reset or remove the ordinary stack.

## Dedicated resources and secrets

Resolve the Cloudflare project account and a separate Supabase staging project first. Never
reuse production identifiers or data. Create Queue `pickler-research-staging` and pin the verified account ID in all three configs.
API and research connect using the DATABASE_URL secret to the Supabase session pooler on port 5432. No Hyperdrive resource or binding is used. Pools belong to one invocation, have at most
two connections and close before the invocation ends. PostgreSQL remains the transactional authority.

Hosted connections require TLS and hostname verification. Do not add connection override parameters to DATABASE_URL;
only the harmless `application_name` query key is accepted. Node operators can supply the project CA using DATABASE_CA_CERT;
Workers uses its platform TLS trust and hostname verification. Never disable certificate validation.
Local plaintext connections require APP_ENV=local and a loopback host. A local success does not
establish remote TLS compatibility: test the actual hosted path before opening admissions.

| Destination          | Configuration                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Web build/browser    | Public Supabase URL and publishable key only                                                        |
| API secrets          | SUPABASE_URL, SUPABASE_SECRET_KEY, JWT_ISSUER, ALLOWED_ORIGINS                                      |
| Research secrets     | MODEL_BASE_URL, MODEL_ID, MODEL_API_KEY, EXA_API_KEY; optional sports keys only for enabled plugins |
| Both backend Workers | DATABASE_URL (secret), APP_ENV=staging                                                              |
| Operator only        | Direct/session database migration URL and deployment authentication                                 |

Use secret input through stdin or the provider's secret UI; do not put secrets in command
arguments, PRs, logs or shell history. Keep `ADMISSIONS_ENABLED=false` for initial deployment.
Set ALLOWED_ORIGINS to the exact web URL. Configure Supabase site URL and allowed callback
`https://<web-workers-dev-host>/auth/callback`. Enable the product Data API schemas `identity`,
`agents`, `budget`, `audit`, `growth`, `market` with the migration's RLS/grants. Never expose
`pickler`, `pickler_migrations`, `mastra` or `internal`.

## Deployment order

1. Run format, lint, types, PostgreSQL/Supabase tests and all Worker builds. Apply migrations
   against an isolated database first, including historical migration reconciliation tests.
2. Commit the tested configuration and record its SHA. Run `npm run check:staging -- --provisioned`.
   Inspect the destination account, database project separately;
   the script checks topology/identifiers, not remote ownership or secrets.
3. Apply the reconciled migrator to staging using the operator connection. Do not reset schemas.
4. Upload configured secrets and deploy consumer, then API, then web from that identified commit.
   Use each committed Wrangler config explicitly. Backend workers.dev and previews stay disabled.
5. Verify the web through its public URL, including binding transport, auth refresh/signout,
   private no-store responses and cookie flags. Check fresh reads and transaction behavior through
   the actual session-pooler connection before opening admissions.
6. Enable staging admissions explicitly for the acceptance window, recording the override and
   resulting Worker versions. A subsequent default deployment closes admissions again.

Do not switch legacy budgets from Durable Objects using a stale projection. Existing data stays
intact; export and verified reconciliation are required before enabling PostgreSQL authority
for such agents. New console agents use PostgreSQL directly.

## Acceptance record

Use two isolated test users. Confirm pending research access before operator enablement,
then enable only those users. Create one agent each; verify ownership, cross-tenant rejection,
version conflicts, plugins, private history and evidence. No automatic lab-user assignment.

The paid acceptance budget is at most **three research executions**: one manual per tenant and
one scheduled execution for a previously validated agent. Provider connection checks are explicit
operator operations, not automatic startup probes. Use the same configured model; never repeat a
failed paid research automatically. Preserve technical errors as errors. An evidence-backed
abstention is valid; do not force a trade.

Pause schedules immediately after acceptance. Record commit SHA, Worker version IDs, isolated
Supabase project reference, URL, run IDs, tenant attribution, timestamps, terminal statuses,
evidence counts, reported usage, and any missing provider metrics. Verify the final scheduled
job through Cron/Queue and PostgreSQL, not by manually invoking the research endpoint.

## Rollback

Close API and consumer admissions first using `ADMISSIONS_ENABLED=false`. Disable managed
agent schedules through the authorized configuration path and pause them; retain jobs/history.
Wait for in-flight leases to finish or expire. Expired recovery marks interruptions and preserves
evidence; never turn interrupted paid research back into queued jobs.

Use `wrangler rollback <recorded-version-id> --config <matching-config>` for each affected
Worker, starting with web if the regression is presentation-only. Confirm the previous version
uses compatible database contracts before reverting API/consumer. Do not roll back to old global
recovery executors. Never reverse migrations destructively or delete the queue/database/legacy
Durable Objects as a rollback. Confirm admissions remain closed after each rollback.

Queue consumers have a separate wall-clock allowance from CPU limits; retain the five-minute
research deadline and validate real CPU/memory rather than interpreting waiting time as CPU.
See [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) and
[OpenNext setup](https://opennext.js.org/cloudflare/get-started).
