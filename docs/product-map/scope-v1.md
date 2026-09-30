# Pickler scope v1: the master map

Status: internal draft, 2026-09-30. Written for the owner and for the engineers and agents who build
Pickler next. It summarises; the specs decide. Where this file and a spec disagree, the spec wins and
this file is wrong. Where two specs disagree, this file says so (§9.4) instead of choosing silently.

Sources, all on branch `codex/product-scope-map` (none of the 2026-09-30 specs is on `main` yet):

- `docs/product-map/conventions.md` (the products-and-wallets rule, decisions 1–17, API conventions),
  shortened to CONV below.
- `docs/product-map/cross-review.md` (XR) and research files `docs/product-map/research/01`–`06`
  (R01–R06).
- The 19 specs written on 2026-09-30, with the short names used throughout:

| Short | File                                      | Area                       |
| ----- | ----------------------------------------- | -------------------------- |
| PE    | `docs/specs/production-environment-v1.md` | platform                   |
| PHC   | `docs/specs/product-hosts-cutover-v2.md`  | hosts and identity         |
| OPS   | `docs/specs/operations-v1.md`             | platform                   |
| DH    | `docs/specs/design-harness-v3.md`         | design                     |
| DR    | `docs/specs/decision-resolution-v1.md`    | decisions and record       |
| PR    | `docs/specs/public-record-v1.md`          | decisions and record       |
| SDR   | `docs/specs/studio-decision-review-v1.md` | studio                     |
| GP    | `docs/specs/go-public-v1.md`              | studio                     |
| PRD   | `docs/specs/paid-reads-v1.md`             | paid reads                 |
| FORK  | `docs/specs/fork-agent-v1.md`             | studio                     |
| PERPL | `docs/specs/perpl-live-v1.md`             | trading venues             |
| PAR   | `docs/specs/perpl-agent-runtime-v1.md`    | trading venues and runtime |
| LD    | `docs/specs/launchpad-deploy-v1.md`       | launchpad                  |
| TL    | `docs/specs/token-launch-v1.md`           | launchpad                  |
| TT    | `docs/specs/token-trading-v1.md`          | launchpad                  |
| MW    | `docs/specs/marketplace-wallets-v1.md`    | marketplace wallets        |
| MB    | `docs/specs/mobile-backend-v1.md`         | mobile                     |
| RR2   | `docs/specs/research-runtime-v2.md`       | research runtime           |
| CUST  | `docs/specs/custody-v2.md`                | custody                    |

The foundation specs they build on are on `main`: `studio-create-and-fund-v1`, `studio-brief-v1`,
`turnkey-passkey-custody-v1` (TPC1), `user-profiles-and-products-v1`, `product-hosts-v1`,
`marketplace-real-data-v1`, `launchpad-monad-v1`, `agent-runtime-v1`, `design-system-v2`,
`cleanup-and-design-system-v1` and the undecided proposal `schema-boundaries-v1`.

---

## 1. What Pickler is

Pickler is a place where people build AI agents that research markets and make calls, and where
everyone else can watch those calls, follow the agents that are right, buy an agent's answer to their
own question, and trade a token tied to the agent.

### 1.1 Three products, four surfaces

| Product     | Host / surface                                                                      | Who uses it                                    | Wallet                                                                                           |
| ----------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Landing     | `pickler.fun` (web)                                                                 | anyone arriving; waitlist and "Build an agent" | none                                                                                             |
| Marketplace | `app.pickler.fun` (web)                                                             | followers, read buyers, token traders          | **Mera** (passkey wallet), or an injected EOA (MetaMask etc.) for people who do not want Mera    |
| Marketplace | mobile app, React Native, separate repository (TestFlight bundle `fun.pickler.app`) | the same people on a phone                     | **Mera only**; no EOA                                                                            |
| Studio      | `studio.pickler.fun` (web)                                                          | agent owners (builders)                        | **Turnkey** passkey custody: a master wallet, one wallet per agent, and a delegated Pickler user |

The rule (CONV "Products and wallets"): Turnkey never appears in the marketplace, and Mera never
appears in the studio. A marketplace account is a Supabase user created by wallet sign-in (SIWE),
whichever wallet signed. Pickler's own backend keys (the read treasury, the launch authority) live in
Turnkey's parent organisation; no marketplace user ever signs with or sees Turnkey (XR V2, still to be
written into CONV, §9.4).

### 1.2 The core loop

```
 studio (owner, Turnkey)                                   marketplace (everyone, Mera / EOA)
 ─────────────────────────                                 ───────────────────────────────────
 1 build: brief → paper preview → draft (private)
 2 Go Public: voice, Connect X, wallet + caps, fund  ───►  agent page appears, "Follow"
 3 runs on a schedule: research → decision
      │ (TRADE or ABSTAIN; paper, later live on Perpl)
      ▼
 4 resolution job: what actually happened ──────────────►  public record: receipts, hit rate,
   (append-only, scored, private until resolved)           calibration, leaderboard, activity
 5 read service: price, clock, markets  ────────────────►  buy a read: pay AUSD, private answer on
                                                           clock 1, scored on clock 2, refunded on a miss
 6 launch its token (public agents only, once) ─────────►  trade on the bonding curve, then the pool
 7 earnings: read payouts and token fees → master wallet
```

1. **Build.** The owner writes a brief (thesis, reads, entry and exit rules, never-rules, caps), runs
   it on paper, and creates a private draft (`studio-brief-v1`).
2. **Go Public.** Four required steps (Voice, Connect X, Its wallet, Fund it) and an optional Reads
   step flip the agent from private to public (GP D3, D15). Only public agents can sell reads or
   launch a token (CONV 4, 5).
3. **Research and decide.** Runs research markets in the agent's scope (Polymarket sports today; crypto
   up/down next, then Perpl perps) and end in a decision (RR2 R7; PAR).
4. **Resolve.** Every decision resolves (CONV 2): a job records what happened from the venue's own
   settlement (Polymarket CTF payout; Perpl mark price at the horizon) and scores it (DR).
5. **Publish.** A decision becomes public only when it resolves (CONV 1; PR P1). Until then the market
   sees a count and a sealed commitment. Resolved decisions feed receipts, the record, the leaderboard
   and the activity feed (PR).
6. **Sell reads.** A buyer pays the agent's price in AUSD on Monad for a fresh, private answer to one
   question, delivered within the delivery clock and scored on the 24-hour resolution clock. A missed
   clock refunds automatically (PRD; CONV 3, 10, 11).
7. **Trade the token.** The owner of a public agent may launch its token once, with a launch grant
   signed by Pickler (CONV 5; LD; TL). Anyone trades it on the bonding curve, and it graduates to a
   locked Uniswap V4 pool (TT).

### 1.3 Chains and money

- **Monad** (testnet 10143 first; mainnet 143) carries AUSD, reads, token launches, Perpl and agent
  wallets. **Polygon** is read only, for Polymarket resolution (DR D2).
- Money is integers in micro-units (`*_micro_ausd`, `*MicroAusd`); provider costs are micro-USD
  (RR2 departure, XR C15). Idempotency keys on every POST that moves money or creates something (CONV).

---

## 2. State today (2026-09-30)

### 2.1 Live, and the open incident on `pickler.fun`

`pickler.fun` is served by the **staging** web Worker `pickler-web-staging`, auto-built from `main` by
Workers Builds, with the custom domain attached in the Cloudflare dashboard (PR #31;
`docs/cloudflare-staging.md:247-259`). The backends were last hand-deployed on 2026-09-24 from
`c59d9dd` (`docs/polymarket-worker-pilot.md:185-192`).

| Worker (staging)           | Version                    | Notes                                                                       |
| -------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `pickler-web-staging`      | auto-built from `main`     | serves `pickler.fun` and its workers.dev URL                                |
| `pickler-api-staging`      | `f684f268…` from `c59d9dd` | ~684 commits behind `main` (R06 G1); no Turnkey, SIWE, chain or model vars  |
| `pickler-research-staging` | `0590242c…`                | `ADMISSIONS_ENABLED=true`                                                   |
| `pickler-trading-staging`  | `950da5ec…`                | Polymarket pilot; admissions false, no signer secrets, no account, no order |
| `pickler-indexer-staging`  | not deployed               | inert without a factory address; no Hyperdrive binding in its config        |

**Incident (PE §0).** `/agents`, `/leaderboard` and `/markets` answer HTTP 500; `/`, `/tokens` and
`/api/v1/health` answer 200. Cause: version skew. The web from `main` calls `/v1/marketplace/*`, which
the 2026-09-24 API does not have (404 `Route not found`, `workers/api/src/app.ts:42`); `apiJson` throws
on any non-2xx (`apps/web/src/server/api-client.ts:45-49`) and the error boundary renders 500.
`/tokens` survives because `listLaunches` already maps 404 to `null`
(`apps/web/src/server/container.ts:24-36`).

- **Interim fix (PE §0.1, web only):** `apiRead(path, empty)` returns the designed empty state with
  `degraded: true` on 404/5xx for public reads, and a "The board is catching up" line
  (`data-degraded="true"`). Private screens still fail loudly.
- **Real fix (PE §0.2):** deploy API, research and trading from `main` in **Step A** now, without the
  Turnkey and SIWE variables (so no one-way RP decision is made), and **Step B** with the host cutover
  (`TURNKEY_RPID=studio.pickler.fun`, `SIWE_DOMAIN=app.pickler.fun`).
- Two cautions before Step A (§9.4 items 19 and 22): `main` may already answer `/v1/health` through the
  growth routes, and deploying research from `main` with staging `ADMISSIONS_ENABLED=true` admits due
  schedules and spends provider money.

`app.pickler.fun` and `studio.pickler.fun` do not resolve. The studio is unreachable on any public
host (`/studio` → 404 on `pickler.fun`, because `hosts.ts:11-12` still puts the studio on
`app.pickler.fun`). No passkey has been enrolled anywhere; `/v1/signing/*` and `/v1/auth/wallet/*`
are unmounted on every hosted environment.

### 2.2 Database

- One hosted Supabase project, `yvdipvcrpbqvofayteqf` ("pickler", us-east-1), serves staging and in
  practice production. **Migrations 0000–0022 are applied and were verified by hash on 2026-09-29**
  (PR #61). The database is ahead of the deployed API, so Step A needs no migration (PE §0).
- Schemas today: `pickler`, `agents`, `audit`, `budget`, `growth`, `identity`, `internal`, `launch`,
  `market`, `wallets`, plus `pickler_migrations`. RLS is on everywhere.
- Gaps (R06 §2): six product schemas are exposed through the Data API; the Auth site URL points at
  workers.dev; no custom SMTP or captcha; the Hyperdrive origin role and its `auth.users` grant are
  unrecorded; the only backup is one local dump from 2026-09-19.
- Until the owner chooses (§9.1 Q-ENV-1), PE D3 treats this project as production for data safety.

### 2.3 Built on `main` but not deployed

Everything below is merged (latest merge PR #64, `c407fec`, 2026-09-30) and runs locally or in CI,
but the deployed backends predate it.

| Area            | What exists                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace API | `/v1/marketplace/*` over Postgres (`PostgresAgentDirectory`), with honest empties for record fields; landing and `/markets` are still sample data; `/v1/demo` alias still mounted (`app.ts:68`)                                 |
| Launch read API | `/v1/launches`, `/:id`, `/:id/trades` (`workers/api/src/launches/routes.ts:21-47`); no writers                                                                                                                                  |
| Studio          | brief, preview runs (`pickler.preview_runs`, 0022), private drafts, create-and-fund ceremony, deposits, paper orders and manual settle, schedules, 13 sections (`workers/api/src/routes/studio.ts`, 34 handlers)                |
| Custody         | Turnkey sub-org per person, passkeys, master and agent wallets, delegated user with DENY policies (`signing.ts:293-511`); never run against real Turnkey                                                                        |
| Wallet auth     | SIWE nonce/verify/link/links (`wallet-auth.ts:77-126`), mounted only when `SIWE_DOMAIN` and `WALLET_EMAIL_DOMAIN` are set                                                                                                       |
| Trading         | Polymarket paper (deployed in the old build too); Polymarket live pilot in `workers/trading`, closed; perps paper simulator (0012–0014); Perpl market data, CLI only (12-request cap)                                           |
| Launchpad       | seven contracts in `contracts/src`, 107 offline and 11 fork tests, **not deployed anywhere** (`contracts/script/` is empty); `launch` schema (0015–0016); indexer runs the factory stream only, no projector in production code |
| Web             | `/tokens` reads real launches ("Nothing has been indexed yet"); Mera signer removed in PR #64 (injected EOA only); follows in `localStorage`; read "Pay" disabled                                                               |
| Design          | design-system-v2 tokens (`--pk-*`), harness with 60 routes at 1400 px, CI green                                                                                                                                                 |

### 2.4 Local only

- `apps/agent-service`: Mastra Studio at 127.0.0.1:4111 and the laboratories (Jev, BTC benchmarks,
  perps study, NFL evaluations). CONV 8 keeps them experiments.
- The local `pickler-api` Wrangler config (legacy `AgentLedger` Durable Object) and the controlled
  three-Worker suite.
- The TestFlight app (`2PBQJ37Q8W.fun.pickler.app`, builds 5 and 6, RP `pickler.fun`) exists, but its
  source is not in this repository and its owner is unknown (MB §1; §9.1 Q-MOB-1).

### 2.5 Only specified

Everything in the 19 specs above: production environment, release pipeline and ledger, ops Worker,
jobs Worker, treasury Worker, the three-host cutover, resolution and the public record, decision
review, Go Public, forks, paid reads, research budgets and calendars, Perpl paper and live trading,
launchpad deployment, token launch and trading, web Mera, mobile backend, custody v2. None of it is
code yet. `workers/jobs`, `workers/ops` and `workers/treasury` do not exist.

---

## 3. The map, area by area

Each area lists what exists (with code pointers), the specs that define the missing part, the key
decisions, and the open risks. Decision ids are the specs' own (`GP D3`, `PRD R13`, …).

### 3.1 Platform and operations

**Exists.** Five Worker configs, all staging or local (`apps/web/wrangler.jsonc`,
`workers/api/wrangler.staging.jsonc`, `workers/research/wrangler.jsonc`,
`workers/trading/wrangler.jsonc`, `workers/indexer/wrangler.jsonc`); `scripts/check-staging.mjs`;
Hyperdrive `pickler-database-staging` (session pooler 5432, verify-full, cache off); queues
`pickler-research-staging`, `pickler-trading-queue-staging` (no DLQs). No production config, no
release pipeline, no ledger, no alerting, no rate limits beyond preview runs
(`packages/core/src/features/studio/preview.ts:25-32`), and 5xx errors are logged without a cause
(`workers/api/src/http/error-handler.ts:140-141`).

**Specs.** PE (production, release, ledger, verifier, the whole binding/cron/queue inventory), OPS
(logs, `workers/ops`, alerts, rate limits, DLQs, backups, operator CLI).

**Key decisions.**

- Production is a second set of Workers in the same Cloudflare account, `pickler-<name>-production`,
  for eight Workers: web, api, research, trading, indexer, **treasury, jobs, ops** (PE D1).
- `main` deploys staging automatically; production deploys only a SHA already `ok` on staging, by
  `workflow_dispatch`; Workers Builds keeps previews only (PE D6, D7).
- Release order: backup → migrations → ops → trading → treasury → research → api → indexer → jobs →
  readiness → web → smoke → ledger (PE D8). Ops goes first because every Worker names it as tail
  consumer.
- Ledger: append-only JSONL on the orphan branch `ops/ledger` (PE D9). Readiness verifier
  `scripts/check-readiness.mjs` with ~30 items, secrets checked by name only (PE D10, §4.3).
- Separate production Supabase project recommended (PE D3, §5.1 option B); dedicated DB role
  `pickler_app` (D11); all admission flags start closed in production (D12).
- Scheduled work has two homes: product jobs in `workers/jobs`, platform housekeeping in
  `workers/ops`; resolution stays in `workers/research`; the API has no crons (CONV 15).
- One JSON log format; every 5xx logs its cause; `workers/ops` is the tail consumer, groups errors in
  Postgres and sends email/webhook alerts (OPS O1–O4). OPS §6.2 is the alert-rule registry (XR W6).
- Rate limits: Cloudflare `ratelimits` bindings (`RL_AUTH`, `RL_PUBLIC`, `RL_FORMS`, `RL_MODEL`,
  `RL_MONEY`) plus exact Postgres counters for anything that costs money; OPS §4.1 is the table of
  record (OPS O6, XR C16); the SIWE nonce cap is `client_hash` under `RATE_LIMIT_SALT` (OPS O7,
  CONV 16).
- Resend on `mail.pickler.fun` for Auth SMTP and all transactional mail (OPS O9, XR W7).
- Nightly `age`-encrypted dump of **every** Drizzle-owned schema to R2, `reads` first, plus a monthly
  restore drill (OPS O11, CONV 17).
- Operators reach service-binding-only routes through `npm run ops -- call`, signed with Ed25519 and
  forwarded by `https://ops.pickler.fun/__operator` (OPS §4.3, XR E2).

**Open risks.** Supabase project choice blocks production (Q-ENV-1). PE's own inventory contradicts
itself in places (delegated key on two Workers, jobs heartbeats without a database, treasury
self-check without a cron; §9.4 item 18). The job/queue homes conflict with MB and CUST (§9.4 item 1).
Step A would start staging research with admissions open (§9.4 item 22).

### 3.2 Hosts and identity

**Exists.** Host routing in `apps/web/src/middleware.ts:41-106` and `apps/web/src/server/hosts.ts`
with two products (marketplace, studio) and wrong fallbacks (`hosts.ts:11-12`: marketplace
`pickler.fun`, studio `app.pickler.fun`). The AASA is a static file on every host
(`apps/web/public/.well-known/apple-app-site-association`). Studio identity is Supabase Auth (email
OTP, Google, X) plus a Turnkey passkey (TPC1); marketplace identity is SIWE into a Supabase user
(`user-profiles-and-products-v1`). `product-hosts-v1` decided three hosts but was never built.

**Specs.** PHC (build the three hosts and cut over), PE §0.2 (Step A / Step B), MW (wallet links),
MB (app contract and universal links).

**Key decisions.**

- Three hosts, one web Worker; `Product = landing | marketplace | studio | either`; a deployed build
  refuses to compile without the three host variables (PHC H1–H3).
- Old marketplace links on `pickler.fun` answer 308 to `app.pickler.fun` (PHC H4).
- **One-way doors:** `TURNKEY_RPID=studio.pickler.fun` (PHC H5) and Mera's RP `app.pickler.fun` on web
  and phone (PHC H6, MW D3). Neither can move after the first passkey. `SIWE_DOMAIN=app.pickler.fun`,
  `WALLET_EMAIL_DOMAIN=wallet.pickler.fun` with a null MX (PHC H7).
- AASA and `assetlinks.json` become route handlers, 200 on the marketplace only, with
  `run_worker_first` (PHC H8). The apex keeps serving `webcredentials` for 90 days after the cutover
  so the app can offer "Move your funds" (PHC H9, CONV 14, MB M13).
- Staging hosts `stg.`, `app-stg.`, `studio-stg.pickler.fun` with their own RPs (PHC H11).
- The cutover is ordered and rehearsed on staging first: DNS → web with hosts → Supabase Auth config →
  `auth.users` grant → API Step B (door opens) → verifier → owner's first passkey, recorded as
  `rpid-committed` → iOS build → apex AASA off at day 90 (PHC §10.1).

**Open risks.** The combined runbook opens the door on the staging Workers that serve `pickler.fun`
today, which contradicts the staging RP rule and PE §5.1 (§9.4 item 20). The 90-day window starts at
PHC step 2, while the app build (step 8) waits on the app's source (§9.4 item 21). The app's source
and key model are unknown (Q-MOB-1, Q-MOB-2).

### 3.3 Studio

**Exists.** `/studio` with 13 sections (7 real, 6 "Soon" panels) and `/studio/new`
(`cleanup-and-design-system-v1`); brief editor and `assertBrief`; preview runs, 5 per hour; drafts
(max 3 per workspace, `status 'draft'`, private) (`studio-brief-v1`, `studio.ts:279-506`); the
create-and-fund ceremony (wallet, policies, link, agent, first paper run; 10 AUSD funding lock)
(`studio-create-and-fund-v1`, `studio.ts:426-615`); a Go Public card whose steps all say "Soon"
(`go-public.tsx:6-11`). `/studio/new` inserts `active`, so those agents are public at once
(`directory.ts:151-153`).

**Specs.** GP (Go Public, Identity, Public profile, Audience, X, caps), FORK (start from a ranked
agent), SDR (Decisions and Record sections, owner reviews), plus the studio parts of PRD (Reads
section), TL (Token section), PERPL and PAR (Perpl card and brief), RR2 (research spend, schedule v2)
and CUST (Wallets, withdraw, send, security, privacy).

**Key decisions.**

- Publication is a `visibility` column plus `published_at`, separate from lifecycle `status`; every
  new agent starts private; existing non-draft agents (killed ones included, per the SQL) are
  backfilled public (GP D1, D2; XR C14).
- Go Public = Voice, Connect X, Its wallet, Fund it (≥ 10 AUSD), with Reads optional; one
  transactional `publish` call re-checks every step; no unpublish in v1 (GP D3, D14–D16).
- Voice is one of six presets and never enters the decision prompt (GP D4, D5).
- Connect X verifies by a post containing a `pk-` code read with the app bearer token; posting is a
  separate optional OAuth grant, through a rate-limited outbox (1 per 30 min, 10 per day) (GP D6–D8).
- Caps have two layers: per trade as a Turnkey ALLOW on on-chain venues, per day in the trading
  worker; on Perpl both are Pickler's. Raising caps needs a root-stamped ceremony (GP D11–D13).
- The handle is fixed once public; avatars use TL's media store (GP D17, D18).
- Forks copy exactly the five brief sections from a public, opted-in agent; no live link, no royalty
  in v1, permanent attribution (FORK F1–F12).
- Picks becomes **Decisions** (list and nine-block detail) plus a **Record** section; owner reviews
  (`wrong`/`right`/`unsure`, tags, note) never change the record (SDR R1–R7).
- Jev and the benchmarks stay experiments; a future reviewer model plugs in behind a
  `DecisionReviewer` port and may only annotate (CONV 8, SDR R8–R9).

**Open risks.** Connect X needs an X developer account on the paid Basic tier (Q-PUB-1, blocking).
GP D2's prose still says "non-killed" while its SQL includes killed agents (§9.4 item 15). GP's
`PUBLISH_BLOCKED` lists a `FIRST_RUN` blocker no flow defines (§9.4 item 35).

### 3.4 Decisions and the public record

**Exists.** `pickler.runs.decision` is stored and never read again (`schema.ts:58`). Paper settlement
reads the CTF payout on a finalized Polygon block, manually (`paper-resolution.ts:22-140`,
`studio.ts:663`). The marketplace adapter hard-codes `resolved: 0`, `hitRate: null`, `net: 0` and an
empty leaderboard (`agent-directory.ts:122-125`, `:233-253`). `agentScore` exists
(`reads.ts:158-167`). Brier and calibration exist only in the laboratories. Following is
`localStorage` only (`following.ts:6-16`); `/activity` is gated and empty.

**Specs.** DR (enrolment, resolution, scoring, records, exit monitor, price observations), PR (what
becomes public, when, and through which routes; follows; activity; receipts; perps board), SDR (the
owner's view).

**Key decisions.**

- Every completed run with a decision is enrolled in `pickler.decisions`, whatever its trigger; failed
  and preview runs never are (DR D1).
- The only authority is the Polymarket CTF payout on a finalized Polygon block; Gamma only says when
  to look (DR D2, D3). Perpl decisions resolve on the Perpl mark at `decided_at + horizon` (PAR A8).
- Brier `(p−y)²`; calibration gap = ECE over 10 buckets; virtual P&L = 1 AUSD per TRADE at the ask;
  fractional payouts are `void` (DR D4–D6).
- Resolutions are append-only by `(run_id, revision)`; later revisions only by an operator with a
  reason (DR D7, irreversible).
- `agent_records` has two scopes, `owner` and `public`, recomputed from scratch per agent (DR D8);
  rank-eligible at ≥ 20 scored decisions, ≥ 5 resolved trades, a decision in 30 days (D9).
- Resolution runs on a second `*/5` cron in `workers/research` (DR D10); exits of open paper positions
  are checked every 30 minutes from `workers/jobs` with a small no-search model call (D13, D14).
- **Audience** is `public`, `owner` or `buyer`; paid-read runs are enrolled as `buyer`, scored, never
  published, counted only in the owner scope (DR D16, CONV 10).
- DR owns `PriceObservationSource`: Polymarket CLOB price history or Perpl mark at a target time,
  ±5 min; "Pons" is retired (DR D17, CONV 13). Late live P&L goes to append-only
  `pickler.decision_live_pnl` (DR D15, §5.7).
- Content is public only when resolved or void **and** `audience = public`; before that, a count and
  sealed commitments (time plus hash, written at enrolment) (PR P1, DR D12). Passes are published like
  calls (PR P2). A fixed allow-list projection; exact brief lines are scrubbed from model text (P3, P4).
- `agents.public_activity` is written inside the resolution transaction; follows are server-side,
  keyed to the marketplace user id; `/activity` becomes public; `/receipts/[publicId]` is canonical
  (PR P5–P8).
- The perps board reads real Perpl data on `PERPL_BOARD_NETWORK` (PR P9). New routes use the envelope;
  old `/v1/marketplace/*` routes switch with the web, before the app's first public build (PR P10,
  XR C9).

**Open risks.** The first hand check against Polygonscan (DR acceptance 17) gates every public number.
`decision_live_pnl` has two shapes (DR vs PERPL, §9.4 item 5). Three of DR's alerts are not registered
in OPS (§9.4 item 25). The schema-boundaries decision (Q-ENV-6) would rename `pickler` to `runtime`
and change `agent_id` types before any of these tables exist.

### 3.5 Paid reads

**Exists.** The read is modelled in core and DTOs (`reads.ts:5-62`, `api-schema/src/agents.ts:98-136`)
but nothing persists it: `listReads` returns `[]`, `getRead` returns `null`
(`agent-directory.ts:277-284`); `/agents/[handle]/ask` renders but "Pay" is disabled
(`ask-flow.tsx:185-205`).

**Spec.** PRD, with RR2 (read lane, `reads` budget scope), DR (outcome port, `audience = buyer`), PR
(outcome cards in activity), MW and MB (who pays), OPS (limits, email).

**Key decisions.**

- Only a public, non-killed agent sells reads; price 1–100 AUSD in 0.50 steps, set by the owner in the
  studio's **Reads** section (PRD R1, R2; CONV 4).
- **Two clocks.** Clock 1, delivery: 10, 15, 30, 60 or 120 minutes; a miss refunds automatically.
  Clock 2, resolution: fixed at 24 hours after delivery (PRD R3, R4).
- Payment is a plain AUSD `transfer` on Monad to the Pickler read treasury, verified at `finalized`;
  an intent binds payer, exact amount and start and lives 15 minutes; a `(tx, log)` is claimed once
  (PRD R7–R9; CONV 3). Escrow is v2.
- No email needed to buy; every read event is an in-app notification; an optional verified receipt
  email lives in `identity.notify_emails` and is never a login (PRD R11, XR X1).
- Pickler's fee is 10%; Pickler pays the research behind a read out of it, with a per-read compute
  ceiling of min(10% of price, 2 AUSD) (PRD R12, R13; CONV 11).
- The answer is private to the buyer, always. Only an outcome card (question, called side, result,
  clocks met) may be public, after resolution, if the buyer chose it (PRD R14; CONV 10).
- Evaluation uses DR's `PriceObservationSource`: strictly above the reference = happened (PRD R15).
- Automatic full refunds for five reasons; payouts daily at 00:30 UTC to the owner's master wallet,
  payable at delivery + 24 h, minimum 5 AUSD (PRD R16, R17).
- The treasury is a Pickler parent-org Turnkey wallet signed only by `workers/treasury`, policy-limited
  to AUSD transfers ≤ 1000, gated by `TREASURY_SENDS_ENABLED`; a double-entry append-only ledger in
  schema `reads`, reconciled daily (PRD R18, R20).

**Open risks.** Regulation, tax and sanctions block mainnet (Q-PAY-1/2/3). Cheap reads cannot fit a
run under their ceiling and RR2 expects PRD to refuse them at purchase, which PRD does not (§9.4
item 12). Reads run one at a time per agent while capacity allows 200 a day on a 10-minute clock
(§9.4 item 13). Email ownership is still split (§9.4 item 14).

### 3.6 Trading venues, including Perpl

**Exists.** Polymarket paper trading in the studio (`studio.ts:684-708`); the Polymarket live pilot in
`workers/trading` (≤ 5 pUSD per order, 10 pUSD lifetime, closed, no secrets on staging;
`workers/trading/src/index.ts:24-64`); the perps paper simulator (`conservative-1x-v1`, 1x, 1 000
virtual AUSD; migrations 0012–0014); Perpl public market data from the CLI only (12-request cap,
`packages/infrastructure/src/perpl/transport.ts:65`). The studio refuses Perpl (`SOON_VENUES`,
`packages/core/src/features/studio/draft.ts:10`). No venue is allowed in any agent wallet policy
(`VENUE_CONTRACTS = []`, `agent-wallet-policies.ts:28`). PRs #60 and #63 (book-before-ticker reads,
guarded 20 s acquisition) are open; #63's stability probe failed and needs a rerun.

**Specs.** PAR (the `perps-direction-v1` protocol and paper first), PERPL (live Perpl), GP (caps,
venue manifest), CUST (withdraw legs), DR (resolution).

**Key decisions (PAR).**

- The model decides `{instrument, action, probability, horizonHours, stopLossBps?, takeProfitBps?,
rationale}`; code does entry, sizing and exits (PAR A1). BTC and ETH only (A2).
- Horizon 4, 24 or 72 hours, default 24; it is both the scoring clock and the maximum hold (A3).
  `close` and `hold` are not scored (A7).
- Margin = `perCallAusd × f`, f = 1.0 at p ≥ 0.65, 0.5 at p ≥ 0.55, else ABSTAIN `LOW_CONVICTION` (A6).
- **Paper first, always**, on the existing 1x simulator; live agents keep a paper shadow (A9). Perpl
  leaves "Soon" for paper when RR2 R9 passes, behind `PERPL_PAPER_ENABLED` (A11).
- A hosted Perpl data session in `workers/research`: 40 requests, 20 s per run (A12). Default cadence
  every 4 hours (A13). Paper exits every minute from `workers/jobs` (A14).
- Live eligibility: a public agent with ≥ 5 resolved paper decisions (A15).

**Key decisions (PERPL).**

- One Perpl account per agent, owned by its Turnkey agent wallet; testnet 10143, then mainnet 143
  (P1). Every funding step and the key enrollment are passkey-signed (P2, P3; CONV 7).
- A per-agent Ed25519 trading key is generated and held encrypted in `workers/trading` (read|trade,
  90-day expiry) (P5). Orders are IOC over REST; no WebSocket in v1 (P6). Orders never come from the
  model.
- The delegated Turnkey user may sign exactly one call, `allowOrderForwarding(false)`: the kill switch
  (P4, P10).
- Leverage ≤ min(brief, `PERPL_MAX_LEVERAGE`, market): 5 on testnet, 2 for the mainnet pilot (P7).
  Caps are margin caps enforced in `@pickler/trading/perpl`, not by the wallet (P8).
- Risk stops at 50% collateral loss or near liquidation; no new opens after a 3% daily loss; kill at
  a 20% drawdown (P9). Reconcile every minute; anything unexplained freezes the agent (P11).
- Testnet faucet: 100 USD plus 0.2 MON once per 24 h (P13). No builder code (P17).

**Open risks.** Perpl must allocate testnet USD for the faucet (Q-PRP-1, blocking testnet
onboarding). PAR and PERPL still disagree on live exits, close reasons, the position route and the
network a live testnet agent is scored on (§9.4 items 6–8). PAR's 4-hour cadence uses all six daily
runs (§9.4 item 10). Polymarket user custody (R02 item 6) has no spec and waits on an owner answer.

### 3.7 Launchpad and tokens

**Exists.** Contracts `PicklerLaunchFactory`, `PicklerBondingCurve`, `PicklerCurveDeployer`,
`PicklerGraduationAdapterV4` (deploys the locker), `PicklerFeeEscrow`, `PicklerAgentToken`,
`PicklerPreset`, tested and undeployed, licence `UNLICENSED` (`launchpad-monad-v1` track A). Known
squatting bug: `createLaunch` only checks the agent key is non-zero and unused
(`PicklerLaunchFactory.sol:152-158`); `launchFee` is never charged (`PicklerPreset.sol:31`). The
`launch` schema and `market.*` projections exist (0005, 0015); the indexer reads the factory stream
only. The web `/tokens` board reads real launches; `/tokens/[ticker]` reads the agent profile, so an
unlinked token is a 404; the trade panel is a placeholder (`trade-panel.tsx:30-83`). The PR #37
integration fixes are on `codex/rescue-launchpad-integration-fixes`, not on `main`.

**Specs.** LD (contract change, deployment, manifest, indexer v2), TL (studio launch, media store),
TT (trading, keeper, portfolio).

**Key decisions.**

- The factory requires an EIP-712 `LaunchGrant` signed by Pickler's launch authority (a Turnkey
  parent-org key), binding agent key, creator, fee recipient, params hash, nonce and deadline (LD D1,
  D3; CONV 5). Agent key = `keccak256("pickler.agent.v1", chainId, agentUuid)` (D2).
- The creator calls `createLaunch` directly from the studio master wallet, one passkey prompt (LD D4).
  `LaunchCreated` gains `symbol` and `metadataURI`; the launch fee is charged (0 on testnet) (D5, D6).
- Licence BUSL-1.1, converting to GPL-2.0-or-later on 2030-09-30 (LD D7). Internal review gates
  testnet; an external audit gates mainnet (D8).
- Roles: an immutable operator Safe, a treasury Safe, a throwaway deployer (LD D9). Testnet venue is
  the Monad-maintained Uniswap V4 on 10143; quote asset AUSD (D10, D11).
- Indexer v2 cherry-picks the rescued commits and adds attribution, holders, candles, fee payouts,
  reorg unwinding and a `launch-events` outbox queue (LD D12–D15). 5 confirmations, 3 after a 72-hour
  measurement (D16).
- One launch per public agent per chain; states `draft → validated → prepared → submitted →
launched | abandoned`; the ticker is reserved at validate; "Launched" only when the indexer sees
  `LaunchCreated` at confirmations; no initial buy; metadata frozen after launch (TL T1–T14).
- TL owns the product-wide **media store**: R2 `MEDIA` plus Cloudflare `IMAGES` plus `media.*`,
  shipped as its own phase-1 migration (TL §6.1, XR C8).
- Quotes are on-chain `eth_call`, never cached; `POST /v1/me/trades/quote` is also the prepare step;
  exact-amount approvals; slippage 1% default, 5% max (TT T2–T5). A gas-only keeper in
  `workers/trading`, triggered by `workers/jobs`, finalizes graduation (T8). After graduation the
  testnet pool is read-only (T9).

**Open risks.** Safe signers block the testnet deploy because the operator is immutable (Q-LCH-1).
The `PresetPublished → launch.presets` mirror has no owner; four internal routes are missing from
the specs' API tables; keeper flag placement disagrees (§9.4 items 4, 28). The launchpad product spec
LP-01..LP-22 is still not committed (XR G4).

### 3.8 Marketplace wallets and mobile

**Exists.** SIWE sign-in and wallet links on `main` (`wallet-auth.ts`, writers hard-code
`kind: "external"`, `wallet-sign-in.ts:226,245`); the web signer is injected EOA only
(`signer.ts:14`); no link or unlink UI. The TestFlight app exists outside the repository, on RP
`pickler.fun`.

**Specs.** MW (web Mera, links, confirmation sheet), MB (the app's backend contract), PHC (RP move).

**Key decisions (MW).**

- Web Mera calls the `@category-labs/mera` SDK directly as a second signer kind (MW D1). **PRF model**,
  so one passkey gives one address on web and phone (D2, irreversible once funds are held). RP
  `app.pickler.fun` (D3).
- Web Mera ships behind `NEXT_PUBLIC_MERA_WEB` after the hosts and `TURNKEY_RPID` are set (D4); the
  key lives for one ceremony, nothing is stored, strict CSP (D5, D6).
- The EOA is web-only via injected EIP-1193; no WalletConnect (D8). `kind` (`mera` | `eoa`) is
  descriptive and never trusted (D9).
- One account, at most 5 wallets; an address is never moved between accounts; no merge (D10). Removing
  the last wallet needs a **login** email; the notification email never counts (D11).
- Pickler draws its own confirmation sheet before every signature (D14). The page signs and
  broadcasts; the API verifies the hash on chain (D15). Buyers pay MON gas (D16).
- Wallet sign-in creates no `identity.profiles` row; marketplace tables key on `auth.users.id` (MW §5).

**Key decisions (MB).**

- Base URL `https://app.pickler.fun/api/v1`; the API gets no public host (M1). Refresh token in the
  Keychain, access token in memory (M3). A 5-minute Mera session on the phone only (M4).
- Push through FCM HTTP v1 behind a `PushSender` port; notifications are stored first in
  `me.notifications`, pushed second (M5, M6).
- Version gate: `X-Pickler-App` header, `426 APP_VERSION_UNSUPPORTED`; `/v1` changes are additive only
  (M8). OpenAPI generated from the zod DTOs and checked in CI (M9).
- MB owns the universal-link list: `/agents/*`, `/tokens/*`, `/reads/*`, `/receipts/*`, `/markets/*`,
  `/portfolio` (M10).
- "Move your funds": for 90 days the first `app.` build derives the legacy `pickler.fun` address and
  sweeps AUSD then MON to the new one (M13, CONV 14).

**Open risks.** The phone key model (PRF or vault) is unconfirmed and D2 is one-way (Q-MOB-2). The
owner must accept the key-in-page risk before web Mera ships (Q-MOB-4); the EOA ships regardless.
Nobody knows where the app's source is (Q-MOB-1). MB still shows a removed `EMAIL_REQUIRED` gate
(§9.4 item 14).

### 3.9 Research runtime

**Exists.** Mastra runtime in `packages/agent-runtime` (plugins Exa, Polymarket, paper trading, perps
paper, Perpl, The Odds API, balldontlie); `workers/research` runs the queue and a one-minute cron;
sports-only on Polymarket; `MAX_LIMITS` 3 searches, 5 reads, 12 steps, 6 runs a day
(`types.ts:23-30`); a monetary budget ledger that the runner does not use (no reservation before
search or model, `run-research.ts:262`, `:375`); a dormant agent HMAC API (`routes/agents.ts:38-60`).
No successful remote paid run is recorded on staging (R04 §1.4). `agent-runtime-v1.md` still says
"not implemented" in its header, which is stale.

**Specs.** RR2, PAR (perps protocol), DR (exit checks), PRD (read runs).

**Key decisions.**

- One worst-case reservation per run before any paid call, priced by a versioned tariff
  (`RESEARCH_TARIFFS`); commit actual, release the rest; unknown cost is charged in full (RR2 R1, R2,
  R6).
- Pickler pays a $5 monthly allowance per agent, 80% tokens / 20% infra; the owner can only lower it
  (R4).
- Paid-read runs use a separate `reads` scope against the read's ceiling, never the agent's allowance
  (R5; CONV 11), and a read lane exempt from `one_running_agent`, one per agent, three globally,
  240 s (R14).
- Next category crypto up/down, then Perpl perps via PAR (R7). A venue or category leaves "Soon" after
  20 staging paper runs with ≥ 18 decisions, a wired resolution source and owner sign-off (R9).
- Calendar schedules (IANA timezone, ≤ 4 times a day) and model-requested follow-ups (60 min to
  72 h) (R10, R11). RR2 owns the `pickler.runs.run_trigger` change (`manual`, `schedule`,
  `follow_up`, `read`) (XR D2).
- Retire the agent HMAC API; drop `agents.agent_credentials` 30 days later, the one irreversible step
  (R12).

**Open risks.** The paid staging acceptance needs the owner's authorisation (Q-ENV-10). CONV still
lists `/v1/agents/*` as the HMAC group (§9.4 item 17).

### 3.10 Custody

**Exists.** One Turnkey sub-organisation per person with the passkey as the only root; master wallet
and one wallet per agent; a delegated Pickler user with three DENY policies; deposits master → agent
with server-side inspection of the signed transaction (TPC1, `studio-create-and-fund-v1`,
`signing.ts:293-511`, `studio.ts:583-615`). Passkey removal shows "not yet"; sending is "not built
yet" (`security.tsx:77`, `wallet.tsx:102`). Never exercised with real Turnkey, a real chain or real
policies.

**Spec.** CUST, with PERPL for the Perpl legs.

**Key decisions.**

- Withdraw agent → master is a passkey-stamped transaction to a fixed recipient, for any token in
  `@pickler/chain`'s manifest, with an automatic 0.02 MON gas top-up when needed (CUST C1, C2; XR C13).
  Going below 10 AUSD turns the schedule off after an acknowledgement (C3).
- Send master → external for AUSD or MON, refusing the zero address, the token contract and any agent
  wallet (C4). Every transfer lands in `wallets.transfers` (C5).
- Remove a passkey (never the last); adopt-or-prune orphan credentials; custody incidents in one
  table; clean up an orphan sub-org only when its root is the person's passkey and its balance is
  zero (C6–C9).
- Table retention belongs to OPS; custody housekeeping runs off the API (C10).
- Account export: a JSON archive behind a 24-hour signed link, no key material; recovery-phrase export
  through Turnkey's iframe (C11). Deletion: 7-day grace, balances under dust first, handle reserved
  90 days, public records kept as "a deleted account", financial rows kept with a tombstone (C12,
  C13). Deletion also covers wallet-only marketplace accounts.

**Open risks.** Nothing works until Step B sets `TURNKEY_RPID` and the Turnkey secrets. The deposit
reconciler and the account-jobs queue have two homes (§9.4 items 1, 2). `media.uploads` references
`identity.profiles`, which blocks deletion as written (§9.4 item 24).

### 3.11 Design system and harness

**Exists.** Design system v2: a light marketplace and a night-blue studio, all colours as `--pk-*`
tokens in `packages/ui/src/styles.css`; `npm run design:source` (static) and `npm run design:check`
(rendered: surfaces, tokens, contrast, type) over 60 routes at 1400 px, in CI (`design.yml`). Branch
protection answers 403 on the current GitHub plan.

**Spec.** DH, plus the design sections of every other spec (§7).

**Key decisions (all proposed, none built).** Phone width 390×844 on every rendered check and a new
layout check (V1, V2, report mode first); visual regression against CI-artifact baselines from the
PR's base SHA, overridable by the label `design:intended` (V3–V5); data modes `sample`, `seed`,
`empty` and a fixture failure switch (V6, V7); the landing as a third product with split-host mode
(V8); an OpenNext/workerd job (V9); a `/merge` comment gate instead of branch protection (V10, V11).

**Open risks.** DH's host expectations do not match PHC's AASA window, and its degraded fixtures
differ from PE's (§9.4 item 32).

---

## 4. Endpoint catalogue

Re-derived from the current specs (after the cross-review changes), starting from XR §2.1. Paths are
the API's (`/v1/...`); browsers and the app reach them as `https://app.pickler.fun/api/v1/...` or
`https://studio.pickler.fun/api/v1/...` through the web proxy (CONV).

Auth: `none` public; `mkt` marketplace session (Supabase JWT from SIWE); `studio` studio session
(another owner's resource answers 404); `any` any signed-in user; `int` service binding only (the
proxy refuses `/api/v1/internal*`); `op` service binding plus an operator signature through
`ops.pickler.fun/__operator` (OPS §4.3); `state` OAuth `state` only; `token` a one-time token in the
body; `web` a Next route handler; `harness` the design fixture API. Status: **exists** (on `main`,
unchanged), **chg** (exists, shape or behaviour changes), **planned**, **removed**. "IK" = takes an
`Idempotency-Key`.

### 4.1 Health, web handlers and harness

| Method | Path                                      | Auth    | Owner   | Status  | Notes                                                                                  |
| ------ | ----------------------------------------- | ------- | ------- | ------- | -------------------------------------------------------------------------------------- |
| GET    | `/health`                                 | none    | PE §4.1 | exists  | liveness (`app.ts:45`)                                                                 |
| GET    | `/v1/health`                              | none    | PE §4.1 | planned | `{status, release, env}`; see §9.4 item 19 (growth may already mount it)               |
| ANY    | web proxy `/api/v1/[...path]`             | web     | PE §4.2 | chg     | refuses `/api/v1/internal*` (404); forwards the client IP (OPS §4.1, MB M2)            |
| GET    | `/.well-known/apple-app-site-association` | web     | PHC §4  | chg     | route handler; marketplace 200; landing `webcredentials` only during the 90-day window |
| GET    | `/.well-known/assetlinks.json`            | web     | PHC §4  | planned | `[]` until Android                                                                     |
| GET    | landing marketplace paths                 | web     | PHC H4  | chg     | 308 to `app.pickler.fun`                                                               |
| POST   | `/__fixture/fail`, `/__fixture/reset`     | harness | DH V7   | planned | loopback only                                                                          |
| GET    | `/__fixture/state`                        | harness | DH V7   | planned |                                                                                        |

### 4.2 `/v1/auth`

| Method | Path                        | Auth | Owner      | Status  | Notes                                                                       |
| ------ | --------------------------- | ---- | ---------- | ------- | --------------------------------------------------------------------------- |
| GET    | `/v1/auth/me`               | mkt  | existing   | exists  | `routes/auth.ts:11`                                                         |
| POST   | `/v1/auth/wallet/nonce`     | none | MW §4, OPS | chg     | adds `client`; `RL_AUTH`, ≤ 20 open per `client_hash`, `NONCE_RATE_LIMITED` |
| POST   | `/v1/auth/wallet/verify`    | none | MW §4, OPS | chg     | adds `kind`; returns the link; creates no profile row                       |
| POST   | `/v1/auth/wallet/link`      | mkt  | MW §4      | chg     | `kind`; `ADDRESS_TAKEN`, `WALLET_LIMIT` (5)                                 |
| GET    | `/v1/auth/wallet/links`     | mkt  | MW §4      | chg     | ordered by `lastSignedInAt`                                                 |
| PATCH  | `/v1/auth/wallet/links/:id` | mkt  | MW §4      | planned | label 1–32 chars                                                            |
| DELETE | `/v1/auth/wallet/links/:id` | mkt  | MW §4      | planned | `LAST_WALLET` unless a login email exists                                   |

### 4.3 `/v1/marketplace` (public reads)

| Method | Path                                          | Auth | Owner                  | Status  | Notes                                                                       |
| ------ | --------------------------------------------- | ---- | ---------------------- | ------- | --------------------------------------------------------------------------- |
| GET    | `/v1/marketplace/agents`                      | none | PR §4.2                | chg     | record fields from `agent_records`; `visibility = public` (GP)              |
| GET    | `/v1/marketplace/directory`                   | none | PR §4.2, GP, FORK      | chg     | + `followers`, `avatarUrl`, `xVerified`, `forkCount`, `service`, `askPrice` |
| GET    | `/v1/marketplace/personas/:handle`            | none | PR §4.2 (P13 owns DTO) | chg     | record, meters, sealed, streak, followers, GP and FORK fields               |
| GET    | `/v1/marketplace/profiles/:ticker`            | none | PR §4.2                | chg     | latest resolved calls; TT replaces its token use                            |
| GET    | `/v1/marketplace/profiles/:ticker/picks/:id`  | none | PR §4.2                | chg     | `id` becomes a `publicId`; web page redirects to `/receipts/[publicId]`     |
| GET    | `/v1/marketplace/leaderboard`                 | none | PR §4.2                | chg     | rank-eligible entries, weights, calibration buckets                         |
| GET    | `/v1/marketplace/analytics`                   | none | PR §4.2                | chg     | public-scope resolutions                                                    |
| GET    | `/v1/marketplace/markets`, `/markets/:symbol` | none | PR §4.2 (P9)           | chg     | real Perpl board; `MARKET_DATA_UNAVAILABLE`                                 |
| GET    | `/v1/marketplace/reads`                       | none | PRD §4.2               | chg     | public outcome cards only                                                   |
| GET    | `/v1/marketplace/reads/:id`                   | none | PRD §4.2               | chg     | outcome card; 404 when private or unresolved                                |
| GET    | `/v1/marketplace/agents/:handle/record`       | none | PR §4.1                | planned | `PublicRecordDto`, envelope                                                 |
| GET    | `/v1/marketplace/agents/:handle/decisions`    | none | PR §4.1                | planned | `?kind=all\|call\|pass`, cursor                                             |
| GET    | `/v1/marketplace/agents/:handle/sealed`       | none | PR §4.1                | planned | pending count and commitments                                               |
| GET    | `/v1/marketplace/agents/:handle/activity`     | none | PR §4.1                | planned |                                                                             |
| GET    | `/v1/marketplace/activity`                    | none | PR §4.1                | planned | `?kind=call\|pass\|settlement\|answer`; PE smoke route                      |
| GET    | `/v1/marketplace/decisions/:publicId`         | none | PR §4.1                | planned | `PublicReceiptDto`                                                          |
| GET    | `/v1/marketplace/agents/:handle/reads/quote`  | none | PRD §4.2               | planned | 5-minute quote; `SERVICE_CLOSED`                                            |
| GET    | `/v1/marketplace/app-config`                  | none | MB §4.2                | planned | versions, `siweDomain`, `chainId`, `meraRpId`, features, `legacyMigration`  |
| GET    | `/v1/marketplace/launchpad`                   | none | LD §4                  | planned | factory, presets, venue, freshness; `LAUNCHPAD_NOT_DEPLOYED`                |
| GET    | `/v1/marketplace/tokens/:ticker`              | none | TT §4.1                | planned | reads the launch, not the agent; `?address=`                                |
| GET    | `/v1/marketplace/tokens/:ticker/trades`       | none | TT §4.1                | planned | cursor                                                                      |
| GET    | `/v1/marketplace/tokens/:ticker/candles`      | none | TT §4.1                | planned | 5m, 1h, 4h, 1d                                                              |
| GET    | `/v1/marketplace/tokens/:ticker/holders`      | none | TT §4.1                | planned | excludes curve, adapter, locker, PoolManager                                |
| GET    | `/v1/marketplace/tokens/:ticker/quote`        | none | TT §4.1                | planned | informational; `QUOTE_STALE`                                                |
| —      | `/v1/demo/*`                                  | none | existing               | exists  | alias of `/v1/marketplace`, not extended (`app.ts:68`)                      |

Existing routes outside every group, grandfathered until the envelope switch (XR E5): `GET
/v1/launches`, `/v1/launches/:id`, `/v1/launches/:id/trades` (public, TT keeps them);
`GET /v1/handles/:handle/availability`; `GET` and `POST /v1/profile`; growth routes `GET /v1/landing`,
`GET /v1/health` (growth), `POST /v1/waitlist`, `GET` and `POST /v1/applications`,
`GET /v1/tickers/availability` (OPS adds `RL_FORMS` and `RL_PUBLIC`).

### 4.4 `/v1/me` (a signed-in user's own account)

| Method | Path                                 | Auth  | Owner       | Status  | Notes                                                                |
| ------ | ------------------------------------ | ----- | ----------- | ------- | -------------------------------------------------------------------- |
| GET    | `/v1/me/follows`                     | mkt   | PR §4.3     | planned |                                                                      |
| PUT    | `/v1/me/follows/:handle`             | mkt   | PR §4.3     | planned | `FOLLOW_LIMIT` (500); 60 writes/min                                  |
| DELETE | `/v1/me/follows/:handle`             | mkt   | PR §4.3     | planned |                                                                      |
| POST   | `/v1/me/follows/import`              | mkt   | PR §4.3     | planned | ≤ 200 handles; IK                                                    |
| GET    | `/v1/me/activity`                    | mkt   | PR §4.3     | planned | followed agents                                                      |
| POST   | `/v1/me/reads`                       | mkt   | PRD §4.3    | planned | intent; IK; ≤ 3 open; `RL_MONEY`; `OWN_AGENT`, `PRICE_CHANGED`       |
| POST   | `/v1/me/reads/:id/payment`           | mkt   | PRD §4.3    | planned | tx hash claim; IK; 202 until final; `RL_MONEY`                       |
| GET    | `/v1/me/reads`, `/v1/me/reads/:id`   | mkt   | PRD §4.3    | planned |                                                                      |
| POST   | `/v1/me/reads/:id/cancel`            | mkt   | PRD §4.3    | planned | only while awaiting payment                                          |
| POST   | `/v1/me/reads/:id/dispute`           | mkt   | PRD §4.3    | planned | three reasons, within 24 h                                           |
| GET    | `/v1/me/reads/:id/receipt`           | mkt   | PRD §4.3    | planned | the payment receipt (not the decision receipt, XR E11)               |
| PUT    | `/v1/me/notify-email`                | mkt   | PRD §4.3    | planned | `{email, receipts}`; sends the link; 3/h                             |
| POST   | `/v1/me/notify-email/verify`         | token | PRD §4.3    | planned | page `/account/email?token=`                                         |
| DELETE | `/v1/me/notify-email`                | mkt   | PRD §4.3    | planned |                                                                      |
| POST   | `/v1/me/trades/quote`                | mkt   | TT §4.2     | planned | also the prepare step; IK; `WALLET_NOT_LINKED`, `INSUFFICIENT_GAS`   |
| POST   | `/v1/me/trades`                      | mkt   | TT §4.2     | planned | `{quoteId, txHash}`; IK; `TX_MISMATCH`                               |
| GET    | `/v1/me/trades`, `/v1/me/trades/:id` | mkt   | TT §4.2     | planned |                                                                      |
| GET    | `/v1/me/portfolio`                   | mkt   | TT §4.2, MB | planned | shape from MB §4.2; balances `null`, never 0, when the chain is down |
| GET    | `/v1/me/notifications`               | mkt   | MB §4.2     | planned | `meta.unreadCount`                                                   |
| POST   | `/v1/me/notifications/read`          | mkt   | MB §4.2     | planned |                                                                      |
| GET    | `/v1/me/notification-preferences`    | mkt   | MB §4.2     | planned |                                                                      |
| PUT    | `/v1/me/notification-preferences`    | mkt   | MB §4.2     | planned |                                                                      |
| POST   | `/v1/me/devices`                     | mkt   | MB §4.2     | planned | upsert by push token (idempotent by nature)                          |
| DELETE | `/v1/me/devices/:id`                 | mkt   | MB §4.2     | planned |                                                                      |
| POST   | `/v1/me/legacy-migration`            | mkt   | MB §4.2     | planned | "Move your funds" record; IK; `MIGRATION_CLOSED`                     |
| POST   | `/v1/me/account/export`              | any   | CUST §4     | planned | one per 24 h                                                         |
| GET    | `/v1/me/account/export/:id`          | any   | CUST §4     | planned |                                                                      |
| POST   | `/v1/me/account/deletion`            | any   | CUST §4     | planned | proof by passkey stamp or SIWE; `BALANCES_REMAIN`                    |
| DELETE | `/v1/me/account/deletion`            | any   | CUST §4     | planned | cancel during the grace period                                       |

### 4.5 `/v1/studio` (also served at the `/v1/console` alias, `app.ts:51-54`)

Existing routes that no spec changes (`studio.ts`): `POST /onboard`, `GET /me`, `GET /options`,
`GET /preview-runs/:id`, `GET /agents`, `POST /agents`, `GET /agents/:id`,
`PUT /agents/:id/interval`, `POST /agents/:id/deposit/prepare`, `POST /agents/:id/deposit/confirm`,
`POST /agents/:id/runs`, `GET /runs/:id`, `GET /runs/:id/events`, `GET /agents/:id/paper-summary`,
`POST` and `GET /runs/:id/paper-order`, `PUT /agents/:id/pause`, the Polymarket pilot routes
(`/agents/:id/trading/*`, `/trading/orders/:id`, `/trading/orders/:id/submit`,
`/runs/:id/live-order`). PAR changes the run, pick and activity DTOs to carry Perpl fields.

| Method | Path                                                    | Auth   | Owner          | Status  | Notes                                                            |
| ------ | ------------------------------------------------------- | ------ | -------------- | ------- | ---------------------------------------------------------------- |
| POST   | `/v1/studio/agents/draft`                               | studio | PAR §5, OPS    | chg     | `venue: perpl` allowed when paper is on; `RL_MODEL`, 200/day/env |
| PUT    | `/v1/studio/agents/:id/config`                          | studio | PAR §5         | chg     | `venue`, `perps.instruments`; `VENUE_FIXED`                      |
| POST   | `/v1/studio/preview-runs`                               | studio | FORK §4, OPS   | chg     | + `forkedFrom`; `RL_MODEL`                                       |
| POST   | `/v1/studio/drafts`                                     | studio | FORK §4        | chg     | + `forkedFrom`                                                   |
| GET    | `/v1/studio/market-categories`                          | studio | RR2 §4         | chg     | catalogue v2 with `live \| soon`                                 |
| GET    | `/v1/studio/agents/:id/runs`                            | studio | RR2 §4         | chg     | + `costMicroUsd`                                                 |
| PUT    | `/v1/studio/agents/:id/schedule`                        | studio | RR2 §4         | chg     | interval or calendar; next 3 due times                           |
| PUT    | `/v1/studio/agents/:id/limits`                          | studio | GP D13         | chg     | raising caps: `CAPS_NEED_APPROVAL`                               |
| POST   | `/v1/studio/runs/:id/paper-order/settle`                | studio | DR §4, SDR §4  | chg     | alias of check-resolution, rate limited                          |
| GET    | `/v1/studio/agents/:id/go-public`                       | studio | GP §4          | planned | steps and publish blockers                                       |
| PUT    | `/v1/studio/agents/:id/voice`                           | studio | GP §4          | planned | six presets                                                      |
| GET    | `/v1/studio/voice-presets`                              | studio | GP §4          | planned |                                                                  |
| POST   | `/v1/studio/agents/:id/x/challenge`                     | studio | GP §4          | planned | `X_HANDLE_TAKEN`                                                 |
| POST   | `/v1/studio/agents/:id/x/verify`                        | studio | GP §4          | planned | 1 per 10 s, 30/h                                                 |
| GET    | `/v1/studio/agents/:id/x/authorize`                     | studio | GP §4          | planned | PKCE URL                                                         |
| GET    | `/v1/studio/x/callback`                                 | state  | GP §4          | planned | X redirect, no Bearer                                            |
| PUT    | `/v1/studio/agents/:id/x/posting`                       | studio | GP §4          | planned |                                                                  |
| DELETE | `/v1/studio/agents/:id/x`                               | studio | GP §4          | planned |                                                                  |
| GET    | `/v1/studio/agents/:id/x/posts`                         | studio | GP §4          | planned | outbox log                                                       |
| GET    | `/v1/studio/agents/:id/caps`                            | studio | GP §4          | planned |                                                                  |
| POST   | `/v1/studio/agents/:id/caps/prepare`                    | studio | GP §4          | planned | IK                                                               |
| POST   | `/v1/studio/agents/:id/caps/confirm`                    | studio | GP §4          | planned | IK; `STAMP_MISMATCH`                                             |
| POST   | `/v1/studio/agents/:id/publish`                         | studio | GP §4          | planned | `PUBLISH_BLOCKED`                                                |
| PUT    | `/v1/studio/agents/:id/identity`                        | studio | GP §4          | planned | `HANDLE_FIXED`                                                   |
| PUT    | `/v1/studio/agents/:id/profile`                         | studio | GP §4, FORK §4 | planned | accent, blurb, links, thesis, `forkable`                         |
| POST   | `/v1/studio/agents/:id/avatar`                          | studio | GP §4          | planned | multipart; IK; TL media rules                                    |
| DELETE | `/v1/studio/agents/:id/avatar`                          | studio | GP §4          | planned |                                                                  |
| GET    | `/v1/studio/agents/:id/audience`                        | studio | GP §4          | planned | `null` = "Soon"                                                  |
| GET    | `/v1/studio/forkable-agents`                            | studio | FORK §4        | planned |                                                                  |
| GET    | `/v1/studio/forkable-agents/:handle/brief`              | studio | FORK §4        | planned | logs a brief load; 60/h, 300/day                                 |
| GET    | `/v1/studio/agents/:id/lineage`                         | studio | FORK §4        | planned |                                                                  |
| GET    | `/v1/studio/agents/:id/decisions`                       | studio | SDR §4         | planned | filters, cursor                                                  |
| GET    | `/v1/studio/decisions/:runId`                           | studio | SDR §4         | planned | `DecisionReviewDto`                                              |
| GET    | `/v1/studio/agents/:id/performance`                     | studio | SDR §4         | planned | `?window=30d\|90d\|all`                                          |
| PUT    | `/v1/studio/decisions/:runId/review`                    | studio | SDR §4         | planned | versioned                                                        |
| DELETE | `/v1/studio/decisions/:runId/review`                    | studio | SDR §4         | planned |                                                                  |
| POST   | `/v1/studio/decisions/:runId/check-resolution`          | studio | SDR §4, DR     | planned | IK; one per decision per 5 min                                   |
| GET    | `/v1/studio/read-bounds`                                | studio | PRD §4.1       | planned |                                                                  |
| GET    | `/v1/studio/agents/:id/read-service`                    | studio | PRD §4.1       | planned |                                                                  |
| PUT    | `/v1/studio/agents/:id/read-service`                    | studio | PRD §4.1       | planned | price, clock, capacity, markets                                  |
| GET    | `/v1/studio/agents/:id/reads`                           | studio | PRD §4.1       | planned | never the answer or the buyer's context                          |
| GET    | `/v1/studio/earnings`                                   | studio | PRD §4.1       | planned |                                                                  |
| GET    | `/v1/studio/payouts`                                    | studio | PRD §4.1       | planned |                                                                  |
| GET    | `/v1/studio/venues`                                     | studio | PERPL §4, PAR  | planned | `{liveVenues, soonVenues}`; must ship with PAR (§9.4 item 9)     |
| GET    | `/v1/studio/agents/:id/perps/positions`                 | studio | PAR §5         | planned | `?source=paper\|live`; overlaps PERPL's positions route          |
| GET    | `/v1/studio/agents/:id/perpl`                           | studio | PERPL §4       | planned | account, steps, key, risk                                        |
| POST   | `/v1/studio/perpl/faucet`                               | studio | PERPL §4       | planned | testnet only, once per 24 h                                      |
| POST   | `/v1/studio/agents/:id/perpl/steps/:step/prepare`       | studio | PERPL §4       | planned | eleven step names; IK                                            |
| POST   | `/v1/studio/agents/:id/perpl/step-runs/:stepId/confirm` | studio | PERPL §4       | planned | renamed per XR E8                                                |
| POST   | `/v1/studio/agents/:id/perpl/kill`                      | studio | PERPL §4       | planned | no passkey needed                                                |
| GET    | `/v1/studio/agents/:id/perpl/orders`                    | studio | PERPL §4       | planned |                                                                  |
| GET    | `/v1/studio/agents/:id/perpl/positions`                 | studio | PERPL §4       | planned |                                                                  |
| GET    | `/v1/studio/agents/:id/token`                           | studio | TL §4          | planned | eligibility, draft, launch                                       |
| PUT    | `/v1/studio/agents/:id/token/draft`                     | studio | TL §4          | planned | versioned                                                        |
| GET    | `/v1/studio/agents/:id/token/ticker-availability`       | studio | TL §4          | planned |                                                                  |
| POST   | `/v1/studio/agents/:id/token/image`                     | studio | TL §4          | planned | multipart; IK                                                    |
| POST   | `/v1/studio/agents/:id/token/validate`                  | studio | TL §4          | planned | reserves the ticker, pins metadata, writes the agent key; IK     |
| POST   | `/v1/studio/agents/:id/token/prepare`                   | studio | TL §4          | planned | grant plus unsigned activity; IK                                 |
| POST   | `/v1/studio/agents/:id/token/submit`                    | studio | TL §4          | planned | IK                                                               |
| GET    | `/v1/studio/agents/:id/token/status`                    | studio | TL §4          | planned | polled every 2 s                                                 |
| POST   | `/v1/studio/agents/:id/token/abandon`                   | studio | TL §4          | planned | no IK listed                                                     |
| POST   | `/v1/studio/agents/:id/token/fees/claim/prepare`        | studio | TL §4          | planned | IK                                                               |
| POST   | `/v1/studio/agents/:id/token/fees/claim/submit`         | studio | TL §4          | planned | no IK listed although it broadcasts (§9.4 item 28)               |
| GET    | `/v1/studio/agents/:id/research-budget`                 | studio | RR2 §4         | planned | `paidBy: "pickler"`                                              |
| PUT    | `/v1/studio/agents/:id/research-budget`                 | studio | RR2 §4         | planned | owner may only lower                                             |
| GET    | `/v1/studio/agents/:id/follow-ups`                      | studio | RR2 §4         | planned |                                                                  |
| DELETE | `/v1/studio/follow-ups/:id`                             | studio | RR2 §4         | planned |                                                                  |
| POST   | `/v1/studio/agents/:id/withdraw/prepare`                | studio | CUST §4        | planned | agent → master, gas top-up                                       |
| POST   | `/v1/studio/agents/:id/withdraw/confirm`                | studio | CUST §4        | planned | `SCHEDULE_ACK_REQUIRED`                                          |

### 4.6 `/v1/signing` (Turnkey ceremonies)

Existing (`signing.ts:293-511`, mounted only with the Turnkey variables): `POST /passkeys/challenge`,
`POST /passkeys/register`, `POST /passkeys/add/prepare` and `/add/confirm` (chg: CUST writes and
clears `pending_additions`), `GET /passkeys` (chg: backfills `turnkey_authenticator_id`),
`GET /wallets/me`, `GET /agents/state`, `POST /agents/delegated/{prepare,confirm}`,
`POST /agents/wallet/{prepare,confirm}`, `POST /agents/wallet/:walletId/policies/{prepare,confirm}`.
GP D10 reuses them for a draft's wallet.

| Method | Path                                        | Auth   | Owner   | Status  | Notes                                  |
| ------ | ------------------------------------------- | ------ | ------- | ------- | -------------------------------------- |
| GET    | `/v1/signing/wallets`                       | studio | CUST §4 | planned | master and agent wallets with balances |
| POST   | `/v1/signing/wallets/master/send/prepare`   | studio | CUST §4 | planned | recipient refusals and warnings        |
| POST   | `/v1/signing/wallets/master/send/confirm`   | studio | CUST §4 | planned |                                        |
| GET    | `/v1/signing/transfers`                     | studio | CUST §4 | planned | cursor                                 |
| POST   | `/v1/signing/passkeys/:id/remove/prepare`   | studio | CUST §4 | planned | `LAST_PASSKEY`                         |
| POST   | `/v1/signing/passkeys/:id/remove/confirm`   | studio | CUST §4 | planned |                                        |
| POST   | `/v1/signing/passkeys/reconcile`            | studio | CUST §4 | planned | adopt, resume or untrusted             |
| GET    | `/v1/signing/incidents`                     | studio | CUST §4 | planned | open orphan sub-orgs                   |
| POST   | `/v1/signing/incidents/:id/cleanup/prepare` | studio | CUST §4 | planned | `NOT_CLEANABLE`                        |
| POST   | `/v1/signing/incidents/:id/cleanup/confirm` | studio | CUST §4 | planned | irreversible sub-org delete            |

### 4.7 `/v1/agents` (JWT workspace list; the HMAC agent API is retired)

| Method | Path                                                   | Auth   | Owner   | Status  | Notes                |
| ------ | ------------------------------------------------------ | ------ | ------- | ------- | -------------------- |
| GET    | `/v1/agents`, `/v1/agents/:id`, `/v1/agents/:id/audit` | studio | RR2 R12 | exists  | kept under a JWT     |
| GET    | `/v1/agents/:id/status`, `/analytics`, `/budget`       | HMAC   | RR2 R12 | removed | 404 after retirement |

### 4.8 `/v1/internal` (service binding) and operator routes

| Method | Path                                        | Auth    | Owner             | Caller                                              | Status                |
| ------ | ------------------------------------------- | ------- | ----------------- | --------------------------------------------------- | --------------------- |
| GET    | `/v1/internal/ready` (`?model=1`)           | int     | PE §4.2           | ops probe; verifier via `ops call`                  | planned               |
| GET    | `/v1/internal/ops/queues`                   | int     | OPS §4.2          | ops                                                 | planned               |
| POST   | `/v1/internal/resolutions/tick`             | int     | DR §4             | tests; the research cron calls the use case         | planned               |
| GET    | `/v1/internal/resolutions/health`           | int     | DR §4             | ops                                                 | planned               |
| POST   | `/v1/internal/resolutions/:runId/revisions` | op      | DR §4             | operator; IK                                        | planned               |
| POST   | `/v1/internal/resolutions/backfill`         | op      | DR §4             | operator                                            | planned               |
| POST   | `/v1/internal/exits/tick`                   | int     | DR §4             | jobs `*/5`, minutes 0 and 30                        | planned               |
| GET    | `/v1/internal/decision-reviews/export`      | op      | SDR §4            | operator; ships disabled                            | planned               |
| POST   | `/v1/internal/x/outbox/drain`               | int     | GP §4             | jobs, every minute                                  | planned               |
| POST   | `/v1/internal/x/enqueue`                    | int     | GP §4             | the paid-reads evaluation only                      | planned               |
| POST   | `/v1/internal/reads/verify-payments`        | int     | PRD §4.4          | jobs, every minute                                  | planned               |
| POST   | `/v1/internal/reads/sweep-deadlines`        | int     | PRD §4.4          | jobs, every minute                                  | planned               |
| POST   | `/v1/internal/reads/refunds/run`            | int     | PRD §4.4          | jobs, every minute                                  | planned               |
| POST   | `/v1/internal/reads/evaluate`               | int     | PRD §4.4          | jobs `*/5`                                          | planned               |
| POST   | `/v1/internal/reads/payouts/run`            | int     | PRD §4.4          | jobs 00:30 UTC                                      | planned               |
| POST   | `/v1/internal/reads/reconcile`              | int     | PRD §4.4          | jobs 01:00 UTC                                      | planned               |
| POST   | `/v1/internal/reads/disputes/:id/resolve`   | op      | PRD §4.4          | operator                                            | planned               |
| RPC    | `send` on `workers/treasury`                | int     | PRD §4.4          | the API only; idempotent by reference               | planned               |
| POST   | `/v1/internal/perps/paper/exits`            | int     | PAR §5            | jobs, every minute                                  | planned               |
| POST   | `/v1/internal/trading/perpl/keys`           | int     | PERPL §4          | api → trading                                       | planned               |
| POST   | `/v1/internal/trading/perpl/kill`           | int, op | PERPL §4          | api; operator "all"                                 | planned               |
| POST   | `/v1/internal/trading/perpl/decisions`      | —       | PERPL             | replaced by the trading queue (XR C17)              | removed from the spec |
| POST   | `/v1/internal/launch/grants`                | int     | LD §4             | optional; normally in-process                       | planned               |
| POST   | `/v1/internal/launch/outbox/deliver`        | int     | LD §4             | `launch-events` consumer                            | planned               |
| GET    | `/v1/internal/launch/indexer/health`        | int     | LD §4             | ops                                                 | planned               |
| POST   | `/v1/internal/launch/reconcile`             | int     | TL (text only)    | jobs, every minute                                  | planned               |
| POST   | `/v1/internal/tokens/trades/watch`          | int     | TT §5 (text only) | jobs, every minute                                  | planned               |
| POST   | `/internal/graduation-keeper/run` (trading) | int     | TT §6.3           | jobs via the `TRADING` binding                      | planned               |
| POST   | `/v1/internal/media/takedowns`              | op      | TL §6.1           | operator                                            | planned               |
| —      | media sweeper route (unnamed)               | int     | TL §6.1           | ops or jobs (§9.4 item 3)                           | planned               |
| —      | notifications drain route (unnamed)         | int     | PE §6.6           | jobs (MB instead claims rows directly, §9.4 item 1) | planned               |
| POST   | `https://ops.pickler.fun/__operator`        | op      | OPS §4.3          | `npm run ops -- call`                               | planned               |

In-transaction use cases that replace HTTP hops (XR C18, W4): `enqueueAgentPost` (resolution →
X outbox), `deliverRead` (research → read delivery), `notify` (any producer → `me.notifications`).

Operator CLI (OPS §4.3, PE §3): `npm run release`, `release.mjs --rollback-to`,
`npm run check:readiness`, `npm run check:production`, `scripts/provision.mjs`, `scripts/smoke.mjs`,
`npm run ops -- call`, `ops:dlq`, `ops:alerts`, `ops:backup`, `ops:restore-drill`.

---

## 5. Data catalogue

Every spec says "the next free migration number is 0023" (CONV). Numbers are assigned at merge time;
what matters is the order below. All new tables have RLS on and are never exposed through the Supabase
Data API (PE `db.data_api`, derived from the `CREATE SCHEMA` statements, not hard-coded). Every schema
is in the nightly backup (CONV 17). The schema-boundaries decision (Q-ENV-6) may rename `pickler` to
`runtime` and `wallets` to `signing`, and change `agent_id` to `uuid`, before any of these land.

### 5.1 New migrations

| #   | Migration (spec)                              | Creates or changes                                                                                                                                                                                                                                                                                 | Must come after                                                       |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| M1  | `ops` (OPS §5)                                | schema `ops`: `worker_heartbeats`, `error_groups`, `alerts` (unique open rule), `dead_letters`, `rate_counters`; `identity.siwe_nonces.client_hash bytea` + index                                                                                                                                  | — (before the ops Worker and the verifier's `health.*` items)         |
| M2  | `wallet_links_kind_and_labels` (MW §5)        | `identity.wallet_links`: `label`, `last_signed_in_at`, `created_by_client`, `kind` `external` → `eoa`, check `eoa \| mera`; `identity.siwe_nonces.client`. Optional follow-up `wallet_links_kind_eoa_only`                                                                                         | ships with code that writes `eoa`                                     |
| M3  | `media_store` (TL §6.1)                       | schema `media`: `uploads` (purpose `token_image \| avatar`, `owner_id → identity.profiles`), `takedowns`                                                                                                                                                                                           | — (phase 1; before GP avatars)                                        |
| M4  | `go_public` (GP §5)                           | enum `agents.agent_visibility`; `agents.agents.visibility`, `published_at` (backfill `status <> 'draft'`); `agent_profiles.avatar_key`, `links`, `show_thesis`, `voice_preset`; `agents.x_challenges`, `x_accounts`, `x_posts`; `wallets.agent_wallet_caps` (amounts only, XR D12)                 | M3 for avatars (soft)                                                 |
| M5  | `agent_forks` (FORK §5)                       | `agent_profiles.forkable`; `agents.agent_forks`; `agents.brief_loads`                                                                                                                                                                                                                              | M4                                                                    |
| M6  | `research_run_costs` (RR2 §5)                 | `pickler.run_costs` (reservations and settlements per run)                                                                                                                                                                                                                                         | —                                                                     |
| M7  | `research_calendar_and_follow_ups` (RR2 §5)   | `pickler.agents.schedule_kind`, `schedule_timezone`, `schedule_calendar`; **`pickler.runs.run_trigger` widened to `manual, schedule, follow_up, read`**, `parent_run_id`; `one_running_agent` excludes reads, new `one_running_read_per_agent`; `run_costs.scope`, `read_id`; `pickler.follow_ups` | M6                                                                    |
| M8  | `decision_resolutions` (DR §5)                | `pickler.decisions`; `pickler.decision_resolutions` (UPDATE/DELETE rejected by trigger); view `current_resolutions`; `pickler.agent_records`; `pickler.decision_live_pnl` (append-only)                                                                                                            | M7 for trigger values (soft); M4 for `published_at` (soft)            |
| M9  | `paper_position_exits` (DR §5.6)              | `pickler.paper_orders.exit`; unique index `one_open_paper_position` rebuilt; `pickler.paper_exit_checks`                                                                                                                                                                                           | M8                                                                    |
| M10 | `public_record` (PR §5)                       | `agents.follows` (keyed on `auth.users.id`, no FK); `agents.public_activity`                                                                                                                                                                                                                       | M8 (PR §10 ships follows first)                                       |
| M11 | `decision_reviews` (SDR §5)                   | `pickler.decision_reviews` (plus `audit.events` rows on write)                                                                                                                                                                                                                                     | M8                                                                    |
| M12 | `paid_reads` (PRD §5)                         | schema `reads`: `read_services`, enums `read_state` and `read_evaluation`, `reads`, `payments`, `payouts`, `refunds`, `ledger_entries`, `disputes`; `identity.notify_emails`, `identity.notify_email_tokens`; `pickler.runs.read_id uuid`                                                          | M7 (trigger), M4                                                      |
| M13 | `perps_direction` (PAR §6)                    | `pickler.perps_paper_positions.run_id`, `stop_loss_bps`, `take_profit_bps`, `exit_due_at`, `close_reason` check; exit index                                                                                                                                                                        | M8 (and the `decisions.venue` check extended to `perpl`, owned by DR) |
| M14 | `perpl_live` (PERPL §5)                       | `pickler.perpl_accounts`, `perpl_keys`, `perpl_steps`, `perpl_orders`, `perpl_fills`, `perpl_positions`, `perpl_account_events`, `perpl_risk_state`, `perpl_reconciliation_issues`; `wallets.agent_wallet_venue_policies`                                                                          | M13, M8                                                               |
| M15 | `launchpad_attribution` (LD §5.1)             | `launch.agent_keys` (chain as CAIP-2 text), `launch.grants`; `market.tokens.agent_key`, `metadata_uri`, `description`                                                                                                                                                                              | —                                                                     |
| M16 | `token_launch_drafts` (TL §5)                 | `launch.drafts` metadata columns and one-live-draft index; `launch.metadata_versions` draft link; `launch.transaction_requests` kind, nonce, unsigned activity                                                                                                                                     | M15, M3                                                               |
| M17 | `token_trade_requests` (TT §5)                | enum `market.trade_request_status`; `market.trade_requests` (`user_id` = `auth.users.id`, no FK)                                                                                                                                                                                                   | M16 and indexer v2 projections                                        |
| M18 | `mobile_notifications_and_devices` (MB §5)    | schema `me`: `devices`, `notifications`, `notification_preferences`, `legacy_migrations`                                                                                                                                                                                                           | — (before notification producers)                                     |
| M19 | `custody_transfers_and_incidents` (CUST §5.1) | `wallets.transfers`, `wallets.passkeys.turnkey_authenticator_id`, `wallets.untrusted_credentials`, `wallets.pending_additions`, `wallets.custody_incidents`                                                                                                                                        | —                                                                     |
| M20 | `account_export_and_deletion` (CUST §5.2)     | `identity.account_exports`, `identity.account_deletions`, `identity.reserved_handles`                                                                                                                                                                                                              | M10, M12, M17, M18 (its test fails on any unlisted `user_id` table)   |
| M21 | `retire_agent_credentials` (RR2 §5)           | `drop table agents.agent_credentials` (irreversible)                                                                                                                                                                                                                                               | ≥ 30 days after the HMAC code is removed, zero-row check              |

Not Drizzle migrations: the `pickler_app` database role and its `auth.users`/`auth.identities` grants
(PE §5.2, operator-run, recorded in `docs/operations/database-roles.md`), with a fallback migration
`identity.auth_user_lookup(email)` if Supabase refuses the grant. Data only: new
`market.indexer_cursors` stream rows for indexer v2 (LD §5.1). Future: `pickler.decision_assistant_reviews`
(SDR §6.2).

### 5.2 Ordering in one line

`ops`, `wallet_links`, `media_store`, `run_costs` (independent, phase 1–2) → `go_public` →
`calendar_and_follow_ups` → `decision_resolutions` → {`paper_position_exits`, `public_record`,
`decision_reviews`, `agent_forks`, `paid_reads`, `perps_direction`} → `perpl_live`;
`launchpad_attribution` → `token_launch_drafts` → `token_trade_requests`; `me` and `custody_transfers`
any time; `account_export_and_deletion` last; `retire_agent_credentials` whenever its 30 days are up.

### 5.3 Data rules worth remembering

- Marketplace person tables (`agents.follows`, `market.trade_requests`, `reads.reads`, `me.*`,
  `identity.notify_emails`) key on `auth.users.id`; wallet sign-in creates no profile row (MW §5).
  `media.uploads` is the exception and still references `identity.profiles` (§9.4 item 24).
- Append-only: `decision_resolutions`, `decision_live_pnl`, `reads.ledger_entries`, `perpl_fills`.
- Money columns are micro-AUSD `bigint`; on-chain amounts are `numeric(78,0)` base units; provider
  costs are micro-USD (RR2).
- `run_id` is `text` everywhere (it references `pickler.runs.id`); `read_id` is `uuid` on
  `pickler.runs` and `pickler.decisions` but `text` in `pickler.run_costs` (§9.4 item 29).

---

## 6. Workers and integrations

### 6.1 Workers

| Worker (`pickler-<name>-<env>`) | Exists?           | Role                                                                                             | Bindings (main ones)                                                                                                                                                                               | Crons                                                                      |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| web                             | yes               | Next.js on OpenNext; the only Worker with custom domains (three hosts)                           | `API`, `WORKER_SELF_REFERENCE`                                                                                                                                                                     | —                                                                          |
| api                             | yes               | the one public API, behind the web proxy                                                         | `DATABASE`, `RESEARCH_QUEUE`, `TRADING_QUEUE`, `TRADING_EXECUTOR`, `TREASURY`, `MEDIA`, `EXPORTS`, `IMAGES`, `LAUNCH_EVENTS_QUEUE` (consumer), `ACCOUNT_JOBS_QUEUE`, `NOTIFICATIONS_QUEUE`, `RL_*` | none (CONV 15)                                                             |
| research                        | yes               | research runs, read lane, follow-ups, resolution                                                 | `DATABASE`, `RESEARCH_QUEUE` (producer and consumer), `TRADING_QUEUE`                                                                                                                              | `* * * * *` runs and follow-ups; `*/5` resolution (DR D10)                 |
| trading                         | yes               | the only signer: Polymarket pilot, Perpl orders and kill, keeper                                 | `DATABASE`, `TRADING_QUEUE`                                                                                                                                                                        | `* * * * *` reconciliation, Perpl risk stops, key expiry                   |
| indexer                         | yes, undeployed   | launch indexing, outbox producer                                                                 | `DATABASE` (missing today), `LAUNCH_EVENTS_QUEUE`                                                                                                                                                  | `* * * * *`                                                                |
| treasury                        | **new** (PRD R18) | signs read refunds and payouts; `send` RPC for the API                                           | `DATABASE`                                                                                                                                                                                         | daily self-check (no cron row yet, §9.4 item 18)                           |
| jobs                            | **new** (CONV 15) | product crons; each calls one internal route                                                     | `API`, `TRADING`                                                                                                                                                                                   | see §6.2                                                                   |
| ops                             | **new** (OPS O3)  | tail consumer, error groups, alerts, probe, DLQ consumer, sweepers, retention, operator endpoint | `DATABASE`, `API`, DLQ consumers, `SEND_EMAIL`                                                                                                                                                     | `* * * * *` probes and alert rules; `*/15` sweepers; `0 4 * * *` retention |

Every Worker names `pickler-ops-<env>` in `tail_consumers` (PE §6.1). Hyperdrive
`pickler-database-<env>` (session pooler 5432, verify-full, cache off) serves api, research, trading,
indexer, treasury and ops.

### 6.2 Crons, queues and buckets

| Home     | Schedule                                       | Work                                                                                                                                 | Owner               |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| jobs     | `* * * * *`                                    | reads verify, sweep deadlines, refunds; X outbox drain; notifications drain; launch status; trade watcher; graduation keeper trigger | PRD, GP, MB, TL, TT |
| jobs     | every minute                                   | Perpl paper exits (not yet in PE's table, §9.4 item 11)                                                                              | PAR A14             |
| jobs     | `*/5 * * * *`                                  | reads evaluation; exit tick on minutes 0 and 30                                                                                      | PRD, DR             |
| jobs     | `*/15 * * * *`                                 | custody deposit reconciler (CUST says ops, §9.4 item 2)                                                                              | CUST C9             |
| jobs     | `30 0 * * *`                                   | read payouts                                                                                                                         | PRD R17             |
| jobs     | `0 1 * * *`                                    | read ledger reconcile                                                                                                                | PRD R20             |
| jobs     | `0 3 * * *`                                    | media cleanup (TL says ops, §9.4 item 3)                                                                                             | TL                  |
| ops      | `* * * * *`                                    | probes, alert rules                                                                                                                  | OPS                 |
| ops      | `*/15`                                         | sweepers: nonces, WebAuthn challenges, preview runs, add-device pendings                                                             | OPS O12, CUST C10   |
| ops      | `0 4 * * *`                                    | retention                                                                                                                            | OPS                 |
| research | `* * * * *`, `*/5`                             | runs; resolution                                                                                                                     | RR2, DR             |
| trading  | `* * * * *`                                    | Polymarket and Perpl reconciliation, risk stops, key expiry                                                                          | PERPL               |
| indexer  | `* * * * *`                                    | launch indexing                                                                                                                      | LD                  |
| GitHub   | daily 03:00, first Monday 06:00, nightly 02:00 | backup, restore drill, workerd design build                                                                                          | OPS, DH             |

| Queue (`-<env>`)        | Producer → consumer                                                            | DLQ (consumed by ops)       | Owner    |
| ----------------------- | ------------------------------------------------------------------------------ | --------------------------- | -------- |
| `pickler-research`      | api, research → research                                                       | `pickler-research-dlq`      | existing |
| `pickler-trading-queue` | api, research, trading → trading; kinds include `perpl-decision`, `perpl-kill` | `pickler-trading-dlq`       | PERPL    |
| `pickler-launch-events` | indexer → api                                                                  | `pickler-launch-events-dlq` | LD D15   |
| `pickler-account-jobs`  | api → api (PE) or → jobs (CUST)                                                | `pickler-account-jobs-dlq`  | CUST     |
| `pickler-notifications` | api → api (PE) or jobs → jobs (MB)                                             | `pickler-notifications-dlq` | MB M14   |

| R2 bucket               | Use                                                                                        | Owner    |
| ----------------------- | ------------------------------------------------------------------------------------------ | -------- |
| `pickler-media-<env>`   | token images, avatars, metadata; public at `media[-staging].pickler.fun`; CSAM scanning on | TL §6.1  |
| `pickler-exports-<env>` | account exports, private, 2-day lifecycle                                                  | CUST C11 |
| `pickler-backups`       | `<env>/daily\|pre-migration\|weekly\|monthly/`, `age`-encrypted                            | OPS O11  |

DNS (PHC §6.1 is the full zone inventory): `pickler.fun`, `app.`, `studio.` (web production);
`stg.`, `app-stg.`, `studio-stg.` (web staging); `wallet.pickler.fun` (SPF `-all`, null MX);
`media.` and `media-staging.` (R2); `mail.pickler.fun` (Resend SPF, DKIM, DMARC); `ops.pickler.fun`
(ops Worker); `sign.app.pickler.fun` reserved for the v1.1 Mera signer iframe.

### 6.3 External services, their secrets and variables

Names only; values never leave the password manager or `wrangler secret put` (S = secret, V = var,
B = binding, build = web build-time).

| Service                            | Used for                                                                                      | Held by                              | Names                                                                                                                                                                                                                                                                                                                                                                | Owner            |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Turnkey (studio parent org)        | sub-orgs, passkeys, wallets, policies, ceremonies                                             | api                                  | S `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`; V `TURNKEY_PARENT_ORG_ID`, `TURNKEY_RPID`, `TURNKEY_APP_NAME`, `TURNKEY_DELEGATED_API_PUBLIC_KEY`                                                                                                                                                                                                             | TPC1, PE         |
| Turnkey (delegated key)            | Perpl kill switch `allowOrderForwarding(false)`                                               | trading (PE also lists api)          | S `TURNKEY_DELEGATED_API_PRIVATE_KEY`                                                                                                                                                                                                                                                                                                                                | PERPL §8, PE     |
| Turnkey (read treasury)            | refunds and payouts                                                                           | treasury                             | S `TREASURY_TURNKEY_API_PUBLIC_KEY`, `TREASURY_TURNKEY_API_PRIVATE_KEY`; V `TREASURY_TURNKEY_ORG_ID`, `TREASURY_WALLET_ID`, `TREASURY_SENDS_ENABLED`; `READ_TREASURY_ADDRESS` in `@pickler/chain`                                                                                                                                                                    | PRD R18          |
| Turnkey (launch authority)         | signs launch grants                                                                           | api                                  | S `LAUNCH_AUTHORITY_TURNKEY_KEY_ID`; V `LAUNCH_AUTHORITY_ADDRESS`, `LAUNCH_GRANT_TTL_SECONDS`                                                                                                                                                                                                                                                                        | LD D3            |
| Supabase                           | Auth (studio email/OAuth, marketplace SIWE sessions), Postgres via Hyperdrive, Management API | api, web, operator                   | V `SUPABASE_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`; S `SUPABASE_SECRET_KEY`; build `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; operator `DATABASE_MIGRATION_URL_*`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`                                                                                                                              | PE               |
| Polymarket                         | Gamma (resolution timing), CLOB price history (clock 2), paper data; live pilot               | research, api; trading               | no key for public data; trading S `POLYMARKET_SIGNER_PRIVATE_KEY`, `POLYMARKET_SIGNER_ADDRESS`, `POLYMARKET_WALLET_ADDRESS`, `POLYMARKET_CLOB_API_KEY`, `POLYMARKET_CLOB_API_SECRET`, `POLYMARKET_CLOB_API_PASSPHRASE`                                                                                                                                               | DR, PRD, pilot   |
| Perpl                              | public market data, hosted research session, board; trading REST, key enrollment, faucet      | research, api, trading               | V `PERPL_ADMISSIONS_ENABLED`, `PERPL_STUDIO_ENABLED`, `PERPL_PAPER_ENABLED`, `PERPL_CHAIN_ID`, `PERPL_ENROLL_ORIGIN`, `PERPL_MAX_LEVERAGE`, `PERPL_PILOT_MAX_COLLATERAL_MICRO`, `PERPL_AGENT_GAS_FLOOR_MON`, `PERPL_BOARD_ENABLED`, `PERPL_BOARD_NETWORK`; S `PERPL_KEY_ENCRYPTION_KEY`, `PERPL_TESTNET_FAUCET_PRIVATE_KEY`. Perpl must whitelist the studio origins | PERPL, PAR, PR   |
| Monad RPC                          | balances, deposits, reads verification, launches, quotes, Perpl receipts                      | api, trading, treasury; indexer; web | V `CHAIN_ID`; S `MONAD_RPC_URL`; indexer S `RPC_URLS`; the web uses the public RPC constant in `@pickler/chain`, never a private URL                                                                                                                                                                                                                                 | PE (XR C22, C23) |
| Polygon RPC                        | CTF payout reads for resolution and settle                                                    | research, api                        | V `POLYGON_RPC_URL` (defaults to a public node)                                                                                                                                                                                                                                                                                                                      | DR               |
| Exa                                | search and page contents                                                                      | research                             | S `EXA_API_KEY`; tariff keys `exa.search`, `exa.contents`                                                                                                                                                                                                                                                                                                            | RR2              |
| The Odds API                       | sports odds                                                                                   | research                             | S `THE_ODDS_API_KEY`                                                                                                                                                                                                                                                                                                                                                 | RR2 (infra)      |
| balldontlie                        | sports data                                                                                   | research                             | S `BALLDONTLIE_API_KEY`                                                                                                                                                                                                                                                                                                                                              | RR2 (infra)      |
| Model provider (OpenAI-compatible) | research runs, studio drafter, exit checks                                                    | research, api                        | V `MODEL_BASE_URL`, `MODEL_ID`, `RESEARCH_TARIFFS`, `RESEARCH_MONTHLY_ALLOWANCE_MICRO_USD`; S `MODEL_API_KEY` (values must match on both, PE `model.same`)                                                                                                                                                                                                           | RR2, PE, DR      |
| X API v2 (Basic, paid)             | Connect X verification, optional posting                                                      | api                                  | S `X_BEARER_TOKEN`, `X_CLIENT_SECRET`, `X_TOKEN_ENCRYPTION_KEY`; V `X_CLIENT_ID`                                                                                                                                                                                                                                                                                     | GP D6–D9         |
| Firebase / APNs                    | push to the app                                                                               | api (PE) or jobs (MB)                | S `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`; APNs `.p8` uploaded to Firebase by the owner                                                                                                                                                                                                                                                                         | MB M5            |
| Resend                             | Supabase Auth SMTP, read receipts, exports, deletion notices                                  | api (PE); Supabase                   | V `EMAIL_FROM`; S `EMAIL_API_KEY`; SMTP credentials live in Supabase                                                                                                                                                                                                                                                                                                 | OPS O9           |
| Cloudflare Images and R2           | re-encode images to 512 px WebP; media, exports, backups                                      | api; GitHub Actions                  | B `IMAGES`, `MEDIA`, `EXPORTS`; V `MEDIA_PUBLIC_BASE_URL`, `MEDIA_UPLOAD_MAX_BYTES`, `MEDIA_UPLOADS_PER_HOUR`; GitHub `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `BACKUP_R2_BUCKET`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY`                                                                                                                    | TL §6.1, OPS     |
| Cloudflare platform                | rate limits, WAF, `send_email`, Turnstile, Queues, Hyperdrive                                 | api, ops, web                        | B `RL_AUTH`, `RL_PUBLIC`, `RL_FORMS`, `RL_MODEL`, `RL_MONEY`, `SEND_EMAIL`; S `RATE_LIMIT_SALT`, `OPS_ALERT_WEBHOOK_URL`; V `PROBE_URLS`; build `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; operator `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                                                                                                                           | OPS, PE          |
| Mera SDK (`@category-labs/mera`)   | marketplace passkey wallet, web and phone                                                     | web build, app                       | build `NEXT_PUBLIC_MERA_RP_ID` (`app.pickler.fun`), `NEXT_PUBLIC_MERA_WEB`                                                                                                                                                                                                                                                                                           | MW               |
| Apple / Google                     | AASA, universal links, `webcredentials`; `assetlinks.json` later                              | web                                  | build `AASA_ON_LANDING`, `PICKLER_DEPLOY_ENV`; app id `2PBQJ37Q8W.fun.pickler.app`                                                                                                                                                                                                                                                                                   | PHC, MB          |
| Safe, Sourcify, explorer           | launchpad operator and treasury roles; contract verification                                  | owner, operator                      | none in the repository (LD §6)                                                                                                                                                                                                                                                                                                                                       | LD               |
| External uptime monitor            | watches the account from outside                                                              | owner's account                      | —                                                                                                                                                                                                                                                                                                                                                                    | OPS O5           |

Other per-feature variables: `ADMISSIONS_ENABLED`, `TRADING_ADMISSIONS_ENABLED`, `RESOLUTION_ENABLED`,
`EXIT_MONITOR_ENABLED`, `PUBLIC_RECORD_ENABLED`, `REVIEW_EXPORT_ENABLED`, `TOKEN_LAUNCH_ENABLED`,
`LAUNCH_KEEPER_ENABLED`, `JOBS_ENABLED` (kill switches); `SIWE_DOMAIN`, `WALLET_EMAIL_DOMAIN`,
`ALLOWED_ORIGINS`, `ENCRYPTION_KEY` (S), `SUPER_ADMIN_EMAILS` (S), `PICKLER_RELEASE_SHA`;
`LAUNCH_MAX_GAS`, `LAUNCH_TICKER_RESERVATION_DAYS`, `LAUNCH_FACTORY_ADDRESS`,
`LAUNCH_FACTORY_DEPLOYMENT_BLOCK`, `CONFIRMATIONS`, `LAUNCH_KEEPER_PRIVATE_KEY` (S, trading);
`QUOTE_MAX_HEAD_AGE_SECONDS`, `QUOTE_MAX_INDEX_LAG_SECONDS`, `TRADE_DEADLINE_SECONDS`;
`MOBILE_MIN_VERSION_*`, `MOBILE_LATEST_VERSION_*`; `MON_GAS_TOPUP_WEI`, `ACCOUNT_DELETION_GRACE_DAYS`,
`HANDLE_QUARANTINE_DAYS`, `DUST_AUSD_MICRO`, `DUST_MON_WEI`; web build `NEXT_PUBLIC_{LANDING,
MARKETPLACE,STUDIO}_HOST`, `NEXT_PUBLIC_RELEASE_SHA`, `NEXT_PUBLIC_OAUTH_X_ENABLED`,
`NEXT_PUBLIC_TOKEN_TRADING`. The machine-readable list is `deploy/required-bindings.json` (PE §6.1);
each spec adds its names there in the same PR.

---

## 7. Design work backlog

Canvas names are the specs'. "Draw" = no canvas exists; "amend" = a canvas exists and changes. Every
new state also needs a harness route in `scripts/design/routes.mjs` (DH).

### 7.1 Studio (dark surface)

| Screen or state                                                                                                                    | Work  | Spec          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------- |
| Go Public card, steps 0–4, X idle/checking/not found/verified, all done, live ("Pickler Studio Empty v4")                          | amend | GP §7         |
| Wallet step RISK copy per venue; "PAPER UNTIL LIVE TRADING OPENS"; remove PICKLER MARKETS                                          | amend | GP §7         |
| Optional Reads step; `/studio/new` "CAPS NOT ON THE WALLET YET"; publish-success paper label                                       | draw  | GP §7, PRD §7 |
| Caps raise ceremony sheet; inline `CAPS_NEED_APPROVAL`                                                                             | draw  | GP §7         |
| Identity & voice section; Public profile section (avatar crop, links, thesis, fork opt-in, preview); Audience                      | draw  | GP §7, FORK   |
| START FROM "More" sheet, NEW chip, "Replace your brief?", `SOURCE_NOT_FORKABLE`, FORKED FROM card, "N of M lines"                  | draw  | FORK §7       |
| New canvas **Pickler Studio Decisions**: list, nine-block detail, review panel, "Settle" → "Check now" chips                       | draw  | SDR §7        |
| New canvas **Pickler Studio Record**: headline figures, calibration, rules and reasons, "not enough data"                          | draw  | SDR §7        |
| Home Picks card with resolution chip and one-line record; rail Picks → Decisions, new Record item                                  | amend | SDR §7        |
| Reads section: form, auto-closed reason, incoming reads, earnings and payouts                                                      | draw  | PRD §7        |
| Token section (none exists): not eligible, draft form with preview card, review sheet, passkey step, pending, launched, fees claim | draw  | TL §7, LD §7  |
| Perpl card (nine states), onboarding checklist sheet, positions and orders, add collateral / withdraw, stop and resume             | draw  | PERPL §7      |
| Perpl brief variant (BTC/ETH chips, "paper runs at 1x", margin wording); perps pick card; paper positions; "Trade it for real"     | draw  | PAR §7        |
| Map: Perpl venue Soon → selectable                                                                                                 | amend | PAR §7        |
| Limits → Research spend card; Schedule panel v2 (calendar, next runs, follow-ups) ("Pickler Studio v4")                            | draw  | RR2 §7        |
| Activity row with cost, `BUDGET_EXHAUSTED`, follow-up link; category picker live/soon                                              | amend | RR2 §7        |
| Withdraw sheet (gas step, schedule-off ack); Account → Wallets; send sheet; transfers list                                         | draw  | CUST §7       |
| Security → remove passkey; untrusted credential notice; clean up an unused wallet                                                  | draw  | CUST §7       |
| Privacy → export data; recovery phrase in Turnkey's iframe; delete account with grace banner ("Pickler Account")                   | draw  | CUST §7       |
| `/studio/new` "You have drafted a lot this hour"; Turnstile on the signup email step                                               | draw  | OPS §7        |
| Phone layouts wherever `layout.mjs` finds overflow                                                                                 | draw  | DH §7         |

### 7.2 Marketplace web (light surface)

| Screen or state                                                                                                                                                                                                           | Work  | Spec         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------ |
| Degraded line "The board is catching up" on `/agents`, `/leaderboard`, `/markets`, `/reads`                                                                                                                               | amend | PE §0.1      |
| Agent profile: record, Sealed row, Decisions list, server Follow and count, "No resolved decisions yet"; avatar, X badge, links, thesis; "Started from @x's brief", "Forks · N" ("Agent Profile Light", "Pickler Public") | amend | PR, GP, FORK |
| New canvas **Pickler Receipt** (web and phone width) with Verify block                                                                                                                                                    | draw  | PR §7        |
| Leaderboard with "Unranked — building a record"; `/activity` tabs Everyone / Following; directory score and followers                                                                                                     | amend | PR §7        |
| `/markets` network tag, "Updated Ns ago", stale/unavailable, "—" figures, interim SAMPLE label ("Pickler Market Web")                                                                                                     | amend | PR §7        |
| Ask flow: remove 4h/7d; chips "PUBLIC OUTCOME CARD" / "PRIVATE" ("Read Light")                                                                                                                                            | amend | PRD §7       |
| Pay states: sign-in, wallet chooser, awaiting wallet, wrong chain, verifying, preparing countdown, delivered, refunded, expired, price changed, capacity full                                                             | draw  | PRD §7       |
| Public outcome card; "Email me receipts" and verify page; read receipt page; dispute sheet, "Under review"                                                                                                                | draw  | PRD §7       |
| New canvas **Pickler Wallet Chooser** (Mera first, browser wallet, unavailable, connecting, error)                                                                                                                        | draw  | MW §7        |
| Mera create / sign-in states; `MERA_PRF_UNAVAILABLE` fix list                                                                                                                                                             | draw  | MW §7        |
| New canvas **Pickler Signing Sheet**: sign in, pay, trade (incl. approval 1 of 2), mismatch, needs MON, sent, confirmed, failed                                                                                           | draw  | MW §7, TT §7 |
| Account sheet → Wallets (rename, remove, last wallet, link, limit); switch wallet; Following; inbox bell                                                                                                                  | draw  | MW §7, MB §7 |
| Connect modal "Too many sign-in attempts"                                                                                                                                                                                 | draw  | OPS §7       |
| `/tokens` footer "Indexed to block N", stale, paused banner, testnet venue label                                                                                                                                          | amend | LD §7        |
| Token page: curve, graduating, pool read-only, no linked agent, stale, not found                                                                                                                                          | amend | TT §7        |
| New canvas **Pickler Token Trade** ticket (quoting, ready, stale, remainder, approval, insufficient, Finalize)                                                                                                            | draw  | TT §7        |
| Portfolio: average cost, P&L, pending rows, balances unavailable ("Portfolio Light")                                                                                                                                      | amend | TT §7, MB    |
| Delete account for wallet-only accounts (SIWE proof)                                                                                                                                                                      | draw  | CUST §7      |

### 7.3 Mobile app (outside this repository; extend the mobile flows canvas)

| Screen or state                                                                                              | Work  | Spec       |
| ------------------------------------------------------------------------------------------------------------ | ----- | ---------- |
| Update required (426)                                                                                        | draw  | MB §7      |
| Move your funds: prompt, checking, nothing to move, balances, signing 1 of 2 / 2 of 2, moved, failed, closed | draw  | MB §7, PHC |
| Sign in with Mera: create, restore, PRF unavailable, cancelled, network error; native signing sheet          | draw  | MB §7, MW  |
| Notification pre-prompt, inbox, notification settings, following                                             | draw  | MB §7      |
| New canvas **Pickler Mobile Record**: persona record, receipt, activity tabs, follow                         | draw  | PR §7      |
| Agent profile header additions and fork lines ("Agent Profile Mobile Light")                                 | amend | GP, FORK   |
| Pay with Mera sheet, verifying, preparing, delivered, refunded, receipt ("Read Mobile Light")                | draw  | PRD §7     |
| Token screen and one-sheet trade flow; portfolio tab with balances unknown, never 0                          | draw  | TT §7, MB  |

### 7.4 Landing

Waitlist inline "Slow down — try again in a minute" (OPS §7); header and footer link targets
(`Build an agent` → `studio.pickler.fun/apply`) (PHC §7, H12); DH V8 makes the landing its own product
in the harness.

---

## 8. Build plan

The phases are XR §5.3's, updated for what changed after the review: CONV 15 keeps both
`workers/jobs` and `workers/ops` (XR W1 recommended dropping jobs); the media store is its own
phase-1 migration (XR C8); `perpl-agent-runtime-v1` now exists, so PERPL depends on PAR and not on
RR2 (XR G1, K1), and PAR brings Perpl paper trading forward to phase 3; read runs are enrolled with
`audience = buyer` rather than excluded (DR D16). A phase can start when its predecessors' exit
criteria hold; tracks inside a phase run in parallel.

### Phase 0 — close the incident (now, no dependency)

- PE §0.1: `apiRead` degraded reads on public pages (web only).
- PE §0.2 Step A: API, research and trading from `main`, without Turnkey or SIWE; `GET /v1/health`
  checked first (§9.4 item 19); research admissions decided before deploy (§9.4 item 22). First ledger
  line recorded by hand.
- OPS step 1: logs with cause. DH V1, V2 (report mode), V11, V10.
- **Exit:** `pickler.fun/agents`, `/leaderboard`, `/markets` answer 200 with no `data-degraded`;
  `/api/v1/marketplace/directory` and `/api/v1/launches` answer 200; `api-read.test.ts` passes.
- **Unblocks:** everything; it stops the web outrunning the API.

### Phase 1 — platform foundations

- PE: `release.yml`, `release.mjs`, smoke list and ledger on staging; Workers Builds production deploy
  off; production configs, `check:production`, `pickler_app` role, Hyperdrive, queues and DLQs once
  Q-ENV-1 is answered.
- OPS: `ops` migration (M1), rate-limit bindings and the nonce cap, `workers/ops` on staging, DLQs,
  backups of every schema and a restore drill, Supabase hardening and Data API un-exposure.
- `workers/jobs` and `workers/treasury` skeletons in the release order (PE D8).
- PHC code (three hosts, `hrefFor`, AASA route handlers, `assert-hosts`) and the staging rehearsal on
  `stg.` hosts.
- TL §6.1 media store (M3), standalone.
- DH V7 (fixture failures), V8 (landing and split hosts).
- **Owner answers needed:** Q-ENV-1 (Supabase project), Q-ENV-6 (schema boundaries, before any phase-2
  migration).
- **Exit (PE §9, OPS §9):** a staging release writes a ledger line with a version id per Worker; a
  forced failure stops the run; `--rollback-to` refuses a target older than a breaking migration; the
  verifier passes on staging; a restore drill is recorded.
- **Unblocks:** every spec that adds a Worker, binding, queue, bucket or alert.

### Phase 2 — identity and record foundations (parallel tracks)

- **Hosts:** PHC production cutover through Step B and the owner's first studio passkey
  (`rpid-committed`), after the staging/production RP question is settled (§9.4 item 20).
- **Wallets:** MW migration (M2) and API (`kind`, labels, 5-wallet cap); web Mera behind its flag only
  after Q-MOB-2 and Q-MOB-4.
- **Mobile contract:** MB app-config, version gate, the `/v1/marketplace/*` envelope switch with the
  web (needs the app's source, Q-MOB-1).
- **Studio:** GP migration (M4) and the switch of every marketplace reader to `visibility`; voice and
  profile sections.
- **Resolution:** DR `decision_resolutions` (M8), enrolment, backfill, staging cron, acceptance 17
  (≥ 10 real decisions checked by hand against Polygonscan), then `RESOLUTION_ENABLED`.
- **Runtime:** RR2 budget (M6) and the paid staging acceptance (Q-ENV-10), then calendar and
  follow-ups (M7, which owns the `run_trigger` change).
- **Custody:** CUST housekeeping, Wallets list and withdraw (M19).
- **Launchpad:** LD contract change and internal review (§9.1 of LD), indexer v2 rebase, migration M15,
  testnet deploy with Safes (Q-LCH-1), manifest.
- **Perps protocol:** PAR step 1 (types, policy, `perps_direction` M13) once DR's venue check exists.
- **Exit:** existing agents are still public and drafts are absent from `/v1/marketplace/*`; resolved
  decisions match Polygonscan by hand; a studio passkey exists on `studio.pickler.fun`; a staging
  throwaway agent's launch appears on `/v1/launches/:id` within 3 minutes (LD §9.2).
- **Unblocks:** publication, reads, token launch, Perpl paper.

### Phase 3 — publication, studio features, Perpl on paper

- PR: follows (M10) and web import, publication inside the resolution transaction, public routes
  behind `PUBLIC_RECORD_ENABLED`, receipts, the real perps board once PRs #60/#63 merge.
- SDR: Decisions list and detail, reviews (M11); Record section after a week of resolutions.
- GP: X verification, caps ceremony, publish, outbox (needs Q-PUB-1).
- FORK (M5). DR exit monitor (M9, acceptance 18, then `EXIT_MONITOR_ENABLED`).
- TL: studio token launch after LD's deployment and GP.
- PAR steps 2–4: hosted Perpl session in research, paper exits in jobs, studio screens, R9 acceptance
  (20 paper runs on BTC and ETH, ≥ 18 decisions, every scored decision resolved at its horizon), then
  `PERPL_PAPER_ENABLED=true` on staging.
- **Exit:** a public agent's resolved calls show on its page and on `/receipts/[publicId]`; a draft goes
  public through all four steps; a staging public agent launches its token on 10143 and the studio shows
  "Launched" within 3 minutes (TL §9); Perpl paper acceptance recorded in
  `docs/staging-acceptance-perps-<date>.md`.
- **Unblocks:** paid reads (need public agents and the price source), token trading, Perpl live
  eligibility (5 resolved paper decisions per agent, PAR A15).

### Phase 4 — money on testnet

- PRD (M12): read service in the studio, then intents, verification and delivery with
  `TREASURY_SENDS_ENABLED=false`, then automatic refunds, evaluation and payouts.
- TT (M17): routes, watcher, trade ticket behind `NEXT_PUBLIC_TOKEN_TRADING`, then the keeper.
- CUST: send, passkey removal, orphan cleanup, export and deletion (M20, last).
- MB: notifications and devices (M18), then the mobile release on the enveloped API.
- **Exit (PRD §9, TT §9):** real testnet buys from an EOA and from Mera, a forced refund, an evaluation
  and the next day's payout; a Mera and a MetaMask wallet buy and sell a token, holders and candles
  update within 2 minutes, the keeper finalizes graduation within 2 minutes; the app completes a Mera
  buy.
- **Unblocks:** the mainnet decisions.

### Phase 5 — live trading and mainnet gates

- PERPL testnet: manifest and ABI pin, `perpl_live` (M14), trading-worker composition with admissions
  off, studio routes and screens, Perpl origin whitelisting, a funded faucet (Q-PRP-1), then the §9
  acceptance: seven-step onboarding, ≥ 3 orders and a cap refusal, a forced stop, kill and resume,
  24 hours of clean reconciliation, a withdraw, realized P&L in `decision_live_pnl` and the receipt.
- RR2 crypto up/down category (after DR).
- Mainnet gates: Perpl pilot (testnet record, a 10 AUSD dry run, leverage 2, 100 AUSD cap, owner
  go-ahead; Q-PRP-2); launchpad audit, presets, fee and licence (Q-LCH-2, Q-LCH-3); paid-read
  regulation, tax, sanctions and treasury custody (Q-PAY-1 to Q-PAY-4); post-graduation trading venue
  (TT Q1).

### Cross-cutting sequence constraints

- **One-way doors, in order:** `TURNKEY_RPID` (PHC step 5, first passkey at step 7) → Mera RP
  (first Mera enrolment after MW acceptance) → apex AASA removal (day 90) → `agents.agent_credentials`
  drop (RR2) → any resolution revision or ledger entry (append-only by design).
- **Every spec that ships a public route** adds one anonymous request to `deploy/smoke.<env>.json`
  (PE §3.6), its bindings to `deploy/required-bindings.json` (PE §6.1), and its alerts to OPS §6.2.

---

## 9. Decisions the owner must make

Deduplicated from every spec's §12 and XR §8. **B** blocks building; **M** blocks mainnet only;
**D** has a safe default and building proceeds. The default is what the specs assume if the owner
says nothing.

### 9.1 Blocking now

| Id       | Question                                                                                                                            | Blocks                                                      | Default / recommendation                                                                                                        | Sources                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Q-ENV-1  | Separate production Supabase project, one project with separate schemas, or promote the current one? Plan and PITR?                 | PE production configs, Hyperdrive, first production release | **Separate project** (option B) on a plan with PITR; the current project stays staging                                          | PE Q1, OPS Q3           |
| Q-ENV-6  | Accept or park `schema-boundaries-v1` (rename `pickler` → `runtime`, `wallets` → `signing`, uuid agent ids) before production data? | the names of every phase-2 migration                        | Decide before phase 2. Recommendation: accept the id unification, park the renames, so new tables are born with the final names | R05 Q10, R06 S10, XR G3 |
| Q-ENV-10 | Authorise the paid staging acceptance (≤ 3 paid runs plus 1 refused) and the trading pilot's funded purchase                        | the acceptance records (not the code)                       | Authorise; it is the only evidence that remote research works                                                                   | RR2 Q2, R06 Q10         |
| Q-MOB-1  | Where is the iOS app's source, who owns it, and who ships the `app.pickler.fun` build?                                              | PHC step 8, all of MB §10.3, the envelope switch timing     | No default; without it the 90-day "Move your funds" window can expire before the build exists                                   | PHC Q1, MB Q1           |
| Q-MOB-2  | Does the phone use Mera's PRF model or the vault model?                                                                             | MW D2 (one-way once funds are held), web Mera               | PRF (MW D2), so one passkey gives one address on web and phone                                                                  | MW Q1, MB §10.3         |
| Q-MOB-3  | Have TestFlight testers put funds on `pickler.fun`-derived addresses? Is 90 days the right window?                                  | removing the apex AASA                                      | 90 days (CONV 14); shorten only if the answer is "no funds"                                                                     | PHC Q2, MB Q4           |
| Q-MOB-4  | Accept the key-in-page risk of Mera on the web (D5/D6 now, a signer iframe in v1.1)?                                                | web Mera only; the EOA ships regardless                     | Accept, with the one-ceremony key lifetime and strict CSP                                                                       | MW Q2, PHC Q4           |
| Q-PUB-1  | Does Pickler have an X developer account, who owns it, and is the Basic tier cost approved?                                         | Connect X, therefore Go Public as specified                 | Yes to Basic; otherwise make X optional (Q-PUB-2)                                                                               | GP Q1                   |
| Q-LCH-1  | Who are the signers of the operator Safe and the treasury Safe?                                                                     | the testnet factory deploy (the operator is immutable)      | 2-of-3 each (testnet operator may be 1-of-2)                                                                                    | LD Q3                   |
| Q-PRP-1  | Will Perpl grant testnet USD for Pickler's faucet, or is there a public faucet?                                                     | Perpl testnet onboarding                                    | Ask Perpl for an allocation                                                                                                     | PERPL Q1                |

### 9.2 Blocking mainnet only

| Id      | Question                                                                                              | Default / recommendation                                           | Sources          |
| ------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| Q-PAY-1 | Is selling a probability regulated where Pickler serves? Terms, geo-blocking, KYC?                    | legal review before mainnet; testnet proceeds                      | PRD Q1           |
| Q-PAY-2 | Taxes: seller of record, marketplace facilitator, payout reporting?                                   | legal review                                                       | PRD Q2           |
| Q-PAY-3 | Sanctions screening before mainnet?                                                                   | likely yes                                                         | PRD Q6           |
| Q-PAY-4 | Treasury custody (Turnkey parent-org wallet, multisig or KMS); who tops up MON and resolves disputes? | Turnkey parent org for testnet (PRD R18); settle before real money | PRD Q4           |
| Q-LCH-2 | Licence: BUSL-1.1 → GPL-2.0 in 2030, MIT, or proprietary?                                             | BUSL-1.1 (LD D7) for testnet                                       | LD Q1            |
| Q-LCH-3 | Mainnet preset numbers, launch fee, audit firm and budget                                             | fork-test numbers and fee 0 on testnet                             | LD Q2, Q4, TL Q1 |
| Q-LCH-5 | Post-graduation trading inside Pickler or an external DEX; a Pickler trade fee?                       | testnet: read-only pool, no fee                                    | TT Q1, Q2        |
| Q-PRP-2 | Mainnet Perpl pilot size                                                                              | 100 AUSD per agent, 2x                                             | PERPL Q2         |

### 9.3 Safe defaults (building proceeds)

| Theme       | Question                                                                                | Default                                                | Sources          |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------- |
| Platform    | GitHub may hold the Cloudflare token and production migration URL?                      | operator-run `release.mjs` with the same ledger        | PE Q2            |
| Platform    | Turn off Workers Builds production auto-deploy?                                         | off                                                    | PE Q3            |
| Platform    | Who may release, merge and add `design:intended`?                                       | owner only                                             | PE Q4, DH Q2     |
| Platform    | Alert email, chat webhook, external uptime monitor?                                     | webhook only until answered                            | OPS Q1, Q2       |
| Platform    | Resend for Auth SMTP and transactional mail?                                            | Resend                                                 | OPS Q3           |
| Platform    | Model draft ceiling 200 per day per environment?                                        | 200                                                    | OPS Q4           |
| Platform    | Upgrade GitHub for branch protection; phone checks blocking from day one?               | `/merge` gate; report mode                             | DH Q1, Q3        |
| Hosts       | Wallet sign-in on `pickler.fun` before the cutover?                                     | off until Step B                                       | PE Q5            |
| Mobile      | Firebase project and APNs key?                                                          | build proceeds; push waits                             | MB Q2            |
| Mobile      | Android package and release key                                                         | `[]` until Android                                     | PHC Q3, MB Q3    |
| Money       | Fee 10%; any share to the agent's token; fork royalties?                                | 10%, no royalty                                        | PRD Q5, FORK Q1  |
| Money       | Buyers pay MON gas, or gasless EIP-3009?                                                | buyer pays                                             | PRD Q3           |
| Money       | Who pays for research after the beta; who pays exit checks (48/agent/day)?              | Pickler, $5/agent/month; exit checks as research spend | RR2 Q1, DR Q2    |
| Publication | X required for Go Public; verification line may tag `@pickler`?                         | required; yes                                          | GP Q2, Q3        |
| Publication | Unpublish?                                                                              | kill only                                              | GP Q4            |
| Publication | Add Brier skill to the leaderboard score?                                               | existing `agentScore`                                  | DR Q1            |
| Publication | Pre-ship decisions public; thesis opt-out for read sellers; follower count threshold    | yes; thesis published; counts from day one             | DR Q3, PR Q1, Q2 |
| Publication | Export owners' reviews for evaluation datasets; pause Jev until 200 labels?             | export off; no default on Jev                          | SDR Q1, Q2       |
| Publication | Fork opt-in default; minimum record to be listed                                        | off; no minimum                                        | FORK Q2, Q3      |
| Launchpad   | Minimum record before launching; metadata edits after launch                            | public is enough; frozen                               | TL Q2, Q3        |
| Perpl       | Builder code and fee; seven passkey prompts or a Turnkey session                        | none; seven prompts                                    | PERPL Q3, Q4     |
| Perpl       | Default horizon 24 h with 4 and 72; paper at 1x                                         | yes; 1x                                                | PAR Q1, Q2       |
| Custody     | Retention of financial rows after deletion; Turnkey cost of undeletable orphan sub-orgs | keep with a tombstone; accept                          | CUST Q1, Q2      |
| Trading     | Polymarket user custody (R02 item 6)                                                    | no spec until answered                                 | R02 Q3, XR G5    |

### 9.4 Where the specs still disagree

Found by re-reading the specs after the cross-review was applied. Items 1–14 need a decision before
the owning code is built; 15–36 are cleanups. Each has a recommendation; none changes a spec here.

| #   | Disagreement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Specs                  | Recommendation                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | **Job and queue homes.** MB M14 and §6 put the notification claim, the `pickler-notifications` producer and consumer, and the FCM secrets on `workers/jobs`; CUST §6 has jobs consume `pickler-account-jobs`. PE §6.4 says both queues run api → api, puts FCM on the API, and gives jobs only `API` and `TRADING` bindings and no secrets (PE `:494`, `:542-543`).                                                                                                                                       | MB, CUST vs PE         | Keep PE's rule (jobs only triggers internal routes); queues api → api; MB and CUST change                          |
| 2   | **Deposit reconciler home:** `workers/ops` (CUST C10, §6) vs `workers/jobs` `*/15` (OPS O12, PE §6.6).                                                                                                                                                                                                                                                                                                                                                                                                    | CUST vs OPS, PE        | jobs (it repairs product money records, CONV 15); CUST changes                                                     |
| 3   | **Media sweeper home:** `workers/ops` (TL §6.1) vs jobs `0 3 * * *` (PE §6.6); its route is unnamed.                                                                                                                                                                                                                                                                                                                                                                                                      | TL vs PE               | jobs, with a named internal route                                                                                  |
| 4   | **`LAUNCH_KEEPER_ENABLED`** on trading (TT §6.3) vs api (PE §6.1).                                                                                                                                                                                                                                                                                                                                                                                                                                        | TT vs PE               | trading, where the keeper key lives                                                                                |
| 5   | **`decision_live_pnl` shape:** DR §5.7 has `id` PK, unique `(run_id, venue, source_ref)`, correction rows; PERPL §5 has `run_id` PK, `position_id`, `closed_at` and still says "created by DR if it takes C5, otherwise by `perpl_live`".                                                                                                                                                                                                                                                                 | DR vs PERPL            | DR's shape; PERPL writes `source_ref` = position id and drops the hedge                                            |
| 6   | **Live perps exits.** PAR A14 puts horizon, stop and take-profit exits for live positions in `workers/trading`; PERPL's minute cron lists only reconciliation, risk stops and key expiry; `perpl_positions` has no `exit_due_at`, stop or take-profit columns and no `take_profit`/`horizon` close reasons. Two stop systems (PAR bps vs PERPL collateral) with no precedence.                                                                                                                            | PAR vs PERPL           | PERPL adds the columns, reasons and cron work; whichever stop fires first wins                                     |
| 7   | **Two position routes:** PAR `GET /perps/positions?source=live` (`PerpsPositionDto`) and PERPL `GET /perpl/positions` (`PerplPositionDto`).                                                                                                                                                                                                                                                                                                                                                               | PAR vs PERPL           | one route and one DTO (PAR's), PERPL's becomes an alias or goes                                                    |
| 8   | **Which network scores a Perpl decision:** product paper uses mainnet market data (PAR §6), live starts on testnet (PERPL P1), and DR observes "the network the decision was made on".                                                                                                                                                                                                                                                                                                                    | PAR, PERPL, DR         | score on the network of the market data the decision used; state it in PAR §4                                      |
| 9   | **`GET /v1/studio/venues`** is defined in PERPL §4 but must exist for PAR's paper release, which ships first.                                                                                                                                                                                                                                                                                                                                                                                             | PERPL vs PAR           | move it to PAR's rollout                                                                                           |
| 10  | **PAR's 4-hour cadence uses all six daily runs** (`MAX_LIMITS`), leaving none for RR2 follow-ups, which count against `dailyRuns`, and consumes the $5 allowance.                                                                                                                                                                                                                                                                                                                                         | PAR vs RR2             | default every 6 hours, or raise `dailyRuns` for perps agents                                                       |
| 11  | **PE does not know PAR:** no per-minute paper-exit cron in PE §6.6, no `PERPL_PAPER_ENABLED` or hosted-session variables in the inventory.                                                                                                                                                                                                                                                                                                                                                                | PAR vs PE              | add them to PE §6.1 and §6.6                                                                                       |
| 12  | **Cheap reads cannot fit a run.** RR2 R5 says a read whose ceiling is below one run's ceiling "is refused at purchase by paid-reads-v1"; PRD has no such check or error, and at the 1 AUSD minimum the ceiling is 0.10 AUSD, so cheap services fail every read and auto-close (R13).                                                                                                                                                                                                                      | RR2 vs PRD             | PRD refuses such prices at configure time (a computed minimum price) and at purchase                               |
| 13  | **Read throughput:** RR2 allows one read run per agent at a time (240 s each); PRD allows 200 reads a day with a 10-minute clock and never ties capacity to throughput.                                                                                                                                                                                                                                                                                                                                   | RR2 vs PRD             | cap open reads per agent at what fits the chosen clock                                                             |
| 14  | **Email ownership and shape.** PRD §6 sends email "by `workers/jobs`" through a generic provider; OPS O9 owns Resend and PE puts `EMAIL_*` on the API. MW D11 still cites `identity.profiles.notify_email` (now `identity.notify_emails`). MB still shows `409 EMAIL_REQUIRED` (removed by PRD R11), omits `receipts`, the verify and DELETE routes. Two email switches: `notify_emails.receipts` (PRD) and `notification-preferences.email` (MB).                                                        | PRD, MW, MB vs OPS, PE | API sends through OPS O9; MB's preferences decide per type and PRD's `receipts` becomes one of them; fix MW and MB |
| 15  | GP D2's prose says existing "non-draft, non-killed" agents become public; its SQL (and XR C14) uses `status <> 'draft'`, which keeps killed agents' pages.                                                                                                                                                                                                                                                                                                                                                | GP                     | fix the prose                                                                                                      |
| 16  | Not-owner code: GP §4 reads "403 404 `AGENT_NOT_FOUND`"; CONV has no "another owner's resource is 404" rule (XR C21).                                                                                                                                                                                                                                                                                                                                                                                     | GP, CONV               | add the rule to CONV; fix GP                                                                                       |
| 17  | CONV not yet updated: `/v1/me/*` as any signed-in user's account and `/v1/agents/*` no longer HMAC (XR E5, RR2 R12); status codes 413, 426, 502 (E9); `error.detail.retryAt` (E10); provider costs in micro-USD (C15); the backend-Turnkey carve-out (V2); decision 1's wording for readers (V1); "Pricing section" vs PRD's "Reads" (CONV 4).                                                                                                                                                            | CONV                   | one CONV edit                                                                                                      |
| 18  | PE contradicts itself: `TURNKEY_DELEGATED_API_PRIVATE_KEY` on api and trading fails PE's own one-signer check and PERPL §8; "no backend routes" vs `ops.pickler.fun/__operator`; jobs writes heartbeats but has no `DATABASE`; treasury's daily self-check has no cron; `JOBS_ENABLED` is not in the flag checks; the verifier calls `/v1/internal/ready` through `ops call`, which OPS's allowlist does not list; PE still says MW uses `NONCE_IP_SALT` and that MB's DLQ lacks `-<env>`.                | PE, OPS, PERPL         | PE cleanup PR                                                                                                      |
| 19  | PE §0.2 says `main` answers `/v1/health` with 404 and adds it; on `main`, `growthRoutes` mounts `GET /health` under `/v1` (`workers/api/src/routes/growth.ts:31`, `app.ts` growth mount), so `/v1/health` may already exist.                                                                                                                                                                                                                                                                              | PE vs code             | check before Step A; if it exists, PE §4.1 changes that handler instead of adding one                              |
| 20  | The combined runbook opens the RP door on the staging Workers that serve `pickler.fun` (`TURNKEY_RPID=studio.pickler.fun` on the staging project), contradicting PHC H11 (staging RP `studio-stg`) and PE §5.1 ("no passkey or wallet account exists that could need to" move).                                                                                                                                                                                                                           | PE, PHC                | do Step B only on production Workers against the production project, or accept a data carry-over and say so        |
| 21  | The 90-day apex window counts from PHC step 2, while the app build (step 8) waits on Q-MOB-1; XR X2 proposed counting from the build.                                                                                                                                                                                                                                                                                                                                                                     | PHC, MB                | start the clock when the "Move your funds" build ships                                                             |
| 22  | Step A deploys research from `main` with staging `ADMISSIONS_ENABLED=true`, which admits due schedules and spends provider money; PE D12 only closes production.                                                                                                                                                                                                                                                                                                                                          | PE                     | deploy research with admissions closed and open them deliberately                                                  |
| 23  | `UNIVERSAL_LINK_PATHS` lives in `packages/api-schema` (MB M10) or `apps/web/src/server/aasa.ts` (PHC §5). The list itself agrees.                                                                                                                                                                                                                                                                                                                                                                         | MB vs PHC              | api-schema (the app contract), imported by the web                                                                 |
| 24  | `media.uploads.owner_id` references `identity.profiles`; CUST deletes profiles and keeps uploads attached to a launched token with a tombstone id, which the FK blocks; marketplace accounts have no profile row.                                                                                                                                                                                                                                                                                         | TL vs CUST, MW         | key `media.uploads` on `auth.users.id` without an FK, like the other person tables                                 |
| 25  | DR's alerts `resolution_lag`, `identity_missing_backlog`, `exit_check_failures` are not in the OPS §6.2 registry (only `resolution_stale`, `commitment_mismatch` are).                                                                                                                                                                                                                                                                                                                                    | DR vs OPS              | add them in DR's PR                                                                                                |
| 26  | SDR's `publicCommitment` is non-null while DR leaves it null for owner and buyer decisions; the settle alias's response body is undefined; several DTOs (`ResolutionStateDto`, `DecisionRowDto`, `ReviewDto`, …) are used but not defined.                                                                                                                                                                                                                                                                | SDR vs DR              | SDR makes it nullable and defines the DTOs                                                                         |
| 27  | DR D15 cites "PAR §6.3" (wrong section; the rule is PAR A8); DR §6.3 still says "fixed 24 h until that spec sets the horizon"; PAR says close/hold are never enrolled as scored, DR says enrolled but never scored.                                                                                                                                                                                                                                                                                       | DR vs PAR              | DR points at PAR A3/A8; settle "enrolled, not scored"                                                              |
| 28  | Launchpad gaps: `/v1/internal/launch/reconcile`, `/v1/internal/tokens/trades/watch`, the keeper route and the media sweeper are in no §4 table; nobody owns the `PresetPublished → launch.presets` mirror that grants need; `fees/claim/submit` and `abandon` take no idempotency key; not-deployed is a 503 in TL §4 but an eligibility state in TL T1; TL §8 hard-codes chain 10143; `contracts/AGENTS.md` still gives the old factory constructor; the treasury's protocol-share claim is unspecified. | LD, TL, TT             | LD owns the preset mirror; TL and TT add their internal routes; the rest in the build PRs                          |
| 29  | `read_id` is `uuid` on `pickler.runs` and `pickler.decisions` but `text` in RR2's `pickler.run_costs`.                                                                                                                                                                                                                                                                                                                                                                                                    | RR2 vs PRD, DR         | `uuid`                                                                                                             |
| 30  | Exit-check spend: DR §3.4.5 charges it as research spend, DR §12 Q2 still asks who pays.                                                                                                                                                                                                                                                                                                                                                                                                                  | DR                     | research spend under RR2, drop the question                                                                        |
| 31  | Two operator files: `deploy/operators.txt` (GitHub logins, PE and DH) and `deploy/operators.json` (Ed25519 keys, OPS).                                                                                                                                                                                                                                                                                                                                                                                    | PE, DH vs OPS          | keep both, each named for its use                                                                                  |
| 32  | DH's host checks expect the AASA only on the marketplace (PHC serves `webcredentials` on the landing for 90 days, and on `either`); PE's degraded fixture answers 503, DH's 404; OPS asks for harness routes for every rate-limited state, DH adds one.                                                                                                                                                                                                                                                   | DH vs PHC, PE, OPS     | DH follows PHC and PE                                                                                              |
| 33  | OPS makes ops the tail consumer of five Workers and its log enum lacks `jobs` and `treasury`; PE puts `tail_consumers` on all eight; nothing alerts on the treasury heartbeat.                                                                                                                                                                                                                                                                                                                            | OPS vs PE              | OPS covers all eight                                                                                               |
| 34  | Every spec claims migration 0023.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | all                    | number at merge in the order of §5.2                                                                               |
| 35  | GP's `PUBLISH_BLOCKED` lists `FIRST_RUN`, which no step defines.                                                                                                                                                                                                                                                                                                                                                                                                                                          | GP                     | define it (a draft already has its preview run) or drop it                                                         |
| 36  | PRD's `GET read-service` omits `AGENT_KILLED` from `autoClosedReason` although its CHECK allows it; PRD restates its own rate limits instead of linking OPS §4.1 (the values match).                                                                                                                                                                                                                                                                                                                      | PRD                    | cleanup                                                                                                            |

---

## 10. Glossary

| Term                              | Meaning                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent                             | A configured research agent owned in the studio: a brief, caps, a schedule, a venue, and (once funded) its own Turnkey wallet.                                                                    |
| Brief                             | The agent's rules: thesis, reads, `entersWhen` (required), `exitsWhen`, `never`; validated by `assertBrief` (`studio-brief-v1`).                                                                  |
| Preview run                       | "Run it on paper" before the agent exists; owner-only, 24 h, 5 per hour (`pickler.preview_runs`).                                                                                                 |
| Draft                             | (studio) A private agent created from a brief, no wallet yet, at most 3 per workspace. (launchpad) A `launch.drafts` row for one token launch. The context says which.                            |
| Visibility                        | `private` or `public`, separate from lifecycle `status`; set only by Go Public (GP D1).                                                                                                           |
| Go Public                         | The one transition from private to public: Voice, Connect X, Its wallet, Fund it, optional Reads, then `publish` (GP).                                                                            |
| Voice                             | One of six presets for how the agent's posts read; never how it trades (GP D4, D5).                                                                                                               |
| Connect X                         | Proving control of an X account by posting a `pk-` code; posting is a separate optional OAuth grant through an outbox (GP D6–D8).                                                                 |
| Caps                              | Spending limits per trade and per day; per trade in the wallet's Turnkey policy on on-chain venues, per day (and on Perpl, both) in Pickler's trading code (GP D11, PERPL P8).                    |
| Venue                             | Where an agent trades: Polymarket (paper today) or Perpl (paper, then live). One per agent (PAR A10). Also the post-graduation DEX for tokens (TT).                                               |
| Run                               | One research execution: `manual`, `schedule`, `follow_up` or `read` (RR2).                                                                                                                        |
| Follow-up                         | A later run the model asks for, 60 min to 72 h out, one pending per agent and market (RR2 R11).                                                                                                   |
| Allowance                         | The research budget Pickler pays per agent: $5 a month (RR2 R4).                                                                                                                                  |
| Decision                          | A completed run's TRADE or ABSTAIN. A **call** is a public TRADE, a **pass** a public ABSTAIN, **held** a trade a rule stopped (DR, PR).                                                          |
| Enrolment                         | Writing a `pickler.decisions` row, with its hash, commitment, audience and next check time (DR §3.1).                                                                                             |
| Resolution                        | The append-only record of what happened to a decision, from the venue's settlement (CTF payout; Perpl mark at the horizon), with its scores. A **revision** is an operator correction (DR).       |
| Audience                          | Who may see a decision: `public` (agent public at decision time), `owner` (private agent), `buyer` (a paid-read run). Only `public` is ever published (DR D16, CONV 10).                          |
| Sealed                            | A public decision not yet resolved, shown only as a commitment hash and a time (PR P1).                                                                                                           |
| Public id                         | `dcs_` plus 20 characters, given to a public decision at publication; the key of its receipt (PR).                                                                                                |
| Receipt                           | (decision) The self-contained proof of one resolved decision, public at `/receipts/[publicId]`. (read) The payment receipt of a paid read at `/reads/:id/receipt`. Two different things (XR E11). |
| Record                            | An agent's aggregates in `agent_records`: hit rate, Brier, calibration gap, virtual net, streak, form; `owner` and `public` scopes (DR D8).                                                       |
| Hit rate, Brier, calibration      | Hits over resolved trades; mean `(p−y)²`; expected calibration error over 10 buckets, in points (DR D4).                                                                                          |
| Virtual P&L                       | 1 AUSD per TRADE at the observed ask, always labelled "virtual" (DR D5, PR P11). Paper and live P&L are separate.                                                                                 |
| Activity                          | The public feed in `agents.public_activity`: calls, passes, settlements, read outcome cards (PR P5).                                                                                              |
| Read (paid read)                  | A buyer's question on one market, answered by a fresh private run of the agent, paid in AUSD on Monad (PRD).                                                                                      |
| Read service                      | The owner's offer: price, delivery clock, capacity, markets, open or closed (PRD R1–R6).                                                                                                          |
| Two clocks                        | Clock 1: delivery within 10–120 minutes, or an automatic refund. Clock 2: the answer is scored 24 hours after delivery (PRD R3, R4).                                                              |
| Outcome card                      | The only public trace of a read: question, called side, result, both clocks met or not; published after resolution if the buyer chose it (PRD R14).                                               |
| Intent                            | A read awaiting payment: binds payer, amount, treasury and start; 15 minutes (PRD R8, R9).                                                                                                        |
| Compute ceiling                   | The most Pickler spends on a read's run: min(10% of the price, 2 AUSD) (PRD R13, CONV 11).                                                                                                        |
| Read treasury                     | Pickler's hot wallet that receives read payments and sends refunds and payouts, signed only by `workers/treasury` (PRD R18).                                                                      |
| Payout                            | The daily batch of an owner's read earnings to their master wallet (PRD R17).                                                                                                                     |
| Master wallet                     | The studio owner's Turnkey wallet in their own sub-organisation; the passkey is its only root. It funds agents, receives payouts and creates tokens.                                              |
| Agent wallet                      | One Turnkey wallet per agent in the owner's sub-organisation, bounded by policies; withdrawals go back to the master only (CUST C1).                                                              |
| Delegated user                    | Pickler's API user inside each sub-organisation. Today it may sign nothing that moves funds; with Perpl it may sign only the kill switch (PERPL P4).                                              |
| Sub-organisation                  | One Turnkey organisation per studio person, with the passkey as root (TPC1).                                                                                                                      |
| Stamp, ceremony                   | A passkey signature over a Turnkey activity; flows are prepare → stamp → confirm, with the body compared byte for byte.                                                                           |
| Relying party (RP)                | The domain a passkey is bound to; cannot be moved. Turnkey: `studio.pickler.fun`. Mera: `app.pickler.fun`. Legacy app: `pickler.fun`.                                                             |
| One-way door                      | A setting that cannot be reversed once used: the two RPs, the apex AASA removal, dropping agent credentials.                                                                                      |
| Mera                              | The marketplace passkey wallet (`@category-labs/mera`), web and phone; PRF model gives one address per passkey everywhere (MW).                                                                   |
| EOA                               | An injected browser wallet (MetaMask etc.), web marketplace only (MW D8).                                                                                                                         |
| SIWE                              | Sign-In With Ethereum; how any marketplace wallet creates or enters a Supabase account.                                                                                                           |
| Wallet link                       | An address tied to a marketplace account, `kind` `mera` or `eoa`, at most 5 per account (MW D9, D10).                                                                                             |
| Login email vs notification email | A login email is a Supabase Auth identity; a notification email is only for receipts and is never a login (MW D11, PRD R11).                                                                      |
| Move your funds                   | The app flow, during the 90-day window, that sweeps a tester's old `pickler.fun`-derived address to the new one (MB M13, CONV 14).                                                                |
| Universal link                    | An `app.pickler.fun` path that opens the app: `/agents/*`, `/tokens/*`, `/reads/*`, `/receipts/*`, `/markets/*`, `/portfolio` (MB M10).                                                           |
| perps-direction-v1                | The Perpl decision protocol: instrument, direction, probability, horizon, optional stop and take-profit (PAR §4).                                                                                 |
| Horizon                           | 4, 24 or 72 hours: when a perps decision is scored and the longest it is held (PAR A3).                                                                                                           |
| Mark price                        | Perpl's reference price; entry is observed by code at decision time and resolution reads it at the horizon (PAR A4, A8).                                                                          |
| Trading key                       | The per-agent Ed25519 Perpl key that signs orders, held encrypted in `workers/trading`; it cannot withdraw (PERPL P5).                                                                            |
| Kill switch                       | Admissions off → cancel → close → forwarding off → key disabled (PERPL P10).                                                                                                                      |
| Paper shadow                      | The paper position every live Perpl agent keeps for each decision (PAR A9).                                                                                                                       |
| Launch grant                      | Pickler's EIP-712 signature allowing one agent's token to be created by its owner, once (LD D1; CONV 5 "launch authorization").                                                                   |
| Agent key                         | The on-chain id of an agent for the launchpad: `keccak256("pickler.agent.v1", chainId, agentUuid)` (LD D2).                                                                                       |
| Bonding curve, graduation         | The token's first market, priced by a curve in AUSD; when it sells out, liquidity moves into a locked Uniswap V4 pool (TT).                                                                       |
| Keeper                            | A gas-only wallet that finalizes graduation when a curve is ready (TT T8).                                                                                                                        |
| Media store                       | R2 plus Cloudflare Images plus `media.*`: token images and avatars for the whole product (TL §6.1).                                                                                               |
| Envelope                          | `{ data, meta }` success and `{ error: { code, message, detail? }, traceId }` failure (CONV).                                                                                                     |
| Step A / Step B                   | The two API deploys: A without Turnkey and SIWE (closes the incident), B with them at the host cutover (PE §0.2).                                                                                 |
| Ledger (deployment)               | The append-only JSONL record of every release on branch `ops/ledger` (PE D9). Not to be confused with the reads money ledger (`reads.ledger_entries`).                                            |
| Readiness verifier                | `npm run check:readiness`: PASS/FAIL checks of bindings, variables, database grants and chain state, never secret values (PE §4.3).                                                               |
| Degraded read                     | A public page that shows its empty state and "catching up" instead of a 500 when the API is behind (PE §0.1).                                                                                     |
| Soon                              | The studio's shared placeholder for a feature that is not built; a venue or category leaves it under RR2 R9.                                                                                      |
