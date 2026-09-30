# Production environment v1

Status: Draft — decided autonomously 2026-09-30. Every decision below is reversible unless the
Decisions table says otherwise. Follows `docs/product-map/conventions.md` (autonomous decision 9:
"Production is its own environment").

Research this builds on: `docs/product-map/research/06-platform.md` (gaps G1, G2, G4, G9, G10) and
`docs/product-map/research/05-identity-studio-mobile.md` §2.6.

---

## 0. Immediate incident (open on 2026-09-30)

**Symptom.** `https://pickler.fun/agents` and `https://pickler.fun/leaderboard` answer HTTP 500
(also `/markets`). `/`, `/tokens` and `/api/v1/health` answer 200.

**Cause.** Version skew between two Workers deployed by two different mechanisms:

- The web Worker `pickler-web-staging` is auto-built from `main` by Workers Builds
  (`docs/cloudflare-staging.md:247-259`). It serves `pickler.fun` through a custom domain attached in
  the dashboard, outside the repository (PR #31).
- The API Worker `pickler-api-staging` was last deployed by hand from `c59d9dd` on 2026-09-24
  (`docs/polymarket-worker-pilot.md:185-192`). The `/v1/marketplace/*` prefix and `/v1/launches` were
  merged later (`workers/api/src/app.ts:61-69`), so the deployed API answers them with 404
  `Route not found` (`app.ts:42`).
- The web's page code turns any non-2xx into a thrown error: `apiJson` throws on `!response.ok`
  (`apps/web/src/server/api-client.ts:45-49`). `/agents` calls `services.listDirectory()`
  (`apps/web/src/app/agents/page.tsx:14`) and `/leaderboard` calls `getLeaderboard` and
  `getPlatformAnalytics` (`apps/web/src/app/leaderboard/page.tsx:19-22`). The throw reaches the
  error boundary (`apps/web/src/app/error.tsx`), which renders "We could not load the board." with
  status 500.
- `/tokens` survives because `listLaunches` already maps 404 to `null`
  (`apps/web/src/server/container.ts:24-36`). That is the pattern the interim fix generalises.

**Known good.** Production migrations 0000–0022 were applied to Supabase project
`yvdipvcrpbqvofayteqf` and verified by hash on 2026-09-29 (PR #61). The database is ahead of the
API, not behind it, so deploying the API from main does not need a migration first.

### 0.1 Safe interim fix (web only, no backend deploy, no secrets)

A PR against `apps/web`, mergeable on its own:

1. **`apiRead<T>(path, empty: T)` in `apps/web/src/server/api-client.ts`**, beside `apiJson`. It
   returns `{ data: T, degraded: false }` on 2xx. On 404 or any 5xx it returns
   `{ data: empty, degraded: true }` and logs one line:
   `console.warn(JSON.stringify({ event: "api_degraded", path, status }))`. It still throws on
   network or binding failures (`Missing API service binding`, `api-client.ts:38-40`), because a
   missing binding is a configuration error, not skew.
2. **Marketplace read methods in `container.ts` switch to `apiRead`** with an explicit empty value:
   `listDirectory` → `[]`, `listAgents` → `[]`, `listReads` → `[]`, `listMarkets` → `[]`,
   `getLeaderboard` → the empty `LeaderboardDto` that `packages/api-schema` already describes for a
   board with no rows, `getPlatformAnalytics` → zeroed analytics. The single-item reads
   (`getAgentProfile`, `getPickDetail`, `getAgentPersona`, `getRead`, `getMarket`) already accept
   `null`; they map 404/5xx to `null`, and the page's existing not-found path renders.
3. **The empty state is the designed one.** `marketplace-real-data-v1.md` §5 already treats the empty
   state as "exactly what a person sees at launch". The pages render it at HTTP 200. When `degraded`
   is true the page adds one line under the heading: "The board is catching up. Numbers will appear
   shortly." (`data-degraded="true"` on the section, so the design harness and the smoke test can
   find it).
4. **Not changed:** `getApplicant` and every authenticated call. A 5xx on a private screen must stay
   an error, because an empty portfolio shown to a signed-in person is a lie about their money.

Tests (`apps/web/test/api-read.test.ts`): 200 passes data through; 404 and 503 return the empty
value and `degraded: true`; a thrown binding error still throws; 401 still throws (it is not skew).

This fix is safe to ship before anything else in this document, and it stays after the real fix: a
public read page should never 500 because a dependency is behind.

### 0.2 Real fix (API deploy from main)

Deploy `pickler-api-staging` (and, in the same release, research and trading) from the current main
commit, following §3.4. The API must be deployed with these set, or the corresponding routes stay
unmounted (`workers/api/src/app.ts:55-60`; `workers/api/src/env.ts:26-57`):

| Name                                                | Kind   | Value (set in Step B unless noted)                                      |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY` | secret | parent-org API key pair                                                 |
| `TURNKEY_PARENT_ORG_ID`                             | var    | parent organisation id                                                  |
| `TURNKEY_DELEGATED_API_PUBLIC_KEY`                  | var    | compressed P-256 hex (public)                                           |
| `TURNKEY_DELEGATED_API_PRIVATE_KEY`                 | secret | held, unused until live trading                                         |
| `TURNKEY_RPID`                                      | var    | `studio.pickler.fun` — see the warning below                            |
| `SIWE_DOMAIN`                                       | var    | `app.pickler.fun`                                                       |
| `WALLET_EMAIL_DOMAIN`                               | var    | `wallet.pickler.fun` (never MX)                                         |
| `ENCRYPTION_KEY`                                    | secret | 32 random bytes, base64 (Step A)                                        |
| `CHAIN_ID`, `MONAD_RPC_URL`                         | var    | `10143`, a provider RPC (Step A; secret if the URL carries a key)       |
| `MODEL_BASE_URL`, `MODEL_ID`, `MODEL_API_KEY`       | mixed  | research model (Step A; key secret); without them drafting alone is 503 |
| `ALLOWED_ORIGINS`                                   | var    | every browser origin that calls the API (Step A: `https://pickler.fun`) |

**The one-way door, and why the real fix is split in two steps.** `TURNKEY_RPID` must never be set
to `pickler.fun` or `app.pickler.fun`, not even for a day: the first passkey enrolled against it
cannot be moved (`docs/specs/product-hosts-v1.md` §3, §8). `SIWE_DOMAIN` must equal the host the
browser signs on (`docs/specs/user-profiles-and-products-v1.md` §14). Today only `pickler.fun`
resolves and the studio host does not exist. So:

- **Step A (now, decided):** deploy the API from main with the Turnkey and SIWE variables **absent**.
  `/v1/marketplace/*`, `/v1/launches`, `/v1/studio/*` and profiles come back; `/v1/signing` and
  `/v1/auth/wallet` stay unmounted (404, the same as today). This closes the 500s with zero one-way
  risk. The studio is unreachable on any public host anyway (research 06 G3), so nothing is lost.
- **Step B (with the host cutover, `product-hosts-cutover-v2.md`):** once `app.pickler.fun` and
  `studio.pickler.fun` resolve to the web Worker, redeploy with `TURNKEY_RPID=studio.pickler.fun`,
  `SIWE_DOMAIN=app.pickler.fun`, `WALLET_EMAIL_DOMAIN=wallet.pickler.fun` and the Turnkey secrets.

This refines the team lead's "deploy with TURNKEY_*, SIWE_DOMAIN and WALLET_EMAIL_DOMAIN
configured": configure them in Step B, not Step A, because a `SIWE_DOMAIN=pickler.fun` today would
bind every marketplace session to the host the cutover is about to take the marketplace away from
(research 05 open question 8). Reversible: if the owner wants wallet sign-in on `pickler.fun`
before the cutover, set `SIWE_DOMAIN=pickler.fun` and accept re-signing after the move (SIWE
sessions are not one-way; the RP is).

**Verification after Step A** (smoke list, §3.6): `GET https://pickler.fun/agents` → 200 and no
`data-degraded`; `GET https://pickler.fun/api/v1/marketplace/directory` → 200;
`GET https://pickler.fun/api/v1/launches` → 200; `GET /api/v1/signing/wallets/me` → 404 (still
unmounted, intended). Record the Worker version ids in the ledger (§5).

**Before Step A, check one thing about health.** Research 06 observed `/api/v1/health` → 200 on the
deployed build. On main, the API matches `/health` only (`workers/api/src/app.ts:45`,
`workers/api/src/index.ts:11`), and the web proxy maps `/api/v1/health` to `/v1/health`
(`apps/web/src/app/api/v1/[...path]/route.ts:5`), which main would answer 404. Step A therefore
includes adding `GET /v1/health` (§4) so nothing that watches the current URL breaks.

---

## 1. Problem and users

Only a staging topology exists in code. Every Wrangler config is named `*-staging` or is the
local-only `pickler-api` (`apps/web/wrangler.jsonc:4`, `workers/api/wrangler.staging.jsonc:4`,
`workers/research/wrangler.jsonc:4`, `workers/trading/wrangler.jsonc:4`,
`workers/indexer/wrangler.jsonc:3`). No config declares a route or custom domain;
`scripts/check-staging.mjs:19-21` hard-codes the staging names; and `pickler.fun` is attached to the
staging web Worker from the dashboard. Deploys are manual, unordered and unrecorded after
2026-09-24, and the web can outrun the API (§0).

Users:

- **The owner / operator**, who needs to ship a known commit to production in a known order, see
  what is deployed, and roll back.
- **Everyone who opens `pickler.fun`**, who should never see a 500 caused by a deploy order.
- **Agent builders in the studio**, whose passkeys and money depend on production variables that
  are invisible to tests (`user-profiles-and-products-v1.md` §14 lists why each fails silently).

---

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Reversible?                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| D1  | Production is a **second set of Workers in the same Cloudflare account** `bc8d4adf…`, named `pickler-web-production`, `pickler-api-production`, `pickler-research-production`, `pickler-trading-production`, `pickler-indexer-production`, plus the three Workers other specs add: `pickler-treasury-production` (`paid-reads-v1.md` R18), `pickler-jobs-production` (`paid-reads-v1.md` §4.4, `go-public-v1.md` §6) and `pickler-ops-production` (`operations-v1.md` O3). Staging mirrors every name with `-staging`. | One account keeps DNS, Hyperdrive and Queues in one place; distinct names keep `check:staging` and every staging record valid. `pickler-api` is taken by the local config (`workers/api/wrangler.jsonc:3`).                                                                                                                                                                                                                                                                                                                                                                  | Yes (rename = redeploy + DNS).                                                 |
| D2  | One file per Worker per environment: `wrangler.production.jsonc` beside the existing staging file. No Wrangler `env` blocks.                                                                                                                                                                                                                                                                                                                                                                                           | Matches the existing `wrangler.staging.jsonc` pattern and the check script, which parses whole files. Env blocks would change every staging command.                                                                                                                                                                                                                                                                                                                                                                                                                         | Yes.                                                                           |
| D3  | **Supabase: a separate production project** is recommended; the owner chooses between it and one project with separate schemas (§5.1). Until the owner answers, `yvdipvcrpbqvofayteqf` is the one hosted project and is treated as production for data safety.                                                                                                                                                                                                                                                         | Supabase Auth is one per project: `auth.users`, redirect URLs, email settings and rate limits cannot be split by schema. A staging mistake on a shared project is a production incident.                                                                                                                                                                                                                                                                                                                                                                                     | The recommendation is reversible until real users sign up; after that, costly. |
| D4  | Production gets its **own Hyperdrive** (`pickler-database-production`), own Queues, R2 buckets and dead-letter queues; §6.4 lists every one.                                                                                                                                                                                                                                                                                                                                                                           | Hyperdrive and Queues are per origin and per consumer; sharing them would join the two environments at the transport.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Yes.                                                                           |
| D5  | **Custom domains declared in config** (`routes` with `custom_domain: true`) on `pickler-web-production` only: `pickler.fun`, `app.pickler.fun`, `studio.pickler.fun`. Backends keep `workers_dev: false`, `preview_urls: false`, no routes.                                                                                                                                                                                                                                                                            | Dashboard-only domains are how `pickler.fun` ended up on staging (PR #31). In config, a review shows it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Yes.                                                                           |
| D6  | **Branch → environment:** `main` deploys **staging** automatically; **production** deploys only from a manual `workflow_dispatch` of a commit that is already deployed and smoke-tested on staging.                                                                                                                                                                                                                                                                                                                    | Keeps one path to production and makes staging the rehearsal. No release branch to keep in sync.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Yes.                                                                           |
| D7  | **All five Workers deploy through GitHub Actions with `wrangler deploy`.** Workers Builds keeps only **previews** for the web; its production auto-deploy is turned off for both web Workers.                                                                                                                                                                                                                                                                                                                          | The auto-built web outrunning the hand-deployed API is §0. One pipeline in one order removes the cause. Previews are presentation-only by design (`apps/web/wrangler.jsonc:16-20`), so keeping them is harmless.                                                                                                                                                                                                                                                                                                                                                             | Yes (re-enable in the dashboard).                                              |
| D8  | Order: **backup → migrations → ops → trading → treasury → research → API → indexer → jobs → readiness → web → smoke → ledger.** Stop at the first failure.                                                                                                                                                                                                                                                                                                                                                             | Consumers before producers (`docs/cloudflare-staging.md:150`; `docs/polymarket-worker-pilot.md:122-124`); a Worker is deployed before any Worker that binds to it (ops is every Worker's tail consumer; the API binds trading and treasury; jobs binds the API); 0022-style migrations before API/research (`docs/specs/studio-brief-v1.md:265-268`), web last because it is the one people see. Ops goes **first**, not last as the cross-review suggested (W2): every other Worker names it in `tail_consumers`, and a tail consumer that does not exist fails the deploy. | Yes.                                                                           |
| D9  | The **deployment ledger** is an append-only JSON Lines file per environment on a dedicated branch `ops/ledger`, written by the release workflow. `main` carries only its README.                                                                                                                                                                                                                                                                                                                                       | A ledger committed to `main` would need a push to `main` per deploy, which root `AGENTS.md:44` forbids. A separate branch is auditable in git without that.                                                                                                                                                                                                                                                                                                                                                                                                                  | Yes.                                                                           |
| D10 | A **readiness verifier** `scripts/check-readiness.mjs` (`npm run check:readiness -- --env <staging\|production>`) reads names and settings, never secret values, and exits non-zero on any failed item. It runs before the web step of every production release.                                                                                                                                                                                                                                                       | Every item in `user-profiles-and-products-v1.md` §14 fails silently. A script makes them fail loudly, before people do.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Yes.                                                                           |
| D11 | The Hyperdrive origin uses a **dedicated database role `pickler_app`**, not `postgres`, with explicit grants recorded in a migration where Pickler owns the object and in `docs/operations/database-roles.md` where Supabase owns it (`auth.*`).                                                                                                                                                                                                                                                                       | Today the origin role is unrecorded (research 06 Q4) and the `auth.users` grant is invisible to every test (`user-profiles-and-products-v1.md:590-600`).                                                                                                                                                                                                                                                                                                                                                                                                                     | Yes.                                                                           |
| D12 | Production admission flags start **closed**: `ADMISSIONS_ENABLED=false`, `TRADING_ADMISSIONS_ENABLED=false`, `PERPL_ADMISSIONS_ENABLED=false`, `RESOLUTION_ENABLED=false`, `TREASURY_SENDS_ENABLED=false`, opened by the owner after acceptance with the override recorded in the ledger.                                                                                                                                                                                                                              | Same rule as a new staging environment (`docs/cloudflare-staging.md:136`); opening admissions also admits due schedules (`:237-240`).                                                                                                                                                                                                                                                                                                                                                                                                                                        | Yes.                                                                           |
| D13 | Every deployed Worker receives `PICKLER_RELEASE_SHA` (`--var PICKLER_RELEASE_SHA:<sha>`), and the web build receives `NEXT_PUBLIC_RELEASE_SHA`. The API reports it on `/v1/health`.                                                                                                                                                                                                                                                                                                                                    | Makes skew visible in one request and lets the verifier compare web and API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Yes.                                                                           |
| D14 | Staging stays on `yvdipvcrpbqvofayteqf` and `*-staging` Workers, but **loses `pickler.fun`** at production cutover. Staging keeps its workers.dev web URL.                                                                                                                                                                                                                                                                                                                                                             | Production traffic must not be served by staging Workers against staging data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Yes.                                                                           |

---

## 3. User flows

### 3.1 The operator ships a commit to production

1. A PR merges to `main`. `release.yml` runs the staging release (§3.4) for that SHA automatically.
2. The staging smoke passes and the ledger records `{ env: "staging", sha, status: "ok" }`.
3. The operator opens Actions → "Release" → "Run workflow", chooses `environment: production`, and
   types the short SHA into `confirm_sha`. The job refuses unless the actor is listed in
   `deploy/operators.txt`, the SHA matches the input, and the staging ledger has `status: "ok"` for
   that SHA.
4. The production release runs (§3.4). On any failure it stops, runs no later step, writes
   `status: "failed"` with the failed step, and prints the rollback command for every Worker it had
   already deployed (§3.5).

### 3.2 A deploy without CI (break-glass)

`npm run release -- --env production --sha <sha> --operator` runs the same `scripts/release.mjs`
locally, with `CLOUDFLARE_API_TOKEN` and `DATABASE_MIGRATION_URL` read from the environment. It
appends the ledger entry to a local file and prints the `git` commands to push it to `ops/ledger`.
Same order, same checks, same refusals.

### 3.3 The owner answers the Supabase question

The owner edits §12 Q1 in a PR (or tells the agent). If "separate project": §5.1 option B runbook.
If "one project": §5.1 option A runbook.

### 3.4 Release steps (`scripts/release.mjs`, used by both flows)

| Step | Command (proposed)                                                                                                                                                  | Gate                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0    | `npm ci && npm run build:shared && npm run build:workers`                                                                                                           | builds pass                                                                                                              |
| 1    | `npm run check:staging -- --provisioned` or `npm run check:production -- --provisioned`                                                                             | topology passes                                                                                                          |
| 2    | Backup: `pg_dump --format=custom` over `DATABASE_MIGRATION_URL` to the backup bucket (`operations-v1.md`, "Backups")                                                | dump exists and `pg_restore --list` reads it; skipped only if no migration is pending                                    |
| 3    | `npm run db:migrate` with `DATABASE_MIGRATION_URL` (`packages/infrastructure/src/persistence/migrate.ts:4-7`)                                                       | every journal hash present in `pickler_migrations.__drizzle_migrations` afterwards                                       |
| 4    | `wrangler deploy --config workers/ops/wrangler.<env>.jsonc --var PICKLER_RELEASE_SHA:<sha>` (every other Worker names it in `tail_consumers`)                       | deploy returns a version id                                                                                              |
| 5    | same for `workers/trading`                                                                                                                                          | version id                                                                                                               |
| 6    | same for `workers/treasury` (the API binds it as `TREASURY`)                                                                                                        | version id; `TREASURY_SENDS_ENABLED` unchanged from the previous ledger entry unless the release overrides it on purpose |
| 7    | same for `workers/research`                                                                                                                                         | version id; research heartbeat within 3 min (readiness)                                                                  |
| 8    | same for `workers/api`                                                                                                                                              | `GET <web>/api/v1/health` is still served by the old web and reports the new `release`                                   |
| 9    | same for `workers/indexer` — **skipped** while `LAUNCH_FACTORY_ADDRESS` is unset (`workers/indexer/wrangler.jsonc:12-13`; `launchpad-deploy-v1.md` §6.4)            | —                                                                                                                        |
| 10   | same for `workers/jobs` (its crons call the API that step 8 just deployed)                                                                                          | version id; jobs heartbeat within 2 min                                                                                  |
| 11   | `npm run check:readiness -- --env <env>` (§4.3)                                                                                                                     | exit 0; production only blocks, staging warns                                                                            |
| 12   | Web: `npm run build --workspace=@pickler/api-schema && npm run build:worker --workspace=@pickler/web` then `wrangler deploy --config apps/web/wrangler.<env>.jsonc` | version id                                                                                                               |
| 13   | Smoke (§3.6)                                                                                                                                                        | all pass                                                                                                                 |
| 14   | Ledger append (§5.3)                                                                                                                                                | always runs, including after failure                                                                                     |

The web build in step 12 runs with the build environment of §6.2 (the `NEXT_PUBLIC_*` values must be
present at build time, `user-profiles-and-products-v1.md:557-571`).

**First creation of an environment (bootstrap).** A service binding or tail consumer that names a
Worker that does not exist yet fails the deploy. The first run therefore deploys `ops` with
`--config workers/ops/wrangler.<env>.bootstrap.jsonc` (no `API` binding), then the order above, then
`ops` again with its normal config. R2 buckets, Queues and DLQs (§6.4) are created by
`scripts/provision.mjs --env <env>` before the first deploy; it is idempotent and only creates what
is missing.

### 3.5 Rollback

1. Close admissions if the incident touches research or trading: redeploy the affected configs with
   `--var ADMISSIONS_ENABLED:false` (and `TRADING_ADMISSIONS_ENABLED:false`,
   `PERPL_ADMISSIONS_ENABLED:false`), recorded in the ledger (`docs/cloudflare-staging.md:179-190`).
   If it touches money leaving the treasury, first redeploy treasury with
   `--var TREASURY_SENDS_ENABLED:false` and jobs with `--var JOBS_ENABLED:false`
   (`paid-reads-v1.md` §8: one flag stops all outflows).
2. `wrangler rollback <version-id> --config <matching config>` per Worker, **web first** when the
   regression is presentation-only, else web last. Version ids come from the previous `ok` ledger
   entry. `scripts/release.mjs --rollback-to <ledger-entry-id>` prints the commands; it runs them
   only with `--execute`.
3. Never reverse a migration. A rollback target must be compatible with the current migration head;
   the ledger records `migrationHead` per entry so the script refuses a target older than the last
   migration that removed or renamed something (flagged by a `-- pickler:breaking` comment in the
   migration file, new convention).

### 3.6 Smoke list (`scripts/smoke.mjs`, anonymous HTTP only)

| Request                                                    | Expect                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `GET <landing>/`                                           | 200                                                       |
| `GET <marketplace>/agents`, `/leaderboard`, `/tokens`      | 200, and no `data-degraded="true"` in the HTML            |
| `GET <marketplace>/api/v1/health`                          | 200, `data.release` equals the SHA being released         |
| `GET <marketplace>/api/v1/marketplace/directory`           | 200                                                       |
| `GET <marketplace>/api/v1/launches`                        | 200                                                       |
| `GET <marketplace>/api/v1/profile`                         | 401 (mounted, needs a session)                            |
| `POST <marketplace>/api/v1/auth/wallet/nonce` with `{}`    | 400 when Step B is done; 404 before it (expected per env) |
| `GET <studio>/api/v1/signing/wallets/me`                   | 401 when Step B is done; 404 before it                    |
| `GET <marketplace>/.well-known/apple-app-site-association` | 200 `application/json`                                    |
| `GET <studio>/.well-known/apple-app-site-association`      | 404 (after the cutover)                                   |

Which rows apply is declared per environment in `deploy/smoke.<env>.json`, so Step A and Step B are
data, not code. Every spec that ships a public route adds one anonymous request for it to
`deploy/smoke.<env>.json` in the same PR (cross-review E12).

---

## 4. API

### 4.1 `GET /v1/health` (new alias) and `GET /health` (unchanged)

- Auth: none. Reached publicly through the web proxy as `/api/v1/health`.
- Response 200: `{ data: { status: "ok", release: "<PICKLER_RELEASE_SHA or 'unknown'>", env: "<APP_ENV>" }, meta: {} }`.
- Liveness only, like today (`app.ts:44-45`). No dependency is touched, so it cannot be used to probe
  the database.

### 4.2 `GET /v1/internal/ready` (new, service binding only)

- Auth: reachable only through a service binding. The web proxy refuses any path that starts with
  `/api/v1/internal` with 404 before calling the API (a one-line check in
  `apps/web/src/app/api/v1/[...path]/route.ts`), and the API refuses the route unless the request
  carries the header `x-pickler-internal: 1` set by the calling Worker's binding wrapper.
- Response 200: `{ data: { database: "ok", migrationHead: "<hash>", release: "<sha>" } }`.
- Errors: 503 `DEPENDENCY_DOWN` with `detail: { database: "down" }` when `select 1` over `DATABASE`
  fails within 2 s.
- Used by the uptime probe Worker in `operations-v1.md` ("Uptime checks"). The verifier does not
  call it; it reads the database directly (§4.3).

### 4.3 Readiness verifier (script, not an HTTP API)

`scripts/check-readiness.mjs --env <staging|production> [--json]`. Inputs, all from the environment:
`CLOUDFLARE_API_TOKEN` (Workers Scripts: Read, Hyperdrive: Read), `CLOUDFLARE_ACCOUNT_ID`,
`SUPABASE_ACCESS_TOKEN` (Management API, read), `SUPABASE_PROJECT_REF`, `DATABASE_MIGRATION_URL`
(operator), `HYPERDRIVE_ROLE` (default `pickler_app`). It prints one line per item,
`PASS|FAIL|SKIP <id> <what>`, never a value of a secret, and exits 1 on any FAIL.

| Id                   | Check                                                                                                                                                                                                                                                                                                                                           | Source of truth                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `bindings.<worker>`  | Cloudflare API `GET /accounts/{id}/workers/scripts/{name}/settings`: every name in `deploy/required-bindings.json` for that worker is present (type `secret_text` for secrets; `plain_text` for vars). Missing → FAIL naming the binding.                                                                                                       | §6.1 inventory                              |
| `vars.rpid`          | API `TURNKEY_RPID` (a plain var, not secret) equals `studio.pickler.fun` in production. Any other value → FAIL. Absent → FAIL once Step B is declared in `deploy/smoke.production.json`, else SKIP.                                                                                                                                             | `product-hosts-v1.md` §3                    |
| `vars.siwe`          | `SIWE_DOMAIN` equals `app.pickler.fun`; `WALLET_EMAIL_DOMAIN` equals `wallet.pickler.fun`. Same Step A/B rule.                                                                                                                                                                                                                                  | `product-hosts-v1.md` §6                    |
| `vars.origins`       | `ALLOWED_ORIGINS` contains exactly the three production origins.                                                                                                                                                                                                                                                                                | `product-hosts-v1.md` §6                    |
| `vars.admissions`    | API and research `ADMISSIONS_ENABLED` agree; API and trading `TRADING_ADMISSIONS_ENABLED` agree (the same rules as `scripts/check-staging.mjs:45-49`, `:71`, against deployed state).                                                                                                                                                           | `check-staging.mjs`                         |
| `db.auth_grants`     | Over the operator connection: `has_table_privilege($role, 'auth.users', 'SELECT')` and `has_table_privilege($role, 'auth.identities', 'SELECT')` are both true.                                                                                                                                                                                 | `workers/api/AGENTS.md:81-85`               |
| `db.rls`             | `$role` owns, or has `BYPASSRLS` over, every table in **every schema Drizzle owns**. The list is derived at run time from the migration SQL at the released SHA (`CREATE SCHEMA` statements in `packages/infrastructure/drizzle/*.sql`), never hard-coded, so `reads`, `me`, `media`, `ops` and any later schema are covered (cross-review D6). | PR #61 "Before relying on it in production" |
| `db.migrations`      | Every hash in `packages/infrastructure/drizzle/meta/_journal.json` (computed the way `migrate-database.ts` does) is present in `pickler_migrations.__drizzle_migrations`, and no unknown hash is (`packages/infrastructure/src/persistence/migrate-database.ts:28-50`).                                                                         | the repository at the released SHA          |
| `db.data_api`        | The Supabase Data API (`GET /v1/projects/{ref}/postgrest`, `db_schema`) exposes **none** of the Drizzle-owned schemas (the same derived list), nor `pickler_migrations`, `mastra` or `internal`. This is the one list; `operations-v1.md` O13 uses it (cross-review C26).                                                                       | root `AGENTS.md:83`; `operations-v1.md` O13 |
| `auth.confirmations` | Management API `GET /v1/projects/{ref}/config/auth`: `mailer_autoconfirm` is false (confirmations on).                                                                                                                                                                                                                                          | `studio-create-and-fund-v1.md:229-236`      |
| `auth.redirects`     | `site_url` is `https://studio.pickler.fun` and `uri_allow_list` is exactly `https://studio.pickler.fun/auth/callback`.                                                                                                                                                                                                                          | `product-hosts-v1.md:213-216`               |
| `auth.templates`     | The magic-link and confirmation templates contain `{{ .Token }}`.                                                                                                                                                                                                                                                                               | `turnkey-passkey-custody-v1.md` §10         |
| `auth.smtp`          | `smtp_host` is set (custom SMTP), and captcha is enabled (`security_captcha_enabled`). WARN, not FAIL, in staging.                                                                                                                                                                                                                              | research 06 G8                              |
| `dns.mx`             | DNS-over-HTTPS query for `MX wallet.pickler.fun` returns no answer.                                                                                                                                                                                                                                                                             | `user-profiles-and-products-v1.md:612-619`  |
| `health.api`         | `GET <marketplace>/api/v1/health` → 200 and `release` equals the SHA under release (or the ledger's last `ok` SHA when run alone).                                                                                                                                                                                                              | §4.1                                        |
| `health.web`         | `GET <marketplace>/` HTML carries `<meta name="pickler-release" content="<sha>">` (added by the web from `NEXT_PUBLIC_RELEASE_SHA`) equal to the API's release, or the ledger says the skew is deliberate.                                                                                                                                      | D13                                         |
| `health.research`    | `ops.worker_heartbeats` row for `research/<env>` has `last_cron_at` within 3 min (§5.4).                                                                                                                                                                                                                                                        | heartbeat table                             |
| `health.trading`     | same for `trading/<env>`.                                                                                                                                                                                                                                                                                                                       | heartbeat table                             |
| `health.indexer`     | same for `indexer/<env>`, SKIP while the indexer is not deployed.                                                                                                                                                                                                                                                                               | heartbeat table                             |
| `health.jobs`        | `ops.worker_heartbeats` row for `jobs/<env>` within 2 min, and no `/v1/internal/*` call from jobs answered 5xx in the last 10 min (ops error groups).                                                                                                                                                                                           | heartbeat table                             |
| `health.treasury`    | `ops.worker_heartbeats` row for `treasury/<env>` (written by its daily self-check); `TREASURY_SENDS_ENABLED` is `"true"` or `"false"` explicitly.                                                                                                                                                                                               | heartbeat table, bindings                   |
| `chain.treasury`     | The treasury wallet's address (from Turnkey, via the treasury Worker's self-check row) equals `READ_TREASURY_ADDRESS` in `@pickler/chain` for `CHAIN_ID`; its MON balance is ≥ 1 MON (gas float, `paid-reads-v1.md` §6). Below → FAIL in production.                                                                                            | RPC `eth_getBalance`                        |
| `chain.keeper`       | The graduation keeper's MON balance (`token-trading-v1.md` T8) is ≥ 0.5 MON; SKIP while no token is launched.                                                                                                                                                                                                                                   | RPC                                         |
| `chain.launch_auth`  | `launchAuthority()` on the factory equals `LAUNCH_AUTHORITY_ADDRESS` (`launchpad-deploy-v1.md` §6.3); SKIP while the factory is not deployed.                                                                                                                                                                                                   | RPC `eth_call`                              |
| `flags.explicit`     | Every admission flag is `"true"` or `"false"` and paired Workers agree: `ADMISSIONS_ENABLED` (api, research), `TRADING_ADMISSIONS_ENABLED` and `PERPL_ADMISSIONS_ENABLED` (api, trading; `perpl-live-v1.md` §6.3), `RESOLUTION_ENABLED` (research, `decision-resolution-v1.md`), `TREASURY_SENDS_ENABLED` (treasury).                           | bindings                                    |
| `storage.r2`         | Buckets `pickler-media-<env>` and `pickler-exports-<env>` exist (Cloudflare API); `GET https://media.pickler.fun/.health` answers 200 (a 1-byte object `provision.mjs` writes); the exports bucket has the 2-day lifecycle rule (`custody-v2.md` C11).                                                                                          | Cloudflare API, HTTP                        |
| `queues.all`         | Every queue in §6.4 exists, has exactly the consumer listed, and every consumer has its `dead_letter_queue`.                                                                                                                                                                                                                                    | Cloudflare API                              |
| `build.hosts`        | The built web bundle (`apps/web/.open-next/`) contains the literal production hosts, grepped after step 12's build, before its deploy. Guards `user-profiles-and-products-v1.md:565-570`.                                                                                                                                                       | build output                                |

---

## 5. Data model and migrations

### 5.1 The Supabase project decision (owner chooses; recommendation B)

Today: one hosted project, `yvdipvcrpbqvofayteqf` ("pickler", us-east-1,
`docs/staging-database-upgrade-2026-09-19.md:3-5`). It carries staging acceptance users and runs
**and** whatever real people have typed into `pickler.fun` (waitlist, applications). Migrations
0000–0022 applied and hash-verified on 2026-09-29.

**Option A — one project, separate schemas.** Production uses the existing product schemas; staging
moves to a schema-prefixed copy (`stg_identity`, `stg_agents`, …) or to a second database in the
same Postgres.

- Cost: no second project.
- Breaks: Supabase Auth is one per project, so staging and production share `auth.users`, the
  redirect list, email templates, SMTP, captcha and auth rate limits. A staging test user is a
  production user. Every schema name is hard-coded in Drizzle (`pgSchema`), so a prefix is a code
  change across the infrastructure package. Hyperdrive would still need two roles to keep staging
  from reading production tables.
- Verdict: workable only if staging stops using Supabase Auth, which it cannot (the studio signup is
  email OTP).

**Option B — a separate production project (recommended).** Create `pickler-production` in the
same organisation and region (us-east-1, next to Hyperdrive's origin choice). `yvdipvcrpbqvofayteqf`
stays staging.

- Steps: create the project on a plan with daily backups and PITR (`operations-v1.md`, "Backups"); create
  role `pickler_app` (§5.2); run `npm run db:migrate` from the released SHA over the new operator URL;
  configure Auth (confirmations on, `{{ .Token }}` templates, custom SMTP, captcha, redirect list,
  Google OAuth client); un-expose all product schemas from the Data API (the API no longer uses it,
  `workers/api/AGENTS.md:322-332`); create Hyperdrive `pickler-database-production` against the
  session pooler on port 5432 with `verify-full` and the project CA, caching off, origin limit 10
  (mirrors `docs/cloudflare-staging.md:204-211`).
- One-time data carry-over: export `growth` waitlist and applications rows (the only tables that can
  hold real people today) from staging and import them into production, recorded in the ledger as a
  `data-migration` entry. Nothing else moves; no passkey or wallet account exists that could need to.
- Cost: a second project's compute. Benefit: an Auth configuration mistake in staging cannot sign
  anyone into production.

**Option B′ (variant):** promote `yvdipvcrpbqvofayteqf` to production and create a new staging
project. Cheaper if it already holds data worth keeping; rejected as the default because it carries
test users and acceptance runs that would become production rows.

**Until the owner answers**, D3 applies: `yvdipvcrpbqvofayteqf` is treated as production for data
safety (backups before every migration, no resets, no test users created without a label), and the
Step A deploy in §0.2 targets it through the existing staging Hyperdrive.

### 5.2 Database role `pickler_app`

Created once per project by the operator (Supabase owns `auth`, so this is not a Drizzle migration):

```sql
create role pickler_app login password '<from a password manager>' noinherit;
grant usage on schema auth to pickler_app;
grant select on auth.users, auth.identities to pickler_app;
-- product schemas: pickler_app owns them via the migration role, or:
alter role pickler_app bypassrls;
```

Recorded in a new `docs/operations/database-roles.md` with the date, the operator and the verifier
output. If Supabase refuses the `auth` grant on the chosen plan (its `auth` schema is owned by
`supabase_auth_admin`), the fallback is a `security definer` function
`identity.auth_user_lookup(email text)` owned by `postgres`, created by a Pickler migration, and the
verifier's `db.auth_grants` checks `has_function_privilege` instead. That fallback changes
`createAuthUserLookup` in infrastructure and is a separate PR.

### 5.3 Deployment ledger

Branch `ops/ledger` (orphan, never merged into `main`), files `ledger/staging.jsonl` and
`ledger/production.jsonl`. One JSON object per line:

```json
{
  "id": "2026-10-01T14:03:22Z-production-3f2a9c1",
  "env": "production",
  "sha": "3f2a9c1…",
  "operator": "github:<login>",
  "trigger": "workflow_dispatch|operator",
  "status": "ok|failed|rolled-back",
  "failedStep": null,
  "migrationHead": "<hash of the last applied migration>",
  "backup": "r2://pickler-backups/production/pre-migration/2026-10-01T14-02-50Z.dump.age",
  "workers": {
    "ops": "<version id>",
    "trading": "<version id>",
    "treasury": "<version id>",
    "research": "<version id>",
    "api": "<version id>",
    "indexer": null,
    "jobs": "<version id>",
    "web": "<version id>"
  },
  "overrides": { "ADMISSIONS_ENABLED": "false", "TREASURY_SENDS_ENABLED": "false" },
  "readiness": { "pass": 18, "fail": 0, "skip": 2 },
  "smoke": "pass",
  "notes": ""
}
```

`main` gets `docs/deployments/README.md` explaining where the ledger lives and how to read it
(`git show origin/ops/ledger:ledger/production.jsonl | tail -1`). Existing dated records
(`docs/staging-deployment-2026-09-20.md`, `docs/api-hyperdrive-deployment-2026-09-20.md`) stay as
history; the first ledger entry back-fills the 2026-09-24 staging state and the 2026-09-29
migration verification.

### 5.4 Heartbeat table (owned by `operations-v1.md`)

`ops.worker_heartbeats` is created by the `ops` schema migration that `operations-v1.md` §5 owns
(cross-review C24); this spec only reads it. Written by research, trading, indexer, jobs, treasury
and ops at the end of each cron pass (treasury: its daily self-check) with one upsert.

---

## 6. Integrations

### 6.1 Secrets and variables inventory, per Worker (production)

`S` = secret (`wrangler secret put`, stdin only), `V` = committed var in `wrangler.production.jsonc`,
`B` = binding. The same list, machine-readable, is `deploy/required-bindings.json`; the verifier and
`check:production` read it.

| Worker    | Name                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Kind                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| web       | `API` → `pickler-api-production`, `WORKER_SELF_REFERENCE`                                                                                                                                                                                                                                                                                                                                                                                             | B                   | as `apps/web/wrangler.jsonc:10-13`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| web       | `NEXTJS_ENV=production`                                                                                                                                                                                                                                                                                                                                                                                                                               | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| web build | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                                                                                                                                                                                                                                                                                                                                                                    | build               | public by design                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| web build | `NEXT_PUBLIC_LANDING_HOST`, `NEXT_PUBLIC_MARKETPLACE_HOST`, `NEXT_PUBLIC_STUDIO_HOST`                                                                                                                                                                                                                                                                                                                                                                 | build               | `pickler.fun`, `app.pickler.fun`, `studio.pickler.fun`                                                                                                                                                                                                                                                                                                                                                                                                 |
| web build | `NEXT_PUBLIC_RELEASE_SHA`, `NEXT_PUBLIC_OAUTH_X_ENABLED`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_MERA_RP_ID` (`app.pickler.fun`), `NEXT_PUBLIC_MERA_WEB`, `NEXT_PUBLIC_TOKEN_TRADING`, `PICKLER_DEPLOY_ENV`, `AASA_ON_LANDING` (production `true` for 90 days after the cutover, decision 14)                                                                                                                                                 | build               |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `DATABASE` (Hyperdrive), `RESEARCH_QUEUE`, `TRADING_QUEUE`, `TRADING_EXECUTOR`                                                                                                                                                                                                                                                                                                                                                                        | B                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `APP_ENV=production`, `ADMISSIONS_ENABLED`, `TRADING_ADMISSIONS_ENABLED`, `JWT_AUDIENCE`                                                                                                                                                                                                                                                                                                                                                              | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `SUPABASE_URL`, `JWT_ISSUER`, `ALLOWED_ORIGINS`                                                                                                                                                                                                                                                                                                                                                                                                       | V                   | not secret; staging keeps them as secrets (`docs/cloudflare-staging.md:129`) and may continue to                                                                                                                                                                                                                                                                                                                                                       |
| api       | `SUPABASE_SECRET_KEY`, `ENCRYPTION_KEY`                                                                                                                                                                                                                                                                                                                                                                                                               | S                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `TURNKEY_PARENT_ORG_ID`, `TURNKEY_RPID`, `TURNKEY_APP_NAME`, `TURNKEY_DELEGATED_API_PUBLIC_KEY`                                                                                                                                                                                                                                                                                                                                                       | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_DELEGATED_API_PRIVATE_KEY`                                                                                                                                                                                                                                                                                                                                                              | S                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `SIWE_DOMAIN`, `WALLET_EMAIL_DOMAIN`, `CHAIN_ID`                                                                                                                                                                                                                                                                                                                                                                                                      | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `MONAD_RPC_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                       | S                   | a provider URL usually embeds a key                                                                                                                                                                                                                                                                                                                                                                                                                    |
| api       | `MODEL_BASE_URL`, `MODEL_ID`                                                                                                                                                                                                                                                                                                                                                                                                                          | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `MODEL_API_KEY`                                                                                                                                                                                                                                                                                                                                                                                                                                       | S                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api       | `SUPER_ADMIN_EMAILS`                                                                                                                                                                                                                                                                                                                                                                                                                                  | S                   | a list of people's emails is not committed                                                                                                                                                                                                                                                                                                                                                                                                             |
| api       | `PICKLER_RELEASE_SHA`                                                                                                                                                                                                                                                                                                                                                                                                                                 | V                   | `--var` at deploy                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| research  | `DATABASE`, `RESEARCH_QUEUE` (producer + consumer), `TRADING_QUEUE`                                                                                                                                                                                                                                                                                                                                                                                   | B                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| research  | `APP_ENV`, `ADMISSIONS_ENABLED`, `PICKLER_RELEASE_SHA`                                                                                                                                                                                                                                                                                                                                                                                                | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| research  | `MODEL_BASE_URL`, `MODEL_ID`                                                                                                                                                                                                                                                                                                                                                                                                                          | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| research  | `MODEL_API_KEY`, `EXA_API_KEY`, optional sports keys for enabled plugins                                                                                                                                                                                                                                                                                                                                                                              | S                   | `docs/cloudflare-staging.md:130`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| trading   | `DATABASE`, `TRADING_QUEUE`                                                                                                                                                                                                                                                                                                                                                                                                                           | B                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| trading   | `APP_ENV`, `TRADING_ADMISSIONS_ENABLED`, `PICKLER_RELEASE_SHA`                                                                                                                                                                                                                                                                                                                                                                                        | V                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| trading   | `POLYMARKET_SIGNER_PRIVATE_KEY`, `POLYMARKET_SIGNER_ADDRESS`, `POLYMARKET_WALLET_ADDRESS`, `POLYMARKET_CLOB_API_KEY`, `POLYMARKET_CLOB_API_SECRET`, `POLYMARKET_CLOB_API_PASSPHRASE`                                                                                                                                                                                                                                                                  | S                   | `workers/trading/src/index.ts:26-31`; absent keeps trading in explicit configuration failure                                                                                                                                                                                                                                                                                                                                                           |
| indexer   | `DATABASE`                                                                                                                                                                                                                                                                                                                                                                                                                                            | B                   | missing today (`workers/indexer/wrangler.jsonc:12-13`)                                                                                                                                                                                                                                                                                                                                                                                                 |
| indexer   | `APP_ENV`, `CHAIN_ID`, `CONFIRMATIONS`, `MAX_BLOCKS_PER_PASS`, `LAUNCH_FACTORY_ADDRESS`, `LAUNCH_FACTORY_DEPLOYMENT_BLOCK`, `PICKLER_RELEASE_SHA`                                                                                                                                                                                                                                                                                                     | V                   | `workers/indexer/src/config.ts:28-57`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| indexer   | `RPC_URLS`                                                                                                                                                                                                                                                                                                                                                                                                                                            | S                   | when it names a keyed provider                                                                                                                                                                                                                                                                                                                                                                                                                         |
| api       | `TREASURY` → `pickler-treasury-<env>`, `MEDIA` (R2 `pickler-media-<env>`), `EXPORTS` (R2 `pickler-exports-<env>`), `IMAGES` (Cloudflare Images)                                                                                                                                                                                                                                                                                                       | B                   | `paid-reads-v1.md` §4.4; `token-launch-v1.md` T5/§6; `go-public-v1.md` §6; `custody-v2.md` C11                                                                                                                                                                                                                                                                                                                                                         |
| api       | `LAUNCH_EVENTS_QUEUE` (consumer), `ACCOUNT_JOBS_QUEUE` (producer + consumer), `NOTIFICATIONS_QUEUE` (producer + consumer)                                                                                                                                                                                                                                                                                                                             | B                   | `launchpad-deploy-v1.md` §6.3; `custody-v2.md` §6; `mobile-backend-v1.md` §6                                                                                                                                                                                                                                                                                                                                                                           |
| api       | **no crons** (conventions decision 15). The work other specs put on an API cron runs in `workers/jobs` (product jobs) or `workers/ops` (housekeeping); see §6.6                                                                                                                                                                                                                                                                                       | —                   | cross-review W1, C7                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| api       | `MEDIA_PUBLIC_BASE_URL`, `MEDIA_UPLOAD_MAX_BYTES`, `MEDIA_UPLOADS_PER_HOUR`, `LAUNCH_MAX_GAS`, `LAUNCH_TICKER_RESERVATION_DAYS`, `LAUNCH_AUTHORITY_ADDRESS`, `LAUNCH_GRANT_TTL_SECONDS`, `TOKEN_LAUNCH_ENABLED`                                                                                                                                                                                                                                       | V                   | `token-launch-v1.md` §6; `launchpad-deploy-v1.md` §6.3. **One chain variable:** `CHAIN_ID` is the Monad network for every Monad feature, so `LAUNCH_CHAIN_ID` is not added; `PERPL_CHAIN_ID` is the only override, because Perpl may reach mainnet before the launchpad (cross-review C22). **One RPC variable on the API:** `MONAD_RPC_URL`; `RPC_URLS` stays on the indexer only, and the web uses the public RPC constant in `@pickler/chain` (C23) |
| api       | `LAUNCH_AUTHORITY_TURNKEY_KEY_ID`                                                                                                                                                                                                                                                                                                                                                                                                                     | S                   | `launchpad-deploy-v1.md` §6.3                                                                                                                                                                                                                                                                                                                                                                                                                          |
| api       | `PERPL_ADMISSIONS_ENABLED`, `PERPL_STUDIO_ENABLED`, `PERPL_CHAIN_ID`, `PERPL_PILOT_MAX_COLLATERAL_MICRO`, `PERPL_AGENT_GAS_FLOOR_MON`                                                                                                                                                                                                                                                                                                                 | V                   | `perpl-live-v1.md` §6.3                                                                                                                                                                                                                                                                                                                                                                                                                                |
| api       | `X_CLIENT_ID`                                                                                                                                                                                                                                                                                                                                                                                                                                         | V                   | `go-public-v1.md` §6                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| api       | `X_BEARER_TOKEN`, `X_CLIENT_SECRET`, `X_TOKEN_ENCRYPTION_KEY`                                                                                                                                                                                                                                                                                                                                                                                         | S                   | `go-public-v1.md` §6                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| api       | `EMAIL_FROM`                                                                                                                                                                                                                                                                                                                                                                                                                                          | V                   | `paid-reads-v1.md` §6                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| api       | `EMAIL_API_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`                                                                                                                                                                                                                                                                                                                                                                                         | S                   | `paid-reads-v1.md` §6; `mobile-backend-v1.md` §6                                                                                                                                                                                                                                                                                                                                                                                                       |
| api       | `RATE_LIMIT_SALT`, `RL_*` rate-limit bindings                                                                                                                                                                                                                                                                                                                                                                                                         | S / B               | `operations-v1.md` §6.3. `marketplace-wallets-v1.md` names the nonce salt `NONCE_IP_SALT`; the build uses **one** secret, `RATE_LIMIT_SALT`, for both, and that spec's `NONCE_IP_CAP` becomes the nonce row of `operations-v1.md` §4.1                                                                                                                                                                                                                 |
| api       | `PUBLIC_RECORD_ENABLED`, `PERPL_BOARD_ENABLED`, `PERPL_BOARD_NETWORK`, `REVIEW_EXPORT_ENABLED`, `QUOTE_MAX_HEAD_AGE_SECONDS`, `QUOTE_MAX_INDEX_LAG_SECONDS`, `TRADE_DEADLINE_SECONDS`, `LAUNCH_KEEPER_ENABLED`, `MOBILE_MIN_VERSION_IOS`, `MOBILE_MIN_VERSION_ANDROID`, `MOBILE_LATEST_VERSION_IOS`, `MOBILE_LATEST_VERSION_ANDROID`, `MON_GAS_TOPUP_WEI`, `ACCOUNT_DELETION_GRACE_DAYS`, `HANDLE_QUARANTINE_DAYS`, `DUST_*`, `READ_TREASURY_ADDRESS` | V                   | `public-record-v1.md`, `studio-decision-review-v1.md`, `token-trading-v1.md`, `mobile-backend-v1.md`, `custody-v2.md`, `paid-reads-v1.md` (the treasury address is also a constant in `@pickler/chain`; the var must equal it, checked by `chain.treasury`)                                                                                                                                                                                            |
| research  | crons `* * * * *` (existing) and `*/5 * * * *` (resolution and exit monitor); `RESOLUTION_ENABLED`, `EXIT_MONITOR_ENABLED`, `POLYGON_RPC_URL`, `RESEARCH_TARIFFS`, `RESEARCH_MONTHLY_ALLOWANCE_MICRO_USD`                                                                                                                                                                                                                                             | trigger / V         | `decision-resolution-v1.md` D10 and §6; `research-runtime-v2.md`. **No new bindings:** read delivery, X-outbox rows and notification rows are written through core use cases in the resolution/run transaction (cross-review W4, C18), and `workers/jobs` drains them                                                                                                                                                                                  |
| trading   | `PERPL_ADMISSIONS_ENABLED`, `PERPL_CHAIN_ID`, `PERPL_ENROLL_ORIGIN`, `PERPL_MAX_LEVERAGE`                                                                                                                                                                                                                                                                                                                                                             | V                   | `perpl-live-v1.md` §6.3; `PERPL_ENROLL_ORIGIN` is `https://studio.pickler.fun` (staging: `https://studio-stg.pickler.fun`)                                                                                                                                                                                                                                                                                                                             |
| trading   | `PERPL_KEY_ENCRYPTION_KEY`, `TURNKEY_DELEGATED_API_PRIVATE_KEY`, `LAUNCH_KEEPER_PRIVATE_KEY`, `MONAD_RPC_URL`                                                                                                                                                                                                                                                                                                                                         | S                   | `perpl-live-v1.md` §6.3 (the delegated key only signs the kill switch; once Perpl is live, trading is the only Worker that decrypts it and the API copy is removed, cross-review W10); `token-trading-v1.md` T8 (gas-only keeper)                                                                                                                                                                                                                      |
| trading   | `PERPL_TESTNET_FAUCET_PRIVATE_KEY`                                                                                                                                                                                                                                                                                                                                                                                                                    | S                   | **staging and testnet only**; `check:production` fails if it is in `deploy/required-bindings.json` for production                                                                                                                                                                                                                                                                                                                                      |
| indexer   | `LAUNCH_EVENTS_QUEUE` (producer)                                                                                                                                                                                                                                                                                                                                                                                                                      | B                   | `launchpad-deploy-v1.md` §6.3                                                                                                                                                                                                                                                                                                                                                                                                                          |
| treasury  | `DATABASE` (idempotency by `referenceId`, heartbeat)                                                                                                                                                                                                                                                                                                                                                                                                  | B                   | no public route, `workers_dev: false`; reachable only from the API's `TREASURY` binding                                                                                                                                                                                                                                                                                                                                                                |
| treasury  | `APP_ENV`, `CHAIN_ID`, `TREASURY_TURNKEY_ORG_ID`, `TREASURY_WALLET_ID`, `TREASURY_SENDS_ENABLED`, `PICKLER_RELEASE_SHA`                                                                                                                                                                                                                                                                                                                               | V                   | `paid-reads-v1.md` §6; sends start `false` in production                                                                                                                                                                                                                                                                                                                                                                                               |
| treasury  | `TREASURY_TURNKEY_API_PUBLIC_KEY`, `TREASURY_TURNKEY_API_PRIVATE_KEY`, `MONAD_RPC_URL`                                                                                                                                                                                                                                                                                                                                                                | S                   | held by no other Worker (R18); a separate Turnkey API key from the API's parent-org key                                                                                                                                                                                                                                                                                                                                                                |
| jobs      | `API` → `pickler-api-<env>`, `TRADING` → `pickler-trading-<env>` (graduation keeper RPC only)                                                                                                                                                                                                                                                                                                                                                         | B                   | no secrets of its own (`go-public-v1.md` §6); the keeper key stays in trading, jobs only triggers it                                                                                                                                                                                                                                                                                                                                                   |
| jobs      | crons `* * * * *`, `*/5 * * * *`, `*/15 * * * *`, `30 0 * * *`, `0 1 * * *`, `0 3 * * *`; `APP_ENV`, `JOBS_ENABLED`, `PICKLER_RELEASE_SHA`                                                                                                                                                                                                                                                                                                            | trigger / V         | the product-job table in §6.6. `JOBS_ENABLED=false` makes every cron a no-op (a kill switch for all outflow-triggering jobs)                                                                                                                                                                                                                                                                                                                           |
| ops       | `DATABASE`, `API`, DLQ consumers, `SEND_EMAIL`, `PROBE_URLS`; `OPS_ALERT_WEBHOOK_URL` (S)                                                                                                                                                                                                                                                                                                                                                             | B / V / S           | `operations-v1.md` §6.1                                                                                                                                                                                                                                                                                                                                                                                                                                |
| all       | `tail_consumers: [{ "service": "pickler-ops-<env>" }]`                                                                                                                                                                                                                                                                                                                                                                                                | config              | `operations-v1.md` §6.1                                                                                                                                                                                                                                                                                                                                                                                                                                |
| operator  | `DATABASE_MIGRATION_URL`, `CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, backup bucket keys                                                                                                                                                                                                                                                                                                                                                         | GitHub repo secrets | never in a Worker                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Every spec that adds a binding adds its name to `deploy/required-bindings.json` in the same PR;
`check:production` fails on a name the config has and the file does not, and the reverse.

### 6.2 Config files (new)

- `apps/web/wrangler.production.jsonc` — as `apps/web/wrangler.jsonc` with name
  `pickler-web-production`, `API` → `pickler-api-production`, and
  `"routes": [{ "pattern": "pickler.fun", "custom_domain": true }, { "pattern": "app.pickler.fun", "custom_domain": true }, { "pattern": "studio.pickler.fun", "custom_domain": true }]`,
  plus the `assets.run_worker_first` entry from `product-hosts-cutover-v2.md` §5.
- `workers/api/wrangler.production.jsonc`, `workers/research/wrangler.production.jsonc`,
  `workers/trading/wrangler.production.jsonc`, `workers/indexer/wrangler.production.jsonc` — the
  staging files with `-production` names, the production Hyperdrive id, production Queues with
  `dead_letter_queue`, and admissions `false`.
- New projects, each with `wrangler.jsonc` (staging, following the existing research/trading
  pattern), `wrangler.production.jsonc` and its own `AGENTS.md` (root `AGENTS.md:7`):
  `workers/treasury`, `workers/jobs`, `workers/ops`. All three have `workers_dev: false` and
  `preview_urls: false`; treasury and jobs have no routes, and ops has exactly one, the operator
  endpoint `ops.pickler.fun/__operator` (`operations-v1.md` §4.3); `check:production` asserts it, and asserts that `workers/ops`, `workers/jobs` and `workers/treasury` each have a production config, appear in `scripts/release.mjs`'s step list and in the ledger's `workers` object (cross-review W2).
- `scripts/check-production.mjs` (`npm run check:production`) — the assertions of
  `scripts/check-staging.mjs` generalised by a table of names per environment, plus: web has exactly
  the three custom domains; no backend has routes; every Worker's `account_id` matches; production
  Hyperdrive id differs from staging's. Runs in `postgres.yml` beside `check:staging`.

### 6.3 GitHub Actions

`.github/workflows/release.yml`: `on: push: branches: [main]` (staging) and `workflow_dispatch`
with inputs `environment` and `confirm_sha` (production). `concurrency: release-${{ env }}` with
`cancel-in-progress: false`. Permissions `contents: write` only for the ledger job, which pushes to
`ops/ledger`. Secrets as repository secrets (available on the current plan): `CLOUDFLARE_API_TOKEN`
(Workers Scripts Edit, Queues Edit, Hyperdrive Read, scoped to the account), `DATABASE_MIGRATION_URL_STAGING`,
`DATABASE_MIGRATION_URL_PRODUCTION`, `SUPABASE_ACCESS_TOKEN`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `BACKUP_R2_BUCKET`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY` (names from `operations-v1.md` §6.3). GitHub Environments
with required reviewers are not assumed (the plan answers 403 for branch protection; research 06
G11); the operator allowlist and typed SHA replace them.

### 6.4 Resources per environment (created by `scripts/provision.mjs`)

| Resource                      | Kind                                                                     | Producer → consumer                            | DLQ                                     | Source spec                                           |
| ----------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `pickler-database-<env>`      | Hyperdrive                                                               | api, research, trading, indexer, treasury, ops | —                                       | this spec, D4                                         |
| `pickler-research-<env>`      | Queue                                                                    | api, research → research                       | `pickler-research-dlq-<env>` → ops      | existing; `operations-v1.md`                          |
| `pickler-trading-queue-<env>` | Queue                                                                    | api, research, trading → trading               | `pickler-trading-dlq-<env>` → ops       | existing; `perpl-live-v1.md` adds message kinds       |
| `pickler-launch-events-<env>` | Queue                                                                    | indexer → api                                  | `pickler-launch-events-dlq-<env>` → ops | `launchpad-deploy-v1.md` §6.3                         |
| `pickler-account-jobs-<env>`  | Queue                                                                    | api → api                                      | `pickler-account-jobs-dlq-<env>` → ops  | `custody-v2.md` §6                                    |
| `pickler-notifications-<env>` | Queue                                                                    | api → api                                      | `pickler-notifications-dlq-<env>` → ops | `mobile-backend-v1.md` §6                             |
| `pickler-media-<env>`         | R2, public via `media.pickler.fun` (staging `media-staging.pickler.fun`) | api writes                                     | —                                       | `token-launch-v1.md` T5; `go-public-v1.md` §6         |
| `pickler-exports-<env>`       | R2, private, 2-day lifecycle                                             | api writes, signed links                       | —                                       | `custody-v2.md` C11                                   |
| `pickler-backups`             | R2, private                                                              | GitHub Actions                                 | —                                       | `operations-v1.md` §5.3 (one bucket, prefixed by env) |

`mobile-backend-v1.md` names its DLQ `pickler-notifications-dlq`; the `-<env>` suffix is added here
so staging and production never share one. The same applies to every queue a sibling spec names
without an environment.

### 6.5 New Workers and the MEDIA bucket, at a glance

| Project / resource                  | Deployed as                                                 | Config files (new)                                                              | Secrets                                                                                      | Bindings                                                                          | Deploy step (§3.4) | Readiness items (§4.3)                                        |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| `workers/ops`                       | `pickler-ops-<env>`                                         | `wrangler.jsonc`, `wrangler.production.jsonc`, `wrangler.<env>.bootstrap.jsonc` | `OPS_ALERT_WEBHOOK_URL` (optional)                                                           | `DATABASE`, `API`, every DLQ consumer, `SEND_EMAIL`; tail consumer of all Workers | 4 (first)          | `queues.all`, ops heartbeat                                   |
| `workers/treasury`                  | `pickler-treasury-<env>`                                    | `wrangler.jsonc`, `wrangler.production.jsonc`                                   | `TREASURY_TURNKEY_API_PUBLIC_KEY`, `TREASURY_TURNKEY_API_PRIVATE_KEY`, `MONAD_RPC_URL`       | `DATABASE`; bound by the API as `TREASURY`                                        | 6                  | `health.treasury`, `chain.treasury`, `flags.explicit`         |
| `workers/jobs`                      | `pickler-jobs-<env>`                                        | `wrangler.jsonc`, `wrangler.production.jsonc`                                   | none                                                                                         | `API`, `TRADING`; crons as §6.6                                                   | 10                 | `health.jobs`                                                 |
| `workers/trading` (Perpl additions) | existing `pickler-trading-<env>`                            | existing files gain the Perpl vars                                              | `PERPL_KEY_ENCRYPTION_KEY`, `TURNKEY_DELEGATED_API_PRIVATE_KEY`, `LAUNCH_KEEPER_PRIVATE_KEY` | existing                                                                          | 5                  | `flags.explicit` (`PERPL_ADMISSIONS_ENABLED`), `chain.keeper` |
| R2 `MEDIA`                          | bucket `pickler-media-<env>`, public at `media.pickler.fun` | created by `scripts/provision.mjs`                                              | none                                                                                         | `MEDIA` on `workers/api`, with `MEDIA_PUBLIC_BASE_URL` and `IMAGES`               | before step 4      | `storage.r2`                                                  |

Sources: `paid-reads-v1.md` R18 and §4.4 (treasury, jobs), `go-public-v1.md` §6 (jobs, avatars in
`MEDIA`), `token-launch-v1.md` T5 and §6 (`MEDIA`, `IMAGES`), `perpl-live-v1.md` §6.3 (trading),
`operations-v1.md` §6.1 (ops).

### 6.6 Where scheduled work runs (conventions decision 15)

The API has no `scheduled` handler. Every cron in the platform is listed here; a spec that adds one
adds its row in the same PR.

| Worker   | Cron           | Job                                                                                                                                                                     | Source                                                                                                                |
| -------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| jobs     | `* * * * *`    | reads: verify payments, sweep deadlines, run refunds; X outbox drain; notifications drain; launch status; trade watcher; graduation keeper (calls trading's keeper RPC) | `paid-reads-v1.md` §4.4; `go-public-v1.md` §4; `mobile-backend-v1.md`; `token-launch-v1.md`; `token-trading-v1.md` T8 |
| jobs     | `*/5 * * * *`  | reads evaluation                                                                                                                                                        | `paid-reads-v1.md` §4.4                                                                                               |
| jobs     | `*/15 * * * *` | custody deposit reconciler                                                                                                                                              | `custody-v2.md` C10                                                                                                   |
| jobs     | `30 0 * * *`   | reads payouts                                                                                                                                                           | `paid-reads-v1.md` §4.4                                                                                               |
| jobs     | `0 1 * * *`    | reads reconcile (treasury ledger vs chain)                                                                                                                              | `paid-reads-v1.md` §4.4                                                                                               |
| jobs     | `0 3 * * *`    | media cleanup (unreferenced uploads)                                                                                                                                    | `token-launch-v1.md`                                                                                                  |
| ops      | `* * * * *`    | probes, alert rules                                                                                                                                                     | `operations-v1.md` §6.2                                                                                               |
| ops      | `*/15 * * * *` | sweepers: expired nonces, WebAuthn challenges, preview runs, abandoned add-device pendings                                                                              | `operations-v1.md` §5.2; `custody-v2.md` C10 (cross-review C7)                                                        |
| ops      | `0 4 * * *`    | retention                                                                                                                                                               | `operations-v1.md` §5.2                                                                                               |
| research | `* * * * *`    | research runs (existing), follow-ups                                                                                                                                    | `workers/research/wrangler.jsonc:27`; `research-runtime-v2.md`                                                        |
| research | `*/5 * * * *`  | decision resolution, exit monitor                                                                                                                                       | `decision-resolution-v1.md` D10                                                                                       |
| trading  | `* * * * *`    | order reconciliation (existing), Perpl reconciliation, risk stops, key expiry — kept in trading because each step signs or reads with a key only trading holds          | `workers/trading/wrangler.jsonc:23`; `perpl-live-v1.md` §6.2                                                          |
| indexer  | `* * * * *`    | launch indexing                                                                                                                                                         | `workers/indexer/wrangler.jsonc:9`                                                                                    |

Each jobs cron calls one `/v1/internal/*` route through the `API` binding and does nothing else, so
the business logic stays in the API's composition root.

---

## 7. Design work

- **Degraded marketplace line** (§0.1): one sentence under the heading on `/agents`, `/leaderboard`,
  `/markets`, `/reads`, on the existing empty states. Uses existing tokens; no new canvas. Measured
  by a new harness route `agents-degraded` served by a fixture that answers 503
  (`design-harness-v3.md`, "Degraded and empty states").
- No operator UI. The ledger and verifier are CLI and git.

---

## 8. Security and abuse

- The verifier and release script never print a secret value. Cloudflare's settings API returns
  secret bindings without values; the script asserts `type === "secret_text"` and the name only.
- Secrets reach Wrangler through stdin (`wrangler secret put <NAME> < file` from a masked Actions
  step), never as arguments (`docs/cloudflare-staging.md:135-136`).
- `/v1/internal/*` is refused by the web proxy and requires the internal header, so a public request
  can never reach it even if routing changes.
- The Cloudflare token in GitHub is scoped to one account and to Workers, Queues and Hyperdrive; it
  cannot edit DNS. DNS changes stay manual (cutover spec).
- The production workflow refuses a SHA that did not pass staging, and an actor not in
  `deploy/operators.txt`. `operators.txt` changes go through a PR like any code.
- Admissions and treasury sends start closed (D12), so a production deploy cannot spend provider
  money or move AUSD by itself.
- Each signer lives in exactly one Worker: Polymarket, Perpl and keeper keys in trading; the read
  treasury key in treasury; the launch authority key id and the user-custody Turnkey key in the API.
  `check:production` fails if a signer secret name from `deploy/required-bindings.json` appears on a
  second Worker. `workers/jobs` holds no secret at all.
- `TURNKEY_RPID` is asserted by the verifier on every production release; the value can never drift
  to a host that would enrol passkeys under the wrong RP.

---

## 9. Acceptance criteria and tests

1. **Incident closed:** after §0.1 merges, `https://pickler.fun/agents` answers 200 with the empty
   state and `data-degraded="true"`; after §0.2 Step A, it answers 200 with no `data-degraded`.
2. `apps/web/test/api-read.test.ts` covers 200, 404, 503, 401 and a binding error (§0.1).
3. `npm run check:production` passes on the committed production configs and fails when a backend
   gains a route, a Hyperdrive id equals staging's, or admissions disagree (unit tests in
   `scripts/check-production.test.mjs` feeding altered JSON).
4. `scripts/check-readiness.mjs` has unit tests over recorded API fixtures: a missing secret, a wrong
   RPID, `mailer_autoconfirm: true`, a missing grant and an unknown migration hash each produce FAIL
   and exit 1; a full set produces exit 0. No test calls a real provider.
5. A staging release run end to end from `release.yml` produces a ledger line with a version id per
   Worker (web, api, research, trading, treasury, jobs, ops; indexer `null` until deployed) and
   `smoke: "pass"`.
6. A forced failure at step 7 (research deploy with a bad config in a test branch run against
   staging) stops the run, deploys nothing after it, and writes `status: "failed"`,
   `failedStep: 7`.
7. `scripts/release.mjs --rollback-to <id>` prints the correct `wrangler rollback` commands for the
   recorded versions and refuses a target older than a `-- pickler:breaking` migration.

---

## 10. Rollout and dependencies

1. **Now:** §0.1 web PR (no dependency). §0.2 Step A: API/research/trading from main against the
   current project, by hand following §3.4, recorded as the first ledger line.
2. `release.yml`, `scripts/release.mjs`, `scripts/smoke.mjs`, ledger branch — staging only.
   Turn off Workers Builds production deploy for `pickler-web-staging` in the same change (D7).
3. Owner answers Q1 (Supabase). Create the production project (option B) or not.
4. Production configs, `check:production`, `pickler_app` role, Hyperdrive, Queues, DLQs.
5. `product-hosts-cutover-v2.md` (DNS for `app.` and `studio.`, hosts code, AASA fix) — required
   before Step B and before the production web gets its domains.
6. Readiness verifier green → first production release → move `pickler.fun` from
   `pickler-web-staging` to `pickler-web-production` (the cutover spec's order).

**Combined runbook with the host cutover (cross-review K5).** The two specs interleave on purpose,
not in a deadlock: this spec's §0 (steps 1 above) → `product-hosts-cutover-v2.md` §10.1 steps 0–7 on
the Worker that serves `pickler.fun` → this spec's steps 4–6.

**Acceptance runs (cross-review G2).** Two acceptances are recorded here because no other spec owns
them, each as a ledger entry with `kind: "acceptance"`:

- The trading pilot's funded single purchase (`docs/polymarket-worker-pilot.md:170-176`): run after
  the owner funds the pilot wallet and binds the executor secrets; entry records the order id, fill,
  reconciliation result and Worker versions.
- The hosted browser session-lifecycle acceptance on HTTPS (`docs/staging-deployment-2026-09-20.md:187-188`):
  sign in, refresh, sign out, `no-store` on private responses and cookie flags, on the staging
  studio host after the cutover rehearsal; entry records the checks and the browser.

Research paid acceptance belongs to `research-runtime-v2.md` R13.

Depends on: `product-hosts-cutover-v2.md` (hosts), `operations-v1.md` (backups, DLQs, heartbeats,
the `ops` schema migration).
Blocks: paid reads, launchpad and Perpl going live, which all need production secrets.

---

## 11. Out of scope

- A second Cloudflare account for production.
- Terraform or Pulumi for Cloudflare and Supabase.
- Blue/green or percentage rollouts (Workers gradual deployments) — possible later with the same
  ledger.
- Paid acceptance runs (research 06 S9); they need the owner's allowance, not this pipeline.
- The schema-boundaries rename (`schema-boundaries-v1.md`); if accepted, it should land before real
  production data exists, which this spec makes a visible date.

---

## 12. Open questions for the owner

1. **Supabase: separate production project (recommended, option B), one project with separate
   schemas (A), or promote the current project and make a new staging (B′)?** Which plan should the
   production project be on (PITR needs a paid add-on)?
2. May the release workflow hold a Cloudflare API token and the production migration URL as GitHub
   repository secrets? If not, production stays operator-run with `scripts/release.mjs` (§3.2) and
   the same ledger.
3. Is it acceptable to turn off Workers Builds' production auto-deploy for the web (D7)? It is the
   cause of today's incident, but it is also how the web has shipped so far.
4. Is anyone besides the owner allowed to run a production release (the content of
   `deploy/operators.txt`)?
5. Do you want wallet sign-in on `pickler.fun` before the host cutover (`SIWE_DOMAIN=pickler.fun`,
   re-sign after the move), or keep it off until Step B as decided?
