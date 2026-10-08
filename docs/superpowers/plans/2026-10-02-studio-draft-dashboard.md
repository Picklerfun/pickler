# Studio draft dashboard, Connect X and Go Public — Implementation Plan

> This is an archive of the non-X dashboard implementation. Current X code, configuration and
> tests are defined by [Studio X OAuth](../../studio-x-oauth.md); obsolete connection instructions
> have been removed. Do not replay this archive as a migration or deployment plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/specs/studio-draft-dashboard-v1.md`: the created (draft) agent's studio from the canvas `Pickler Studio Draft.dc.html`, read-only Connect X OAuth, and Go Public.

**Architecture:** Core holds the pure rules (`reviseDraft`, publish blockers). Infrastructure adds migration `0024_go_public`, the X/publish/identity/activity/ledger stores and an X API client. The API adds the routes of spec §4. The web adds `apps/web/src/features/studio/draft/`, a self-contained studio for draft agents (shell + sections), wired in `studio.tsx` when the selected agent is a draft; live agents are untouched.

**Tech Stack:** TypeScript, Hono (workers/api), Drizzle + pg (packages/infrastructure), zod (packages/api-schema), Next 16 / React 19 with CSS modules (apps/web), node:test via `node --import tsx --test`.

**The canvas:** raw file at `/private/tmp/claude-501/-Users-Juvenal-Development/782e2275-1584-4417-9ad8-9f6fd05e4e52/scratchpad/studio-draft.dc.html` (markup lines 321–846 are the "created" sections, logic from line 1045; `renderVals()` from 1265), and a style-stripped copy with canvas line numbers at `.../scratchpad/draft-markup.txt`. Copy (every visible string) comes from the canvas unless the spec overrides it (spec D5, D11, D12, D13, D15, D16).

**Repo rules (all tasks):** work only in `/Users/Juvenal/Development/Pickler/pickler-studio-draft`. Commit by path (`git commit -- <paths>`), never `git add -A`, never `git stash`/`reset --hard`/`checkout .`/`clean`. Never push. Run `npm run build:shared` after changing any package before testing dependants. Local Postgres for infrastructure tests is Docker on 127.0.0.1:55432 (already running; tests create isolated databases). Never touch the real Supabase. Match the surrounding code's style: comment density, naming, doc comments that say why. Design tokens only in CSS (`npm run design:source` must stay clean): use `var(--pk-*)` tokens, never raw hex. Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Checks every task runs before committing:** the task's tests, `npm run typecheck`, `npx eslint <changed files>`, `npx prettier --check <changed files>`, and `npm run check:architecture` when imports across packages change.

---

## File structure

**Core (`packages/core/src/features/studio/`)**

- Create `revise.ts`: `reviseDraft(config, patch)` — the draft config edit rules (spec D10).
- Create `publish.ts`: `publishBlockers(...)`, `PublishBlockedError`, `MIN_PUBLISH_AUSD_MICRO`.
- Modify `packages/core/src/index.ts`: export the above.
- Tests: `packages/core/test/studio-revise.test.ts`, ``studio-publish.test.ts`.

**Infrastructure (`packages/infrastructure/`)**

- Create `drizzle/0024_go_public.sql` (+ drizzle journal/snapshot entry following how 0023 was added).
- Modify `src/persistence/product/agents.ts`: `visibility`, `publishedAt`, `xChallenges`, `xAccounts`.
- Modify `src/persistence/agent-directory.ts`: the three `status <> 'draft'` filters → `visibility = 'public'`.
- Modify `src/studio/directory.ts`: list returns `visibility`, `publishedAt`, `xHandle`; add `updateIdentity`, `activity`, `publish`.
- Create `src/studio/ledger.ts`: `listTransfers(userId)`.
- Tests: `test/studio-go-public.test.ts` (Postgres), `test/x-client.test.ts`.

**API (`workers/api/`, `packages/api-schema/src/studio.ts`)**

- Schemas: `setupUpdateSchema`, `identityUpdateSchema`, `xStateResponseSchema`, `publishResponseSchema`, `activityResponseSchema`, `ledgerResponseSchema`; studio agent DTO gains `visibility`, `publishedAt`, `xHandle`.
- Modify `src/routes/studio.ts` (setup, identity, activity, x, publish), `src/routes/studio-wallets.ts` (ledger), `src/container.ts`, `src/env.ts`, `.dev.vars.example`.
- Tests: `test/studio-draft-routes.test.ts`, `test/studio-x-route.test.ts`.

**Web (`apps/web/src/features/studio/draft/`)**

- `model.ts` (pure): rail with locks, tiles, Go Public state, caps steppers, brief tags, sites editing, next runs.
- `fixture.ts`: staged draft studio for every `draft-*` stage.
- `draft-studio.tsx` + `draft.module.css`: top bar, rail, header, tiles, section switch, locked panel.
- `overview.tsx`, `go-public.tsx`, `x-connect.tsx`, `identity.tsx`, `limits.tsx`, `brief.tsx`, `sources.tsx`, `console.tsx`, `trades.tsx`, `trade-soon.tsx`, `master.tsx`.
- `use-draft.ts`: data hook (wallets, activity, X state, ledger) and the writes.
- Modify `../api.ts` (client functions), `../studio.tsx` (render `DraftStudio` for a draft), `../home/stage.ts` (stages), delete `../home/draft-wallet.tsx`, `../home/go-public.tsx`, `../home/go-public-model.ts` and their test, and the draft branches in `../home/home.tsx` and `../home/fixture.ts` that only they used.
- Tests: `apps/web/test/studio-draft-model.test.ts`.
- `scripts/design/routes.mjs`: the `draft-*` routes.

---

### Task 1: Core rules — reviseDraft and publish blockers

**Files:** create `packages/core/src/features/studio/{revise,publish}.ts`; modify `packages/core/src/index.ts`; tests `packages/core/test/studio-{revise,publish}.test.ts`.

- [ ] **Step 1: Write the failing tests.**

`studio-revise.test.ts` — build a config with `prepareDraft` (valid input: name "Halftime", handle "halftime", voice "analyst", avatar lime/0, sources `{ web: null }`, `DEFAULT_BRIEF`, `STARTER_CAPS`, walletId "w") then:

```ts
test("a brief revision normalizes like create and keeps everything else", () => {
  const { config } = prepareDraft(input);
  const next = reviseDraft(config, {
    brief: { thesis: "  BTC moves first ", entersWhen: [" a ", ""], exitsWhen: [], never: [] },
  });
  assert.equal(next.brief?.thesis, "BTC moves first");
  assert.deepEqual(next.brief?.entersWhen, ["a"]);
  assert.deepEqual(next.perpl, config.perpl);
  assert.equal(next.voice, config.voice);
  assert.equal("marketScope" in next, "marketScope" in config);
});
test("turning the web on adds exa and the web tools; off removes them", () => {
  const { config } = prepareDraft(input);
  const on = reviseDraft(config, { sources: { web: { mode: "prefer", sites: ["coindesk.com"] } } });
  assert.ok(on.plugins?.enabled.includes("exa"));
  assert.ok(on.tools.includes("searchWeb") && on.tools.includes("readPage"));
  const off = reviseDraft(on, { sources: { web: null } });
  assert.ok(!off.plugins?.enabled.includes("exa"));
  assert.ok(!off.tools.includes("searchWeb"));
});
test("caps keep create's bounds", () => {
  const { config } = prepareDraft(input);
  assert.deepEqual(
    reviseDraft(config, { caps: { perTradeAusd: 10, perDayAusd: 40, maxLeverage: 2 } }).spend,
    { perCallAusd: 10, perDayAusd: 40 },
  );
  assert.throws(() =>
    reviseDraft(config, { caps: { perTradeAusd: 50, perDayAusd: 10, maxLeverage: 1 } }),
  );
  assert.throws(() =>
    reviseDraft(config, { caps: { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 99 } }),
  );
});
test("an unknown voice is refused; a known one is set", () => {
  const { config } = prepareDraft(input);
  assert.equal(reviseDraft(config, { voice: "hype" }).voice, "hype");
  assert.throws(() => reviseDraft(config, { voice: "loud" as never }), /voice/i);
});
test("an empty patch is the same config", () => {
  const { config } = prepareDraft(input);
  assert.deepEqual(reviseDraft(config, {}), config);
});
```

The current OAuth rules and regression suite are documented in [Studio X OAuth](../../studio-x-oauth.md).

`studio-publish.test.ts`:

```ts
test("blockers name exactly what is missing", () => {
  assert.deepEqual(
    publishBlockers({ killed: false, walletLinked: true, ausdMicro: 10_000_000n }),
    [],
  );
  assert.deepEqual(publishBlockers({ killed: false, walletLinked: true, ausdMicro: 9_999_999n }), [
    "FUNDS",
  ]);
  assert.deepEqual(publishBlockers({ killed: false, walletLinked: false, ausdMicro: null }), [
    "WALLET",
  ]);
  assert.deepEqual(publishBlockers({ killed: true, walletLinked: false, ausdMicro: null }), [
    "KILLED",
    "WALLET",
  ]);
});
test("the minimum is the schedule's 10 AUSD", () => {
  assert.equal(MIN_PUBLISH_AUSD_MICRO, 10_000_000n);
});
```

- [ ] **Step 2: Run them and see them fail** — `npm run build:shared >/dev/null; node --import tsx --test packages/core/test/studio-revise.test.ts packages/core/test/studio-publish.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement.**
  - `revise.ts`: `export interface DraftPatch { brief?: { thesis: string; entersWhen: readonly string[]; exitsWhen: readonly string[]; never: readonly string[] }; sources?: { web: { mode: WebMode; sites: readonly string[] } | null }; caps?: { perTradeAusd: number; perDayAusd: number; maxLeverage: number }; voice?: VoiceKey }`. `export function reviseDraft(config: AgentConfig, patch: DraftPatch): AgentConfig` — structuredClone the config; brief via `normalizeBrief({ ...patch.brief, reads: [] })` + `assertBrief`; caps via `assertSpendLimits` + `assertMaxLeverage` into `spend`/`maxLeverage`; sources: set `sources.web`, and recompute `tools` (`PERP_TOOLS` + web tools when on) and `plugins.enabled` (`perpl`, `perps-paper`, `exa` when on) exactly as `prepareDraft` does — extract the shared piece from `create.ts` into a helper both call, do not duplicate it; voice must be in `VOICE_KEYS` else `PilotError("INVALID_INPUT", "Unknown voice")`; finish with `assertConfig`. Site validation: reuse whatever `prepareDraft`/the schema uses for sites (max 20, host format).
  - `publish.ts`: `export type PublishBlocker = "KILLED" | "WALLET" | "FUNDS"`; `MIN_PUBLISH_AUSD_MICRO = 10_000_000n`; `publishBlockers({ killed, walletLinked, ausdMicro: bigint | null })` in the order KILLED, WALLET, FUNDS (FUNDS only when a wallet is linked and `ausdMicro < min`; `ausdMicro === null` with a wallet is the caller's 503, not a blocker — document it); `class PublishBlockedError extends Error { blockers }`.
  - Export all from `packages/core/src/index.ts`.

- [ ] **Step 4: Run the tests** → PASS. Run `node --import tsx --test packages/core/test/*.test.ts` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "Core: reviseDraft and publish blockers" -- <paths>`.

---

### Task 2: Migration 0024 and the visibility switch

**Files:** create `packages/infrastructure/drizzle/0024_go_public.sql` (plus the drizzle meta journal/snapshot entries, done the same way `0023_agent_wallet_transfers_and_avatar` was — inspect `drizzle/meta/_journal.json`); modify `src/persistence/product/agents.ts`, `src/persistence/agent-directory.ts`, `src/studio/directory.ts`; test `packages/infrastructure/test/studio-go-public.test.ts`.

- [ ] **Step 1: Failing Postgres tests** (use `createTestStore(t)` from `test/database.ts` as the other infrastructure tests do; create a user/workspace/agent with the existing helpers used by `test/studio-directory*.test.ts` or `postgres-product-data.test.ts`):
  - after migration, an agent inserted with status `active` before 0024 is public — test via: insert an agent row with `status 'active'` and `visibility 'public', published_at now()`... the backfill itself is SQL; assert it by running the migration's UPDATE logic is covered: simplest assertion — a draft created through `createDraft` has `visibility 'private'`, `published_at NULL`.
  - `PostgresAgentDirectory` list / profile by ticker / persona by handle do not return a private agent, and do return it once `visibility='public', published_at=now()` is set.
  - `directory.list(access)` returns `visibility`, `publishedAt` (null for a draft) and `xHandle` (null).
- [ ] **Step 2: Run** `node --import tsx --test packages/infrastructure/test/studio-go-public.test.ts` → FAIL.
- [ ] **Step 3: Implement** the SQL exactly as spec §5 (enum, two columns, CHECK, backfill UPDATE `WHERE status <> 'draft'`, partial index, `agents.x_challenges`, `agents.x_accounts`, `x_accounts_handle_key` on `lower(handle)`); grants following 0006/0023 conventions for the API role if those migrations grant per table. Drizzle: `visibility: agentVisibility("visibility").notNull().default("private")`, `publishedAt: timestamp("published_at", { withTimezone: true })`, tables `xChallenges`, `xAccounts`. Replace the three `status <> 'draft'` clauses with `visibility = 'public'` (keep `killed_at IS NULL` where present). `directory.list` selects `a.visibility`, `a.published_at`, and `xa.handle AS x_handle` via `LEFT JOIN agents.x_accounts xa ON xa.agent_id = a.id`; extend the `StudioDirectory.list` return type in core (`access.ts`) with `visibility: "private" | "public"; publishedAt: Date | null; xHandle: string | null`.
- [ ] **Step 4: Run** the new test and `node --import tsx --test packages/infrastructure/test/*.test.ts` → PASS (fix any existing test that inserted agents and now needs `visibility` for marketplace reads — set it public there, explaining why in a comment).
- [ ] **Step 5: Commit** — "Migration 0024: agents are private until published; X verification tables".

---

### Task 3: Stores — X, publish, identity, activity, ledger

**Files:** create `packages/infrastructure/src/studio/x-store.ts`, `src/studio/ledger.ts`; modify `src/studio/directory.ts`, core `access.ts` (interface additions), `packages/infrastructure/src/index.ts`; extend `test/studio-go-public.test.ts`.

- [ ] **Step 1: Failing Postgres tests:**
  - `directory.publish(access, productId, check)`: in one transaction locks the agent row, reads killed/linked wallet, calls `check({ killed, walletAddress })` (async, returns blockers or throws), and when `[]` sets `visibility='public'`, `published_at=now()`, `status='active'` if it was `draft`; returns `{ visibility, publishedAt }`; already public → returns current without calling check.
  - `directory.updateIdentity(access, productId, { name?, accent?, avatarPattern? })` updates `agents.name` and profile columns (names 1–40, pattern 0–5 enforced by DB checks; map violations to `PilotError("INVALID_INPUT")`).
  - `directory.activity(access, productId)`: events `created` (agent `created_at`, text "{name} created"), `wallet` (linked agent wallet's creation time, text "Agent wallet created · 0x91be…4a07" with the short address), and one `transfer` per `wallets.transfers` row touching that wallet ("To {name}'s wallet · 10 AUSD" / "Back to master · 1 AUSD"), newest first, ≤ 50.
  - `listTransfers(pool, userId)`: the user's transfers, newest first, ≤ 100, with `direction` (`to_agent` when `to` is an agent wallet), token (`AUSD`/`MON`), amount as a decimal string in token units, agent name (null if unlinked), tx hash, `at`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** following `custody-store.ts` / `directory.ts` patterns (raw SQL through the pool, transactions via the existing helper). **Step 4: Run** → PASS. **Step 5: Commit** — "Stores: publish, identity, activity and the transfer ledger".

---

### Task 4: X OAuth

Connection implementation and tests are maintained in [Studio X OAuth](../../studio-x-oauth.md).
No separate post-verification client or algorithm is needed.

---

### Task 5: API routes and schemas

**Files:** modify `packages/api-schema/src/studio.ts`, `workers/api/src/routes/studio.ts`, `src/routes/studio-wallets.ts`, `src/container.ts`, `src/env.ts`, `workers/api/.dev.vars.example`; tests `workers/api/test/studio-draft-routes.test.ts`, `workers/api/test/studio-x-route.test.ts` (follow `studio-drafts-route.test.ts` / `studio-transfers-route.test.ts` for building the app with fakes).

Routes exactly as spec §4. Details:

- `PUT /agents/:id/setup`: `access.authorize(principal, true)`; scope; read the agent record; not a draft → 409 `NOT_A_DRAFT`; `reviseDraft(record.config, body)`; `repo.updateConfig(scope, body.expectedVersion, next)` (its stale-version error already maps to 409 — check its code and reuse; spec name `STALE_CONFIG` only if that is the existing code, otherwise keep the existing code and note it in the commit); if `voice` changed also write the profile's voice name (`VOICES` name) via `updateIdentity`-like store call; respond with the studio agent (reuse `studioAgent(...)`).
- `PUT /agents/:id/identity`: name/avatar → `directory.updateIdentity`; respond the studio agent.
- `GET /agents/:id/activity` → `{ events }` (ISO `at`).
- X routes, callback and owner authorization follow [Studio X OAuth](../../studio-x-oauth.md).
- `POST /agents/:id/publish`: `directory.publish(access, id, async ({ killed, walletAddress }) => { ausd = walletAddress ? (await services.balances.read(walletAddress)).ausdMicro : null; if walletAddress && ausd == null → throw BalancesUnreadableError; return publishBlockers({ killed, walletLinked: !!walletAddress, ausdMicro: ausd }) })`; blockers → 409 `PUBLISH_BLOCKED` `{ detail: { blockers } }`; unreadable → 503 `BALANCES_UNAVAILABLE`. Use the balance reader the funding check uses (see `readFunding` in core `create.ts` and `fundedWallet` in `studio.ts`); the read happens inside the check callback but must not hold the DB transaction across the RPC — so `directory.publish` must read killed/wallet, release, run the check, then re-lock and re-read in a short second transaction, publishing only if killed/wallet are unchanged (same pattern the drafts route uses for "balances read just before the transaction"). Document it.
- `GET /wallets/ledger` in `studio-wallets.ts`.
- Studio agent DTO (`studioAgentSchema`): add `visibility: z.enum(["private","public"])`, `publishedAt: z.string().datetime().nullable()`, `xHandle: z.string().nullable()`; fill from `directory.list`. Update every fixture constructing a studio agent in `apps/web` (`home/fixture.ts`, `preview.ts`, `new-agent/fixture.ts`, tests) so typecheck passes.
- Tests cover: each error code above; publish happy path flips the DTO's `visibility`; setup on a non-draft → 409; ledger only the caller's rows; controlled OAuth consent and unavailable configuration.
- [ ] Steps: failing tests → implement → `npm run build:shared && node --import tsx --test workers/api/test/*.test.ts` PASS → typecheck → commit "API: draft setup, identity, activity, ledger, Connect X and publish".

---

### Task 6: Web data layer and the draft models

**Files:** modify `apps/web/src/features/studio/api.ts`; create `apps/web/src/features/studio/draft/model.ts`; test `apps/web/test/studio-draft-model.test.ts`.

- `api.ts`: `saveDraftSetup(agentId, body)`, `saveIdentity(agentId, body)`, `agentActivity(agentId)`, `xState(agentId)`, `authorizeX(agentId, returnTo)`, `xDisconnect(agentId)`, `publishAgent(agentId)`, `walletLedger()`; types from api-schema. Follow the existing `studioApi` helper and error mapping (`errorCode`).
- `model.ts` pure functions (no React), each with tests:
  - `DRAFT_SECTIONS` and `draftRail(section)`: the four groups of spec D2 with labels and icons (`grid, chat, target, activity, file, sliders, wallet, user, globe, coin`), `locked` true for `activity` and `profile`, `on` for the current one. `sectionLabel(key)` (canvas `SECTION_LABELS`).
  - `headerTiles(wallets | null)`: `[{ label: "MASTER · AUSD", value }, { label: "IN AGENT WALLETS · AUSD", value }, { "IN YOUR POSITIONS · AUSD", "Soon" }, { "OPEN P&L · AUSD", "Soon" }, { "AI CREDITS", "Soon" }]`; values formatted with the existing `formatUnits` from `new-agent/model.ts`; `"—"` while wallets are null.
  - Go Public requires the current OAuth state; use the shared connection panel and publication blockers.
  - Connect X states and explicit private reads follow the canonical OAuth UI.
  - `publishBlockedCopy(blockers)` (spec §3.1 lines).
  - `capsStepper(current, saved)`: steps and bounds from core's `SPEND_BOUNDS`/`LEVERAGE_BOUNDS` mirrors already in the web (`new-agent/model.ts` `STARTER_CAPS` etc.; if bounds are not mirrored yet, mirror them in `new-agent/model.ts` with a pin test against core like the existing mirrors), `dirty`, tag "SAVED"/"UNSAVED CHANGES".
  - `briefTags(brief, saved)`: per canvas `sections` rule (EMPTY / n LINE(S) · EDITED|DEFAULT; thesis without the count).
  - `addSite(sites, draft)`: canvas `addSite` rules (strip scheme, path, `www.`; host regex; no dupes; max 20) → `{ sites, draft, error }`.
  - `nextRuns(intervalHours, now)`: three `{ label, at }` (canvas `nextRuns`, labels "First run after go public", then "Then · reads sources, decides, posts").
  - `runsPerDay(h)`.
- [ ] Steps: failing tests → implement → pass → commit "Web: the draft studio's data layer and models".

---

### Task 7: The draft studio shell

**Files:** create `draft/draft-studio.tsx`, `draft/draft.module.css`, `draft/fixture.ts`, `draft/use-draft.ts`, `draft/locked.tsx`; modify `../studio.tsx`, `../home/stage.ts`, `../home/home.tsx`, `../home/fixture.ts`; delete `../home/draft-wallet.tsx`, `../home/go-public.tsx`, `../home/go-public-model.ts`, `apps/web/test/studio-home-go-public.test.ts` (move any still-relevant assertion into the draft model test).

- Canvas: top bar (markup 33–78), rail (82–97), header + tiles (325–337), locked (835–842). Dark surface (`data-surface="dark"`).
- Top bar: brand link with logo; agent chip (avatar pixels from `new-agent/avatar` helpers, name, `@handle`) and status `DRAFT · PRIVATE`; TESTNET; master `AUSD | MON` button → `WalletsModal` (reuse `new-agent/wallets-modal.tsx`, `openOn` null); AI CREDITS button with "Soon" → `CreditsModal`; account link `/account` with the swatch.
- Rail: `draftRail`; locked items `aria-disabled` with title "Opens when it's public"; clicking a locked one shows the locked panel. `+ New agent` stays reachable from the agent chip menu (reuse the existing switcher behaviour from `studio.tsx`: list agents + "New agent" gated by `newAgentLock`).
- Header: avatar, `h1` name, `@handle · {section}`, status pill; tiles from `headerTiles`.
- Section switch renders each section component (stubs returning a section with the right id until Tasks 8–11 land: `id="draft-section-<key>"`).
- `use-draft.ts`: holds `wallets` (`studioWallets()`), `activity`, `x` state, `ledger` (lazy, Master only); `refresh()`; exposes writes from Task 6 and calls `onRefreshAgent` after publish/setup/identity. Preview mode reads `fixture.ts` and never calls the API.
- `fixture.ts`: `draftStudioFixture(stage)` for every stage in spec §7 (agent from the existing draft fixture shape with `visibility:"private"`, `publishedAt:null`, `xHandle` per stage; wallets; activity; ledger entries; X state per stage).
- `stage.ts`: add the `draft-*` stages; `studio.tsx`: when the selected agent is a draft (or a `draft*` stage), render `<DraftStudio>`; drop the draft branches from Home.
- [ ] Verify: `npx tsc --noEmit -p apps/web`, model tests, `npm run design:source`. Commit "Web: the draft studio shell".

---

### Task 8: Overview with Go Public and Connect X

**Files:** create `draft/overview.tsx`, `draft/go-public.tsx`, `draft/x-connect.tsx`; CSS in `draft.module.css`.

- Canvas markup 339–441 (Go public card 343–382, wallet + schedule 384–416, trades + activity 418–439). Copy from the canvas, with `goPublicView`/`xView`.
- Reuse the shared OAuth connection panel in Overview and Identity; no manual handle proof or post matching.
- Go public button: `publishAgent`; on 409 shows `publishBlockedCopy` (FUNDS adds "Fund from master" opening the Wallets modal on the agent's wallet); on success shows `{NAME} IS LIVE` and calls `onRefreshAgent` (the studio then shows the live agent).
- Wallet card: address short + Copy, `CAPS {perTrade} / {perDay} / {lev}×` from `agent.spend`/`config.maxLeverage`, AUSD (`agent.wallet.balanceAusd`) and MON (from `wallets`), "Fund from master" (Wallets modal on this wallet, toward the agent), "Limits" → section. No wallet → spec §3.1 last paragraph's copy. Schedule row: "Run on its own · every {interval}h", "Unlocks once it's public.", a disabled switch.
- Trades: empty state + "Open Console". Activity: `events` with dots and times (`hh:mm`, "TODAY"/date).
- [ ] Verify typecheck, lint, design:source; staged `?stage=draft`, `draft-x-open`, `draft-x-ok` render. Commit "Web: the draft Overview, Go Public and Connect X".

---

### Task 9: Identity & voice

**Files:** create `draft/identity.tsx`.

- Canvas 443–477. Avatar button opens `new-agent/avatar-picker.tsx` (reuse; saving calls `saveIdentity({ avatar })`), NAME input (save on blur/Enter, 1–40; error inline), `@handle` + "HANDLE IS FIXED", VOICE chips (`VOICES` from `new-agent/model.ts`) saving through `saveDraftSetup({ expectedVersion, voice })` with the sample under them, X ACCOUNT card with tag, `x-connect` when not connected, `@handle` + DISCONNECT when connected.
- [ ] Verify; `?stage=draft-identity`. Commit "Web: Identity & voice".

---

### Task 10: Limits & funding, Brief, Sources & rules

**Files:** create `draft/limits.tsx`, `draft/brief.tsx`, `draft/sources.tsx`.

- Limits: canvas 479–526 with spec D11 copy ("Pickler holds every trade to these. On-chain caps come with live trading.", button "Save caps", tag SAVED/UNSAVED CHANGES); wallet side with Refresh (re-reads wallets), LAST CHECKED, arrivals (reuse `arrived` from `new-agent/model.ts` between reads), "Fund from master wallet", the footnote. Saving: `saveDraftSetup({ expectedVersion: agent.version, caps })`.
- Brief: canvas 676–710; note bar; four textareas with `briefTags`; RISK steppers; "Save brief" (one setup call with `brief` + `caps`); stale-version error → reload + "It changed somewhere else. Reloaded."
- Sources: canvas 712–766; Perpl fixed (check icon), Web switch; web modes; sites chips + input with `addSite`; "Save sources" (`sources: { web: on ? { mode, sites } : null }`).
- [ ] Verify; stages `draft-limits`, `draft-brief`, `draft-sources`. Commit "Web: Limits & funding, Brief, Sources & rules".

---

### Task 11: Console, Trades, Trade, Master wallet

**Files:** create `draft/console.tsx`, `draft/trades.tsx`, `draft/trade-soon.tsx`, `draft/master.tsx`.

- Console: canvas 530–636 per spec §3.4 / D12 / D13: RUN IT ON PAPER (IDLE), inputs chips (Perpl; Web · ANYWHERE or · N SITES), run button disabled reading "Paper runs open with the Perpl runtime" with a SOON tag; ON ITS OWN with 3h/6h/12h/24h saving via the existing `setIntervalHours` (`api.ts`), `N RUNS / DAY`, `nextRuns`; WHAT IT DID idle note "RUN IT TO SEE WHICH RULES FIRE"; TALK TO IT with starters and input rendered disabled and a SOON tag; "Tune the brief / Change sources / Adjust caps" links.
- Trades: canvas 639–674 empty state.
- Trade: spec D16 Soon panel in the canvas's card style.
- Master: canvas 806–833 per spec D17 with `walletLedger()` entries (`+10 AUSD` lime for to-master, white for to-agent; sub "MASTER → AGENT"/"AGENT → MASTER"; time `hh:mm`), allocation list, "Move to an agent" (Wallets modal), "Buy AI credits" (credits modal).
- [ ] Verify; stages `draft-console`, `draft-trades`, `draft-trade`, `draft-master`, `draft-locked`. Commit "Web: Console, Trades, Trade and Master wallet".

---

### Task 12: Design harness routes and full verification

**Files:** modify `scripts/design/routes.mjs` (one route per `draft*` stage, `product: "studio"`, `surface: "dark"`, `task: "Draft dashboard"`, `proves: "#draft-section-<key>"` or the locked panel id; replace the old `studio-home-draft` route), any harness expectations that referenced the removed home draft.

- [ ] Run, in order: `npm run build:shared`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:architecture`, `npm run design:source`, then `npm run design:check` (starts its own servers on 3001/8799 — make sure nothing else listens there; ~8 min). Fix every failure at its root. Commit "Design harness: the draft dashboard's staged states".
