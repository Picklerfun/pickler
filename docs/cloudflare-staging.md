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

For authenticated local browsing, set only public Supabase URL/publishable-key values in the
web's ignored `.env.local` before building. Set API secrets in its ignored `.dev.vars`. Set APP_ENV=local and DATABASE_URL in each backend Worker’s ignored .dev.vars for
the disposable loopback database. The consumer may keep admissions disabled for UI tests:

```sh
npx wrangler dev --config apps/web/wrangler.jsonc \
  --config workers/api/wrangler.staging.jsonc \
  --config workers/research/wrangler.jsonc --ip 127.0.0.1 --port 8780
```

This runs the OpenNext output with bindings under workerd. Rebuild after changes. No paid
provider checks run at startup. Enable consumer admissions only for an explicitly authorized
research test. An enqueued job is not evidence of completed research.

## Controlled end-to-end suite

For the free integration suite, replace the research config with
`workers/research/test/wrangler.jsonc`. Its separate entry imports controlled providers only;
it must never be deployed. Put the disposable local DATABASE_URL in that test directory's
ignored `.dev.vars`. Keep API APP_ENV=local and ADMISSIONS_ENABLED=true in its `.dev.vars`.
No model/provider secrets are needed in the controlled consumer.

```sh
npx wrangler dev --config apps/web/wrangler.jsonc \
  --config workers/api/wrangler.staging.jsonc \
  --config workers/research/test/wrangler.jsonc --ip 127.0.0.1 --port 8790 \
  --persist-to /tmp/pickler-direct-worker-state
```

In another terminal, save `supabase status --output json` into a mode-0600 temporary file
without printing its credentials, then run:

```sh
TEST_WORKERS_URL=http://127.0.0.1:8790 \
SUPABASE_LOCAL_STATUS_FILE=/absolute/path/to/private-local-status.json \
npm run test:workers-local
```

The test requires loopback destinations, creates labelled disposable local users/agents,
revokes their research access afterward, and retains their results for inspection. It checks
three controlled market IDs: 1 (abstain), 2 (trade proposal), 3 (technical failure). These are
synthetic fixtures, never claims about the actual provider's markets. The ordinary suite skips
this test unless TEST_WORKERS_URL is explicitly supplied. Stop the controlled stack afterward.

## Dedicated resources and secrets

Resolve the Cloudflare project account and a separate Supabase staging project first. Never
reuse production identifiers or data. Create Queue `pickler-research-staging` and pin the verified account ID in all three configs.
API and research connect using the DATABASE_URL secret to the Supabase session pooler on port 5432. No Hyperdrive resource or binding is used. Pools belong to one invocation, have at most
two connections and close before the invocation ends. PostgreSQL remains the transactional authority.

Hosted connections require TLS and hostname verification. Do not add SSL parameters to DATABASE_URL;
they can override driver options. Node operators can supply the project CA using DATABASE_CA_CERT;
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
