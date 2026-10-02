# Studio: the draft dashboard, Connect X and Go Public (v1)

Status: decided autonomously on 2026-10-02 (the owner asked for no questions). Canvas: Claude
Design project `c03aadb4-7bb2-429e-aa49-98ae4218bc1f`, `Pickler Studio Draft.dc.html`, the
"created" phase: top bar, rail, header, and the sections Overview, Console, Trades, Brief,
Sources & rules, Limits & funding, Identity & voice, Trade, Master wallet, plus the locked
sections. The canvas's "creating" phase is `studio-create-simplified-v1.md`, already built.

This narrows `go-public-v1.md` to what the new canvas draws. Voice, the wallet and its funding all
happen at creation now, so Go Public is one step: Connect X, which can be skipped. X posting (OAuth,
the outbox), the per-venue ALLOW, avatars by upload, Public profile and Audience stay in
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
- Go Public: Connect X by posting a verification line, or skip it, then "Go public".

Users: a studio account with a private agent (status `draft`).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                 | Reason                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **A draft gets its own studio, `features/studio/draft/`.** When the selected agent is a draft, the studio draws the canvas's shell (top bar, rail, header, section) instead of the three-column home. Live agents keep today's home and rail shell, unchanged.                                                                                                           | The canvas is the draft's studio. Rebuilding the live studio is a separate canvas ("Studio v5").                                        |
| D2  | **Rail:** RUN = Overview, Console, Trades, Activity; BUILD = Brief, Sources & rules, Limits & funding, Identity & voice; GROW = Public profile; YOU = Trade, Master wallet. **Activity and Public profile are locked** while private ("{Section} opens when it's public." with "Back to Overview"), as the canvas's `OPEN_SECTIONS` says.                                | The canvas.                                                                                                                             |
| D3  | **Go Public is one step, Connect X, and it can be skipped.** "Skip X for now · it posts on Pickler only" makes the button "Go public" without X; "Undo" brings the step back. The skip is a screen choice, not stored.                                                                                                                                                   | The canvas (`tasks` has one entry, `allDone = done \|\| xSkipped`). It answers go-public-v1 Q2: X is optional.                          |
| D4  | **Connect X is verification by post** (go-public-v1 D6): the owner types the handle and presses Verify; Pickler issues a challenge and shows the line to post, "Verifying {Name} on @pickler · pk-XXXXXXXX"; "Check again" reads the account's recent posts with the app's bearer token and looks for the code in a post made after the challenge.                       | Proves control without write access, exactly the canvas's flow (`xMiss`). Answers go-public-v1 Q3: the line keeps "@pickler".           |
| D5  | **Without `X_BEARER_TOKEN` the API answers 503 `X_UNAVAILABLE`,** and the card says "X verification isn't open yet. Skip it for now; you can connect X later in Identity & voice." Nothing pretends to verify.                                                                                                                                                           | Pickler's X developer app (go-public-v1 Q1) is not set up yet; the flow must still be honest and Go Public must still work (D3).        |
| D6  | **One verified X account per agent, one agent per X account.** `x_user_id` and the handle are unique. Disconnect is allowed while private; a public agent keeps its handle (409 `X_ON_PUBLIC_AGENT`).                                                                                                                                                                    | go-public-v1 §8.                                                                                                                        |
| D7  | **Publishing is its own column** (go-public-v1 D1, D2): `agents.agents.visibility` (`private`/`public`) and `published_at`. The migration makes every non-draft agent public with `published_at = created_at`. The marketplace filters on `visibility = 'public'` instead of `status <> 'draft'`.                                                                        | A status cannot say both "has a wallet and runs" and "private".                                                                         |
| D8  | **`POST /agents/:id/publish` re-checks on the server** in one transaction: not killed, a linked agent wallet, and that wallet holding at least 10 AUSD (read on chain, the schedule's minimum). It sets `visibility = 'public'`, `published_at = now()` and a draft's `status` to `active`. There is no FIRST_RUN check: a Perpl draft cannot run yet (D12).             | The screen never decides what is public. Creation already demanded the money; a pull-back since then must not slip through.             |
| D9  | **No unpublish** (go-public-v1 D16).                                                                                                                                                                                                                                                                                                                                     | A record that vanishes on demand is not a record.                                                                                       |
| D10 | **One setup endpoint for the draft's config,** `PUT /agents/:id/setup` with `expectedVersion` and any of `brief`, `sources`, `caps`, `voice`. Core's `reviseDraft` applies the same rules as `prepareDraft` (brief normalization, spend and leverage bounds, web sources → tools and plugins), bumps the version, and never touches `marketScope`.                       | Today's `PUT /config` refuses a draft and edits fields a draft does not use.                                                            |
| D11 | **Caps are saved, not signed, and the copy says who enforces them.** The canvas draws "Its wallet enforces these. Raising one is a new signature." The wallet's policies hold no value cap (`agent-wallet-policies.ts`), so a passkey here would sign nothing. Limits shows "Pickler holds every trade to these. On-chain caps come with live trading." and "Save caps". | Never claim an enforcement that does not exist (go-public-v1 D11). The signature returns when the venue manifest has an ALLOW to bound. |
| D12 | **Paper runs of a Perpl draft are Soon.** The Perpl runtime is `perpl-agent-runtime-v1.md` (draft). The Console draws the canvas's cards, but "Run it on paper" is shut with "Paper runs open with the Perpl runtime", "What it did" and Trades show their empty states, and "Talk to it" is Soon. The schedule picker works (it saves the interval).                    | The Soon rule: listed, never drawn as if it worked.                                                                                     |
| D13 | **The schedule interval uses the existing values, 3 / 6 / 12 / 24 h** (`PUT /agents/:id/interval`), not the canvas's 1 / 6 / 12 / 24.                                                                                                                                                                                                                                    | 1 h is outside what the API and the runtime's quotas allow today.                                                                       |
| D14 | **Identity & voice edits name, avatar and voice; the handle is fixed** ("HANDLE IS FIXED"), as the canvas draws. Name and avatar go to `PUT /agents/:id/identity`; voice to `PUT /agents/:id/setup` (and the profile's voice name).                                                                                                                                      | The canvas fixes the handle even while private; links and the X verification line use it.                                               |
| D15 | **Header tiles:** MASTER · AUSD and IN AGENT WALLETS · AUSD are real (from `GET /wallets`). IN YOUR POSITIONS, OPEN P&L and AI CREDITS read "Soon".                                                                                                                                                                                                                      | Personal positions need live Perpl; credits are their own spec.                                                                         |
| D16 | **Trade (you) is a Soon panel:** "Trading from your master wallet opens with live Perpl trading."                                                                                                                                                                                                                                                                        | `perpl-live-v1.md` is not built.                                                                                                        |
| D17 | **Master wallet is real:** address and Copy, AUSD and MON, an allocation list (free in master, each agent's wallet, positions Soon, AI credits Soon), "Move to an agent" (the Wallets modal), "Buy AI credits" (the credits modal, display only), and a ledger of the person's transfers from `wallets.transfers`.                                                       | The data exists (migration 0023).                                                                                                       |
| D18 | **Activity on the Overview is real:** the agent created, its wallet linked, and each transfer to or from its wallet, newest first, from `GET /agents/:id/activity`.                                                                                                                                                                                                      | No invented events.                                                                                                                     |

## 3. User flows

### 3.1 After "Create {name}"

The studio opens the draft's Overview. Header: avatar, name, `@handle · Overview`, the
`DRAFT · PRIVATE` chip; tiles below. Overview has three blocks:

1. **Go public.** Title `GO PUBLIC.`, `0 / 1`, a progress bar, "Private until you flip it. Once
   public its calls post on Pickler{ and X}, and it starts trading on its rules." One task,
   **Connect X**, with "Connect":
   - Connect opens the X row: the X mark, `@halftimebot` placeholder, **Verify**.
   - Verify (`POST .../x/challenge`) shows "We couldn't find the post yet.", the line to post, and
     "POST THIS FROM @HANDLE · THEN CHECK AGAIN"; the button reads **Check again**
     (`POST .../x/verify`). Found: the task is done, meta `@HANDLE`, `1 / 1`. Not found: the same
     prompt stays. Taken: "@handle is already another agent's." 503: D5's line.
   - **Go public** is enabled when the task is done or skipped; otherwise it reads "Connect X to go
     public". Under it, "SKIP X FOR NOW · IT POSTS ON PICKLER ONLY" / "POSTS ON PICKLER ONLY · UNDO".
   - Go public (`POST .../publish`): the title becomes `{NAME} IS LIVE`, then the studio reloads the
     agents; the agent is no longer a draft and opens in the live studio. A 409 `PUBLISH_BLOCKED`
     names the blocker (`FUNDS`: "Its wallet needs at least 10 AUSD to go public." with "Fund from
     master"; `WALLET`: "It needs its own wallet to go public."; `KILLED`).
2. **Its wallet** (READY): address, `CAPS 5 / 20 / 1×`, Copy; AUSD · TRADES and MON · GAS; "Fund
   from master" (Wallets modal on this wallet) and "Limits". Under it: "Run on its own · every
   {N}h", "Unlocks once it's public.", a shut switch.
3. **Trades** (empty: "Nothing yet. Run it on paper in the Console to see what it would do." with
   "Open Console") and **Activity** (D18).

A draft from before simplified creation has no wallet: the wallet card says so and Go public
answers `WALLET`.

### 3.2 Identity & voice

Avatar (opens the avatar picker; saving writes accent and pattern), NAME input (saved on blur or
Enter, 1–40), `@handle` with "HANDLE IS FIXED". VOICE: six chips, the sample under them; picking
one saves it. X ACCOUNT ("where it posts · optional", tag CONNECTED / NOT CONNECTED): the same
input and Verify as the Go Public task, or `@handle` with DISCONNECT.

### 3.3 Limits & funding

Left: ITS WALLET (PICKLER MAY TRADE), address, Copy, Refresh; AUSD and MON; "LAST CHECKED hh:mm";
arrivals; "Fund from master wallet"; "ONE PASSKEY PER TOKEN · OR SEND TO THE ADDRESS FROM ANY MONAD
WALLET". Right: HARD CAPS (tag SAVED / UNSAVED CHANGES), D11's line, three steppers (PER TRADE,
PER DAY, MAX LEVERAGE; the bounds of `assertSpendLimits` and `LEVERAGE_BOUNDS`), "Save caps" when
changed, and PERPL · MONAD / NO WITHDRAWALS.

### 3.4 Console, Trades

Console: RUN IT ON PAPER (state IDLE), the canvas's line, the inputs it reads (Perpl, and Web with
its mode), the shut run button (D12). ON ITS OWN (STARTS WHEN PUBLIC): "Every" 3h / 6h / 12h / 24h
(saves), `N RUNS / DAY`, and the next three run times starting with "First run after go public".
WHAT IT DID: "RUN IT TO SEE WHICH RULES FIRE". TALK TO IT: the starters and input, shut, tagged
Soon. Trades: "Paper trades", count 0, the canvas's empty state with "Open Console".

### 3.5 Brief, Sources & rules

Brief: a note bar ("EDIT FREELY · THEN RUN IT ON PAPER" and "Run it" → Console), four textareas
(THESIS, ENTERS WHEN, EXITS WHEN, NEVER) with their tags (EMPTY / n LINES / EDITED), and RISK with
the three caps steppers. Changes save with "Save brief" (one `PUT .../setup` with `brief` and
`caps`); a 409 `STALE_CONFIG` reloads and says "It changed somewhere else. Reloaded."
Sources & rules: IT READS with Perpl (fixed) and Web (switch); WEB · WHERE EXA MAY LOOK with
Anywhere / Prefer these / Only these, sites as chips with ×, the input (Enter or blur adds; at most
20; host format checked). Saving is "Save sources".

### 3.6 Trade, Master wallet

Trade: D16's Soon panel. Master wallet: D17.

## 4. API

`/v1/studio/*` routes answer bare JSON; errors `{ error, message, detail? }`. All require the
owner's studio JWT; another owner's agent is 404 `AGENT_NOT_FOUND`.

| Method | Path                      | Request                                                                                                                                   | Response                                                                                                            | Errors                                                                                                                                                                                                 |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PUT    | `/agents/:id/setup`       | `{ expectedVersion, brief?: {thesis,entersWhen,exitsWhen,never}, sources?: {web}, caps?: {perTradeAusd,perDayAusd,maxLeverage}, voice? }` | the studio agent                                                                                                    | 400 `INVALID_BRIEF` / `INVALID_INPUT`; 409 `STALE_CONFIG`, `NOT_A_DRAFT`                                                                                                                               |
| PUT    | `/agents/:id/identity`    | `{ name?, avatar?: { accent, pattern } }`                                                                                                 | the studio agent                                                                                                    | 400 `INVALID_INPUT`                                                                                                                                                                                    |
| GET    | `/agents/:id/activity`    | —                                                                                                                                         | `{ events: [{ kind: "created" \| "wallet" \| "transfer", text, at }] }`, newest first, ≤ 50                         | —                                                                                                                                                                                                      |
| GET    | `/agents/:id/x`           | —                                                                                                                                         | `{ account: { handle, verifiedAt } \| null, challenge: { handle, text, expiresAt } \| null, available }`            | —                                                                                                                                                                                                      |
| POST   | `/agents/:id/x/challenge` | `{ handle }` (`@` optional, 1–15 of `[A-Za-z0-9_]`)                                                                                       | `{ handle, text, expiresAt }` (24 h; a new one replaces the old)                                                    | 400 `INVALID_X_HANDLE`; 409 `X_HANDLE_TAKEN`, `X_ALREADY_CONNECTED`; 429 `TOO_MANY_CHECKS` (one per 10 s); 503 `X_UNAVAILABLE`                                                                         |
| POST   | `/agents/:id/x/verify`    | `{}`                                                                                                                                      | `{ verified: true, handle }` or `{ verified: false, reason: "NOT_FOUND" }`                                          | 404 `CHALLENGE_NOT_FOUND`; 409 `CHALLENGE_EXPIRED`, `X_HANDLE_TAKEN`; 429 `TOO_MANY_CHECKS` (one per 10 s); 503 `X_UNAVAILABLE`                                                                        |
| DELETE | `/agents/:id/x`           | —                                                                                                                                         | `{ disconnected: true }`                                                                                            | 409 `X_ON_PUBLIC_AGENT`                                                                                                                                                                                |
| POST   | `/agents/:id/publish`     | `{}`                                                                                                                                      | `{ visibility: "public", publishedAt }`                                                                             | 409 `PUBLISH_BLOCKED` with `detail.blockers` ⊆ `WALLET`, `FUNDS`, `KILLED`; 503 `BALANCES_UNAVAILABLE`; 409 `PUBLISH_CONFLICT` (the agent's wallet or state changed twice while publishing; try again) |
| GET    | `/wallets/ledger`         | —                                                                                                                                         | `{ entries: [{ direction: "to_agent" \| "to_master", token, amount, agentName, txHash, at }] }` newest first, ≤ 100 | —                                                                                                                                                                                                      |

The studio agent DTO gains `visibility`, `publishedAt` and `xHandle` (verified handle or null).
`POST /publish` on an already public agent answers its current state (idempotent).

## 5. Data model and migration

Migration `0024_go_public`:

```sql
CREATE TYPE agents.agent_visibility AS ENUM ('private', 'public');
ALTER TABLE agents.agents
  ADD COLUMN visibility agents.agent_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN published_at timestamptz,
  ADD CONSTRAINT agents_published_consistent CHECK ((visibility = 'public') = (published_at IS NOT NULL));
UPDATE agents.agents SET visibility = 'public', published_at = created_at WHERE status <> 'draft';
CREATE INDEX agents_public_idx ON agents.agents (published_at DESC) WHERE visibility = 'public';

CREATE TABLE agents.x_challenges (
  agent_id uuid PRIMARY KEY REFERENCES agents.agents(id) ON DELETE CASCADE, -- one live challenge
  handle text NOT NULL CHECK (handle ~ '^[A-Za-z0-9_]{1,15}$'),
  code text NOT NULL,                     -- 'pk-' + 8 base32 chars
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_checked_at timestamptz
);
CREATE TABLE agents.x_accounts (
  agent_id uuid PRIMARY KEY REFERENCES agents.agents(id) ON DELETE CASCADE,
  x_user_id text NOT NULL UNIQUE,
  handle text NOT NULL,
  verified_at timestamptz NOT NULL,
  verification_post_id text NOT NULL
);
CREATE UNIQUE INDEX x_accounts_handle_key ON agents.x_accounts (lower(handle));
```

On verify, `agent_profiles.x_handle` is set to the handle too (its unique index already exists);
disconnect clears both. Readers that change: the three `status <> 'draft'` filters in
`agent-directory.ts` become `visibility = 'public'`; `studio/directory.ts` returns `visibility`,
`published_at` and the verified handle.

## 6. Integrations

| System    | Use                                                                                                   | Config                                               |
| --------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| X API v2  | `GET /2/users/by/username/:u` (id), `GET /2/users/:id/tweets?start_time=&max_results=20` (match code) | `X_BEARER_TOKEN` (API secret, optional; absent → D5) |
| Monad RPC | the publish funding check (existing balance reader)                                                   | existing                                             |

## 7. Design work

All of it is drawn in `Pickler Studio Draft.dc.html`. Staged states (`?stage=`, never in
production): `draft` (Overview), `draft-x-open`, `draft-x-miss`, `draft-x-ok`, `draft-x-skipped`,
`draft-console`, `draft-trades`, `draft-brief`, `draft-sources`, `draft-limits`, `draft-identity`,
`draft-trade`, `draft-master`, `draft-locked`. Each is a design-harness route proving its section id.

## 8. Security and abuse

- Verification: single live challenge per agent, 24 h, code bound to agent and handle; only posts
  created after the challenge count; the post's author id must be the looked-up user id; checks
  limited to one per 10 s per agent.
- `x_user_id` and `lower(handle)` unique: one X account, one agent.
- The bearer token never leaves the API; X errors map to 503 without echoing X's body.
- Publish re-checks on the server; the client's skip is not trusted for anything.
- `PUT /setup` is draft-only and versioned; caps keep core's bounds.

## 9. Acceptance criteria and tests

1. A draft is absent from every marketplace read until `publish`; existing active agents stay
   public after the migration (Postgres test).
2. `publish` answers 409 with exactly the failing blockers; it flips visibility, `published_at`
   and status together; a second call is idempotent.
3. X: verify succeeds only for a post by the looked-up user containing the code and created after
   the challenge; a second agent cannot claim the same X user or handle; no token → 503.
4. `reviseDraft` keeps every `prepareDraft` rule (pinned with the same inputs) and leaves
   `marketScope` alone; a stale `expectedVersion` is 409.
5. Ledger and activity list only the person's own transfers, newest first.
6. Web: the draft studio's pure models (rail locks, tiles, Go Public state, caps steppers, sites)
   are unit-tested; every staged state passes the design harness with 0 FAIL.

## 10. Rollout

`X_BEARER_TOKEN` is set on `pickler-api-staging` (which serves pickler.fun) when Pickler's X app
exists; until then Connect X says D5's line and Go Public works through the skip. The migration is
additive and safe before the code.

## 11. Out of scope

X posting (OAuth grant, outbox, post classes), Public profile and Audience sections, avatar upload,
the per-venue ALLOW and signed caps, paper runs of Perpl agents and decision review (Accept, Reject,
Ask why), "Talk to it", personal trading, AI credits, the live studio's redesign.
