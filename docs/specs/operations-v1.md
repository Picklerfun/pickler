# Operations v1

Status: Draft — decided autonomously 2026-09-30. Every decision is reversible unless the table says
otherwise. Follows `docs/product-map/conventions.md` (API conventions: 429 with `retryAt`, 503 when a
dependency is off, the error envelope with `traceId`).

Research this builds on: `docs/product-map/research/06-platform.md` gaps G7 (observability), G8
(security), G9 (backups); research 05 §3 item 8 (sweepers). Environments and the release pipeline
are defined in `docs/specs/production-environment-v1.md`; this spec assumes them.

---

## 1. Problem and users

- **Nobody is told when something breaks.** Workers Logs (`observability.enabled` in every
  `wrangler*.jsonc`) is the only telemetry. There is no alert, uptime check, tail consumer or error
  tracker anywhere in the repository (research 06 §2, "Observability").
- **A 500 cannot be diagnosed from its log line.** The API logs
  `[traceId] METHOD path HTTP 500` and drops the error (`workers/api/src/http/error-handler.ts:140-141`).
  Today's `/agents` 500 (`production-environment-v1.md` §0) was diagnosed by reading code, not logs.
- **Public routes have no per-client limits.** `POST /v1/auth/wallet/nonce` is bounded only per
  address and by purge batches, so rotating addresses grows `identity.siwe_nonces`
  (`workers/api/AGENTS.md:98-105`). `POST /v1/studio/agents/draft` calls the model on every request
  (`workers/api/AGENTS.md:204-210`). Waitlist, applications, handle availability and `wallet/verify`
  are unlimited. Only the preview run has a limit (5 per hour per owner,
  `packages/core/src/features/studio/preview.ts:25-32`).
- **Failed queue messages vanish.** Both consumers have `max_retries: 3` and no dead-letter queue
  (`workers/research/wrangler.jsonc:17-24`, `workers/trading/wrangler.jsonc:14-20`).
- **One backup exists, on one laptop's `/tmp`** (`docs/staging-database-upgrade-2026-09-19.md:36-38`),
  and no restore has ever been tested.

Users: the owner/operator (on call, alone); people using the product (they notice outages before
we do today); the finance of the project (model calls and RPC calls are paid per request).

---

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reason                                                                                                                                                                                         | Reversible? |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| O1  | **One structured log format** for every Worker and the web: one JSON object per line, `console.log/warn/error(JSON.stringify(event))`, with fixed keys (§5.1). Workers Logs indexes JSON fields, so they become queryable without a vendor.                                                                                                                                                                                                                                                                                                              | Queryable logs are the cheapest observability upgrade and need no account.                                                                                                                     | Yes         |
| O2  | **Every 5xx logs its cause**: error class, a normalised code (Postgres SQLSTATE, `CONNECTION_LOST`, `QUERY_TIMEOUT`, the domain error code), and the message truncated to 300 characters after redaction (§8). The HTTP response stays generic.                                                                                                                                                                                                                                                                                                          | Diagnosing from logs; the envelope already hides internals from the browser (`error-handler.ts:129-133`).                                                                                      | Yes         |
| O3  | **No third-party error tracker in v1.** A new Worker `workers/ops` (`pickler-ops-<env>`) is the **tail consumer** of api, research, trading, indexer and web; it groups exceptions and `level: "error"` events into `ops.error_groups` and raises alerts. Sentry (`@sentry/cloudflare`) is the documented upgrade if grouping by the tail Worker proves too thin.                                                                                                                                                                                        | No vendor account, no new secret, data stays in the Cloudflare account and Postgres; the owner's tooling budget is unknown (research 06 Q6).                                                   | Yes         |
| O4  | **Alert channel: email** through the ops Worker's `send_email` binding to a verified owner address, plus an optional `OPS_ALERT_WEBHOOK_URL` (Slack- or Discord-compatible JSON). Alerts are de-duplicated per rule and re-sent at most hourly while open; recovery sends one message.                                                                                                                                                                                                                                                                   | Email needs no new account (Cloudflare Email Routing is on the zone's account). A webhook covers a chat channel if the owner wants one.                                                        | Yes         |
| O5  | **Uptime: an in-account probe plus one external check.** `pickler-ops-<env>` runs a one-minute cron over the smoke URLs; an external free monitor watches the three production hosts and `/api/v1/health`, alerting by email.                                                                                                                                                                                                                                                                                                                            | An in-account probe dies with the account or a bad deploy of the ops Worker; one external check covers that.                                                                                   | Yes         |
| O6  | **Rate limiting in two layers.** (a) Cloudflare Workers Rate Limiting bindings (`ratelimits` in the API config) keyed by a salted hash of `CF-Connecting-IP` or by user id, for floods; (b) Postgres counters for anything that costs money (model calls, RPC verification), because the binding is approximate and per location.                                                                                                                                                                                                                        | The binding is fast and free to call; money needs an exact count.                                                                                                                              | Yes         |
| O7  | **Close the nonce flood.** This spec owns the nonce limit (conventions decision 16; cross-review C6, D1): one `client_hash bytea` column on `identity.siwe_nonces`, keyed by `hmac_sha256(RATE_LIMIT_SALT, IP)`, a cap of 20 open nonces per client hash, plus the `RL_AUTH` binding (§4.1). `marketplace-wallets-v1.md` adds only its `client` column (which app asked) and cites this row; there is no `NONCE_IP_SALT`, `ip_hash` or `NONCE_IP_CAP`.                                                                                                   | `workers/api/AGENTS.md:98-105` names exactly this as the missing piece; one salt and one table.                                                                                                | Yes         |
| O8  | **One zone WAF rate-limiting rule** on `/api/v1/auth/*` (30 requests per 10 s per IP → block 60 s). Everything else lives in code.                                                                                                                                                                                                                                                                                                                                                                                                                       | A zone rule stops a flood before it costs a Worker invocation; one rule fits the free plan.                                                                                                    | Yes         |
| O9  | **Email through Resend** (decision, reversible) on the `mail.pickler.fun` sending domain, for both Supabase Auth (custom SMTP) and transactional mail from the API (`EMAIL_FROM`, `EMAIL_API_KEY`: paid-read notices, verification links, custody notices). This spec owns email (cross-review W7); `paid-reads-v1.md` and `custody-v2.md` cite it. Plus Turnstile captcha on signup and OTP, and confirmations on.                                                                                                                                      | Default Supabase SMTP is rate-limited and not for production; captcha is commented out in `supabase/config.toml:214`; one provider, one domain.                                                | Yes         |
| O10 | **Dead-letter queues** for both consumers; the ops Worker consumes them into `ops.dead_letters` and alerts on the first message. Replay is an operator action.                                                                                                                                                                                                                                                                                                                                                                                           | Messages are wake-ups (`{ kind: "research-wakeup" }`, `workers/api/src/env.ts:14`), so the work itself is in Postgres; a dead letter is a signal that a consumer is failing, and must be seen. | Yes         |
| O11 | **Backups: Supabase's own (daily; PITR on production) plus our own nightly logical dump** of the product schemas to an R2 bucket, encrypted with `age`, and a **monthly automated restore drill** in GitHub Actions.                                                                                                                                                                                                                                                                                                                                     | Supabase backups cover `auth` and point-in-time; our dump is portable, off-provider and testable.                                                                                              | Yes         |
| O12 | **Sweepers and retention run in the ops Worker** (conventions decision 15; cross-review C7): a `*/15` sweep of expired SIWE nonces, WebAuthn challenges older than 1 h, preview runs 24 h past `expires_at` unless adopted, and add-device pendings older than 15 min (from `custody-v2.md` C10); a daily retention pass over the ops tables. The custody deposit reconciler is a product job and runs in `workers/jobs` (`production-environment-v1.md` §6.6). Runs, decisions, evidence, audit and ledger rows are **kept indefinitely** in v1 (§5.2). | One owner per table. The API has no crons (decision 15).                                                                                                                                       | Yes         |
| O13 | **Un-expose every Drizzle-owned schema from the Supabase Data API**, using the one derived list in `production-environment-v1.md` §4.3 `db.data_api` (cross-review C26).                                                                                                                                                                                                                                                                                                                                                                                 | No server path uses PostgREST any more (`workers/api/AGENTS.md:322-332`); exposure is attack surface with no user.                                                                             | Yes         |

---

## 3. User flows

### 3.1 The API throws in production

1. `handleError` logs `{"level":"error","event":"http_5xx","traceId":"…","route":"/v1/marketplace/directory","status":500,"errorClass":"PostgresError","code":"42P01","cause":"relation \"…\" does not exist","release":"3f2a9c1"}`.
2. The ops Worker receives the trace event, fingerprints it (`api:/v1/marketplace/directory:PostgresError:42P01`),
   upserts `ops.error_groups`, and evaluates the rule "new fingerprint in production" → opens an
   alert and emails: subject `[pickler prod] new error: api /v1/marketplace/directory PostgresError 42P01`,
   body with count, first/last seen, release and one `traceId` to search in Workers Logs.
3. The operator searches Workers Logs by `traceId`, fixes, releases. The group's `last_seen` stops
   moving; after 30 minutes quiet the alert resolves and a recovery email is sent.

### 3.2 Someone floods `POST /v1/auth/wallet/nonce`

1. Requests 1–10 per minute from one IP pass the binding; the WAF rule blocks beyond 30 per 10 s.
2. A slower attacker rotating addresses from one IP hits the 20-open-nonces-per-client cap:
   the 21st answers 429 `NONCE_RATE_LIMITED` with `retryAt` (the oldest open nonce's expiry).
3. A distributed attacker is bounded by the purge (unchanged) and by the alert "siwe_nonces rows >
   50 000", which emails the operator.

### 3.3 A research consumer fails every message

1. The consumer throws three times on a wake-up; the message goes to `pickler-research-dlq-<env>`.
2. The ops Worker stores it (`ops.dead_letters`, status `open`) and emails
   `[pickler prod] dead letter: research (1 open)`.
3. After a fix is released, the operator runs `npm run ops:dlq -- list --env production` then
   `npm run ops:dlq -- replay <id> --env production`, which re-sends the body to the source queue
   through the Cloudflare Queues API and marks the row `replayed`. `discard <id> --note "…"` closes a
   row without replay.

### 3.4 The monthly restore drill

1. `restore-drill.yml` (cron, first Monday 06:00 UTC, and `workflow_dispatch`) downloads the latest
   production dump from R2 and decrypts it.
2. It starts a `postgres:17` service container, runs `pg_restore --no-owner --no-privileges`, then
   runs `npm run db:migrate` against it and asserts "no migration applied" (the dump is at head).
3. It compares row counts per table against the dump's manifest (§5.4) and runs three read queries
   the product depends on (directory, leaderboard, one agent's picks) through
   `packages/infrastructure` test helpers.
4. It appends `{ kind: "restore-drill", env, dump, result, durationSeconds }` to the ledger
   (`production-environment-v1.md` §5.3) and emails on failure.

---

## 4. API

### 4.1 Rate limits (API Worker)

All limited responses: HTTP 429,
`{ error: { code, message, detail: { limit, windowSeconds } }, traceId }` plus `retryAt` (ISO 8601)
inside `detail` and a `Retry-After` header in seconds. The client key is
`hmac_sha256(RATE_LIMIT_SALT, CF-Connecting-IP)` (never the raw IP), or the user id when signed in.

| Route                                                                                         | Auth     | Layer (a) binding (per key)                       | Layer (b) Postgres (exact)                                                                               | Code                    |
| --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------- |
| `POST /v1/auth/wallet/nonce`                                                                  | none     | `RL_AUTH` 10 / 60 s per IP                        | ≤ 20 open nonces per `client_hash` (O7)                                                                  | `NONCE_RATE_LIMITED`    |
| `POST /v1/auth/wallet/verify`, `/link`                                                        | none/JWT | `RL_AUTH` 10 / 60 s per IP                        | —                                                                                                        | `AUTH_RATE_LIMITED`     |
| `GET /v1/handles/:handle/availability`                                                        | none     | `RL_PUBLIC` 60 / 60 s per IP                      | —                                                                                                        | `RATE_LIMITED`          |
| `POST /v1/waitlist`, `POST /v1/applications`                                                  | none     | `RL_FORMS` 5 / 60 s per IP                        | —                                                                                                        | `RATE_LIMITED`          |
| `POST /v1/studio/agents/draft`                                                                | JWT      | `RL_MODEL` 10 / 60 s per user                     | 30 per rolling hour per user, 200 per day per environment (cost ceiling)                                 | `DRAFT_RATE_LIMITED`    |
| `POST /v1/studio/preview-runs`                                                                | JWT      | `RL_MODEL` 10 / 60 s per user                     | 5 per rolling hour per owner (existing, `preview.ts:25-32`)                                              | `PREVIEW_RATE_LIMITED`  |
| `POST /v1/me/reads` (intent), `POST /v1/me/reads/:id/payment` (claim) — `paid-reads-v1.md` §4 | JWT      | `RL_MONEY` 10 / 60 s per user, on both            | ≤ 3 open intents per user, 10 intents per hour per user; one in-flight verification per transaction hash | `PURCHASE_RATE_LIMITED` |
| `GET /v1/marketplace/*` and every other unauthenticated `GET`                                 | none     | `RL_PUBLIC` 120 / 60 s per IP                     | —                                                                                                        | `RATE_LIMITED`          |
| Token trade quote (`token-trading-v1.md`)                                                     | JWT/none | `RL_PUBLIC` 30 / 60 s per user, 120 / 60 s per IP | —                                                                                                        | `QUOTE_RATE_LIMITED`    |

This table is the **table of record** for rate limits (cross-review C16): `token-trading-v1.md`,
`paid-reads-v1.md` and `mobile-backend-v1.md` link it instead of stating their own numbers, and a
spec that needs a new limit adds its row here in the same PR. `retryAt` is always
`error.detail.retryAt`.

The binding keys are the route family plus the client key, so one noisy route cannot starve another.
The server-to-server path (the web's service binding calling the API for server-rendered pages)
carries the viewer's `CF-Connecting-IP` forwarded in `x-pickler-client-ip`, set only by the web's
`apiFetch` (`apps/web/src/server/api-client.ts:36-42`); the API trusts that header **only** on
requests that arrive through the service binding (no `cf-ray` from the public edge on the inner
request), otherwise it uses `CF-Connecting-IP`.

The daily draft ceiling (200 per environment) answers 503 `DRAFT_UNAVAILABLE` (the existing code,
`workers/api/AGENTS.md:204-210`) rather than 429, because it is the service that is out, not the
person who is over.

### 4.2 Internal routes (service binding only, `production-environment-v1.md` §4.2 rules)

| Method | Path                      | Caller    | Response                                                                                                                 |
| ------ | ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/internal/ready`      | ops probe | defined in `production-environment-v1.md` §4.2                                                                           |
| GET    | `/v1/internal/ops/queues` | ops probe | `{ data: { researchQueued, researchOldestQueuedSeconds, tradingPending, previewQueued } }` read from Postgres job tables |

No public operations endpoint and no status page in v1.

### 4.3 Operator CLI (not HTTP)

- `npm run ops:dlq -- list|replay <id>|discard <id> --env <env>` (`scripts/ops/dlq.mjs`), reading
  `ops.dead_letters` over `DATABASE_MIGRATION_URL` and sending through the Cloudflare Queues REST API
  with `CLOUDFLARE_API_TOKEN`.
- `npm run ops:alerts -- list|ack <id> --env <env>`.
- **Operator calls to internal routes** (cross-review E2): `npm run ops -- call <METHOD> <path> [--body <json>] --env <env>`
  (`scripts/ops/call.mjs`). Internal routes are reachable only through a service binding, so the CLI
  does not call the API directly. It signs `{ method, path, body, operator, exp }` with the
  operator's Ed25519 key (public keys listed in `deploy/operators.json`, a PR-reviewed file), and
  posts it to `https://ops.pickler.fun/__operator` (a route on `pickler-ops-production`, the only
  public route the ops Worker has). The ops Worker verifies the signature and expiry (60 s), checks
  the path against an allowlist of operator routes (dispute resolution, Perpl global kill, decision
  revisions, media takedowns, launch operator actions — each spec names its route), forwards it over
  its `API` binding with `x-pickler-internal: 1` and `x-pickler-operator: <name>`, and logs the call.
  Every spec that writes "service binding + operator claim" cites this.
- `npm run ops:backup -- --env <env>` (manual dump, same code as the nightly job).
- `npm run ops:restore-drill -- --dump <r2 key>` (the drill, locally with Docker).

---

## 5. Data model and migrations

One migration, next free number at merge time (0023 or later), schema `ops`, never exposed through
the Data API. This spec owns the `ops` schema migration, including `ops.worker_heartbeats`, which
`production-environment-v1.md` §5.4 reads (cross-review C24).

```sql
create schema if not exists ops;

create table ops.worker_heartbeats (
  worker text not null,
  env text not null,
  release_sha text,
  last_cron_at timestamptz,
  last_queue_at timestamptz,
  primary key (worker, env)
);

create table ops.error_groups (
  fingerprint text primary key,          -- worker:route:errorClass:code
  worker text not null,
  env text not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  count bigint not null default 1,
  last_trace_id text,
  last_release text,
  sample jsonb not null                  -- one redacted event
);

create table ops.alerts (
  id uuid primary key default gen_random_uuid(),
  rule text not null,
  env text not null,
  subject text not null,
  opened_at timestamptz not null default now(),
  last_notified_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  detail jsonb not null default '{}'
);
create unique index alerts_open_rule on ops.alerts (rule, env) where resolved_at is null;

create table ops.dead_letters (
  id uuid primary key default gen_random_uuid(),
  queue text not null,
  env text not null,
  body jsonb not null,
  attempts int not null,
  received_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'replayed', 'discarded')),
  note text
);

create table ops.rate_counters (
  key text not null,                     -- e.g. draft:user:<uuid>, draft:env:production
  window_start timestamptz not null,
  count int not null,
  primary key (key, window_start)
);
```

And on `identity.siwe_nonces` (same migration, owned by identity):

```sql
alter table identity.siwe_nonces add column client_hash bytea;
create index siwe_nonces_client_idx on identity.siwe_nonces (client_hash, expires_at);
```

The table has two columns today, `nonce` (the holder's 16-hex tag followed by the nonce) and
`expires_at` (`packages/infrastructure/drizzle/0018_fuzzy_tony_stark.sql:1-4`;
`packages/infrastructure/src/persistence/wallet-identity-store.ts:71-77`), and a spent nonce is
deleted. "Open" therefore means a row with this `client_hash` and `expires_at > now()`. The column is
nullable so rows issued before the migration stay valid; the cap counts only rows that have it. The
eviction per address (`MAX_OPEN_NONCES_PER_ADDRESS`) is unchanged.

### 5.1 Log event shape

```ts
interface LogEvent {
  level: "info" | "warn" | "error";
  event: string; // http_5xx, http_4xx_notable, queue_failed, cron_failed, api_degraded, …
  worker: "api" | "research" | "trading" | "indexer" | "web" | "ops";
  env: string; // APP_ENV
  release: string; // PICKLER_RELEASE_SHA
  traceId?: string;
  route?: string; // the Hono route pattern, not the raw path (no ids in the key)
  status?: number;
  errorClass?: string;
  code?: string;
  cause?: string; // redacted, ≤ 300 chars
  durationMs?: number;
}
```

A helper `logEvent(event)` lives in each Worker's `src/log.ts` (a copy per Worker, 30 lines, rather
than a new package: `packages/core` must not depend on a transport, root `AGENTS.md:36`). The web's
version lives in `apps/web/src/server/log.ts` and is called from `instrumentation.ts`
(`onRequestError`) and from `apiRead` (`production-environment-v1.md` §0.1).

### 5.2 Sweepers (ops Worker, every 15 minutes) and retention (daily 04:00 UTC)

| Table                                 | Rule                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `identity.siwe_nonces`                | delete expired, in batches of 1 000                                                |
| `wallets.webauthn_challenges`         | delete older than 1 hour                                                           |
| `pickler.preview_runs`                | delete 24 hours past `expires_at` and terminal, unless adopted (with their events) |
| add-device pendings (`custody-v2.md`) | mark abandoned after 15 minutes                                                    |
| `ops.rate_counters`                   | delete windows older than 2 days                                                   |
| `ops.alerts`                          | delete resolved older than 90 days                                                 |
| `ops.error_groups`                    | delete `last_seen` older than 30 days                                              |
| `ops.dead_letters`                    | delete non-open older than 90 days                                                 |

The first four rows run in the 15-minute sweep, the rest in the daily pass. Each sweep is bounded to
1 000 rows per table and logs its counts.

**Kept indefinitely in v1** (cross-review G7): `pickler.runs`, run events and evidence,
`pickler.decisions` and resolutions, `audit.*`, every ledger (`budget`, `reads`), wallet links and
deposits. They are the product's record and the source of receipts; a retention policy for them is
an owner decision (it would change what a receipt can prove) and is not taken here.

Table names are the current ones; if `schema-boundaries-v1.md` renames `wallets` to `signing`, the
job follows.

### 5.3 Backups

- **Supabase:** production project on a plan with daily backups and the PITR add-on (7-day window);
  staging on daily backups only. Recorded in `docs/operations/backups.md`.
- **Logical dump of every schema** (conventions decision 17; cross-review D6): `backup.yml` (GitHub
  Actions, daily 03:00 UTC, and `workflow_dispatch`) derives the schema list at run time — every
  schema in the database except Supabase's platform schemas (`storage`, `realtime`, `graphql*`,
  `extensions`, `vault`, `pgsodium*`, `supabase_*`, `net`, `cron`, `pg_*`, `information_schema`) — so
  `reads`, `me`, `media`, `ops`, `launch`, `auth` and any schema added later are covered without
  editing the job. It runs in two passes over the **session pooler** URL (IPv4; the direct host may
  be IPv6-only):
  1. **`reads` first**, alone: `pg_dump --format=custom --no-owner --no-privileges --schema=reads`
     → `<env>/daily/<timestamp>.reads.dump.age`, so the paid-read money ledger is captured even if
     the full pass fails.
  2. Everything else in the derived list → `<env>/daily/<timestamp>.dump.age`.

  Both are piped through `age -r $BACKUP_AGE_RECIPIENT` and uploaded to R2 bucket `pickler-backups`
  with one sibling `<timestamp>.manifest.json` covering both files. A failure of either pass fails
  the job and alerts. `auth` is in the dump for completeness; the restore drill restores the
  Drizzle-owned schemas and `reads`, and relies on Supabase backups and PITR for `auth`.

- **Pre-migration dump:** release step 2 (`production-environment-v1.md` §3.4) uses the same script,
  key prefix `<env>/pre-migration/`.
- **Retention (R2 lifecycle rules):** daily 14 days, pre-migration 90 days; a weekly copy
  (`<env>/weekly/`, Sundays) 8 weeks; monthly (`<env>/monthly/`, the 1st) 12 months.

### 5.4 Manifest

```json
{
  "env": "production",
  "takenAt": "2026-10-02T03:00:12Z",
  "migrationHead": "<hash>",
  "schemas": ["reads", "identity", "agents", "…"],
  "rows": { "reads.ledger_entries": 1290, "identity.profiles": 412, "agents.agents": 37, "…": 0 },
  "bytes": 18234112,
  "sha256": "<of the encrypted file>"
}
```

The restore drill restores and checks the `reads` file first, then the rest, and fails if any
restored table's count differs from the manifest.

---

## 6. Integrations

### 6.1 New Worker `workers/ops` (`pickler-ops-staging`, `pickler-ops-production`)

A new project needs its own `AGENTS.md` (root `AGENTS.md:7`) and a row in the root project map.

| Binding / setting                                                                                                                    | Purpose                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `tail` handler; listed in every other Worker's `tail_consumers: [{ "service": "pickler-ops-<env>" }]`                                | receives trace events (logs, exceptions, outcome)             |
| `DATABASE` (Hyperdrive, the environment's)                                                                                           | error groups, alerts, heartbeats, dead letters, retention     |
| `API` service binding                                                                                                                | `/v1/internal/ready`, `/v1/internal/ops/queues`               |
| Queue consumers for every DLQ in `production-environment-v1.md` §6.4 (research, trading, launch events, account jobs, notifications) | O10                                                           |
| `SEND_EMAIL` (`send_email`, destination = the verified owner address)                                                                | O4                                                            |
| `OPS_ALERT_WEBHOOK_URL` (secret, optional)                                                                                           | O4                                                            |
| `PROBE_URLS` (var)                                                                                                                   | the smoke GETs (landing, marketplace pages, `/api/v1/health`) |
| crons `* * * * *` (probe, rules), `*/15 * * * *` (sweepers), `0 4 * * *` (retention); route `ops.pickler.fun/__operator` only (§4.3) |                                                               |

Every other Worker gains `tail_consumers`, and research/trading gain
`"dead_letter_queue": "pickler-<name>-dlq-<env>"` on their consumer. `check:staging` and
`check:production` assert both.

The tail Worker does not tail itself (its own failures are caught by the external monitor, O5, and
by the heartbeat row `ops/<env>` that the probe writes and the external monitor cannot see — the
readiness verifier checks it).

### 6.2 Alert rules (evaluated by the ops Worker each minute)

| Rule                   | Condition                                                                                                        | Env        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| `new_error`            | a fingerprint seen for the first time                                                                            | production |
| `error_rate`           | > 2 % of API requests 5xx over 5 minutes (from tail outcomes), minimum 20 requests                               | both       |
| `probe_down`           | the same probe URL failed 3 consecutive minutes                                                                  | both       |
| `heartbeat_stale`      | research or trading `last_cron_at` older than 3 minutes (indexer once deployed)                                  | both       |
| `dead_letter`          | any `open` row in `ops.dead_letters`                                                                             | both       |
| `db_errors`            | > 5 `CONNECTION_LOST` or `QUERY_TIMEOUT` events in 5 minutes                                                     | both       |
| `queue_backlog`        | `researchOldestQueuedSeconds` > 600                                                                              | production |
| `turnkey_rejections`   | > 5 `activity_rejected` warnings in 15 minutes (`error-handler.ts:142-151` logs them)                            | production |
| `web_degraded`         | any `api_degraded` event from the web (skew or outage, `production-environment-v1.md` §0.1)                      | production |
| `nonce_table`          | `identity.siwe_nonces` > 50 000 rows                                                                             | production |
| `draft_ceiling`        | the daily draft ceiling reached                                                                                  | production |
| `treasury_mismatch`    | the daily reconcile (`paid-reads-v1.md` §4.4) reports a ledger/on-chain difference; sends are paused by that job | production |
| `treasury_gas_low`     | the treasury wallet holds < 1 MON                                                                                | production |
| `keeper_gas_low`       | the graduation keeper holds < 0.5 MON (`token-trading-v1.md` T8)                                                 | production |
| `refund_stuck`         | a refund flagged for an operator after 5 attempts (`paid-reads-v1.md` §4.4)                                      | production |
| `resolution_stale`     | a decision awaiting resolution for more than 30 days (`decision-resolution-v1.md`)                               | production |
| `commitment_mismatch`  | a public record's commitment does not match its stored decision (`public-record-v1.md`, `COMMITMENT_MISMATCH`)   | both       |
| `launch_without_grant` | the indexer sees a `LaunchCreated` with no matching grant (`launchpad-deploy-v1.md`)                             | production |
| `perpl_agent_frozen`   | reconciliation froze a Perpl agent (`perpl-live-v1.md`)                                                          | production |
| `jobs_heartbeat`       | `jobs/<env>` heartbeat older than 2 minutes                                                                      | both       |

This table is the **alert rule registry** (cross-review W6): a spec that needs an alert adds its
row here in the same PR, with the condition stated against a table or log event the ops Worker can
read.

Staging alerts go to the webhook only (if set), never to email, so staging noise cannot train the
owner to ignore production mail.

### 6.3 External systems and keys

| System                           | Use                                                                                     | Env var / secret                                                                 | Where            |
| -------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------- |
| Cloudflare Workers Rate Limiting | O6(a)                                                                                   | `ratelimits` bindings `RL_AUTH`, `RL_PUBLIC`, `RL_FORMS`, `RL_MODEL`, `RL_MONEY` | API config       |
| Cloudflare WAF                   | O8                                                                                      | zone rule, recorded in `docs/operations/waf.md`                                  | dashboard        |
| Cloudflare Email Routing         | O4                                                                                      | `send_email` binding; verified destination                                       | ops config       |
| Cloudflare R2                    | backups                                                                                 | `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `BACKUP_R2_BUCKET`     | GitHub secrets   |
| age                              | backup encryption                                                                       | `BACKUP_AGE_RECIPIENT` (public), `BACKUP_AGE_IDENTITY` (private, drill only)     | GitHub secrets   |
| Supabase Auth                    | captcha, SMTP                                                                           | Turnstile secret in Supabase; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the web build  | Supabase / build |
| Resend                           | SMTP for Supabase Auth; transactional API for `EMAIL_FROM` / `EMAIL_API_KEY` on the API | SMTP credentials in Supabase only; SPF/DKIM on `mail.pickler.fun`                | Supabase / DNS   |
| External uptime monitor          | O5                                                                                      | account owned by the owner (§12 Q2)                                              | vendor           |
| API                              | client-key salt                                                                         | `RATE_LIMIT_SALT` (secret)                                                       | API              |

`RATE_LIMIT_SALT` and the new names are added to `deploy/required-bindings.json`
(`production-environment-v1.md` §6.1).

---

## 7. Design work

| Screen / state                                                                                | Surface         | Canvas                                                        |
| --------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| Connect: "Too many sign-in attempts. Try again at 14:05." (429 from nonce/verify)             | marketplace web | new state on the existing connect modal; must be drawn        |
| Studio draft: "You have drafted a lot this hour. Next draft at 14:05." (`DRAFT_RATE_LIMITED`) | studio          | new state on `/studio/new` describe step; must be drawn       |
| Studio signup email step with the Turnstile widget                                            | studio          | existing signup canvas; the widget sits under the email field |
| Waitlist form: "Slow down — try again in a minute."                                           | landing         | new inline error on the existing form                         |

Copy uses `retryAt` in the viewer's local time. Each state gets a harness route
(`design-harness-v3.md`, "Degraded and empty states").

---

## 8. Security and abuse

- **Redaction before logging** (`redact(text)` in each `log.ts`): bearer tokens and JWTs
  (`eyJ[…]`), 64-hex private keys (`0x?[0-9a-f]{64}`), `sk-`/`rk_`-style API keys, email addresses
  (replaced by `<email>`), and anything after `password=`/`secret=`/`key=` in a URL. Tests pin each
  pattern. The ops Worker redacts again before storing a `sample`.
- **No raw IPs are stored or logged**, only the salted HMAC. `RATE_LIMIT_SALT` rotation (yearly or
  on suspicion) resets per-client counts, which is acceptable.
- The forwarded-client-IP header is honoured only on service-binding requests (§4.1), so a public
  caller cannot choose its own rate-limit key.
- The nonce cap is per client, never per address, so a caller cannot lock another wallet out
  (the reason the per-address cap evicts instead of refusing, `workers/api/AGENTS.md:98-102`).
- DLQ bodies are wake-ups with no personal data; if a future queue carries data, its spec must say
  whether `ops.dead_letters` may store it.
- Backups are encrypted client-side; the R2 token is scoped to one bucket; the private `age` key is a
  GitHub secret used only by the drill job.
- The operator endpoint (§4.3) accepts only signed, 60-second requests from keys in
  `deploy/operators.json`, only for allowlisted paths, and is rate-limited to 30 requests per minute;
  every call is logged with the operator name. It is the ops Worker's only public route.
- Email alerts contain fingerprints, counts and trace ids, never request bodies.

---

## 9. Acceptance criteria and tests

1. `workers/api/test/error-handler.test.ts`: a thrown `PostgresError` with code `42P01` produces one
   JSON log line with `errorClass`, `code`, `cause` and `traceId`, and the response body is still
   `Internal server error`.
2. `redact` tests: each pattern in §8 is removed; a 1 000-character message is truncated to 300.
3. Rate limits: route tests with a fake `RateLimit` binding and a real Postgres (`npm run db:up`):
   the 11th nonce request in a minute from one key answers 429 `NONCE_RATE_LIMITED` with `retryAt`
   and `Retry-After`; the 21st open nonce for one `client_hash` answers 429; the 31st draft in an
   hour answers 429 `DRAFT_RATE_LIMITED`; the 201st draft of the day answers 503.
4. The forwarded-IP header is ignored on a request that did not come through the binding (test with
   and without the marker).
5. `workers/ops/test/`: a tail event batch with two identical exceptions creates one group with
   count 2; a new fingerprint in production opens one alert; the same rule firing again within an
   hour sends no second email; a resolved alert sends one recovery.
6. DLQ: a consumer test forces three failures and asserts the message reaches the DLQ binding; the
   ops consumer stores it; `ops:dlq replay` sends it back (Queues API mocked).
7. Retention: seeded rows past each rule are deleted and rows inside are kept.
8. `backup.yml` runs on staging and produces an encrypted dump and manifest; `restore-drill.yml`
   restores it, reports "no migration applied" and matching counts. The first successful drill is
   recorded in the ledger.
9. `check:staging`/`check:production` fail when a Worker lacks `tail_consumers` or a consumer lacks
   `dead_letter_queue`.

---

## 10. Rollout and dependencies

1. **Logs with cause** (O1, O2) — API first, then research/trading/web. No dependency; ship now.
2. **Nonce `client_hash` and rate-limit bindings** (O6, O7) — one migration, one API PR.
3. **`workers/ops`** on staging: tail, heartbeats, probe, alerts to the webhook.
4. **DLQs** on staging, then production with the production queues.
5. **Backups + drill** on staging, then production once the production project exists.
6. **Supabase hardening and Data API un-exposure** (O9, O13) — before the studio opens publicly
   (`product-hosts-cutover-v2.md` step 3).
7. Production ops Worker with email alerts; external monitor.

Depends on: `production-environment-v1.md` (environments, ledger, heartbeat table, internal route
rules). Cited by: `marketplace-wallets-v1.md` (nonce limit, O7), `custody-v2.md` (sweepers, O12;
email, O9), `paid-reads-v1.md` (rate limits, email, alerts), `token-trading-v1.md` and
`mobile-backend-v1.md` (rate limits), and every spec with an operator route (§4.3).

---

## 11. Out of scope

- A public status page.
- Distributed tracing across Workers (trace ids are passed as `x-request-id`; spans are not).
- Paging or on-call rotation beyond email to one person.
- Log shipping (Logpush) to an external store; Workers Logs retention is accepted for v1.
- Bot management beyond Turnstile on signup and the zone rule.
- Reconciling the legacy Durable Object `AgentLedger` data (`docs/cloudflare-unification.md:72-79`).

---

## 12. Open questions for the owner

1. **Alert destination:** which email address should production alerts go to, and do you want a
   Slack or Discord webhook as well?
2. **External uptime monitor:** may we use a free external service (for example UptimeRobot or
   Better Stack) under your account? Without one, an outage of the Cloudflare account or of the ops
   Worker itself goes unreported.
3. **Supabase plan and PITR** for the production project (PITR is a paid add-on), and **SMTP
   provider** for Auth email: is Resend acceptable?
4. **Budget ceiling for model drafts:** is 200 drafts per day per environment the right ceiling, or
   do you want a different number (or a monetary cap)?
