# Studio live (published Perpl agent) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/specs/studio-live-v1.md` (revised 2026-10-03 against the final canvas): the studio of a published Perpl agent, with real data where it exists and honest empty or Soon states elsewhere.

**Architecture:** Done: core `risk`/`entry`/`reviseSetup`/`setupChangeSummary` (f2fcccf2), setup versions migration 0026 + routes (a81c05b3, renumbered in the merge 9fe40933), the shared shell `features/studio/shell/` (2b5af511). Remaining: `features/studio/live/` (model, fixture, hook, shell configuration, sections) chosen in `studio.tsx` for a non-draft agent with `config.perpl`.

**Tech Stack:** Next 16 / React 19 with CSS modules, node:test via `node --import tsx --test`.

**The canvas (final):** raw `/var/folders/pm/0wgq_cj10pnfpczfjrs_q3dh0000gn/T/pickler-live/studio-live.dc.html` (markup to line 815, logic after; `renderVals` returns from ~1180) and a style-stripped copy with canvas line numbers `/var/folders/pm/0wgq_cj10pnfpczfjrs_q3dh0000gn/T/pickler-live/live-markup.txt`. Ranges: top bar 33–86 (switcher 40–58), live strip 88–109, rail 111–134 (help links ~126–132), header 140–153, stats 155–161, banner 163–170, Overview 172–223, Positions 225–262, Record 264–283, Decisions 285–324, Console 326–349, Posts 351–366, Brief 368–391, Sources 393–454, Limits 456–498, Controls 500–571, Identity 573–607, Marketplace Agents 609–643, Markets 645–672, Leaderboard 674–690, Account 692–747, Wallets 749–790. Re-check the ranges with `grep -n "<!--"` on the raw file. The spec's §2 overrides the canvas wherever it says so: read it before any screen.

**Repo rules (all tasks):** work only in `/Users/Juvenal/Development/Pickler/pickler-studio-draft` on branch `codex/studio-live`. Read the root `AGENTS.md` and `apps/web/AGENTS.md` first. Commit by path (`git commit -m "..." -- <paths>`), never `git add -A`, `git stash`, `reset --hard`, `checkout .`, `clean`. Never push. Never start a dev server (only Task 7 runs `design:check`). CSS uses `var(--pk-*)` tokens only (`npm run design:source` stays clean); CSS-modules `composes` must name every class directly (two-level chains lose classes). No copy may promise what the Perpl runtime will do (draft spec D19). Reuse `features/studio/shell/` and the account page's sections (`features/account/sections/*`) instead of forking; if a shared piece needs a variation, add a prop. Match surrounding style. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Checks before every commit:** `node --import tsx --test apps/web/test/*.test.ts`, `npx tsc --noEmit -p apps/web`, `npx eslint <changed files>`, `npx prettier --check <changed files>`, `npm run design:source`, `npm run check:architecture`.

---

### Task 3b: Live model, fixture, hook, shell configuration, wiring

**Files:** create `apps/web/src/features/studio/live/model.ts`, `fixture.ts`, `use-live.ts`, `live-studio.tsx`, `live.module.css`, `live-strip.tsx`, and placeholder section components (`overview.tsx`, `positions.tsx`, `record.tsx`, `decisions.tsx`, `console.tsx`, `posts.tsx`, `brief.tsx`, `sources.tsx`, `limits.tsx`, `controls.tsx`, `identity.tsx`, `agents.tsx`, `markets.tsx`, `leaders.tsx`, `wallets.tsx`, `account.tsx`) each rendering the shell's `StudioSection` with `idPrefix="live"`. Modify `studio.tsx`, `home/stage.ts`, `apps/web/AGENTS.md`. Test: new `apps/web/test/studio-live-model.test.ts`.

- `model.ts` pure helpers with tests: `studioKind(agent)` → `"draft" | "live" | "legacy"`; `liveRail(section, counts)` (spec L3, badges only > 0, titles for marketplace items, help links); `liveSectionLabel`; `liveStatus(agent)` (L4); `sinceLabel(publishedAt, now)` → `"PUBLIC SINCE OCT 1 · DAY 2"` (UTC, day 1 on publish day); `liveTiles(wallet)` (L5); `stripView()` (L6); `liveWarnings` + `fixTarget` (L14; MON < 0.2, AUSD < per trade); `healthRows` (L13); `meters(config)` (L13); `entryView(entry, caps)` (L13 status note, mode notes, chips); `liveCaps(config)` / `liveCapsStepper(current, saved)` (L12: five rows, titles and subs from the canvas `CAP_DEFS`, bounds mirrored from core `RISK_BOUNDS` with a pin test like the existing mirrors; tag SAVED / UNSAVED CHANGES / DEFAULTS); `marketsView(markets, details, wanted)` + `sourceTag` (L8: SAMPLE DATA / STALE / none); `briefBar(version, dirty)` (L9); `versionRows(versions, currentVersion, now)` (L10); `abilities(paused)` (L15); `postsHeader(xHandle)` (L7); `directoryCards(directory, ownHandle, beat)` + `beatFilters` (L17); `boardRows(markets, category)` + `boardFilters` (L18); `leaderRows(leaderboard)` (L19); `walletCards(wallets, agent, account)` (L20); `delegationRows()` (L21). Read the DTOs in `packages/api-schema/src/markets.ts` and `agents.ts` for exact fields; when a canvas field has no DTO field, show "—", never invent.
- `use-live.ts`: built on `shell/use-agent-studio.ts` with `readMore` (versions, markets list + one detail per wanted symbol; directory and leaderboard read lazily when their section first opens) and writes `pause(paused)` built from `tools.guard` + `tools.reloadAfterWrite`; preview/staged never fetch. Find the existing web client functions for marketplace reads (`apps/web/src/features/agents`, `features/markets`, `server/`) before adding any; browser calls go through `/api/v1/*`.
- `fixture.ts`: `liveStudioFixture(stage)` for every stage in spec §7 (realistic DTO-shaped data, including a sample-board and a perpl-board variant).
- `live-studio.tsx`: `StudioShell<LiveSectionKey>` configured per L3–L6 and L14; header controls (Pause entries / Resume with pending and error states; "Stop · close all" `aria-disabled` + Soon); the strip.
- `studio.tsx`: `studioKind` chooses; Go Public lands on the live Overview; `?section=` carries over where keys match; stages `perpl-*` in `home/stage.ts`.
- [ ] Commit "Web: the live studio's shell, model and fixture".

### Task 4: RUN sections — Overview, Positions, Record, Decisions, Console, Posts

**Files:** the six section files, `live/sparkline.tsx` (SVG polyline, tokens, `aria-hidden` with a text alternative), `live/run.module.css`. Canvas ranges in the header; spec L6–L8. Console uses the shell's `TalkSoon`.

- [ ] Commit "Web: the live RUN sections".

### Task 5: BUILD sections — Brief, Sources & rules, Limits, Controls, Identity

**Files:** the five section files, `live/build.module.css`; reuse `shell/setup-save.tsx`, `shell/build-parts.tsx` (extend `CapSteppers` with a per-row `sub` line), `shell/build-model.ts`, shell `Identity`. Spec L9–L16. Move into `shell/` any draft rule both need (brief fields, web box, wallet card) rather than copying.

- [ ] Commit "Web: the live BUILD sections".

### Task 6: MARKETPLACE and YOU — Agents, Markets, Leaderboard, Wallets, Account

**Files:** the five section files, `live/market.module.css`; Wallets reuses the shell's wallet pieces and `ledgerRows`; Account reuses `features/account/sections/security.tsx` and `profile.tsx` (add props if they need to render inside the studio; keep `/account` unchanged and its tests green) and the account's add-passkey ceremony. Spec L17–L21.

- [ ] Commit "Web: the live MARKETPLACE and YOU sections".

### Task 7: Design harness and full verification

**Files:** `scripts/design/routes.mjs` (one route per `perpl-*` stage, `product: "studio"`, `surface: "dark"`, `task: "Live studio"`, proves per spec §7; add the task to `HOLDS`).

- [ ] Run in order, fixing failures at the root: `npm run build:shared`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:architecture`, `npm run design:source`, `npm run api:openapi -- --output /tmp/oa.json && node --import tsx --test workers/api/test/openapi.test.ts`, `npm run design:check` (ports 3001 and 8799 free first; ~10 min; no self-matching waiters). Look at desktop and phone screenshots of the live AND draft routes against their canvases; fix glaring breakage. Commit "Design harness: the live studio's staged states".
