# Studio: simplified agent creation (v1)

Status: approved in brainstorming on 2026-10-01. Canvas: Claude Design project
`c03aadb4-7bb2-429e-aa49-98ae4218bc1f`, `Pickler Studio Empty v5.dc.html`, the "create" phase,
the wallet panel, the Wallets and AI credits modals, the avatar picker and the passkey sheets.

This replaces the creation half of `studio-brief-v1.md` and all of `studio-create-and-fund-v1.md`'s
`/studio/new` flow. Go Public (Connect X, publishing) is a later section, once the agent exists
(see §11). AI credits are their own spec, because they are part of the growth strategy.

## 1. Problem and users

A person who has just signed up to the studio has to make their first agent. Today that takes a
long brief, a paper run that must finish before "Create" unlocks, and a second flow, `/studio/new`,
in seven steps, for later agents. Funding comes after creation, so an agent can exist with nothing
to trade.

The canvas makes creation short and puts the money first:

- Name, handle, an avatar and a voice; what it reads (Perpl always, the web optional); everything
  else (thesis, rules, caps) folded into "Advanced settings" with working defaults.
- Its own wallet, made in the studio, funded from the master wallet to a minimum of AUSD (to
  trade) and MON (for gas) before the agent can be created.
- "Create {name}" signs the wallet's policies with one passkey and creates the agent.

Users: a studio account (Turnkey master wallet), first agent or later ones.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                              | Reason                                                                                                                                                                            | Reversible?  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| D1  | **One creation flow.** The simplified brief is how every agent is made. `/studio/new`, `features/studio/create` and the API routes only it uses are deleted. "+ New agent" opens the brief.                                                                                                                                                                           | Two flows doubled the work and confused the product.                                                                                                                              | yes          |
| D2  | **No paper run to create.** `POST /v1/studio/drafts` no longer takes a `previewRunId`.                                                                                                                                                                                                                                                                                | The canvas has none; funding is the gate now.                                                                                                                                     | yes          |
| D3  | **The agent's wallet is made in the studio, before the agent.** "Create its wallet" creates a Turnkey wallet (`wallets.kind = 'agent'`, unlinked) with the person's passkey. The first time, the same sheet then creates Pickler's delegated user (a second Touch ID, "2 of 2").                                                                                      | Signup stays as it is; the wallet exists before the money. Two Turnkey activities need two stamps; putting both on this setup step keeps "Create {name}" at one signature always. | yes          |
| D4  | **Creation needs money in the agent's wallet:** at least `MIN_START_AUSD` = 10 AUSD and `MIN_START_MON` = 0.5 MON, read on chain by the server.                                                                                                                                                                                                                       | "It cannot exist without AUSD to trade"; MON pays its gas.                                                                                                                        | yes (values) |
| D5  | **"Create {name}" signs the wallet's policies** (one passkey) and creates the agent as a private draft linked to that wallet.                                                                                                                                                                                                                                         | The canvas: "Sets its caps".                                                                                                                                                      | yes          |
| D6  | **Turnkey enforces what it can; Pickler enforces the rest.** The policies let the delegated user sign only to Perpl's contracts and never move funds anywhere else. Per-trade and per-day caps live in `config.spend`, leverage in the existing `config.maxLeverage` (`LEVERAGE_BOUNDS`), and the trading worker holds every order to them. The UI says exactly that. | Turnkey cannot count a day's spend or read a perps order's leverage. Promising otherwise would be false.                                                                          | yes          |
| D7  | **The owner can always pull funds back.** "Pull back to master" is signed by the person's passkey, which is the sub-organization's root and bypasses policies.                                                                                                                                                                                                        | Their money; no policy needed.                                                                                                                                                    | —            |
| D8  | **Voice is required**, one of six: Analyst, Contrarian, Trash talker, Deadpan, Hype, Professor. Stored as `config.voice` (`normalizeBrief` rebuilds the brief from its five fields, so it cannot live inside `brief`); its name is also written to the profile's `voice`.                                                                                             | The canvas makes it the one choice besides the name.                                                                                                                              | yes          |
| D9  | **The avatar is picked, not uploaded:** one of the seven accents (`AccentDto`) and one of six pixel patterns.                                                                                                                                                                                                                                                         | No media storage needed.                                                                                                                                                          | yes          |
| D10 | **Starter caps:** 5 AUSD per trade, 20 AUSD per day, 1× leverage. Bounds: per trade and per day within `SPEND_BOUNDS`, leverage within `LEVERAGE_BOUNDS`.                                                                                                                                                                                                             | Small on purpose for a first agent.                                                                                                                                               | yes          |
| D11 | **AI credits are display only here.** The pill reads "AI CREDITS · Soon"; the modal explains what is coming; "Add credits" is disabled.                                                                                                                                                                                                                               | Credits are a growth-strategy spec of their own.                                                                                                                                  | yes          |
| D12 | **Transfers generalize deposits.** One prepare/confirm pair moves AUSD or MON between the master wallet and one of the person's agent wallets, in either direction, with the same checks the AUSD deposit has today.                                                                                                                                                  | "Fund from master" and "Pull back to master", for both tokens.                                                                                                                    | yes          |

## 3. User flows

### 3.1 First agent

1. `/studio` with no agents opens the create screen. The rail is disabled ("After you create
   your agent").
2. The person types a name. The handle follows the name (editable), checked against
   `GET /v1/handles/:handle/availability`. They pick an avatar (accent and pattern) and a voice.
   "It reads" shows Perpl (fixed) and Web (off by default; when on: Anywhere, Prefer these, Only
   these, and up to 20 bare hostnames).
3. "Advanced settings" is collapsed. Opened, it shows thesis, enters when, exits when, never (each
   with a working default) and risk (the starter caps, with − and +).
4. The wallet panel reads "STEP 0 · CREATE IT". "Create its wallet · 2 signatures" opens the sheet:
   step 1 creates the wallet (Touch ID), step 2 creates the delegated user ("Let Pickler trade from
   it? · inside the caps only · never withdraw", Touch ID). Cancelling step 2 keeps the wallet; the
   next press starts at step 2.
5. The panel shows the wallet's address, AUSD · trades, MON · gas, caps, "MIN TO START 10 AUSD ·
   0.5 MON", arrivals, and "Refresh". "Fund from master wallet" opens the Wallets modal on this
   wallet: pick AUSD or MON, an amount, one passkey per token. Or the person sends from any Monad
   wallet to the address and refreshes.
6. "Create {name}" is enabled once the name, a free handle, a voice, the wallet and both minimums
   are there. Its label says what is missing otherwise ("Name it to create", "@x is taken", "Pick
   a voice to create", "Create its wallet first", "Deposit to create").
7. Pressing it opens the sheet "Create {name}? · Sets its caps · 5 / 20 AUSD · 1×". One Touch ID.
   The server re-reads the balances, the policies are created, the draft is created and linked
   to the wallet. The studio home for the new draft opens.
8. The draft's home shows its wallet (AUSD, address, Copy, "Fund from master", "Pull back to
   master", both opening the Wallets modal of §3.3 on it), and Go Public counts what create
   already did: Voice, Its wallet and Fund it are ticked; Connect X stays Soon. A draft from
   before this flow has no wallet and says so. A live agent's wallet card also offers "Pull back
   to master".

### 3.2 Later agents

"+ New agent" opens the same screen. The wallet panel offers "Create its wallet" with one Touch
ID (the delegated user exists). The rest is identical.

### 3.3 Wallets and AI credits modals

- The top bar shows the master wallet's AUSD | MON (opens Wallets) and "AI CREDITS · Soon"
  (opens AI credits).
- Wallets: the master wallet (address, AUSD, MON, copy) and each agent wallet (name, address,
  AUSD, MON, caps if linked, tag NO WALLET / CREATING / DRAFT / LIVE, "Fund from master", "Pull
  back to master"). A transfer is one token, one amount, one passkey sheet. "MAX" fills what the
  source holds; on MON it keeps 0.01 MON back for the network fee.
- AI credits: what credits will be; the button disabled.

## 4. API

Bodies follow their route family as it is today: `/v1/studio/*` answers bare JSON and errors as `{ error, message, detail? }`; `/v1/signing/*` keeps its envelope (conventions: known envelope exceptions). Money in JSON: base units as
decimal strings, `ausdMicro` (micro-AUSD) and `monWei` (wei).

### 4.1 Changed

| Method | Path                                                   | Change                                                                                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/signing/agents/wallet/prepare`                    | Body `{}`; no handle. Wallet name `Agent wallet N` (N = the person's agent wallets + 1). An unlinked wallet from an earlier attempt answers `existing`, as today.                                                                                                                                                                               |
| POST   | `/v1/signing/agents/wallet/confirm`                    | Body `{ signed }`; no handle.                                                                                                                                                                                                                                                                                                                   |
| POST   | `/v1/signing/agents/wallet/:walletId/policies/prepare` | Before building anything, reads the wallet's balances; below either minimum answers `409 wallet_underfunded` (the signing envelope's lowercase code) with `detail: { ausdMicro, monWei, minAusdMicro, minMonWei }`, and `503 balances_unavailable` when the chain cannot be read. A wallet already linked to an agent is `409 wallet_assigned`. |
| POST   | `/v1/studio/drafts`                                    | New body (below). No `previewRunId`.                                                                                                                                                                                                                                                                                                            |

`POST /v1/studio/drafts` body:

```json
{
  "name": "Halftime",
  "handle": "halftime",
  "voice": "analyst",
  "avatar": { "accent": "lime", "pattern": 0 },
  "sources": { "web": { "mode": "prefer", "sites": ["coindesk.com"] } },
  "brief": { "thesis": "...", "entersWhen": ["..."], "exitsWhen": ["..."], "never": ["..."] },
  "caps": { "perTradeAusd": 5, "perDayAusd": 20, "maxLeverage": 1 },
  "walletId": "<turnkey wallet id>"
}
```

`web: null` means the web is off. The server reads both balances on chain just before the
transaction (a chain read cannot be part of a database transaction, and holding row locks across an
RPC call buys nothing), then, in one transaction: validates the brief, sources, caps and handle;
checks the wallet is the person's, `kind = 'agent'`, not linked, and has approved policies; checks
that reading against the minimums; creates the draft (config with `brief`,
`voice`, `sources`, `spend`, `maxLeverage`, Perpl), writes the profile (accent, avatar pattern, voice name)
and links the wallet in `wallets.agent_wallets` with the approved policy ids. Answers `201 { productId,
agent }`.

Errors: `400 INVALID_BRIEF` (`{ error, field, reason }`, the shape the brief UI already reads), `404 WALLET_NOT_FOUND` (absent or another
person's), `409 WALLET_ASSIGNED`, `409 POLICIES_MISSING`, `409 WALLET_UNDERFUNDED`,
`409 HANDLE_TAKEN`, `409 UNFUNDED_AGENT` (another agent or draft's wallet is below the minimum),
`409 DRAFT_LIMIT` (as today), `400 INVALID_INPUT` (an unknown voice or avatar, caps or leverage out
of bounds, or a body the schema refuses), and `503 WALLETS_UNAVAILABLE` when Turnkey or the RPC is
not configured or the chain cannot be read, this wallet's or any other agent's the lock reads (an
unreadable balance is never reported as underfunded).

### 4.2 New

| Method | Path                                   | Auth   | Request                                                                                                      | Response                                                                                                                                                                     |
| ------ | -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/studio/wallets`                   | studio | —                                                                                                            | `{ master: { address, ausdMicro, monWei }, agents: [{ walletId, address, ausdMicro, monWei, agentId \| null, agentName \| null, caps \| null, policiesApproved }], readAt }` |
| POST   | `/v1/studio/wallets/transfers/prepare` | studio | `{ from: "master" \| walletId, to: "master" \| walletId, token: "AUSD" \| "MON", amount: string }` (decimal) | the unsigned `sign_transaction` activity, plus `{ baseUnits }`                                                                                                               |
| POST   | `/v1/studio/wallets/transfers/confirm` | studio | the same body plus `{ signed }`                                                                              | `{ txHash }`                                                                                                                                                                 |

Transfer rules: exactly one side is `master`, the other an agent wallet of the same person;
amount > 0 and at most what the source holds; the signer is the source's address; the person's
passkey (root) stamps it. Confirm runs the deposit's checks generalized to both tokens: chain id,
token contract (AUSD) or native value (MON), recipient, exact amount, gas bound, fee bound,
nonce, the rebuilt activity compared byte for byte, the signed transaction's signer; then
broadcast, forget the cached balances of both sides, and record the transfer. A repeated confirm
answers `409 TRANSFER_ALREADY_RECORDED`. Errors also: `404 WALLET_NOT_FOUND`, `400
INVALID_TRANSFER`, `409 INSUFFICIENT_FUNDS`, `409 INSUFFICIENT_GAS` (the source's MON does not cover
the fee, plus the amount for MON), and the deposit's fee and nonce errors.

The existing `POST /v1/studio/agents/:id/deposit/prepare|confirm` (used by the studio home's deposit
sheet) stay as they are; they and the transfers share one extracted stamped-transfer check, and
deposits keep recording in `wallets.deposits` only.

### 4.3 Deleted

`POST /v1/studio/agents` (create with a wallet, `/studio/new`) and `POST /v1/studio/agents/draft`
(model drafting, `/studio/new`), once the plan confirms nothing else calls them.

DTOs live in `packages/api-schema` (studio), rules in `packages/core`.

## 5. Data model and migrations

One migration, named `agent_wallet_transfers_and_avatar` (number assigned at build time):

- `wallets.transfers`: `id uuid pk`, `user_id uuid not null`, `from_wallet_id text not null`,
  `to_wallet_id text not null`, `token text not null check in ('ausd','mon')`, `amount numeric(78,0)
not null check > 0` (micro-AUSD or wei), `tx_hash text not null unique check
~ '^0x[0-9a-f]{64}$'`, `created_at timestamptz not null default now()`. RLS enabled, index on
  `user_id`.
- `agents.agent_profiles.avatar_pattern smallint not null default 0 check between 0 and 5`.

Config (JSON, no migration): `voice` (one of the six keys), `maxLeverage` (existing field),
`spend`, `sources.web`. The draft's config is Perpl-shaped, as `perps-study-store.ts` writes it:
PERP tools, `perpl { network: "testnet", markets: ["BTC","ETH"] }`, `perpsPaper`, plugins
`["perpl","perps-paper"]` plus `"exa"` when the web is on. Running it from the studio depends on
`perpl-agent-runtime-v1`; drafts are created with the schedule off, as today.

Core constants: `VOICES` (key, name, sample), `AVATAR_PATTERNS` (six 16-cell strings),
`STARTER_CAPS`, `MIN_START_MICRO_AUSD = 10_000_000n`, `MIN_START_MON_WEI = 500_000_000_000_000_000n`,
the brief's defaults.

## 6. Integrations

- Turnkey: `CREATE_WALLET`, `CREATE_USERS` (delegated), `CREATE_POLICIES`, `SIGN_TRANSACTION`, all
  stamped by the person's passkey, forwarded as today (`turnkey-activity-forwarder`).
- Monad RPC (`MONAD_RPC_URL`): native and AUSD balances, nonce, fees, broadcast, through the
  `DepositChain` port widened to native transfers and balance reads.
- `@pickler/chain`: AUSD address and decimals, `CHAIN_ID`.
- `VENUE_CONTRACTS` stays empty until live trading: the policies are written with the structure but
  authorize no contract yet (as today).

## 7. Design work

Canvas: `Pickler Studio Empty v5.dc.html` (create phase, wallet panel, avatar picker, Wallets and
AI credits modals, passkey sheets). Dark studio surface, tokens only (`design-system-v2.md`).

States for the design harness (preview params, never in production): no wallet; wallet, not
funded; funded; advanced open; web on with sites; each passkey sheet phase (idle, busy, ok,
cancelled); the Wallets modal with a transfer open; the AI credits modal. Screens checked at
1400 and 390 px.

Copy rules: the wallet panel and the create sheet say what is true (D6): "It can only trade on
Perpl and can't withdraw. Pickler holds every trade to these caps."

## 8. Security and abuse

- Every wallet route checks ownership by `user_id`; another person's wallet answers 404.
- The server never trusts client balances or policy ids: it reads the chain and the stored
  approved policy ids.
- Transfers only between the person's master and their own agent wallets; the activity is rebuilt
  and compared byte for byte before forwarding, as deposits are.
- The delegated user can sign nothing until policies exist, and then only to venue contracts.
- Rate limits: the studio routes have no per-route limiter today; transfers get one only if
  `operations-v1`'s limiter exists when this is built.

## 9. Acceptance criteria and tests

- Core: brief validation (voice required, sources, caps within bounds), defaults, minimums,
  avatar pattern bounds.
- API: drafts refuses underfunded, another person's wallet, an assigned wallet, missing policies,
  a taken handle; succeeds and links the wallet; `GET /wallets` with a fake chain; transfers in
  both directions and both tokens, every refusal, the repeated confirm.
- Web: the pure logic of the screen (create enabled, its label, the footnote, the two-step sheet,
  the minimums, transfer amount validation), in the suite's style.
- Design harness: the new states pass `design:check` with no route blocked.
- End to end on staging (manual): sign up, create a wallet (two Touch IDs), fund 10 AUSD and 0.5
  MON from master, create an agent (one Touch ID), pull 1 AUSD back.

## 10. Rollout and dependencies

Order: core → migration and persistence → API → web (create screen, wallet panel, Wallets and AI
credits modals, avatar picker) → delete `/studio/new` and its routes. Known leftover: the web stops
calling `preview-runs`; its API routes, worker claim and tables stay for a separate cleanup. One branch, one PR, a commit
per reviewable block. No flag: the old creation flow is replaced in the same release.

Depends on: Turnkey and the RPC configured where it runs (as the deposit already requires).

## 11. Out of scope

- Go Public and the X verification: a section of the studio once the agent exists and is created.
- AI credits (balance, top-up, charge per run): their own spec.
- Live trading and the venue contracts in the policies.
- Editing caps after creation (the studio's Limits section).

## 12. Open questions for the owner

None blocking. The minimums (10 AUSD, 0.5 MON) are a guess to revisit once staging measures gas.

Known leftovers after the build:

- `preview-runs` (API routes, `PostgresPreviewStore`, the research worker's preview claim,
  `pickler.preview_runs` and `preview_events`) is unused by the web after this change. Remove it
  in a separate cleanup.
- Perpl-shaped drafts depend on `perpl-agent-runtime-v1` to run.
- The deposit routes were not rewrapped as transfers (they share `checkStampedTransfer`).
- The balances are read just before the create's transaction, not inside it, so a pull-back
  between the read and the insert can leave a new draft below the minimums. Accepted (§4.1): it is
  the owner's own money on a paper draft, and the schedule's own funding lock still applies.
- Core's `assertPreviewAdoptable` (the only source of `RUN_STALE` and `PREVIEW_UNUSABLE`) is used
  only by its test; it goes with the preview-runs cleanup. The web no longer has messages for
  those codes or for `PREVIEW_RATE_LIMITED` and `PREVIEW_UNAVAILABLE`.
