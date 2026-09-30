# Public record v1: what the marketplace shows once decisions resolve

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`
(decisions 1 and 2) and builds on `docs/specs/decision-resolution-v1.md`, which owns the job, the
tables and the formulas. Every decision below is reversible unless the table says otherwise.

## 1. Problem and users

Every public page that should show what an agent did is empty on purpose. The adapter returns
`decisions: []`, `calls: []`, `openPicks: 0`, a null pick, an empty activity log and an empty
leaderboard (`packages/infrastructure/src/persistence/agent-directory.ts:191-203,233-253,290-306`),
because nothing recorded whether a pick was right (`docs/specs/marketplace-real-data-v1.md` §3,
§7). `decision-resolution-v1` fixes the source. This spec decides what becomes public, when, and
through which endpoints.

Three more gaps sit on the same pages:

- **Following** lives in the browser, per address (`apps/web/src/features/wallet/lib/following.ts:6-16`),
  and `/activity` filters a log that is always empty by that local list
  (`apps/web/src/features/wallet/components/activity-page.tsx:28-36`). There is no follower count
  (`marketplace-real-data-v1` §2.3).
- **The perps board** at `/markets` is `createSampleMarketBoard` (`workers/api/src/growth/services.ts:39`)
  with invented figures such as `agentsReading: 7`
  (`packages/infrastructure/src/markets/sample-market-board.ts:16`) and no sample label, against
  the rule that sample data stays visibly labelled (`docs/frontend-integration.md:39-40`).
- **The mobile app** (React Native, separate repository, bundle `fun.pickler.app`) reads the same
  public API and has no contract for any of this (`docs/product-map/research/05-identity-studio-mobile.md`
  §3, item 4).

Users: visitors deciding whether an agent is worth following or paying for a read; followers
reading a feed; the agent owner, who wants the public page to show the record their agent earned;
Pickler, whose paid reads depend on the public record being honest and on unresolved picks staying
private.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reason                                                                                                                                                                                                     | Reversible? |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| P1  | **A decision's content is public only once it is resolved or voided**, and only when it counts publicly (`decision-resolution-v1` D11). Unresolved decisions are public only as a count and as sealed commitments with their time: no market, no side, no probability.                                                                                                                                                                                                                               | Conventions decision 1. The sealed commitment proves the agent committed before the outcome without selling the pick for free.                                                                             | yes         |
| P2  | **Passes are published like calls.** A resolved abstention appears in the feed and on the profile as a pass, with what it priced and what happened.                                                                                                                                                                                                                                                                                                                                                  | The design already says "declining a market is published like any other" (`packages/core/src/features/agents/domain/public-views.ts:13`). Hiding passes would let an agent look selective after the fact.  | yes         |
| P3  | **The public projection is a fixed allow-list** (§5.3). Never public: the brief and its rule text, skills, prompts and their text, model and provider identity, token usage, cost, diagnostics, raw trace events, source contents, private feeds, the agent's wallet balance.                                                                                                                                                                                                                        | The brief is private configuration (`marketplace-real-data-v1` §2.2). The runtime spec separates public evidence from internal traces (`docs/specs/agent-runtime-v1.md`, "Persistence and observability"). | yes         |
| P4  | **Model-written text is public, with the brief's own lines scrubbed.** Thesis, counter-evidence and the abstention reason are shown; any exact brief line (≥ 12 characters) found in them is replaced with "[one of its own rules]". A policy verdict is shown in words ("its own entry rule was not met"), never as the rule.                                                                                                                                                                       | The reasoning is what a visitor judges. The model sees the brief and may quote it; a mechanical scrub closes the obvious leak without a second model.                                                      | yes         |
| P5  | **Public activity is materialised** into `agents.public_activity` at publication time, written in the resolution transaction. Feeds read that table, never `pickler.runs`.                                                                                                                                                                                                                                                                                                                           | One narrow, indexed, already-redacted table is the only public read of what an agent did. A mistake in a feed query cannot reach a private column.                                                         | yes         |
| P6  | **Following is server-side**, keyed to the marketplace account (`user_id` from the SIWE session, any wallet kind). The follower count is public; who follows whom is not. A signed-in web visitor's local list is imported once and then deleted from the browser.                                                                                                                                                                                                                                   | Following has to work on the phone and across browsers, and the count is a signal the pages were designed with.                                                                                            | yes         |
| P7  | **`/activity` becomes public** with two tabs: _Everyone_ (no wallet) and _Following_ (signed in). Today the whole page sits behind `ConnectGate`.                                                                                                                                                                                                                                                                                                                                                    | A global feed is the fastest way to see that agents are real, and it needs no account.                                                                                                                     | yes         |
| P8  | **Receipts get a canonical route, `/receipts/[publicId]`**, for every agent, token or not. The old `/tokens/[ticker]/picks/[id]` redirects to it.                                                                                                                                                                                                                                                                                                                                                    | Most agents have no token, and a pick detail that needs a ticker could never be linked for them.                                                                                                           | yes         |
| P9  | **The perps board reads Perpl public data** through the existing client (`packages/infrastructure/src/perpl/data.ts:86`), request-time with a short cache, on the network named by `PERPL_BOARD_NETWORK` (testnet in staging and until Perpl mainnet trading is live, conventions decision 7), labelled with the network and its freshness. Figures with no source (`agentsReading`, `openCalls`, `lastCall`) become nullable and render "—" until perps decisions exist. The ticket stays disabled. | Replaces the one remaining unlabelled sample adapter with a real venue. No table is needed for two markets fetched in one session.                                                                         | yes         |
| P10 | **New endpoints use the conventions' envelope** `{ data, meta }`. The existing `/v1/marketplace/*` routes keep their bare bodies and `200 null` (`marketplace-real-data-v1` §6) and switch to the envelope in one later change that moves the web and the mobile app together.                                                                                                                                                                                                                       | Changing the existing routes' shape in this work would break the TestFlight app and every page at once, for no user benefit.                                                                               | yes         |
| P11 | **Net is always labelled "virtual"** (1 AUSD per call, `decision-resolution-v1` D5) on every public surface, and the paper P&L is shown only on a receipt that has a paper fill.                                                                                                                                                                                                                                                                                                                     | A number that reads as money must say which money. Nothing on the marketplace is real P&L until live trading is.                                                                                           | yes         |

## 3. User flows

### 3.1 Publication (server)

Inside the resolution transaction (`decision-resolution-v1` §3.2 step 4), for a decision with
`counts_publicly = true`:

1. Build the public projection (§5.3) and check its hash equals `decisions.public_commitment`. A
   mismatch is a bug: the decision stays owner-only, `last_error = 'COMMITMENT_MISMATCH'`, and an
   ops alert fires.
2. Assign `public_id` (`dcs_` + 20 base32 characters) and `public_at = now()`.
3. Insert one `agents.public_activity` row (`kind` `call` or `pass`) and, when a paper position was
   settled or exited, one `settlement` row.

### 3.2 A visitor reads an agent

1. `/agents/[handle]` loads the persona (existing route) whose record fields now come from
   `pickler.agent_records` (scope `public`): hit rate, calibration gap and its verdict
   (`calibrationVerdict`, `public-views.ts:169-174`), resolved, net (virtual), open picks, form,
   streak, follower count, and meters (§5.4).
2. Under the record: **Sealed** — "N calls waiting on their markets", with the latest commitments
   (time and short hash) — then **Decisions**: resolved calls and passes, newest first, each linking
   to its receipt.
3. An agent with identity only keeps the designed empty state (`marketplace-real-data-v1` §4); an
   agent with sealed calls and nothing resolved says "No resolved decisions yet · N sealed".

### 3.3 A visitor opens a receipt

`/receipts/[publicId]` shows the call, the stated band against the market price, the outcome, the
reasoning, the sources, the timeline (decided → sealed → resolved on Polygon block N), the virtual
P&L, the paper fill when there was one, and a **Verify** block: the commitment, the canonical JSON
it hashes, and the chain read (contract, block, payout vector) with a Polygonscan link.

### 3.4 Following

1. A signed-in marketplace visitor presses Follow on a persona or directory row:
   `PUT /v1/me/follows/:handle`. The button and count update optimistically and roll back on error.
2. On the first signed-in load after this ships, the web reads the local list for the connected
   address, calls `POST /v1/me/follows/import`, and deletes the local key on success.
3. A visitor with a wallet connected but not signed in who presses Follow is asked to sign in
   (the existing SIWE flow, `workers/api/src/routes/wallet-auth.ts:77-126`); there is no local
   fallback any more.
4. `/activity` → _Following_ reads `GET /v1/me/activity`.

### 3.5 The perps board

`/markets` and `/markets/[symbol]` read the real board. The page header carries the network
(`TESTNET` / `MAINNET`) and "Updated 8s ago". If Perpl cannot be read, the last good board is
served for up to 5 minutes marked stale; after that the page shows the unavailable state.

### 3.6 The phone

The mobile app reads the same endpoints through `https://app.pickler.fun/api/v1/...` (conventions,
API). It gets: persona and record, decisions, receipts, global and followed activity, follows, the
leaderboard and the perps board. Universal links: `/agents/<handle>` (existing) and
`/receipts/<publicId>` (new, added to the `applinks` paths of the `app.pickler.fun` AASA file,
`docs/specs/product-hosts-v1.md` §4). The app signs in with Mera only; follows use the same
Supabase session.

## 4. API

All paths under `/v1`. Public routes need no credentials; `/v1/me/*` needs a marketplace session
(`Authorization: Bearer <Supabase JWT>`). DTOs in `packages/api-schema/src/public-record.ts` (new)
and `resolutions.ts` (`decision-resolution-v1` §4).

### 4.1 New public routes (envelope)

| Method | Path                                    | Request                                               | Response `data`                                               | Errors                                      |
| ------ | --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| GET    | `/marketplace/agents/:handle/record`    | —                                                     | `PublicRecordDto` (§5.4)                                      | 404 `AGENT_NOT_FOUND` (unknown or draft)    |
| GET    | `/marketplace/agents/:handle/decisions` | `?kind=all\|call\|pass&cursor=&limit=` (max 100)      | `PublicDecisionDto[]`, `meta.nextCursor`                      | 404 `AGENT_NOT_FOUND`, 400 `INVALID_CURSOR` |
| GET    | `/marketplace/agents/:handle/sealed`    | `?cursor=&limit=`                                     | `{ pending: number, items: { commitment, decidedAt }[] }`     | 404 `AGENT_NOT_FOUND`                       |
| GET    | `/marketplace/agents/:handle/activity`  | `?cursor=&limit=`                                     | `ActivityEventDto[]` (existing DTO + `ref: publicId \| null`) | 404 `AGENT_NOT_FOUND`                       |
| GET    | `/marketplace/activity`                 | `?kind=call\|pass\|settlement\|answer&cursor=&limit=` | `ActivityEventDto[]`                                          | 400 `INVALID_KIND`                          |
| GET    | `/marketplace/decisions/:publicId`      | —                                                     | `PublicReceiptDto` (§5.3)                                     | 404 `DECISION_NOT_FOUND`                    |

A 404 here is a real 404 in the envelope; the web helper for new routes reads `error.code` rather
than throwing on non-ok (the reason for `200 null` in `marketplace-real-data-v1` §6 does not apply
to a client written for the envelope).

### 4.2 Existing public routes, now with a source (bodies unchanged, P10)

| Route                                          | What changes                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /marketplace/agents`                      | `resolved`, `hitRate`, `net` from `agent_records` (public)                                                                                                  |
| `GET /marketplace/directory`                   | `score`, `hitRate`, `resolved`, `net` from `agent_records`; new `followers`                                                                                 |
| `GET /marketplace/personas/:handle`            | `calibrationGap`, `resolved`, `hitRate`, `net`, `openPicks`, `meters`, `decisions` (latest 10 activity rows), new `followers`, new `streak`, new `sealed`   |
| `GET /marketplace/profiles/:ticker`            | `openPicks`, `calls` (latest 20 resolved calls as `AgentCall`, `outcome` from the resolution, `stake: 1`, `pnl` virtual)                                    |
| `GET /marketplace/profiles/:ticker/picks/:id`  | `id` is a `publicId`; returns `PickDetail` built from the receipt (`steps` = timeline, `chain.settlementTx: null`, `post: null`)                            |
| `GET /marketplace/leaderboard`                 | `entries` = rank-eligible agents by score (`decision-resolution-v1` D9); `weights` = the four `agentScore` terms; `calibration` = the top 8 agents' buckets |
| `GET /marketplace/analytics?range=`            | §5.5                                                                                                                                                        |
| `GET /marketplace/markets`, `/markets/:symbol` | real Perpl board (P9); `PerpMarketDto` gains `source: { venue, network, observedAt, stale }`; `agentsReading`, `openCalls`, `lastCall` nullable             |

The `/v1/demo` alias (`workers/api/src/app.ts:68`) is not extended; its removal stays with
`marketplace-real-data-v1` §5.

### 4.3 Account routes

| Method | Path                  | Request                                            | Response `data`                               | Errors                                                    |
| ------ | --------------------- | -------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| GET    | `/me/follows`         | `?cursor=&limit=`                                  | `{ handle, name, accent, followedAt }[]`      | 401 `NO_SESSION`                                          |
| PUT    | `/me/follows/:handle` | —                                                  | `{ handle, followedAt }` (200 either way)     | 401, 404 `AGENT_NOT_FOUND`, 409 `FOLLOW_LIMIT` (500), 429 |
| DELETE | `/me/follows/:handle` | —                                                  | `{ handle }` (200 even if not followed)       | 401, 429                                                  |
| POST   | `/me/follows/import`  | `{ handles: string[] }` (≤ 200), `Idempotency-Key` | `{ imported, skipped: { handle, reason }[] }` | 401, 400 `INVALID_INPUT`, 409 `IDEMPOTENCY_CONFLICT`      |
| GET    | `/me/activity`        | `?cursor=&limit=`                                  | `ActivityEventDto[]` from followed agents     | 401                                                       |

`PUT` and `DELETE` are idempotent by definition and take no key. Writes are limited to 60 per
minute per user.

### 4.4 Caching

Set by the API; the web proxy passes `Cache-Control` through, and server components fetch with the
same revalidate.

| Routes                                                      | `Cache-Control`                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| record, decisions, sealed, agent activity, persona, profile | `public, max-age=30, s-maxage=60, stale-while-revalidate=300`                                          |
| global activity                                             | `public, max-age=15, s-maxage=30, stale-while-revalidate=120`                                          |
| receipt, pick detail                                        | `public, max-age=300, s-maxage=86400` (purged by URL on an operator revision)                          |
| leaderboard, analytics, directory, agents                   | `public, max-age=60, s-maxage=300, stale-while-revalidate=600`                                         |
| markets board and detail                                    | `public, max-age=5, s-maxage=10`; the Worker also keeps the last good board in the Cache API for 5 min |
| `/me/*`                                                     | `private, no-store`                                                                                    |

## 5. Data model and migrations

One migration, **`public_record`** (number assigned at build time), in `packages/infrastructure`.
It depends on `decision_resolutions` (`decision-resolution-v1` §5).

### 5.1 `agents.follows`

| Column       | Type                                          |
| ------------ | --------------------------------------------- |
| `user_id`    | uuid, → `identity.profiles.user_id`           |
| `agent_id`   | uuid, → `agents.agents.id` on delete restrict |
| `created_at` | timestamptz default now()                     |

PK `(user_id, agent_id)`; index `(agent_id)` for the count. RLS enabled with no Data API policy;
the API reads and writes through its own connection. Follows of a killed agent are kept.

### 5.2 `agents.public_activity`

| Column       | Type             | Notes                                                                    |
| ------------ | ---------------- | ------------------------------------------------------------------------ |
| `id`         | uuid PK          |                                                                          |
| `agent_id`   | uuid             | → `agents.agents.id`                                                     |
| `kind`       | text             | `call`, `pass`, `settlement`, `answer` (paid reads), `perp` (later)      |
| `ref`        | text null        | `public_id` of the decision, or a read id                                |
| `at`         | timestamptz      | publication time                                                         |
| `decided_at` | timestamptz null |                                                                          |
| `payload`    | jsonb            | the already-redacted `text`, `meta`, `amount`, `tone` of `ActivityEvent` |

Indexes `(at DESC, id)` and `(agent_id, at DESC, id)`; cursor = `(at, id)`. Written only by the
publication step and by the paid-reads spec's delivery step.

### 5.3 The public projection and receipt

`PublicDecisionDto` (and the hashed projection, byte-for-byte, as canonical JSON):

```ts
interface PublicDecisionDto {
  publicId: string;
  agent: { handle: string; name: string; accent: Accent; ticker: string | null };
  kind: "call" | "pass";
  decidedAt: string;
  market: { venue: "polymarket"; id: string; question: string; outcome: string | null };
  stated: { lower: number; estimate: number; upper: number } | { estimate: number } | null;
  marketPriceAtDecision: number | null;
  askAtDecision: number | null; // calls only
  limitPrice: number | null; // calls only
  thesis: string; // scrubbed (P4)
  counterEvidence: string; // scrubbed
  passReason: string | null; // model's reason, scrubbed; or the policy verdict in words
  heldByPolicy: boolean; // the model wanted to trade and a rule stopped it
  sources: { title: string; domain: string; url: string | null; retrievedAt: string }[];
  commitment: string;
}
```

`PublicReceiptDto` = `PublicDecisionDto` + `resolution: { outcome, y, resolvedAt, chainId,
contract, blockNumber, blockHash }` + `metrics: { brier, hit, virtualPnl }` + `paper: { cost,
realizedPnl, exitedBy: "rule" | null } | null` + `receiptHash` + `revision`. The projection (hashed)
excludes the resolution, which did not exist when it was committed.

Sources: only entries with an `http(s)` URL and no credentials in it (the rule already in
`apps/web/src/features/studio/sections/picks.tsx:43-70`), plus provider sources shown by name only
("The Odds API · odds snapshot") with `url: null`. Never `content`.

### 5.4 `PublicRecordDto` and meters

`AgentRecordDto` (scope `public`) + `followers` + `sealed: { pending, latest: { commitment,
decidedAt }[] }` + `meters`. Meters, read from behaviour (`public-views.ts:40-44`), only once
`scored ≥ 10`, otherwise `[]`:

- **Selective**: `abstentions / decisions × 100`.
- **Conviction**: `mean(|p − q|) × 200`, capped at 100 (how far it strays from the market).
- **Honest odds**: `max(0, 100 − 5 × calibrationGap)`.

### 5.5 Analytics

`GET /marketplace/analytics?range=7d|30d|90d` over public-scope resolutions in the window:
`settledVolumeAllTime` = sum of settled paper cost (virtual AUSD); cards: decisions resolved, calls
vs passes, platform hit rate, platform Brier; `series` = per-day resolved count (`settled`) and
open calls (`at-risk`); `log` = global activity; `table` = `AgentForm` per agent with any
resolution in the window; `predictionsShare = 1` until perps decisions exist; `splitNote` says so.

### 5.6 Perps board

No table. `PerplMarketBoard implements MarketBoard` (`packages/core/src/features/markets/ports/market-board.ts:3-8`)
in `packages/infrastructure/src/markets/perpl-market-board.ts`, composed in
`workers/api/src/growth/services.ts` in place of `createSampleMarketBoard()` at `:39`. Per board
request, one Perpl session: `list` + `snapshot` per market + 1 h `candles` per market (5 requests
for BTC and ETH, within the 12-request session cap, `packages/infrastructure/src/perpl/transport.ts:65`).
`change24h` from the candle 24 h back; `maxHourlyMove` from 30 days of hourly candles; `note` from a
deterministic template over funding and 24 h change (no model). `createSampleMarketBoard` moves to
the design harness fixtures, like the agent fixture before it (`marketplace-real-data-v1` §5).
`PerpMarket` in `packages/core/src/features/markets/domain/markets.ts:40-60` changes
`agentsReading`, `openCalls` to `number | null`.

## 6. Integrations

- **Perpl public REST** through `PerplMarketData` (no key); guarded transport unchanged. Depends on
  the reliability fixes in open PRs #60 and #63 (`docs/product-map/research/02-trading.md` §2);
  until they merge, the board ships behind `PERPL_BOARD_ENABLED` and the page keeps the sample
  board **with a visible SAMPLE label** (satisfying `docs/frontend-integration.md:39-40` either
  way).
- **Polygonscan** links only (no API): `https://polygonscan.com/address/<CTF>#readContract` and the
  block page.
- **Supabase auth** for `/v1/me/*`, as the existing account routes.

| Var                     | Worker | Value                                             |
| ----------------------- | ------ | ------------------------------------------------- |
| `PERPL_BOARD_ENABLED`   | api    | `"false"` until #60/#63 merge and a staging check |
| `PERPL_BOARD_NETWORK`   | api    | `testnet` (staging, and production until mainnet) |
| `PUBLIC_RECORD_ENABLED` | api    | `"false"` until resolution acceptance passes      |

## 7. Design work

Existing canvases in the Claude Design project:
**Pickler Public** (persona, leaderboard, activity, reads, token profile and pick detail) and
**Pickler Market Web** (`/markets`). The mobile app's screens are drawn in that app's own canvases.

| Surface                  | Screen                                         | Change                                                                                                                                                                                                        | Canvas                                              |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| web, light (marketplace) | `/agents/[handle]` persona                     | Populated record with "virtual" net label, streak and form; **Sealed** row; **Decisions** list (call / pass rows linking to receipts); server Follow with count; state "No resolved decisions yet · N sealed" | extend **Pickler Public** (persona)                 |
| web, light               | `/receipts/[publicId]`                         | New page: call header and outcome chip, band vs market vs outcome figure, reasoning, sources, timeline, virtual and paper P&L, Verify block                                                                   | **new canvas: Pickler Receipt** (web + phone width) |
| web, light               | `/leaderboard`                                 | Populated table from real data; an "Unranked — building a record" list for agents below the minimums, with how far each is                                                                                    | extend **Pickler Public** (leaderboard)             |
| web, light               | `/activity`                                    | Public page, tabs _Everyone_ / _Following_; the Following tab's signed-out state                                                                                                                              | extend **Pickler Public** (activity)                |
| web, light               | `/agents` directory                            | Score and follower count per row                                                                                                                                                                              | **Pickler Public**, no new canvas                   |
| web, light               | `/markets`, `/markets/[symbol]`                | Network tag, "Updated Ns ago", stale and unavailable states, "—" for agent figures                                                                                                                            | extend **Pickler Market Web**                       |
| mobile (React Native)    | persona record, receipt, activity tabs, follow | Same content as the web, phone layouts                                                                                                                                                                        | **new canvas: Pickler Mobile Record**               |
| web, dark (studio)       | Public profile panel copy                      | Copy only (`apps/web/src/features/studio/sections/rail.ts:91-95`): the record fills as decisions resolve                                                                                                      | none                                                |

Every new state gets a harness id and a route in `scripts/design/routes.mjs`; the design fixtures
gain a resolved-decision seed so the populated screens can be measured
(`marketplace-real-data-v1` §5 names this gap).

## 8. Security and abuse

- **Leaking the pick early.** The only public reads of decisions go through
  `agents.public_activity` and `pickler.decisions` rows with `public_at IS NOT NULL`; a test proves
  an awaiting decision is absent from every public route, including through the sealed list, which
  carries only time and hash. The hash is of a projection with enough entropy (thesis text, source
  URLs, times) that it cannot be brute-forced back to a side.
- **Leaking private configuration.** P3 allow-list, P4 scrub; a property test fails if any brief
  line or prompt text appears in any public DTO built from generated runs.
- **Drafts.** Draft agents answer 404 on every public route, as today
  (`agent-directory.ts:175-179,210-214`).
- **Follow abuse.** 500 follows per account, 60 writes per minute, counts from `agents.follows`
  only. Follow lists are never public. Fake-account inflation of counts is possible and accepted in
  v1; counts do not affect the score.
- **Scraping.** Everything public is meant to be public; caching absorbs load. `/v1/me/*` is
  `no-store`.
- **Perpl outage.** Never an invented board: stale for 5 minutes with a label, then unavailable.

## 9. Acceptance criteria and tests

Adapter tests against real Postgres (`packages/infrastructure/test/`, as `marketplace-real-data-v1`
§8):

1. An awaiting decision appears in no public route; after resolution it appears in record,
   decisions, activity and its receipt, with `publicId` stable across calls.
2. A decision made before `public_since` never appears publicly and still changes the owner record.
3. The receipt's projection hashes to the stored commitment.
4. The scrub replaces a brief line quoted in a thesis; the policy verdict never contains rule text.
5. The leaderboard excludes an agent at 19 scored decisions and includes it at 20 (with 5 trades
   and a recent decision).
6. Follow: put twice → one row; delete twice → 200; import is idempotent under the same key and
   409 under the same key with a different body; the 501st follow is 409.
7. `/me/activity` returns only followed agents' rows, newest first, with a working cursor.
8. A failing query raises; nothing returns an empty list on error (the existing rule).
9. `PerplMarketBoard` against recorded Perpl captures maps every field; a failed fetch within 5
   minutes serves the cached board with `stale: true`; after that the route answers 503
   `MARKET_DATA_UNAVAILABLE`.

Web (`apps/web` tests and the design harness):

10. Persona, receipt, leaderboard, activity (both tabs) and markets each render their populated,
    empty and error states with harness ids.
11. The local follow list is imported once and removed.

## 10. Rollout and dependencies

Needs first: `decision-resolution-v1` (tables, job, acceptance) — nothing here ships before real
resolutions exist. The Go Public spec sets `public_since`. `paid-reads-v1` writes `answer` rows
and decides whether a paying reader sees an unresolved decision tied to their read (P1 leaves that
to it). `product-hosts-v1` for the `app.pickler.fun` AASA paths.

1. Migration `public_record`; follows routes and web import (can ship before resolution).
2. Publication step in the resolution job; new public routes behind `PUBLIC_RECORD_ENABLED`.
3. Existing routes read `agent_records`; web pages and harness states.
4. Perps board behind `PERPL_BOARD_ENABLED` once #60/#63 merge; until then the sample board gets a
   SAMPLE label in the first PR of this work.
5. Mobile app release reading the new routes; then the envelope switch for the old routes (P10).

## 11. Out of scope

- Paid reads, their cards and who sees unresolved decisions through a read (`paid-reads-v1`).
- Trading from the board's ticket (`perpl-live-execution-v1`).
- Push notifications and email for followed agents.
- Comments, likes or replies on decisions.
- Public live positions and real P&L (none exist).
- Perps decisions on agent profiles (after `perpl-agent-runtime-v1`).

## 12. Open questions for the owner

1. **Thesis text on public receipts.** Publishing the model's thesis and counter-evidence after
   resolution is decided here (P4). Do you want an owner opt-out ("show outcome and numbers only")
   for agents that sell reads, at the cost of a thinner public record?
2. **Follower counts** are public and can be inflated by fake accounts. Show them from day one, or
   only above a threshold (for example 10)?
