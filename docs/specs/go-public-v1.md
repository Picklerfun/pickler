# Go Public v1: from a private agent to a public, funded one

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`. Builds
on `studio-brief-v1.md` (the private draft), `studio-create-and-fund-v1.md` (the wallet ceremony,
the deposit, the locks) and `turnkey-passkey-custody-v1.md` (the sub-organization and its root).
Every decision below is reversible unless the table says otherwise.

## 1. Problem and users

**User:** a studio account (email or Google, passkey, Turnkey master wallet) who owns an agent that
nobody outside the studio can see yet.

**Problem.** The studio has two ways to make an agent and they disagree about publication:

- The brief on the empty home creates a **private draft** with no wallet
  (`studio-brief-v1.md:175-206`; `packages/infrastructure/src/studio/directory.ts` inserts
  `status 'draft'`), hidden from the marketplace by `a.status <> 'draft'`
  (`packages/infrastructure/src/persistence/agent-directory.ts:157`, `:178`, `:213`).
- `/studio/new` creates the agent **with** its wallet and inserts it `status 'active'`
  (`packages/infrastructure/src/studio/directory.ts:151-153`), so it is on the public board the
  moment it exists (research 05 §3 gap 6). That contradicts the brief's footnote "NOTHING GOES
  PUBLIC · IT RUNS ON PAPER UNTIL YOU FUND IT" (`studio-brief-v1.md:168`).

A draft's home shows a Go Public card whose four steps are all "Soon"
(`apps/web/src/features/studio/home/go-public.tsx:6-11`, `:37`), and the studio sections Identity,
Public profile and Audience are Soon panels (`apps/web/src/features/studio/sections/rail.ts:41`,
`:47-48`; copy at `rail.ts:84-99`). A draft cannot get a wallet, so it can never schedule
(`studio-brief-v1.md:200-203`), and the brief's caps are enforced only on paper
(`studio-brief-v1.md:97-103`; `packages/core/src/features/research/types.ts:91-95`).

Go Public is the one door from private to public, for both creation paths. It also carries the
owner's read price (conventions decision 4), and it is the gate for launching a token (decision 5).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reason                                                                                                                                                                                                                        | Reversible?                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| D1  | **Publication is its own column, not a status.** `agents.agents` gains `visibility` (`private`/`public`) and `published_at`. `status` keeps meaning lifecycle (`draft` = no wallet yet, `active`, `paused`, …). The marketplace filters on `visibility = 'public'`, not on `status <> 'draft'`.                                                                                                                                                        | A `/studio/new` agent has a wallet and runs (`active`) but must still be private. One column cannot say both.                                                                                                                 | yes                                                              |
| D2  | **Every new agent starts private,** whichever path made it. `/studio/new` inserts `visibility 'private'`. The migration sets existing non-draft, non-killed agents to `public` with `published_at = created_at`, so nothing already public disappears.                                                                                                                                                                                                 | Research 05 point 3 and open question 4; one rule for both paths.                                                                                                                                                             | yes (a flag could restore instant publication for `/studio/new`) |
| D3  | **Go Public has the canvas's four required steps, in its order:** Voice, Connect X, Its wallet, Fund it. A fifth, **Reads**, is optional and sits under them ("OPTIONAL · OPEN READS NOW OR LATER"). The button reads "N to go" until the four are done, then "Go public".                                                                                                                                                                             | The canvas "Pickler Studio Empty v4" draft phase (tasks at its logic lines 499-503). Reads is where decision 4 puts the price, but a public agent with no read service is valid.                                              | yes                                                              |
| D4  | **Voice is one of six presets** (Analyst, Contrarian, Trash talker, Deadpan, Hype, Professor), stored in `agent_profiles.voice` (exists, ≤ 120, `agents.ts:96`). The sample post is **rendered from a template, not a model call**: the preset's template filled with the agent's latest paper-run decision, or the canvas's canned sample when it has no trade yet.                                                                                   | The canvas draws six presets with a fixed sample each. A template is free, deterministic and testable; the voice changes how posts read, never how the agent decides.                                                         | yes (a model-written variant is v2)                              |
| D5  | **Voice never enters the decision prompt.** `composeBrief` (studio-brief-v1 §3.1) is unchanged; voice is read only by the post renderer.                                                                                                                                                                                                                                                                                                               | A "Hype" agent must not trade differently from an "Analyst" one on the same brief.                                                                                                                                            | yes                                                              |
| D6  | **Connect X is verification by post,** as the canvas draws it: the owner types the handle, posts a line Pickler gives them ("Verifying {Name} on @pickler · pk-XXXXXXXX") from that account, and presses Verify. Pickler reads the account's recent posts with the app's bearer token and matches the code. No OAuth is needed to verify.                                                                                                              | It proves control without asking for write access, and it is exactly the canvas's flow (`xMiss` "We couldn't find the post yet").                                                                                             | yes                                                              |
| D7  | **Posting is a separate, optional OAuth 2.0 grant** ("Let it post", scopes `tweet.read tweet.write users.read offline.access`), offered on the X card after verification and in the Identity section later. Without it the agent is still public; nothing posts.                                                                                                                                                                                       | Verification and write access are different trust levels; many owners will want the badge without the bot.                                                                                                                    | yes                                                              |
| D8  | **What posts automatically:** (a) one "went public" post at publish; (b) each **resolved** trade decision, after resolution (decision 1), as a receipt; (c) a paid read the buyer made public, after it resolves. Never an open position, never an abstention, never a private read. At most one post per agent per 30 minutes and 10 per UTC day; excess waits in the outbox. Each class can be switched off.                                         | Decision 1: decisions become public when they resolve, which protects what paid reads sell.                                                                                                                                   | yes                                                              |
| D9  | **X API tier: Basic (paid)** for the app. Verification needs reads of a user's recent posts, which the free tier does not practically allow; posting uses per-user OAuth tokens within the app's monthly post cap.                                                                                                                                                                                                                                     | Smallest tier that does both. Cost and account ownership go to the owner (§12).                                                                                                                                               | yes                                                              |
| D10 | **Its wallet reuses the §4.1 ceremony** (`studio-create-and-fund-v1.md:161-293`; routes `workers/api/src/routes/signing.ts:424-520`) for a draft: delegated user on the first agent, `createWallet`, `createPolicies`, link. An agent from `/studio/new` already has a wallet and goes straight to the caps ceremony (D12).                                                                                                                            | No second custody path.                                                                                                                                                                                                       | yes                                                              |
| D11 | **Caps become two layers, and the screen says which is which.** Per trade: a Turnkey ALLOW per venue bounded by contract, function selector **and** the amount argument (`eth.tx.contract_call_args[...] <= cap`, with the venue ABI uploaded as a Smart Contract Interface). Per day: enforced by Pickler's trading worker, which refuses to request a signature past the UTC day's sum. Turnkey policies are per-transaction; they cannot sum a day. | Turnkey's policy language can bound one call's arguments but not a running total. Writing "its wallet enforces them" for the daily cap would be false. The canvas copy changes (§7).                                          | yes                                                              |
| D12 | **The venue ALLOW is generated from a venue manifest** in `@pickler/chain` (`VENUE_MANIFEST`: key, chain, contract, selectors, ABI, amount argument). `VENUE_CONTRACTS` (`packages/core/src/features/wallets/domain/agent-wallet-policies.ts:28`) becomes derived from it. While the manifest is empty, Go Public creates the three DENYs and records the caps and chosen venues, and the wallet card says "PAPER UNTIL LIVE TRADING OPENS".           | The ALLOW is absent today because there is nothing to allow (`agent-wallet-policies.ts:138-148`). Perpl orders are Ed25519 messages signed by a Pickler-held key (decision 7), so the wallet itself only signs funding calls. | yes                                                              |
| D13 | **Changing caps after Go Public:** lowering takes effect in Pickler's enforcement at once and in Turnkey after a caps ceremony (delete the old ALLOW, create the new one, both root-stamped). Raising needs the ceremony first. `PUT /v1/studio/agents/:id/limits` (`workers/api/src/routes/studio.ts:555`) answers 409 `CAPS_NEED_APPROVAL` for a raise on a wallet with caps policies.                                                               | The passkey is the only root (`turnkey-passkey-custody-v1.md` §2); nobody else can widen a wallet.                                                                                                                            | yes                                                              |
| D14 | **Fund it:** minimum 10 AUSD (the schedule lock, `studio-create-and-fund-v1.md:410-412`), preset amounts 10 / 25 / 50 / 100 with **100 preselected** as the canvas draws. The deposit is §6.2's (`studio.ts:583`, `:602`). Done when the balance read is ≥ 10 AUSD, however the AUSD arrived.                                                                                                                                                          | Research 05 open question 5: 10 is the rule the product already enforces; 100 is a suggestion, not a gate.                                                                                                                    | yes                                                              |
| D15 | **Publish is one server call** that re-checks every step and flips `visibility` in one transaction. Publishing also flips a draft's `status` to `active` once it has a wallet.                                                                                                                                                                                                                                                                         | The screen never decides what is public.                                                                                                                                                                                      | yes                                                              |
| D16 | **No unpublish in v1.** A public agent can be paused or killed (existing). Its resolved record stays public.                                                                                                                                                                                                                                                                                                                                           | A record that vanishes on demand is not a record. See §12 Q4.                                                                                                                                                                 | yes                                                              |
| D17 | **Identity, Public profile and Audience become real sections** (§3.4). The handle is editable only while private; after publish it is fixed. The name, accent, avatar, blurb and links stay editable.                                                                                                                                                                                                                                                  | Links from posts and receipts point at `/agents/<handle>`.                                                                                                                                                                    | yes                                                              |
| D18 | **Avatars are uploaded images** (PNG, JPEG or WebP, ≤ 1 MB, square, re-encoded server-side to 512×512 WebP) stored under `avatars/<sha256>.webp` with the storage, image rules and serving defined in `token-launch-v1.md` (T5, T6 and its media storage section): one bucket and one domain for all public media. Without one, the monogram on the accent colour is drawn as today.                                                                   | The public profile needs a face; generated faces are out of scope (studio-create-and-fund §10).                                                                                                                               | yes                                                              |
| D19 | **Audience stats are only what the backend can count:** followers (from `public-record-v1.md` P6, once server follows exist), reads bought and unique buyers (30 days), read revenue, token holders (once a token exists). Anything without a source is "Soon", never zero.                                                                                                                                                                            | The Soon panel's rule (`apps/web/src/features/studio/sections/soon.tsx:9-13`).                                                                                                                                                | yes                                                              |

## 3. User flows

### 3.1 Go Public on a draft (from the brief)

Screen: the draft's home, `DRAFT · PRIVATE` chip (`apps/web/src/features/studio/home/home.tsx:241`),
the Go Public card (`home.tsx:333-334`) with `0 / 4`.

1. **Voice.** The card opens on Voice (the canvas's `openTask: 'voice'`). Six preset chips; picking
   one shows its sample post in a quote block. "Pick" saves it (`PUT .../voice`). Meta turns into
   the preset name in capitals.
2. **Connect X.** An input with the X mark, placeholder `@halftimebot`, and **Verify**.
   - Verify first issues a challenge (`POST .../x/challenge`) and shows the line to post, with a
     copy button and "POST THIS FROM @HANDLE · THEN CHECK AGAIN".
   - **Check again** calls `POST .../x/verify`. Found: the step is done, meta `@HANDLE`, and the
     card offers "Let it post" (OAuth, D7) with "Not now". Not found: "We couldn't find the post
     yet." Taken by another agent: "@x is already another agent's".
3. **Its wallet.** "Review caps" opens the caps: PER TRADE and PER DAY steppers (from the brief,
   same bounds as `studio-brief-v1.md:49-53`), MAX LEVERAGE with "Soon", and venue toggles
   (PERPL · MONAD, PICKLER MARKETS) with the "NO WITHDRAWALS" tag. **Authorize** runs the ceremony
   (§4.1 prompts: three on a first agent, two on later ones), in the passkey sheet the canvas draws
   ("Create {Name}'s wallet?", caps line, "Wallet created"; cancel shows "Passkey cancelled ·
   NOTHING WAS SIGNED · NOTHING MOVED"). Meta after: `5 / TRADE · 20 / DAY · 0x91be…4a07`.
4. **Fund it.** Locked until the wallet exists ("AFTER ITS WALLET"). Then "Fund 100 AUSD" opens the
   existing deposit sheet (`home/deposit-sheet.tsx`) with 100 preselected. One passkey prompt. Done
   when the balance reads ≥ 10.
5. **Reads (optional).** "Open reads" opens the read-service form from `paid-reads-v1.md` §3.1
   inline. "Later" collapses it.
6. **Go public.** Enabled when 1–4 are done. `POST .../publish`. The title becomes
   "{NAME} IS LIVE", the chip turns lime `PUBLIC`, and the button reads
   "Public · trades on paper until live trading opens" while the venue manifest is empty (the
   canvas's "Live · first trade on its rules" is used once a venue ALLOW exists). If posting is
   connected, the "went public" post goes to the outbox.

Each step can be done in any order except Fund after Wallet. Progress is derived from data (§5),
so leaving and coming back shows the same state.

### 3.2 Go Public on a `/studio/new` agent

The home of a private `active` agent shows the same card. **Its wallet** is already done for the
wallet itself; its meta reads "CAPS NOT ON THE WALLET YET" until the caps ceremony (D13) has added
the caps records (and the venue ALLOW, when the manifest has one). Fund it is done if the balance
is already ≥ 10.

### 3.3 After publish

- The agent appears on `/agents`, `/leaderboard` and at `/agents/<handle>`.
- The token section may now offer a launch (decision 5; `launchpad-monad-v1.md`).
- Changing caps (Limits & funding section): lowering is immediate; raising shows
  "Approve new caps with your passkey" and runs the caps ceremony.

### 3.4 The three sections that are Soon today

**Identity & voice** (`?section=identity`):

- Name (1–40, `agents_name_length`, `agents.ts:68`).
- Handle: editable while private, with the availability check; after publish, read-only with
  "Fixed once public".
- Voice preset with its sample (same control as the Go Public step).
- X: the verified handle, "Verified {date}", posting on/off with the three post classes (D8), and
  "Disconnect", which revokes the token and clears the badge. Re-verifying is needed to reconnect.

**Public profile** (`?section=profile`):

- Avatar upload with crop to square, or "Use monogram".
- Accent: the seven values of `agents.accent` (`agents.ts:33-41`).
- Blurb (≤ 280, exists).
- Links: up to three, each `https://` only, label ≤ 24, URL ≤ 200. No X link here; X comes from
  verification.
- "Let others start from its brief" (the fork opt-in, owned by `fork-agent-v1.md`).
- **What the public page shows** is a fixed list with a preview link: name, handle, avatar,
  accent, blurb, links, beat, venue, verified X, the resolved record, the read service. It never
  shows the brief's rules, caps, wallet address or unresolved decisions. The only toggle is
  "Show its thesis" (off by default), which puts the brief's thesis line on the profile.

**Audience** (`?section=audience`): four tiles (followers, reads bought 30d, unique buyers 30d,
read revenue 30d in AUSD) and, when a token exists, holders. Each tile without a source shows
"Soon". Below: the X post log (sent, waiting, failed) from the outbox.

The rail entries lose `soon: true` for `identity`, `profile` and `audience` (`rail.ts:41`, `:47`,
`:48`), and their `PANELS` copy is deleted.

## 4. API

All studio routes: `/v1/studio/*`, Supabase JWT of a studio account that owns the agent (403
`NOT_OWNER` otherwise, 404 `AGENT_NOT_FOUND`). Envelope and errors per conventions. Every POST that
creates or signs takes `Idempotency-Key`.

| Method | Path                                    | Request                                                                                         | Response `data`                                                                                                                             | Errors                                                                                                                           |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/studio/agents/:id/go-public`       | —                                                                                               | `{ visibility, steps: { voice, x, wallet, fund, reads } }`; each step `{ done, meta, blockedBy? }`; `canPublish`, `publishBlockers[]`       | —                                                                                                                                |
| PUT    | `/v1/studio/agents/:id/voice`           | `{ preset: "analyst" \| "contrarian" \| "trash_talker" \| "deadpan" \| "hype" \| "professor" }` | `{ preset, sample }`                                                                                                                        | 400 `INVALID_INPUT`                                                                                                              |
| GET    | `/v1/studio/voice-presets`              | query `agentId?`                                                                                | `[{ preset, label, colorToken, sample }]` (sample rendered on that agent's latest decision when given)                                      | —                                                                                                                                |
| POST   | `/v1/studio/agents/:id/x/challenge`     | `{ handle }`                                                                                    | `{ challengeId, handle, text, expiresAt }` (24 h)                                                                                           | 400 `INVALID_X_HANDLE`; 409 `X_HANDLE_TAKEN`; 429                                                                                |
| POST   | `/v1/studio/agents/:id/x/verify`        | `{ challengeId }`                                                                               | `{ verified: true, handle, xUserId }` or `{ verified: false, reason: "NOT_FOUND" }`                                                         | 404 `CHALLENGE_NOT_FOUND`; 409 `CHALLENGE_EXPIRED`, `X_HANDLE_TAKEN`; 429 (one check per 10 s, 30 per hour); 503 `X_UNAVAILABLE` |
| GET    | `/v1/studio/agents/:id/x/authorize`     | —                                                                                               | `{ url }` (X OAuth 2.0 PKCE; state bound to user and agent, 10 min)                                                                         | 409 `X_NOT_VERIFIED`                                                                                                             |
| GET    | `/v1/studio/x/callback`                 | query `code`, `state`                                                                           | 302 to `/studio?section=identity&x=connected` (or `&x=error`)                                                                               | account on the grant ≠ verified handle → `&x=mismatch`, token discarded                                                          |
| PUT    | `/v1/studio/agents/:id/x/posting`       | `{ enabled, classes: { wentPublic, resolvedTrades, publicReads } }`                             | the setting                                                                                                                                 | 409 `X_NOT_CONNECTED`                                                                                                            |
| DELETE | `/v1/studio/agents/:id/x`               | —                                                                                               | `{ disconnected: true }` (revokes at X, clears tokens and badge)                                                                            | 409 `X_ON_PUBLIC_AGENT_REQUIRED`: a public agent keeps a verified handle; disconnect posting instead                             |
| GET    | `/v1/studio/agents/:id/caps`            | —                                                                                               | `{ perTradeAusd, perDayAusd, maxLeverage, venues[], onWallet: { perTradeAusd, venues[], approvedAt } \| null, pending: boolean }`           | —                                                                                                                                |
| POST   | `/v1/studio/agents/:id/caps/prepare`    | `{ perTradeAusd, perDayAusd, venues[] }`                                                        | `{ activities: [unsigned DELETE_POLICIES?, CREATE_POLICIES] }` to stamp in order                                                            | 400 `INVALID_INPUT`; 409 `NO_WALLET`, `NO_VENUE_AVAILABLE` (only for venues not in the manifest)                                 |
| POST   | `/v1/studio/agents/:id/caps/confirm`    | `{ stamped: [...] }`                                                                            | `{ caps }`                                                                                                                                  | 409 `STAMP_MISMATCH` (byte comparison as §4.1), `CAPS_STALE`                                                                     |
| PUT    | `/v1/studio/agents/:id/limits` (exists) | as today                                                                                        | as today                                                                                                                                    | new 409 `CAPS_NEED_APPROVAL` when raising above `onWallet`                                                                       |
| POST   | `/v1/studio/agents/:id/publish`         | `{}`                                                                                            | `{ visibility: "public", publishedAt, profileUrl }`                                                                                         | 409 `PUBLISH_BLOCKED` with `detail.blockers[]` (`VOICE`, `X`, `WALLET`, `CAPS`, `FUNDS`, `FIRST_RUN`, `KILLED`)                  |
| PUT    | `/v1/studio/agents/:id/identity`        | `{ name?, handle? }`                                                                            | the identity                                                                                                                                | 409 `HANDLE_TAKEN`, `HANDLE_FIXED` (public agent)                                                                                |
| PUT    | `/v1/studio/agents/:id/profile`         | `{ accent?, blurb?, links?: [{ label, url }], showThesis?, forkable? }`                         | the profile                                                                                                                                 | 400 `INVALID_LINK`, `INVALID_INPUT`                                                                                              |
| POST   | `/v1/studio/agents/:id/avatar`          | `multipart/form-data` `file`                                                                    | `{ avatarUrl }`                                                                                                                             | 400 `INVALID_IMAGE`; 413 `IMAGE_TOO_LARGE`                                                                                       |
| DELETE | `/v1/studio/agents/:id/avatar`          | —                                                                                               | `{ avatarUrl: null }`                                                                                                                       | —                                                                                                                                |
| GET    | `/v1/studio/agents/:id/audience`        | query `range=30d`                                                                               | `{ followers: number \| null, readsBought, uniqueBuyers, readRevenueMicroAusd, holders: number \| null }` (null = no source, drawn as Soon) | —                                                                                                                                |
| GET    | `/v1/studio/agents/:id/x/posts`         | `?cursor=&limit=`                                                                               | `[{ id, class, text, status: "queued" \| "sent" \| "failed", sentAt, url }]`                                                                | —                                                                                                                                |

**Internal** (service binding only):

| Method | Path                          | Caller                   | Does                                                                                                                      |
| ------ | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/internal/x/outbox/drain` | `workers/jobs` cron, 1 m | sends due posts within D8's limits; refreshes tokens; marks failures; 3 retries with backoff, then `failed`               |
| POST   | `/v1/internal/x/enqueue`      | resolution job, reads    | `{ agentId, class, subjectId }` → renders the voice template and queues it if the class is enabled; idempotent by subject |

**Marketplace** DTO changes (`packages/api-schema/src/agents.ts`): the persona and directory row
gain `avatarUrl`, `links`, `xVerified: boolean`, `publishedAt`, and `thesis: string | null` (only
when `showThesis`).

## 5. Data model and migrations

Migration **`00NN_go_public`** (next free number is 0023; the number is assigned at build time).
Drizzle in `packages/infrastructure/src/persistence/product/agents.ts` and `wallets.ts`.

```sql
-- Publication (D1, D2)
CREATE TYPE agents.agent_visibility AS ENUM ('private', 'public');
ALTER TABLE agents.agents
  ADD COLUMN visibility agents.agent_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN published_at timestamptz,
  ADD CONSTRAINT agents_published_consistent
    CHECK ((visibility = 'public') = (published_at IS NOT NULL));
UPDATE agents.agents SET visibility = 'public', published_at = created_at
  WHERE status NOT IN ('draft', 'killed');
CREATE INDEX agents_public_idx ON agents.agents (published_at DESC) WHERE visibility = 'public';

-- Profile (D17, D18)
ALTER TABLE agents.agent_profiles
  ADD COLUMN avatar_key text,                     -- R2 object key; null = monogram
  ADD COLUMN links jsonb NOT NULL DEFAULT '[]',   -- [{label,url}], ≤ 3, checked in core
  ADD COLUMN show_thesis boolean NOT NULL DEFAULT false,
  ADD COLUMN voice_preset text
    CHECK (voice_preset IN ('analyst','contrarian','trash_talker','deadpan','hype','professor'));
-- agent_profiles.voice (≤120) keeps the preset's label for older readers.

-- X (D6-D8)
CREATE TABLE agents.x_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents.agents(id) ON DELETE CASCADE,
  handle text NOT NULL CHECK (handle ~ '^@[A-Za-z0-9_]{1,15}$'),
  code text NOT NULL,                              -- 'pk-' + 8 base32 chars
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  post_id text
);
CREATE TABLE agents.x_accounts (
  agent_id uuid PRIMARY KEY REFERENCES agents.agents(id) ON DELETE CASCADE,
  x_user_id text NOT NULL UNIQUE,
  handle text NOT NULL,
  verified_at timestamptz NOT NULL,
  verification_post_id text NOT NULL,
  token_ciphertext bytea,                          -- OAuth access+refresh, AES-GCM, null = no posting
  token_key_version smallint,
  token_expires_at timestamptz,
  posting_enabled boolean NOT NULL DEFAULT false,
  post_classes jsonb NOT NULL DEFAULT '{"wentPublic":true,"resolvedTrades":true,"publicReads":false}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agents.x_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents.agents(id) ON DELETE CASCADE,
  class text NOT NULL CHECK (class IN ('went_public','resolved_trade','public_read')),
  subject_id text NOT NULL,                        -- decision id, read id, or agent id
  text text NOT NULL CHECK (char_length(text) <= 280),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts smallint NOT NULL DEFAULT 0,
  not_before timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  x_post_id text,
  last_error text,
  UNIQUE (agent_id, class, subject_id)
);
CREATE INDEX x_posts_due_idx ON agents.x_posts (not_before) WHERE status = 'queued';

-- Caps on the wallet (D11-D13)
CREATE TABLE wallets.agent_wallet_caps (
  agent_id uuid PRIMARY KEY REFERENCES wallets.agent_wallets(agent_id) ON DELETE CASCADE,
  wallet_id text NOT NULL REFERENCES wallets.agent_wallets(wallet_id),
  per_trade_micro_ausd bigint NOT NULL CHECK (per_trade_micro_ausd > 0),
  per_day_micro_ausd bigint NOT NULL CHECK (per_day_micro_ausd >= per_trade_micro_ausd),
  venues text[] NOT NULL DEFAULT '{}',
  cap_policy_ids text[] NOT NULL DEFAULT '{}',     -- the venue ALLOWs carrying the cap
  approved_at timestamptz NOT NULL
);
```

`wallets.agent_wallets` keeps `policy_ids` (`wallets.ts:88-107`) for the three DENYs; its
`agent_id` primary key and `agent_wallets_wallet_key` unique index (`wallets.ts:103`) are what the
two references above point at.

**Progress is derived, not stored:** voice = `voice_preset IS NOT NULL`; X = a row in `x_accounts`;
wallet = a row in `agent_wallets` and in `agent_wallet_caps` whose caps equal the config's `spend`;
fund = balance ≥ 10 AUSD (§6.1 read); reads = an open `reads.read_services` row
(`paid-reads-v1.md`).

**Readers that change:** every `PostgresAgentDirectory` query filters `a.visibility = 'public'`
instead of `a.status <> 'draft'` (`agent-directory.ts:157`, `:178`, `:213`, and the leaderboard and
directory reads). `directory.ts:152` inserts `visibility 'private'`.

## 6. Integrations

| System               | Use                                                                                                                                                                           | Keys and config                                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X API v2, Basic tier | `GET /2/users/by/username/:u`, `GET /2/users/:id/tweets` (verification, app bearer); `POST /2/tweets` and OAuth 2.0 PKCE token/refresh/revoke (posting)                       | `X_BEARER_TOKEN`, `X_CLIENT_ID`, `X_CLIENT_SECRET` (API secrets), `X_TOKEN_ENCRYPTION_KEY` (32 bytes, versioned like the delegated key), callback `https://studio.pickler.fun/api/v1/studio/x/callback` registered on the X app |
| Turnkey              | the §4.1 ceremony; `DELETE_POLICIES` and `CREATE_POLICIES` for caps; Smart Contract Interface upload per venue ABI (once, in Pickler's parent org and referenced by sub-orgs) | existing `TURNKEY_*`; no new secret                                                                                                                                                                                             |
| `@pickler/chain`     | `VENUE_MANIFEST` (D12); AUSD metadata (`packages/chain/src/networks.ts:60-74`)                                                                                                | public constants only                                                                                                                                                                                                           |
| Monad RPC            | balance read for Fund it (existing, 15 s cache)                                                                                                                               | `MONAD_RPC_URL`, `CHAIN_ID`                                                                                                                                                                                                     |
| Media storage        | avatars, under the `avatars/` prefix                                                                                                                                          | defined in `token-launch-v1.md` (T5, T6 and its media storage section); this spec adds no binding of its own                                                                                                                    |
| `workers/jobs` (new) | Cron triggers that call `/v1/internal/*` through a service binding; no secrets of its own                                                                                     | binding `API`; shared with `paid-reads-v1.md`                                                                                                                                                                                   |
| Trading worker       | enforces the per-day cap before any delegated signature (D11)                                                                                                                 | reads `wallets.agent_wallet_caps` and its own ledger; owned by `perpl-live-v1.md` and `custody-v2.md`                                                                                                                           |

## 7. Design work

| Surface | Screen / state                                                                                                                                                                                             | Canvas                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Studio  | Draft overview · Go Public card: steps 0-4 done, Voice open, X open (idle, checking, not found, verified + "Let it post"), Wallet open (caps, venues), Fund locked/open, all done, live                    | **exists**: "Pickler Studio Empty v4", draft phase (`data-screen-label="Studio · Draft overview"`) and passkey sheet |
| Studio  | **Copy change on the wallet step:** RISK sub-line from "hard caps · its wallet enforces them" to "per trade: its wallet enforces it · per day: Pickler does"; wallet meta "PAPER UNTIL LIVE TRADING OPENS" | must be redrawn in Claude Design (small edit to Empty v4)                                                            |
| Studio  | Optional Reads step under the four                                                                                                                                                                         | **must be drawn** (Empty v4 has four tasks)                                                                          |
| Studio  | Go Public on a private `/studio/new` agent ("CAPS NOT ON THE WALLET YET")                                                                                                                                  | **must be drawn** (variant of the above)                                                                             |
| Studio  | Publish success: "{NAME} IS LIVE", paper-only label, link to the public page                                                                                                                               | exists in Empty v4 (`goTitle`, `goLabel`); label variant must be drawn                                               |
| Studio  | Caps ceremony sheet for raising caps (two prompts), and the 409 `CAPS_NEED_APPROVAL` inline state in Limits & funding                                                                                      | **must be drawn**                                                                                                    |
| Studio  | Identity & voice section (name, handle fixed state, voice, X status and post classes, disconnect)                                                                                                          | **must be drawn**; Studio v5 has only the rail entry                                                                 |
| Studio  | Public profile section (avatar crop, accent, blurb, links, show thesis, fork opt-in, "what the page shows" preview)                                                                                        | **must be drawn**                                                                                                    |
| Studio  | Audience section (tiles with Soon states, post log)                                                                                                                                                        | **must be drawn**                                                                                                    |
| Web     | Agent profile header with avatar, verified X badge, links, optional thesis                                                                                                                                 | "Agent Profile Light" exists; the badge, links and thesis line **must be added**                                     |
| Mobile  | Same header on "Agent Profile Mobile Light"                                                                                                                                                                | exists; additions **must be drawn** (the app lives outside this repo)                                                |

Staged states for the design harness: `/studio?stage=draft-go-public-{0..4}`, `...-x-miss`,
`...-live`, and one per new section.

## 8. Security and abuse

- **Handle impersonation:** verification proves control of the X account; the unique index on
  `lower(x_handle)` (`agents.ts:102-104`) stops two agents claiming one account; `x_user_id` is
  unique too, so a renamed X account cannot be claimed twice.
- **Challenge replay:** codes are single-use, 24 h, bound to agent and handle; a post older than
  the challenge does not count.
- **OAuth:** PKCE, `state` bound to user and agent, tokens encrypted at rest with a versioned key,
  never returned to the browser; the callback discards a grant for an account other than the
  verified one.
- **Posting abuse:** D8's rate limits per agent; templated text only (no free-form owner text in
  v1), so the post cannot carry links to phishing; a killed agent's outbox is skipped.
- **Custody:** every caps change is root-stamped and byte-compared (`studio-create-and-fund-v1.md`
  §4.1). Pickler's key is still unable to transfer out (the `transfer`/`approve` DENY). The venue
  ALLOW is bounded by selector and amount, as §4.1 already requires for live trading.
- **Avatars:** re-encoded server-side (strips metadata and active content), content type from the
  bytes, not the header; 20 uploads per agent per day.
- **Links:** `https://` only, no `javascript:`/`data:`, rendered with `rel="nofollow ugc noopener"`.
- **Publication cannot be forced client-side:** `publish` re-checks every step in the same
  transaction that flips the column.

## 9. Acceptance criteria and tests

1. A brief draft and a `/studio/new` agent are both absent from `/v1/marketplace/*` until
   `publish` succeeds; both appear after. Existing active agents are still public after the
   migration.
2. `publish` answers 409 `PUBLISH_BLOCKED` with the exact blockers for each missing step.
3. Voice: each preset's template renders on a TRADE and a NO_TRADE decision; `composeBrief`
   output is byte-identical with and without a voice (pinned test).
4. X: verify succeeds only for a post from the claimed account containing the code, created after
   the challenge; a second agent cannot claim the same `x_user_id`.
5. Outbox: never enqueues an open decision or a private read; respects 1 per 30 min and 10 per
   day; idempotent by `(agent, class, subject)`.
6. Caps: `agentWalletPolicies` (`agent-wallet-policies.ts:128`) with a non-empty manifest emits one ALLOW per venue with
   contract, selector and `contract_call_args` amount bound; with an empty manifest emits only the
   DENYs (pinned policy text). Raising caps without approval answers 409; lowering applies at once.
7. **Real validation (the person):** on a test sub-organization, a delegated signature over the
   per-trade cap is refused by Turnkey; a transfer out is refused; a signature within the cap to a
   manifest venue is allowed.
8. Design harness: 0 FAIL on every staged state in §7.

## 10. Rollout and dependencies

Needs first: `studio-brief-v1.md` (built), `studio-create-and-fund-v1.md` (built; real Turnkey
validation still open), `product-hosts-cutover-v2.md` so `TURNKEY_RPID=studio.pickler.fun`, `production-environment-v1.md`
for the new bindings and secrets, `token-launch-v1.md` for media storage, and an X developer app on
the Basic tier. The resolved decisions the outbox posts come from `decision-resolution-v1.md`;
follower counts for Audience come from `public-record-v1.md` (P6).

Order: (1) migration and the visibility switch in readers (safe alone); (2) voice and profile
sections; (3) X verification; (4) wallet and caps; (5) publish; (6) posting and the outbox;
(7) the venue ALLOW when `perpl-live-v1.md` and `custody-v2.md` fill the manifest. Paid reads' Reads step lands with `paid-reads-v1.md`.

## 11. Out of scope

Unpublishing; model-written posts; replies and mentions; posting to anything but X; a generated
face; live trading itself and Perpl account onboarding (`perpl-live-v1.md`); withdrawals from agent
to master (`custody-v2.md`); token launch (`token-launch-v1.md`, which only reads `visibility`).

## 12. Open questions for the owner

1. **X developer account:** does Pickler have one, who owns it, and is the Basic tier's monthly
   cost approved? Without it, Connect X cannot ship and Go Public would need X to be optional.
2. Should Connect X be **required** for Go Public (the canvas says yes), or optional for owners
   who do not want an X presence?
3. Is the verification line allowed to mention `@pickler` (it tags the brand account on every
   verification)?
4. Unpublish: keep "no way back except kill" (D16), or allow hiding an agent while keeping its
   resolved receipts reachable by link?
