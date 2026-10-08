# Cross-review of the 2026-09-30 spec set

> Historical X verification and posting design: the post-code routes, bearer-token setup,
> optional posting and Skip X described below are superseded by [Studio X OAuth](../studio-x-oauth.md).
> Use that canonical guide for the current read-only routes, callback, dedicated runtime secrets
> and disabled-by-default resource policy. These older sections are retained as historical evidence.

Status: review draft, 2026-09-30. Read-only review of the 18 specs written in parallel that night
against `docs/product-map/conventions.md` and research 01–06. Nothing here changes a spec; every
finding names the spec that should change.

Specs reviewed (short names used below):

| Short | File                                      | Short | File                                   |
| ----- | ----------------------------------------- | ----- | -------------------------------------- |
| PE    | `docs/specs/production-environment-v1.md` | PRD   | `docs/specs/paid-reads-v1.md`          |
| PHC   | `docs/specs/product-hosts-cutover-v2.md`  | FORK  | `docs/specs/fork-agent-v1.md`          |
| OPS   | `docs/specs/operations-v1.md`             | PERPL | `docs/specs/perpl-live-v1.md`          |
| DH    | `docs/specs/design-harness-v3.md`         | LD    | `docs/specs/launchpad-deploy-v1.md`    |
| DR    | `docs/specs/decision-resolution-v1.md`    | TL    | `docs/specs/token-launch-v1.md`        |
| PR    | `docs/specs/public-record-v1.md`          | TT    | `docs/specs/token-trading-v1.md`       |
| SDR   | `docs/specs/studio-decision-review-v1.md` | MW    | `docs/specs/marketplace-wallets-v1.md` |
| GP    | `docs/specs/go-public-v1.md`              | MB    | `docs/specs/mobile-backend-v1.md`      |
| RR2   | `docs/specs/research-runtime-v2.md`       | CUST  | `docs/specs/custody-v2.md`             |
| CONV  | `docs/product-map/conventions.md`         | R0n   | `docs/product-map/research/0n-*.md`    |

Severity: **blocker** = building either side as written produces a wrong or unsafe result, or an
owner answer is required before the work can start; **must-fix** = a real contradiction or gap that
will cost rework if not resolved before the owning spec is built; **minor** = naming, wording or a
small inconsistency with an obvious resolution.

## Summary

| Section                        | Blocker | Must-fix | Minor | Total |
| ------------------------------ | ------- | -------- | ----- | ----- |
| 1. Contradictions              | 4       | 14       | 9     | 27    |
| 2. Endpoints                   | 0       | 4        | 9     | 13    |
| 3. Data                        | 0       | 7        | 5     | 12    |
| 4. Workers and infrastructure  | 0       | 7        | 3     | 10    |
| 5. Dependencies                | 1       | 3        | 2     | 6     |
| 6. Rule compliance             | 0       | 2        | 3     | 5     |
| 7. Coverage                    | 1       | 3        | 4     | 8     |
| 8. Owner questions (blocking)  | 12      | —        | —     | 12    |
| 9. Specific checks (email, RP) | 1       | 1        | 0     | 2     |

The blockers, in one list:

1. **C1** Paid-read runs are enrolled and published as public decisions by the resolution job, and
   the public activity feed writes read answers at delivery rather than after resolution.
2. **C2** Who pays for a paid-read run: the owner's budget (PRD) or a Pickler allowance with a
   per-read ceiling that PRD is supposed to set and does not (RR2).
3. **C3** A Perpl decision has no horizon, and no spec defines the `perps-direction-v1` protocol
   that PERPL, DR and RR2 each point at (also G1, the missing spec).
4. **C4** Paid-read evaluation (clock 2) calls a `priceAt` for prediction markets that DR never
   defines; "Pons" appears in no spec.
5. **X2** The Mera RP move strands any TestFlight funds: no recovery flow exists, and H9 removes the
   apex AASA by default.
6. **K1** The `perps-direction-v1` gap is also a dependency deadlock (PERPL ↔ RR2).
7. Section 8 lists 12 owner questions that block building (Supabase project, iOS app source, phone
   key model, TestFlight funds, key-in-page risk, X developer account, Perpl faucet allocation, Safe
   signers, paid acceptance allowance, schema boundaries, and two groups of mainnet gates).

---

## 1. Contradictions between specs

### C1 — blocker — Paid-read runs become public decisions

- DR `:43` (D1): "**Every completed run with a decision is enrolled** … Failed runs and preview runs
  … are never enrolled." Nothing excludes read runs.
- PRD `:313-315` adds `pickler.runs.purpose = 'read'` and `read_id`; PRD `:56` (R14): a read's card
  is public only if the buyer chose it and only **after resolution**; an "aggregate only" read "is
  never shown".
- PR `:205`: `agents.public_activity` is "written only by the publication step and by the
  paid-reads spec's **delivery** step" — delivery is before resolution.

As written, the DR job enrols every read run, gives it a `public_id` and publishes it through PR
`§3.1` whenever the agent is public, including private reads; and PR's delivery-time `answer` rows
would publish an unresolved read. Both break conventions decision 1 (CONV `:23-24`) and the paid-read
privacy promise (PRD `:368-369`).

**Resolution.** DR D1 adds "runs with `purpose = 'read'` are not enrolled; paid reads are scored by
PRD's evaluation job" (or enrolled in the owner scope only, with `counts_publicly = false`). PR
`:205` changes to "the paid-reads **evaluation** step, for public reads only". PRD `§3.4` states
which job writes the `answer` activity row and when. DR also needs RR2's new `run_trigger` values
(`follow_up`, `read`) in its enrolment query.

### C2 — blocker — Who pays for a paid-read run

- PRD `:55` (R13): the delivery run "is charged to the **owner's** research budget … an owner whose
  budget cannot cover a run has the service closed automatically" (`autoClosedReason: "BUDGET"`,
  `:145`, `:206`).
- RR2 `:50` (R4): Pickler pays; each agent gets a $5 monthly allowance "not charged to the agent's
  AUSD wallet". RR2 `:51` (R5): read runs are **exempt from the allowance** "up to a per-read ceiling
  that `paid-reads-v1.md` sets from the read price".

PRD sets no per-read ceiling, and under RR2 an owner has no budget of their own to exhaust, so PRD's
auto-close rule has nothing to trigger on.

**Resolution.** PRD adds the per-read ceiling (for example "≤ 50 % of the owner's share, in
micro-USD at a fixed AUSD rate") and replaces "owner's research budget" with "the agent's ledger
under `source: read`, exempt from the monthly allowance (RR2 R5)". PRD's `BUDGET` auto-close then
means "the per-read ceiling is below one run's ceiling". RR2 keeps R5 and links the PRD section.

### C3 — blocker — Perpl decisions have no horizon; three specs resolve them differently

- DR `:338-344`: a Perpl decision "carries a direction, an entry mark and a **horizon**" and resolves
  at `decided_at + horizon`.
- RR2 `:168`: `perps-direction-v1` resolves on the "Perpl mark price at **+24 h** (the read's clock)".
- PERPL `:91-92`: the decision is `{ market, action: open-long | open-short | close | hold,
probability }` — no horizon; PERPL `:56` (P15) "Hit rate and Brier still resolve on the mark at the
  horizon".

Nobody defines the protocol (see G1), so the horizon's source (model output, brief, or a fixed 24 h)
is undecided, and `close`/`hold` have no resolution rule.

**Resolution.** The missing `perps-direction-v1` spec (G1) owns the decision schema including
`horizonHours`. Until it exists, RR2 `§6.1` and DR `§6.3` should both say "fixed 24 h after
`decided_at`; `close` and `hold` are not scored", and PERPL `§3.2` adds the field.

### C4 — blocker — Paid-read evaluation needs a price source nobody defines

- PRD `:57` (R15): evaluation observes "the venue price within ±5 minutes" through DR's
  `DecisionOutcomeSource` — "Perpl mark for perps, **Pons** for prediction markets".
- DR `:345-347` names `priceAt(venue, market, time, tolerance)` but DR `§6.1` only reads Polymarket
  **payout vectors** (resolution), and DR `§6.3` defines a price only for Perpl. No spec defines
  Pons or a Polymarket price history source.
- PRD `:48` (R6): the markets a read answers are the agent's scope — today Polymarket sports only.

So clock 2 of the product ("two clocks and no faked charge") has no implementation for the only
venue agents run on.

**Resolution.** DR `§6` adds a `priceAt` adapter for Polymarket (CLOB midpoint or last trade at a
timestamp, with the ±5 min tolerance and `not_evaluable`), and PRD R15 drops "Pons" or points at the
spec that defines it. If that cannot be built, PRD R6 restricts v1 reads to Perpl markets and waits
for PERPL.

### C5 — must-fix — Perpl live P&L is written to a column that does not exist, on an append-only record

- PERPL `:56` (P15) and `:173-174`: live P&L "written to `pickler.decisions.live_pnl_micro`".
- DR `:210-213`: `live_pnl_micro` is a column of `pickler.decision_resolutions`, and DR `:221`: "A
  trigger rejects `UPDATE` and `DELETE`" on that table. `pickler.decisions` (DR `:164-195`) has no
  such column.

**Resolution.** DR states how late P&L lands: either a new revision (D7 allows only operator
revisions today) or a separate `pickler.decision_live_pnl (run_id, venue, realized_micro, …)` table
that `agent_records` sums. PERPL `§5` then writes that table.

### C6 — must-fix — Two designs for the same nonce-flood fix on `identity.siwe_nonces`

- OPS `:47` (O7), `:217-218`: `client_hash bytea`, `hmac_sha256(RATE_LIMIT_SALT, IP)`, cap **20 open
  nonces per client**, plus `RL_AUTH` 10/60 s.
- MW `:184-188`, `:205`: `client text`, `ip_hash text` under `NONCE_IP_SALT`, cap `NONCE_IP_CAP=30`
  per **10 minutes**.

Two migrations add two IP-hash columns under two salts with two caps to the same table.

**Resolution.** OPS owns rate limiting (its whole `§4.1`). MW drops `ip_hash`, `NONCE_IP_SALT` and
`NONCE_IP_CAP` and keeps only `client`; MW `§8.2` points at OPS O7.

### C7 — must-fix — Sweepers for the same tables in two Workers

- OPS `:52` (O12) and `:256-258`: the ops Worker's daily 04:00 cron deletes expired `siwe_nonces`,
  `webauthn_challenges` older than 1 h and `preview_runs` older than 24 h.
- CUST `:57` (C10) and `:202`: a new `*/15` cron on `workers/api` deletes the same three sets.

**Resolution.** One owner. CUST keeps the custody-specific jobs (add-device abandonment, the deposit
reconciler) and hands table retention to OPS; or OPS drops those three rows. Decide together with
W1 (cron home).

### C8 — must-fix — Media upload limits and ownership order

- GP `:318`: avatars "20 uploads per agent per day"; GP `:55` "≤ 1 MB".
- TL `:190`: `MEDIA_UPLOADS_PER_HOUR` (30) **per studio account**; TL `:188` 1 MiB, ≥ 256 px.
- Order: GP `:347` needs TL for media storage; TL `:252-253` needs GP (`visibility`) and says "the
  media store ships with this spec and **before** Go Public's avatars". TL `:193` creates `media.*`
  in `token_launch_drafts`, which TL `:139` orders after LD's `launchpad_attribution`.

So Go Public avatars wait on the launchpad attribution migration, and the limits disagree.

**Resolution.** TL `§6.1` stays the single definition but its migration becomes its own
(`media_store`), with no launchpad dependency, shippable in phase 1. GP D18 drops its own limit and
cites TL's.

### C9 — must-fix — Envelope switch for `/v1/marketplace/*`: before or after the app ships

- PR `:48` (P10): existing marketplace routes keep bare bodies and switch "in one later change that
  moves the web and the mobile app together"; PR `:366` rollout: "Mobile app release reading the new
  routes; **then** the envelope switch".
- MB `:105-107`: they "move to the `{ data, meta }` envelope **before** the app's first public
  build. The app codes against the envelope only." MB `:252-253` lists it as a prerequisite.

**Resolution.** Adopt MB's order (switch before the first public build; the TestFlight app is not
public). PR P10 and PR `§10` step 5 change to "switch with the web before the mobile release";
production-environment's smoke list keeps working because it checks status only.

### C10 — must-fix — Three different universal-link path lists

- PHC `:160`: `aasaFor` components `/agents/*`, `/tokens/*`.
- PR `:108`: adds `/receipts/<publicId>`.
- MB `:47` (M10): `/agents/*`, `/tokens/*`, `/reads/*`, `/markets/*`, `/portfolio`.

**Resolution.** MB M10 is declared the owner of the list (it owns the app contract) and adds
`/receipts/*`; PHC `§5` `aasaFor` reads the list from one constant; PR `§3.6` cites MB.

### C11 — must-fix — Per-day cap enforcement has no owner

- GP `:48` (D11): per-day caps are "enforced by Pickler's trading worker"; GP `:281`: the trading
  worker part is "owned by `perpl-live-v1.md` and `custody-v2.md`".
- CUST says nothing about caps. PERPL `:49` (P8) enforces margin caps for Perpl only.
- GP `:76` also offers a "PICKLER MARKETS" venue toggle that no spec defines.

**Resolution.** GP names PERPL as the only owner in v1 (Perpl is the only venue with live signing),
removes CUST from `:281`, and either removes "Pickler markets" from the caps sheet or names the spec
that will define it.

### C12 — must-fix — Caps copy says the wallet enforces per-trade caps; for Perpl it cannot

- GP `:288`: RISK line "per trade: its wallet enforces it · per day: Pickler does".
- PERPL `:49` (P8): Perpl orders are not wallet transactions, so "saying 'the wallet enforces your
  per-trade cap' for Perpl would be false".

**Resolution.** GP `§7` makes the copy venue-specific ("per trade: its wallet enforces it on
on-chain venues; on Perpl, Pickler does"); PERPL already states the departure.

### C13 — must-fix — Withdrawal leg for Perpl collateral cannot use custody's route

- PERPL `:53` (P12): the agent → master leg reuses "`custody-v2.md` C1 (its route, gas top-up C2 and
  `wallets.transfers` receipt)".
- CUST `:79`: confirm checks "`to` = AUSD contract, `transfer(master, amount)`"; CUST `:167`: `asset`
  check `('AUSD','MON')`. PERPL `:183`: testnet collateral is Perpl "USD" at `0xdf5b…`, not AUSD.

**Resolution.** CUST C1 generalises to "any token in `@pickler/chain`'s venue manifest" (asset text
widened, contract from the manifest), or PERPL adds the testnet USD leg to its own steps.

### C14 — must-fix — Existing killed agents lose their public pages

- GP `:192-193`: the migration makes public only agents `WHERE status NOT IN ('draft', 'killed')`.
- PR `:318-319`: a private agent answers 404 on every public route.
- FORK `:50` (F11): forks link "to the killed agent's page, which still serves"; DR `:377-378`:
  "Killing an agent keeps its record"; GP `:53` (D16): a killed public agent's record stays public.

**Resolution.** GP's backfill includes killed agents that were ever non-draft
(`WHERE status <> 'draft'`), so killed agents keep their pages; the directory already filters killed
agents from lists where needed.

### C15 — must-fix — Research budget money unit

- CONV `:61-62`: "integers in micro-units (`amount_micro_ausd bigint`)".
- RR2 `:120`: "Money is a string of micro-USD in JSON"; CUST `:140` uses `amountMicroUsd` for an
  AUSD amount; PRD and GP use `*MicroAusd`.

**Resolution.** RR2 keeps micro-USD for provider cost (it is USD) but names it `*MicroUsd` and says
why it departs; CUST renames `amountMicroUsd` to `amountMicroAusd`. CONV should add "provider costs
are micro-USD" to the money rule.

### C16 — must-fix — Rate limits for the same routes, three ways

- Trade quote: MB `:220-221` "quotes 20/min" per user; TT `:294-295` 30/min per user, 120/min per IP.
- Read purchase: OPS `:118` 30 purchases/hour per user and `RL_MONEY` 10/60 s; PRD `:356` ≤ 3 open
  intents, 10 intents per hour.
- Unauthenticated reads: MB `:220` 120/min per IP on every route; OPS `:119` `RL_PUBLIC` 120/60 s for
  `/v1/marketplace/*` only.

**Resolution.** OPS `§4.1` is the table of record; TT, PRD and MB drop their numbers and link it; OPS
adds the trade quote row with one value.

### C17 — must-fix — Two ways to hand a Perpl decision to the trading worker

- PERPL `:94`: "The research worker enqueues `{ kind: "perpl-decision", agentId, runId }` on the
  trading queue."
- PERPL `:133`: `POST /v1/internal/trading/perpl/decisions` (service binding) does the same.

**Resolution.** PERPL keeps the queue (the research worker has a producer binding already) and drops
the internal route, or says the route is the API's manual path only.

### C18 — must-fix — How a resolved decision reaches the X outbox

- PR `:64`: inside the resolution transaction, "enqueue `agents.x_posts` with class `resolved_trade`
  and `subject_id` = `public_id`".
- GP `:173`: `POST /v1/internal/x/enqueue` "called by the resolution job"; GP `:234`: `subject_id` is
  "decision id, read id, or agent id".

The resolution job runs in `workers/research` (DR `:52`), which has no binding to the API (PE
`:436`).

**Resolution.** PR's in-transaction insert through a core use case wins (no new binding); GP keeps
the route for the paid-reads evaluation job only and fixes `subject_id` for `resolved_trade` to the
`public_id`.

### C19 — minor — `launch.agent_keys` is written at two different moments

- LD `:55` (D13): "The API writes `(agent_id, chain, agent_key)` when it signs a grant."
- TL `:166`: "`params.agentKey` … written to `launch.agent_keys` at validate."

**Resolution.** Write at validate (TL), since the ticker is reserved there too; LD D13 changes.

### C20 — minor — Settle route: "stays" vs "alias"

- DR `:150`: `POST /v1/studio/runs/:id/paper-order/settle` "stays for the owner as 'check now'".
- SDR `:140-141`: it "becomes an alias of" `POST /v1/studio/decisions/:runId/check-resolution`, which
  is rate limited to one per decision per 5 minutes.

**Resolution.** Compatible; DR adds the rate limit and the alias wording.

### C21 — minor — Error codes for "not the owner"

GP `:142` `403 NOT_OWNER`; TL `:105` `403 NOT_AGENT_OWNER`; SDR `:126-127` answers 404 for another
workspace's decision. **Resolution:** CONV adds one rule ("a resource of another owner is 404, never
403") and GP/TL follow it.

### C22 — minor — Chain id variables

PE `:430` `CHAIN_ID` (api); PERPL `:222` `PERPL_CHAIN_ID`; TL `:174` `LAUNCH_CHAIN_ID`. All are 10143
today. **Resolution:** PE's inventory defines `CHAIN_ID` as the Monad network for every Monad
feature; per-feature overrides exist only if they can differ (Perpl mainnet before the launchpad),
and are listed in PE `§6.1`.

### C23 — minor — RPC variables

PE `:431` `MONAD_RPC_URL` (api); LD `:233` and TT `:254` `RPC_URLS` on the API as well; TT `:236`,
`:258` `NEXT_PUBLIC_MONAD_RPC_URL` for the page's broadcast; MW `:58`, `:203` "the public RPC in
`@pickler/chain`. A private RPC URL never reaches the web." **Resolution:** the API uses one name
(PE's `MONAD_RPC_URL`, or `RPC_URLS` everywhere); TT drops `NEXT_PUBLIC_MONAD_RPC_URL` in favour of
MW's `@pickler/chain` constant.

### C24 — minor — Heartbeat table created by two migrations

PE `:402-405` creates `ops.worker_heartbeats`; OPS `:154-156` creates it "if that spec has not landed
first". Drizzle migrations are not conditional. **Resolution:** OPS owns the `ops` schema migration;
PE `§5.4` points at it.

### C25 — minor — Backup object paths

PE `:379` `r2://pickler-backups/production/<ts>.dump`; OPS `:274-275`, `:278-279`
`<env>/pre-migration/<ts>.dump.age`. **Resolution:** PE's ledger example uses OPS's path.

### C26 — minor — Data API un-exposure lists

OPS `:53` (O13) six schemas; PE `:283` checks only `pickler`, `pickler_migrations`, `mastra`,
`internal`. Neither covers the new schemas (see D6). **Resolution:** one list in PE `§4.3` derived
from the schemas Drizzle owns.

### C27 — minor — Spec names that do not exist

PHC `:46`, `:334`, `:341` name `marketplace-mera-web-v1`; the spec is `marketplace-wallets-v1.md`.
PR `:359` depends on `product-hosts-v1` for the AASA paths; the builder is PHC. RR2 `:53`, `:227`
say "the Perpl trading spec"; it is PERPL. **Resolution:** rename the references.

---

## 2. Endpoints

### 2.1 Every endpoint in the set

Auth column: `none` public; `mkt` marketplace session (`/v1/me`, `/v1/auth` with a Bearer);
`studio` studio session; `int` service binding only; `op` service binding plus an operator claim;
`web` a Next route handler, not the API; `harness` the design fixture API. "(chg)" = an existing
route whose shape changes.

| Method | Path                                                | Auth      | Owner        | Notes                                                    |
| ------ | --------------------------------------------------- | --------- | ------------ | -------------------------------------------------------- |
| GET    | `/v1/health`                                        | none      | PE §4.1      | alias of `/health`                                       |
| GET    | `/v1/internal/ready`                                | int       | PE §4.2      | also listed by OPS §4.2                                  |
| GET    | `/v1/internal/ops/queues`                           | int       | OPS §4.2     |                                                          |
| GET    | `/.well-known/apple-app-site-association`           | web       | PHC §4       | path list conflict C10                                   |
| GET    | `/.well-known/assetlinks.json`                      | web       | PHC §4       |                                                          |
| POST   | `/__fixture/fail`, `/__fixture/reset`               | harness   | DH §4        | loopback only                                            |
| GET    | `/__fixture/state`                                  | harness   | DH §4        |                                                          |
| POST   | `/v1/auth/wallet/nonce` (chg)                       | none      | MW §4        | adds `client`; legacy lower-case codes kept              |
| POST   | `/v1/auth/wallet/verify` (chg)                      | none      | MW §4        | adds `kind`                                              |
| POST   | `/v1/auth/wallet/link` (chg)                        | mkt       | MW §4        | `WALLET_LIMIT`                                           |
| GET    | `/v1/auth/wallet/links` (chg)                       | mkt       | MW §4        |                                                          |
| PATCH  | `/v1/auth/wallet/links/:id`                         | mkt       | MW §4        |                                                          |
| DELETE | `/v1/auth/wallet/links/:id`                         | mkt       | MW §4        | `LAST_WALLET`                                            |
| GET    | `/v1/marketplace/app-config`                        | none      | MB §4.2      |                                                          |
| GET    | `/v1/marketplace/agents` (chg)                      | none      | PR §4.2      | bare body (P10, C9)                                      |
| GET    | `/v1/marketplace/directory` (chg)                   | none      | PR §4.2      | + `followers`; GP adds `avatarUrl` etc.                  |
| GET    | `/v1/marketplace/personas/:handle` (chg)            | none      | PR §4.2      | GP, FORK add fields                                      |
| GET    | `/v1/marketplace/profiles/:ticker` (chg)            | none      | PR §4.2      |                                                          |
| GET    | `/v1/marketplace/profiles/:ticker/picks/:id` (chg)  | none      | PR §4.2      | `id` becomes a `publicId`                                |
| GET    | `/v1/marketplace/leaderboard` (chg)                 | none      | PR §4.2      |                                                          |
| GET    | `/v1/marketplace/analytics` (chg)                   | none      | PR §4.2      |                                                          |
| GET    | `/v1/marketplace/markets`, `/markets/:symbol` (chg) | none      | PR §4.2      | real Perpl board                                         |
| GET    | `/v1/marketplace/agents/:handle/record`             | none      | PR §4.1      | envelope                                                 |
| GET    | `/v1/marketplace/agents/:handle/decisions`          | none      | PR §4.1      |                                                          |
| GET    | `/v1/marketplace/agents/:handle/sealed`             | none      | PR §4.1      |                                                          |
| GET    | `/v1/marketplace/agents/:handle/activity`           | none      | PR §4.1      |                                                          |
| GET    | `/v1/marketplace/activity`                          | none      | PR §4.1      |                                                          |
| GET    | `/v1/marketplace/decisions/:publicId`               | none      | PR §4.1      | web page is `/receipts/[publicId]`                       |
| GET    | `/v1/marketplace/agents/:handle/reads/quote`        | none      | PRD §4.2     | also MB §4.2                                             |
| GET    | `/v1/marketplace/reads`                             | none      | PRD §4.2     |                                                          |
| GET    | `/v1/marketplace/reads/:id`                         | none      | PRD §4.2     |                                                          |
| GET    | `/v1/marketplace/launchpad`                         | none      | LD §4        |                                                          |
| GET    | `/v1/marketplace/tokens/:ticker`                    | none      | TT §4.1      |                                                          |
| GET    | `/v1/marketplace/tokens/:ticker/trades`             | none      | TT §4.1      |                                                          |
| GET    | `/v1/marketplace/tokens/:ticker/candles`            | none      | TT §4.1      |                                                          |
| GET    | `/v1/marketplace/tokens/:ticker/holders`            | none      | TT §4.1      |                                                          |
| GET    | `/v1/marketplace/tokens/:ticker/quote`              | none      | TT §4.1      |                                                          |
| GET    | `/v1/launches`, `/:id`, `/:id/trades`               | none      | existing     | outside the route groups (E5)                            |
| GET    | `/v1/me/follows`                                    | mkt       | PR §4.3      | also MB §4.2                                             |
| PUT    | `/v1/me/follows/:handle`                            | mkt       | PR §4.3      |                                                          |
| DELETE | `/v1/me/follows/:handle`                            | mkt       | PR §4.3      |                                                          |
| POST   | `/v1/me/follows/import`                             | mkt       | PR §4.3      | `Idempotency-Key`                                        |
| GET    | `/v1/me/activity`                                   | mkt       | PR §4.3      |                                                          |
| POST   | `/v1/me/reads`                                      | mkt       | PRD §4.3     | `EMAIL_REQUIRED` (X1)                                    |
| POST   | `/v1/me/reads/:id/payment`                          | mkt       | PRD §4.3     | no `Idempotency-Key` stated (E6)                         |
| GET    | `/v1/me/reads`, `/v1/me/reads/:id`                  | mkt       | PRD §4.3     |                                                          |
| POST   | `/v1/me/reads/:id/cancel`                           | mkt       | PRD §4.3     |                                                          |
| POST   | `/v1/me/reads/:id/dispute`                          | mkt       | PRD §4.3     |                                                          |
| GET    | `/v1/me/reads/:id/receipt`                          | mkt       | PRD §4.3     |                                                          |
| PUT    | `/v1/me/notify-email`                               | mkt       | PRD §4.3     | verification target missing (E3)                         |
| POST   | `/v1/me/reads/:id/purchases`                        | mkt       | OPS §4.1     | **does not exist** (E1)                                  |
| POST   | `/v1/me/trades/quote`                               | mkt       | TT §4.2      | merges the parent brief's `.../trades/prepare`           |
| POST   | `/v1/me/trades`                                     | mkt       | TT §4.2      |                                                          |
| GET    | `/v1/me/trades`, `/v1/me/trades/:id`                | mkt       | TT §4.2      |                                                          |
| GET    | `/v1/me/portfolio`                                  | mkt       | TT §4.2      | shape owned by MB §4.2                                   |
| GET    | `/v1/me/notifications`                              | mkt       | MB §4.2      |                                                          |
| POST   | `/v1/me/notifications/read`                         | mkt       | MB §4.2      |                                                          |
| GET    | `/v1/me/notification-preferences`                   | mkt       | MB §4.2      |                                                          |
| PUT    | `/v1/me/notification-preferences`                   | mkt       | MB §4.2      |                                                          |
| POST   | `/v1/me/devices`                                    | mkt       | MB §4.2      | creates; no `Idempotency-Key` (upsert)                   |
| DELETE | `/v1/me/devices/:id`                                | mkt       | MB §4.2      |                                                          |
| POST   | `/v1/me/account/export`                             | any       | CUST §4      | studio accounts use `/v1/me` too (E5)                    |
| GET    | `/v1/me/account/export/:id`                         | any       | CUST §4      |                                                          |
| POST   | `/v1/me/account/deletion`                           | any       | CUST §4      |                                                          |
| DELETE | `/v1/me/account/deletion`                           | any       | CUST §4      |                                                          |
| GET    | `/v1/studio/agents/:id/go-public`                   | studio    | GP §4        |                                                          |
| PUT    | `/v1/studio/agents/:id/voice`                       | studio    | GP §4        |                                                          |
| GET    | `/v1/studio/voice-presets`                          | studio    | GP §4        |                                                          |
| POST   | `/v1/studio/agents/:id/x/challenge`                 | studio    | GP §4        |                                                          |
| POST   | `/v1/studio/agents/:id/x/verify`                    | studio    | GP §4        |                                                          |
| GET    | `/v1/studio/agents/:id/x/authorize`                 | studio    | GP §4        |                                                          |
| GET    | `/v1/studio/x/callback`                             | state     | GP §4        | an X redirect carries no Bearer (E7)                     |
| PUT    | `/v1/studio/agents/:id/x/posting`                   | studio    | GP §4        |                                                          |
| DELETE | `/v1/studio/agents/:id/x`                           | studio    | GP §4        |                                                          |
| GET    | `/v1/studio/agents/:id/x/posts`                     | studio    | GP §4        |                                                          |
| GET    | `/v1/studio/agents/:id/caps`                        | studio    | GP §4        |                                                          |
| POST   | `/v1/studio/agents/:id/caps/prepare`                | studio    | GP §4        |                                                          |
| POST   | `/v1/studio/agents/:id/caps/confirm`                | studio    | GP §4        |                                                          |
| PUT    | `/v1/studio/agents/:id/limits` (chg)                | studio    | GP §4        | `CAPS_NEED_APPROVAL`                                     |
| POST   | `/v1/studio/agents/:id/publish`                     | studio    | GP §4        |                                                          |
| PUT    | `/v1/studio/agents/:id/identity`                    | studio    | GP §4        |                                                          |
| PUT    | `/v1/studio/agents/:id/profile`                     | studio    | GP §4 / FORK | both add fields; compatible (E4)                         |
| POST   | `/v1/studio/agents/:id/avatar`                      | studio    | GP §4        | multipart                                                |
| DELETE | `/v1/studio/agents/:id/avatar`                      | studio    | GP §4        |                                                          |
| GET    | `/v1/studio/agents/:id/audience`                    | studio    | GP §4        |                                                          |
| GET    | `/v1/studio/forkable-agents`                        | studio    | FORK §4      |                                                          |
| GET    | `/v1/studio/forkable-agents/:handle/brief`          | studio    | FORK §4      |                                                          |
| POST   | `/v1/studio/preview-runs` (chg)                     | studio    | FORK §4      | + `forkedFrom`                                           |
| POST   | `/v1/studio/drafts` (chg)                           | studio    | FORK §4      | + `forkedFrom`                                           |
| GET    | `/v1/studio/agents/:id/lineage`                     | studio    | FORK §4      |                                                          |
| GET    | `/v1/studio/agents/:id/decisions`                   | studio    | SDR §4       |                                                          |
| GET    | `/v1/studio/decisions/:runId`                       | studio    | SDR §4       |                                                          |
| GET    | `/v1/studio/agents/:id/performance`                 | studio    | SDR §4       |                                                          |
| PUT    | `/v1/studio/decisions/:runId/review`                | studio    | SDR §4       |                                                          |
| DELETE | `/v1/studio/decisions/:runId/review`                | studio    | SDR §4       |                                                          |
| POST   | `/v1/studio/decisions/:runId/check-resolution`      | studio    | SDR §4       |                                                          |
| POST   | `/v1/studio/runs/:id/paper-order/settle` (chg)      | studio    | DR §4 / SDR  | alias (C20)                                              |
| GET    | `/v1/studio/read-bounds`                            | studio    | PRD §4.1     |                                                          |
| GET    | `/v1/studio/agents/:id/read-service`                | studio    | PRD §4.1     |                                                          |
| PUT    | `/v1/studio/agents/:id/read-service`                | studio    | PRD §4.1     |                                                          |
| GET    | `/v1/studio/agents/:id/reads`                       | studio    | PRD §4.1     |                                                          |
| GET    | `/v1/studio/earnings`                               | studio    | PRD §4.1     |                                                          |
| GET    | `/v1/studio/payouts`                                | studio    | PRD §4.1     |                                                          |
| GET    | `/v1/studio/venues`                                 | studio    | PERPL §4     |                                                          |
| GET    | `/v1/studio/agents/:id/perpl`                       | studio    | PERPL §4     |                                                          |
| POST   | `/v1/studio/perpl/faucet`                           | studio    | PERPL §4     |                                                          |
| POST   | `/v1/studio/agents/:id/perpl/steps/:step/prepare`   | studio    | PERPL §4     |                                                          |
| POST   | `/v1/studio/agents/:id/perpl/steps/:stepId/confirm` | studio    | PERPL §4     | same segment, two param names (E8)                       |
| POST   | `/v1/studio/agents/:id/perpl/kill`                  | studio    | PERPL §4     |                                                          |
| GET    | `/v1/studio/agents/:id/perpl/orders`                | studio    | PERPL §4     |                                                          |
| GET    | `/v1/studio/agents/:id/perpl/positions`             | studio    | PERPL §4     |                                                          |
| GET    | `/v1/studio/agents/:id/token`                       | studio    | TL §4        |                                                          |
| PUT    | `/v1/studio/agents/:id/token/draft`                 | studio    | TL §4        |                                                          |
| GET    | `/v1/studio/agents/:id/token/ticker-availability`   | studio    | TL §4        |                                                          |
| POST   | `/v1/studio/agents/:id/token/image`                 | studio    | TL §4        | multipart                                                |
| POST   | `/v1/studio/agents/:id/token/validate`              | studio    | TL §4        |                                                          |
| POST   | `/v1/studio/agents/:id/token/prepare`               | studio    | TL §4        |                                                          |
| POST   | `/v1/studio/agents/:id/token/submit`                | studio    | TL §4        |                                                          |
| GET    | `/v1/studio/agents/:id/token/status`                | studio    | TL §4        |                                                          |
| POST   | `/v1/studio/agents/:id/token/abandon`               | studio    | TL §4        |                                                          |
| POST   | `/v1/studio/agents/:id/token/fees/claim/prepare`    | studio    | TL §4        |                                                          |
| POST   | `/v1/studio/agents/:id/token/fees/claim/submit`     | studio    | TL §4        |                                                          |
| GET    | `/v1/studio/agents/:id/research-budget`             | studio    | RR2 §4       |                                                          |
| PUT    | `/v1/studio/agents/:id/research-budget`             | studio    | RR2 §4       |                                                          |
| GET    | `/v1/studio/agents/:id/runs` (chg)                  | studio    | RR2 §4       | + `costMicroUsd`                                         |
| PUT    | `/v1/studio/agents/:id/schedule` (chg)              | studio    | RR2 §4       |                                                          |
| GET    | `/v1/studio/agents/:id/follow-ups`                  | studio    | RR2 §4       |                                                          |
| DELETE | `/v1/studio/follow-ups/:id`                         | studio    | RR2 §4       |                                                          |
| GET    | `/v1/studio/market-categories` (chg)                | studio    | RR2 §4       |                                                          |
| POST   | `/v1/studio/agents/:id/withdraw/prepare`            | studio    | CUST §4      |                                                          |
| POST   | `/v1/studio/agents/:id/withdraw/confirm`            | studio    | CUST §4      | AUSD only (C13)                                          |
| GET    | `/v1/signing/wallets`                               | studio    | CUST §4      |                                                          |
| POST   | `/v1/signing/wallets/master/send/prepare`           | studio    | CUST §4      |                                                          |
| POST   | `/v1/signing/wallets/master/send/confirm`           | studio    | CUST §4      |                                                          |
| GET    | `/v1/signing/transfers`                             | studio    | CUST §4      |                                                          |
| POST   | `/v1/signing/passkeys/:id/remove/prepare`           | studio    | CUST §4      |                                                          |
| POST   | `/v1/signing/passkeys/:id/remove/confirm`           | studio    | CUST §4      |                                                          |
| POST   | `/v1/signing/passkeys/reconcile`                    | studio    | CUST §4      |                                                          |
| GET    | `/v1/signing/incidents`                             | studio    | CUST §4      |                                                          |
| POST   | `/v1/signing/incidents/:id/cleanup/prepare`         | studio    | CUST §4      |                                                          |
| POST   | `/v1/signing/incidents/:id/cleanup/confirm`         | studio    | CUST §4      |                                                          |
| —      | `/v1/agents/:id/status`, `/analytics`, `/budget`    | removed   | RR2 §4       | R12 keeps `GET /v1/agents` and `/:id/audit` under JWT    |
| POST   | `/v1/internal/resolutions/tick`                     | int       | DR §4        |                                                          |
| GET    | `/v1/internal/resolutions/health`                   | int       | DR §4        |                                                          |
| POST   | `/v1/internal/resolutions/:runId/revisions`         | op        | DR §4        | operator path undefined (E2)                             |
| POST   | `/v1/internal/resolutions/backfill`                 | op        | DR §4        | E2                                                       |
| GET    | `/v1/internal/decision-reviews/export`              | op        | SDR §4       | disabled; E2                                             |
| POST   | `/v1/internal/x/outbox/drain`                       | int       | GP §4        | caller `workers/jobs`                                    |
| POST   | `/v1/internal/x/enqueue`                            | int       | GP §4        | caller conflict C18                                      |
| POST   | `/v1/internal/reads/verify-payments`                | int       | PRD §4.4     | caller `workers/jobs`                                    |
| POST   | `/v1/internal/reads/:id/deliver`                    | int       | PRD §4.4     | caller `workers/research`, which has no API binding (W4) |
| POST   | `/v1/internal/reads/sweep-deadlines`                | int       | PRD §4.4     |                                                          |
| POST   | `/v1/internal/reads/refunds/run`                    | int       | PRD §4.4     |                                                          |
| POST   | `/v1/internal/reads/evaluate`                       | int       | PRD §4.4     |                                                          |
| POST   | `/v1/internal/reads/payouts/run`                    | int       | PRD §4.4     |                                                          |
| POST   | `/v1/internal/reads/reconcile`                      | int       | PRD §4.4     |                                                          |
| POST   | `/v1/internal/reads/disputes/:id/resolve`           | op        | PRD §4.4     | E2                                                       |
| RPC    | `send` on `workers/treasury`                        | int       | PRD §4.4     |                                                          |
| POST   | `/v1/internal/trading/perpl/decisions`              | int       | PERPL §4     | duplicate of the queue path (C17); host Worker unstated  |
| POST   | `/v1/internal/trading/perpl/keys`                   | int       | PERPL §4     | api → trading                                            |
| POST   | `/v1/internal/trading/perpl/kill`                   | int or op | PERPL §4     | "operator global" (E2)                                   |
| POST   | `/v1/internal/launch/grants`                        | int       | LD §4        | "called in-process"; route optional                      |
| POST   | `/v1/internal/launch/outbox/deliver`                | int       | LD §4        | queue consumer                                           |
| GET    | `/v1/internal/launch/indexer/health`                | int       | LD §4        |                                                          |
| POST   | `/v1/internal/media/takedowns`                      | op        | TL §6.1      | E2                                                       |

### 2.2 Findings

- **E1 — must-fix.** OPS `:118` rate-limits "Paid-read purchase (`POST /v1/me/reads/:id/purchases`,
  path owned by the paid-reads spec)" and OPS `:435` says "The paid-reads spec must adopt … the
  purchase path named in §4.1". PRD `:167-168` defines `POST /v1/me/reads` (intent) and
  `POST /v1/me/reads/:id/payment` (claim). **Resolution:** OPS `§4.1` changes the row to those two
  paths (`RL_MONEY` on both).
- **E2 — must-fix.** Six routes need "service binding + operator claim" (DR `:144-145`, SDR `:147`,
  PRD `:191`, TL `:192`, PERPL `:135` "operator global"), but no spec says how an operator reaches a
  service-binding-only route or what the "operator claim" is. OPS `§4.3` defines an operator CLI for
  DLQs and alerts only. **Resolution:** OPS adds an operator CLI (`npm run ops -- <route>`) that
  calls these routes through `wrangler` with an operator token checked against
  `deploy/operators.txt`, or through the ops Worker's `API` binding with a signed request; every spec
  cites it.
- **E3 — must-fix.** PRD `:174` `PUT /v1/me/notify-email` "sends the verification link", and
  PRD `:53` mails only verified addresses, but no route receives the link. **Resolution:** PRD adds
  `POST /v1/me/notify-email/verify { token }` (and the web page that calls it).
- **E4 — minor.** GP `:162` and FORK `:95` both define `PUT /v1/studio/agents/:id/profile`; the
  shapes are compatible (FORK adds `forkStats` and two 409 codes). **Resolution:** GP lists FORK's
  additions so the route has one table.
- **E5 — must-fix.** Route-group drift from CONV `:53-56`: (a) CUST `:133` serves studio accounts
  under `/v1/me/account/*`, but `/v1/me/*` is "a signed-in marketplace account"; (b) RR2 `:58` keeps
  `GET /v1/agents` and `/:id/audit` under a Supabase JWT, reusing the group CONV reserves for the
  agent HMAC API (RR2 says conventions must be updated, nothing tracks it); (c) `/v1/launches*`,
  `/v1/handles/:handle/availability`, `/v1/profile`, `/v1/waitlist`, `/v1/applications` sit outside
  every group and TT `:137` / MB `:120` keep them. **Resolution:** CONV redefines `/v1/me/*` as "any
  signed-in user's own account" and retires the HMAC group per RR2 R12, and lists the legacy
  ungrouped routes as grandfathered until the envelope switch (C9).
- **E6 — minor.** CONV `:63` requires `Idempotency-Key` on every POST that moves money or creates
  something. Missing: PRD `POST /v1/me/reads/:id/payment` (claims money), MB `POST /v1/me/devices`,
  GP `POST /avatar`, TL `POST /token/image`, TL `POST /token/validate` (reserves a ticker, writes to
  R2). **Resolution:** add the header to those rows or state why the route is idempotent by nature.
- **E7 — minor.** GP `:153` `GET /v1/studio/x/callback` is reached by X's browser redirect, which
  carries no `Authorization: Bearer`, while GP `:141` says every studio route needs the JWT.
  **Resolution:** GP marks the callback as authenticated by the `state` value only.
- **E8 — minor.** PERPL `:128-129` uses `:step` and `:stepId` at the same path position. Hono
  accepts it, but the prepare takes a step name and the confirm a step row id. **Resolution:** rename
  to `/perpl/steps/:step/prepare` and `/perpl/step-runs/:stepId/confirm`, or document it.
- **E9 — minor.** Status codes outside CONV `:59-60`: 502 (PERPL `:129`, CUST `:141`), 413 (GP `:163`,
  TL `:114`), 426 (MB `:45`). **Resolution:** CONV adds 413, 426 and 502 to its list.
- **E10 — minor.** `retryAt` placement: OPS `:106-107` puts it inside `detail`; CONV `:60` says "429
  rate limited (with `retryAt`)" without a place; PERPL `:127` returns it on a 409. **Resolution:**
  CONV fixes `error.detail.retryAt` for every status that carries it.
- **E11 — minor.** Two "receipt" concepts: PRD `:173` read receipt at `/reads/:id/receipt`; PR `:46`
  decision receipt at `/receipts/[publicId]`. A universal link `/receipts/*` (C10) would not open a
  read receipt. **Resolution:** PR and PRD agree on names in copy and in MB's path list.
- **E12 — minor.** PE `:233` smoke expects `GET /api/v1/profile` → 401; fine, but none of the new
  public routes (PR, TT, PRD, LD) join the smoke list. **Resolution:** each spec adds one anonymous
  route to `deploy/smoke.<env>.json` when it ships.
- **E13 — minor.** Existing marketplace routes that PR `§4.2` changes also gain fields from GP `:175-177`
  and FORK `:98-99`; nobody owns the combined persona DTO. **Resolution:** PR owns
  `packages/api-schema/src/agents.ts` changes and lists GP's and FORK's fields.

---

## 3. Data

### 3.1 Every new table and column

| Schema.table (or column)                                                              | Owner (migration name)                 | Depends on                           |
| ------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| `ops.worker_heartbeats`                                                               | PE §5.4 and OPS §5 (both)              | —                                    |
| `ops.error_groups`, `ops.alerts`, `ops.dead_letters`, `ops.rate_counters`             | OPS §5                                 | —                                    |
| `identity.siwe_nonces.client_hash bytea`                                              | OPS §5                                 | —                                    |
| `identity.siwe_nonces.client text`, `.ip_hash text`                                   | MW `wallet_links_kind_and_labels`      | —                                    |
| `identity.wallet_links.label`, `.last_signed_in_at`, `.created_by_client`, `kind`     | MW `wallet_links_kind_and_labels`      | —                                    |
| `pickler.decisions`, `pickler.decision_resolutions`, view `current_resolutions`       | DR `decision_resolutions`              | GP `published_at` (soft)             |
| `pickler.agent_records`                                                               | DR `decision_resolutions`              | —                                    |
| `pickler.paper_orders.exit`, `pickler.paper_exit_checks`, index rebuild               | DR `paper_position_exits`              | `decision_resolutions`               |
| `agents.follows`, `agents.public_activity`                                            | PR `public_record`                     | `decision_resolutions`               |
| `pickler.decision_reviews`                                                            | SDR `decision_reviews`                 | `decision_resolutions`               |
| `agents.agents.visibility` (enum), `.published_at`                                    | GP `go_public`                         | —                                    |
| `agents.agent_profiles.avatar_key`, `.links`, `.show_thesis`, `.voice_preset`         | GP `go_public`                         | —                                    |
| `agents.x_challenges`, `agents.x_accounts`, `agents.x_posts`                          | GP `go_public`                         | —                                    |
| `wallets.agent_wallet_caps`                                                           | GP `go_public`                         | —                                    |
| `agents.agent_profiles.forkable`, `agents.agent_forks`, `agents.brief_loads`          | FORK `agent_forks`                     | `go_public` (stated)                 |
| schema `reads`: `read_services`, `reads`, `payments`, `payouts`, `refunds`, …         | PRD `paid_reads`                       | `agents.agents`, `identity.profiles` |
| `reads.ledger_entries`, `reads.disputes`                                              | PRD `paid_reads`                       |                                      |
| `identity.profiles.notify_email`, `.notify_email_verified_at`                         | PRD `paid_reads`                       |                                      |
| `pickler.runs.purpose`, `.read_id`; trigger type `"read"`                             | PRD `paid_reads`                       | collides with RR2 (D2)               |
| `pickler.perpl_accounts`, `perpl_keys`, `perpl_steps`, `perpl_orders`, `perpl_fills`  | PERPL `perpl_live`                     | DR (`decisions.venue` check)         |
| `pickler.perpl_positions`, `perpl_account_events`, `perpl_risk_state`                 | PERPL `perpl_live`                     |                                      |
| `pickler.perpl_reconciliation_issues`, `wallets.agent_wallet_venue_policies`          | PERPL `perpl_live`                     |                                      |
| `launch.agent_keys`, `launch.grants`                                                  | LD `launchpad_attribution`             | —                                    |
| `market.tokens.agent_key`, `.metadata_uri`, `.description`                            | LD `launchpad_attribution`             |                                      |
| `launch.drafts` columns, `launch.metadata_versions` changes                           | TL `token_launch_drafts`               | `launchpad_attribution` (stated)     |
| `launch.transaction_requests` columns                                                 | TL `token_launch_drafts`               |                                      |
| schema `media`: `media.uploads`, `media.takedowns`                                    | TL `token_launch_drafts`               | needed by GP avatars (C8)            |
| `market.trade_requests`, enum `market.trade_request_status`                           | TT `token_trade_requests`              | indexer v2 tables                    |
| schema `me`: `me.devices`, `me.notifications`, `me.notification_preferences`          | MB `mobile_notifications_and_devices`  | —                                    |
| `pickler.run_costs`                                                                   | RR2 `research_run_costs`               | —                                    |
| `pickler.agents.schedule_kind`, `.schedule_timezone`, `.schedule_calendar`            | RR2 `research_calendar_and_follow_ups` |                                      |
| `pickler.runs.run_trigger` widened, `.parent_run_id`; `pickler.follow_ups`            | RR2 `research_calendar_and_follow_ups` | collides with PRD (D2)               |
| drop `agents.agent_credentials`                                                       | RR2 `retire_agent_credentials`         | 30 days after code removal           |
| `wallets.transfers`, `wallets.untrusted_credentials`, `wallets.pending_additions`     | CUST `custody_transfers_and_incidents` | —                                    |
| `wallets.custody_incidents`, `wallets.passkeys.turnkey_authenticator_id`              | CUST `custody_transfers_and_incidents` |                                      |
| `identity.account_exports`, `identity.account_deletions`, `identity.reserved_handles` | CUST `account_export_and_deletion`     | `me`, `reads` (stated)               |
| future `pickler.decision_assistant_reviews`                                           | a later reviewer spec (SDR §6.2)       |                                      |
| future `pickler.decision_live_pnl` (proposed)                                         | DR (C5)                                |                                      |

Every spec says "next free number is 0023". Seventeen migrations will be numbered at merge time; the
ordering constraints below are the ones that matter.

### 3.2 Findings

- **D1 — must-fix.** Two migrations alter `identity.siwe_nonces` with overlapping columns (OPS
  `:217-218`, MW `:184-188`). See C6. **Resolution:** MW's migration adds only `client`.
- **D2 — must-fix.** Two migrations alter `pickler.runs` and its trigger type: PRD `:313-315` adds
  `purpose ('research','preview','read')`, `read_id` and trigger `"read"`; RR2 `:142-143` widens
  `run_trigger` to `('manual','schedule','follow_up','read')` and adds `parent_run_id`. Both add
  `read`; whichever lands second fails or silently drops the other's values. PRD's `purpose =
'preview'` is also odd: preview runs live in `pickler.preview_runs` (DR `:43`, OPS `:258`).
  **Resolution:** RR2 owns the `pickler.runs` trigger change (it lists `read` already); PRD drops
  `purpose` and uses `run_trigger = 'read'` plus `read_id`, and orders its migration after RR2's.
- **D3 — must-fix.** Type mismatch: PRD `:237` `reads.reads.run_id uuid` vs DR `:168` `run_id text PK
→ pickler.runs.id` (and RR2 `:129`, `:144` use `text`). **Resolution:** PRD uses `text`.
- **D4 — must-fix.** `live_pnl_micro` on an append-only table (C5). **Resolution:** DR owns a
  late-P&L table; PERPL writes it.
- **D5 — must-fix.** Hidden ordering: GP avatars need `media.uploads`, created by TL's
  `token_launch_drafts`, which follows LD's `launchpad_attribution` (C8). CUST's deletion job needs
  `me` and `reads` (stated at CUST `:277-280`). PR `§5.1` references `identity.profiles.user_id`,
  and so do TL `:193` and TT `:169`: fine for studio accounts, but every marketplace wallet-only
  account must have a `identity.profiles` row before it can follow, trade or upload — nobody states
  that SIWE sign-in creates one. **Resolution:** a standalone `media_store` migration (C8); MW `§5`
  states that `verify` creates the profile row (or PR/TT reference `auth.users`).
- **D6 — must-fix.** New schemas are missing from the platform lists: OPS `:272` backup `--schema`
  list has no `reads`, `me` or `media` (so the paid-read **money ledger** is not in the nightly
  dump); PE `:281` `db.rls` check and PE `:283` / OPS `:53` Data-API lists miss `ops`, `reads`, `me`,
  `media`. **Resolution:** OPS backs up every Drizzle-owned schema (derive the list, do not
  hard-code it); PE's verifier derives its lists the same way.
- **D7 — must-fix.** `agents.agents.visibility` backfill excludes killed agents (C14).
  **Resolution:** GP migration.
- **D8 — minor.** Two heartbeat-table creators (C24).
- **D9 — minor.** `agents.x_posts.subject_id`: GP `:234` "decision id" vs PR `:64` `public_id`.
  **Resolution:** `public_id` for `resolved_trade`, read id for `public_read`, agent id for
  `went_public`; GP's comment changes.
- **D10 — minor.** `launch.agent_keys.chain text` (LD `:125-128`) while every other chain column in
  the set is `chain_id integer` (PRD `:261`, PERPL `:162`). **Resolution:** LD follows the existing
  `launch.*` convention if it is `text`, otherwise `integer`; state which.
- **D11 — minor.** CUST `:188` deletes "`me.*` (follows, devices, notifications, preferences)";
  follows live in `agents.follows` (PR `:181-190`). **Resolution:** CUST's table lists
  `agents.follows`, `agents.brief_loads` (FORK, has a user id), `market.trade_requests` (TT) and
  `media.uploads` (TL) in one column or the other; its own test (CUST `:279-280`) will catch the rest.
- **D12 — minor.** `wallets.agent_wallet_caps.cap_policy_ids` (GP `:253`) and
  `wallets.agent_wallet_venue_policies.policy_ids` (PERPL `:171`) both record per-venue Turnkey
  policy ids. **Resolution:** one table keyed `(agent_id, venue)`; GP's caps table keeps the
  amounts only.

---

## 4. Workers and infrastructure

### 4.1 Inventory

PE `§6.1` (`:417-446`) inventories five Workers and says "Perpl, paid-read treasury and
launch-authorization keys are added by their own specs; each must add its names to
`deploy/required-bindings.json` in the same PR" (`:448`). Everything below is not in PE's inventory
today.

| Kind          | Name                                                                                                           | Owner       | In PE?                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------- |
| Worker        | `workers/ops` (`pickler-ops-<env>`): tail consumer, probe, alerts, retention                                   | OPS §6.1    | no (PE D1 lists five)         |
| Worker        | `workers/jobs`: crons calling `/v1/internal/*`                                                                 | GP, PRD     | no                            |
| Worker        | `workers/treasury`: read treasury signer                                                                       | PRD R18     | no                            |
| Cron          | research `*/5` resolution + exit monitor                                                                       | DR `:357`   | no                            |
| Cron          | ops `* * * * *`, `0 4 * * *`                                                                                   | OPS `:315`  | no                            |
| Cron          | jobs: every minute (X outbox, reads verify/sweep/refunds), 5 min, 00:30, 01:00                                 | GP, PRD     | no                            |
| Cron          | api: every minute (launch status), daily (media cleanup)                                                       | TL          | no                            |
| Cron          | api: every minute (trade watcher, "or the research Worker's Cron")                                             | TT `:210`   | no                            |
| Cron          | api: `*/15` sweepers and reconciler                                                                            | CUST        | no                            |
| Cron          | trading: `graduation-keeper`; Perpl reconciliation, risk stops, key expiry                                     | TT, PERPL   | no                            |
| Queue         | `pickler-research-dlq-<env>`, `pickler-trading-dlq-<env>`                                                      | OPS         | partly (PE D4 names "DLQs")   |
| Queue         | `launch-events` (`LAUNCH_EVENTS_QUEUE`), indexer → api consumer                                                | LD          | no                            |
| Queue         | `pickler-notifications`, `pickler-notifications-dlq`, api consumer                                             | MB          | no                            |
| Queue         | `pickler-account-jobs`, api consumer                                                                           | CUST        | no                            |
| Queue message | `{ kind: "perpl-decision" }`, `perpl-kill` on the trading queue                                                | PERPL       | no                            |
| R2            | `pickler-backups`                                                                                              | OPS / PE    | yes (operator keys)           |
| R2            | `pickler-media-staging`, `pickler-media-production` (`MEDIA`) + custom domains                                 | TL §6.1     | no                            |
| R2            | `pickler-exports` (`EXPORTS`)                                                                                  | CUST        | no                            |
| Binding       | `ratelimits` `RL_AUTH`, `RL_PUBLIC`, `RL_FORMS`, `RL_MODEL`, `RL_MONEY`                                        | OPS         | no                            |
| Binding       | `SEND_EMAIL`, `tail_consumers` on every Worker                                                                 | OPS         | no                            |
| Binding       | `IMAGES` (Cloudflare Images)                                                                                   | TL          | no                            |
| Secret        | `RATE_LIMIT_SALT`, `OPS_ALERT_WEBHOOK_URL`                                                                     | OPS         | no                            |
| Secret        | `X_BEARER_TOKEN`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_TOKEN_ENCRYPTION_KEY`                                   | GP          | no                            |
| Secret        | `TREASURY_TURNKEY_API_PUBLIC_KEY`, `TREASURY_TURNKEY_API_PRIVATE_KEY`, `EMAIL_API_KEY`                         | PRD         | no                            |
| Secret        | `PERPL_KEY_ENCRYPTION_KEY`, `PERPL_TESTNET_FAUCET_PRIVATE_KEY`, `TURNKEY_DELEGATED_API_PRIVATE_KEY` (trading)  | PERPL       | no (PE has it on api only)    |
| Secret        | `LAUNCH_AUTHORITY_TURNKEY_KEY_ID`                                                                              | LD          | no                            |
| Secret        | `LAUNCH_KEEPER_PRIVATE_KEY`                                                                                    | TT          | no                            |
| Secret        | `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`                                                                   | MB          | no                            |
| Secret        | `NONCE_IP_SALT`                                                                                                | MW          | no (and should go, C6)        |
| Var           | `POLYGON_RPC_URL`, `RESOLUTION_ENABLED`, `EXIT_MONITOR_ENABLED`                                                | DR          | no                            |
| Var           | `PERPL_BOARD_ENABLED`, `PERPL_BOARD_NETWORK`, `PUBLIC_RECORD_ENABLED`                                          | PR          | no                            |
| Var           | `REVIEW_EXPORT_ENABLED`                                                                                        | SDR         | no                            |
| Var           | `READ_TREASURY_ADDRESS`, `TREASURY_TURNKEY_ORG_ID`, `TREASURY_WALLET_ID`, `TREASURY_SENDS_ENABLED`             | PRD         | no                            |
| Var           | `EMAIL_FROM`                                                                                                   | PRD         | no                            |
| Var           | `PERPL_ADMISSIONS_ENABLED`, `PERPL_STUDIO_ENABLED`, `PERPL_CHAIN_ID`, `PERPL_ENROLL_ORIGIN`                    | PERPL       | no                            |
| Var           | `PERPL_MAX_LEVERAGE`, `PERPL_PILOT_MAX_COLLATERAL_MICRO`, `PERPL_AGENT_GAS_FLOOR_MON`                          | PERPL       | no                            |
| Var           | `LAUNCH_AUTHORITY_ADDRESS`, `LAUNCH_GRANT_TTL_SECONDS`, `RPC_URLS` (api)                                       | LD          | no                            |
| Var           | `LAUNCH_MAX_GAS`, `LAUNCH_TICKER_RESERVATION_DAYS`, `LAUNCH_CHAIN_ID`, `TOKEN_LAUNCH_ENABLED`                  | TL          | no                            |
| Var           | `MEDIA_PUBLIC_BASE_URL`, `MEDIA_UPLOAD_MAX_BYTES`, `MEDIA_UPLOADS_PER_HOUR`                                    | TL          | no                            |
| Var           | `QUOTE_MAX_HEAD_AGE_SECONDS`, `QUOTE_MAX_INDEX_LAG_SECONDS`, `TRADE_DEADLINE_SECONDS`, `LAUNCH_KEEPER_ENABLED` | TT          | no                            |
| Var           | `NONCE_IP_CAP`                                                                                                 | MW          | no                            |
| Var           | `MOBILE_MIN_VERSION_IOS`, `_ANDROID`, `MOBILE_LATEST_VERSION_IOS`, `_ANDROID`                                  | MB          | no                            |
| Var           | `RESEARCH_TARIFFS`, `RESEARCH_MONTHLY_ALLOWANCE_MICRO_USD` (research, api)                                     | RR2         | no                            |
| Var           | `MON_GAS_TOPUP_WEI`, `ACCOUNT_DELETION_GRACE_DAYS`, `HANDLE_QUARANTINE_DAYS`, `DUST_*`                         | CUST        | no                            |
| Var           | `PROBE_URLS`                                                                                                   | OPS         | no                            |
| Web build     | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                                                                               | OPS         | no (PE `:421-423`)            |
| Web build     | `PICKLER_DEPLOY_ENV`, `AASA_ON_LANDING`                                                                        | PHC         | no                            |
| Web build     | `NEXT_PUBLIC_MERA_RP_ID`, `NEXT_PUBLIC_MERA_WEB`                                                               | MW          | no                            |
| Web build     | `NEXT_PUBLIC_MONAD_RPC_URL`, `NEXT_PUBLIC_TOKEN_TRADING`                                                       | TT          | no (and C23)                  |
| GitHub secret | `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `BACKUP_R2_BUCKET`, `BACKUP_AGE_*`                   | OPS         | named `BACKUP_BUCKET_*` in PE |
| DNS           | `media.pickler.fun`, `media-staging.pickler.fun`                                                               | TL          | no (PHC `:210-216` DNS table) |
| DNS           | `mail.pickler.fun` (Resend SPF/DKIM)                                                                           | OPS O9      | no                            |
| DNS           | `sign.app.pickler.fun` (v1.1 signer iframe)                                                                    | MW `:259`   | no                            |
| External      | Perpl origin whitelisting for `studio.pickler.fun` and the staging studio                                      | PERPL       | —                             |
| External      | X developer app (Basic), Firebase project, Resend account, external uptime monitor                             | GP, MB, OPS | —                             |

### 4.2 Findings

- **W1 — must-fix. Three homes for scheduled jobs.** GP `:280` and PRD `:332` create
  `workers/jobs` ("Cron triggers that call `/v1/internal/*` through a service binding"); TL `:130`,
  `:191`, TT `:210-211` and CUST `:57`, `:202` put crons on `workers/api`'s own `scheduled` handler
  (TT even allows "the research Worker's Cron if `workers/api` has none"); OPS `:315` runs retention
  in `workers/ops`. **Resolution:** PE decides once. Recommended: `workers/api` gets one `scheduled`
  handler with a dispatch table (it already owns every table these jobs touch, and CUST notes it has
  no Cron today), and `workers/jobs` is dropped; OPS keeps only probes and alert rules. GP, PRD, TL,
  TT and CUST then cite PE's cron table.
- **W2 — must-fix. PE's pipeline does not know the new Workers.** PE D1 `:147` (five Workers), D8
  `:154` (release order), the ledger's `workers` object (`:380-386`) and `check:production` (`:461`)
  have no `ops`, `jobs` or `treasury`. A treasury deployed outside the ordered, ledgered release is
  the §0 incident again, with money. **Resolution:** PE adds the three (or two, after W1) to D1, D8
  (treasury with trading, before API; ops last), the ledger and `check:production`.
- **W3 — must-fix. The API gains three queue consumers and a cron.** LD `:57` (`launch-events`), MB
  `:168` (`pickler-notifications`), CUST `:204` (`pickler-account-jobs`); PE `:424` lists API bindings
  `RESEARCH_QUEUE`, `TRADING_QUEUE`, `TRADING_EXECUTOR` only. DLQ naming also differs: OPS
  `pickler-<name>-dlq-<env>` (`:318`) vs MB `pickler-notifications-dlq` (`:176`, no env).
  **Resolution:** PE's inventory adds the consumers; MB follows OPS's DLQ naming and OPS consumes it.
- **W4 — must-fix. The research Worker is asked to call the API.** PRD `:121`, `:185`: "the research
  worker calls `/v1/internal/reads/:id/deliver`"; GP `:173`: the resolution job calls
  `/v1/internal/x/enqueue`; MB `:166-168`: PR's publication (inside DR's research-Worker transaction)
  enqueues on `pickler-notifications`. PE `:436` gives research `DATABASE`, `RESEARCH_QUEUE` and
  `TRADING_QUEUE` only. **Resolution:** either research gets an `API` service binding and a
  `NOTIFICATIONS_QUEUE` producer (PE inventory), or delivery and notifications are written through
  core use cases in the same Postgres transaction and picked up by the API's cron (fewer bindings,
  matches C18). PRD, GP and MB state which.
- **W5 — must-fix. Circular ownership of media storage.** GP `:55`, `:279`, `:347` → TL; TL `:252-253`
  → GP. TL does own it clearly (`:179-180`), but ships it inside a launchpad-dependent migration.
  **Resolution:** see C8; TL `§6.1` becomes phase 1 work with its own migration and PR.
- **W6 — must-fix. Alert rules are declared in five specs and registered in none.** DR `:100` ("an
  ops alert fires" at 30 days stale), PR `:59-60` (`COMMITMENT_MISMATCH`), PRD `:190` (reconcile
  mismatch), TT `:246` (keeper under 0.5 MON), LD `:269-270` (launch without a grant), PERPL
  (reconciliation issues freeze an agent) — OPS `§6.2` (`:327-339`) has none of them.
  **Resolution:** OPS `§6.2` becomes the rule registry; each spec adds its rule there in the same PR.
- **W7 — must-fix. Email has no owner.** PRD `:331` "the existing Supabase SMTP or a dedicated
  provider … decision recorded at build"; CUST `:207` "the email provider of `paid-reads-v1.md`"; OPS
  `:49` Resend for Supabase Auth only and Cloudflare `send_email` for alerts; MB `:150-151` read
  emails. **Resolution:** OPS O9 extends Resend to transactional mail (`EMAIL_FROM`,
  `EMAIL_API_KEY`), PRD and CUST cite OPS.
- **W8 — minor.** User reports of images "go to the operations queue defined in `operations-v1.md`"
  (TL `:192`); OPS defines no such queue. **Resolution:** TL says "an operator email via OPS O4"
  until a report route exists.
- **W9 — minor.** DNS entries outside PHC's table (media, mail, sign). **Resolution:** PHC `§6.1`
  becomes the zone's full inventory.
- **W10 — minor.** `TURNKEY_DELEGATED_API_PRIVATE_KEY` moves to a second Worker (PERPL `:229`), which
  widens its blast radius beyond PE's "held, unused until live trading" (`:80`). **Resolution:** PE's
  inventory records it on trading, and PERPL `§8` states the trading Worker is the only one that
  decrypts it once Perpl is live.

---

## 5. Dependencies

### 5.1 Graph (from each spec's "Rollout and dependencies")

`A → B` means A needs B first. Soft edges (A can ship a first part without B) are marked `(s)`.

```
PE    → PHC, OPS
PHC   → PE (§0 first; PE step 6 after PHC)                        [interleaved]
OPS   → PE
DH    → PHC, PE, OPS
DR    → GP (s), RR2 (s, exit-check spend), PERPL (Perpl resolution only)
PR    → DR, GP, PRD (answer rows), product-hosts-v1 (should be PHC)
SDR   → DR
GP    → PHC, PE, TL (media), DR (s, outbox), PR (s, followers), PERPL + CUST (s, venue ALLOW)
PRD   → GP, DR (outcome port), PHC, MW (s, EOA first), MB (app), PE, OPS
FORK  → GP, DR (s)
PERPL → GP, RR2 (perps-direction-v1), DR (live P&L), PE, PRs #60/#63
LD    → GP (grant check), PE, launchpad-monad-v1
TL    → LD, GP
TT    → LD, MW, TL, MB (s, mobile release)
MW    → PHC; PRD, TT (s, request types)
MB    → PHC, MW, the envelope switch, PR (follows); PRD, TT (s)
RR2   → DR (R9), PERPL (perps), PRD (R5 per-read ceiling)
CUST  → PE, PHC; MB, PRD (s, deletion lists)
```

### 5.2 Findings

- **K1 — blocker. PERPL ↔ RR2 deadlock on `perps-direction-v1`.** PERPL `:316-317` needs "the
  `perps-direction-v1` protocol and a hosted Perpl data session" from RR2; RR2 `:53`, `:227` does
  perps "after the Perpl trading spec", and defines only a one-line row (`:168`). Nobody owns the
  protocol. **Resolution:** write the missing spec (G1) and make both depend on it.
- **K2 — must-fix. GP ↔ TL (media).** C8/W5. **Resolution:** extract the media store.
- **K3 — must-fix. RR2 ↔ PRD (per-read ceiling vs budget).** C2. **Resolution:** PRD sets the
  ceiling; then PRD → RR2 only.
- **K4 — must-fix. Missing edges.** PRD `§10` omits RR2 although R13 depends on it; PERPL `§10` omits
  CUST although P12 does; DR, TT, MB and MW omit PE although they add bindings (W2); MW and OPS do not
  know about each other (C6); CUST and OPS do not either (C7); PR names product-hosts-v1 where PHC
  builds the AASA; MB → PRD for the email flow. **Resolution:** add them to each spec's `§10`.
- **K5 — minor. PE ↔ PHC.** A real cycle, deliberately interleaved (PE §0 → PHC → PE steps 4–6).
  **Resolution:** keep; both specs already describe the interleave. Add a single combined runbook
  line in PE `§10` so nobody reads it as a deadlock.
- **K6 — minor. Soft cycles** GP ↔ PR (followers vs visibility), GP ↔ DR (outbox vs
  `published_at`), GP ↔ PERPL (manifest vs public agents), MB ↔ TT, MW ↔ PRD/TT, CUST ↔ MB/PRD. Each
  resolves by shipping the harder dependency's first step first (listed in the phases below).

### 5.3 Proposed build order

**Phase 0 — now, no dependency.** PE §0.1 (degraded reads, web only) and §0.2 Step A (API from main);
OPS step 1 (logs with cause); DH V1, V2 (report mode), V11 (gates) and V10 (merge gate).

**Phase 1 — platform foundations.** PE pipeline, ledger, smoke and verifier on staging, with the W1
cron decision and the W2 Worker list; OPS nonce cap (merged with MW, C6), rate-limit bindings,
`workers/ops`, DLQs, backups of every schema (D6); PHC code and the staging rehearsal (H11); the
standalone media store (C8); DH V7, V8. Owner: Supabase project (Q-ENV-1).

**Phase 2 — identity and record foundations (parallel tracks).**

- Hosts: PHC production cutover through Step B and the first studio passkey (after X2 is answered).
- Wallets: MW migration and API (`kind`, labels, link cap); web Mera behind its flag after the owner
  accepts the key-in-page risk and the phone key model is confirmed.
- Mobile contract: MB app-config, version gate, envelope switch of `/v1/marketplace/*` (C9) — needs
  the app's source.
- Studio: GP migration (`visibility`, fixed backfill C14) and the reader switch; voice and profile.
- Resolution: DR `decision_resolutions`, enrolment (excluding read runs, C1), backfill, staging
  acceptance.
- Runtime: RR2 budget and paid acceptance record (owner allowance), then calendar and follow-ups (it
  owns the `pickler.runs` trigger change, D2).
- Custody: CUST wallets list and withdraw (AUSD) — sweepers go to OPS (C7).
- Launchpad: LD contract change, internal review, indexer v2 rebase, testnet deploy (needs Safe
  signers).

**Phase 3 — publication and studio features.** PR follows, then publication and public routes behind
`PUBLIC_RECORD_ENABLED` once DR acceptance passes; SDR; GP X verification, caps, publish and outbox;
FORK; DR exit monitor; TL (after LD deploy and GP).

**Phase 4 — money on testnet.** PRD with C1–C4 fixed (treasury Worker, intents, delivery with sends
disabled, then refunds, evaluation, payouts); TT (after LD, MW, TL); CUST send, export, deletion; MB
notifications and devices; the mobile release on the enveloped API.

**Phase 5 — live trading and mainnet gates.** The missing `perps-direction-v1` spec (G1) → RR2 perps
→ PERPL testnet onboarding and acceptance; RR2 crypto up/down; then the mainnet gates (Perpl pilot
size, launchpad audit and presets, paid-read regulation, tax and sanctions).

---

## 6. Rule compliance

The owner's rule (CONV `:9-17`) holds across the set: no spec puts Turnkey in a marketplace flow, Mera
in the studio, or an EOA on the phone. The findings are about the edges.

- **V1 — must-fix. Conventions decision 1 is narrowed without saying so.** CONV `:23-24`: until
  resolution "only the owner (studio) and **paying readers** see them". PR `:39` (P1) and `:357`
  leave "whether a paying reader sees an unresolved decision tied to their read" to PRD; PRD never
  answers it — a read is a fresh run (R13), and the buyer sees only their own answer. **Resolution:**
  PRD states the departure ("paying readers see their read's answer, not the agent's open
  decisions") with its reason, and CONV decision 1 is reworded; or PRD adds a paid view of the
  agent's open decisions on the read's market.
- **V2 — must-fix. Backend Turnkey keys in marketplace money paths.** PRD R18 (`:60`) holds the read
  treasury in Pickler's Turnkey parent organisation and LD D3 (`:45`) the launch authority there too.
  Both say why (backend custody, not a user wallet), which the rule allows, but CONV `:16` reads
  "Turnkey never appears in the marketplace" without that carve-out, and PRD's refunds to marketplace
  wallets come from it. **Resolution:** CONV adds "Pickler's own backend keys may live in Turnkey's
  parent organisation; no marketplace user ever signs with, or sees, Turnkey".
- **V3 — minor. The API does not enforce "Mera only on the phone".** MB `:37` (M0) says so plainly: an
  EOA signature is valid SIWE from any client, and `kind` is descriptive (MW D9). Stated and
  accepted; no change.
- **V4 — minor. Mera signing session on the phone but not on the web.** MW `:48` (D5) vs MB `:41`
  (M4): deliberate and consistent (5 minutes, cleared on background). No change.
- **V5 — minor. Departures that are stated.** PR P10 (bare bodies kept, `:48`), MW's legacy
  lower-case error codes (`:145-147`), PERPL P8 (margin caps not in the wallet, `:49`), PERPL P6
  (REST instead of research 02's WebSocket, `:47`), RR2 micro-USD (C15), SDR/RR2/CUST keeping the
  existing studio routes' bare bodies. All state a reason; CONV should list them as known exceptions.

Checked and consistent with the nine decisions: decision 2 (DR), 3 (PRD R7, R16, R17), 4 (PRD R2,
naming aside: CONV says "Pricing section", PRD calls it "Reads"), 5 (LD D1–D4, TL T1/T3), 6 (LD D12),
7 (PERPL P1–P5, P10), 8 (SDR R8), 9 (PE).

---

## 7. Coverage against research 01–06 "Specs to write"

| Research item                                                                 | Covered by                  | Status             |
| ----------------------------------------------------------------------------- | --------------------------- | ------------------ |
| R01 1–3 paid reads, read payments, read service                               | PRD                         | covered            |
| R01 4 settlement and record; R01 5 activity and following; R01 6 perps board  | DR, PR                      | covered            |
| R01 7 product-hosts implementation                                            | PHC                         | covered            |
| R02 1 Perpl live execution                                                    | PERPL                       | covered (REST, V5) |
| R02 2 agent wallet venue policies v2                                          | PERPL P2–P4, GP D11–D13     | covered            |
| R02 3 venue funding                                                           | PERPL §3, CUST C1–C2        | partly (C13)       |
| R02 4 Perpl agent runtime (protocol, brief, paper-first, hosted data session) | —                           | **missing (G1)**   |
| R02 5 perps market board                                                      | PR P9                       | covered            |
| R02 6 Polymarket user custody                                                 | —                           | missing (G5)       |
| R02 7 trading receipts and P&L across venues                                  | DR D15, PERPL P15           | partly (C5)        |
| R03 1–3 launch authorization, deployment, indexer v2                          | LD                          | covered            |
| R03 4 studio token launch; R03 5 token trading                                | TL, TT                      | covered            |
| R03 6 launchpad product spec (LP-01..LP-22) committed                         | —                           | missing (G4)       |
| R04 1–3 resolution, public picks, studio review                               | DR, PR, SDR                 | covered            |
| R04 4 reviewer in the runtime, or a decision not to                           | SDR R8–R9                   | covered (decision) |
| R04 5–7, 9–10 budget, categories, HMAC, scheduling, acceptance                | RR2                         | covered            |
| R04 8 exit monitoring                                                         | DR D13–D14                  | covered            |
| R05 S1 hosts addendum; S2 mobile backend; S3 go public; S4 fork               | PHC, MB, GP, FORK           | covered            |
| R05 S5 identity and profile sections                                          | GP §3.4                     | partly (G6)        |
| R05 S6 custody v2; S7 production rollout runbook; S9 web Mera                 | CUST, PE §0.2 + PHC §10, MW | covered            |
| R05 S8 schema-boundaries decision                                             | —                           | missing (G3)       |
| R06 S1–S4 production, release, hosts, verifier                                | PE, PHC                     | covered            |
| R06 S5–S7 observability, abuse, backups                                       | OPS                         | covered, gaps (G7) |
| R06 S8 design harness v3                                                      | DH                          | covered            |
| R06 S9 acceptance runs v2 (research, trading pilot, browser session)          | RR2 R13 (research only)     | partly (G2)        |
| R06 S10 schema-boundaries decision record                                     | —                           | missing (G3)       |

- **G1 — blocker.** No spec owns `perps-direction-v1` (R02 item 4): the decision schema (with a
  horizon, C3), the Perpl agent brief (markets, `maxLeverage` semantics, style → risk), paper-first
  hosted `perps-paper`, the hosted data session without the 12-request CLI cap, and the research vs
  trading Worker composition. PERPL, DR and RR2 all assume it. **Resolution:** a new
  `perpl-agent-runtime-v1.md`, owned by the runtime area, before PERPL is built.
- **G2 — must-fix.** R06 S9's trading pilot funded purchase and the hosted browser session-lifecycle
  acceptance are in no spec; RR2 R13 covers research runs only. **Resolution:** PE `§10` or OPS adds
  an "acceptance runs" section with both, recorded in the ledger format.
- **G3 — must-fix.** The schema-boundaries decision (R05 S8, R06 S10) is only mentioned (PE `:553-554`,
  OPS `:264-265`). Every spec above creates tables in today's schema names, and PERPL `:155` already
  hedges ("`pickler`; `runtime` after `schema-boundaries-v1.md:133`"). **Resolution:** an owner
  decision before phase 2 migrations (Q-ENV-6).
- **G4 — minor.** The launchpad product spec (LP-01..LP-22) is still not in the repository (R03 item
  6); LD cites `launchpad-monad-v1.md` as the authority. **Resolution:** commit an English summary with
  LD.
- **G5 — minor.** Polymarket user custody (R02 item 6) depends on owner question R02 Q3; no spec, and
  none needed until the owner answers.
- **G6 — minor.** R05 S5 asked for editable handles after creation with `handle_history`; GP D17
  (`:54`) fixes the handle once public and has no history table. Decided differently, not missed;
  also "linking a phone wallet to an existing studio account" (R05 S2) appears nowhere. **Resolution:**
  MW `§3.4` states whether a studio account may link a Mera wallet.
- **G7 — must-fix.** Read runs and the one-running-agent lock: PRD `:55`, `:329` puts read runs in "a
  priority lane … admitted before scheduled runs", with deadlines as short as 5 minutes (PRD `:45`),
  but no runtime spec defines that lane, and DR `:56` confirms runs take the `one_running_agent`
  lock — a scheduled run in progress blocks a paid read. OPS also leaves R06 S7's retention of runs,
  evidence and audit unspecified. **Resolution:** RR2 adds read admission (bypass or pre-empt the
  lock; the research cron's one-minute tick is part of the SLA budget) and PRD's minimum deadline is
  checked against it.
- **G8 — minor.** Nobody defines how a paid read "counts in the agent's record" (PRD `:56`, `:360`);
  DR's `agent_records` has no read fields. **Resolution:** PRD says reads count only in the read
  service's `evaluated`/`gap`, or DR adds read columns.

---

## 8. Owner questions (section 12 of every spec), deduplicated

**B** = blocks building (no safe default); **D** = a safe default is decided and building can
proceed. Where the question blocks only a later gate (mainnet), it says so.

### Environments, operations and process

| Id       | Question                                                                                                                 | Sources                 | Block?                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | -------------------------------------- |
| Q-ENV-1  | Separate production Supabase project (recommended), one project with schemas, or promote the current one? Plan and PITR? | PE Q1, OPS Q3           | **B** (PE phase 1 step 3–4)            |
| Q-ENV-2  | May the release workflow hold a Cloudflare token and the production migration URL as GitHub secrets?                     | PE Q2                   | D (operator-run with the same ledger)  |
| Q-ENV-3  | Turn off Workers Builds' production auto-deploy for the web?                                                             | PE Q3                   | D (off)                                |
| Q-ENV-4  | Who besides the owner may release and merge (`deploy/operators.txt`) and add `design:intended`?                          | PE Q4, DH Q2            | D (owner only)                         |
| Q-ENV-5  | Alert destination email, a chat webhook, and an external uptime service under the owner's account?                       | OPS Q1, Q2              | D (webhook only until answered)        |
| Q-ENV-6  | Schema boundaries: accept or park `schema-boundaries-v1` before production data?                                         | research 05 Q10, 06 S10 | **B** for migration names (G3)         |
| Q-ENV-7  | Transactional email and Auth SMTP provider: is Resend acceptable?                                                        | OPS Q3, PRD §6          | D (Resend)                             |
| Q-ENV-8  | Upgrade the GitHub plan for branch protection? Phone checks blocking from day one?                                       | DH Q1, Q3               | D (merge gate, report mode)            |
| Q-ENV-9  | Model draft ceiling (200 per day per environment)?                                                                       | OPS Q4                  | D                                      |
| Q-ENV-10 | Authorise the paid staging acceptance (≤ 3 paid runs + 1 refused) and the trading pilot purchase                         | RR2 Q2, research 06 Q10 | **B** for acceptance records, not code |

### Hosts, mobile app and marketplace wallets

| Id      | Question                                                                              | Sources         | Block?                                       |
| ------- | ------------------------------------------------------------------------------------- | --------------- | -------------------------------------------- |
| Q-MOB-1 | Where is the iOS app's source, who owns it and who ships the `app.pickler.fun` build? | PHC Q1, MB Q1   | **B** (PHC step 8, all of MB §10.3)          |
| Q-MOB-2 | Does the phone app use Mera's PRF model or the vault model?                           | MW Q1, MB §10.3 | **B** (MW D2 is one-way once funds are held) |
| Q-MOB-3 | Have TestFlight testers put funds on `pickler.fun`-derived addresses?                 | PHC Q2          | **B** for removing the apex AASA (X2)        |
| Q-MOB-4 | Accept the key-in-page risk of Mera on the web (D5/D6 now, signer iframe later)?      | PHC Q4, MW Q2   | **B** for web Mera (EOA ships regardless)    |
| Q-MOB-5 | Wallet sign-in on `pickler.fun` before the cutover?                                   | PE Q5           | D (off until Step B)                         |
| Q-MOB-6 | Firebase project and the APNs key for push?                                           | MB Q2           | D for build (fallback relay); blocks push    |
| Q-MOB-7 | Android package name and release key SHA-256                                          | PHC Q3, MB Q3   | D (`[]` until Android)                       |

### Paid reads and money

| Id      | Question                                                                                          | Sources         | Block?                             |
| ------- | ------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------- |
| Q-PAY-1 | Is selling a probability regulated where Pickler serves? Terms, geo-blocking, KYC?                | PRD Q1          | **B for mainnet**; D for testnet   |
| Q-PAY-2 | Taxes: seller of record, marketplace facilitator, payout reporting?                               | PRD Q2          | **B for mainnet**                  |
| Q-PAY-3 | Sanctions screening before mainnet?                                                               | PRD Q6          | **B for mainnet**                  |
| Q-PAY-4 | Treasury custody: Turnkey parent-org wallet, multisig or KMS? Who tops up MON, resolves disputes? | PRD Q4          | D for testnet (Turnkey parent org) |
| Q-PAY-5 | Fee 10 %, and any share to the agent's token? Fork royalties?                                     | PRD Q5, FORK Q1 | D (10 %, no royalty)               |
| Q-PAY-6 | Buyers pay MON gas, or gasless EIP-3009 relayed by Pickler?                                       | PRD Q3          | D (buyer pays)                     |
| Q-PAY-7 | Who pays for research after the beta; who pays exit-check calls?                                  | RR2 Q1, DR Q2   | D (Pickler, $5/agent/month)        |

### Studio, Go Public and publication

| Id      | Question                                                                                    | Sources          | Block?                                   |
| ------- | ------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------- |
| Q-PUB-1 | Does Pickler have an X developer account, who owns it, and is the Basic tier cost approved? | GP Q1            | **B** (Connect X; Go Public requires it) |
| Q-PUB-2 | Is Connect X required for Go Public? May the verification line tag `@pickler`?              | GP Q2, Q3        | D (required; yes)                        |
| Q-PUB-3 | Unpublish: keep "kill only"?                                                                | GP Q4            | D                                        |
| Q-PUB-4 | Leaderboard score: add Brier skill before the leaderboard goes public?                      | DR Q1            | D (existing `agentScore`)                |
| Q-PUB-5 | Pre-ship decisions in public records; thesis opt-out; follower count threshold              | DR Q3, PR Q1, Q2 | D                                        |
| Q-PUB-6 | Export owners' reviews for evaluation datasets; pause the Jev track?                        | SDR Q1, Q2       | D (export off)                           |
| Q-PUB-7 | Fork opt-in default and minimum record to be listed                                         | FORK Q2, Q3      | D (off; no minimum)                      |

### Launchpad and token trading

| Id      | Question                                                                       | Sources          | Block?                                            |
| ------- | ------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------- |
| Q-LCH-1 | Who are the signers of the operator and treasury Safes?                        | LD Q3            | **B** (testnet deploy; the operator is immutable) |
| Q-LCH-2 | Licence: BUSL-1.1 → GPL-2.0 in 2030, MIT, or proprietary?                      | LD Q1            | **B for mainnet**; D for testnet                  |
| Q-LCH-3 | Mainnet preset numbers, launch fee, audit firm and budget                      | LD Q2, Q4, TL Q1 | **B for mainnet**                                 |
| Q-LCH-4 | Minimum record before launching; metadata edits after launch                   | TL Q2, Q3        | D (public only; frozen)                           |
| Q-LCH-5 | Post-graduation trading inside Pickler or an external DEX; a Pickler trade fee | TT Q1, Q2        | D for testnet (read-only pool; no fee)            |

### Perpl live trading

| Id      | Question                                                               | Sources  | Block?                     |
| ------- | ---------------------------------------------------------------------- | -------- | -------------------------- |
| Q-PRP-1 | Will Perpl grant testnet USD for Pickler's faucet, or a public faucet? | PERPL Q1 | **B** (testnet onboarding) |
| Q-PRP-2 | Mainnet pilot size (100 AUSD per agent, 2x)?                           | PERPL Q2 | **B for mainnet**          |
| Q-PRP-3 | A Pickler builder code and fee on agents' trades?                      | PERPL Q3 | D (none)                   |
| Q-PRP-4 | Seven passkey prompts at onboarding, or a Turnkey session?             | PERPL Q4 | D (seven prompts)          |

### Custody and data retention

| Id      | Question                                                         | Sources | Block? |
| ------- | ---------------------------------------------------------------- | ------- | ------ |
| Q-CUS-1 | Legal retention period for financial rows after account deletion | CUST Q1 | D      |
| Q-CUS-2 | Accept Turnkey cost of undeletable orphan sub-organisations?     | CUST Q2 | D      |

Blocking count: Q-ENV-1, Q-ENV-6, Q-ENV-10, Q-MOB-1, Q-MOB-2, Q-MOB-3, Q-MOB-4, Q-PUB-1, Q-LCH-1,
Q-PRP-1 block phase 1–4 work; Q-PAY-1/2/3, Q-LCH-2/3 and Q-PRP-2 block only mainnet (counted as two
grouped items in the summary: "paid-read mainnet" and "launchpad/Perpl mainnet").

---

## 9. Specific checks

### X1 — must-fix — Paid reads require an email; marketplace accounts are made by wallet sign-in

- PRD `:53` (R11): `POST /v1/me/reads` answers `409 EMAIL_REQUIRED` until the profile has a
  **notification email** (`identity.profiles.notify_email`, PRD `:309-310`), set through
  `PUT /v1/me/notify-email` (`:174`).
- MW `:54` (D11): a **wallet-only account** ("no email, `app_metadata.pickler_account = "wallet"`")
  cannot unlink its last wallet; "an account with an email can unlink every wallet".
- MB `:81` handles the 409 on the phone ("shows the email field first"); MB `:150-151` sends read
  email "when the profile has an email"; CUST `:242-243` emails exports "to the account's address".

There is no hard clash: the notification email is a profile field, not a Supabase Auth login, so a
wallet account stays a wallet account. The problems are in the edges:

1. MW D11's "an account with an email" does not say which email. If a notification email counted, a
   wallet-only buyer who adds one could unlink every wallet and have no way to sign in.
2. PRD `:53` lets an **unverified** email pass the gate, so the gate proves nothing, and the
   verification route is missing (E3).
3. MB now provides stored notifications (`me.notifications`, M6), which solves "a refund nobody hears
   about" (PRD R11's reason) without an email.

**Resolution.** MW D11 says "an account with a **login** email (Supabase Auth identity), never the
notification email"; PRD R11 says the notification email never becomes a login and never changes
`pickler_account`; PRD relaxes R11 to "an email **or** in-app notifications (MB M6)" so wallet-only
and phone buyers are not forced to give an email, and adds the verify route; MB and CUST use "the
verified notification email" by name.

### X2 — blocker — The Mera RP move can strand TestFlight funds

- Today the TestFlight app uses RP `pickler.fun` (research 05 `:12`, `:189`; MB `:28`, `:186-188`).
- MW `:45` (D2): the PRF model is "deterministic per **credential and RP**", so a passkey on
  `app.pickler.fun` is a new credential with a **new address**; addresses derived under `pickler.fun`
  can be reached only by asserting `rpId: pickler.fun`.
- PHC `:49` (H9): "The apex stops serving the AASA at cutover"; `AASA_ON_LANDING` defaults to
  `false`. Without the apex `webcredentials` association, the app can no longer assert for
  `pickler.fun` at all, so any balance on an old address is stuck until someone ships a build that
  both keeps `webcredentials:pickler.fun` and moves the funds.
- PHC `:353-355` (Q2) asks whether testers hold funds; MW Q1 asks whether the app even uses the PRF
  model (if it uses the vault model, the address question changes again). MB `§6.1` changes the RP
  and `§10.3` item 6 wonders whether the app trades Perpl today. No spec contains a "move your funds
  to your new wallet" flow; MW `:344-345` puts Mera export out of scope.

**Resolution.** Until PHC Q2 and MW Q1 are answered: PHC flips `AASA_ON_LANDING` to default `true`
for production and removes the apex association only after the migration build has shipped and a
stated window (for example 30 days) has passed; MB adds a one-time "Move funds to your new wallet"
flow (assert the old RP, sign a transfer of AUSD and MON to the new address, broadcast), guarded by
the same confirmation sheet; PHC `§10.1` gains that as a step before removing the apex file. If the
answer is "no funds on mainnet, testnet only", PHC can keep its current default and say so.

---

## Appendix — findings by the spec that should change

| Spec  | Findings to action                                                           |
| ----- | ---------------------------------------------------------------------------- |
| PE    | W1, W2, W3, W4, W10, C22, C23, C24, C25, C26, D6, E12, K4, K5, G2            |
| PHC   | C10, C27, W9, X2                                                             |
| OPS   | C6, C7, C16, E1, E2, W6, W7, W8, D6, G7 (retention)                          |
| DH    | —                                                                            |
| DR    | C1, C3, C4, C5, C20, D4, G8                                                  |
| PR    | C1, C9, C10, C18, C27, E11, E13, K4                                          |
| SDR   | C20                                                                          |
| GP    | C8, C11, C12, C14, C18, C21, D7, D9, D12, E4, E6, E7                         |
| PRD   | C1, C2, C4, D2, D3, E3, E6, V1, W4, K3, K4, G7, G8, X1                       |
| FORK  | —                                                                            |
| PERPL | C3, C5, C13, C17, E8, K1, K4, W10                                            |
| LD    | C19, D10                                                                     |
| TL    | C8, C21, C22, E6, W5, W8                                                     |
| TT    | C16, C23, W1                                                                 |
| MW    | C6, D1, D5, G6, X1                                                           |
| MB    | C9, C10, C16, W3, W4, X1, X2                                                 |
| RR2   | C2, C3, C15, D2, E5, K1, G7                                                  |
| CUST  | C7, C13, C15, D11, E5, W1, X1                                                |
| CONV  | C15, C21, E5, E9, E10, V1, V2, V5                                            |
| new   | G1 `perpl-agent-runtime-v1.md`; G3 schema-boundaries decision; G4 LP summary |
