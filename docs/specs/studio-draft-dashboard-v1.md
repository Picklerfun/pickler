# Studio dashboard archive

This document retains the original non-X dashboard design. All X behavior is defined by
[Studio X OAuth](../studio-x-oauth.md). Obsolete connection instructions have been removed;
applied migrations and historical evidence remain unchanged.

# Studio: the draft dashboard, Connect X and Go Public (v1)

Status: decided autonomously on 2026-10-02 (the owner asked for no questions). Canvas: Claude
Design project `c03aadb4-7bb2-429e-aa49-98ae4218bc1f`, `Pickler Studio Draft.dc.html`, the
"created" phase: top bar, rail, header, and the sections Overview, Console, Trades, Brief,
Sources & rules, Limits & funding, Identity & voice, Trade, Master wallet, plus the locked
sections. The canvas's "creating" phase is `studio-create-simplified-v1.md`, already built.

This narrows `go-public-v1.md` to what the new canvas draws. Voice, the wallet and its funding all
happen at creation now, so Go Public is one step: Connect X. Read-only OAuth is implemented separately; X posting (the outbox), the per-venue ALLOW, avatars by upload, Public profile and Audience stay in
`go-public-v1.md` for later.

## 1. Problem and users

After "Create {name}" the person lands on a three-column draft home (`home/home.tsx`). Its Go
Public card is mostly Soon, and the rail sections it links to (Brief, Skills, Limits) edit the old
Polymarket config fields. For a Perpl draft they either save the wrong thing or are refused: `PUT
/agents/:id/config` requires `marketScope`, which a draft does not have. Nothing can make an agent
public, and nothing about X exists.

The canvas makes the created agent's studio one consistent dashboard:

- a top bar with the master wallet's AUSD | MON (opens Wallets), AI credits, the account;
- a rail with RUN / BUILD / GROW / YOU, where sections with nothing to show for a private agent are
  locked ("opens when it's public");
- a header with the agent, its status, and five money tiles;
- Go Public: Connect X through read-only OAuth, then "Go public".

Users: a studio account with a private agent (status `draft`).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                               | Reason                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **A draft gets its own studio, `features/studio/draft/`.** When the selected agent is a draft, the studio draws the canvas's shell (top bar, rail, header, section) instead of the three-column home. Live agents keep today's home and rail shell, unchanged.                                                                                                                                                                         | The canvas is the draft's studio. Rebuilding the live studio is a separate canvas ("Studio v5").                                        |
| D2  | **Rail:** RUN = Overview, Console, Trades, Activity; BUILD = Brief, Sources & rules, Limits & funding, Identity & voice; GROW = Public profile; YOU = Trade, Master wallet. **Activity and Public profile are locked** while private ("{Section} opens when it's public." with "Back to Overview"), as the canvas's `OPEN_SECTIONS` says.                                                                                              | The canvas.                                                                                                                             |
| D3  | **New publication requires a current OAuth connection.** No bypass is offered.                                                                                                                                                                                                                                                                                                                                                         | [Studio X OAuth](../studio-x-oauth.md).                                                                                                 |
| D4  | **Connect X uses Authorization Code + PKCE.** Identity is obtained from X, never a client claim.                                                                                                                                                                                                                                                                                                                                       | Owner authorization and browser-bound consent.                                                                                          |
| D5  | **Unconfigured OAuth remains unavailable.** Connecting and reading have independent disabled-by-default gates.                                                                                                                                                                                                                                                                                                                         | Explicit operational configuration.                                                                                                     |
| D6  | **One X account per agent, one agent per account.** Public agents may disconnect without losing publication.                                                                                                                                                                                                                                                                                                                           | [Studio X OAuth](../studio-x-oauth.md).                                                                                                 |
| D7  | **Publishing is its own column** (go-public-v1 D1, D2): `agents.agents.visibility` (`private`/`public`) and `published_at`. The migration makes every non-draft agent public with `published_at = created_at`. The marketplace filters on `visibility = 'public'` instead of `status <> 'draft'`.                                                                                                                                      | A status cannot say both "has a wallet and runs" and "private".                                                                         |
| D8  | **`POST /agents/:id/publish` re-checks on the server** in one transaction: not killed, a linked agent wallet, and that wallet holding at least 10 AUSD (read on chain, the schedule's minimum). It sets `visibility = 'public'`, `published_at = now()` and a draft's `status` to `active`. There is no FIRST_RUN check: a Perpl draft cannot run yet (D12).                                                                           | The screen never decides what is public. Creation already demanded the money; a pull-back since then must not slip through.             |
| D9  | **No unpublish** (go-public-v1 D16).                                                                                                                                                                                                                                                                                                                                                                                                   | A record that vanishes on demand is not a record.                                                                                       |
| D10 | **One setup endpoint for the draft's config,** `PUT /agents/:id/setup` with `expectedVersion` and any of `brief`, `sources`, `caps`, `voice`. Core's `reviseDraft` applies the same rules as `prepareDraft` (brief normalization, spend and leverage bounds, web sources → tools and plugins), bumps the version, and never touches `marketScope`.                                                                                     | Today's `PUT /config` refuses a draft and edits fields a draft does not use.                                                            |
| D11 | **Caps are saved, not signed, and the copy says who enforces them.** The canvas draws "Its wallet enforces these. Raising one is a new signature." The wallet's policies hold no value cap (`agent-wallet-policies.ts`), so a passkey here would sign nothing. Limits shows "Pickler holds every trade to these. On-chain caps come with live trading." and "Save caps".                                                               | Never claim an enforcement that does not exist (go-public-v1 D11). The signature returns when the venue manifest has an ALLOW to bound. |
| D12 | **Paper runs of a Perpl draft are Soon.** The Perpl runtime is `perpl-agent-runtime-v1.md` (draft). The Console draws the canvas's cards, but "Run it on paper" is shut with "Paper runs open with the Perpl runtime", "What it did" and Trades show their empty states, and "Talk to it" is Soon. The schedule picker works (it saves the interval).                                                                                  | The Soon rule: listed, never drawn as if it worked.                                                                                     |
| D13 | **The schedule interval uses the existing values, 3 / 6 / 12 / 24 h** (`PUT /agents/:id/interval`), not the canvas's 1 / 6 / 12 / 24.                                                                                                                                                                                                                                                                                                  | 1 h is outside what the API and the runtime's quotas allow today.                                                                       |
| D14 | **Identity & voice edits name, avatar and voice; the handle is fixed** ("HANDLE IS FIXED"), as the canvas draws. Name and avatar go to `PUT /agents/:id/identity`; voice to `PUT /agents/:id/setup` (and the profile's voice name).                                                                                                                                                                                                    | The canvas fixes the handle even while private; links and the X verification line use it.                                               |
| D15 | **Header tiles:** MASTER · AUSD and IN AGENT WALLETS · AUSD are real (from `GET /wallets`). IN YOUR POSITIONS, OPEN P&L and AI CREDITS read "Soon".                                                                                                                                                                                                                                                                                    | Personal positions need live Perpl; credits are their own spec.                                                                         |
| D16 | **Trade (you) is a Soon panel:** "Trading from your master wallet opens with live Perpl trading."                                                                                                                                                                                                                                                                                                                                      | `perpl-live-v1.md` is not built.                                                                                                        |
| D17 | **Master wallet is real:** address and Copy, AUSD and MON, an allocation list (free in master, each agent's wallet, positions Soon, AI credits Soon), "Move to an agent" (the Wallets modal), "Buy AI credits" (the credits modal, display only), and a ledger of the person's transfers from `wallets.transfers`.                                                                                                                     | The data exists (migration 0023).                                                                                                       |
| D18 | **Activity on the Overview is real:** the agent created, its wallet linked, and each transfer to or from its wallet, newest first, from `GET /agents/:id/activity`.                                                                                                                                                                                                                                                                    | No invented events.                                                                                                                     |
| D19 | **No copy promises what the Perpl runtime will do.** Where the canvas says the agent "starts trading on its rules", "wakes up on this schedule", "learns the line from you" or that caps "need your passkey", the draft studio says what is true today: it shows on Pickler (and X) once public, the schedule and runs start with the Perpl runtime, and caps are saved. After publish the button reads "Public · on Pickler{ and X}". | The runtime and decision review are not built (D12); a public agent that does nothing must not have been promised to trade.             |

## 3. User flows

### 3.1 After "Create {name}"

The studio opens the draft's Overview. Header: avatar, name, `@handle · Overview`, the
`DRAFT · PRIVATE` chip; tiles below. Overview has three blocks:

1. **Go public.** Connect X through the shared read-only OAuth consent panel. Publish is enabled
   only for a current connection and the existing funding/lifecycle checks. Connect, reconnect,
   disconnect and manual owner-only posts follow [Studio X OAuth](../studio-x-oauth.md).
2. **Its wallet** (READY): address, `CAPS 5 / 20 / 1×`, Copy; AUSD · TRADES and MON · GAS; "Fund
   from master" (Wallets modal on this wallet) and "Limits". Under it: "Run on its own · every
   {N}h", "Unlocks with the Perpl runtime." (D19), a shut switch.
3. **Trades** (empty: "Nothing yet. Run it on paper in the Console to see what it would do." with
   "Open Console") and **Activity** (D18).

A draft from before simplified creation has no wallet: the wallet card says so and Go public
answers `WALLET`.

### 3.2 Identity & voice

Avatar (opens the avatar picker; saving writes accent and pattern), NAME input (saved on blur or
Enter, 1–40), `@handle` with "HANDLE IS FIXED". VOICE: six chips, the sample under them; picking
one saves it. X ACCOUNT uses the same read-only OAuth connection panel as Overview.

### 3.3 Limits & funding

Left: ITS WALLET (PICKLER MAY TRADE), address, Copy, Refresh; AUSD and MON; "LAST CHECKED hh:mm";
arrivals; "Fund from master wallet"; "ONE PASSKEY PER TOKEN · OR SEND TO THE ADDRESS FROM ANY MONAD
WALLET". Right: HARD CAPS (tag SAVED / UNSAVED CHANGES), D11's line, three steppers (PER TRADE,
PER DAY, MAX LEVERAGE; the bounds of `assertSpendLimits` and `LEVERAGE_BOUNDS`), "Save caps" when
changed, and PERPL · MONAD / NO WITHDRAWALS.

### 3.4 Console, Trades

Console: RUN IT ON PAPER (state IDLE), the canvas's line, the inputs it reads (Perpl, and Web with
its mode), the shut run button (D12). ON ITS OWN (STARTS WITH THE PERPL RUNTIME, D19): "Every" 3h / 6h / 12h / 24h
(saves), `N RUNS / DAY`, and the next three run times starting with "First run once runs open".
WHAT IT DID: "RUN IT TO SEE WHICH RULES FIRE". TALK TO IT: the starters and input, shut, tagged
Soon. Trades: "Paper trades", count 0, the canvas's empty state with "Open Console".

### 3.5 Brief, Sources & rules

Brief: a note bar ("EDIT FREELY · THEN RUN IT ON PAPER" and "Run it" → Console), four textareas
(THESIS, ENTERS WHEN, EXITS WHEN, NEVER) with their tags (EMPTY / n LINES / EDITED), and RISK with
the three caps steppers. Changes save with "Save brief" (one `PUT .../setup` with `brief` and
`caps`); a 409 `CONFLICT` (a stale version, the code `PUT /config` answers) reloads and says "It
changed somewhere else. Reloaded."
Sources & rules: IT READS with Perpl (fixed) and Web (switch); WEB · WHERE EXA MAY LOOK with
Anywhere / Prefer these / Only these, sites as chips with ×, the input (Enter or blur adds; at most
20; host format checked). Saving is "Save sources".

### 3.6 Trade, Master wallet

Trade: D16's Soon panel. Master wallet: D17.

## 4. API

X endpoints and contracts are maintained in [Studio X OAuth](../studio-x-oauth.md) and generated OpenAPI.

`/v1/studio/*` routes answer bare JSON; errors `{ error, message, detail? }`, except 400
`INVALID_BRIEF`, which is `{ error, message, field, reason }` (`field` the brief section, `reason`
one of `required`, `too_long`, `too_many`, `not_trimmed`). All require the owner's studio JWT;
another owner's agent, or none, is 404 `NOT_FOUND` on every `/agents/:id/*` route. A malformed body
is 400 `INVALID_INPUT`.

| Method | Path                   | Request                                                                                                                                   | Response                                                                                                            | Errors                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT    | `/agents/:id/setup`    | `{ expectedVersion, brief?: {thesis,entersWhen,exitsWhen,never}, sources?: {web}, caps?: {perTradeAusd,perDayAusd,maxLeverage}, voice? }` | the studio agent                                                                                                    | 400 `INVALID_BRIEF` / `INVALID_INPUT`; 404 `NOT_FOUND`; 409 `CONFLICT` (stale `expectedVersion`), `NOT_A_DRAFT`                                                                                                                                                                                   |
| PUT    | `/agents/:id/identity` | `{ name?, avatar?: { accent, pattern } }`                                                                                                 | the studio agent                                                                                                    | 400 `INVALID_INPUT`; 404 `NOT_FOUND`                                                                                                                                                                                                                                                              |
| GET    | `/agents/:id/activity` | —                                                                                                                                         | `{ events: [{ kind: "created" \| "wallet" \| "transfer", text, at }] }`, newest first, ≤ 50                         | 404 `NOT_FOUND`                                                                                                                                                                                                                                                                                   |
| POST   | `/agents/:id/publish`  | `{}`                                                                                                                                      | `{ visibility: "public", publishedAt }`                                                                             | 400 `INVALID_INPUT` (a non-empty body); 404 `NOT_FOUND`; 409 `PUBLISH_BLOCKED` with `detail.blockers` ⊆ `WALLET`, `FUNDS`, `KILLED` (api-schema's `PUBLISH_BLOCKERS`); 503 `BALANCES_UNAVAILABLE`; 409 `PUBLISH_CONFLICT` (the agent's wallet or state changed twice while publishing; try again) |
| GET    | `/wallets/ledger`      | —                                                                                                                                         | `{ entries: [{ direction: "to_agent" \| "to_master", token, amount, agentName, txHash, at }] }` newest first, ≤ 100 | 503 `WALLETS_UNAVAILABLE` where the ledger is not composed                                                                                                                                                                                                                                        |

The studio agent DTO gains `visibility`, `publishedAt` and `xHandle` (verified handle or null).
`PUT /setup` with `caps` writes the new per-trade and per-day caps to the config's `spend` in the
same transaction as the rest (`updateConfig`'s `writeSpend`); without `caps` the stored `spend` is
kept.
`POST /publish` on an already public agent answers its current state (idempotent).

## 5. Data model and migration

Migration `0024_go_public` (see `packages/infrastructure/drizzle/0024_go_public.sql` for the exact
DDL; this is its shape):

```sql
CREATE TYPE agents.agent_visibility AS ENUM ('private', 'public');
ALTER TABLE agents.agents
  ADD COLUMN visibility agents.agent_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN published_at timestamptz;
-- The backfill runs with the agents_updated_at trigger disabled, so updated_at is unchanged. The
-- status is compared as text: 0022 added 'draft' and may run in the same transaction.
ALTER TABLE agents.agents DISABLE TRIGGER agents_updated_at;
UPDATE agents.agents SET visibility = 'public', published_at = created_at WHERE status::text <> 'draft';
ALTER TABLE agents.agents ENABLE TRIGGER agents_updated_at;
ALTER TABLE agents.agents ADD CONSTRAINT agents_published_consistent
  CHECK ((visibility = 'public') = (published_at IS NOT NULL));
CREATE INDEX agents_public_idx ON agents.agents (published_at DESC NULLS LAST) WHERE visibility = 'public';

```

Existing X evidence tables are retained by the applied migrations. OAuth grants and
private history are added by migration 0034; do not rerun or rewrite migration 0024.

## 6. Integrations

| System    | Use                                                 | Config                                            |
| --------- | --------------------------------------------------- | ------------------------------------------------- |
| X API v2  | Read-only OAuth identity and manual owner timeline  | [API runtime configuration](../studio-x-oauth.md) |
| Monad RPC | the publish funding check (existing balance reader) | existing                                          |

## 7. Design work

All of it is drawn in `Pickler Studio Draft.dc.html`. Staged states (`?stage=`, never in
production): `draft` (Overview), `draft-x-open`, `draft-x-miss`, `draft-x-ok`, `draft-x-skipped`,
`draft-console`, `draft-trades`, `draft-brief`, `draft-sources`, `draft-limits`, `draft-identity`,
`draft-trade`, `draft-master`, `draft-locked`. Each is a design-harness route proving its section id.

## 8. Security and abuse

- X authorization, uniqueness, privacy and publication fences follow [Studio X OAuth](../studio-x-oauth.md).
- `PUT /setup` is draft-only and versioned; caps keep core's bounds.

## 9. Acceptance criteria and tests

1. A draft is absent from every marketplace read until `publish`; existing active agents stay
   public after the migration (Postgres test).
2. `publish` answers 409 with exactly the failing blockers; it flips visibility, `published_at`
   and status together; a second call is idempotent.
3. X: controlled OAuth consent, uniqueness and encrypted persistence are covered by the canonical suite.
4. `reviseDraft` keeps every `prepareDraft` rule (pinned with the same inputs) and leaves
   `marketScope` alone; a stale `expectedVersion` is 409.
5. Ledger and activity list only the person's own transfers, newest first.
6. Web: the draft studio's pure models (rail locks, tiles, Go Public state, caps steppers, sites)
   are unit-tested; every staged state passes the design harness with 0 FAIL.

## 10. Rollout

Follow [Studio X OAuth](../studio-x-oauth.md). Confirm migration and deployed versions; configure
the confidential application, dedicated key, reviewed quotas and independent activation gates.

## 11. Out of scope

X posting (outbox, post classes), Public profile and Audience sections, avatar upload,
the per-venue ALLOW and signed caps, paper runs of Perpl agents and decision review (Accept, Reject,
Ask why), "Talk to it", personal trading, AI credits, the live studio's redesign.
