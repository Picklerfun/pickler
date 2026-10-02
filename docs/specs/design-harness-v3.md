# Design harness v3

Status: Draft — decided autonomously 2026-09-30. Every decision is reversible. Follows
`docs/product-map/conventions.md`. Continues `docs/specs/design-system-v2.md` (the harness as it is)
and `docs/specs/cleanup-and-design-system-v1.md` §3.4–§6.

Research this builds on: `docs/product-map/research/06-platform.md` G11 and S8.

---

## 1. Problem and users

The harness (`scripts/design/*`) is in CI and green on main: 60 routes, static source check plus
four rendered checks (surfaces, tokens, contrast, type) against `next dev` and a fixture API
(`.github/workflows/design.yml:15-51`; root `AGENTS.md:79`). "Adjusting the harness" next means
closing the gaps between what it measures and what ships:

- **One width.** The rendered checks run at 1400×1000 only (`scripts/design/lib/render.mjs:308`,
  `eachRoute(…, { width = 1400, height = 1000 })`). 390×844 exists only in `shots`
  (`scripts/design/shots.mjs:17-20`), which is not a default check (`scripts/design/run.mjs:19`) and
  not in CI. Most people will open the marketplace on a phone.
- **No visual regression that can fail.** `compare.mjs` "judges nothing … always exits 0"
  (`scripts/design/compare.mjs:4-7`), screenshots are gitignored (`.gitignore:27-33`), and CI keeps
  only `servers.log` on failure (`design.yml:46-51`).
- **Sample data only.** The fixture API serves `createSampleMarketBoard`,
  `createSampleLandingReadModel` and harness fixtures, labelled `x-pickler-data-source: sample`.
  `marketplace-real-data-v1.md:186-195` records the lost coverage (a populated leaderboard, a token
  with a price, a profile with a record) and proposes a harness-only seed, deliberately deferred.
- **Two products, soon three hosts.** The landing is still `product: "marketplace"`
  (`scripts/design/routes.mjs:43-51`), and `render.mjs` knows two base URLs
  (`render.mjs:34-38`). `product-hosts-cutover-v2.md` adds the landing.
- **`next dev`, not the Worker.** The harness launches `next dev -p 3001`
  (`scripts/design/lib/servers.mjs:159-162`); what ships is the OpenNext bundle on workerd
  (`apps/web/AGENTS.md:63`). Host routing, `run_worker_first` and build-time `NEXT_PUBLIC_*`
  inlining are only real in the built Worker.
- **Not blocking.** Branch protection answers HTTP 403 on this GitHub plan (research 06 G11), so a
  red Design job cannot stop a merge.
- **New states from tonight's specs** (degraded marketplace reads, rate-limited forms) need a way to
  be rendered: the fixture API has no failure mode.

Users: anyone changing `apps/web` or `packages/ui` (agents included), the owner reviewing a PR, and
the people on phones who currently get whatever 1400 px happened to leave.

---

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                             | Reason                                                                                                                                                                                                                                                                   | Reversible? |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| V1  | **Every rendered check runs at two sizes**, desktop 1400×1000 and phone 390×844, from one shared `scripts/design/lib/sizes.mjs` (the `SIZES` now private to `shots.mjs:17-20`). `DESIGN_SIZES=desktop` or `phone` narrows a local run.                                                                                                                               | A token or contrast failure that only appears in the phone layout is still a failure.                                                                                                                                                                                    | Yes         |
| V2  | A new rendered check **`layout.mjs`** for phone-specific failures: horizontal overflow (`scrollWidth > innerWidth` on `html` fails), interactive targets smaller than 24×24 CSS px fail (WCAG 2.2 AA 2.5.8), smaller than 44×44 warn, text below 12 px fails.                                                                                                        | These are the failures a phone shows that the four token/type checks do not look for.                                                                                                                                                                                    | Yes         |
| V3  | **Visual regression baselines are CI artifacts from `main`, not committed images.** Each `main` run uploads `design-shots-<sha>`; a PR compares its screenshots with the artifact of the **PR's base SHA** (`github.event.pull_request.base.sha`). If that artifact is missing or expired, the job captures the base itself (checkout base, capture, checkout head). | Committed PNGs (60 routes × 2 widths, full page) add megabytes to every UI PR, conflict as binaries and are already gitignored on purpose. The base SHA — not "latest main" — is what the PR's merge ref was built on, so unrelated main changes never show up as diffs. | Yes         |
| V4  | **A difference fails the PR unless the PR carries the label `design:intended`.** Without it, any screen above tolerance fails the `visual` job. With it, the job passes but posts the list of changed screens and uploads the before/after/diff images as an artifact.                                                                                               | `compare.mjs` refused to judge because only the author knows whether a change was meant (`compare.mjs:4-7`). A label makes the author say so, visibly and reviewably, instead of silently.                                                                               | Yes         |
| V5  | Tolerance: a screen differs when more than 0.1 % of its pixels change **or** any connected changed region exceeds 400 px². Per-route overrides via `visual: { tolerance }` in `routes.mjs`. Known moving screens are listed in a committed `scripts/design/noise.txt` in `compare.mjs`'s existing `--noise` format.                                                  | Small enough to catch a moved button, large enough to ignore antialiasing. The noise format already exists.                                                                                                                                                              | Yes         |
| V6  | **Three data modes**: `DESIGN_DATA=sample` (today's fixture API, default), `seed` (the real API Worker over a local Postgres seeded with a deterministic dataset), `empty` (the real API over a migrated, empty database).                                                                                                                                           | `sample` keeps the whole-app coverage it gives today; `seed` measures populated real screens; `empty` measures what a person sees at launch (`marketplace-real-data-v1.md:186-190`).                                                                                     | Yes         |
| V7  | The fixture API gains a **failure switch** (`POST /__fixture/fail`, `/__fixture/reset`) and routes gain `fixture: { fail: { path, status } }`, so degraded and rate-limited states are rendered.                                                                                                                                                                     | `production-environment-v1.md` §0.1 and `operations-v1.md` §7 add states that only exist when a dependency fails.                                                                                                                                                        | Yes         |
| V8  | **Three products, three base URLs**: `landing` joins `BASE_FOR` (`DESIGN_LANDING_URL`). A **split-host mode** (`DESIGN_HOSTS=split`) starts the web with `NEXT_PUBLIC_{LANDING,MARKETPLACE,STUDIO}_HOST=landing.localhost,app.localhost,studio.localhost`, which Chromium resolves to loopback, and measures each route on its own host.                             | Measures the real middleware decisions (404s, 308s, rewrites) locally, with no DNS.                                                                                                                                                                                      | Yes         |
| V9  | **A `worker` job measures the OpenNext build** on workerd through `wrangler dev` with a harness config `apps/web/wrangler.harness.jsonc`. It runs on pushes to `main`, nightly, and on PRs that touch the web build surface. It records bundle size and fails above 9 MiB compressed.                                                                                | The dev server is not what ships; build-time host inlining and `run_worker_first` are only real in the Worker. Running it on every PR would double CI time for a rarely-changing surface.                                                                                | Yes         |
| V10 | **Merges are gated by a merge workflow, not branch protection**: `/merge` (a PR comment by the owner) runs `merge-gate.yml`, which merges with `gh pr merge --match-head-commit` only when every check in `.github/required-checks.json` is green on the head SHA. A `post-merge-audit.yml` on `main` flags any merge that bypassed it.                              | Branch protection and rulesets need a paid plan for a private repository (403 today). This makes the safe path the easy path and makes the unsafe one visible. Upgrading the plan remains the real fix (§12 Q1).                                                         | Yes         |
| V11 | Each workflow ends with one aggregate job named `gate` (`needs:` every other job, `if: always()`, fails if any need failed or was cancelled). `.github/required-checks.json` lists gates, not individual jobs.                                                                                                                                                       | One status per workflow is what a merge gate (or a future branch protection rule) should read; adding a job does not change the list.                                                                                                                                    | Yes         |

---

## 3. User flows

### 3.1 An agent changes a component and opens a PR

1. `Design / source` and the harness unit tests run as today.
2. `Design / rendered (desktop)` and `Design / rendered (phone)` run in parallel, each starting its
   own servers, each running surfaces, tokens, contrast, type and (phone only) layout, then
   capturing screenshots.
3. `Design / visual` downloads `design-shots-<base.sha>`, compares, and finds `agents-phone.png`
   changed by 2.3 %. The PR has no `design:intended` label, so it fails with:
   `CHANGED agents-phone.png 2.30% (region 612×88 at 0,410) — add the label design:intended if this is on purpose`.
   The diff images are in the `design-visual-diff` artifact.
4. The agent looks, confirms the change is intended, and the owner (or the agent, when the task
   was a visual change) adds the label. The job re-runs green and comments the changed-screens list.
5. `Design / gate` is green.

### 3.2 The owner merges

The owner comments `/merge` on the PR. `merge-gate.yml` checks that the commenter is in
`deploy/operators.txt` (shared with `production-environment-v1.md` §3.1), reads
`.github/required-checks.json`, looks up check runs for the head SHA, and either merges
(`gh pr merge <n> --squash --match-head-commit <sha>`) or replies with the list of missing or red
gates. A push after the comment changes the head SHA, so the merge refuses rather than merging
untested code.

### 3.3 Someone merges from the GitHub UI anyway

`post-merge-audit.yml` runs on the push to `main`, finds the PR for the merge commit, and checks the
required gates on the PR's last head SHA. If any was not green, it opens an issue
"Merged without green gates: #<n>" listing them, labelled `audit`, and (once `operations-v1.md`
alerting exists) sends it to the alert webhook.

### 3.4 A developer measures a populated leaderboard locally

`npm run db:up && DESIGN_DATA=seed node scripts/design/run.mjs tokens` — the runner migrates the
local database, applies the seed, starts the API Worker locally over it and the web over that API,
and measures. `DESIGN_ROUTES=leaderboard` narrows it (`scripts/design/lib/only.mjs`).

---

## 4. API

Harness-only HTTP, served by `scripts/design/fixture-api.mjs` on `127.0.0.1:8799`. Not part of
the product API and never deployed.

| Method | Path               | Request                                                  | Response              | Notes                                                                                                    |
| ------ | ------------------ | -------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| POST   | `/__fixture/fail`  | `{ "path": "/v1/marketplace/directory", "status": 503 }` | 204                   | Every later request whose path starts with `path` answers `status` with the error envelope, until reset. |
| POST   | `/__fixture/reset` | —                                                        | 204                   | Clears all failures.                                                                                     |
| GET    | `/__fixture/state` | —                                                        | `{ failures: [...] }` | For the report.                                                                                          |

`render.mjs` calls `fail` before a route that declares `fixture.fail` and `reset` after it,
including on error. The endpoints exist only when `fixture-api.mjs` is started by the harness; the
module refuses to bind any address other than loopback.

### 4.1 Degraded and empty states (new routes in `routes.mjs`)

| Route name                                                                                                     | Path                                                                | Mode / fixture                                                          | `proves`                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| `agents-degraded`                                                                                              | `/agents`                                                           | `fixture: { fail: { path: "/v1/marketplace/directory", status: 404 } }` | `[data-degraded="true"]`            |
| `leaderboard-degraded`                                                                                         | `/leaderboard`                                                      | fail `/v1/marketplace/leaderboard` 503                                  | `[data-degraded="true"]`            |
| `agents-empty`                                                                                                 | `/agents`                                                           | `DESIGN_DATA=empty` only                                                | the directory's empty-state hook    |
| `leaderboard-populated`                                                                                        | `/leaderboard`                                                      | `DESIGN_DATA=seed` only                                                 | a leaderboard row hook              |
| `token-priced`                                                                                                 | `/tokens/<seed ticker>`                                             | `seed` only                                                             | the price element hook              |
| `profile-record`                                                                                               | `/agents/<seed handle>`                                             | `seed` only                                                             | the record/hit-rate hook            |
| `connect-rate-limited`                                                                                         | `/portfolio?state=…`                                                | fail `/v1/auth/wallet/nonce` 429                                        | the rate-limited message hook       |
| `draft-rate-limited`                                                                                           | `/studio/new`                                                       | fail `/v1/studio/agents/draft` 429 (`DRAFT_RATE_LIMITED`)               | the draft rate-limited message hook |
| `waitlist-rate-limited`                                                                                        | `/`                                                                 | fail `/v1/waitlist` 429; `act` submits the form                         | the waitlist inline error hook      |
| `apply-with-seat`, `ask-step-2`, `ask-step-3`, `reads-connected`, `activity-connected`, `limits-trading-panel` | as listed in `docs/specs/cleanup-inventory-2026-09-29.md:1586-1590` | existing `?state=` parameters or `act` clicks                           | each screen's own hook              |

Degraded routes cover both failure classes `production-environment-v1.md` §0.1 degrades on: a 404
(skew) and a 503 (outage). Every rate-limited state `operations-v1.md` §7 lists has a route.

Routes gain an optional `modes: ["sample"] | ["seed"] | ["empty"] | …` (default `["sample"]`), so a
route runs only in the data modes where its screen can exist. The hooks named "the … hook" are added
to the components in the PR that adds the route, following `routes.mjs`'s `proves` rule
(`routes.mjs:6-10`).

### 4.2 Three hosts

- `routes.mjs`: the landing route becomes `product: "landing"` (`routes.mjs:43-51`); the header
  comment (`routes.mjs:32-38`) describes three products.
- `render.mjs`: `BASE_FOR` gains `landing: process.env.DESIGN_LANDING_URL ?? BASE`
  (`render.mjs:34-38`); `isLoopback` accepts `*.localhost`.
- `servers.mjs`: with `DESIGN_HOSTS=split`, `webEnv` sets the three `NEXT_PUBLIC_*_HOST` values to
  `landing.localhost`, `app.localhost`, `studio.localhost`, and the runner sets
  `DESIGN_{LANDING,MARKETPLACE,STUDIO}_URL=http://<host>:3001`. Without it, all three stay on one
  base URL, as today.
- A new check **`hosts.mjs`** (split mode only): for every route, a request on each **other** host
  must answer 404, except marketplace routes on the landing host, which must answer 308 to the
  marketplace host (`product-hosts-cutover-v2.md` H4). It also requests
  `/.well-known/apple-app-site-association` on each host and expects, following
  `product-hosts-cutover-v2.md` H8/H9: 200 with `applinks` on the marketplace; 200 with
  `webcredentials` only on the landing when the run sets `AASA_ON_LANDING=true` (the 90-day window),
  404 otherwise; 404 on the studio always; 200 on `either` (localhost).

---

## 5. Data model and migrations

No product migration. The `seed` and `empty` modes use the local PostgreSQL from `compose.yaml`
(port 55432, `npm run db:up`) and the repository's migrator (`npm run db:migrate` with
`DATABASE_MIGRATION_URL`).

**Seed dataset** — `scripts/design/seed/dataset.mts`, applied by `scripts/design/seed/apply.mts`
(`npm run design:seed`):

- Deterministic: fixed UUIDs, a fixed clock (`2026-09-15T12:00:00Z`), no randomness.
- Content: 12 public agents with profiles and accents, one of them with a launched token and a
  price history; 40 resolved decisions across them (hits, misses, abstentions) so the leaderboard,
  hit rate and calibration have rows; 6 reads; 3 markets; one agent in `draft` (must not appear).
- Written through `packages/infrastructure` repositories where a repository exists, raw SQL only
  for tables no repository writes yet. The seed is test data for a test
  (`marketplace-real-data-v1.md:192-195`), never loaded into a hosted database: `apply.mts` refuses
  any `DESIGN_DATABASE_URL` whose host is not loopback, like `PICKLER_API_LOCAL_URL`
  (`apps/web/src/server/api-client.ts:12-18`).
- `empty` mode runs the migrator and applies nothing.

**Local API for `seed`/`empty`**: `wrangler dev --config workers/api/wrangler.jsonc --port 8798
--var APP_ENV:local --var DATABASE_URL:postgresql://…@127.0.0.1:55432/…` (the local config already
allows a loopback `DATABASE_URL`, `workers/api/src/env.ts:12-13`). The web's
`PICKLER_API_LOCAL_URL` points at 8798 instead of the fixture's 8799.

**Baselines** (V3): artifact `design-shots-<sha>` = `desktop/*.png`, `phone/*.png`, and
`manifest.json` (`{ sha, routes, sizes, data: "sample", capturedAt }`). Retention 30 days, the
maximum useful for a PR's base. `visual` falls back to capturing the base when the artifact is gone.

---

## 6. Integrations

### 6.1 Workflow changes (`.github/workflows/design.yml`)

```yaml
jobs:
  source: # unchanged (design.yml:15-26)
  rendered:
    strategy:
      fail-fast: false
      matrix:
        size: [desktop, phone]
    timeout-minutes: 30 # was 45 (design.yml:33); the two green runs took ~7.5 min
    env:
      DESIGN_SIZES: ${{ matrix.size }}
    steps:
      # checkout, node, npm ci, build:shared, playwright (design.yml:34-44)
      - run: npm run design:check # surfaces, tokens, contrast, type (+ layout on phone)
      - run: DESIGN_SHOTS_DIR=scripts/design/.shots/${{ matrix.size }} npm run design:shots
      - uses: actions/upload-artifact@v4
        with:
          name: design-shots-${{ matrix.size }}-${{ github.sha }}
          path: scripts/design/.shots/${{ matrix.size }}
          retention-days: 30
  visual:
    if: github.event_name == 'pull_request'
    needs: rendered
    # download this run's shots and the base SHA's shots (actions/download-artifact@v4 with
    # run-id + github-token for the base run), then:
    # node scripts/design/compare.mjs base head --noise scripts/design/noise.txt --fail-above 0.001
    #   --region 400 $([ has label design:intended ] && echo --report-only)
  rendered-seed:
    services:
      postgres: # same image and port as compose.yaml
    # DESIGN_DATA=seed, then DESIGN_DATA=empty; desktop and phone; routes with those modes only
  gate:
    if: always()
    needs: [source, rendered, visual, rendered-seed]
    # fail when any needs.*.result is failure or cancelled
```

- `compare.mjs` gains `--fail-above <ratio>`, `--region <px²>` and `--report-only`. Without the new
  flags it behaves exactly as today (exit 0), so manual use is unchanged.
- The server start in each matrix leg is independent; the two legs do not share ports because they
  run on different runners.
- The `split`-host run (`hosts.mjs`) is a step in the desktop leg after the checks, restarting the
  web with `DESIGN_HOSTS=split`.

### 6.2 New workflow `design-worker.yml` (V9)

Triggers: `push` to `main`, `schedule` nightly 02:00 UTC, and `pull_request` with `paths:`
`apps/web/next.config.*`, `apps/web/open-next.config.ts`, `apps/web/wrangler*.jsonc`,
`apps/web/src/middleware.ts`, `apps/web/src/server/hosts.ts`, `apps/web/public/**`,
`package-lock.json`.

Steps: build shared and `npm run build:worker --workspace=@pickler/web` with the three
`NEXT_PUBLIC_*_HOST` values set to the `*.localhost` names; record the compressed size of
`.open-next/worker.js` plus its chunks in the job summary and fail above 9 MiB; start the fixture API
and `wrangler dev --config apps/web/wrangler.harness.jsonc --port 3002`; run surfaces, tokens and
`hosts.mjs` against it with `DESIGN_HOSTS=split`; grep the built output for the three host literals
(the check `production-environment-v1.md` §4.3 calls `build.hosts`).

`apps/web/wrangler.harness.jsonc` differs from the deployed config in three ways, each commented in
the file: no `global_fetch_strictly_public` (it would refuse the loopback fixture API), no service
bindings, and `vars.PICKLER_API_LOCAL_URL=http://127.0.0.1:8799`. That is the whole deviation from
production, and it is why this job does not replace the staging smoke test.

### 6.3 New workflows for merging (V10)

- `merge-gate.yml`: `on: issue_comment` (created), runs only when the body is exactly `/merge` on a
  PR. Permissions `contents: write`, `pull-requests: write`, `checks: read`. Steps: verify commenter
  in `deploy/operators.txt`; read head SHA; for each entry in `.github/required-checks.json`
  (`["Design / gate", "CI / gate", "Format / gate", "Contracts / gate"]`, names finalised when the
  gates exist), require a `success` check run on that SHA; merge with `--match-head-commit`; comment
  the result.
- `post-merge-audit.yml`: `on: push` to `main`; `gh api repos/{repo}/commits/{sha}/pulls` to find
  the PR; check the gates on its head SHA; open an `audit` issue if any was not green.
- Root `AGENTS.md` "Branch and pull request workflow" gains: "Merge with `/merge`; a merge from the
  UI is audited." (Documentation change in the same PR as the workflows.)

### 6.4 Tools

Playwright stays global on the runner, never in `package.json` (root `AGENTS.md:79`;
`design.yml:28-30`). `wrangler` and `workerd` come from the existing lockfile. No new dependency.

---

## 7. Design work

The harness has no screens of its own. What it needs from design:

| Item                                                       | Surface                      | Canvas                                                                                                                |
| ---------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Phone layouts for every route already in `routes.mjs`      | all                          | exist for the marketplace pages in the canvases; studio phone layouts must be drawn where `layout.mjs` finds overflow |
| Degraded line on marketplace lists                         | marketplace                  | new small state (`production-environment-v1.md` §7)                                                                   |
| Rate-limited states (connect, draft, waitlist)             | marketplace, studio, landing | new states (`operations-v1.md` §7)                                                                                    |
| Populated leaderboard, priced token, profile with a record | marketplace                  | canvases exist (`marketplace-real-data-v1.md` §5 lists them); now measured                                            |

When `layout.mjs` first runs on phone, expect failures on existing screens. The PR that turns it on
lands it in **report mode** (`--strict` off for `layout` only) with the failure list attached, and
a follow-up PR per surface fixes them; `--strict` is turned on when the list is empty.

---

## 8. Security and abuse

- The fixture control endpoints bind loopback only and exist only in the harness process.
- The seed refuses non-loopback databases (§5); CI's Postgres is a service container with
  disposable credentials.
- `merge-gate.yml` trusts only commenters in `deploy/operators.txt`, a file changed by PR like any
  code. It uses `GITHUB_TOKEN` with the minimum permissions above; no personal token.
- `issue_comment` workflows run with the default branch's workflow file, so a PR cannot change the
  gate that judges it.
- Artifacts contain screenshots of fixture and seed data only — never a hosted environment.

---

## 9. Acceptance criteria and tests

1. `scripts/design/sizes.test.mjs`: `DESIGN_SIZES` parsing; unknown size refuses with exit 2.
2. `scripts/design/layout.test.mjs`: a fixture page with an overflowing element fails; a 20×20
   button fails; a 30×30 button warns; a clean page passes.
3. `compare.test.mjs` gains: `--fail-above` exits 1 on a changed pair and 0 on an identical pair;
   `--report-only` always exits 0 but prints `CHANGED`; a screen in `noise.txt` within its noise
   size prints `NOISE` and does not fail.
4. `fixture-api` tests: `fail` then a request answers the status with the error envelope; `reset`
   restores; the server refuses a non-loopback bind.
5. `hosts.test.mjs`: the expected-status table for split mode, over the `decide` function's cases in
   `product-hosts-cutover-v2.md` §9.
6. CI: a PR that changes one colour token without the label fails `visual` and passes after the label
   is added; the `gate` job reflects both.
7. `merge-gate.yml` dry run (`workflow_dispatch` with `dry_run: true`) reports "would merge" for a
   green PR and lists the red gate for a red one; a push after `/merge` makes it refuse.
8. The `rendered` matrix completes in under 15 minutes per leg on a green run.

---

## 10. Rollout and dependencies

1. `sizes.mjs` and phone runs of the existing four checks (V1) — may surface failures; fix or record.
2. `layout.mjs` in report mode (V2), then strict.
3. `gate` jobs in every workflow and `required-checks.json` (V11); `merge-gate.yml` and
   `post-merge-audit.yml` (V10).
4. Shots artifacts on `main` (V3), then the `visual` job (V4, V5) once two `main` runs have produced
   a `noise.txt`.
5. Fixture failure switch and degraded routes (V7) — with `production-environment-v1.md` §0.1.
6. Landing product and split-host mode (V8) — with `product-hosts-cutover-v2.md` §5.
7. Seed and empty modes (V6) — after the marketplace real-data endpoints exist.
8. `design-worker.yml` (V9) — after the cutover code lands, since its main value is checking hosts
   and `run_worker_first` in the real Worker.

Depends on: `product-hosts-cutover-v2.md` (landing product, AASA handler), `production-environment-v1.md`
(degraded state, `build.hosts`, `deploy/operators.txt`), `operations-v1.md` (rate-limited states,
alert webhook for the audit).

---

## 11. Out of scope

- Screenshots or checks against a deployed environment (staging or production); that is the smoke
  list's job (`production-environment-v1.md` §3.6).
- Authenticated real states (a real Supabase session in the harness). The preview fixtures and the
  name-only session cookie (`render.mjs:40-48`) remain the way in.
- Cross-browser runs (WebKit, Firefox). Chromium only, as today.
- Replacing the harness with a hosted visual-testing service.

---

## 12. Open questions for the owner

1. **Upgrade the GitHub plan (Pro or Team) so branch protection works?** It is the real fix for
   blocking merges; V10 is the workaround until then. If yes, the same `gate` checks become required
   status checks and `merge-gate.yml` becomes optional.
2. Who besides you may add the `design:intended` label — any agent doing a visual task, or only you?
3. Should the phone checks block merges from day one, or stay in report mode until the existing
   screens are fixed (the decided default)?
