# One environment file

Maintain only `.env` at the repository root. Copy `.env.example` to initialize it, or run
`npm run agent -- init` to also generate the local tenant tokens. Never commit the populated
file. The root template is the only maintained template.

`LOCAL_*` settings configure the local API, research Worker and public web Auth client.
`AGENT_DATABASE_URL` preserves the separate local Studio database; it never defaults to staging.
Shared provider keys are delivered only to Studio/research. `STAGING_*` settings are selected
explicitly with `PICKLER_ENVIRONMENT=staging`; hosted Auth/database values never fall back to local.
The staging password components are assembled into a PostgreSQL URL in memory, with escaping.
`STAGING_DATABASE_CA_CERT` accepts a quoted multiline PEM for verified Node connections.

Workspace commands call `scripts/with-env.ts`, which selects a reviewed list of variables for
each process. Next.js receives only public Auth settings and its local API URL. The Hono API
receives database/Auth settings, never model credentials. Research receives database/provider
settings, never the Supabase service key or tenant tokens. Shell secrets are not inherited.
Wrangler receives filtered local variables through its supported process-environment loading;
no persistent `.dev.vars` is needed. Remove legacy per-app environment files before running.

```sh
npm run dev
npm run dev:workers # compiled three-Worker host on 127.0.0.1:8790
npm run dev:agent
npm run db:migrate
PICKLER_ENVIRONMENT=staging npm run build:worker --workspace=@pickler/web
```

These commands do not upload secrets or deploy. Local research can call paid providers only
when jobs are explicitly admitted; admissions default to false. Local Studio retains its
existing manual execution and scheduling behavior. Do not run migrations with staging selected
unless that migration is explicitly authorized. Operator-supplied `DATABASE_MIGRATION_URL`
still overrides the database command for isolated migration tests.

Cloudflare keeps secrets per Worker. One local source does not authorize uploading the entire
file to each Worker, and no database/provider values belong in web build arguments or assets.
Deployments must provision each destination's reviewed secret subset separately.

## Controlled tests and historical experiments

Disposable acceptance stacks still generate private test identity/status artifacts outside the
repository. Those are generated test state, not operator-maintained environments. Configure the
root `LOCAL_*` fields for that dedicated stack while running its acceptance flow, and retain the
fixture's database identity guard. Never point synthetic providers at the normal database.

Historical probe/background state and credentials are retained; they are not staging settings.
Archived values in the consolidated file use `PROBE_*`, `BACKGROUND_*`, or `CONTROLLED_*` prefixes
and are not passed to any normal application. The old experiments are explicitly separate;
their generated temporary artifacts must never become an additional maintained `.env`.

The multi-Worker launcher generates private per-target transport files in a temporary directory
and removes them on normal exit. They are not maintained configuration. A forced OS kill can
leave temporary artifacts; remove them only after the corresponding process has stopped.

Compiled web builds and previews use the `web-worker` selection, which excludes the Next-dev
loopback URL. OpenNext's two standalone-build control variables survive nested build commands;
other private shell variables do not. Turbo hashes the root environment file and the selected
environment so local and staging builds cannot share an incorrect cached result.
