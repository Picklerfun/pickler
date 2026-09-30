# 06 — Platform, deployment, operations and the design harness

Research date: 2026-09-30. Branch `codex/product-scope-map` = `origin/main` at `c407fec`. Read-only.
Remote facts come from repository records, `gh` read calls and anonymous HTTP GETs against public
hostnames on 2026-09-30. The Supabase MCP server failed to connect, so the hosted database was not
inspected directly; nothing here about the hosted database is first-hand except where a doc records it.

## 1. Summary

1. Only a **staging** topology exists in code: every Wrangler config is named `*-staging` (or is the local-only `pickler-api`), there is no production config, no custom-domain route and no production Supabase project named anywhere. Yet `pickler.fun` is served today by the staging web Worker (PR #31 body; `curl https://pickler.fun/` → 200).
2. The **web and the API are out of step on the live host**: `pickler.fun/api/v1/marketplace/*` and `/api/v1/launches` answer 404 "Route not found" from Hono, so `pickler.fun/agents` answers 500. The last recorded backend deploy is `c59d9dd` (2026-09-24), 684 commits behind main; the web is auto-built by Workers Builds.
3. The **product-hosts split is not implemented on main** (`apps/web/src/server/hosts.ts:11-12` still has two hosts, `pickler.fun`/`app.pickler.fun`), while `TURNKEY_RPID=studio.pickler.fun` is a one-way door that depends on it. `app.pickler.fun` and `studio.pickler.fun` do not resolve, so no studio, sign-in or passkey screen is reachable on any public host.
4. Paid **end-to-end research acceptance is still failed/pending** (`docs/staging-deployment-2026-09-20.md:184-188`, `docs/api-hyperdrive-deployment-2026-09-20.md:47-49`). Trading live acceptance is pending funding and secrets (`docs/polymarket-worker-pilot.md:170-176`). The indexer is not deployed (no contracts).
5. The **design harness** is in CI and green on main (60 routes, 1400 px only, against `next dev` plus a fixture API). Still missing: phone-width checks, visual regression in CI, populated real-data fixtures, a landing product and three-host base URLs. Branch protection is unavailable on this GitHub plan, so nothing makes the checks blocking. Observability means Workers Logs and nothing else: no alerting, no per-IP rate limiting, and 500s are logged without their cause.

## 2. What exists

| Component                                                                                                                 | Spec / doc (file:section)                                                                                                                                 | Implemented on main?                                                                                                                           | Deployed?                                                                                                                                     | Verified remotely?                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Three-layer architecture, Hono composition root                                                                           | `docs/architecture.md:5-16`; root `AGENTS.md` "Architecture invariants"                                                                                   | Yes (`workers/api/src/container.ts`)                                                                                                           | n/a                                                                                                                                           | n/a                                                                                                                                                                                        |
| Web Worker `pickler-web-staging` (OpenNext 1.20.6)                                                                        | `docs/cloudflare-staging.md:9-12`, `:247-271`; `apps/web/AGENTS.md:177-184`                                                                               | Yes: `apps/web/wrangler.jsonc:1-21`, `open-next.config.ts:4-8` (all caches "dummy")                                                            | Staging, on workers.dev and on **`pickler.fun`** (custom domain attached outside the repo, PR #31)                                            | Partly: public pages return 200. `/agents` returns 500 because of API skew (observed 2026-09-30)                                                                                           |
| Workers Builds (Git integration) for the web                                                                              | `docs/cloudflare-staging.md:249-265`                                                                                                                      | Build command documented; the dashboard holds the settings, not the repo                                                                       | Yes, production and preview builds                                                                                                            | Preview build fixed after PR #45 `HOME: unbound variable` (`:261-265`). Which branch auto-deploys is not recorded                                                                          |
| Branch previews (presentation-only)                                                                                       | `apps/web/wrangler.jsonc:16-20`; `docs/cloudflare-staging.md:267-271`                                                                                     | Yes (`previews.services: []`)                                                                                                                  | Yes                                                                                                                                           | No: previews have no API by design                                                                                                                                                         |
| API Worker `pickler-api-staging`                                                                                          | `docs/cloudflare-staging.md:111-160`; `workers/api/AGENTS.md:308-311`                                                                                     | Yes: `workers/api/wrangler.staging.jsonc:1-25`                                                                                                 | Staging. Last recorded version `f684f268…` from `c59d9dd` (`docs/polymarket-worker-pilot.md:185-192`)                                         | 2026-09-20 HTTP checks through the Service Binding (`docs/api-hyperdrive-deployment-2026-09-20.md:36-42`). The current main API is **not deployed** (see gap G1)                           |
| Research Worker `pickler-research-staging` (Queue + Cron, no fetch)                                                       | `workers/research/AGENTS.md:1-19`; `docs/cloudflare-unification.md:85-86`                                                                                 | Yes: `workers/research/wrangler.jsonc:1-34` (concurrency 5, cron every minute, 300 s CPU)                                                      | Staging, `0590242c…` (`docs/polymarket-worker-pilot.md:190`)                                                                                  | Cron reconciliation ok (`docs/api-hyperdrive-deployment-2026-09-20.md:40-41`). **Research acceptance failed/pending** (`docs/staging-deployment-2026-09-20.md:163-188`)                    |
| Trading Worker `pickler-trading-staging`                                                                                  | `docs/polymarket-worker-pilot.md:107-130`; `workers/trading/AGENTS.md`                                                                                    | Yes: `workers/trading/wrangler.jsonc:1-26`                                                                                                     | Staging, `950da5ec…`, admissions false, **no executor secrets** (`docs/polymarket-worker-pilot.md:160-176`)                                   | workers.dev 404 and anonymous 401 only. No live order                                                                                                                                      |
| Indexer Worker `pickler-indexer-staging`                                                                                  | `workers/indexer/AGENTS.md:7-11`; `docs/specs/launchpad-monad-v1.md`                                                                                      | Yes, and it refuses to run without a factory address                                                                                           | **Not deployed.** Its config has no `account_id` and no Hyperdrive (`workers/indexer/wrangler.jsonc:1-21`). `check:staging` does not cover it | No                                                                                                                                                                                         |
| Local API config `pickler-api` (legacy DO `AgentLedger`)                                                                  | `workers/api/AGENTS.md:156-162`, `:306`                                                                                                                   | Yes: `workers/api/wrangler.jsonc:1-41` (dev only; DO legacy)                                                                                   | Local only                                                                                                                                    | n/a                                                                                                                                                                                        |
| Queues `pickler-research-staging`, `pickler-trading-queue-staging`                                                        | `docs/cloudflare-staging.md:114`; `docs/polymarket-worker-pilot.md:110`                                                                                   | Yes (configs)                                                                                                                                  | Staging (created)                                                                                                                             | Yes, created and bound                                                                                                                                                                     |
| Hyperdrive `pickler-database-staging` `05150d06…` (session 5432, verify-full, CA `e1560a68…`, cache off, origin limit 10) | `docs/cloudflare-staging.md:204-211`; root `AGENTS.md` "Hosted database transport"                                                                        | Yes: `src/database.ts` in API and research; two connections per invocation                                                                     | Staging, bound by API, research and trading                                                                                                   | Yes: remote probe with a 352 KB JSONB payload (`docs/staging-deployment-2026-09-20.md:212-217`). API on Hyperdrive since 2026-09-20 (`docs/api-hyperdrive-deployment-2026-09-20.md:17-26`) |
| Supabase project `yvdipvcrpbqvofayteqf` ("pickler", Sherry Labs, us-east-1)                                               | `docs/staging-database-upgrade-2026-09-19.md:3-5`; `docs/architecture.md:56`                                                                              | n/a                                                                                                                                            | Used as **staging** (and in effect as the database behind `pickler.fun`)                                                                      | Migrations 0000–0008 recorded on 2026-09-19 and 11 entries on 2026-09-24 (`docs/polymarket-worker-pilot.md:163-164`). **Through 0022 per owner. Not recorded in any repo doc**             |
| Drizzle migrations 0000–0022, hash-aware migrator                                                                         | `supabase/AGENTS.md:9-26`; `packages/infrastructure/AGENTS.md:370`                                                                                        | Yes (`packages/infrastructure/drizzle/0000…0022`)                                                                                              | See the row above                                                                                                                             | Deploy-order rule: 0022 before API/research (`docs/specs/studio-brief-v1.md:265-268`; `packages/infrastructure/AGENTS.md:61`)                                                              |
| Data API exposure (six product schemas)                                                                                   | `docs/staging-database-upgrade-2026-09-19.md:42-56`; `supabase/AGENTS.md:28-34`                                                                           | Local: `supabase/config.toml:13`                                                                                                               | Hosted: exposed                                                                                                                               | Yes (401 anon / 200 service, 2026-09-19). Now redundant, since "Supabase is auth only" (`workers/api/AGENTS.md:322-332`)                                                                   |
| Supabase Auth (email, Google, callback)                                                                                   | `docs/staging-deployment-2026-09-20.md:41-44`; `docs/specs/product-hosts-v1.md:212-216`                                                                   | Yes                                                                                                                                            | Staging site URL and callback point at the workers.dev web                                                                                    | Password login for one confirmed user (2026-09-20). **Email confirmations status unknown.** Local config has them off (`supabase/config.toml:226`)                                         |
| Product hosts (landing / marketplace / studio)                                                                            | `docs/specs/product-hosts-v1.md:19-27`, `:200-216`                                                                                                        | **No.** `apps/web/src/server/hosts.ts:10-13` has two hosts. `scripts/design/routes.mjs:46` still says `product: "marketplace"` for the landing | Only `pickler.fun` resolves                                                                                                                   | `app.`/`studio.` hostnames do not resolve (2026-09-30)                                                                                                                                     |
| AASA for iOS passkeys                                                                                                     | PR #31; `docs/specs/product-hosts-v1.md:141-157`                                                                                                          | Yes (`apps/web/public/.well-known/…`, `_headers`)                                                                                              | `pickler.fun`                                                                                                                                 | Yes: 200 `application/json` (2026-09-30)                                                                                                                                                   |
| Staging topology check                                                                                                    | root `AGENTS.md` "Cloudflare unification"; `scripts/check-staging.mjs:1-89`                                                                               | Yes: web/api/research/trading, with `--provisioned`                                                                                            | Runs in CI (`.github/workflows/postgres.yml:37`)                                                                                              | Checks identifiers only, not remote state (`docs/cloudflare-staging.md:146-148`)                                                                                                           |
| Worker builds                                                                                                             | `package.json` `build:workers`                                                                                                                            | Yes, all five (web, api, research, trading, indexer)                                                                                           | CI dry run (`postgres.yml:38`)                                                                                                                | n/a                                                                                                                                                                                        |
| CI workflows                                                                                                              | `.github/workflows/*.yml`                                                                                                                                 | format, postgres (lint/type/test/build/check:staging/build:workers), contracts, design                                                         | GitHub Actions                                                                                                                                | All green on `c407fec` except postgres, still running at research time                                                                                                                     |
| Controlled three-Worker suite                                                                                             | `docs/cloudflare-staging.md:37-109`                                                                                                                       | Yes (`workers/research/test/…`)                                                                                                                | Local only, and never against a deployed Worker                                                                                               | Last run for PR #26                                                                                                                                                                        |
| Remote DB diagnostic                                                                                                      | `docs/cloudflare-staging.md:213-233`                                                                                                                      | Yes (`workers/research/test/database-probe.ts`)                                                                                                | Remote preview only, by hand                                                                                                                  | Passed 2026-09-20                                                                                                                                                                          |
| Rollback procedure                                                                                                        | `docs/cloudflare-staging.md:179-195`                                                                                                                      | Documented                                                                                                                                     | n/a                                                                                                                                           | Rollback targets are recorded per deploy, but there is **no verified-good remote agent version** (`docs/staging-deployment-2026-09-20.md:148-150`)                                         |
| Admission switches                                                                                                        | `ADMISSIONS_ENABLED` (`wrangler.staging.jsonc:22`, `research/wrangler.jsonc:32`); `TRADING_ADMISSIONS_ENABLED=false` (`:21`, `trading/wrangler.jsonc:25`) | Yes                                                                                                                                            | Staging: research admissions **true** (operator-approved users), trading false                                                                | Yes (Studio manual-access state, `docs/cloudflare-staging.md:235-245`)                                                                                                                     |
| Schema boundaries (one agent id; `pickler`→`runtime`, `wallets`→`signing`)                                                | `docs/specs/schema-boundaries-v1.md` (whole)                                                                                                              | **No.** Proposal "written to be decided" (`:8-9`); open counter-arguments (`:192-213`)                                                         | n/a                                                                                                                                           | n/a                                                                                                                                                                                        |
| Design harness                                                                                                            | root `AGENTS.md` "Code formatting"; `docs/specs/cleanup-and-design-system-v1.md:70-96`; `docs/specs/design-system-v2.md:311-332`                          | Yes: `scripts/design/*` (60 routes, 20 marketplace + 40 studio; checks source/surfaces/tokens/contrast/type)                                   | CI: `.github/workflows/design.yml:15-51`                                                                                                      | Yes: `rendered` job green on main (run 36680308481, 7m40s). Two earlier PR runs failed at ~43 min                                                                                          |
| Observability                                                                                                             | `workers/*/wrangler*.jsonc` `observability.enabled`                                                                                                       | Workers Logs only                                                                                                                              | Staging                                                                                                                                       | No alerting, tail consumer, Sentry or uptime check anywhere (grep of `apps/web/src`, `workers/*/src`, `packages/*/src`, `docs`)                                                            |
| Rate limiting                                                                                                             | `workers/api/AGENTS.md:98-105`, `:213-220`                                                                                                                | Only the studio preview (5 per hour per owner, `packages/core/src/features/studio/preview.ts:30-32`) and Supabase Auth's own limits            | —                                                                                                                                             | No per-IP or per-route limiting on any public route                                                                                                                                        |
| Backups                                                                                                                   | `docs/staging-database-upgrade-2026-09-19.md:36-38`                                                                                                       | One ad-hoc `pg_dump` at `/tmp/pickler-staging-before-20260919.dump`, local to one machine                                                      | —                                                                                                                                             | No backup policy, PITR statement or restore drill in the repo                                                                                                                              |

## 3. Gaps

**G1 — Deployed backend is 684 commits behind main; web/API skew on the live host.** The last
recorded backend deploy is `c59d9dd` (`docs/polymarket-worker-pilot.md:145-192`, 2026-09-24).
Everything merged since then, including custody/passkeys (#40), user profiles (#42/#61), the studio
brief (#61, migration 0022), the launch catalogue and marketplace-real-data, is not on the staging
API. Evidence on 2026-09-30: `GET https://pickler.fun/api/v1/marketplace/directory`, `/agents`,
`/leaderboard` and `/api/v1/launches` → 404 `Route not found` from Hono, while `/api/v1/health` → 200. `https://pickler.fun/agents` → 500. The marketplace prefix was added on 2026-09-24 23:54 UTC
(`git log workers/api/src/routes/marketplace.ts`), after `c59d9dd`. No deployment record exists
after 2026-09-24. Migrations through 0022 are said to be applied, but no repo record documents it.

**G2 — No production environment is defined.** There is no production Wrangler config, no
`routes`/custom domain in any config, and `scripts/check-staging.mjs:19-21` hard-codes `*-staging`
names. `docs/cloudflare-staging.md:113-114` says "never reuse production identifiers", but no
production identifiers exist. `pickler.fun` is attached to `pickler-web-staging` from the
dashboard (PR #31: "Since `pickler.fun` was delegated to the account that runs
`pickler-web-staging` (2026-09-20 ~22:15 UTC)"). Its backend is therefore the staging API on the
staging Supabase project. `workers/research/AGENTS.md:16` says "Production deployment is outside
this release."

**G3 — The product-hosts split is not built, and the passkey RP depends on it.**
`docs/specs/product-hosts-v1.md:88` fixes `TURNKEY_RPID=studio.pickler.fun` and `:258` calls it a
one-way door "before the first enrolment on any deployed environment". Main still serves the
studio on `app.pickler.fun` (`apps/web/src/server/hosts.ts:12`), with no landing product and no
`hrefFor`. `app.pickler.fun` and `studio.pickler.fun` do not resolve. `pickler.fun/studio` and
`/signin` answer 404 because studio segments are 404 on the marketplace host. So signup, passkey
and studio are not reachable on any public host. The staging API config also carries no
`TURNKEY_*`, `SIWE_DOMAIN`, `WALLET_EMAIL_DOMAIN`, `CHAIN_ID` or `MONAD_RPC_URL`
(`workers/api/wrangler.staging.jsonc:19-24`). `/v1/signing` and `/v1/auth/wallet` are mounted
only when those are bound (`workers/api/AGENTS.md:53-55`;
`docs/specs/user-profiles-and-products-v1.md:577-580`). Signup requires the passkey
(`workers/api/AGENTS.md:60`), so a deploy of main without them breaks signup quietly.

**G4 — Production-readiness checklist items live in three specs and are unverified.** None is covered by a test.

- `TURNKEY_RPID=studio.pickler.fun`, before any enrolment (`product-hosts-v1.md:214`, `:258`; `turnkey-passkey-custody-v1.md:235`, `:260-263`).
- `SIWE_DOMAIN=app.pickler.fun`. `ALLOWED_ORIGINS` needs all three origins (`product-hosts-v1.md:212-213`). Staging holds it as a secret per `cloudflare-staging.md:129`.
- Supabase redirect `https://studio.pickler.fun/auth/callback` only (`product-hosts-v1.md:214-216`).
- **Email confirmations on** in hosted Supabase (`studio-create-and-fund-v1.md:229-236`). Local has them off (`supabase/config.toml:226`); hosted status is unrecorded.
- **The Hyperdrive origin role must read `auth.users` and `auth.identities`** (`user-profiles-and-products-v1.md:590-600`; `workers/api/AGENTS.md:81-85`). No migration grants it. The Hyperdrive origin user is not recorded anywhere, and without the grant the wallet-account verdict fails at run time.
- `NEXT_PUBLIC_MARKETPLACE_HOST` / `NEXT_PUBLIC_STUDIO_HOST` set in the **Workers Builds build environment** (`user-profiles-and-products-v1.md:552-571`). "Not yet confirmed against a production build" (`:565`). A landing-host variable does not exist yet.
- `wallet.pickler.fun` must never get MX records (`user-profiles-and-products-v1.md:612-619`).
- Apply 0022 before deploying the API or research (`studio-brief-v1.md:265-268`).
- Secrets per destination (`cloudflare-staging.md:126-133`) plus the Turnkey pair, `ENCRYPTION_KEY`, `MODEL_*` for the drafter (`workers/api/AGENTS.md:204-210`) and Polymarket executor secrets (`polymarket-worker-pilot.md:117-120`).
- Admission flags: research `true` in the committed staging configs, which also admits any due schedules (`cloudflare-staging.md:237-240`). Trading `false`.

**G5 — Paid acceptance is not complete anywhere.** Research: both manual slots were consumed by
failures, and the scheduled slot was never run (`staging-deployment-2026-09-20.md:184-188`). A
transport fix was deployed afterwards, but "manual/manual/scheduled acceptance remains pending a new
explicit allowance" (`:245-247`). Browser session-lifecycle acceptance on HTTPS is separate and
also pending (`:187-188`). Trading: no Deposit Wallet, CLOB credentials, approvals or funding
(`polymarket-worker-pilot.md:170-176`). Hosted authenticated trading walkthrough pending (`:170-172`).

**G6 — Documentation drift in platform docs.**

- `docs/cloudflare-unification.md:7` ("does not claim a deployed staging environment") and `:11` (DATABASE_URL through the pooler) predate the deployments and Hyperdrive.
- `docs/architecture.md:52` ("No blockchain SDK or RPC provider has been provisioned") and `:56` ("Servers reach it with a server-only secret key, through tables or security definer functions") contradict "Supabase is auth only" (`workers/api/AGENTS.md:322-332`).
- `docs/cloudflare-local-validation.md:1` calls itself "before the removal of Hyperdrive", but Hyperdrive is current.
- `supabase/AGENTS.md:28-30` still justifies Data API exposure "so the service role can read them over PostgREST", which the API no longer does.
- The `wallets` schema (`schema-boundaries-v1.md:21`) appears in no Data API or ops doc.

**G7 — Observability and error handling.**

- Workers Logs (`observability.enabled`) is the only telemetry.
- The API logs a 5xx as `[traceId] METHOD path HTTP 500` without the error class or cause (`workers/api/src/http/error-handler.ts:140-141`). A hosted 500 such as today's `/agents` cannot be diagnosed from logs.
- There are no alerts on Cron/Queue failure, dead letters or DB errors, and no uptime check.
- The Queue consumer has `max_retries: 3` and no dead-letter queue (`workers/research/wrangler.jsonc:22-23`; `workers/trading/wrangler.jsonc:18-19`).
- `/health` checks liveness only (`workers/api/src/app.ts:44-45`).
- The web error boundary and the OpenNext logs are not wired anywhere.

**G8 — Security items still open.**

- `POST /v1/auth/wallet/nonce` is public with no per-client cap. It is bounded per address (5) and by purge batches, but an attacker rotating addresses can grow `identity.siwe_nonces` (the nonce flood). The fix is blocked on a hashed-IP column (`workers/api/AGENTS.md:98-105`).
- Other unauthenticated writes have no rate limit either: waitlist, applications, handle availability, `wallet/verify`.
- `POST /v1/studio/agents/draft` calls the model on every request and has no limit (`workers/api/AGENTS.md:204-210`).
- No Cloudflare WAF or rate-limiting rule is recorded.
- The Supabase config has no captcha (`supabase/config.toml:214` commented out) and no custom SMTP (`:237` commented out). Default Supabase SMTP is not production-grade for email OTP.
- The six product schemas remain exposed through the Data API although no server path uses it (G6).
- Durable Object `AgentLedger` legacy data is retained, and reconciliation is still required before switching authority (`docs/cloudflare-unification.md:72-79`).

**G9 — Backups and recovery.** One manual dump on one laptop's `/tmp`
(`docs/staging-database-upgrade-2026-09-19.md:36-38`). There is no documented Supabase plan,
PITR, retention, restore test or pre-migration backup step in `cloudflare-staging.md`
"Deployment order" (`:142-156`). Only `docs/frontend-integration.md:55` says "use a backup for any
non-disposable database".

**G10 — Deploys are manual and unrecorded as a pipeline.** Backends are deployed by hand with
`wrangler deploy --config …`. The web deploys automatically through Workers Builds with settings
held in the Cloudflare dashboard. No workflow deploys, no job checks the deployed version against
main, and no job runs migrations. The ordering constraints (0022 before API/research; consumer →
API → web, `cloudflare-staging.md:150`) depend on the operator following them. The auto-built web
can outrun the hand-deployed API, which is G1.

**G11 — Design harness: what "adjusting the harness" still needs.**

- **Phone widths are not checked.** The rendered checks run at 1400×1000 only (`scripts/design/lib/render.mjs:308`). 390×844 exists only in `shots` (`scripts/design/shots.mjs:17-18`), which is not a default check (`scripts/design/run.mjs:19`) and not in CI.
- **No visual regression in CI.** `compare.mjs` exists but "judges nothing … always exits 0" (`scripts/design/compare.mjs:4-7`). Screenshots are gitignored (`.gitignore:27-28`), so there is no baseline and no CI artifact beyond `servers.log` (`design.yml:46-51`).
- **The marketplace is measured on sample data.** `fixture-api.mjs` serves `createSampleMarketBoard`, `createSampleLandingReadModel` and harness fixtures (`scripts/design/fixture-api.mjs:43-48`, `:86-122`), and every response is labelled `x-pickler-data-source: sample`. `marketplace-real-data-v1.md:186-195` records the lost coverage (populated leaderboard, token price, profile record) and proposes a harness-only seed against the test database, deliberately deferred.
- **No real-data or empty-state fixture set.** A route that renders its empty state against the real API is not measured. The harness always runs with Supabase switched off (`scripts/design/lib/servers.mjs` `webEnv`), so authenticated real states are unreachable.
- **Three hosts.** The landing route is still `product: "marketplace"` (`scripts/design/routes.mjs:46`), although `product-hosts-v1.md:208-209` requires `"landing"`. `render.mjs` would then need a third base URL.
- **Dev server, not the Worker.** The harness measures `next dev` (`scripts/design/lib/servers.mjs:159`), not the OpenNext build that ships. `apps/web/AGENTS.md:63` says the final deployment must be tested under OpenNext/workerd.
- **Known unmeasured states:** `/apply` with a seat, `/agents/[handle]/ask` steps 2–3, `/reads` and `/activity` past the connect gate, and the trading panel inside `limits` (`docs/specs/cleanup-inventory-2026-09-29.md:1586-1590`; parts were closed by #64).
- **Not blocking.** Branch protection returns HTTP 403 "Upgrade to GitHub Pro or make this repository public" (`gh api …/branches/main/protection`), so a red Design job cannot block a merge. It relies on the "never merge without authorization" rule in root `AGENTS.md`.
- **Runtime.** The `rendered` job has a 45-minute timeout and took about 7.5 minutes on green. Two earlier PR runs ran ~43 minutes and failed.

**G12 — Schema boundaries undecided.** `schema-boundaries-v1.md` is a decision document. Its three
counter-arguments (`:196-210`) are unanswered, and it blocks nothing but touches 70 SQL call sites
(`:162-174`).

**G13 — Indexer and chain.** The indexer config has no `account_id`, no Hyperdrive and no factory
address (`workers/indexer/wrangler.jsonc:12-20`). `check:staging` does not cover the indexer, and
public RPC is the only endpoint configured (`RPC_URLS=https://testnet-rpc.monad.xyz`).

## 4. Specs to write

**S1 — Production environment and domains v1.**

- **Scope:** define production as distinct from staging. Cover Worker names and configs (a `wrangler.production.jsonc` per Worker, or Wrangler environments), the Cloudflare account, and a separate production Supabase project or an explicit decision to promote `yvdipvcrpbqvofayteqf`.
- Custom domains for `pickler.fun`, `app.pickler.fun` and `studio.pickler.fun` as `routes` in config, not dashboard-only.
- A dedicated production Hyperdrive and CA, production Queues, and `check:production`.
- What happens to `pickler.fun` currently pointing at `pickler-web-staging`.
- **Depends on:** product-hosts implementation (S3); owner decisions Q1–Q3.

**S2 — Release pipeline and deployment records v1.**

- **Scope:** one ordered, reproducible release from an identified commit: backup, then migrate (0022-style gates), then consumer → trading → API → web.
- A version-skew guard: the web's Workers Builds deploy is gated on, or pinned to, the deployed API's contract.
- A deployment ledger file per environment (commit, Worker versions, migration head) replacing ad-hoc dated docs.
- A post-deploy smoke list (anonymous GETs such as `/api/v1/health`, `/api/v1/marketplace/directory` and `/agents` → 200; auth 401s).
- Rollback that respects migration compatibility.
- Whether deploys move into GitHub Actions with Cloudflare API tokens, or stay operator-run.
- **Depends on:** S1; the owner's choice on CI deploy credentials.

**S3 — Three-host split implementation (build of `product-hosts-v1.md`).**

- **Scope:** `hosts.ts` with a landing product, `hrefFor`, the middleware rules, AASA `applinks`, and `NEXT_PUBLIC_*_HOST` in the build environment (verify the built edge chunk).
- `SIWE_DOMAIN`, `ALLOWED_ORIGINS`, `TURNKEY_RPID` and the Supabase redirect set per environment.
- The harness's third product and base URL.
- Probably owned by the identity area. Listed here because deployment is blocked on it and the RPID is one-way.
- **Depends on:** DNS for the two subdomains; S1.

**S4 — Production readiness checklist and verifier v1.**

- **Scope:** one canonical checklist, merging `user-profiles-and-products-v1.md` §14, `product-hosts-v1.md` §6/§8, `studio-create-and-fund-v1.md` (confirmations) and `cloudflare-staging.md` secrets.
- For each item, a machine check where possible: a script that reads the deployed Worker's bindings by name (never values) through the Cloudflare API, and queries `has_table_privilege(<hyperdrive role>, 'auth.users', 'SELECT')` and `auth.identities` over an operator connection.
- It also confirms the Supabase Auth settings (confirmations on, redirect list, SMTP, captcha) through the Management API, and the migration head.
- **Depends on:** S1; knowing the Hyperdrive origin role (Q4).

**S5 — Observability and incident response v1.**

- **Scope:** structured JSON logs with request id, error class and normalized cause, without secrets, for API 5xx and the web error boundary.
- Workers Logs retention, or Logpush to a sink.
- Alerts on Cron/Queue failures, Queue backlog, DB `CONNECTION_LOST`/`QUERY_TIMEOUT` rates, Turnkey `activity_rejected` and trading reconciliation stalls.
- Dead-letter queues for research and trading.
- A readiness endpoint that checks the DB through Hyperdrive, separate from liveness.
- External uptime checks for the three hosts.
- An on-call and runbook page that links the admission kill switches.
- **Depends on:** S1 (which environments); the owner's tooling budget (Q6).

**S6 — Abuse controls for public routes v1.**

- **Scope:** per-client limits on `wallet/nonce` (hashed `CF-Connecting-IP` column plus per-IP cap, closing the nonce flood), `wallet/verify`, waitlist, applications, handle availability, `studio/agents/draft` (model cost) and `preview-runs`.
- Implement with Cloudflare Rate Limiting bindings or WAF rules, or a PostgreSQL counter.
- Supabase captcha and custom SMTP for email OTP.
- Un-exposing the six product schemas from the Data API now that the API uses PostgreSQL directly.
- **Depends on:** S1 (WAF is per zone); identity area for the nonce table migration.

**S7 — Backup, restore and data retention v1.**

- **Scope:** Supabase plan and PITR for each environment, and a mandatory pre-migration backup step in the release pipeline, stored somewhere other than a laptop's `/tmp`.
- A quarterly restore drill into a disposable project.
- Retention for runs, evidence, preview runs (24 h visibility), nonces and audit.
- Handling of legacy Durable Object ledger data (`cloudflare-unification.md:72-79`).
- **Depends on:** S1; the owner's plan choice (Q5).

**S8 — Design harness v3 (coverage, widths, regression).**

- **Scope:** run surfaces, tokens, contrast and type at 390 as well as 1400. Add a visual-regression job that stores a baseline and diffs PRs, uploads the diff as an artifact and fails above a noise threshold, reusing `compare.mjs` and its `--noise` format.
- A harness-only seed that renders marketplace routes from the real API over a seeded test database (`marketplace-real-data-v1.md:194`), next to the sample fixture, so both populated and empty states are measured.
- Remaining unmeasured states (G11); the landing product and three base URLs.
- Optionally a smoke pass against the OpenNext build (`wrangler dev`).
- A decision on how checks become blocking without branch protection: a GitHub plan upgrade, a required-status bot, or a merge checklist.
- **Depends on:** S3 (hosts); marketplace real-data work for the seed; owner decision Q7.

**S9 — Acceptance runs v2 (research and trading).**

- **Scope:** a new explicit allowance and procedure for the pending manual/manual/scheduled research acceptance on the current main, and the hosted browser session-lifecycle acceptance.
- The trading pilot's funded single purchase, recorded in the S2 ledger format.
- **Depends on:** G1 closed (current code deployed); owner authorization for paid calls and funding.

**S10 — Schema boundaries decision record.** Not a new spec: a one-page decision appended to
`schema-boundaries-v1.md` answering its three counter-arguments (`:196-210`). It must land before
any production data exists, because renames on a live database cost more. **Depends on:** the
runtime owner's answer about product-independent runtime use.

## 5. Open questions for the owner

1. **Is `pickler.fun` production today?** It is served by `pickler-web-staging` against the staging API and Supabase. Should it be taken down or pointed at a landing until production exists?
2. Is **`yvdipvcrpbqvofayteqf` staging or production**? Will production get its own Supabase project, Cloudflare account and Hyperdrive?
3. Which branch do Workers Builds auto-deploy for `pickler-web-staging`, and should the web auto-deploy at all while backends are deployed by hand (the cause of today's `/agents` 500)?
4. Which Postgres role is the Hyperdrive origin user? Has it been granted `SELECT` on `auth.users` and `auth.identities`? Is there a record that 0022 is applied to the hosted database, and who applied it and when?
5. What Supabase plan is the project on, and are daily backups or PITR enabled? Where should pre-migration dumps live?
6. What budget and tooling for observability is acceptable: Workers Logs only, Logpush, or a third-party service?
7. Should design checks be blocking? That needs a GitHub plan upgrade or a public repository for branch protection. Otherwise, what is the substitute?
8. Are hosted email confirmations on, and is custom SMTP configured? Google OAuth is mentioned in plans; is it configured on the hosted project?
9. Should deploys move into GitHub Actions (Cloudflare API token as a repo secret), or remain operator-run with a ledger?
10. When is the next paid acceptance allowance for research and the funded trading purchase, and who authorizes it?

## 6. Sources read

- `AGENTS.md` (root); `supabase/AGENTS.md`; `workers/api/AGENTS.md`; `workers/research/AGENTS.md`; `workers/trading/AGENTS.md`; `workers/indexer/AGENTS.md`; `apps/web/AGENTS.md` (deploy/harness lines via grep)
- `docs/architecture.md`; `docs/cloudflare-unification.md`; `docs/cloudflare-staging.md`; `docs/cloudflare-direct-validation.md`; `docs/cloudflare-local-validation.md`; `docs/staging-deployment-2026-09-20.md`; `docs/api-hyperdrive-deployment-2026-09-20.md`; `docs/staging-database-upgrade-2026-09-19.md`; `docs/polymarket-worker-pilot.md` (§ staging resources, acceptance, 2026-09-24 record)
- `docs/specs/schema-boundaries-v1.md`; `docs/specs/product-hosts-v1.md` (§1, §6–§9); `docs/specs/user-profiles-and-products-v1.md` §14; `docs/specs/studio-create-and-fund-v1.md:222-240`; `docs/specs/studio-brief-v1.md:258-268`; `docs/specs/cleanup-and-design-system-v1.md` §3.4–§6; `docs/specs/marketplace-real-data-v1.md` §5; `docs/specs/cleanup-inventory-2026-09-29.md` §6 (grep); `docs/specs/design-system-v2.md` (grep)
- `apps/web/wrangler.jsonc`; `apps/web/open-next.config.ts`; `workers/api/wrangler.jsonc`; `workers/api/wrangler.staging.jsonc`; `workers/research/wrangler.jsonc`; `workers/trading/wrangler.jsonc`; `workers/indexer/wrangler.jsonc`; `turbo.json`; `package.json` scripts; `supabase/config.toml` (grep)
- `.github/workflows/{contracts,design,format,postgres}.yml`; `scripts/check-staging.mjs`
- `scripts/design/{run,routes,fixture-api,compare,shots}.mjs`; `scripts/design/lib/{servers,render}.mjs` (parts)
- `workers/api/src/app.ts:39-70`; `workers/api/src/http/error-handler.ts:125-155`; `apps/web/src/server/hosts.ts:10-13`; `packages/core/src/features/studio/preview.ts:29-32`
- `gh run list` (Design and main); `gh api repos/…/branches/main/protection` (403); `gh pr view 31`; `docs/product-map/research/_prs.txt`
- Anonymous HTTP GETs on 2026-09-30: `pickler.fun` (`/` 200, `/agents` 500, `/tokens` 200, `/studio`, `/signin` and `/console` 404, AASA 200, `/api/v1/health` 200, `/api/v1/marketplace/{directory,agents,leaderboard}` and `/api/v1/launches` 404); `pickler-web-staging.gilbertsahumada.workers.dev` 200; `app.pickler.fun` and `studio.pickler.fun` do not resolve.
