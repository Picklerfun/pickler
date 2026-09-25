# Create an agent, watch it think, fund it

The studio's job is to take a sentence — "Calls NFL games off injury news before the lines move" —
and turn it into an agent with a wallet that has made its first call. This specification covers
that journey end to end, as the three canvases draw it (`Pickler Studio Handoff`, `Pickler Create
First Agent v2`, `Pickler Studio v5`), and stops where the runtime stops: the first run is on paper,
the agent is funded, the schedule can be turned on. Making it public, talking to it, and a token
are separate work (§10).

It is sub-projects **A + C** of the studio work: creation with the first run, and the agent's
wallet with funding. They are one specification because the wallet is created in the same
ceremony as the agent, and the canvas is right to draw them together.

---

## 1. The name

The studio is called `console` in the code and the URL, and `studio` everywhere a person reads:
the host (`studio.pickler.fun`, `product-hosts-v1.md`), the middleware (`STUDIO_SEGMENTS`,
`studioHref`), the design canvases. `console` is the Relayer wireframe's name for it.

**Rename first, in all three layers**, before any of the flow below is built, so the new work is
born with the right name:

| Layer | Now                                                                                             | After                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| URL   | `/console`, `/console/...`                                                                      | `/studio`, `/studio/...` (the studio host's `/` rewrites here)                             |
| API   | `/v1/console/*`                                                                                 | `/v1/studio/*`                                                                             |
| Code  | `features/console/`, `consoleRoutes`, `ConsoleDirectory`, `ConsoleAccess`, `console.module.css` | `features/studio/`, `studioRoutes`, `StudioDirectory`, `StudioAccess`, `studio.module.css` |

The design harness's routes, the middleware's segment set, the tests and every `AGENTS.md` follow.
Nobody has launched, so no redirect from the old path is kept.

---

## 2. The flow

```
Describe ─┬─► Got it (auto set-up) ─┐
          │                         ├─► Review ─► Create + wallet (passkey) ─► First run, on paper ─► Studio home
          └─► Name › Trades › Calls › Reads › Skills › Decides ─┘
```

Both paths end at the same review. Every screen is reachable by URL (`/studio/new?step=…`) so the
design harness can measure each one, and by the Tweaks-panel equivalent the canvas offers.

### 2.1 Describe → Got it

One sentence, three example prompts. "Set it up from my line" calls a new endpoint:

```
POST /v1/studio/agents/draft   { line: string }   →   AgentDraft
```

The endpoint asks **the runtime's own model** (same `MODEL_*` configuration the research worker
uses) for a structured answer, validated against a zod schema:

```ts
interface AgentDraft {
  name: string; // ≤ 40
  handle: string; // suggested; availability checked separately
  venues: ("polymarket" | "perpl")[];
  beat: BeatName; // Sports · Crypto · Politics · Economics · Culture · Tech
  subcategories: string[]; // e.g. ["NFL"]
  sites: string[]; // hostnames the agent should read
  skills: string[]; // names from the suggested list for that beat
  edge: string; // one sentence, ≤ 400
  style: "careful" | "balanced" | "bold";
  accent: Accent; // from the beat's colour, editable
}
```

The core port is `AgentDrafter { draft(line): Promise<AgentDraft> }`; the infrastructure adapter
calls the model with a JSON schema; the route validates and returns. **A model failure returns
`503 DRAFT_UNAVAILABLE`** and the screen offers "Or build it step by step" — the manual path is the
fallback, never a regex guess dressed as the model's answer.

The _Reading your line_ screen reveals the draft's fields one by one. The reveal is a fixed rhythm
on the client over a draft that has already arrived (620 ms per field, as the canvas); streaming
per field is not worth its cost for one request that takes a few seconds.

### 2.2 The seven steps

`name`, `trades`, `looks` (Calls), `reads`, `skills`, `decides`, `review`, with the progress rail.
Each step's "ready" rule is a pure function, ported from the canvas's `ok(step)`:

- name: name non-empty, handle matches `^[a-z0-9_]{3,15}$` **and is available**
  (`GET /v1/handles/:handle/availability`, exists).
- trades: at least one venue that is not "Soon".
- looks: a beat with ≥ 1 subcategory; Perpl pairs when Perpl is on.
- reads: web off, or mode `anywhere`, or ≥ 1 site.
- decides: edge non-empty.

### 2.3 What is on the map, and what can run

The runtime decides on **Polymarket, sports, and in depth only NFL** (`nfl-winner-v1`). The form
shows the whole map the canvas draws, and marks what cannot run yet as **Soon**, not selectable:

- Venues: Polymarket live; **Perpl — Soon**.
- Beats: **Sports** live (NFL, NBA, MLB, Soccer, NHL, Tennis as the catalogue lists them);
  Crypto, Politics, Economics, Culture, Tech — **Soon**.

A draft from the model that lands on a Soon item arrives at the review with that row flagged, and
"Create and run it once" stays off until the person changes it. Nothing is created that cannot
decide.

---

## 3. What creation collects, and where it goes

Every field the canvas asks for, traced to its destination. "New" means a column or config field
that does not exist today.

| Field (canvas)                                     | Destination                                                                                                                            | Status |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Name, handle                                       | `agents.agents.name / handle`                                                                                                          | exists |
| Trades on                                          | `agent_profiles.venue` (public). Perpl is Soon, so today always `predictions`                                                          | exists |
| Calls: beat + subcategories                        | `config.marketScope { category: "sports", subcategories }`                                                                             | exists |
| Reads: web on/off, anywhere / prefer / only, sites | **new** `config.sources.web: { mode, sites: string[] } \| null`; `searchWeb`/`readPage` in `tools` follow `web on`                     | new    |
| Reads: open full pages                             | `readPage` in `tools`                                                                                                                  | exists |
| Reads: sports data, odds + books (NFL only)        | plugins `balldontlie`, `the-odds-api`; **new** `config.sources.books: string[]`                                                        | partly |
| Skills, suggested and written                      | **new** `config.skills: { name: string; prompt: string }[]` (≤ 8, prompt ≤ 600)                                                        | new    |
| Decides: edge                                      | `config.profile` — the brief **is** the edge; skills are appended to it at run time, not stored in it                                  | exists |
| Decides: Careful / Balanced / Bold                 | `config.uncertaintyPolicy`, three presets (§3.1)                                                                                       | exists |
| Accent, blurb, X handle                            | `agent_profiles` (written at creation since Task 3 of the marketplace plan). Accent defaults from the beat; blurb defaults to the edge | exists |
| Interval                                           | not asked; `intervalHours` default 6, set when the schedule is turned on                                                               | exists |

### 3.1 The three styles

The handoff left Careful and Bold without numbers. Decided here:

| Style    | `minProbabilityMargin` | `maxProbabilityRangeWidth` | Reads as                                             |
| -------- | ---------------------- | -------------------------- | ---------------------------------------------------- |
| Careful  | 0.08                   | 0.15                       | Only calls with a clear edge. Passes a lot.          |
| Balanced | 0.04                   | 0.20                       | Calls when its view sits clearly away from the price |
| Bold     | 0.02                   | 0.30                       | Calls more often, with thinner edges.                |

`blockHighUncertainty` and `requireCompleteInformation` stay `true` for all three. Balanced is
stricter than the code's current default margin (0.01), on purpose: the default was a research
setting, not a product one. The preset is derived from the policy when the agent is read back
(closest match), so an agent edited by hand elsewhere still shows a style.

### 3.2 How the runtime reads the new fields

- `sources.web.mode = "only"` requires an **allow-list in the Exa adapter**: search restricted to
  the listed domains, `readPage` refusing any other host. `prefer` passes the list as preferred
  domains and falls back to the open web. `anywhere` ignores the list. The adapter change is part
  of this specification because the promise "never reads outside this list" is made on the screen.
- `sources.books` filters the odds plugin's providers.
- `skills[]` are appended to the brief as numbered rules when the run's prompt is built. They are
  stored separately so the screen can show them as cards and the person can remove one.

---

## 4. Create + wallet, with the passkey

"Create and run it once" does three things in order, and the screen shows each as a line of the
first run's trace.

### 4.1 The wallet, its policies, and the link

**Decided:** every signature in this ceremony is the person's passkey, from the browser. Pickler's
key in the sub-organization is a **delegated user** — non-root, created by the person, with no
rights except what each wallet's policies grant it. The person's passkey stays the only root and
can revoke the delegated user at any time. This is Turnkey's "agentic wallet" model, set up
client-side, which its documentation recommends over the server-side variant precisely because
the delegated user is never root, not even for a moment.

A wallet existing is not the same as a wallet belonging to an agent. The link is made only after
the wallet's policies are approved, and the agent is created only after the link. Three activities,
in order, each stamped by the passkey:

1. **`createWallet`** — the agent's wallet, `walletName: <handle>`, one Monad account.
2. **`createPolicy` × 3** — the wallet's rules, which the person approves by signing them:
   - **Trade only, from this wallet, to the venue.** `EFFECT_ALLOW` for the delegated user,
     `activity.action == 'SIGN' && wallet.id == '<WALLET_ID>' && eth.tx.to in [<venue contracts>]`.
     Today the list holds Polymarket's contracts; Perpl's are added when Perpl exists. An empty
     list is a valid policy: the delegated user can then sign nothing, which is the paper-only
     state this specification ships in.
   - **Never a transfer out.** `EFFECT_DENY` for the delegated user on any transaction whose
     calldata starts with the ERC-20 `transfer` selector (`eth.tx.data[0..10] == '0xa9059cbb'`)
     or `approve` (`0x095ea7b3`), from this wallet. DENY overrides ALLOW in Turnkey's engine, so
     this holds whatever the allow list says. "It can never withdraw on its own" is this line.
   - **Only root changes the rules.** A DENY on `activity.resource == 'POLICY'`: no user but the
     root may create, update or delete policies. Signing and wallet policies have no order in
     Turnkey — any matching DENY beats every ALLOW, and the root quorum is not bound by policies at
     all, which is what lets the passkey recover funds. (An earlier draft said this policy had to
     sit at `order: 0`; that ordering applies to MFA policies, not these.)
3. **The link** — the API records the wallet, its account, and a row in
   **`wallets.agent_wallets (agent_id, wallet_id, policy_ids text[])`**, one wallet per agent, one
   agent per wallet. No policies, no link; no link, no agent.

The delegated user itself is created **once per sub-organization**, in the first agent's ceremony,
with Pickler's P-256 public key (`TURNKEY_API_PUBLIC_KEY`) as its API key, `userName: "Pickler"`,
and one more policy: it may delete itself, and nothing else, so a compromised key can be cut fast
without the person present. Its user id is stored on `wallets.turnkey_orgs`.

Two cases, and only two, because the sub-organization is born **only** here — there is no other
screen that creates one:

- **First agent.** The passkey ceremony that exists
  (`POST /v1/signing/passkeys/challenge` → WebAuthn → `register`) creates the sub-organization
  with the root user (the passkey), the delegated user (non-root, in `users`, not `rootUsers`),
  and **two wallets** — `Master Wallet` and the agent's. Then the policy activities of step 2 are
  stamped. **Four prompts** on the first agent — register, delegated user, wallet, policies — because
  `createSubOrganization` takes one wallet and only root users, and Turnkey has no batch-activity
  endpoint. The screen draws them as a four-step rail so none reads as a repeat.
- **Every later agent.** The sub-organization and the delegated user exist. Steps 1–3 run as
  above: two prompts.

A sub-organization with no linked agent is therefore never a state a person arrives at on purpose:
it is a first creation that failed between the wallet and the link, and §4.2's retry is what
resolves it — it finds the wallet by name, checks which of the three policies exist by their
intent (Turnkey's `fetchOrCreatePolicies` compares the full intent, so re-approving is
idempotent), asks for the missing ones, and links.

**This is a change.** Today the enrolment ceremony (`register`) is reachable from `/passkey`, and
`PasskeyFlow` is rendered by the signup and signin pages as well, so a person can create a
sub-organization with a master wallet and no agent. Under this specification `register` is called
from exactly one place — the first agent's "Create and run it once" — and `/passkey` keeps only
what it should have: adding a passkey to a sub-organization that exists (`prepareAddPasskey` /
`confirmAddPasskey`) and listing devices. The signup and signin pages stop rendering the
enrolment half of `PasskeyFlow`. Everything begins from zero, in one place.

**What this changes in the trust model, stated plainly.** Until now Pickler held no key that could
sign anything in a person's sub-organization. After this, it holds one that can sign _trades from
an agent's wallet to the venue_ and nothing else, and only once the venue list is non-empty. The
paper-only runs of this specification never use it. The person's passkey is the only root; the
screen says "Secured by your passkey", and it says what Pickler's key may do in the deposit sheet,
next to "It can never withdraw on its own".

### 4.2 The agent, second

`POST /v1/studio/agents` as it is after marketplace Task 3, with the config of §3. The request
carries the `walletId` whose policies were just approved; the create transaction writes the
`agent_wallets` row. Order matters:

- Wallet or policies fail → nothing is created; the screen says which step, and offers to retry
  the passkey.
- Agent fails after the wallet exists → the wallet sits in the sub-organization unlinked. The retry
  (same idempotency key) finds a wallet named for the handle with no `agent_wallets` row and
  links it rather than creating a second one. The name is the handle for exactly this reason.

### 4.3 The first run, third

`POST /v1/studio/agents/:id/runs` (exists) with `Idempotency-Key`. The screen polls
`GET /v1/studio/runs/:id/events` every 1.5 s until the run's status is terminal, and draws each
event as a trace line. The first line — "Created its wallet with your passkey · 0x7a3f…" — is an
event the **API** appends when it links the wallet, so the trace starts before the runtime does.

**Every run is on paper.** When a run completes with `decision.action === "TRADE"`, the studio
creates the paper order for it (`POST /runs/:id/paper-order` exists and is idempotent by run; the
person is watching the first run, so the client trigger covers it — a runtime hook for scheduled
runs is a follow-up). The pick card shows the range against the market price and
"TRACKED ON PAPER · size AT price".

**When no runner is listening.** In development the research worker may not be running; the run
stays `queued`. After 20 s without a `running` status the screen says "Waiting for a runner" with
the command to start one, instead of spinning. In deployment the queue always has a consumer.

---

## 5. The studio home, after the first run

Studio v5's home, limited to what this flow needs. Everything else on that canvas (chat, face,
voice, X, publish) is §10.

- **Status pill:** WORKING (a run is live) · FIRST CALL IN (done, schedule off) · LIVE (schedule
  on).
- **Live strip:** the run's steps, collapsible; "First run finished in 2m 11s · 8 steps, 6 sources"
  from the run's `startedAt`/`finishedAt` and its events.
- **The agent:** mark, mood line (THINKING / RESEARCHING / PICKED / WAITING) and the "say" line —
  all derived from run status and the last event, by a pure function with a test per state.
- **Its wallet:** balance, address, copy, Deposit (§6).
- **Run on its own:** the schedule switch with the interval picker (3h / 6h / 12h / daily) and the
  two locks of §6.3.
- **Picks:** empty → looking (range forming) → done (range, market, paper tag, "Full reasoning →"
  to the existing pick detail).
- **Next up:** one item today, "Fund its wallet".
- **Menu:** "+ New agent" with its lock (§6.3); the groups link to the sections that exist.

---

## 6. Funding, limits and locks

### 6.1 Balance

The API reads `balanceOf(AUSD, agentAddress)` on Monad testnet over JSON-RPC and caches it 15 s
per address. The AUSD contract address lives in `@pickler/chain` beside the chain metadata. The
balance is a display figure in AUSD; the ledger's micro-USD is separate and unchanged.

### 6.2 Deposit

Master wallet → agent wallet, an ERC-20 `transfer` on Monad:

1. `POST /v1/studio/agents/:id/deposit/prepare { amount }` — the API builds the unsigned
   transaction (nonce, gas, calldata) from the master account and returns it with the master's
   `walletId`.
2. The browser signs it with the passkey (`signTransaction` in the sub-organization).
3. `POST /v1/studio/agents/:id/deposit/broadcast { signed }` — the API broadcasts, records the
   hash, and the balance cache is invalidated.

Amounts 10 / 25 / 50 / 100 AUSD, as the canvas. "Or send AUSD on Monad to the address above" is
also true and needs nothing: the balance read sees it.

### 6.3 Limits and locks

- **Max per call / max a day** → `BudgetLedger.configure(agentId, limits)` (exists), amounts
  converted to micro-USD. Shown in the deposit sheet as the canvas draws them.
- **Schedule lock:** the switch turns on only when the runtime's `NOT_READY` is clear (one
  successful manual run — exists) **and** the agent's balance ≥ 10 AUSD. Below that, the switch is
  locked with "Fund its wallet · min. 10 AUSD".
- **"+ New agent" lock:** enabled only when every agent the person owns has balance ≥ 10 AUSD.
  "One unfunded agent at a time."

Both locks are pure functions in core over `(status, balance)` / `(balances[])`, tested, and the
API answers them in the agent's DTO (`canSchedule`, `canCreateAnother`, each with a `reason`) so
the screen never re-derives the rule.

**The agent never withdraws.** Because the wallet's DENY policy (§4.1) refuses any ERC-20
`transfer` or `approve` signed by the delegated user, in the enclave, whatever else is allowed.
The master wallet recovers an agent's funds with the passkey — the root is not bound by the
delegated user's policies; that screen belongs to the account work, not here.

---

## 7. The runtime, locally

`workers/research` runs with `MODEL_BASE_URL`, `MODEL_ID`, `MODEL_API_KEY`, `EXA_API_KEY`,
`BALLDONTLIE_API_KEY`, `THE_ODDS_API_KEY` in its `.dev.vars` (names in `.dev.vars.example`; values
never in a chat or a commit). The draft endpoint (§2.1) uses the same `MODEL_*` on the API worker.
Without them the studio still builds and every screen still renders; the draft returns
`DRAFT_UNAVAILABLE` and runs wait for a runner, and both say so.

---

## 8. Data model changes

- `config.sources: { web: { mode: "anywhere" | "prefer" | "only"; sites: string[] } | null; books: string[] }`
  and `config.skills: { name; prompt }[]` on `AgentConfig` (core), validated in
  `assertConfig`, mirrored in `api-schema`.
- `wallets.agent_wallets (agent_id uuid pk → agents.agents, wallet_id text unique → wallets.wallets.wallet_id, policy_ids text[] not null, created_at)`.
- `wallets.turnkey_orgs.delegated_user_id text null` — the Pickler user inside the person's sub-organization, set in the first agent's ceremony.
- `wallets.deposits (id, agent_id, tx_hash unique, amount_micro_usd, created_at)` — the record of
  what the person sent, for the strip and for support.
- No settlement, no follows, no token: unchanged from the marketplace specification.

---

## 9. Testing

- **Pure, in core:** step readiness for all seven steps; the three presets both ways (style →
  policy, policy → closest style); the two locks; the mood/say derivation per run state; the
  brief composition with skills appended.
- **Database, in infrastructure:** `agent_wallets` uniqueness both ways and a non-empty
  `policy_ids`; wallet → policies → link → agent ordering, including the retry that finds an orphan
  wallet by name and re-approves only the missing policies; deposit recording.
- **Policies, against Turnkey's policy engine in a test sub-organization:** the delegated user can
  sign to a listed venue address, cannot sign an ERC-20 `transfer` or `approve` from the agent's
  wallet, and cannot create a policy. Three activities, three expected outcomes, recorded like the
  custody spec's Turnkey validation.
- **Routes, in workers/api:** `/draft` with a fake `AgentDrafter` (and the 503 when it throws);
  create with `walletId`; deposit prepare/broadcast with a fake RPC; the DTO's `canSchedule` /
  `canCreateAnother` reasons.
- **Exa adapter:** `only` mode refuses a host outside the list; `prefer` falls back.
- **Web:** the pure pieces (`draft.ts` successors) as today; the design harness gets a route per
  creation step (`/studio/new?step=…`) and per home stage (`?stage=live|researching|decided`),
  each proving its own selector, so every state the canvas reaches is measured.
- **One real agent:** created through this flow on the local stack with the runner up, its first
  run's trace real, its paper order real, its balance read from the chain after a testnet deposit.
  Recorded in a Validation section like the marketplace's.

---

## 10. Not in this specification

Perpl and every beat but sports (Soon on the map). Talking to the agent ("Ask Halftime"). Making
it public: face, voice presets (a model call), the X account, publishing. The token. Live trading — the
delegated user exists after this work, with an empty venue list; filling it is the trading work. Withdrawing an agent's funds back to the master.
Chain and quote-asset questions the handoff lists as open (Polymarket settles in USDC on Polygon;
paper trading sidesteps it for now).
