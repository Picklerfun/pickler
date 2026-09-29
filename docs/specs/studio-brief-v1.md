# Studio brief v1: write it, run it on paper, then create it

Status: approved design, 2026-09-28. Sub-project 1 of the "Pickler Studio Empty v4" canvas
(Claude Design project `c03aadb4-7bb2-429e-aa49-98ae4218bc1f`, file `Pickler Studio Empty v4.dc.html`).
Builds on `studio-create-and-fund-v1.md`. The canvas's visual base is already in the tree (commit
`ef63752`, `apps/web/src/features/studio/home/empty.tsx`); this makes it real.

## 1. What changes, in one paragraph

A person with no agents lands on `/studio` and writes a **brief**: a thesis, what it reads, when it
enters, when it exits, what it never does, and its risk caps. **"Run it on paper"** runs the real
runtime once on that brief without creating anything. **"Create {Name}"** then creates the agent as
a **private draft**, with no wallet and no passkey prompt, and that preview run becomes its first
run. Its wallet, policies (carrying the brief's caps), voice, X and funding come in **Go Public**,
which is the next sub-project. `/studio/new` stays as it is for later agents (§8).

Decisions taken with the person (2026-09-28):

- The brief becomes real product data that the runtime respects. It is not a mock.
- Scope of this sub-project: the brief plus creating on `/studio`, with the existing paper runtime.
  Forking a ranked agent and Go Public come later.
- `/studio` (brief) and `/studio/new` (the current flow) **coexist**.
- The canvas's order: run, then create. The wallet moves to Go Public.
- Anything the product does not support yet is shown as **"Soon"**, never faked.

## 2. The brief model

`AgentConfig` gains an optional `brief`. An agent created in `/studio/new` has none and behaves
exactly as today.

```ts
interface AgentBrief {
  thesis: string; // "why this edge exists, in plain words"; may be empty; ≤ 600 chars
  reads: string[]; // "one source per line"; ≤ 12 lines
  entersWhen: string[]; // "every line must be true"; 1–8 lines; required
  exitsWhen: string[]; // "the first line that turns true closes it"; ≤ 8 lines
  never: string[]; // "hard lines it will not cross"; ≤ 8 lines
}
```

- Each line is trimmed, blank lines are dropped (the canvas's `split('\n').map(trim).filter(Boolean)`),
  and each is ≤ 200 characters. The canvas sets no limits; these exist so a brief fits a prompt.
- `entersWhen` needs at least one line. It is the only required section, as in the canvas.
- Validation lives in core (`assertBrief`), next to `assertConfig`, and every write path uses it.

**Risk caps reuse `spend`.** `SpendLimits { perCallAusd, perDayAusd }` already exists with the
day ≥ call rule. The brief's caps write it:

| Canvas stepper | Field                                     | Min | Step | Default | Max                     |
| -------------- | ----------------------------------------- | --- | ---- | ------- | ----------------------- |
| PER TRADE      | `spend.perCallAusd`                       | 5   | 5    | 5       | 1 000 (`SPEND_BOUNDS`)  |
| PER DAY        | `spend.perDayAusd`                        | 10  | 10   | 20      | 10 000 (`SPEND_BOUNDS`) |
| MAX LEVERAGE   | `AgentConfig.maxLeverage` (new, optional) | 1   | 1    | 2       | 10                      |

- The day ≥ trade rule applies. The canvas does not check it; we do, and the stepper says why.
- The steppers enforce min and step in the UI; core enforces bounds and the day ≥ trade rule.
- `maxLeverage` is stored but applies only to perps, which are `SOON_VENUES`. The stepper is drawn
  with a **"Soon"** tag and cannot change.
- `SPEND_ENFORCED` becomes true for paper (§3.3). The DTO stops saying the caps are unenforced.

## 3. What the runtime does with it

### 3.1 The prompt

`composeBrief` grows from edge + skills to also carry the brief when there is one:

```
Thesis: …
It reads: 1. … 2. …
It enters only when every one of these is true: 1. … 2. …
It exits at the first of these that turns true: 1. … 2. …
It never: 1. … 2. …
Rules it follows: (skills, as today)
```

An agent without a brief gets exactly today's text. That is pinned by a test.

### 3.2 Entry rules decide the trade

The decision gains a structured evaluation of each rule, produced by the model and checked by the
policy layer:

```ts
brief?: {
  entries: { rule: string; fired: boolean; why: string }[]; // one per entersWhen line, same order
  exitArmed: string | null;                                  // the exitsWhen line it set, if any
  neverChecked: { rule: string; respected: boolean }[];
}
```

- The policy layer (`decision-policy.ts`) turns a `TRADE` into `NO_TRADE` unless **every** entry
  fired. It also does so if any `never` line is not respected. The reason is recorded, so the run
  shows which rule stopped it.
- A missing or misaligned `brief` block, such as a wrong count or a different order, is a failed
  decision. It is never read as "all fired".

### 3.3 Risk caps on paper

- A paper order's notional is capped at `spend.perCallAusd`.
- The sum of an agent's paper notionals per UTC day is capped at `spend.perDayAusd`. An order past
  it is refused with a reason (`DAILY_CAP_REACHED`), and the run shows it.
- These caps sit where `assertPaperAllowed` and the paper service already decide an order. Real
  money limits (Turnkey value caps) belong to Go Public and the trading work.

### 3.4 Sources

- `reads` lines are classified. A domain or URL becomes a `sources.web` site in "prefer" mode
  (Exa allow-list), within `MAX_SITES`.
- An `@account` (X) or a named feed is passed to the model as context and marked in the UI with
  **"Soon"**, because nothing ingests X or arbitrary feeds yet.
- The canvas's "a Perpl book" is replaced with sources the product reads. The visual base already
  does this.

### 3.5 Venue

The trade is on the markets the agent's configuration already supports, such as prediction markets
on paper. It is not "LONG BTC · 3×": perps are `SOON_VENUES`. The trade card shows our pick in our
format: outcome, market and size, capped by §3.3.

## 4. "Run it on paper": the preview run

A preview run is the real runtime, the same tools and the same policy, run once on a config that is
not an agent yet.

- `POST /v1/studio/preview-runs` with `{ brief, maxLeverage, spend }`. The server builds the config
  from `DEFAULT_CONFIG` plus the brief (§2, §3.4), validates it, and queues a run with **no agent row**.
  It returns `{ id }`.
- `GET /v1/studio/preview-runs/:id` returns the status and the trace events, in the same shape as a
  run's live trace, so the panel reuses the first-run trace code.
- Stored in its own table, keyed by user and workspace, with the config snapshot, the trace, the
  decision and a fingerprint of the inputs (§5). It expires after 24 h, and it cannot be read by
  anyone but its owner.
- **Rate limit:** 5 preview runs per user per rolling hour. Past it, 429 with the time the next one
  is allowed. Needs research access, like any run (`RESEARCH_ACCESS_DENIED` otherwise).
- It needs the model and data keys the first run needs. Without them it fails like a first run
  does, with the same messages.

## 5. The screen: the canvas made editable

The layout is the visual base (`ef63752`). What becomes real:

- **Name it:** the input and its `@handle` derivation follow the canvas: lower-case, `[a-z0-9_]`,
  up to 15. Validity uses the agent handle rules the API already applies. Availability comes from
  the existing agent-handle availability check, debounced; the canvas's mock TAKEN list goes away.
  The line colours follow the canvas: faint when empty, lime when OK, pink when taken.
- **The five sections** are textareas with the canvas's labels, subs and placeholders. Tags:
  "EMPTY", "YOURS" and "N LINE(S) · …". "ENTERS WHEN" gets its amber edge while empty.
- **START FROM:** "Blank" only, selected. "A ranked agent" carries **"Soon"** and links to `/agents`.
  Forking is a later sub-project.
- **RISK:** three steppers as in §2. The tag reads "STARTER CAPS", then "EDITED" once changed.
- **Run it on paper**, with the canvas's labels and rules:
  - Enabled with ≥ 1 entry rule and no run going.
  - "Write an entry rule to run it", then "Running", then "Run it again". "Brief changed · run
    again" when stale.
- **Paper run panel:**
  - States: IDLE, LIVE, DONE and STALE, as in the canvas.
  - The lines are the real trace events, drawn in the canvas's line style (dot, text, time), not
    its script.
  - The result card is "ITS TRADE" with our pick, or "STOOD DOWN · NO TRADE" with the rule that
    stopped it.
- **Stale:** a fingerprint of the thesis, reads, enters, exits, never, per-trade, per-day and
  leverage is taken when the run starts. Any change after that marks the run STALE. The server
  checks the fingerprint again at create.
- **Create {Name}:**
  - Enabled when the name is valid and free, a run is DONE and it is not stale.
  - Labels follow the canvas's priority: "Name it to create", "@x is taken", "Run it once, then
    create", "Create {Name}".
- **Footnotes** follow the canvas: "NOTHING GOES PUBLIC · IT RUNS ON PAPER UNTIL YOU FUND IT",
  "YOU CHANGED THE BRIEF SINCE THE LAST RUN", and "THE BRIEF STAYS EDITABLE IN THE STUDIO".
- **Access:** the disabled reasons come from `menuAccess`: research not enabled, view-only, and the
  unfunded-agent lock. The rail stays disabled with "After you create your agent".
- **The second-passkey callout** stays at the top of the brief column.
- **Phone width:** the rail becomes the Menu, as in the visual base. No horizontal scroll.

## 6. "Create {Name}": the private draft

- `POST /v1/studio/drafts` with `{ name, handle, previewRunId }` and the brief. The server:
  1. loads the preview run, checks it is the caller's, not expired, completed and not yet adopted;
  2. checks the fingerprint of the submitted brief against the run's, returning 409 `RUN_STALE` on
     a mismatch;
  3. checks the handle is valid and free, returning 409 `HANDLE_TAKEN`;
  4. in one transaction, creates the agent with the run's config snapshot and `status: draft`,
     `public: false`, no wallet; copies the preview run in as the agent's first run; and marks the
     preview run adopted.
- The existing `createGate` (`canCreateAnother`) still applies, over agents that have a wallet: a
  funded or unfunded agent is one with a wallet. **A draft does not count toward the funding
  lock.** It is private, has no wallet and runs on paper, and it cannot be funded until Go Public
  exists, so counting it would close "+ New agent" for good.
- Drafts are capped instead: at most **3 drafts per workspace** (`MAX_DRAFTS_PER_WORKSPACE`). The
  fourth is refused inside the create transaction with 409
  `{ error: "DRAFT_LIMIT", message: "At most 3 drafts at a time" }`, and `canCreateAnother` answers
  `{ ok: false, reason: "draft_limit" }` while three exist. `unfunded_agent` comes first when both
  hold. Creating an agent with its wallet (`POST /v1/studio/agents`) meets the funding lock only.
- A draft's first run counts as done for `canSchedule`, but scheduling still needs ≥ 10 AUSD,
  which needs a wallet, which comes in Go Public. So a draft cannot schedule. That is intended.
  A draft can still run manual paper research, like any unfunded agent ("IT RUNS ON PAPER UNTIL
  YOU FUND IT"); only scheduling waits for funds.
- **After create,** `/studio` shows the agent's home (Studio v5) with a "DRAFT · PRIVATE" chip in
  amber. The rail enables. A **Go Public** card lists the four steps (Voice, Connect X, Its wallet,
  Fund it), each marked **"Soon"** until the next sub-project builds them.

## 7. Errors

| Case                                                    | Answer                                     | Screen                                  |
| ------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| Brief invalid (no entry rule, too long, too many lines) | 400 `INVALID_BRIEF`, field and reason      | inline under the section                |
| Caps invalid (day < trade, out of bounds)               | 400 `INVALID_INPUT`                        | under RISK                              |
| Research not enabled                                    | 403 `RESEARCH_ACCESS_DENIED`               | the research reason from `menuAccess`   |
| Preview rate limit                                      | 429, with the time the next run is allowed | on the Run button                       |
| Model or data keys missing                              | the first run's existing failure           | in the panel, as the first run shows it |
| Stale at create                                         | 409 `RUN_STALE`                            | "Brief changed · run again"             |
| Handle taken at create                                  | 409 `HANDLE_TAKEN`                         | "@x is taken"                           |
| Preview expired or adopted                              | 409 `PREVIEW_UNUSABLE`                     | asks for a new run                      |
| Three drafts already                                    | 409 `DRAFT_LIMIT`, with a message          | the draft-limit reason on "+ New agent" |

## 8. What stays as it is

- `/studio/new`: description, draft by the model or 7 steps, review, create **with** the wallet
  ceremony, first run. Agents made there have no brief. The two creation paths converge in Go
  Public, where the wallet moves to the end for both.
- The wallet, policy and deposit code from `studio-create-and-fund-v1.md` is untouched. It is
  reused by Go Public.
- Existing agents, runs and schedules.

## 9. Not in this sub-project

- Forking a ranked agent (START FROM with real agents, scores and receipts).
- Go Public: voice, Connect X and its verification, the wallet with the brief's caps as Turnkey
  policies, and funding 100 AUSD.
- Leverage and perps: shown as "Soon".
- Ingesting X accounts or arbitrary feeds.

## 10. Testing

- **Core:**
  - `assertBrief`: limits, trimming, and the required entry rule.
  - Caps: bounds and day ≥ trade.
  - `composeBrief`: with a brief, and unchanged without one.
  - The policy: TRADE becomes NO_TRADE unless every entry fired, or when a never line is broken;
    a misaligned block fails.
  - Paper caps: per-call notional and the daily sum, including the UTC day boundary.
- **API:**
  - Preview runs: create, read with owner-only access, rate limit, and expiry.
  - Draft create: happy path; stale; taken; expired, adopted or someone else's; atomicity (a
    failure leaves no agent and the preview is not adopted).
- **Web:**
  - The handle derivation.
  - The fingerprint and staleness.
  - The button-label priority.
  - Tags.
  - Pure functions only, in the existing style. `apps/web/test` cannot import api-schema values.
- **Design checks:** 0 FAIL on the staged brief (`/studio?stage=empty`), plus new staged states for
  a running, a done and a stale run, and a created draft.
- **Real validation (the person):** with model and data keys, write a brief, run it, see which
  entries fired, create it, and see the draft home.

## 11. Deploy order

Apply migration 0017 (`npm run db:migrate`) before deploying the API, the research worker or the
local runner built from this work. Every research claim now reads `pickler.preview_runs` (runs and
previews share the execution limits), so a research worker on a database without 0017 fails every
claim.
