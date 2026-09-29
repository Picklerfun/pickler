# Cleanup and One Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every colour, font family, radius and shadow in `apps/web` comes from a `--pk-*` token defined in `packages/ui/src/styles.css`, a check fails the build when one does not, no screen draws the pre-v2 backdrop, and the dead classes, dead exports and unused adapters are gone — with nothing the product does changed.

**Architecture:** A static source check (`scripts/design/source.mjs`) is written first and run in report-only mode, so every later task has a number that has to fall. The CSS is then rewritten in the spec's order — backdrop, aliases, legacy tokens, literals, dead code — by four small tools driven by mapping tables committed beside this plan, so no implementer chooses a colour. The design harness gets a runner that starts its own servers, a screenshot comparison, a wider runtime token check and a CI job; the static check is switched to fail only after the tree is clean.

**Tech Stack:** Next.js 16 (Turbopack) with CSS Modules, `@pickler/ui` tokens in plain CSS, Node 22 `node:test`, `tsx`, TypeScript 6, Playwright (global install, not a repository dependency), Turborepo, GitHub Actions.

**Spec:** `docs/specs/cleanup-and-design-system-v1.md` (section 8 overrides sections 2–3). **Evidence:** `docs/specs/cleanup-inventory-2026-09-29.md`. **Visual authority:** `docs/specs/design-system-v2.md`.

**How this plan was checked.** Every tool, mapping table and patch was applied, in this order, to a throwaway clone of this branch at `5c07c97`, and the design checks were run there after each batch; the patches in `patches/` are the diffs of that run. The numbers quoted as "Expected" are what that run printed. If a command here prints something else, the tree has moved since the plan was written: stop and read the difference before going on.

---

## Repository rules

These apply to every task. They are not suggestions.

- **Work only in** `/Users/Juvenal/Development/Pickler/pickler-turnkey`, on branch `codex/cleanup-design-system`. Run every command from that directory. Use absolute paths or paths relative to it; never `cd` into the other checkout (`/Users/Juvenal/Development/Pickler/pickler`).
- **The worktree is shared.** Other agents edit and commit in it at the same time. Touch only the files in your task's **Owns** list.
- **Never run** `git clean`, `git checkout .`, `git reset --hard`, `git restore`, or a bare `git stash` / `git stash pop`. An untracked file another agent is writing has no object in git: once deleted it cannot be recovered.
- **Commit by path.** `git add <paths>` then `git commit -m "…" -- <paths>`. `git commit` without paths commits the whole index, including what another agent staged. Never `git add -A`, never `git commit -a`.
- **Every commit message ends with the trailer**, after a blank line:

  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```

- **Do not push.** The branch tracks `origin/main`, so a bare `git push` would push to `main`. When the team lead asks for a push, the only form is `git push origin codex/cleanup-design-system`.
- **Quote globs in zsh.** `--include='*.css'`, not `--include=*.css`: the unquoted form fails with "no matches found".
- **Gates, judged by exit status, not by reading the output:**

  | Gate            | Command                                                                                                   |
  | --------------- | --------------------------------------------------------------------------------------------------------- |
  | shared packages | `npm run build:shared`                                                                                    |
  | types           | `npm run typecheck`                                                                                       |
  | lint            | `npm run lint`                                                                                            |
  | format          | `npm run format:check`                                                                                    |
  | tests           | `npm test`                                                                                                |
  | build           | `npm run build`                                                                                           |
  | staging config  | `npm run check:staging`                                                                                   |
  | workers         | `npm run build:workers`                                                                                   |
  | contracts       | `npm run contracts:build && npm run contracts:test`, only if a task touched `contracts/` (none here does) |

  Each task names the gates it must run. The last task runs all of them.

- **`apps/web/test` cannot import `@pickler/api-schema` values.** `apps/web` is CommonJS to node's resolver and `api-schema` publishes only an `import` condition. `import type` is fine. A test that needs a value reaches it with a dynamic `import()`.
- **The local database is Docker PostgreSQL at `127.0.0.1:55432`.** `npm test` needs it. Check with `lsof -nP -iTCP:55432 -sTCP:LISTEN`; if nothing listens, start Docker Desktop and run `npm run db:up`. Never point anything at the cloud Supabase project, and never use the Supabase MCP tools for this work.
- **Postgres connection timeouts under parallel test runs are known contention, not a regression.** When `npm test` fails with a connection timeout while other agents are running tests, re-run the failing files alone: `node --import tsx --test <file> [<file>…]`. Report the failure as contention only if they pass alone.
- **Never run the `build` gate while the harness servers are up.** `next dev` and `next build` both write under `apps/web/.next`.
- **Report honestly.** If a gate fails, say so and paste the output. If a step was skipped, say which.

## Judgment calls

The spec leaves these to the plan. Each is made here, with its reason, so no implementer has to choose. The owner can reverse any of them; the mapping tables in the tasks are where each one lands.

| #   | Question                                                                                                                                         | Call                                                                                                                                                                                                                                                                                                                                          | Reason                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| J1  | `/apply`: alphas of the old public ink `#F5F6FF` (24 literals)                                                                                   | Grounds (0.05, 0.06) → `--pk-panel`. Selected chip (0.14) → `--pk-panel-3`. Hairlines (0.14–0.24) → `--pk-rule-strong`. Edges meant to be seen (0.3, hover 0.6) → `--pk-border-strong`. Grid lines (0.07) → `--pk-rule`.                                                                                                                      | A3: each takes the v2 token that holds its role on the dark surface. A panel is `--pk-panel`; white at 0.12 is the dark hairline; white at 0.32 is the dark control edge.                                                                                                                                                                                    |
| J2  | `/signin`, `/signup`, `/passkey`: alphas of the old console ink `#F3F1EC` (live: 3)                                                              | Grid lines (0.06) → `--pk-rule`. Code caret edge (0.4) → `--pk-border-strong`.                                                                                                                                                                                                                                                                | Same roles as J1.                                                                                                                                                                                                                                                                                                                                            |
| J3  | The old cyan `#5AD8FF` in CSS (brand glow, invite bar, cyan tile)                                                                                | Tint → `--pk-state-cool-bg`. Edge and glow → `--pk-cyan-edge`.                                                                                                                                                                                                                                                                                | v2 has no cyan; the carried-forward cyan names already resolve to the `cool` state, which is the role these play (an invitation, a neutral figure).                                                                                                                                                                                                          |
| J4  | The old cyan, the old ink and the slate as **swatches** in `apply/lib/options.ts`                                                                | `cyan` → the palette's `indigo`; `white` → `--pk-ink`; `slate` → `--pk-ink-muted`.                                                                                                                                                                                                                                                            | `lib/accent.ts` already renders the DTO's `cyan` as indigo, and mapping it to blue would make Crypto and Tech & Science the same colour. Stored applications hold category and personality names, never colours, so nothing stored changes.                                                                                                                  |
| J5  | `--pk-space-veil` and `--pk-space-veil-strong` (7 reads in `/apply`)                                                                             | Insets (chip, well, tile, post, secondary button) → `--pk-bg`. Header → `--pk-nav-bg`, and its `backdrop-filter` goes because the bar is now opaque. The piece's drop shadow → `--pk-popover-shadow`.                                                                                                                                         | A2. A veil was the old sky's edge colour over the sky. On the plain dark ground that is the ground itself, and an inset inside a panel is darker than the panel — as the Studio Empty v4 canvas draws its idle paper-run box (`#0B0D1A` inside `#15182A`).                                                                                                   |
| J6  | `--pk-space-edge-rgb` at 0.4 in `markets` `.order`                                                                                               | `--pk-panel-3`                                                                                                                                                                                                                                                                                                                                | A2. It sits on the ticket's light panel; `--pk-panel-3` is the step inset from a panel on either surface, and `levels.test.mjs` already proves ink on it.                                                                                                                                                                                                    |
| J7  | White highlights at 0.22, 0.25, 0.26, 0.3, 0.35, 0.4, 0.45                                                                                       | Two weights. New `--pk-lit-edge` (0.22) for an inset top highlight; the existing `--pk-glow-rim` (0.5) for the bevel of a lit fill (0.4, 0.45).                                                                                                                                                                                               | D6 asks for a token, not seven. Nobody chose 0.25 over 0.26; the precedent is the veil, which folded five weights into two.                                                                                                                                                                                                                                  |
| J8  | Lime at 0.12, 0.2, 0.32, 0.35, 0.38, 0.45, 0.5, 0.8, 0.9                                                                                         | Halos: new `--pk-glow-lime` (0.32) and `--pk-glow-lime-strong` (0.5), each literal taking the nearer. Live dots (0.8, 0.9) → solid `--pk-lime`. Borders → `--pk-lime-edge`. Fills (0.12) → `--pk-state-good-bg`. The `.wellClear` overlay (0.2) → `--pk-glow-lime`, because it covers the well and must stay translucent.                     | The landing's glow button is the most seen lime halo in the product and keeps its two exact values; everything else moves to one of them.                                                                                                                                                                                                                    |
| J9  | `rgba(var(--accent-rgb), 0.6)` and `0.55` (4 glows)                                                                                              | `var(--accent)`: the glow is the accent itself. `--accent-rgb`, `colorVars` and every `r,g,b` triple in TypeScript go.                                                                                                                                                                                                                        | A blur already fades the colour; the alternative was seven more tokens and a second copy of the palette in JS. The glow of a 13px pixel becomes a little stronger.                                                                                                                                                                                           |
| J10 | Dialog backdrops `rgba(6, 6, 9, 0.72)` and `rgba(11, 13, 26, 0.72)`                                                                              | One new token, `--pk-scrim: rgba(11, 13, 26, 0.72)`, on `:root`.                                                                                                                                                                                                                                                                              | The first is the old console ground at the same alpha. A scrim darkens whatever is behind it, so it does not change with the surface.                                                                                                                                                                                                                        |
| J11 | Violet at 0.14 and 0.28 on the submitted hero                                                                                                    | Ground → `--pk-state-info-bg`; glow → `--pk-violet-edge`.                                                                                                                                                                                                                                                                                     | The `info` state is violet's pair.                                                                                                                                                                                                                                                                                                                           |
| J12 | Magenta borders at 0.6 and 0.8; the code field's focus edge (lime 0.45)                                                                          | Magenta → `--pk-magenta-edge`. Focus → `--pk-focus`.                                                                                                                                                                                                                                                                                          | Focus is a system colour, and using the lime edge for it would make a focused box and a filled box the same.                                                                                                                                                                                                                                                 |
| J13 | `/apply` `.primaryButton:disabled`                                                                                                               | The rule is deleted.                                                                                                                                                                                                                                                                                                                          | It re-declared the disabled state with old-ink literals. `.pk-button:disabled` in `styles.css` is the system's, measured at 6.18:1 on dark.                                                                                                                                                                                                                  |
| J14 | 35 variant-scoped variables that hold a colour (`--accent`, `--hue`, `--ink`, `--dot`, `--mood`, `--accent-ink`, `--accent-on`, `--accent-soft`) | Each becomes one rule per variant that sets the property directly. In `markets` the tone sits in `:where()`.                                                                                                                                                                                                                                  | Spec 3.2 allows a local variable only for a value that is not a colour. `:where()` adds no specificity, so every rule that won before still wins.                                                                                                                                                                                                            |
| J15 | `--tint-fg`, `--tint-bg`, `--tint-bd` in `styles.css`                                                                                            | Renamed `--pk-tint-fg`, `--pk-tint-bg`, `--pk-tint-bd`.                                                                                                                                                                                                                                                                                       | They are tokens defined in the token file; without the prefix neither check sees them as tokens.                                                                                                                                                                                                                                                             |
| J16 | The seven carried-forward tokens with no single v2 equivalent (`--pk-ink-dim`, `--pk-border-strong`, the five `-edge`)                           | They stay under their names and leave the "Carried forward" block for a block of their own.                                                                                                                                                                                                                                                   | D5 renames only a misleading name. "Edge" says what it is, and renaming 131 uses changes no pixel.                                                                                                                                                                                                                                                           |
| J17 | D6's "one shared module that mirrors the tokens"                                                                                                 | `packages/ui/src/tokens.ts`, holding only the five values code must hold as values (`themeColor`, four chart fallbacks). `lib/accent.ts` and `apply/lib/options.ts` hold token **names** and no colour.                                                                                                                                       | A mirror is a second copy, and the smallest one is the safest. It lives in `@pickler/ui` because `chart.tsx` is there and `ui` cannot import from the web app.                                                                                                                                                                                               |
| J18 | Who may hand a token to CSS from TypeScript                                                                                                      | Only `apps/web/src/lib/accent.ts` (`accentVars`, `swatchVars`). The static check enforces it.                                                                                                                                                                                                                                                 | Which agent a screen shows is data, so its colour cannot be a class. One module doing it is a channel; any module doing it is the alias layer again.                                                                                                                                                                                                         |
| J19 | Google's logo colours in `packages/ui/src/brand.tsx`                                                                                             | Exempt from the static check by file name, and from the runtime check by a `data-third-party-mark` attribute on the `<svg>`.                                                                                                                                                                                                                  | A third party's mark may not be recoloured.                                                                                                                                                                                                                                                                                                                  |
| J20 | A sixth static rule, `unused-class`, which the spec does not list                                                                                | Added, with a `KEEP` list naming the ten classes reached only through a computed `styles[...]`.                                                                                                                                                                                                                                               | The spec removes dead classes; without a rule, nothing stops the next one. It is also the verification for the dead-class tasks.                                                                                                                                                                                                                             |
| J21 | Which list of rail sections is the authority (A6)                                                                                                | The thirteen keys in `sections/keys.ts`, with the shell rail's labels. The empty home's rail draws all thirteen, disabled.                                                                                                                                                                                                                    | The Studio Empty v4 canvas labels its rows "Console", "Trades" and "Sources & rules", but their keys in the canvas are `picks` and `skills` and their icons are the ones `context`, `picks` and `skills` carry. They are older labels of sections that exist, not three more sections. Studio v5 draws no rail, only a Menu, with the labels the shell uses. |
| J22 | Which sections are "Soon" (D8)                                                                                                                   | `sources`, `identity`, `profile`, `audience`, `token`. `board` draws the same panel without the SOON mark. The rail badges `SAMPLE` and `PLANNED` and the Menu note `OPTIONAL` become `SOON`. The `token` copy is rewritten.                                                                                                                  | Those five have no screen. The board's two links lead to pages that exist, so SOON on it would be false. The old token copy ("No curve, no contracts") predates the launch catalogue.                                                                                                                                                                        |
| J23 | The 46 exports only tests import                                                                                                                 | Kept, when the test pins behaviour the product has — including `stepsFor` and `forgetRail`, which are unused in their own file but exist for those tests, and `policyReasonText`, which a test reaches through a dynamic `import()`. Removed with their tests: `agentsWithToken`, `fromViemAccount`, `PasskeyUnusableError`.                  | Spec 3.3. The token board no longer filters agents; Mera is retired and nothing can throw the error `PasskeyUnusableError` answers.                                                                                                                                                                                                                          |
| J24 | How the harness gets a session (D10)                                                                                                             | It does not. The runner starts Next with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set to the empty string, so the studio and the account render from the preview fixtures they already have. `/passkey` gets a `?state=add` door like the signup's `?state=passkey`. The fixture API serves two sample launches. | Measured on 2026-09-29: with both variables empty and the fixture API behind it, 49 of 50 routes render and all four checks are clean; only `/tokens` is blocked, by its stale proof. A forged session would need the API to accept it.                                                                                                                      |
| J25 | Order: part of step 6 before step 2                                                                                                              | The runner, the `/tokens` proof and the `/passkey` route are tasks 2 and 3, before the baseline. The wider runtime check, the strict static check and CI stay in step 6.                                                                                                                                                                      | A baseline of "every harness route" needs every route to render.                                                                                                                                                                                                                                                                                             |
| J26 | `.beatChip` on the agent profile, once light                                                                                                     | `color: var(--accent-ink)` instead of `var(--accent)`.                                                                                                                                                                                                                                                                                        | Measured with the surface flipped in the browser: lime on `#F5F6FA` is 1.22:1. It is the only contrast failure the three agents routes have on light.                                                                                                                                                                                                        |
| J27 | Runtime checks in CI (spec 3.4)                                                                                                                  | A `design` job installs Playwright globally on the runner and runs `npm run design:check`. If the first run on GitHub cannot render for a reason that is the runner's and not the tree's, task 36 says what to change and what to write in the spec.                                                                                          | A headless browser is free on a GitHub runner. Playwright stays out of `package.json`, as `design-system-v2.md` §7 decided.                                                                                                                                                                                                                                  |
| J28 | Screens that differ between two captures of the same tree                                                                                        | The baseline is captured twice and compared; the result is the noise file every later comparison reads.                                                                                                                                                                                                                                       | Measured: 20 of 98 shots differ by 0.001%–2.2% with nothing changed, because they draw clocks and charts from the current time.                                                                                                                                                                                                                              |

## The `/console` decision (A7)

**Removed.** `apps/web/src/app/console/page.tsx` is fifteen lines: it copies the query string and calls `redirect("/studio")`. It renders nothing and holds no work of main's that anything else lacks.

Evidence:

- The file's whole body is the redirect (`page.tsx:3-15`).
- Its history is the studio's own: `29473dd` and `dfe8b96` built the console there; `628e8ff` ("Call the studio by its name in the URL, the API and the code", 2026-09-24) moved the screen to `/studio` and deleted this file, all 23 lines of it; the merge `5b98c55` (2026-09-28) brought the path back as a redirect.
- `apps/web/AGENTS.md:139` records the decision the redirect contradicts: "The studio lived at `/console` until 2026-09-25; no redirect is kept because nobody had launched." Line 484 of the same file says the opposite. Line 139 is the decision; line 484 describes the leftover.
- Nothing links to it (inventory section 2), and neither production host serves it: `console` is not in `STUDIO_SEGMENTS` (`server/hosts.ts:44-52`), so the studio host answers 404 and the marketplace host redirects to a path it then refuses.

Task 31 deletes the file and the sentence at `AGENTS.md:484`. `/v1/console/*` on the API is a different thing and stays (D12).

## Where the spec and the code still disagree

These are not resolved by this plan. They are listed so nobody takes the plan's silence for agreement.

1. **Spec 3.4 says the static check covers five rules; this plan ships six** (J20). The sixth can be dropped by deleting `unusedClasses` from `source.mjs` without touching the others.
2. **Spec D6 says `lib/accent.ts` and `apply/lib/options.ts` "read one shared module that mirrors the tokens".** They end up holding no colour at all, so they read nothing (J17). The mirror exists, with two readers.
3. **Spec 3.2 says `styles.css` is "the only file that may contain a colour literal".** `packages/ui/src/tokens.ts` holds five and `packages/ui/src/brand.tsx` four. Both are named exemptions in the check.
4. **Spec 3.4 says the harness gives the studio and account routes "a session".** They get no session; they render because authentication is off (J24). What is measured is the preview fixture, which is the same components with sample data.
5. **Spec A6 says a section with no screen is a "Soon" row "as the canvases draw them".** Neither canvas draws a Soon row in a rail: Studio v5 has no rail and Studio Empty v4 draws every row plain. The mark used is the `Tag` the empty home already uses for "A ranked agent · SOON".
6. **`apps/web/AGENTS.md` and `packages/ui/AGENTS.md` tell feature stylesheets to alias the tokens** (`--ink: var(--pk-ink)`). Task 39 rewrites both paragraphs; until then the instructions contradict the check.
7. **`design-system-v2.md` §6 still says `apply` and `agents` are pinned dark "until someone draws them light"**, and its Validation section says "no literal colour left in any declaration in the product", which the inventory disproved. Task 39 adds a dated correction under both rather than rewriting history.
8. **`?section=trading` is still refused** (A10) and the trading panel is measured only as part of `?section=limits`. Unchanged, as the spec says.
9. **`sections/brief.tsx` and `brief/` are still two brief editors** (A5), and `brief/model.ts` still exports its own `SECTIONS` under the same name as `sections/keys.ts`. Unchanged, as the spec says.
10. **The runtime checks read no `::before` or `::after` and nothing a `<canvas>` draws.** Spec 3.4 does not ask for them; the static check covers what a pseudo-element's rule declares.
11. **`::backdrop` and tokens.** `--pk-scrim` is read inside `::backdrop`, which inherits custom properties only in browsers from 2024 on (Chrome 122, Firefox 120, Safari 17.4). In an older browser the two dialogs open over an undimmed page. Nothing else in the product reads a token from `::backdrop` today.
12. **The inventory counts 72 plain aliases and 24 hex literals in TypeScript; the check counts 100 and 21.** The check counts the 28 variant definitions whose value is `var(--pk-…)` as aliases, leaves the four Google colours out, and counts the one `rgba()` in `chart.tsx`. The same code, counted by the rule that will judge it.

## How to run the design harness

The harness is `scripts/design/`. It needs three things: a fixture API, the web app pointed at it, and a Chromium that Playwright can drive. Tasks 2 and 3 build the runner described here; from task 4 on, this is the only way the harness is run.

**One command starts everything, measures, and stops what it started:**

```sh
npm run design:check            # the static check, then surfaces, tokens, contrast and type
npm run design:shots            # screenshots only
node scripts/design/run.mjs tokens contrast   # only the checks named
```

What the runner starts, and where:

| Process     | Command it runs                                                                                                                                                                  | Port             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Fixture API | `node --import tsx scripts/design/fixture-api.mjs 8799`                                                                                                                          | `127.0.0.1:8799` |
| Web app     | `node_modules/.bin/next dev -p 3001`, in `apps/web`, with `PICKLER_API_LOCAL_URL=http://127.0.0.1:8799`, `NEXT_PUBLIC_SUPABASE_URL=` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` | `localhost:3001` |

The two empty Supabase variables are the point: a variable that is set, even to nothing, is not overwritten by `apps/web/.env.local`, and with authentication off the studio and the account render from their preview fixtures. Do not start the web app with `npm run dev`: Turborepo drops `PICKLER_API_LOCAL_URL`.

**Before you run it, look at the ports.** Another agent may be running the harness, and another checkout of this repository serves the same application on port 3000.

```sh
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:8799 -sTCP:LISTEN
```

- Both print nothing: run the command. The runner starts both servers and stops both when it ends, also when a check fails.
- Either prints a process: **do not kill it and do not start anything.** It is somebody else's. Wait and look again, or ask the team lead whose it is. The runner refuses on its own, with exit status 2 and the message `port 3001 already in use, and this runner did not start what is there.`
- Only if the team lead confirms that the server on 3001 is this worktree's, started with the environment in the table above, measure it as it is: `DESIGN_BASE_URL=http://localhost:3001 npm run design:check`. The runner then starts nothing and stops nothing.

**After it ends, look again.** Both `lsof` commands must print nothing. If the runner was killed from outside (a timeout, a closed terminal) its servers can outlive it; stop only processes you started, by the PIDs `lsof` prints, with `kill <pid>`.

**`next dev` rewrites a tracked file,** `apps/web/next-env.d.ts`, to point at its own types folder. The runner puts back what it found when it stops. If you ever start the web app by hand, check `git status --short apps/web/next-env.d.ts` afterwards and never commit that file.

**It is slow the first time.** Next compiles each route on its first visit. A first run of the four checks over fifty routes takes ten to fifteen minutes; a second run about two minutes per check. Give the command a timeout of at least twenty minutes and do not run two at once. The servers' output goes to `scripts/design/.shots/servers.log`, which is the first place to look when a route answers 500.

**Chromium.** Playwright is installed globally on this machine (`npm root -g`), not in the repository. If its bundled Chromium is missing the harness prints `note: Playwright's bundled Chromium is not installed; using cached <revision>.` and carries on. That note is not a failure.

**Exit status.** 0: every check clean. 1: a check measured something wrong, or a route was blocked. 2: refused to measure (ports, a server that would not start, a server painting another tree's tokens). A blocked route is a failure: a check that could not see a screen has not passed it.

### Screenshots, and comparing them

Everything the harness writes goes to `scripts/design/.shots/`, which task 2 adds to `.gitignore`. It is inside the repository because the system's temporary folder is wiped between sessions. Nothing in it is ever committed.

```sh
DESIGN_SHOTS_DIR=scripts/design/.shots/<name> npm run design:shots
DESIGN_ROUTES=agents,agent-ask DESIGN_SHOTS_DIR=scripts/design/.shots/<name> npm run design:shots   # only those routes
npm run design:compare -- scripts/design/.shots/baseline scripts/design/.shots/<name> \
  --noise scripts/design/.shots/noise.txt
```

`design:shots` captures every route at 1400×1000 and 390×844, full page, with animations off. `design:compare` prints one line per screen that differs:

| Line starts    | Meaning                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DIFFERS`      | The screen changed. Expected only where the task says so.                                                                                                   |
| `NOISE`        | The screen is one that moves by itself (a clock, a chart drawn from the current time) and moved no more than it does between two captures of the same tree. |
| `RESIZED`      | The page's height changed, so the two shots are not compared pixel by pixel. Open both.                                                                     |
| `GONE` / `NEW` | A route was removed or added. With `--partial`, which says the second folder holds only some routes, `GONE` is not printed.                                 |

Every task that can change a pixel ends with the same three steps: capture its routes into `scripts/design/.shots/task-NN`, compare with the baseline, and check the result against the task's **Expected differences**. The last task of each batch captures every route and states the differences of the whole batch. A `DIFFERS` or `RESIZED` on a screen the task does not list is a defect of the task: open the two PNGs (the Read tool shows images), find what moved, and fix it or report it. Do not re-capture the baseline to make a difference go away.

After a task whose differences were expected and are accepted, the task says whether the baseline moves forward. Where it does, the step is:

```sh
rm -rf scripts/design/.shots/baseline
cp -R scripts/design/.shots/task-NN scripts/design/.shots/baseline
```

That `rm -rf` names one folder the harness owns. It is not a licence to delete anything else.

## Companion files: tools, maps and patches

Everything mechanical in this plan is a file, committed beside the plan, so that nothing is retyped:

```
docs/superpowers/plans/2026-09-29-cleanup-design-system/
  tools/      four small scripts that rewrite a file from a table, and refuse when the table no longer fits
  maps/       the mapping tables themselves, as the JSON and TSV the tools read
  patches/    every hand edit and every new file, as a patch made from the verified run
  mapping-*.md  the same tables for a person to read, with the script that generated them
```

In every command below, `$PLAN` is that folder. Set it once per shell:

```sh
PLAN=docs/superpowers/plans/2026-09-29-cleanup-design-system
```

**The tools.** Each edits only the file named on its command line. After any of them, run `npx prettier --write <that file>`, then `git diff --stat -- <that file>`, and read the diff.

| Tool                                                                 | What it does                                                                                                                                                                                                                | Refuses when                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `$PLAN/tools/retoken.mjs <file.css> <map.json> [--drop-definitions]` | Every `var(--from)` becomes `var(--to)`. With the flag, each `--from: …;` definition is deleted, with the comments between the first and the last of them in a block.                                                       | a read has a fallback, `var(--from, …)`                                                 |
| `$PLAN/tools/reline.mjs <file> <edits.json>`                         | Replaces exact text. Each edit is `{ "find", "replace", "count" }`.                                                                                                                                                         | a `find` does not occur exactly `count` times (1 when omitted); then nothing is written |
| `$PLAN/tools/derule.mjs <file.css> --classes a,b [--keyframes x,y]`  | Deletes every rule each of whose selectors names one of the classes; from a mixed selector list, only the selectors that do. The comment sitting directly on a removed rule goes with it, and an `@media` block left empty. | —                                                                                       |
| `$PLAN/tools/unexport.mjs <list.tsv>`                                | Removes the `export` keyword from the declarations listed, one `<file>\t<name>` per line.                                                                                                                                   | a declaration is not found exactly once; then nothing is written                        |

**The patches.** A patch is applied like this, and never any other way:

```sh
git apply --check $PLAN/patches/<name>.patch
git apply $PLAN/patches/<name>.patch
```

A patch touches only the files its task owns; `git apply` does not stage anything and does not touch the index. If `git apply --check` fails, the file has moved since the plan was written. Do not use `--reject` or `--3way`, and do not edit the patch to fit. Read the patch, read the file, make the same change by hand, and say in your report that you did.

Where a task is test-first, it has two patches: `NN-…-test.patch` (the failing test and its fixtures) and `NN-…-impl.patch`.

## File structure

What is created, and what each file is for. Files that are only modified are named in the task that owns them.

| File                                                          | Responsibility                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `scripts/design/source.mjs`                                   | The static check's command: walks `apps/web/src` and `packages/ui/src`, prints, exits.              |
| `scripts/design/lib/source-rules.mjs`                         | The six rules, as pure functions over text.                                                         |
| `scripts/design/source.test.mjs`                              | One passing and one failing fixture per rule, and the command's exit status.                        |
| `scripts/design/fixtures/source/*`                            | The fixture files the rules are tested against.                                                     |
| `scripts/design/run.mjs`                                      | The runner behind `npm run design:check` and `design:shots`.                                        |
| `scripts/design/lib/servers.mjs`                              | Ports, the environment Next runs in, starting and stopping both servers.                            |
| `scripts/design/servers.test.mjs`                             | The runner's decision about the ports, in every position.                                           |
| `scripts/design/lib/browser.mjs`                              | Finding Playwright and launching Chromium (moved out of `lib/render.mjs`).                          |
| `scripts/design/compare.mjs`                                  | Two folders of screenshots, and which screens differ.                                               |
| `scripts/design/lib/compare-page.mjs`                         | The pixel comparison, run in the browser.                                                           |
| `scripts/design/lib/compare-report.mjs`                       | What a difference is called: `DIFFERS`, `NOISE`, `RESIZED`.                                         |
| `scripts/design/compare.test.mjs`                             | The report's wording and the noise rule.                                                            |
| `scripts/design/lib/only.mjs`, `scripts/design/only.test.mjs` | `DESIGN_ROUTES`: the routes one run visits.                                                         |
| `scripts/design/probe.test.mjs`                               | Finding the colours in a computed value.                                                            |
| `scripts/design/mirror.test.mjs`                              | `packages/ui/src/tokens.ts` against `styles.css`.                                                   |
| `scripts/design/fixtures/sample-launches.mts`                 | Two sample launches for the fixture API.                                                            |
| `packages/ui/src/tokens.ts`                                   | The five token values code must hold as values.                                                     |
| `apps/web/src/features/auth/lib/passkey-entry.ts`             | The `/passkey?state=add` design preview and its fixture.                                            |
| `apps/web/test/passkey-entry.test.ts`                         | That door, shut in production.                                                                      |
| `apps/web/src/features/studio/sections/rail.ts`               | The one list of studio sections, and the Soon panel's copy.                                         |
| `apps/web/src/features/studio/sections/soon.tsx`              | The one Soon panel (replaces `sections/stub.tsx`).                                                  |
| `apps/web/test/studio-rail.test.ts`                           | The list against the section keys.                                                                  |
| `.github/workflows/design.yml`                                | The static check and the harness unit tests on every pull request; the rendered checks beside them. |

## Batches

A batch is a set of tasks that share no file. Tasks inside a batch marked **parallel** may be given to different implementers at the same time. Batches run in the order below, one after another, except batch I, which shares no file with any other batch and may run at any time after batch A.

| Batch                     | Spec step                                   | Tasks                    | Inside the batch                               |
| ------------------------- | ------------------------------------------- | ------------------------ | ---------------------------------------------- |
| A — foundations           | 1 (and the part of 6 a baseline needs, J25) | 1, 2, 3, 4               | sequential                                     |
| B — backdrop and surfaces | 2                                           | 5, 6, 7, 8, then 9       | 5–8 parallel; 9 after all four                 |
| C — aliases               | 3a                                          | 10, 11, 12, 13, 14       | parallel                                       |
| D — legacy tokens         | 3b                                          | 15, then 16–21, then 22  | 15 alone; 16–21 parallel; 22 alone             |
| E — literals              | 3c                                          | 23, 24, 25, then 26      | 23–25 parallel; 26 after all three             |
| F — dead code             | 4                                           | 27, 28, 29, 31, then 30  | 27, 28, 29, 31 parallel; 30 after all four     |
| G — studio                | 5                                           | 32                       | one task                                       |
| H — harness, strict, CI   | 6                                           | 33, 34, then 35, then 36 | 33 and 34 parallel; 35 after both; 36 after 35 |
| I — infrastructure        | 7                                           | 37, then 38              | sequential; independent of B–H                 |
| J — close                 | —                                           | 39, then 40              | sequential, last                               |

The stylesheets are touched by several batches, which is why the batches are sequential. So are `packages/ui/src/styles.css` (tasks 9, 15, 22), `scripts/design/routes.mjs` (tasks 2, 3, 5, 34) and `packages/ui/src/chart.tsx` (tasks 22, 26). `package.json` is touched by tasks 1, 2 and 35. No two tasks in the same parallel group own the same file.

**After every task the tree compiles and every gate passes.** A task's last step before its commit is the list of gates it names; the design checks are part of that list from task 4 on. A task that cannot get its gates green does not commit: it reports.

## Task list

| #   | Task                                                                              | Batch | Owns                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The static source check, report only                                              | A     | `scripts/design/source.mjs`, `scripts/design/lib/source-rules.mjs`, `scripts/design/source.test.mjs`, `scripts/design/fixtures/source/**`, `package.json`                                                                                                                                                                                                                                                            |
| 2   | The runner, the screenshot folder and the comparison                              | A     | `scripts/design/run.mjs`, `compare.mjs`, `shots.mjs`, `routes.mjs` (the export only), `servers.test.mjs`, `compare.test.mjs`, `only.test.mjs`, `lib/browser.mjs`, `lib/servers.mjs`, `lib/only.mjs`, `lib/compare-page.mjs`, `lib/compare-report.mjs`, `lib/render.mjs`; `.gitignore`; `package.json`                                                                                                                |
| 3   | Every route where a check can see it                                              | A     | `apps/web/src/app/(auth)/passkey/page.tsx`, `features/auth/components/passkey-flow.tsx`, `features/auth/components/steps/add-passkey-step.tsx`, `features/auth/lib/passkey-entry.ts`, `features/agents/components/launch-board.tsx`, `apps/web/test/passkey-entry.test.ts`, `scripts/design/fixtures/sample-launches.mts`, `scripts/design/fixture-api.mjs`, `scripts/design/routes.mjs`                             |
| 4   | The baseline                                                                      | A     | nothing in git; writes `scripts/design/.shots/`                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | The three `/agents` routes on the light surface                                   | B     | `features/agents/components/public-shell.tsx`, `app/agents/page.tsx`, `app/agents/[handle]/page.tsx`, `app/agents/[handle]/ask/page.tsx`, `features/agents/agents.module.css`, `scripts/design/routes.mjs`                                                                                                                                                                                                           |
| 6   | `/apply` on the plain dark ground                                                 | B     | `features/apply/components/apply-shell.tsx`, `features/apply/apply.module.css`                                                                                                                                                                                                                                                                                                                                       |
| 7   | The sign-in screens without the floor                                             | B     | `app/(auth)/layout.tsx`, `features/auth/auth.module.css`                                                                                                                                                                                                                                                                                                                                                             |
| 8   | The trade ticket's orders off the sky's edge                                      | B     | `features/markets/markets.module.css`                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | The sky's tokens, and the batch's picture                                         | B     | `packages/ui/src/styles.css`                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | Aliases: `agents`                                                                 | C     | `features/agents/agents.module.css`                                                                                                                                                                                                                                                                                                                                                                                  |
| 11  | Aliases and variant variables: `auth`                                             | C     | `features/auth/auth.module.css`                                                                                                                                                                                                                                                                                                                                                                                      |
| 12  | Aliases and variant variables: `markets`                                          | C     | `features/markets/markets.module.css`                                                                                                                                                                                                                                                                                                                                                                                |
| 13  | Aliases: `apply`                                                                  | C     | `features/apply/apply.module.css`                                                                                                                                                                                                                                                                                                                                                                                    |
| 14  | Variant variables: `landing`, `create`, `home`                                    | C     | `features/landing/landing.module.css`, `features/studio/create/create.module.css`, `features/studio/home/home.module.css`                                                                                                                                                                                                                                                                                            |
| 15  | The token file: new tokens, the tint's prefix, its own legacy reads and literals  | D     | `packages/ui/src/styles.css`, `features/studio/studio.module.css` (the 37 `--tint-*` reads)                                                                                                                                                                                                                                                                                                                          |
| 16  | Legacy tokens: `agents`                                                           | D     | `features/agents/agents.module.css`                                                                                                                                                                                                                                                                                                                                                                                  |
| 17  | Legacy tokens: `auth`                                                             | D     | `features/auth/auth.module.css`, `features/auth/components/second-passkey.module.css`                                                                                                                                                                                                                                                                                                                                |
| 18  | Legacy tokens: `markets`                                                          | D     | `features/markets/markets.module.css`                                                                                                                                                                                                                                                                                                                                                                                |
| 19  | Legacy tokens: `studio`                                                           | D     | `features/studio/studio.module.css`                                                                                                                                                                                                                                                                                                                                                                                  |
| 20  | Legacy tokens: `home`, `create`                                                   | D     | `features/studio/home/home.module.css`, `features/studio/create/create.module.css`                                                                                                                                                                                                                                                                                                                                   |
| 21  | Legacy tokens: the small sheets                                                   | D     | `features/apply/apply.module.css`, `features/account/account.module.css`, `app/globals.css`, `features/wallet/components/activity-page.module.css`, `claim-handle.module.css`, `connect-gate.module.css`, `connect-modal.module.css`                                                                                                                                                                                 |
| 22  | The fourteen legacy definitions go                                                | D     | `packages/ui/src/styles.css`, `packages/ui/src/chart.tsx`, `scripts/design/levels.test.mjs`                                                                                                                                                                                                                                                                                                                          |
| 23  | Literals: `apply`                                                                 | E     | `features/apply/apply.module.css`                                                                                                                                                                                                                                                                                                                                                                                    |
| 24  | Literals: `auth`                                                                  | E     | `features/auth/auth.module.css`                                                                                                                                                                                                                                                                                                                                                                                      |
| 25  | Literals: the small sheets, and the undefined token                               | E     | `features/agents/agents.module.css`, `features/markets/markets.module.css`, `features/wallet/components/connect-modal.module.css`, `claim-handle.module.css`                                                                                                                                                                                                                                                         |
| 26  | The palettes in TypeScript, and the mirror                                        | E     | `apps/web/src/lib/accent.ts`, `features/apply/lib/options.ts`, `features/apply/components/application-form.tsx`, `submitted.tsx`, `app/layout.tsx`, `packages/ui/src/tokens.ts`, `index.ts`, `chart.tsx`, `packages/ui/package.json`, `scripts/design/mirror.test.mjs`                                                                                                                                               |
| 27  | Dead classes: `agents`                                                            | F     | `features/agents/agents.module.css`                                                                                                                                                                                                                                                                                                                                                                                  |
| 28  | Dead classes: `auth`                                                              | F     | `features/auth/auth.module.css`                                                                                                                                                                                                                                                                                                                                                                                      |
| 29  | Dead classes: `landing`, `home`, `studio`                                         | F     | `features/landing/landing.module.css`, `features/studio/home/home.module.css`, `features/studio/studio.module.css`                                                                                                                                                                                                                                                                                                   |
| 30  | Dead exports, and the retired signer path                                         | F     | 35 files under `apps/web/src` named in `maps/30-unexport.tsv`; `features/agents/components/agent-parts.tsx`, `features/agents/lib/empty.ts`, `features/agents/agents.module.css`, `features/auth/lib/shapes.ts`, `features/studio/api.ts`, `features/wallet/lib/signer-adapters.ts`, `sign-in-words.ts`, `connect.ts`; `apps/web/test/marketplace-empty.test.ts`, `signer-adapters.test.ts`, `sign-in-words.test.ts` |
| 31  | `/console`                                                                        | F     | `apps/web/src/app/console/page.tsx`, `apps/web/AGENTS.md` (one sentence)                                                                                                                                                                                                                                                                                                                                             |
| 32  | One rail list and one Soon panel                                                  | G     | `features/studio/sections/rail.ts`, `soon.tsx`, `stub.tsx` (deleted), `overview.tsx`, `context.tsx`, `features/studio/studio.tsx`, `features/studio/home/menu.tsx`, `empty.tsx`, `apps/web/test/studio-rail.test.ts`                                                                                                                                                                                                 |
| 33  | The runtime token check reads gradients, shadows, filters, outlines and SVG paint | H     | `scripts/design/lib/probe.mjs`, `scripts/design/tokens.mjs`, `scripts/design/probe.test.mjs`, `packages/ui/src/brand.tsx`                                                                                                                                                                                                                                                                                            |
| 34  | Every studio section has a route                                                  | H     | `scripts/design/routes.mjs`                                                                                                                                                                                                                                                                                                                                                                                          |
| 35  | The static check fails                                                            | H     | `package.json`                                                                                                                                                                                                                                                                                                                                                                                                       |
| 36  | CI                                                                                | H     | `.github/workflows/design.yml`                                                                                                                                                                                                                                                                                                                                                                                       |
| 37  | Infrastructure: the shared exports move                                           | I     | `packages/infrastructure/src/persistence/growth-store.ts`, `persistence/agent-registry.ts`, `supabase/supabase-applicants.ts`, `supabase/supabase-waitlist.ts`, `supabase/agent-registry/supabase-agent-registry.ts`, `src/index.ts`                                                                                                                                                                                 |
| 38  | Infrastructure: the unused adapters go                                            | I     | eight files under `packages/infrastructure/src/supabase/`, four tests and one fixture under `packages/infrastructure/test/`, `src/index.ts`, `packages/infrastructure/AGENTS.md`, `workers/api/AGENTS.md`, `docs/public-data-audit.md`                                                                                                                                                                               |
| 39  | The documents say what the code does                                              | J     | `apps/web/AGENTS.md`, `packages/ui/AGENTS.md`, `docs/specs/cleanup-and-design-system-v1.md`, `docs/specs/design-system-v2.md`                                                                                                                                                                                                                                                                                        |
| 40  | The last comparison and every gate                                                | J     | nothing                                                                                                                                                                                                                                                                                                                                                                                                              |

Paths beginning `features/` and `app/` are under `apps/web/src/`.

---

# Batch A — foundations

Sequential: task 1, then 2, then 3, then 4.

## Task 1: The static source check, report only

The measure of done. It reads the source and reports every violation of six rules without failing, so every later task has a number that has to fall. Task 35 makes it fail.

**Owns:** `scripts/design/lib/source-rules.mjs`, `scripts/design/source.mjs`, `scripts/design/source.test.mjs`, `scripts/design/fixtures/source/` (18 files) — all created; `package.json` — modified.

**The rules** (`rule` is the word the report prints):

| Rule               | Fails when                                                                                                                                                            | Where                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `colour-literal`   | a declaration's value holds a hex colour, `rgb()`, `rgba()`, `hsl()`, `hsla()` or a named colour other than `transparent`, `currentColor` and `inherit`               | every CSS file; in `packages/ui/src/styles.css` a literal is allowed inside a `--pk-*` definition and nowhere else      |
| `token-definition` | `--pk-*` is defined                                                                                                                                                   | every CSS file but `styles.css`; every TypeScript file but `apps/web/src/lib/accent.ts` and `packages/ui/src/tokens.ts` |
| `token-alias`      | a custom property's whole value is `var(--pk-…)`; in TypeScript, a string holds `var(--pk-`                                                                           | every CSS file but `styles.css`; every TypeScript file but `apps/web/src/lib/accent.ts`                                 |
| `undefined-token`  | a `--pk-*` name is read and `styles.css` does not define it                                                                                                           | everywhere                                                                                                              |
| `colour-in-ts`     | a string holds a hex colour or `rgb()`/`hsl()`; a string given to `href`, `to`, `id`, `htmlFor`, `aria-controls` or `aria-labelledby` is an address and is not judged | every TypeScript file but `packages/ui/src/tokens.ts` and `packages/ui/src/brand.tsx`                                   |
| `unused-class`     | a CSS module defines a class no importer names, and it is not in `KEEP`                                                                                               | every `*.module.css`                                                                                                    |

`tokens.ts` and the swatch half of `accent.ts` do not exist yet. The check names both files now so that task 26, which writes them, need not touch it. `KEEP`, in `source.mjs`, lists the ten classes reached only through a computed `styles[...]`, each with the file that computes it.

**The fixtures**, one that breaks each rule and one that does not. Every test reads real files, so what is tested is what the check reads: whole stylesheets with comments, continued values and selectors.

| Fixture                                                 | Pins                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tokens.css`                                            | the token file the others are judged against; a name in a comment defines nothing                                                                                                                      |
| `colour-literal.pass.module.css` / `.fail.module.css`   | tokens, keywords, a font called Tan, an animation called `pink` pass; hex, short hex, `rgba()`, a triple inside `rgba()`, `hsl()`, `white`, and a literal on the second line of a continued value fail |
| `token-file.pass.css` / `.fail.css`                     | in the token file a literal passes in a definition and fails in a rule                                                                                                                                 |
| `token-definition.pass.module.css` / `.fail.module.css` | a module's own `--width` passes; `--pk-ink` in a module fails                                                                                                                                          |
| `token-alias.pass.module.css` / `.fail.module.css`      | `--edge: 1px solid var(--pk-rule)` passes; `--ink: var(--pk-ink)` and a per-variant `--hue: var(--pk-lime)` fail                                                                                       |
| `undefined-token.pass.module.css` / `.fail.module.css`  | a read with a fallback is still a read of something undefined                                                                                                                                          |
| `colour-in-ts.pass.tsx` / `.fail.tsx`                   | `href="#feed"`, selectors, comments and prose pass; hex and `rgb()` in strings, templates and JSX attributes fail                                                                                      |
| `token-ts.pass.ts` / `.fail.ts`                         | reading a token by name and a template family pass; an alias, a definition and an undefined name fail                                                                                                  |
| `token-mirror.pass.ts`                                  | token-named keys pass in the mirror and fail anywhere else                                                                                                                                             |
| `unused-class.module.css` + `unused-class.reader.tsx`   | classes named, quoted, composed or kept pass; an orphan, and one inside `@media`, are reported                                                                                                         |

- [ ] **Step 1: Write the failing test and its fixtures**

```sh
git apply --check $PLAN/patches/01-source-test.patch && git apply $PLAN/patches/01-source-test.patch
```

It creates `scripts/design/source.test.mjs` (24 tests) and the 18 fixture files.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/design/source.test.mjs`

Expected: FAIL, naming the missing module: `Cannot find module '…/scripts/design/lib/source-rules.mjs'`.

- [ ] **Step 3: Write the rules and the command**

```sh
git apply --check $PLAN/patches/01-source-impl.patch && git apply $PLAN/patches/01-source-impl.patch
```

It creates `scripts/design/lib/source-rules.mjs` (the rules, as pure functions over text: `definedTokens`, `declarations`, `literalsIn`, `checkCss`, `strings`, `checkTs`, `definedClasses`, `composedClasses`, `readClasses`, `unusedClasses`) and `scripts/design/source.mjs` (the command). In `package.json` it appends `scripts/design/*.test.mjs` to the `test` script's list of globs, which also puts the thirteen tests of `colour.test.mjs` and `levels.test.mjs` under `npm test` for the first time, and adds:

```json
    "design:source": "node scripts/design/source.mjs"
```

Read both new files before going on. `source.mjs` lists tracked and untracked files (`git ls-files --cached --others --exclude-standard`), so a file somebody has just written is checked before it is added.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/design/source.test.mjs`

Expected: PASS, `tests 24`, `pass 24`, `fail 0`.

- [ ] **Step 5: Run the check over the tree, and record the number**

Run: `npm run design:source | tail -1`

Expected, exactly, with exit status 0:

```
source: 320 violation(s) — colour-in-ts 21, colour-literal 102, token-alias 100, undefined-token 1, unused-class 96. Report only; --strict fails on them.
```

These five numbers are the starting point. Each later task says what they are after it.

- [ ] **Step 6: Gates**

Run: `node --import tsx --test scripts/design/*.test.mjs` — expected `tests 37`, `fail 0`.

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add scripts/design/lib/source-rules.mjs scripts/design/source.mjs \
  scripts/design/source.test.mjs scripts/design/fixtures/source package.json
git commit -m "$(cat <<'MSG'
Design: a static source check, reporting only

Six rules over apps/web/src and packages/ui/src: colour literals, --pk-*
definitions and aliases outside the token file, tokens read and never
defined, colours in TypeScript, and classes nothing names. It reports
320 violations today and fails on none of them yet.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- scripts/design/lib/source-rules.mjs scripts/design/source.mjs \
  scripts/design/source.test.mjs scripts/design/fixtures/source package.json
```

## Task 2: The runner, the screenshot folder and the comparison

One command that starts the two servers, runs the checks and stops what it started; screenshots into a named folder; a comparison of two folders; and a way to visit only some routes. Nothing here changes what a check measures.

**Owns:** created — `scripts/design/lib/browser.mjs`, `lib/servers.mjs`, `lib/only.mjs`, `lib/compare-page.mjs`, `lib/compare-report.mjs`, `scripts/design/run.mjs`, `compare.mjs`, `servers.test.mjs`, `compare.test.mjs`, `only.test.mjs`; modified — `scripts/design/lib/render.mjs`, `scripts/design/shots.mjs`, `scripts/design/routes.mjs` (the export only), `.gitignore`, `package.json`.

- [ ] **Step 1: Write the failing tests**

```sh
git apply --check $PLAN/patches/02-runner-test.patch && git apply $PLAN/patches/02-runner-test.patch
node --test scripts/design/servers.test.mjs scripts/design/compare.test.mjs scripts/design/only.test.mjs
```

Expected: FAIL in all three files, with `Cannot find module` naming `lib/servers.mjs`, `lib/compare-report.mjs` and `lib/only.mjs`.

What they pin: the runner starts the servers only when both ports are free, measures a named server as it is, and refuses a taken port by name (`servers.test.mjs`, 6 tests); what a difference is called — nothing, `DIFFERS`, `RESIZED`, and `NOISE` when a screen listed in a noise file moved no more than three times what it moved there, or 0.05% (`compare.test.mjs`, 6 tests); `DESIGN_ROUTES` visits the routes named and refuses a name that matches nothing (`only.test.mjs`, 3 tests).

- [ ] **Step 2: Write the implementation**

```sh
git apply --check $PLAN/patches/02-runner-impl.patch && git apply $PLAN/patches/02-runner-impl.patch
git apply --check $PLAN/patches/02-routes-filter.patch && git apply $PLAN/patches/02-routes-filter.patch
git apply --check $PLAN/patches/02-package.patch && git apply $PLAN/patches/02-package.patch
```

What each does:

| File                                                            | Change                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/servers.mjs`                                               | `FIXTURE_PORT` 8799, `WEB_PORT` 3001; `listening(port)`; `webEnv(env)` (the fixture's URL, both Supabase variables empty); `plan({ baseUrl, fixtureBusy, webBusy })`; `start(root, log)`, which spawns both servers in their own process groups, waits for each to answer, and returns `stop()`. `stop()` also puts back `apps/web/next-env.d.ts`, which `next dev` rewrites. |
| `run.mjs`                                                       | the runner: the static check, then the rendered checks named, against servers it starts, or against `DESIGN_BASE_URL` when that is set. `--strict` is handed to the static check. Exit 0, 1 or 2.                                                                                                                                                                             |
| `lib/browser.mjs`                                               | `openBrowser()`: finding Playwright and launching Chromium, moved here unchanged from `lib/render.mjs` so the comparison can use it without a server                                                                                                                                                                                                                          |
| `lib/render.mjs`                                                | imports `openBrowser`; its remedies name `npm run design:check` and the environment the web app needs                                                                                                                                                                                                                                                                         |
| `lib/only.mjs`, `routes.mjs`                                    | `ROUTES` becomes `only(ALL, process.env.DESIGN_ROUTES)`                                                                                                                                                                                                                                                                                                                       |
| `shots.mjs`                                                     | writes to `DESIGN_SHOTS_DIR` when set; `animations: "disabled"`                                                                                                                                                                                                                                                                                                               |
| `lib/compare-page.mjs`, `lib/compare-report.mjs`, `compare.mjs` | the comparison; `--noise <file>`, `--partial`                                                                                                                                                                                                                                                                                                                                 |
| `.gitignore`                                                    | `scripts/design/.shots/`                                                                                                                                                                                                                                                                                                                                                      |
| `package.json`                                                  | `design:check`, `design:shots`, `design:compare`                                                                                                                                                                                                                                                                                                                              |

- [ ] **Step 3: Run the tests to verify they pass**

Run: `node --test scripts/design/servers.test.mjs scripts/design/compare.test.mjs scripts/design/only.test.mjs`

Expected: PASS, `tests 15`, `fail 0`.

- [ ] **Step 4: Prove the refusal**

Occupy the web port with something that is not the app, and run one check:

```sh
lsof -nP -iTCP:3001 -sTCP:LISTEN   # must print nothing; if it prints, stop and see "How to run the design harness"
node -e '
const net = require("node:net");
const { spawnSync } = require("node:child_process");
net.createServer().listen(3001, "127.0.0.1", () => {
  const run = spawnSync(process.execPath, ["scripts/design/run.mjs", "type"], { encoding: "utf8" });
  process.stdout.write(run.stderr + "exit " + run.status + "\n");
  process.exit(0);
});'
```

Expected: `port 3001 already in use, and this runner did not start what is there.`, a second line naming `DESIGN_BASE_URL`, and `exit 2`.

- [ ] **Step 5: Prove the run**

Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check; echo "exit $?"
lsof -nP -iTCP:3001 -sTCP:LISTEN; lsof -nP -iTCP:8799 -sTCP:LISTEN
git status --short apps/web/next-env.d.ts
```

Expected:

- the static report, ending `source: 320 violation(s) — …`;
- `starting the fixture API and the web app (log: …/scripts/design/.shots/servers.log)`;
- four checks, each ending `<check>: 1 of 50 route(s) could not be visited at all…`. The one blocked route is `/tokens`, whose proof went stale when main replaced the token board; task 3 repairs it. No line starts with `FAIL`;
- `exit 1`, because a blocked route is a failure;
- the two `lsof` commands print nothing: the runner stopped what it started;
- `git status` prints nothing: the runner put `next-env.d.ts` back.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add scripts/design/lib/browser.mjs scripts/design/lib/servers.mjs scripts/design/lib/only.mjs \
  scripts/design/lib/compare-page.mjs scripts/design/lib/compare-report.mjs \
  scripts/design/lib/render.mjs scripts/design/run.mjs scripts/design/compare.mjs \
  scripts/design/shots.mjs scripts/design/routes.mjs scripts/design/servers.test.mjs \
  scripts/design/compare.test.mjs scripts/design/only.test.mjs .gitignore package.json
git commit -m "$(cat <<'MSG'
Design: one command that starts its servers, and a way to compare shots

npm run design:check starts the fixture API and the web app, runs the
checks and stops what it started; a port already taken is refused
rather than measured. Screenshots go to a named folder with animations
off, design:compare says which screens differ between two folders, and
DESIGN_ROUTES visits only the routes it names.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- scripts/design/lib/browser.mjs scripts/design/lib/servers.mjs scripts/design/lib/only.mjs \
  scripts/design/lib/compare-page.mjs scripts/design/lib/compare-report.mjs \
  scripts/design/lib/render.mjs scripts/design/run.mjs scripts/design/compare.mjs \
  scripts/design/shots.mjs scripts/design/routes.mjs scripts/design/servers.test.mjs \
  scripts/design/compare.test.mjs scripts/design/only.test.mjs .gitignore package.json
```

## Task 3: Every route where a check can see it

Two routes cannot be measured today. `/tokens` is blocked because its proof names a screen main replaced, and the fixture API has no `/v1/launches`. `/passkey` has no entry, and without a session its only screen is "your account could not be read". After this task the harness visits 51 routes and blocks none.

**Owns:** created — `apps/web/src/features/auth/lib/passkey-entry.ts`, `apps/web/test/passkey-entry.test.ts`, `scripts/design/fixtures/sample-launches.mts`; modified — `apps/web/src/app/(auth)/passkey/page.tsx`, `apps/web/src/features/auth/components/passkey-flow.tsx`, `apps/web/src/features/auth/components/steps/add-passkey-step.tsx`, `apps/web/src/features/agents/components/launch-board.tsx`, `scripts/design/fixture-api.mjs`, `scripts/design/routes.mjs`.

- [ ] **Step 1: Write the failing test for the door**

```sh
git apply --check $PLAN/patches/03-door-test.patch && git apply $PLAN/patches/03-door-test.patch
node --import tsx --test apps/web/test/passkey-entry.test.ts
```

Expected: FAIL with `Cannot find module '../src/features/auth/lib/passkey-entry'`.

The five tests: `?state=add` opens the screen outside production; in production the same link is the ordinary page; an unknown state is no preview; a repeated parameter reads its first value; the preview's account holds one passkey.

- [ ] **Step 2: Write the door, and give both screens a hook**

```sh
git apply --check $PLAN/patches/03-door-impl.patch && git apply $PLAN/patches/03-door-impl.patch
node --import tsx --test apps/web/test/passkey-entry.test.ts
```

Expected: PASS, `tests 5`, `fail 0`.

| File                                                  | Change                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `features/auth/lib/passkey-entry.ts`                  | `passkeyPreviewFromSearch(nodeEnv, asked)`, shut in production, and `PREVIEW_PASSKEYS`, one fixture passkey on a fixed date |
| `app/(auth)/passkey/page.tsx`                         | reads `searchParams.state` and passes `passkeyPreview`                                                                      |
| `features/auth/components/passkey-flow.tsx`           | `PasskeyAddFlow` takes `preview`; with it, the screen opens on `add` with the fixture list and its effect reads nothing     |
| `features/auth/components/steps/add-passkey-step.tsx` | `id="passkey-add"`                                                                                                          |
| `features/agents/components/launch-board.tsx`         | `id="launch-board"` on the board, `id="launch-board-empty"` on its empty states                                             |

- [ ] **Step 3: Give the fixture API a launch catalogue, and the harness its two routes**

```sh
git apply --check $PLAN/patches/03-harness.patch && git apply $PLAN/patches/03-harness.patch
```

`scripts/design/fixtures/sample-launches.mts` holds two launches, typed by `LaunchSummaryDto`: `$HALF`, on the curve and linked to an agent, and `$TAPE`, graduated and linked to none, so the board's UNLINKED AGENT chip is measured too. `fixture-api.mjs` serves them at `/v1/launches` and defaults to port 8799, the port every remedy already names. In `routes.mjs` the `/tokens` route proves `#launch-board a[href="/tokens/HALF"]`, and `/passkey?state=add`, named `passkey-add`, proving `#passkey-add`, becomes the fifty-first route.

- [ ] **Step 4: Run the checks**

Look at the ports, then run, with a timeout of twenty minutes: `npm run design:check; echo "exit $?"`

Expected: the static report (still 320), then

```
surfaces: clean over all 51 route(s).
tokens: clean over all 51 route(s).
contrast: clean over all 51 route(s).
type: clean over all 51 route(s).
exit 0
```

No line starts with `BLOCKED` or `FAIL`.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(auth)/passkey/page.tsx" \
  apps/web/src/features/auth/components/passkey-flow.tsx \
  apps/web/src/features/auth/components/steps/add-passkey-step.tsx \
  apps/web/src/features/auth/lib/passkey-entry.ts \
  apps/web/src/features/agents/components/launch-board.tsx \
  apps/web/test/passkey-entry.test.ts \
  scripts/design/fixtures/sample-launches.mts scripts/design/fixture-api.mjs \
  scripts/design/routes.mjs
git commit -m "$(cat <<'MSG'
Design: no route the harness cannot see

/tokens proves the launch board, from two sample launches the fixture
API now serves. /passkey?state=add, outside production only, draws the
add-a-passkey screen without a session, and is the fifty-first route.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- "apps/web/src/app/(auth)/passkey/page.tsx" \
  apps/web/src/features/auth/components/passkey-flow.tsx \
  apps/web/src/features/auth/components/steps/add-passkey-step.tsx \
  apps/web/src/features/auth/lib/passkey-entry.ts \
  apps/web/src/features/agents/components/launch-board.tsx \
  apps/web/test/passkey-entry.test.ts \
  scripts/design/fixtures/sample-launches.mts scripts/design/fixture-api.mjs \
  scripts/design/routes.mjs
```

## Task 4: The baseline

Nothing is committed in this task. It produces the pictures every visual task is judged against, and the list of screens that move by themselves.

**Owns:** nothing in git. Writes `scripts/design/.shots/baseline/`, `baseline-2/`, `noise.txt` and `baseline-check.txt`.

**Precondition:** tasks 1–3 are committed and `git status --short apps/web/src packages/ui/src` prints nothing. A baseline taken over somebody's uncommitted edit is a baseline of that edit.

- [ ] **Step 1: Record what the checks say before anything changes**

Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check > scripts/design/.shots/baseline-check.txt 2>&1; echo "exit $?"
grep -c '^looked at' scripts/design/.shots/baseline-check.txt
grep -E '^(BLOCKED|FAIL)' scripts/design/.shots/baseline-check.txt
```

Expected: `exit 0`; `204` (51 routes, four checks); the last command prints nothing.

- [ ] **Step 2: Capture the baseline, twice**

```sh
DESIGN_SHOTS_DIR=scripts/design/.shots/baseline npm run design:shots
DESIGN_SHOTS_DIR=scripts/design/.shots/baseline-2 npm run design:shots
ls scripts/design/.shots/baseline | wc -l
ls scripts/design/.shots/baseline-2 | wc -l
```

Expected: each run ends `shots: clean over all 51 route(s).`, and each folder holds `102` files (51 routes at two widths).

- [ ] **Step 3: Measure the noise**

```sh
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/baseline-2 \
  > scripts/design/.shots/noise.txt
cat scripts/design/.shots/noise.txt
```

Expected: about twenty `DIFFERS` lines, each under 0.5% of pixels, and a last line of the form `compare: 83 screen(s) identical, 0 within noise, 19 to look at, of 102.` Nothing changed between the two captures, so every one of them is noise: screens that draw a clock, a countdown or a chart from the current time. In the verified run they were the eight `market-*` shots, `token`, `studio-picks` and `studio-activity` at both widths, and a handful of pixels on `account-phone`, `account-security-phone`, `read-phone`, `passkey-add-desktop` and `studio-home-draft-phone`.

The list is not the same on every machine or every run. A screen of those families that shows up later as `DIFFERS` by less than 0.5%, inside the same small box, without being in `noise.txt`, is noise too: capture it once more with `DESIGN_ROUTES` and compare the two captures before calling it a change.

If a line shows more than 5%, or `RESIZED`, that screen is not stable enough to compare: open both PNGs, and tell the team lead which screen before going on.

- [ ] **Step 4: Report**

Report to the team lead: the two counts, the last line of `noise.txt`, and the names of the screens in it. There is no commit.

---

# Batch B — the backdrop and the surfaces

Tasks 5, 6, 7 and 8 share no file and may run in parallel. Task 9 runs after all four are committed.

**The harness has one pair of ports.** Implementers working in parallel take turns at it: look at the ports first, and if they are taken, wait and look again. Each of these tasks captures only its own routes (`DESIGN_ROUTES`), which takes about a minute once the server is warm, and compares them with the baseline using `--partial`.

## Task 5: The three `/agents` routes on the light surface

**Owns:**

- Modify: `apps/web/src/features/agents/components/public-shell.tsx`
- Modify: `apps/web/src/app/agents/page.tsx`
- Modify: `apps/web/src/app/agents/[handle]/page.tsx`
- Modify: `apps/web/src/app/agents/[handle]/ask/page.tsx`
- Modify: `apps/web/src/features/agents/agents.module.css` (the rules `.space`, `.stars` and `.beatChip` only)
- Modify: `scripts/design/routes.mjs`

What was measured before writing this task: with `data-surface` flipped to `light` in the browser and the backdrop removed, `/agents` (161 text elements), `/agents/halftime` (41) and `/agents/halftime/ask` (32) paint no colour outside the tokens and have one contrast failure between them — the beat chip on the profile, lime on `#F5F6FA` at 1.22:1 (J26). The bodies already read tokens; what made them dark was the shell.

- [ ] **Step 1: Make the harness expect light, and see it fail**

`maps/05-routes.json` holds four edits to `scripts/design/routes.mjs`: the comment that explains why the three routes are declared dark is removed, and `surface: "dark"` becomes `surface: "light"` on `agents`, `agent-profile` and `agent-ask`.

```sh
node $PLAN/tools/reline.mjs scripts/design/routes.mjs $PLAN/maps/05-routes.json
npx prettier --write scripts/design/routes.mjs
```

Expected: `scripts/design/routes.mjs: 4 edit(s) applied`.

Look at the ports, then run: `DESIGN_ROUTES=agents,agent-profile,agent-ask node scripts/design/run.mjs surfaces; echo "exit $?"`

Expected: `FAIL` lines for each of the three routes, of the form `agents paints rgb(11, 13, 26) at div.agents-module__…__page but is a light surface, which is rgb(255, 255, 255)`, and `exit 1`.

- [ ] **Step 2: Take the prop and the backdrop out of the shell and its three callers**

```sh
git apply --check $PLAN/patches/05-shell.patch && git apply $PLAN/patches/05-shell.patch
```

`SiteNav` keeps its own `surface` prop, whose default is `"light"`; the landing still passes it.

- [ ] **Step 3: Remove the sky and the stars, and give the beat chip an ink**

```sh
node $PLAN/tools/derule.mjs apps/web/src/features/agents/agents.module.css --classes space,stars
```

Expected:

```
removed  .space
removed  .stars
apps/web/src/features/agents/agents.module.css: 2 rule(s) or selector(s) removed
```

Then the beat chip (J26). `maps/05-agents-css.json` holds one edit: in `.beatChip`, `color: var(--accent)` becomes `color: var(--accent-ink)`, with a comment saying why.

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/agents/agents.module.css $PLAN/maps/05-agents-css.json
npx prettier --write apps/web/src/features/agents/agents.module.css
```

Expected: `apps/web/src/features/agents/agents.module.css: 1 edit(s) applied`.

- [ ] **Step 4: Verify**

Run: `npm run design:source | tail -1`

Expected: `colour-literal` is one lower than before this task (101 if this task is the first of the batch to land; 90 when all of tasks 5–8 have). The other four numbers are unchanged.

Look at the ports, then run:

```sh
DESIGN_ROUTES=agents,agent-profile,agent-ask node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 3 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=agents,agent-profile,agent-ask DESIGN_SHOTS_DIR=scripts/design/.shots/task-05 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-05 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** all six shots, each `DIFFERS` at more than 99% of pixels — `agents`, `agent-profile` and `agent-ask`, desktop and phone. The ground goes from the night sky to white and every ink with it. Open `task-05/agents-desktop.png` and `task-05/agent-profile-desktop.png` and check by eye: a white ground; grey panels (`#F5F6FA`); near-black titles; the Ask buttons violet with white text; on the profile, the beat chip ("SPORTS") readable in dark green. No star, no gradient. Nothing else may differ, because nothing else was captured.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/agents/components/public-shell.tsx apps/web/src/app/agents/page.tsx \
  "apps/web/src/app/agents/[handle]/page.tsx" "apps/web/src/app/agents/[handle]/ask/page.tsx" \
  apps/web/src/features/agents/agents.module.css scripts/design/routes.mjs
git commit -m "$(cat <<'MSG'
Marketplace: the agent pages on the light surface

/agents, /agents/[handle] and /agents/[handle]/ask were the only
marketplace routes on dark, and only because the shell drew a night sky
behind them. The sky and the stars are gone, PublicShell has no surface
prop, and the beat chip takes the accent's ink so it reads on white.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/agents/components/public-shell.tsx apps/web/src/app/agents/page.tsx \
  "apps/web/src/app/agents/[handle]/page.tsx" "apps/web/src/app/agents/[handle]/ask/page.tsx" \
  apps/web/src/features/agents/agents.module.css scripts/design/routes.mjs
```

## Task 6: `/apply` on the plain dark ground

**Owns:**

- Modify: `apps/web/src/features/apply/components/apply-shell.tsx`
- Modify: `apps/web/src/features/apply/apply.module.css` (the backdrop rules and the seven veil reads only)

The mapping (J5). Every row is one declaration in `apply.module.css`:

| Selector                 | Property            | Was                                       | Becomes                    |
| ------------------------ | ------------------- | ----------------------------------------- | -------------------------- |
| `.space`                 | the whole rule      | sky gradient                              | removed                    |
| `.stars`                 | the whole rule      | two dot layers, animated                  | removed                    |
| `.floorGrid`             | the whole rule      | neon floor                                | removed                    |
| `@keyframes stars`       | the whole block     | —                                         | removed                    |
| `.page .secondaryButton` | `background`        | `var(--pk-space-veil)`                    | `var(--pk-bg)`             |
| `.header`                | `background`        | `var(--pk-space-veil-strong)`             | `var(--pk-nav-bg)`         |
| `.header`                | `backdrop-filter`   | `blur(16px)`                              | removed: the bar is opaque |
| `.chip`                  | `background`        | `var(--pk-space-veil)`                    | `var(--pk-bg)`             |
| `.piece`                 | second `box-shadow` | `0 26px 60px var(--pk-space-veil-strong)` | `var(--pk-popover-shadow)` |
| `.well`                  | `background-color`  | `var(--pk-space-veil)`                    | `var(--pk-bg)`             |
| `.tile`                  | `background`        | `var(--pk-space-veil)`                    | `var(--pk-bg)`             |
| `.post`                  | `background`        | `var(--pk-space-veil-strong)`             | `var(--pk-bg)`             |

- [ ] **Step 1: Take the backdrop out of the shell**

```sh
git apply --check $PLAN/patches/06-shell.patch && git apply $PLAN/patches/06-shell.patch
```

- [ ] **Step 2: Remove the backdrop's rules**

```sh
node $PLAN/tools/derule.mjs apps/web/src/features/apply/apply.module.css \
  --classes space,stars,floorGrid --keyframes stars
```

Expected:

```
removed  .space
removed  .stars
removed  .floorGrid
removed  @keyframes stars
apps/web/src/features/apply/apply.module.css: 4 rule(s) or selector(s) removed
```

- [ ] **Step 3: Move the veil's readers**

`maps/06-apply-css.json` holds the eight edits of the table above. Its first removes the `Background` section header the rules above left empty.

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/apply/apply.module.css $PLAN/maps/06-apply-css.json
npx prettier --write apps/web/src/features/apply/apply.module.css
grep -c 'pk-space' apps/web/src/features/apply/apply.module.css
```

Expected: `8 edit(s) applied`, then `0`.

- [ ] **Step 4: Verify**

Run: `npm run design:source | tail -1`

Expected: `colour-literal` is six lower than before this task.

Look at the ports, then run: `DESIGN_ROUTES=apply-no-seat node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"`

Expected: four times `clean over all 1 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=apply-no-seat DESIGN_SHOTS_DIR=scripts/design/.shots/task-06 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-06 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** `apply-no-seat-desktop.png` and `apply-no-seat-phone.png`, each `DIFFERS` at more than 95% of pixels: the ground goes from the blue sky to the flat night blue `#0B0D1A`, and the stars and the floor are gone. Open the desktop shot: the header, "GET IN LINE FIRST.", the paragraph and the lime JOIN WAITLIST button are where they were, and nothing else is on the page.

The form behind the apply cookie (`ApplyFlow`) is not on any harness route. Its seven veil reads are covered by the static check and by this table, not by a picture; say so in your report.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/apply/components/apply-shell.tsx apps/web/src/features/apply/apply.module.css
git commit -m "$(cat <<'MSG'
Apply: the plain dark ground, no backdrop

The sky, the moving stars and the neon floor are gone. What read the
sky's veil reads the ground it now sits on: insets take --pk-bg, the
header --pk-nav-bg, the piece's drop shadow --pk-popover-shadow.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/apply/components/apply-shell.tsx apps/web/src/features/apply/apply.module.css
```

## Task 7: The sign-in screens without the floor

**Owns:**

- Modify: `apps/web/src/app/(auth)/layout.tsx`
- Modify: `apps/web/src/features/auth/auth.module.css` (the rule `.floor` and `@keyframes grid` only)

`.signinGlow`, `.signinStars` and the second `@keyframes stars` in the same file are already dead; task 28 removes them with the other dead classes.

- [ ] **Step 1: Take the floor out of the layout**

```sh
git apply --check $PLAN/patches/07-layout.patch && git apply $PLAN/patches/07-layout.patch
```

- [ ] **Step 2: Remove the floor's rule and its keyframes**

```sh
node $PLAN/tools/derule.mjs apps/web/src/features/auth/auth.module.css \
  --classes floor --keyframes grid
npx prettier --write apps/web/src/features/auth/auth.module.css
```

Expected:

```
removed  .floor
removed  @keyframes grid
apps/web/src/features/auth/auth.module.css: 2 rule(s) or selector(s) removed
```

- [ ] **Step 3: Verify**

Run: `npm run design:source | tail -1`

Expected: `colour-literal` is four lower than before this task.

Look at the ports, then run:

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 4 route(s).`, and `exit 0`. The contrast check's note about elements "over a background image" names fewer elements than in `baseline-check.txt`: the floor was one of the images.

- [ ] **Step 4: Capture and compare**

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add DESIGN_SHOTS_DIR=scripts/design/.shots/task-07 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-07 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** all eight shots, each `DIFFERS` by less than 0.5% of pixels, and only along the bottom of the viewport: on the desktop shots inside about `y 960–999` (`passkey-add-desktop.png` from `y 332`, where its page is shorter), on the phone shots inside `y 829–843`. That strip is where the floor's lines were. A difference anywhere above it is not expected.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(auth)/layout.tsx" apps/web/src/features/auth/auth.module.css
git commit -m "$(cat <<'MSG'
Auth: no neon floor under the sign-in screens

The floor was the same pre-v2 drawing as the sky. /signin, /signup and
/passkey keep the dark surface and lose the grid.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- "apps/web/src/app/(auth)/layout.tsx" apps/web/src/features/auth/auth.module.css
```

## Task 8: The trade ticket's orders off the sky's edge

**Owns:**

- Modify: `apps/web/src/features/markets/markets.module.css` (the rule `.order` only)

`.order` is the last reader of `--pk-space-edge-rgb` outside the token file. It draws in the trade ticket's review phase, on the ticket's light panel (J6).

- [ ] **Step 1: Move the reader**

`maps/08-markets-css.json` holds one edit: in `.order`, the nine-line comment about "the eighth scrim" and `background: rgba(var(--pk-space-edge-rgb), 0.4)` become a one-line comment and `background: var(--pk-panel-3)`.

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/markets/markets.module.css $PLAN/maps/08-markets-css.json
npx prettier --write apps/web/src/features/markets/markets.module.css
grep -rn 'pk-space' apps/web/src
```

Expected: `1 edit(s) applied`. The `grep` prints only lines of files another task of this batch owns and has not yet committed (`apply.module.css`, `agents.module.css`); none in `markets.module.css`.

- [ ] **Step 2: Verify**

Run: `npm run design:source | tail -1`

Expected: `colour-literal` is one lower than before this task.

Look at the ports, then run:

```sh
DESIGN_ROUTES=markets,market-ask,market-trade,market-trade-picked,market-ask-picked node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 5 route(s).`, and `exit 0`.

- [ ] **Step 3: Capture and compare**

```sh
DESIGN_ROUTES=markets,market-ask,market-trade,market-trade-picked,market-ask-picked DESIGN_SHOTS_DIR=scripts/design/.shots/task-08 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-08 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. The review phase is behind a connected wallet and no route reaches it, so no shot shows `.order`. Every line the comparison prints for the `market-*` screens must start with `NOISE`. Say in your report that this change was verified by the static check and the table, not by a picture.

- [ ] **Step 4: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/markets/markets.module.css
git commit -m "$(cat <<'MSG'
Markets: the ticket's orders sit on a panel step, not on the sky's edge

.order was the last reader of --pk-space-edge-rgb outside the token
file, on a light panel where that colour never belonged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/markets/markets.module.css
```

## Task 9: The sky's tokens, and the batch's picture

Runs alone, after tasks 5–8 are committed.

**Owns:**

- Modify: `packages/ui/src/styles.css` (the `:root` block only)

- [ ] **Step 1: Prove nothing reads them**

Run: `grep -rn 'pk-space' apps/web/src packages/ui/src scripts/design | grep -v '^packages/ui/src/styles.css'`

Expected: no output. If a line is printed, a task of this batch is not finished: stop and report.

- [ ] **Step 2: Remove the six tokens and the comments that describe them**

`maps/09-styles.json` holds two edits to `packages/ui/src/styles.css`, both inside `:root`. The first deletes everything from the comment that begins `/* The night sky the dark shells paint behind their content` through `--pk-space-veil-strong`: three comment blocks and the six definitions `--pk-space-core`, `--pk-space-mid`, `--pk-space-edge`, `--pk-space-edge-rgb`, `--pk-space-veil` and `--pk-space-veil-strong`. The second rewrites the comment above `--pk-glow-rim`, which still spoke of the sky, to name the three things that wear the rim.

```sh
node $PLAN/tools/reline.mjs packages/ui/src/styles.css $PLAN/maps/09-styles.json
```

Expected: `packages/ui/src/styles.css: 2 edit(s) applied`.

Run: `npx prettier --write packages/ui/src/styles.css && grep -c 'pk-space' packages/ui/src/styles.css`

Expected: `0`.

- [ ] **Step 3: The whole harness, and the batch's picture**

Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check; echo "exit $?"
DESIGN_SHOTS_DIR=scripts/design/.shots/task-09 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-09 \
  --noise scripts/design/.shots/noise.txt
```

Expected from the check: the static report ending `source: 308 violation(s) — colour-in-ts 21, colour-literal 90, token-alias 100, undefined-token 1, unused-class 96.`; four times `clean over all 51 route(s).`; `exit 0`.

**Expected differences, for the whole batch — sixteen shots and no others:**

| Screens                                                                 | How much                         | Why                                 |
| ----------------------------------------------------------------------- | -------------------------------- | ----------------------------------- |
| `agents`, `agent-profile`, `agent-ask` (desktop and phone)              | more than 99%                    | task 5: dark to light               |
| `apply-no-seat` (desktop and phone)                                     | more than 95%                    | task 6: the sky to the plain ground |
| `signin`, `signup`, `signup-passkey`, `passkey-add` (desktop and phone) | less than 0.5%, along the bottom | task 7: the floor                   |

Every other line starts with `NOISE`. The comparison's last line reads `compare: 71 screen(s) identical, 15 within noise, 16 to look at, of 102.`, give or take the noise count. This task's own change removes definitions nothing reads, so it moves no pixel.

- [ ] **Step 4: Move the baseline forward**

The sixteen differences are the ones the spec asks for. From here on, later tasks compare with the tree as it is now:

```sh
rm -rf scripts/design/.shots/baseline
cp -R scripts/design/.shots/task-09 scripts/design/.shots/baseline
```

- [ ] **Step 5: Gates**

Stop nothing you did not start; check the ports are free. Run, and check each exit status is 0: `npm run build:shared`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/styles.css
git commit -m "$(cat <<'MSG'
Tokens: the night sky's six are gone

--pk-space-core, -mid, -edge, -edge-rgb, -veil and -veil-strong had no
reader left. --pk-glow-rim stays: the glow button, the auth primary
action and the apply pixels wear it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- packages/ui/src/styles.css
```

---

# Batch C — aliases

Tasks 10 to 14 share no file and may run in parallel, taking turns at the harness. The tables are in `$PLAN/mapping-aliases.md`; the files the tools read are in `$PLAN/maps/`.

An alias is defined on a module's root class (`--ink: var(--pk-ink)`) and read below it. Reading the token instead paints the same colour everywhere but in one case: inside a nested `data-surface`, the alias held the value of the surface it was defined on, and the token holds the value of the surface it is read on. None of the four modules with aliases draws anything inside a nested surface of the opposite kind — the one nested surface among them, the passkey sheet, is dark inside dark — so no pixel is expected to move.

The static check's `token-alias` count is 100 before the batch and 0 after it. Each task's share is given; the other four numbers do not change in this batch.

## Task 10: Aliases: `agents`

**Owns:** `apps/web/src/features/agents/agents.module.css`

**Table:** `$PLAN/mapping-aliases.md`, section `apps/web/src/features/agents/agents.module.css`.

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep -c "token-alias  apps/web/src/features/agents/agents.module.css"`

Expected: `15`.

- [ ] **Step 2: Replace the aliases**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/agents/agents.module.css $PLAN/maps/10-agents-aliases.json --drop-definitions
```

Expected: 15 lines beginning `dropped`, one per alias, then one line per alias that is read, with its count. The counts are the `Reads` column of the table and sum to 272.

- [ ] **Step 3: Format, and see the number fall**

```sh
npx prettier --write apps/web/src/features/agents/agents.module.css
npm run design:source | grep -c "token-alias  apps/web/src/features/agents/agents.module.css"
grep -cE '^\s*--[a-z-]+:\s*var\(--pk-' apps/web/src/features/agents/agents.module.css
```

Expected: `0` and `0`.

- [ ] **Step 4: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 13 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate DESIGN_SHOTS_DIR=scripts/design/.shots/task-10 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-10 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Every read paints the colour it painted. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/agents/agents.module.css
git commit -m "$(cat <<'MSG'
Agents: the stylesheet reads the tokens by name

The alias layer on the module's root class is gone: 15 definitions,
272 reads. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/agents/agents.module.css
```

## Task 11: Aliases and variant variables: `auth`

**Owns:** `apps/web/src/features/auth/auth.module.css`

**Table:** `$PLAN/mapping-aliases.md`, section `apps/web/src/features/auth/auth.module.css` (both the plain aliases and the variant variables).

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep -c "token-alias  apps/web/src/features/auth/auth.module.css"`

Expected: `25` — the four `--accent` variants hold `var(--lime)` and the like today, which the rule does not count until the alias under them is gone.

- [ ] **Step 2: Replace the aliases**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/auth/auth.module.css $PLAN/maps/11-auth-aliases.json --drop-definitions
```

Expected: 25 lines beginning `dropped`, one per alias, then one line per alias that is read, with its count. The counts are the `Reads` column of the table and sum to 190.

- [ ] **Step 3: Rewrite the variant variables**

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/auth/auth.module.css $PLAN/maps/11-auth-variants.json
```

Expected: `apps/web/src/features/auth/auth.module.css: 5 edit(s) applied`.

- [ ] **Step 4: Format, and see the number fall**

```sh
npx prettier --write apps/web/src/features/auth/auth.module.css
npm run design:source | grep -c "token-alias  apps/web/src/features/auth/auth.module.css"
grep -cE '^\s*--[a-z-]+:\s*var\(--pk-' apps/web/src/features/auth/auth.module.css
```

Expected: `0` and `0`.

- [ ] **Step 5: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 4 route(s).`, and `exit 0`.

- [ ] **Step 6: Capture and compare**

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add DESIGN_SHOTS_DIR=scripts/design/.shots/task-11 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-11 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Every read paints the colour it painted. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 7: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/auth/auth.module.css
git commit -m "$(cat <<'MSG'
Auth: the stylesheet reads the tokens by name

The alias layer on the module's root class is gone: 25 definitions,
190 reads. The variant variables that held a colour are one rule per
variant.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/auth/auth.module.css
```

## Task 12: Aliases and variant variables: `markets`

**Owns:** `apps/web/src/features/markets/markets.module.css`

**Table:** `$PLAN/mapping-aliases.md`, section `apps/web/src/features/markets/markets.module.css` (both the plain aliases and the variant variables).

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep -c "token-alias  apps/web/src/features/markets/markets.module.css"`

Expected: `24` — the eighteen plain aliases and the six variant definitions whose value is already `var(--pk-…)`.

- [ ] **Step 2: Replace the aliases**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/markets/markets.module.css $PLAN/maps/12-markets-aliases.json --drop-definitions
```

Expected: 18 lines beginning `dropped`, one per alias, then one line per alias that is read, with its count. The counts are the `Reads` column of the table and sum to 129.

- [ ] **Step 3: Rewrite the variant variables**

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/markets/markets.module.css $PLAN/maps/12-markets-variants.json
```

Expected: `apps/web/src/features/markets/markets.module.css: 8 edit(s) applied`.

- [ ] **Step 4: Format, and see the number fall**

```sh
npx prettier --write apps/web/src/features/markets/markets.module.css
npm run design:source | grep -c "token-alias  apps/web/src/features/markets/markets.module.css"
grep -cE '^\s*--[a-z-]+:\s*var\(--pk-' apps/web/src/features/markets/markets.module.css
```

Expected: `0` and `0`.

- [ ] **Step 5: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=markets,market-ask,market-trade,market-trade-picked,market-ask-picked node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 5 route(s).`, and `exit 0`.

- [ ] **Step 6: Capture and compare**

```sh
DESIGN_ROUTES=markets,market-ask,market-trade,market-trade-picked,market-ask-picked DESIGN_SHOTS_DIR=scripts/design/.shots/task-12 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-12 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Every read paints the colour it painted. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 7: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/markets/markets.module.css
git commit -m "$(cat <<'MSG'
Markets: the stylesheet reads the tokens by name

The alias layer on the module's root class is gone: 18 definitions,
129 reads. The variant variables that held a colour are one rule per
variant.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/markets/markets.module.css
```

## Task 13: Aliases: `apply`

**Owns:** `apps/web/src/features/apply/apply.module.css`

**Table:** `$PLAN/mapping-aliases.md`, section `apps/web/src/features/apply/apply.module.css`.

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep -c "token-alias  apps/web/src/features/apply/apply.module.css"`

Expected: `14`.

- [ ] **Step 2: Replace the aliases**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/apply/apply.module.css $PLAN/maps/13-apply-aliases.json --drop-definitions
```

Expected: 14 lines beginning `dropped`, one per alias, then one line per alias that is read, with its count. The counts are the `Reads` column of the table and sum to 76.

- [ ] **Step 3: Format, and see the number fall**

```sh
npx prettier --write apps/web/src/features/apply/apply.module.css
npm run design:source | grep -c "token-alias  apps/web/src/features/apply/apply.module.css"
grep -cE '^\s*--[a-z-]+:\s*var\(--pk-' apps/web/src/features/apply/apply.module.css
```

Expected: `0` and `0`.

- [ ] **Step 4: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=apply-no-seat node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 1 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=apply-no-seat DESIGN_SHOTS_DIR=scripts/design/.shots/task-13 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-13 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Every read paints the colour it painted. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/apply/apply.module.css
git commit -m "$(cat <<'MSG'
Apply: the stylesheet reads the tokens by name

The alias layer on the module's root class is gone: 14 definitions,
76 reads. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/apply/apply.module.css
```

## Task 14: Variant variables: `landing`, `create`, `home`

**Owns:** `apps/web/src/features/landing/landing.module.css`, `apps/web/src/features/studio/create/create.module.css`, `apps/web/src/features/studio/home/home.module.css`

**Table:** `$PLAN/mapping-aliases.md`, the last three sections of "Variant variables".

| File                 | Variable | Set by                                                                 | Read by                                           | After                                                                                                                                                |
| -------------------- | -------- | ---------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landing.module.css` | `--hue`  | `.mark[data-hue]`, 7 hues                                              | `.mark { background }`                            | each `.mark[data-hue="…"]` sets `background`                                                                                                         |
| `landing.module.css` | `--ink`  | `.move[data-hue] .moveCost`, 4 hues                                    | `.moveCost { color }`                             | each `.move[data-hue="…"] .moveCost` sets `color`                                                                                                    |
| `create.module.css`  | `--dot`  | `.dot`, `.cells`, `.pieceMark`, `.beatDot` with `[data-tint]`, 7 tints | `.dot`, `.beatDot`, `.pieceMark`, `.cells i`      | each tint rule sets `background`, on `.cells[data-tint="…"] i` for the cells; `.dot` and `.pieceMark` keep their fallbacks as their own `background` |
| `home.module.css`    | `--mood` | `.bubble[data-tint]`, 4 tints                                          | `.moodLabel { color }`, `.moodDot { background }` | one rule per tint for each reader                                                                                                                    |

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep "token-alias" | grep -cE "landing|create|home"`

Expected: `22`.

- [ ] **Step 2: Rewrite the variant variables**

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/landing/landing.module.css $PLAN/maps/14-landing-variants.json
node $PLAN/tools/reline.mjs apps/web/src/features/studio/create/create.module.css $PLAN/maps/14-create-variants.json
node $PLAN/tools/reline.mjs apps/web/src/features/studio/home/home.module.css $PLAN/maps/14-home-variants.json
npx prettier --write apps/web/src/features/landing/landing.module.css apps/web/src/features/studio/create/create.module.css apps/web/src/features/studio/home/home.module.css
```

Expected: `13 edit(s) applied`, `11 edit(s) applied`, `3 edit(s) applied`.

- [ ] **Step 3: See the number fall**

```sh
npm run design:source | grep "token-alias" | grep -cE "landing|create|home"
grep -cE 'var\(--(hue|dot|mood|ink)\b' apps/web/src/features/landing/landing.module.css apps/web/src/features/studio/create/create.module.css apps/web/src/features/studio/home/home.module.css
```

Expected: `0`, then three lines each ending `:0`.

- [ ] **Step 4: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=landing,create-describe,create-reading,create-name,create-trades,create-looks,create-reads,create-skills,create-decides,create-review,create-run,studio,studio-home-live,studio-home-researching,studio-home-decided,studio-home-empty,studio-brief-running,studio-brief-done,studio-brief-stale,studio-home-draft,studio-home-second-passkey node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 21 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=landing,create-describe,create-reading,create-name,create-trades,create-looks,create-reads,create-skills,create-decides,create-review,create-run,studio,studio-home-live,studio-home-researching,studio-home-decided,studio-home-empty,studio-brief-running,studio-brief-done,studio-brief-stale,studio-home-draft,studio-home-second-passkey DESIGN_SHOTS_DIR=scripts/design/.shots/task-14 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-14 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Each variant sets the property to the token its variable held. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/landing/landing.module.css \
  apps/web/src/features/studio/create/create.module.css \
  apps/web/src/features/studio/home/home.module.css
git commit -m "$(cat <<'MSG'
Landing and studio: a variant sets its colour, not a variable

--hue, --ink, --dot and --mood each held a token chosen by a data
attribute. Each variant now sets the property itself.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/landing/landing.module.css \
  apps/web/src/features/studio/create/create.module.css \
  apps/web/src/features/studio/home/home.module.css
```

## Batch C checkpoint

Done by whoever takes task 15, before its first step, once tasks 10–14 are committed.

```sh
npm run design:source | tail -1
```

Expected: `source: 208 violation(s) — colour-in-ts 21, colour-literal 90, undefined-token 1, unused-class 96. Report only; --strict fails on them.` There is no `token-alias` in the line.

---

# Batch D — legacy tokens

Task 15 runs alone. Tasks 16 to 21 share no file and may run in parallel, taking turns at the harness. Task 22 runs alone, after all six are committed. The tables are in `$PLAN/mapping-legacy-tokens.md`.

Fourteen carried-forward tokens have a v2 token that their definition already resolves to, on both surfaces. Reading that token instead moves no pixel. The definitions stay until task 22, so the tree is whole after every task.

## Task 15: The token file: new tokens, the tint's prefix, its own legacy reads and literals

**Owns:** `packages/ui/src/styles.css`; in `apps/web/src/features/studio/studio.module.css`, the 37 reads of `--tint-fg`, `--tint-bg` and `--tint-bd` and nothing else.

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The token file's own edits", task 15.

What changes in `styles.css`:

| Change                                              | Detail                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Four tokens added on `:root`, after `--pk-glow-rim` | `--pk-lit-edge: rgba(255, 255, 255, 0.22)` (J7); `--pk-glow-lime: rgba(200, 240, 58, 0.32)` and `--pk-glow-lime-strong: rgba(200, 240, 58, 0.5)` (J8); `--pk-scrim: rgba(11, 13, 26, 0.72)` (J10). Each with a comment saying what it is for.                                                                                                          |
| The five literals in its rules                      | `.pk-button[data-glow="true"]`: `inset 0 2px 0 rgba(255, 255, 255, 0.3)` → `var(--pk-lit-edge)`, `0 0 24px rgba(200, 240, 58, 0.32)` → `var(--pk-glow-lime)`; its `:hover`: the same bevel, and `0 0 40px rgba(200, 240, 58, 0.5)` → `var(--pk-glow-lime-strong)`; `.pk-panel[data-tone="raised"]`: `rgba(255, 255, 255, 0.22)` → `var(--pk-lit-edge)` |
| `--tint-fg`, `--tint-bg`, `--tint-bd`               | renamed `--pk-tint-fg`, `--pk-tint-bg`, `--pk-tint-bd` (J15): 21 occurrences in `styles.css`, 37 in `studio.module.css`                                                                                                                                                                                                                                |
| Its rules' reads of legacy tokens                   | 19 reads of six tokens, by the legacy map                                                                                                                                                                                                                                                                                                              |

- [ ] **Step 1: See the numbers that have to fall**

```sh
npm run design:source | grep -c "colour-literal  packages/ui/src/styles.css"
grep -c -- '--tint-' packages/ui/src/styles.css apps/web/src/features/studio/studio.module.css
```

Expected: `5`; then `packages/ui/src/styles.css:21` and `apps/web/src/features/studio/studio.module.css:37`.

- [ ] **Step 2: Add the tokens, replace the literals, rename the tint**

```sh
node $PLAN/tools/reline.mjs packages/ui/src/styles.css $PLAN/maps/15-styles-tokens.json
node $PLAN/tools/reline.mjs apps/web/src/features/studio/studio.module.css $PLAN/maps/15-studio-tint.json
```

Expected: `packages/ui/src/styles.css: 6 edit(s) applied` and `apps/web/src/features/studio/studio.module.css: 1 edit(s) applied`.

- [ ] **Step 3: Move the token file's own reads of legacy tokens**

```sh
node $PLAN/tools/retoken.mjs packages/ui/src/styles.css $PLAN/maps/legacy.json
npx prettier --write packages/ui/src/styles.css apps/web/src/features/studio/studio.module.css
```

Expected:

```
--pk-ink-placeholder	1
--pk-surface	3
--pk-surface-strong	2
--pk-field	3
--pk-field-autofill	2
--pk-border	8
```

The fourteen definitions in the two "Carried forward" blocks are untouched: the tool rewrites reads, and a definition is not a read.

- [ ] **Step 4: See the numbers fall**

```sh
npm run design:source | tail -1
grep -c -- '--tint-' packages/ui/src/styles.css apps/web/src/features/studio/studio.module.css
grep -c -- '--pk-tint-' packages/ui/src/styles.css apps/web/src/features/studio/studio.module.css
```

Expected: `source: 203 violation(s) — colour-in-ts 21, colour-literal 85, undefined-token 1, unused-class 96.`; then both files `:0`; then `:21` and `:37`.

- [ ] **Step 5: The whole harness, and the picture**

This task touches what every screen is made of, so it captures every route. Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check; echo "exit $?"
DESIGN_SHOTS_DIR=scripts/design/.shots/task-15 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-15 \
  --noise scripts/design/.shots/noise.txt
```

Expected from the check: four times `clean over all 51 route(s).`, `exit 0`.

**Expected differences:** `apply-no-seat-desktop.png` and `apply-no-seat-phone.png`, each by less than 0.2% of pixels, inside the box of the JOIN WAITLIST button (desktop about `x 403–564, y 402–422`; phone about `x 23–184, y 364–384`). That is the glow button's top bevel going from white at 0.3 to white at 0.22 (J7); it is the only glow button on a measured route. Every other line starts with `NOISE`. This also confirms batch C moved nothing.

- [ ] **Step 6: Move the baseline forward**

```sh
rm -rf scripts/design/.shots/baseline
cp -R scripts/design/.shots/task-15 scripts/design/.shots/baseline
```

- [ ] **Step 7: Gates**

Check the ports are free. Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/styles.css \
  apps/web/src/features/studio/studio.module.css
git commit -m "$(cat <<'MSG'
Tokens: four new ones, the tint under the prefix, no literal in a rule

--pk-lit-edge, --pk-glow-lime, --pk-glow-lime-strong and --pk-scrim are
what the literals in feature stylesheets will read. The token file's own
rules read tokens only, and --tint-* is --pk-tint-*.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- packages/ui/src/styles.css \
  apps/web/src/features/studio/studio.module.css
```

## Task 16: Legacy tokens: agents

**Owns:** `apps/web/src/features/agents/agents.module.css`

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The fourteen that go" and "What the tool prints, file by file".

- [ ] **Step 1: Replace the reads**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/agents/agents.module.css $PLAN/maps/legacy.json
```

Expected, file by file:

`apps/web/src/features/agents/agents.module.css`

```
--pk-field	7
--pk-cyan	3
--pk-cyan-ink	10
--pk-pink-ink	7
```

A count that differs means the file has changed since the plan was written. Read the diff before going on: every changed line must be a `var(--pk-…)` whose name moved as the table says.

- [ ] **Step 2: Format, and prove no legacy token is read**

```sh
npx prettier --write apps/web/src/features/agents/agents.module.css
grep -nE 'var\(--pk-(ink-placeholder|surface|surface-strong|field|field-autofill|border|cyan|cyan-ink|pink-ink|lime-tint|magenta-tint|amber-tint|cyan-tint|violet-tint)\)' apps/web/src/features/agents/agents.module.css
npm run design:source | tail -1
```

Expected: the `grep` prints nothing. The static report's numbers are what they were before this task: a legacy token is still defined until task 22, so reading one was never a violation.

- [ ] **Step 3: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 13 route(s).`, and `exit 0`.

- [ ] **Step 4: Capture and compare**

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate DESIGN_SHOTS_DIR=scripts/design/.shots/task-16 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-16 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Each token read is the one the old name resolved to. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/agents/agents.module.css
git commit -m "$(cat <<'MSG'
Agents: v2 tokens where a carried-forward one was read

Each read takes the token the old name already resolved to on both
surfaces. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/agents/agents.module.css
```

## Task 17: Legacy tokens: auth

**Owns:** `apps/web/src/features/auth/auth.module.css`, `apps/web/src/features/auth/components/second-passkey.module.css`

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The fourteen that go" and "What the tool prints, file by file".

- [ ] **Step 1: Replace the reads**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/auth/auth.module.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/features/auth/components/second-passkey.module.css $PLAN/maps/legacy.json
```

Expected, file by file:

`apps/web/src/features/auth/auth.module.css`

```
--pk-field	3
--pk-cyan-ink	7
--pk-pink-ink	1
--pk-magenta-tint	2
--pk-amber-tint	1
--pk-cyan-tint	1
```

`apps/web/src/features/auth/components/second-passkey.module.css`

```
--pk-amber-tint	1
```

A count that differs means the file has changed since the plan was written. Read the diff before going on: every changed line must be a `var(--pk-…)` whose name moved as the table says.

- [ ] **Step 2: Correct the comment that names a token that is going**

`maps/17-auth-comment.json` rewrites the comment above `.info`, which named `--cyan-ink` and `--cyan-tint`.

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/auth/auth.module.css $PLAN/maps/17-auth-comment.json
```

Expected: `1 edit(s) applied`.

- [ ] **Step 3: Format, and prove no legacy token is read**

```sh
npx prettier --write apps/web/src/features/auth/auth.module.css apps/web/src/features/auth/components/second-passkey.module.css
grep -nE 'var\(--pk-(ink-placeholder|surface|surface-strong|field|field-autofill|border|cyan|cyan-ink|pink-ink|lime-tint|magenta-tint|amber-tint|cyan-tint|violet-tint)\)' apps/web/src/features/auth/auth.module.css apps/web/src/features/auth/components/second-passkey.module.css
npm run design:source | tail -1
```

Expected: the `grep` prints nothing. The static report's numbers are what they were before this task: a legacy token is still defined until task 22, so reading one was never a violation.

- [ ] **Step 4: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add,studio-home-second-passkey node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 5 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add,studio-home-second-passkey DESIGN_SHOTS_DIR=scripts/design/.shots/task-17 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-17 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Each token read is the one the old name resolved to. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/auth/auth.module.css \
  apps/web/src/features/auth/components/second-passkey.module.css
git commit -m "$(cat <<'MSG'
Auth: v2 tokens where a carried-forward one was read

Each read takes the token the old name already resolved to on both
surfaces. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/auth/auth.module.css \
  apps/web/src/features/auth/components/second-passkey.module.css
```

## Task 18: Legacy tokens: markets

**Owns:** `apps/web/src/features/markets/markets.module.css`

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The fourteen that go" and "What the tool prints, file by file".

- [ ] **Step 1: Replace the reads**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/markets/markets.module.css $PLAN/maps/legacy.json
```

Expected, file by file:

`apps/web/src/features/markets/markets.module.css`

```
--pk-ink-placeholder	5
--pk-surface-strong	1
--pk-field	1
--pk-border	5
--pk-cyan	1
--pk-cyan-ink	2
--pk-pink-ink	6
--pk-lime-tint	1
--pk-amber-tint	2
--pk-cyan-tint	1
--pk-violet-tint	2
```

A count that differs means the file has changed since the plan was written. Read the diff before going on: every changed line must be a `var(--pk-…)` whose name moved as the table says.

- [ ] **Step 2: Correct the comment that names a token that is going**

`maps/18-markets-comment.json` rewrites the comment above `.column[data-off] .columnLabel`, which listed `--pk-ink-placeholder` among the inks.

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/markets/markets.module.css $PLAN/maps/18-markets-comment.json
```

Expected: `1 edit(s) applied`.

- [ ] **Step 3: Format, and prove no legacy token is read**

```sh
npx prettier --write apps/web/src/features/markets/markets.module.css
grep -nE 'var\(--pk-(ink-placeholder|surface|surface-strong|field|field-autofill|border|cyan|cyan-ink|pink-ink|lime-tint|magenta-tint|amber-tint|cyan-tint|violet-tint)\)' apps/web/src/features/markets/markets.module.css
npm run design:source | tail -1
```

Expected: the `grep` prints nothing. The static report's numbers are what they were before this task: a legacy token is still defined until task 22, so reading one was never a violation.

- [ ] **Step 4: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=markets,market-ask,market-trade,market-trade-picked,market-ask-picked node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 5 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=markets,market-ask,market-trade,market-trade-picked,market-ask-picked DESIGN_SHOTS_DIR=scripts/design/.shots/task-18 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-18 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Each token read is the one the old name resolved to. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/markets/markets.module.css
git commit -m "$(cat <<'MSG'
Markets: v2 tokens where a carried-forward one was read

Each read takes the token the old name already resolved to on both
surfaces. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/markets/markets.module.css
```

## Task 19: Legacy tokens: studio

**Owns:** `apps/web/src/features/studio/studio.module.css`

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The fourteen that go" and "What the tool prints, file by file".

- [ ] **Step 1: Replace the reads**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/studio/studio.module.css $PLAN/maps/legacy.json
```

Expected, file by file:

`apps/web/src/features/studio/studio.module.css`

```
--pk-ink-placeholder	2
--pk-surface	5
--pk-surface-strong	5
--pk-field	7
--pk-border	14
--pk-pink-ink	4
--pk-lime-tint	4
--pk-magenta-tint	2
--pk-violet-tint	5
```

A count that differs means the file has changed since the plan was written. Read the diff before going on: every changed line must be a `var(--pk-…)` whose name moved as the table says.

- [ ] **Step 2: Format, and prove no legacy token is read**

```sh
npx prettier --write apps/web/src/features/studio/studio.module.css
grep -nE 'var\(--pk-(ink-placeholder|surface|surface-strong|field|field-autofill|border|cyan|cyan-ink|pink-ink|lime-tint|magenta-tint|amber-tint|cyan-tint|violet-tint)\)' apps/web/src/features/studio/studio.module.css
npm run design:source | tail -1
```

Expected: the `grep` prints nothing. The static report's numbers are what they were before this task: a legacy token is still defined until task 22, so reading one was never a violation.

- [ ] **Step 3: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=studio-picks,studio-activity,studio-skills,studio-token node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 4 route(s).`, and `exit 0`.

- [ ] **Step 4: Capture and compare**

```sh
DESIGN_ROUTES=studio-picks,studio-activity,studio-skills,studio-token DESIGN_SHOTS_DIR=scripts/design/.shots/task-19 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-19 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Each token read is the one the old name resolved to. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/studio/studio.module.css
git commit -m "$(cat <<'MSG'
Studio: v2 tokens where a carried-forward one was read

Each read takes the token the old name already resolved to on both
surfaces. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/studio/studio.module.css
```

## Task 20: Legacy tokens: home and create

**Owns:** `apps/web/src/features/studio/home/home.module.css`, `apps/web/src/features/studio/create/create.module.css`

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The fourteen that go" and "What the tool prints, file by file".

- [ ] **Step 1: Replace the reads**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/studio/home/home.module.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/features/studio/create/create.module.css $PLAN/maps/legacy.json
```

Expected, file by file:

`apps/web/src/features/studio/home/home.module.css`

```
--pk-border	11
--pk-lime-tint	3
--pk-violet-tint	3
```

`apps/web/src/features/studio/create/create.module.css`

```
--pk-ink-placeholder	1
```

A count that differs means the file has changed since the plan was written. Read the diff before going on: every changed line must be a `var(--pk-…)` whose name moved as the table says.

- [ ] **Step 2: Format, and prove no legacy token is read**

```sh
npx prettier --write apps/web/src/features/studio/home/home.module.css apps/web/src/features/studio/create/create.module.css
grep -nE 'var\(--pk-(ink-placeholder|surface|surface-strong|field|field-autofill|border|cyan|cyan-ink|pink-ink|lime-tint|magenta-tint|amber-tint|cyan-tint|violet-tint)\)' apps/web/src/features/studio/home/home.module.css apps/web/src/features/studio/create/create.module.css
npm run design:source | tail -1
```

Expected: the `grep` prints nothing. The static report's numbers are what they were before this task: a legacy token is still defined until task 22, so reading one was never a violation.

- [ ] **Step 3: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=studio,studio-home-live,studio-home-researching,studio-home-decided,studio-home-empty,studio-brief-running,studio-brief-done,studio-brief-stale,studio-home-draft,studio-home-second-passkey,create-describe,create-reading,create-name,create-trades,create-looks,create-reads,create-skills,create-decides,create-review,create-run node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 20 route(s).`, and `exit 0`.

- [ ] **Step 4: Capture and compare**

```sh
DESIGN_ROUTES=studio,studio-home-live,studio-home-researching,studio-home-decided,studio-home-empty,studio-brief-running,studio-brief-done,studio-brief-stale,studio-home-draft,studio-home-second-passkey,create-describe,create-reading,create-name,create-trades,create-looks,create-reads,create-skills,create-decides,create-review,create-run DESIGN_SHOTS_DIR=scripts/design/.shots/task-20 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-20 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Each token read is the one the old name resolved to. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/studio/home/home.module.css \
  apps/web/src/features/studio/create/create.module.css
git commit -m "$(cat <<'MSG'
Home and create: v2 tokens where a carried-forward one was read

Each read takes the token the old name already resolved to on both
surfaces. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/studio/home/home.module.css \
  apps/web/src/features/studio/create/create.module.css
```

## Task 21: Legacy tokens: the small sheets

**Owns:** `apps/web/src/features/apply/apply.module.css`, `apps/web/src/features/account/account.module.css`, `apps/web/src/app/globals.css`, `apps/web/src/features/wallet/components/activity-page.module.css`, `apps/web/src/features/wallet/components/claim-handle.module.css`, `apps/web/src/features/wallet/components/connect-gate.module.css`, `apps/web/src/features/wallet/components/connect-modal.module.css`

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The fourteen that go" and "What the tool prints, file by file".

- [ ] **Step 1: Replace the reads**

```sh
node $PLAN/tools/retoken.mjs apps/web/src/features/apply/apply.module.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/features/account/account.module.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/app/globals.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/features/wallet/components/activity-page.module.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/features/wallet/components/claim-handle.module.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/features/wallet/components/connect-gate.module.css $PLAN/maps/legacy.json
node $PLAN/tools/retoken.mjs apps/web/src/features/wallet/components/connect-modal.module.css $PLAN/maps/legacy.json
```

Expected, file by file:

`apps/web/src/features/apply/apply.module.css`

```
--pk-ink-placeholder	2
--pk-cyan	2
--pk-cyan-ink	4
```

`apps/web/src/features/account/account.module.css`

```
--pk-cyan-ink	1
```

`apps/web/src/app/globals.css`

```
--pk-cyan-ink	1
```

`apps/web/src/features/wallet/components/activity-page.module.css`

```
--pk-border	1
--pk-cyan-ink	1
```

`apps/web/src/features/wallet/components/claim-handle.module.css`

```
--pk-border	1
```

`apps/web/src/features/wallet/components/connect-gate.module.css`

```
--pk-border	1
--pk-violet-tint	1
```

`apps/web/src/features/wallet/components/connect-modal.module.css`

```
--pk-surface	1
--pk-surface-strong	1
--pk-border	4
--pk-cyan-ink	1
--pk-pink-ink	1
--pk-lime-tint	1
--pk-cyan-tint	1
```

A count that differs means the file has changed since the plan was written. Read the diff before going on: every changed line must be a `var(--pk-…)` whose name moved as the table says.

- [ ] **Step 2: Format, and prove no legacy token is read**

```sh
npx prettier --write apps/web/src/features/apply/apply.module.css apps/web/src/features/account/account.module.css apps/web/src/app/globals.css apps/web/src/features/wallet/components/activity-page.module.css apps/web/src/features/wallet/components/claim-handle.module.css apps/web/src/features/wallet/components/connect-gate.module.css apps/web/src/features/wallet/components/connect-modal.module.css
grep -nE 'var\(--pk-(ink-placeholder|surface|surface-strong|field|field-autofill|border|cyan|cyan-ink|pink-ink|lime-tint|magenta-tint|amber-tint|cyan-tint|violet-tint)\)' apps/web/src/features/apply/apply.module.css apps/web/src/features/account/account.module.css apps/web/src/app/globals.css apps/web/src/features/wallet/components/activity-page.module.css apps/web/src/features/wallet/components/claim-handle.module.css apps/web/src/features/wallet/components/connect-gate.module.css apps/web/src/features/wallet/components/connect-modal.module.css
npm run design:source | tail -1
```

Expected: the `grep` prints nothing. The static report's numbers are what they were before this task: a legacy token is still defined until task 22, so reading one was never a violation.

- [ ] **Step 3: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=apply-no-seat,account,account-security,account-profile,portfolio,portfolio-connected,portfolio-no-positions,reads-gate,activity-gate node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 9 route(s).`, and `exit 0`.

- [ ] **Step 4: Capture and compare**

```sh
DESIGN_ROUTES=apply-no-seat,account,account-security,account-profile,portfolio,portfolio-connected,portfolio-no-positions,reads-gate,activity-gate DESIGN_SHOTS_DIR=scripts/design/.shots/task-21 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-21 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. Each token read is the one the old name resolved to. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/apply/apply.module.css \
  apps/web/src/features/account/account.module.css \
  apps/web/src/app/globals.css \
  apps/web/src/features/wallet/components/activity-page.module.css \
  apps/web/src/features/wallet/components/claim-handle.module.css \
  apps/web/src/features/wallet/components/connect-gate.module.css \
  apps/web/src/features/wallet/components/connect-modal.module.css
git commit -m "$(cat <<'MSG'
The small sheets: v2 tokens where a carried-forward one was read

Each read takes the token the old name already resolved to on both
surfaces. No value changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/apply/apply.module.css \
  apps/web/src/features/account/account.module.css \
  apps/web/src/app/globals.css \
  apps/web/src/features/wallet/components/activity-page.module.css \
  apps/web/src/features/wallet/components/claim-handle.module.css \
  apps/web/src/features/wallet/components/connect-gate.module.css \
  apps/web/src/features/wallet/components/connect-modal.module.css
```

## Task 22: The fourteen legacy definitions go

Runs alone, after tasks 16–21 are committed.

**Owns:** `packages/ui/src/styles.css`, `packages/ui/src/chart.tsx` (one line), `scripts/design/levels.test.mjs` (the list of inks)

**Table:** `$PLAN/mapping-legacy-tokens.md`, "The token file's own edits", task 22.

- [ ] **Step 1: Prove nothing reads them**

```sh
grep -rnE -- '--pk-(ink-placeholder|surface|surface-strong|field|field-autofill|border|cyan|cyan-ink|pink-ink|lime-tint|magenta-tint|amber-tint|cyan-tint|violet-tint)([^A-Za-z0-9_-]|$)' \
  apps/web/src packages/ui/src scripts/design apps/web/test \
  | grep -v '^packages/ui/src/styles.css' | grep -vE '^[^:]+:[0-9]+:\s*(/?\*|//)'
```

Expected: exactly three lines, the three this task changes: `packages/ui/src/chart.tsx` reading `--pk-border`, and `scripts/design/levels.test.mjs` naming `--pk-cyan-ink` and `--pk-pink-ink`. Any other line is a read a task of this batch missed: stop and report.

- [ ] **Step 2: Make the ink test name the tokens that stay, and see it still pass**

`maps/22-levels.json` replaces `"--pk-cyan-ink"` and `"--pk-pink-ink"` in the list `INKS` with `"--pk-state-cool-ink"`; `--pk-magenta-ink`, which the pink resolved to, is already in the list.

```sh
node $PLAN/tools/reline.mjs scripts/design/levels.test.mjs $PLAN/maps/22-levels.json
node --test scripts/design/levels.test.mjs
```

Expected: `1 edit(s) applied`; PASS, `tests 5`, `fail 0`.

- [ ] **Step 3: Remove the definitions**

`maps/22-styles.json` replaces the two "Carried forward" blocks, on the light and on the dark surface, with the seven tokens that stay (J16), each with a comment saying what it is. `maps/22-chart.json` makes the chart's grid read `--pk-rule-strong`.

```sh
node $PLAN/tools/reline.mjs packages/ui/src/styles.css $PLAN/maps/22-styles.json
node $PLAN/tools/reline.mjs packages/ui/src/chart.tsx $PLAN/maps/22-chart.json
npx prettier --write packages/ui/src/styles.css packages/ui/src/chart.tsx scripts/design/levels.test.mjs
```

Expected: `2 edit(s) applied` and `1 edit(s) applied`.

- [ ] **Step 4: Verify**

```sh
npm run design:source | tail -1
node --import tsx --test scripts/design/*.test.mjs
```

Expected: `source: 203 violation(s) — colour-in-ts 21, colour-literal 85, undefined-token 1, unused-class 96.` — `undefined-token` is still 1, the `--pk-font-mono` of task 25, which proves no removed token is read anywhere. Then PASS, `tests 52`, `fail 0`.

- [ ] **Step 5: The whole harness, and the batch's picture**

Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check; echo "exit $?"
DESIGN_SHOTS_DIR=scripts/design/.shots/task-22 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-22 \
  --noise scripts/design/.shots/noise.txt
```

Expected from the check: four times `clean over all 51 route(s).`, `exit 0`.

**Expected differences, for the whole batch since task 15:** none. Every line starts with `NOISE`. A `DIFFERS` names a screen where a legacy token was read through a name the map sent somewhere else: open both PNGs, find the element, and report it with the file and the token.

- [ ] **Step 6: Gates**

Check the ports are free. Run, and check each exit status is 0: `npm run build:shared`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles.css \
  packages/ui/src/chart.tsx \
  scripts/design/levels.test.mjs
git commit -m "$(cat <<'MSG'
Tokens: fourteen carried-forward names are gone

Nothing read them any more. The seven with no single v2 equivalent stay
as part of the system: --pk-ink-dim, --pk-border-strong and the five
edges.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- packages/ui/src/styles.css \
  packages/ui/src/chart.tsx \
  scripts/design/levels.test.mjs
```

---

# Batch E — literals

Tasks 23, 24 and 25 share no file and may run in parallel, taking turns at the harness. Task 26 runs after all three are committed, because it removes `--accent-rgb`, which tasks 23 and 24 stop reading. The tables are in `$PLAN/mapping-literals.md`; the reason for each choice is the judgment call named beside it.

This is the batch that moves pixels on purpose (A3): the colours being replaced are the pre-v2 palette.

## Task 23: Literals: `apply`

**Owns:** `apps/web/src/features/apply/apply.module.css`

**Table:** `$PLAN/mapping-literals.md`, section `maps/23-apply-literals.json`. In short:

| Was                                                                                                                   | Becomes                                                                         | Call |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---- |
| old ink at 0.05, 0.06 as a ground (`.glass`, `.card`, `.piece`)                                                       | `--pk-panel`                                                                    | J1   |
| old ink at 0.14 as the selected chip's ground                                                                         | `--pk-panel-3`                                                                  | J1   |
| old ink at 0.14–0.24 as a hairline (`.glass`, `.chip`, `.piece`, `.pieceHead`, `.well`, `.tile`, `.heldRow`, `.post`) | `--pk-rule-strong`                                                              | J1   |
| old ink at 0.3 and 0.6 as an edge (`.sentHero`, `.chip:hover`)                                                        | `--pk-border-strong`                                                            | J1   |
| old ink at 0.3 on `.page .secondaryButton`                                                                            | the declaration is deleted: the system's secondary button already has that edge | J1   |
| old ink at 0.07 as the well's grid                                                                                    | `--pk-rule`                                                                     | J1   |
| `.primaryButton:disabled`, the whole rule                                                                             | deleted                                                                         | J13  |
| old cyan: the brand's glow, the invite bar, the cyan tile                                                             | `--pk-cyan-edge`, `--pk-state-cool-bg`                                          | J3   |
| white at 0.25, 0.26, 0.35 as an inset highlight                                                                       | `--pk-lit-edge`                                                                 | J7   |
| white at 0.4, 0.45 as a bevel on a lit fill                                                                           | `--pk-glow-rim`                                                                 | J7   |
| lime at 0.45 as a border (`.cardDone`, `.tickerInput`), at 0.4 (`.tileLime`)                                          | `--pk-lime-edge`                                                                | J8   |
| lime at 0.12 as a ground (`.tileLime`)                                                                                | `--pk-state-good-bg`                                                            | J8   |
| lime at 0.9 (`.liveDot`), at 0.45 (`.shareButton`) as a glow                                                          | `--pk-lime`, `--pk-glow-lime-strong`                                            | J8   |
| magenta at 0.6 (`.cardError`)                                                                                         | `--pk-magenta-edge`                                                             | J12  |
| violet at 0.14 and 0.28 (`.sentHero`)                                                                                 | `--pk-state-info-bg`, `--pk-violet-edge`                                        | J11  |
| `rgba(var(--accent-rgb), 0.6)`, three glows                                                                           | `var(--accent)`                                                                 | J9   |

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep -c "colour-literal  apps/web/src/features/apply/apply.module.css"`

Expected: `43`.

- [ ] **Step 2: Replace the literals**

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/apply/apply.module.css $PLAN/maps/23-apply-literals.json
npx prettier --write apps/web/src/features/apply/apply.module.css
npm run design:source | grep -c "colour-literal  apps/web/src/features/apply/apply.module.css"
```

Expected: `apps/web/src/features/apply/apply.module.css: 28 edit(s) applied`, then `0`.

- [ ] **Step 3: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=apply-no-seat node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 1 route(s).`, and `exit 0`.

- [ ] **Step 4: Capture and compare**

```sh
DESIGN_ROUTES=apply-no-seat DESIGN_SHOTS_DIR=scripts/design/.shots/task-23 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-23 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** `apply-no-seat-desktop.png` and `apply-no-seat-phone.png`, each by less than 1% of pixels, inside the box of the brand mark in the header (desktop about `x 113–174, y 0–58`; phone about `x 3–64, y 0–58`): its glow goes from the old cyan to the cool edge (J3). Nothing else on that screen reads a literal this task changes. The form and the submitted screen, where most of these literals are drawn, are behind the apply cookie and on no harness route; say in your report that they were verified by the static check and the table, not by a picture.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/apply/apply.module.css
git commit -m "$(cat <<'MSG'
Apply: every colour is a token

Forty-three literals of the pre-v2 palette are the v2 token that holds
their role on the dark surface. The disabled primary button is the
system's.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/apply/apply.module.css
```

## Task 24: Literals: `auth`

**Owns:** `apps/web/src/features/auth/auth.module.css` (the live rules only; the literals in dead classes go with their rules in task 28)

**Table:** `$PLAN/mapping-literals.md`, section `maps/24-auth-literals.json`. In short:

| Selector                               | Was                                              | Becomes                           | Call   |
| -------------------------------------- | ------------------------------------------------ | --------------------------------- | ------ |
| `.brandLogo`                           | old cyan at 0.55, as a drop-shadow               | `--pk-cyan-edge`                  | J3     |
| `.primary`                             | white 0.4 bevel; lime 0.38 glow                  | `--pk-glow-rim`; `--pk-glow-lime` | J7, J8 |
| `.mascotSmall`                         | lime 0.35 drop-shadow                            | `--pk-glow-lime`                  | J8     |
| `.liveDot`                             | lime 0.8 glow                                    | `--pk-lime`                       | J8     |
| `.bigNumber`                           | lime 0.45 text-shadow                            | `--pk-glow-lime-strong`           | J8     |
| `.well`                                | old console ink 0.06, the grid lines             | `--pk-rule`                       | J2     |
| `.wellClear`                           | lime 0.2 ground; lime 0.9 text-shadow            | `--pk-glow-lime`; `--pk-lime`     | J8     |
| `.cellOn`                              | white 0.4 bevel; `rgba(var(--accent-rgb), 0.55)` | `--pk-glow-rim`; `var(--accent)`  | J7, J9 |
| `.codeFilled`                          | lime 0.6                                         | `--pk-lime-edge`                  | J8     |
| `.codeCaret`                           | old console ink 0.4                              | `--pk-border-strong`              | J2     |
| `.codeWrong`                           | magenta 0.8                                      | `--pk-magenta-edge`               | J12    |
| `.codeInput:focus-visible ~ .codeCell` | lime 0.45                                        | `--pk-focus`                      | J12    |
| `.sheet::backdrop`                     | `rgba(6, 6, 9, 0.72)`                            | `--pk-scrim`                      | J10    |

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep -c "colour-literal  apps/web/src/features/auth/auth.module.css"`

Expected: `39` — 17 in live rules and 22 in dead ones.

- [ ] **Step 2: Replace the literals**

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/auth/auth.module.css $PLAN/maps/24-auth-literals.json
npx prettier --write apps/web/src/features/auth/auth.module.css
npm run design:source | grep -c "colour-literal  apps/web/src/features/auth/auth.module.css"
```

Expected: `apps/web/src/features/auth/auth.module.css: 13 edit(s) applied`, then `22`. Every one of the 22 is inside a class task 28 removes.

- [ ] **Step 3: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 4 route(s).`, and `exit 0`.

- [ ] **Step 4: Capture and compare**

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add DESIGN_SHOTS_DIR=scripts/design/.shots/task-24 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-24 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** all eight shots — `signin`, `signup`, `signup-passkey` and `passkey-add`, desktop and phone — each by 1% to 5% of pixels, inside the header and the sample board on the right (desktop about `x 3–1166, y 0–460`; on the phone the board is below the form). What moved: the brand mark's glow, the board's grid lines, the mascot's and the big number's halo, the live dot, the glow of each lit cell of a piece, and on `signup-passkey` and `passkey-add` the primary button's halo. Open `task-24/signin-desktop.png`: the board still reads as lit, the pieces still glow in their own colour, and no text changed.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/auth/auth.module.css
git commit -m "$(cat <<'MSG'
Auth: every colour in a live rule is a token

Seventeen literals of the pre-v2 palette are tokens: the lime halos the
two lime glows, the old cyan the cool edge, the old console ink the
hairlines, the sheet's backdrop the scrim.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/auth/auth.module.css
```

## Task 25: Literals: the small sheets, and the undefined token

**Owns:** `apps/web/src/features/agents/agents.module.css` (the rule `.glass`), `apps/web/src/features/markets/markets.module.css` (the rule `.tile`), `apps/web/src/features/wallet/components/connect-modal.module.css` (the rule `.dialog::backdrop`), `apps/web/src/features/wallet/components/claim-handle.module.css` (the rule `.eyebrow`)

**Table:** `$PLAN/mapping-literals.md`, the four sections `maps/25-*.json`.

| File                       | Selector            | Was                                       | Becomes              | Call                                         |
| -------------------------- | ------------------- | ----------------------------------------- | -------------------- | -------------------------------------------- |
| `agents.module.css`        | `.glass`            | `inset 0 1px 0 rgba(255, 255, 255, 0.22)` | `var(--pk-lit-edge)` | J7                                           |
| `markets.module.css`       | `.tile`             | `rgba(255, 255, 255, 0.22)`               | `var(--pk-lit-edge)` | J7                                           |
| `connect-modal.module.css` | `.dialog::backdrop` | `rgba(11, 13, 26, 0.72)`                  | `var(--pk-scrim)`    | J10                                          |
| `claim-handle.module.css`  | `.eyebrow`          | `var(--pk-font-mono, var(--pk-font))`     | `var(--pk-font)`     | spec 3.2: `--pk-font-mono` was never defined |

- [ ] **Step 1: Replace**

```sh
node $PLAN/tools/reline.mjs apps/web/src/features/agents/agents.module.css $PLAN/maps/25-agents-literal.json
node $PLAN/tools/reline.mjs apps/web/src/features/markets/markets.module.css $PLAN/maps/25-markets-literal.json
node $PLAN/tools/reline.mjs apps/web/src/features/wallet/components/connect-modal.module.css $PLAN/maps/25-connect-modal-literal.json
node $PLAN/tools/reline.mjs apps/web/src/features/wallet/components/claim-handle.module.css $PLAN/maps/25-claim-handle.json
npx prettier --write apps/web/src/features/agents/agents.module.css apps/web/src/features/markets/markets.module.css apps/web/src/features/wallet/components/connect-modal.module.css apps/web/src/features/wallet/components/claim-handle.module.css
npm run design:source | grep -E "colour-literal|undefined-token" | grep -cE "agents.module|markets.module|connect-modal|claim-handle"
```

Expected: four times `1 edit(s) applied`, then `0`.

- [ ] **Step 2: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate,markets,market-ask,market-trade,market-trade-picked,market-ask-picked node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 18 route(s).`, and `exit 0`.

- [ ] **Step 3: Capture and compare**

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate,markets,market-ask,market-trade,market-trade-picked,market-ask-picked DESIGN_SHOTS_DIR=scripts/design/.shots/task-25 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-25 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. The two highlights keep their value, 0.22; the two dialogs and the claim form are on no harness route, and the font falls back to the face it already rendered in. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 4: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/agents/agents.module.css \
  apps/web/src/features/markets/markets.module.css \
  apps/web/src/features/wallet/components/connect-modal.module.css \
  apps/web/src/features/wallet/components/claim-handle.module.css
git commit -m "$(cat <<'MSG'
Marketplace: the last literals in live rules, and the token never defined

Two inset highlights read --pk-lit-edge, the wallet chooser's backdrop
reads --pk-scrim, and the claim form stops asking for --pk-font-mono.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/agents/agents.module.css \
  apps/web/src/features/markets/markets.module.css \
  apps/web/src/features/wallet/components/connect-modal.module.css \
  apps/web/src/features/wallet/components/claim-handle.module.css
```

## Task 26: The palettes in TypeScript, and the mirror

Runs alone, after tasks 23–25 are committed.

**Owns:** created — `packages/ui/src/tokens.ts`, `scripts/design/mirror.test.mjs`; modified — `apps/web/src/lib/accent.ts`, `apps/web/src/features/apply/lib/options.ts`, `apps/web/src/features/apply/components/application-form.tsx`, `apps/web/src/features/apply/components/submitted.tsx`, `apps/web/src/app/layout.tsx`, `packages/ui/src/index.ts`, `packages/ui/src/chart.tsx`, `packages/ui/package.json`.

| Where                       | Was                                                                                                                      | Becomes                                                                                                                                                                                        | Call    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `lib/accent.ts`             | `ACCENT_COLORS` (seven hex and seven triples), `ACCENT_ORDER`, `colorVars(color, rgb)`; `accentVars` sets `--accent-rgb` | all four gone. `accentVars` sets `--accent`, `--accent-bg`, `--accent-ink`. New: `type Swatch` and `swatchVars(swatch)`, which sets `--accent` to a palette fill or an ink.                    | J9, J18 |
| `apply/lib/options.ts`      | nine swatches as `{ color, rgb }`                                                                                        | nine names: `lime`, `cyan` → `"indigo"`, `amber`, `orange`, `magenta`, `violet`, `blue`, `white` → `"ink"`, `slate` → `"muted"`. `CATEGORIES` and `PERSONALITIES` carry `swatch`.              | J4      |
| `apply/components/*.tsx`    | `colorVars(x.color, x.rgb)`, five places                                                                                 | `swatchVars(x)`                                                                                                                                                                                | J4      |
| `packages/ui/src/tokens.ts` | —                                                                                                                        | `TOKEN_MIRROR.light`: `--pk-bg`, `--pk-ink-faint`, `--pk-rule-strong`, `--pk-win`, `--pk-loss`, each with the value `styles.css` holds. Exported from the package and as `@pickler/ui/tokens`. | J17     |
| `packages/ui/src/chart.tsx` | four fallbacks typed by hand, three of them stale (`#6b7186`, `#2e7d32`, `#c62c62`)                                      | `TOKEN_MIRROR.light[name]`                                                                                                                                                                     | J17     |
| `app/layout.tsx`            | `themeColor: "#FFFFFF"`                                                                                                  | `TOKEN_MIRROR.light["--pk-bg"]`                                                                                                                                                                | J17     |

- [ ] **Step 1: Write the failing test**

```sh
git apply --check $PLAN/patches/26-mirror-test.patch && git apply $PLAN/patches/26-mirror-test.patch
node --import tsx --test scripts/design/mirror.test.mjs
```

Expected: FAIL with `Cannot find module '…/packages/ui/src/tokens.ts'`.

The test resolves each mirrored token in `styles.css`, following `var()` chains, and compares it with the mirror's value; a second test fails if the mirror is empty.

- [ ] **Step 2: Write the mirror and move the palettes**

```sh
git apply --check $PLAN/patches/26-palettes-impl.patch && git apply $PLAN/patches/26-palettes-impl.patch
node --import tsx --test scripts/design/mirror.test.mjs
```

Expected: PASS, `tests 2`, `fail 0`.

- [ ] **Step 3: Prove the test can fail**

Change one value in `packages/ui/src/tokens.ts` — `"--pk-win": "#2b732e"` to `"#2e7d32"`, the stale value the chart held — and run the test again.

Expected: FAIL, with `--pk-win on light: tokens.ts says #2e7d32, styles.css says #2b732e`.

Put the value back, run the test once more, and see it pass. `git diff packages/ui/src/tokens.ts` must print nothing but the new file.

- [ ] **Step 4: Verify**

```sh
npm run design:source | tail -1
grep -rn 'accent-rgb\|colorVars\|ACCENT_COLORS\|ACCENT_ORDER' apps/web/src packages/ui/src
```

Expected: `source: 118 violation(s) — colour-literal 22, unused-class 96. Report only; --strict fails on them.` — no `colour-in-ts`, no `undefined-token`. The `grep` prints nothing.

- [ ] **Step 5: The whole harness, and the batch's picture**

Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check; echo "exit $?"
DESIGN_SHOTS_DIR=scripts/design/.shots/task-26 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-26 \
  --noise scripts/design/.shots/noise.txt
```

Expected from the check: four times `clean over all 51 route(s).`, `exit 0`.

**Expected differences, for the whole batch — ten shots and no others:**

| Screens                                                                 | How much                                     | Why                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apply-no-seat` (desktop and phone)                                     | less than 1%, in the header's brand mark     | task 23                                                                                       |
| `signin`, `signup`, `signup-passkey`, `passkey-add` (desktop and phone) | 1% to 5%, in the header and the sample board | task 24; and this task, for the glow of each lit cell, which now paints from `--accent` alone |

Every other line starts with `NOISE`, or is a `DIFFERS` under 0.1% on `markets-desktop` or `token-desktop` inside the box those screens have in `noise.txt` (see task 4, step 3).

- [ ] **Step 6: Move the baseline forward**

```sh
rm -rf scripts/design/.shots/baseline
cp -R scripts/design/.shots/task-26 scripts/design/.shots/baseline
```

- [ ] **Step 7: Gates**

Check the ports are free. Run, and check each exit status is 0: `npm run build:shared`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:workers`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/accent.ts \
  apps/web/src/features/apply/lib/options.ts \
  apps/web/src/features/apply/components/application-form.tsx \
  apps/web/src/features/apply/components/submitted.tsx \
  apps/web/src/app/layout.tsx \
  packages/ui/src/tokens.ts \
  packages/ui/src/index.ts \
  packages/ui/src/chart.tsx \
  packages/ui/package.json \
  scripts/design/mirror.test.mjs
git commit -m "$(cat <<'MSG'
Palettes: no colour in TypeScript outside the mirror

accent.ts and the application's options hold token names and no value;
the r,g,b triples are gone with the glows that needed them. The five
values code must hold as values live in packages/ui/src/tokens.ts, and
a test fails when one differs from styles.css.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/lib/accent.ts \
  apps/web/src/features/apply/lib/options.ts \
  apps/web/src/features/apply/components/application-form.tsx \
  apps/web/src/features/apply/components/submitted.tsx \
  apps/web/src/app/layout.tsx \
  packages/ui/src/tokens.ts \
  packages/ui/src/index.ts \
  packages/ui/src/chart.tsx \
  packages/ui/package.json \
  scripts/design/mirror.test.mjs
```

---

# Batch F — dead code

Tasks 27, 28, 29 and 31 share no file and may run in parallel, taking turns at the harness. Task 30 runs after all four are committed: it touches `agents.module.css`, which task 27 owns, and it ends with the batch's full run of the harness. The lists are in `$PLAN/mapping-dead-code.md`.

A dead rule paints nothing, so no pixel moves in this batch. What falls is `unused-class`, from 96 to 0, and the last 22 `colour-literal`, which sit in dead rules of `auth`.

## Task 27: Dead classes: `agents`

**Owns:** `apps/web/src/features/agents/agents.module.css`

**List:** `$PLAN/mapping-dead-code.md`, section `agents.module.css` — task 27: 32 classes. Most are the old token board (`.grid`, `.card*`, `.curve*`, `.table*`, `.viewToggle`, `.stageButton`), orphaned when main replaced it with `LaunchBoard` (A8).

**Kept:** `.resultWon`, `.resultLost`, `.resultOpen`, `.kindCALL`, `.kindPOSITION`, `.kindPASS`, `.kindANSWER`, `.kindPERP`. They are reached through a computed `styles[...]` and are not in the list.

- [ ] **Step 1: See the number that has to fall**

Run: `npm run design:source | grep -c "unused-class  apps/web/src/features/agents/agents.module.css"`

Expected: `32`.

- [ ] **Step 2: Remove the rules**

```sh
node $PLAN/tools/derule.mjs apps/web/src/features/agents/agents.module.css --classes "$(cat $PLAN/maps/27-agents-classes.txt)"
npx prettier --write apps/web/src/features/agents/agents.module.css
```

Expected: the lines listed in `mapping-dead-code.md`, ending `apps/web/src/features/agents/agents.module.css: 53 rule(s) or selector(s) removed`.

- [ ] **Step 3: See the number fall, and the kept classes still there**

```sh
npm run design:source | grep -c "unused-class  apps/web/src/features/agents/agents.module.css"
grep -cE '^\.(resultWon|resultLost|resultOpen|kindCALL|kindPOSITION|kindPASS|kindANSWER|kindPERP) ' apps/web/src/features/agents/agents.module.css
```

Expected: `0`, then `8`.

- [ ] **Step 4: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 13 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=portfolio,portfolio-connected,portfolio-no-positions,leaderboard,agents,agent-profile,agent-ask,tokens,token,token-pick,reads-gate,read,activity-gate DESIGN_SHOTS_DIR=scripts/design/.shots/task-27 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-27 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. No component names a class that was removed. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/agents/agents.module.css
git commit -m "$(cat <<'MSG'
Agents: thirty-two classes nothing names are gone

Most were the token board main replaced with the launch board. The
eight classes reached through a computed styles[...] stay.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/agents/agents.module.css
```

## Task 28: Dead classes: `auth`

**Owns:** `apps/web/src/features/auth/auth.module.css`

**List:** `$PLAN/mapping-dead-code.md`, section `auth.module.css` — task 28: 59 classes and four keyframes (`fallSpin`, `fall`, `stars`, `pop`). Among them is the second, already dead sky of this file, `.signinGlow` and `.signinStars`.

- [ ] **Step 1: See the numbers that have to fall**

```sh
npm run design:source | grep -c "unused-class  apps/web/src/features/auth/auth.module.css"
npm run design:source | grep -c "colour-literal  apps/web/src/features/auth/auth.module.css"
```

Expected: `59` and `22`.

- [ ] **Step 2: Remove the rules**

```sh
node $PLAN/tools/derule.mjs apps/web/src/features/auth/auth.module.css --classes "$(cat $PLAN/maps/28-auth-classes.txt)" \
  --keyframes fallSpin,fall,stars,pop
node $PLAN/tools/reline.mjs apps/web/src/features/auth/auth.module.css $PLAN/maps/28-auth-header.json
npx prettier --write apps/web/src/features/auth/auth.module.css
```

Expected: the lines listed in `mapping-dead-code.md`, ending `apps/web/src/features/auth/auth.module.css: 83 rule(s) or selector(s) removed`; then `1 edit(s) applied`, which removes the `Done` section header the rules left empty.

- [ ] **Step 3: See the numbers fall**

```sh
npm run design:source | grep -c "apps/web/src/features/auth/auth.module.css"
grep -cE '^@keyframes (fadeIn|blink|drop|float)' apps/web/src/features/auth/auth.module.css
```

Expected: `0` — the file has no violation of any rule left — then `4`: the keyframes live rules use are untouched.

- [ ] **Step 4: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 4 route(s).`, and `exit 0`.

- [ ] **Step 5: Capture and compare**

```sh
DESIGN_ROUTES=signin,signup,signup-passkey,passkey-add DESIGN_SHOTS_DIR=scripts/design/.shots/task-28 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-28 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. No component names a class that was removed. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/auth/auth.module.css
git commit -m "$(cat <<'MSG'
Auth: fifty-nine classes nothing names are gone

With them the last colour literals in the product's stylesheets, and
the second sky this file still carried.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/auth/auth.module.css
```

## Task 29: Dead classes: `landing`, `home`, `studio`

**Owns:** `apps/web/src/features/landing/landing.module.css`, `apps/web/src/features/studio/home/home.module.css`, `apps/web/src/features/studio/studio.module.css`

| File                          | Classes                       |
| ----------------------------- | ----------------------------- |
| `landing/landing.module.css`  | `.display`                    |
| `studio/home/home.module.css` | `.briefName`, `.briefPrompt`  |
| `studio/studio.module.css`    | `.accentRow`, `.accentSwatch` |

- [ ] **Step 1: Remove the rules**

```sh
node $PLAN/tools/derule.mjs apps/web/src/features/landing/landing.module.css --classes display
node $PLAN/tools/derule.mjs apps/web/src/features/studio/home/home.module.css --classes briefName,briefPrompt
node $PLAN/tools/derule.mjs apps/web/src/features/studio/studio.module.css --classes accentRow,accentSwatch
npx prettier --write apps/web/src/features/landing/landing.module.css apps/web/src/features/studio/home/home.module.css apps/web/src/features/studio/studio.module.css
npm run design:source | grep "unused-class" | grep -cE "landing|home.module|studio.module"
```

Expected: `1 rule(s) or selector(s) removed`, `2 …`, `3 …` (the third is `.accentSwatch[aria-checked="true"]`), then `0`.

- [ ] **Step 2: The checks, on this task's routes**

Look at the ports, then run:

```sh
DESIGN_ROUTES=landing,studio,studio-home-live,studio-home-researching,studio-home-decided,studio-home-empty,studio-brief-running,studio-brief-done,studio-brief-stale,studio-home-draft,studio-home-second-passkey,studio-picks,studio-activity,studio-skills,studio-token node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 15 route(s).`, and `exit 0`.

- [ ] **Step 3: Capture and compare**

```sh
DESIGN_ROUTES=landing,studio,studio-home-live,studio-home-researching,studio-home-decided,studio-home-empty,studio-brief-running,studio-brief-done,studio-brief-stale,studio-home-draft,studio-home-second-passkey,studio-picks,studio-activity,studio-skills,studio-token DESIGN_SHOTS_DIR=scripts/design/.shots/task-29 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-29 \
  --noise scripts/design/.shots/noise.txt --partial
```

**Expected differences:** none. No component names a class that was removed. Every line the comparison prints must start with `NOISE`; a `DIFFERS` on any screen is a defect of this task.

- [ ] **Step 4: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/landing/landing.module.css \
  apps/web/src/features/studio/home/home.module.css \
  apps/web/src/features/studio/studio.module.css
git commit -m "$(cat <<'MSG'
Landing and studio: five classes nothing names are gone

No component names them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/landing/landing.module.css \
  apps/web/src/features/studio/home/home.module.css \
  apps/web/src/features/studio/studio.module.css
```

## Task 31: `/console`

**Owns:** `apps/web/src/app/console/page.tsx` (deleted), `apps/web/AGENTS.md` (one sentence)

The decision and its evidence are at the top of this plan, under "The `/console` decision (A7)".

- [ ] **Step 1: Prove nothing names it**

Run: `grep -rnE '["\x27`(]/console' apps/web/src apps/web/test scripts/design`

Expected: no output.

- [ ] **Step 2: Remove the route and the sentence that describes it**

```sh
git rm -q apps/web/src/app/console/page.tsx
node $PLAN/tools/reline.mjs apps/web/AGENTS.md $PLAN/maps/31-agents-md.json
npx prettier --write apps/web/AGENTS.md
```

Expected: `apps/web/AGENTS.md: 1 edit(s) applied`. The edit removes "The historical `/console` URL redirects to `/studio` with its query preserved." from the last paragraph; the sentence at line 139, "no redirect is kept because nobody had launched", is the decision and stays.

`git rm` stages one deletion, of a file this task owns. It stages nothing else.

- [ ] **Step 3: Clear the types `next dev` generated for the route**

`apps/web/tsconfig.json` includes `.next/dev/types/**/*.ts`, which `next dev` writes and git ignores. After a harness run that folder holds a `validator.ts` that imports `src/app/console/page.js`, and the type check fails on it:

```
.next/dev/types/validator.ts(134,39): error TS2307: Cannot find module '../../../src/app/console/page.js'
```

Look at the ports. If 3001 is free:

```sh
rm -rf apps/web/.next/dev/types
```

If 3001 is taken, somebody's dev server owns that folder: wait until it is free. The next harness run writes the folder again, without the route.

- [ ] **Step 4: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

Look at the ports, then run: `DESIGN_ROUTES=studio node scripts/design/run.mjs surfaces; echo "exit $?"` — expected `clean over all 1 route(s).`, `exit 0`: `/studio` itself is untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/console/page.tsx \
  apps/web/AGENTS.md
git commit -m "$(cat <<'MSG'
Web: /console is gone, as the rename decided

The studio moved to /studio on 2026-09-24 and kept no redirect; a merge
brought one back. Nothing links to it and neither production host
serves it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/app/console/page.tsx \
  apps/web/AGENTS.md
```

## Task 30: Dead exports, and the retired signer path

Runs alone, after tasks 27, 28, 29 and 31 are committed.

**Owns:** the 35 files named in `$PLAN/maps/30-unexport.tsv`; `apps/web/src/features/agents/components/agent-parts.tsx`, `apps/web/src/features/agents/lib/empty.ts`, `apps/web/src/features/auth/lib/shapes.ts`, `apps/web/src/features/studio/api.ts`, `apps/web/src/features/wallet/lib/signer-adapters.ts`, `apps/web/src/features/wallet/lib/sign-in-words.ts`, `apps/web/src/features/wallet/lib/connect.ts`; `apps/web/src/features/agents/agents.module.css` (the rules `.marks`, `.mark`, `.mark img`); `apps/web/test/marketplace-empty.test.ts`, `apps/web/test/signer-adapters.test.ts`, `apps/web/test/sign-in-words.test.ts`.

**Lists:** `$PLAN/mapping-dead-code.md`, sections "Declarations deleted", "Exports kept although only tests import them" and "`export` removed" (J23).

- [ ] **Step 1: Record what the tests say before**

Run: `node --import tsx --test apps/web/test/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'`

Expected: `fail 0`. Write down `tests`; after this task it is six lower.

- [ ] **Step 2: Change the tests first**

The patch holds the code and its tests. Apply the three test files alone:

```sh
git apply --check --include='apps/web/test/*' $PLAN/patches/30-dead-declarations.patch
git apply --include='apps/web/test/*' $PLAN/patches/30-dead-declarations.patch
node --import tsx --test apps/web/test/marketplace-empty.test.ts \
  apps/web/test/signer-adapters.test.ts apps/web/test/sign-in-words.test.ts
```

Expected: PASS, `fail 0`, against the code as it still is. This is a removal, so there is no test to see fail: the tests that named `agentsWithToken`, `fromViemAccount` and `PasskeyUnusableError` are gone, and one is added, `an ordinary refusal stays the error the wallet threw`, which pins what `describeSignerFailure` keeps doing. It passes before and after; what it guards is step 3 deleting too much.

- [ ] **Step 3: Delete the dead declarations**

```sh
git apply --check --exclude='apps/web/test/*' $PLAN/patches/30-dead-declarations.patch
git apply --exclude='apps/web/test/*' $PLAN/patches/30-dead-declarations.patch
```

It deletes what the table "Declarations deleted" lists. `signer-adapters.ts` keeps `describeSignerFailure`, now one line, and `fromInjectedProvider`.

- [ ] **Step 4: Remove `export` where nothing imports**

```sh
node $PLAN/tools/unexport.mjs $PLAN/maps/30-unexport.tsv
```

Expected: `69 declaration(s) in 35 file(s) no longer exported`.

- [ ] **Step 5: Remove the classes the dead component was the last to name**

```sh
npm run design:source | grep unused-class
node $PLAN/tools/derule.mjs apps/web/src/features/agents/agents.module.css --classes marks,mark
npx prettier --write apps/web/src apps/web/test
npm run design:source | tail -1
```

Expected: the first command prints two lines, `.marks` and `.mark` in `agents.module.css`; the tool prints `removed  .marks`, `removed  .mark`, `removed  .mark img`; the last line is `source: clean over 244 file(s).`

- [ ] **Step 6: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`. `npm run lint` must print no warning: an unused variable left behind by a deleted test is a warning, and the patch removes the one there was (`curve` in `marketplace-empty.test.ts`).

Run: `node --import tsx --test apps/web/test/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'` — expected `fail 0`, and `tests` six lower than in step 1.

- [ ] **Step 7: The whole harness, and the batch's picture**

Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check; echo "exit $?"
DESIGN_SHOTS_DIR=scripts/design/.shots/task-30 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-30 \
  --noise scripts/design/.shots/noise.txt
```

Expected from the check: `source: clean over 244 file(s).`; four times `clean over all 51 route(s).`; `exit 0`.

**Expected differences, for the whole batch:** none. Every line starts with `NOISE`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/test/marketplace-empty.test.ts \
  apps/web/test/signer-adapters.test.ts apps/web/test/sign-in-words.test.ts
git commit -m "$(cat <<'MSG'
Web: exports nothing imports, and the signer path nothing can reach

Sixty-nine declarations lose their export keyword. Eight are deleted
outright with the tests that named them: two venue components, the
token board's filter, a shape map, a type, a fetch wrapper, and Mera's
adapter with the error only Mera could cause.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src apps/web/test/marketplace-empty.test.ts \
  apps/web/test/signer-adapters.test.ts apps/web/test/sign-in-words.test.ts
```

Before that `git add`, run `git status --short apps/web/src` and check that every path listed is one this task owns. `apps/web/src` is named whole only because the list is 43 files long; if the status shows a file that is not in `30-unexport.tsv` or in the **Owns** list, somebody else is editing it: add the files one by one instead and leave theirs alone.

---

# Batch G — the studio's sections

One task.

## Task 32: One rail list and one Soon panel

**Owns:** created — `apps/web/src/features/studio/sections/rail.ts`, `apps/web/src/features/studio/sections/soon.tsx`, `apps/web/test/studio-rail.test.ts`; deleted — `apps/web/src/features/studio/sections/stub.tsx`; modified — `apps/web/src/features/studio/studio.tsx`, `apps/web/src/features/studio/sections/overview.tsx`, `apps/web/src/features/studio/sections/context.tsx`, `apps/web/src/features/studio/home/menu.tsx`, `apps/web/src/features/studio/home/empty.tsx`.

What is there today: three lists of the same sections — `GROUPS` in `studio.tsx`, `groups` in `home/menu.tsx`, `RAIL` in `home/empty.tsx` — which disagree on labels and on which sections exist; and `sections/stub.tsx`, one component over a table of six pages, each with a state badge of its own (`LIVES IN SKILLS`, `HALF BUILT`, `RECORD PENDING`, `NO BACKEND`, `BUILT`).

What is there after (J21, J22):

|                                                 |                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sections/rail.ts`                              | `RAIL`: four groups, thirteen items, each `{ key, icon, label, soon }`, in the order of `SECTIONS` in `keys.ts`. `isSoon(key)`. `PANELS`: the title, tag and body of the six sections the panel draws. `isPanel(key)`. Data only, no `"use client"`. |
| `sections/soon.tsx`                             | `Soon({ section, agent })`: the tag, `SOON` when `isSoon(section)`, the title, the body; the two links out on `board`, the link to the public page on `profile`. It replaces `Stub`.                                                                 |
| `studio.tsx`                                    | draws `RAIL`; a soon section's badge is `SOON`; the render switch ends in `isPanel(section) ? <Soon …/> : null`. `SectionKey` is imported from `keys.ts`.                                                                                            |
| `home/menu.tsx`                                 | builds its groups from `RAIL`; a soon item's note is `SOON`, else the live note it had (`picks`, `activity`, `skills`).                                                                                                                              |
| `home/empty.tsx`                                | draws `RAIL`, every row disabled as before, with a `SOON` tag on the five.                                                                                                                                                                           |
| `sections/overview.tsx`, `sections/context.tsx` | import `SectionKey` from `keys.ts` instead of `stub.tsx`.                                                                                                                                                                                            |

What a person sees change:

| Where                             | Before                                                                                                                  | After                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell rail, `profile`             | badge `SAMPLE`                                                                                                          | badge `SOON`                                                                                                                                                                   |
| Shell rail, `audience`, `token`   | badge `PLANNED`                                                                                                         | badge `SOON`                                                                                                                                                                   |
| Shell rail, `sources`, `identity` | no badge                                                                                                                | badge `SOON`                                                                                                                                                                   |
| The six panels                    | a state badge each                                                                                                      | `SOON` on five; none on the board                                                                                                                                              |
| The `token` panel's body          | "No curve, no contracts, no purchases…"                                                                                 | "Launching a token for this agent from the studio is not built. The public token board reads the launch catalogue, which stays empty until the launch contracts are deployed." |
| Home Menu                         | 13 rows in three groups; `profile` called "Public page"; `token` noted `OPTIONAL`                                       | 13 rows in the rail's four groups; "Public profile"; the five noted `SOON`                                                                                                     |
| Empty home rail                   | 9 rows: Overview, Console, Trades, Activity, Brief, Sources & rules, Limits & funding, Identity & voice, Public profile | the 13 rows of the shell rail, the five with a `SOON` tag                                                                                                                      |

- [ ] **Step 1: Write the failing test**

```sh
git apply --check $PLAN/patches/32-rail-test.patch && git apply $PLAN/patches/32-rail-test.patch
node --import tsx --test apps/web/test/studio-rail.test.ts
```

Expected: FAIL with `Cannot find module '../src/features/studio/sections/rail'`.

The seven tests: the rail lists every section key once, in the order the keys are declared; its groups are RUN, BUILD, GROW, PUBLIC; the soon sections are `sources`, `identity`, `profile`, `audience`, `token`; every soon section has a panel; the board draws the panel without being soon; a section with a screen of its own draws no panel; no panel is without words.

- [ ] **Step 2: Write the list and the panel, and draw all three rails from the list**

```sh
git apply --check $PLAN/patches/32-rail-impl.patch && git apply $PLAN/patches/32-rail-impl.patch
node --import tsx --test apps/web/test/studio-rail.test.ts apps/web/test/studio.test.ts
```

Expected: PASS, `fail 0`. The patch deletes `sections/stub.tsx`; `git status --short apps/web/src/features/studio/sections` shows ` D stub.tsx`, `?? rail.ts`, `?? soon.tsx`.

- [ ] **Step 3: Verify**

```sh
npm run design:source | tail -1
grep -rn 'sections/stub\|GROUPS\b' apps/web/src/features/studio
```

Expected: `source: clean over 245 file(s).`; the `grep` prints nothing.

Run, and check each exit status is 0: `npm run typecheck`, `npm run lint`.

- [ ] **Step 4: The whole harness, and the picture**

Look at the ports, then run, with a timeout of twenty minutes:

```sh
npm run design:check; echo "exit $?"
DESIGN_SHOTS_DIR=scripts/design/.shots/task-32 npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/task-32 \
  --noise scripts/design/.shots/noise.txt
```

Expected from the check: four times `clean over all 51 route(s).`, `exit 0`.

**Expected differences:**

| Screens                                                                                         | How much                                                                            | Why                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `studio-picks`, `studio-activity`, `studio-skills`, `studio-token`, desktop                     | 0.3% to 1.3% of pixels; the part that is this task's is inside the rail, `x 12–194` | the `SOON` badges; on `studio-token` also the panel's badge and body                                                                       |
| the same four, phone                                                                            | `RESIZED`, taller by 1px (`studio-token` by 26px)                                   | below 860px the rail is a row of chips above the section, and a badge makes it a pixel taller; the token panel's new body is a line longer |
| `studio-home-empty`, `studio-brief-running`, `studio-brief-done`, `studio-brief-stale`, desktop | about 0.4%, inside `x 22–194, y 146–679`                                            | the empty home's rail: thirteen rows, five with a tag                                                                                      |

The phone shots of the empty home and of the three brief stages do not change: below 860px that rail is hidden. The staged homes (`studio-home-*`) do not change: the Menu is closed in a screenshot. `studio-picks` and `studio-activity` are also in `noise.txt`, so their numbers are the rail's plus their own; what matters is that the difference reaches `x 22`. Every other line starts with `NOISE`, or is a `market-*` or `token` screen moving inside the box it has in `noise.txt` — in the verified run `market-trade-picked-desktop` came back `RESIZED` by 15px with no change to the markets at all, which is a row of its time-driven data wrapping.

Open `task-32/studio-token-desktop.png`: the rail on the left with `SOON` beside Sources, Identity & voice, Public profile, Audience and Token; the panel reading GROW · SOON, "Token", and the new body. Open `task-32/studio-home-empty-desktop.png`: thirteen dimmed rows in four groups. At 1400px the rail truncates a long label beside its badge ("Identity & v…"); `design-system-v2.md` already records that for "Public profile" and leaves it to a layout pass, and so does this task.

- [ ] **Step 5: Move the baseline forward**

```sh
rm -rf scripts/design/.shots/baseline
cp -R scripts/design/.shots/task-32 scripts/design/.shots/baseline
```

- [ ] **Step 6: Gates**

Check the ports are free. Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

- [ ] **Step 7: Commit**

`sections/stub.tsx` is deleted by the patch, not by `git rm`, so it has to be named for the commit to take the deletion.

```bash
git add apps/web/src/features/studio/sections/rail.ts \
  apps/web/src/features/studio/sections/soon.tsx \
  apps/web/src/features/studio/sections/stub.tsx \
  apps/web/src/features/studio/sections/overview.tsx \
  apps/web/src/features/studio/sections/context.tsx \
  apps/web/src/features/studio/studio.tsx \
  apps/web/src/features/studio/home/menu.tsx \
  apps/web/src/features/studio/home/empty.tsx \
  apps/web/test/studio-rail.test.ts
git commit -m "$(cat <<'MSG'
Studio: one list of sections, one Soon panel

The shell's rail, the home's Menu and the empty home's rail drew three
lists that disagreed. They draw one. A section with no screen is marked
SOON in all three and opens on one panel that says what exists and
what does not.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/src/features/studio/sections/rail.ts \
  apps/web/src/features/studio/sections/soon.tsx \
  apps/web/src/features/studio/sections/stub.tsx \
  apps/web/src/features/studio/sections/overview.tsx \
  apps/web/src/features/studio/sections/context.tsx \
  apps/web/src/features/studio/studio.tsx \
  apps/web/src/features/studio/home/menu.tsx \
  apps/web/src/features/studio/home/empty.tsx \
  apps/web/test/studio-rail.test.ts
```

---

# Batch H — the harness sees more, the static check fails, CI runs both

Tasks 33 and 34 share no file and may run in parallel, taking turns at the harness. Task 35 runs after both, task 36 after 35.

## Task 33: The runtime token check reads gradients, shadows, filters, outlines and SVG paint

**Owns:** `scripts/design/lib/probe.mjs`, `scripts/design/tokens.mjs`, `scripts/design/probe.test.mjs` (created), `packages/ui/src/brand.tsx` (one attribute).

Until now `tokens.mjs` read three things off each element: `background-color`, `color`, and the colour of a border with a width. The sky was a `background-image` and every glow a `box-shadow`, so both passed. It also compared each colour with every token on the page, whatever surface the element sat in.

| Change                       | Detail                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `paintedColours(pattern)`    | also reads `background-image`, `box-shadow`, `text-shadow`, `filter`, `outline-color` where an outline is drawn, and `fill` and `stroke` of SVG shapes. Each paint carries the index of its surface scope: the nearest `[data-surface]` ancestor, or the page. It skips what sits under `[data-third-party-mark]` (J19). |
| `resolveTokens()`            | returns one list of values per scope. A token that is not a colour but holds some — `--pk-popover-shadow` — contributes each colour it holds.                                                                                                                                                                            |
| `COLOUR`, `coloursIn(value)` | the one pattern for a colour in a computed value, tested in Node and handed to the page as an argument                                                                                                                                                                                                                   |
| `tokens.mjs`                 | judges each paint against the tokens of its own scope; a stray is reported once per colour and role                                                                                                                                                                                                                      |
| `packages/ui/src/brand.tsx`  | `data-third-party-mark=""` on the `<svg>`                                                                                                                                                                                                                                                                                |

Not read: `::before` and `::after`, and what a `<canvas>` draws.

- [ ] **Step 1: Write the failing test**

```sh
git apply --check $PLAN/patches/33-probe-test.patch && git apply $PLAN/patches/33-probe-test.patch
node --test scripts/design/probe.test.mjs
```

Expected: FAIL: `The requested module './lib/probe.mjs' does not provide an export named 'coloursIn'`.

The five tests give `coloursIn` what Chromium hands back for a shadow list, a gradient, a drop-shadow, a colour mixed by the browser and a value with no colour in it.

- [ ] **Step 2: Write the implementation**

```sh
git apply --check $PLAN/patches/33-probe-impl.patch && git apply $PLAN/patches/33-probe-impl.patch
node --test scripts/design/probe.test.mjs
```

Expected: PASS, `tests 5`, `fail 0`.

- [ ] **Step 3: Prove the check can fail**

In `apps/web/src/features/agents/agents.module.css`, in the rule `.glass`, change by hand

```css
box-shadow: inset 0 1px 0 var(--pk-lit-edge);
```

to

```css
box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.23);
```

Look at the ports, then run: `DESIGN_ROUTES=token-pick node scripts/design/run.mjs tokens; echo "exit $?"`

Expected: `FAIL     token-pick article.agents-module__…__glass: #FFFFFF at 0.23 alpha as box-shadow is in no --pk-* token of its surface ×1`, and `exit 1`.

Put the line back by hand. `git diff --stat apps/web/src/features/agents/agents.module.css` must print nothing. Run the same command again: `tokens: clean over all 1 route(s).`, `exit 0`.

- [ ] **Step 4: The check over every route**

Look at the ports, then run, with a timeout of twenty minutes: `node scripts/design/run.mjs tokens; echo "exit $?"`

Expected: `tokens: clean over all 51 route(s).` (60 if task 34 has landed), `exit 0`. Before batches B to F this same check reported 53 strays on 17 routes: the stars, the floor, every glow, the old cyan, and Google's four colours.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`.

There is no capture in this task: the attribute on the `<svg>` paints nothing, and nothing else here reaches the product.

- [ ] **Step 6: Commit**

```bash
git add scripts/design/lib/probe.mjs \
  scripts/design/tokens.mjs \
  scripts/design/probe.test.mjs \
  packages/ui/src/brand.tsx
git commit -m "$(cat <<'MSG'
Design: the token check reads what a sky and a glow are made of

Gradients, shadows, text shadows, drop-shadows, outlines and SVG paint,
each judged against the tokens of the surface the element sits in. A
third party's mark says so and is skipped.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- scripts/design/lib/probe.mjs \
  scripts/design/tokens.mjs \
  scripts/design/probe.test.mjs \
  packages/ui/src/brand.tsx
```

## Task 34: Every studio section has a route

**Owns:** `scripts/design/routes.mjs`

Four of the thirteen sections have a route today (`picks`, `activity`, `skills`, `token`). Measured before writing this task, the other nine render clean on every check: `overview` 90 text elements, `context` 70, `brief` 51, `sources` 39, `limits` 82, `identity` 39, `profile` 41, `audience` 39, `board` 43. `limits` is where the trading panel is measured, because trading has no section key (A10).

- [ ] **Step 1: Add the nine routes**

`maps/34-routes.json` holds one edit: the four section entries and the comment above them become thirteen entries, in the rail's order, each `{ path: "/studio?section=<key>", name: "studio-<key>", product: "studio", surface: "dark", task: "Task 11", proves: "#studio-panel-<key>" }`. The four that existed keep their names.

```sh
node $PLAN/tools/reline.mjs scripts/design/routes.mjs $PLAN/maps/34-routes.json
npx prettier --write scripts/design/routes.mjs
node -e 'import("./scripts/design/routes.mjs").then((m) => console.log(m.ROUTES.length))'
```

Expected: `1 edit(s) applied`, then `60`.

- [ ] **Step 2: The checks, on the thirteen**

Look at the ports, then run:

```sh
DESIGN_ROUTES=studio-overview,studio-context,studio-picks,studio-activity,studio-brief,studio-skills,studio-sources,studio-limits,studio-identity,studio-profile,studio-audience,studio-token,studio-board \
  node scripts/design/run.mjs surfaces tokens contrast type; echo "exit $?"
```

Expected: four times `clean over all 13 route(s).`, and `exit 0`.

- [ ] **Step 3: Capture, and add the new screens to the baseline**

```sh
DESIGN_ROUTES=studio-overview,studio-context,studio-brief,studio-sources,studio-limits,studio-identity,studio-profile,studio-audience,studio-board \
  DESIGN_SHOTS_DIR=scripts/design/.shots/task-34 npm run design:shots
cp scripts/design/.shots/task-34/*.png scripts/design/.shots/baseline/
ls scripts/design/.shots/baseline | wc -l
```

Expected: `wrote 18 shot(s)`, then `120`. There is nothing to compare these with; open `task-34/studio-limits-desktop.png` and `task-34/studio-overview-desktop.png` and check they are the sections they say they are.

- [ ] **Step 4: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm test`.

- [ ] **Step 5: Commit**

```bash
git add scripts/design/routes.mjs
git commit -m "$(cat <<'MSG'
Design: a route for each of the studio's thirteen sections

Nine had none, the trading panel among them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- scripts/design/routes.mjs
```

## Task 35: The static check fails

Runs after tasks 33 and 34 are committed.

**Owns:** `package.json` (two scripts)

- [ ] **Step 1: See it clean while it still only reports**

Run: `npm run design:source; echo "exit $?"`

Expected: `source: clean over 245 file(s).`, `exit 0`. If it reports a violation, a task before this one is not finished, or something landed since: stop and report the lines.

- [ ] **Step 2: Make it fail**

```sh
node $PLAN/tools/reline.mjs package.json $PLAN/maps/35-package.json
npx prettier --write package.json
```

Expected: `package.json: 2 edit(s) applied`. The two scripts read:

```json
    "design:source": "node scripts/design/source.mjs --strict",
    "design:check": "node scripts/design/run.mjs --strict",
```

- [ ] **Step 3: Prove it fails, once for CSS and once for TypeScript**

Add by hand, at the end of `apps/web/src/app/globals.css`:

```css
.proof {
  color: #c8f03a;
}
```

Run: `npm run design:source; echo "exit $?"`

Expected: `FAIL  colour-literal  apps/web/src/app/globals.css:<line>  color: #c8f03a is a colour literal; read a --pk-* token instead`, `source: 1 violation(s) — colour-literal 1.`, `exit 1`.

Remove the three lines. Then create `apps/web/src/lib/proof.ts` holding the one line `export const proof = "#c8f03a";` and run the command again.

Expected: `FAIL  colour-in-ts  apps/web/src/lib/proof.ts:1  #c8f03a is a colour literal; read it from packages/ui/src/tokens.ts`, `exit 1`. The file is untracked, and the check saw it.

Delete `apps/web/src/lib/proof.ts` (`rm apps/web/src/lib/proof.ts`: a file this step created). Run the command once more: `source: clean over 245 file(s).`, `exit 0`. `git status --short apps/web/src` must print nothing.

- [ ] **Step 4: The whole harness, under its final command**

Look at the ports, then run, with a timeout of twenty-five minutes: `npm run design:check; echo "exit $?"`

Expected:

```
source: clean over 245 file(s).
surfaces: clean over all 60 route(s).
tokens: clean over all 60 route(s).
contrast: clean over all 60 route(s).
type: clean over all 60 route(s).
exit 0
```

That is the first line of the spec's section 5: `npm run design:check` exits 0 with zero blocked routes.

- [ ] **Step 5: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "$(cat <<'MSG'
Design: the static check fails the build

The tree is clean, so a colour literal, a --pk-* definition or alias
outside the token file, a token read and never defined, a colour in
TypeScript or a class nothing names now exits 1.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- package.json
```

## Task 36: CI

**Owns:** `.github/workflows/design.yml` (created)

Two jobs. `source` runs the static check and the harness's unit tests, and needs neither a browser nor a server. `rendered` runs `npm run design:check` with Playwright installed on the runner and not in `package.json` (J27). The harness's unit tests also run under `npm test` in `postgres.yml` since task 1; `source` runs them again because it needs no database and answers in a minute.

- [ ] **Step 1: Write the workflow**

```sh
git apply --check $PLAN/patches/36-ci.patch && git apply $PLAN/patches/36-ci.patch
```

It creates `.github/workflows/design.yml`:

```yaml
name: Design

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  # What the source says: no colour outside the token file, no token defined or renamed outside
  # it, no class nothing names. Needs no browser and no server.
  source:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.22.0
          cache: npm
      - run: npm install --global npm@10.9.3
      - run: npm ci
      - run: npm run design:source
      - run: node --import tsx --test scripts/design/*.test.mjs

  # What the pages paint. Playwright is installed on the runner and not in package.json, as
  # docs/specs/design-system-v2.md decided: these are checks run against a server, not a
  # dependency of the build. The runner starts the fixture API and the web app itself.
  rendered:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.22.0
          cache: npm
      - run: npm install --global npm@10.9.3
      - run: npm ci
      - run: npm run build:shared
      - run: npm install --global playwright@1.63.0
      - run: playwright install --with-deps chromium
      - run: npm run design:check
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: design-servers-log
          path: scripts/design/.shots/servers.log
          if-no-files-found: ignore
```

- [ ] **Step 2: Run locally what the `source` job runs**

```sh
npm run design:source; echo "exit $?"
node --import tsx --test scripts/design/*.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Expected: `exit 0`; `tests 59`, `fail 0`.

- [ ] **Step 3: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/design.yml
git commit -m "$(cat <<'MSG'
CI: the design checks on every pull request

The static check and the harness's unit tests in one job; the rendered
checks in another, with Playwright installed on the runner.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- .github/workflows/design.yml
```

- [ ] **Step 5: After the branch is pushed — for the team lead, not the implementer**

Implementers do not push. When the team lead has pushed (`git push origin codex/cleanup-design-system`) and the pull request has run:

- `source` green and `rendered` green: nothing more to do.
- `rendered` red with `FAIL` or `BLOCKED` lines: the check found something. It is a defect of the tree, to be fixed like any other.
- `rendered` red before any route was measured — Chromium did not install, the web app did not come up, a font could not be fetched: that is the runner, not the tree. Read the `design-servers-log` artifact. If it cannot be made to run without a paid service, make the job manual by adding, under `rendered:`, the line

  ```yaml
  if: github.event_name == 'workflow_dispatch'
  ```

  and replace, in the appendix of `docs/specs/cleanup-and-design-system-v1.md`, the paragraph "Runtime checks in CI (3.4)" with: "They are a local gate: `npm run design:check` before a pull request. The `rendered` job in `.github/workflows/design.yml` runs only when started by hand, because <the reason the run gave>." The static check stays on every pull request either way, which is what the spec requires.

---

# Batch I — infrastructure leftovers

Task 37, then task 38. This batch shares no file with batches B to H and may run at any time after batch A, beside any of them. It changes no pixel and needs no harness.

Before anything: read `packages/infrastructure/AGENTS.md` and `workers/api/AGENTS.md`, as the root `AGENTS.md` requires. The database these tests use is the Docker PostgreSQL at `127.0.0.1:55432`; nothing here touches the hosted Supabase project.

## Task 37: The shared exports move to the module that uses them

**Owns:** `packages/infrastructure/src/persistence/growth-store.ts`, `packages/infrastructure/src/persistence/agent-registry.ts`, `packages/infrastructure/src/supabase/supabase-applicants.ts`, `packages/infrastructure/src/supabase/supabase-waitlist.ts`, `packages/infrastructure/src/supabase/agent-registry/supabase-agent-registry.ts`, `packages/infrastructure/src/index.ts`

Three adapter files that nothing calls also define four values that live code imports (A9):

| Value                              | Defined in                                               | Read by                                                            | Moves to                            |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `placementSchema`                  | `src/supabase/supabase-waitlist.ts`                      | `src/persistence/growth-store.ts`                                  | `src/persistence/growth-store.ts`   |
| `applicantSchema`, `outcomeSchema` | `src/supabase/supabase-applicants.ts`                    | `src/persistence/growth-store.ts`                                  | `src/persistence/growth-store.ts`   |
| `ANALYTICS_ROW_LIMIT`              | `src/supabase/agent-registry/supabase-agent-registry.ts` | `src/persistence/agent-registry.ts`; re-exported by `src/index.ts` | `src/persistence/agent-registry.ts` |

After this task the adapters still exist and still compile: they import the values from their new home. Task 38 removes them.

- [ ] **Step 1: Record what the tests say before**

```sh
npm run build:shared
node --import tsx --test packages/infrastructure/test/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Expected: `fail 0`. Write down `tests` and `pass`. The tests of the growth store and of the adapters both parse with these schemas, so they are what proves the move changed nothing.

- [ ] **Step 2: Move the values**

```sh
node $PLAN/tools/reline.mjs packages/infrastructure/src/persistence/growth-store.ts $PLAN/maps/37-growth-store.json
node $PLAN/tools/reline.mjs packages/infrastructure/src/supabase/supabase-applicants.ts $PLAN/maps/37-supabase-applicants.json
node $PLAN/tools/reline.mjs packages/infrastructure/src/supabase/supabase-waitlist.ts $PLAN/maps/37-supabase-waitlist.json
node $PLAN/tools/reline.mjs packages/infrastructure/src/persistence/agent-registry.ts $PLAN/maps/37-agent-registry.json
node $PLAN/tools/reline.mjs packages/infrastructure/src/supabase/agent-registry/supabase-agent-registry.ts $PLAN/maps/37-supabase-agent-registry.json
node $PLAN/tools/reline.mjs packages/infrastructure/src/index.ts $PLAN/maps/37-index.json
npx prettier --write packages/infrastructure/src
```

Expected: `2`, `2`, `2`, `1`, `2` and `2` edit(s) applied.

| File                                                 | Edit                                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persistence/growth-store.ts`                        | imports `CATEGORIES` and `PERSONALITIES` from `@pickler/core`; defines and exports the three schemas, word for word as the adapters had them; no longer imports from `../supabase/` |
| `supabase/supabase-applicants.ts`                    | imports the two schemas from `../persistence/growth-store.js`; its own definitions go; `z` becomes a type import                                                                    |
| `supabase/supabase-waitlist.ts`                      | imports `placementSchema` from `../persistence/growth-store.js`; its own definition and the `zod` import go                                                                         |
| `persistence/agent-registry.ts`                      | defines and exports `ANALYTICS_ROW_LIMIT = 10_000`; no longer imports from `../supabase/`                                                                                           |
| `supabase/agent-registry/supabase-agent-registry.ts` | imports the constant from `../../persistence/agent-registry.js`; its own definition goes                                                                                            |
| `src/index.ts`                                       | `ANALYTICS_ROW_LIMIT` is re-exported from `./persistence/agent-registry.js`                                                                                                         |

- [ ] **Step 3: Prove the live code no longer reaches into the adapters**

Run: `grep -rn 'supabase/' packages/infrastructure/src/persistence`

Expected: no output.

- [ ] **Step 4: Gates**

```sh
npm run build:shared
node --import tsx --test packages/infrastructure/test/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Expected: the same `tests` and `pass` as in step 1, `fail 0`.

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build:workers`.

- [ ] **Step 5: Commit**

```bash
git add packages/infrastructure/src/persistence/growth-store.ts \
  packages/infrastructure/src/persistence/agent-registry.ts \
  packages/infrastructure/src/supabase/supabase-applicants.ts \
  packages/infrastructure/src/supabase/supabase-waitlist.ts \
  packages/infrastructure/src/supabase/agent-registry/supabase-agent-registry.ts \
  packages/infrastructure/src/index.ts
git commit -m "$(cat <<'MSG'
Infrastructure: the growth schemas and the row limit live where they are used

Three adapters nothing calls also defined four values the PostgreSQL
classes import. The values move; the adapters import them back until
they are removed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- packages/infrastructure/src/persistence/growth-store.ts \
  packages/infrastructure/src/persistence/agent-registry.ts \
  packages/infrastructure/src/supabase/supabase-applicants.ts \
  packages/infrastructure/src/supabase/supabase-waitlist.ts \
  packages/infrastructure/src/supabase/agent-registry/supabase-agent-registry.ts \
  packages/infrastructure/src/index.ts
```

## Task 38: The unused adapters go

Runs after task 37 is committed.

**Owns:** deleted — eight files under `packages/infrastructure/src/supabase/`, four tests and one fixture under `packages/infrastructure/test/` (listed in step 2); modified — `packages/infrastructure/src/index.ts`, `packages/infrastructure/AGENTS.md`, `workers/api/AGENTS.md`, `docs/public-data-audit.md`.

| Removed                                                  | Exports                                                            | Its test                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `src/supabase/supabase-rest-client.ts`                   | `createSupabaseRestClient`, `SupabaseConfig`, `SupabaseRestClient` | `test/supabase.test.ts`                                 |
| `src/supabase/supabase-waitlist.ts`                      | `createSupabaseWaitlist`                                           | `test/supabase.test.ts`                                 |
| `src/supabase/supabase-applicants.ts`                    | `createSupabaseApplicants`                                         | `test/supabase.test.ts`, `test/fixtures/applicant.json` |
| `src/supabase/access/supabase-workspace-directory.ts`    | `createSupabaseWorkspaceDirectory`                                 | `test/supabase-access.test.ts`                          |
| `src/supabase/access/supabase-api-key-directory.ts`      | `createSupabaseApiKeyDirectory`                                    | `test/supabase-access.test.ts`                          |
| `src/supabase/agent-registry/supabase-agent-registry.ts` | `createSupabaseAgentRegistry`, `createSupabaseAgentEventLog`       | `test/supabase-agent-registry.test.ts`                  |
| `src/supabase/agent-registry/supabase-budget-source.ts`  | `createSupabaseBudgetSource`                                       | none                                                    |
| `src/supabase/profiles/supabase-profile-repository.ts`   | `createSupabaseProfileRepository`                                  | `test/supabase-profiles.test.ts`                        |

**Kept**, because the API composes them (`workers/api/src/container.ts`): `src/supabase/supabase-admin-client.ts` (`createSupabaseAdmin`), `src/supabase/wallet-accounts.ts` (`createWalletAccounts`, `createAuthUserLookup`), and `src/auth/supabase-jwt-verifier.ts`, with their tests.

- [ ] **Step 1: Prove nothing calls them**

```sh
git grep -nE 'createSupabase(ApiKeyDirectory|WorkspaceDirectory|AgentRegistry|AgentEventLog|BudgetSource|ProfileRepository|RestClient|Waitlist|Applicants)|SupabaseRestClient|SupabaseConfig\b' \
  -- apps workers packages scripts ':!packages/infrastructure/src/supabase' ':!packages/infrastructure/test' ':!*.md'
```

Expected: only lines of `packages/infrastructure/src/index.ts`, the re-exports this task removes. A line in `workers/`, `apps/` or `scripts/` is a caller: stop and report it.

- [ ] **Step 2: Remove the files**

```sh
git rm -q packages/infrastructure/src/supabase/supabase-applicants.ts \
  packages/infrastructure/src/supabase/supabase-waitlist.ts \
  packages/infrastructure/src/supabase/supabase-rest-client.ts \
  packages/infrastructure/src/supabase/access/supabase-api-key-directory.ts \
  packages/infrastructure/src/supabase/access/supabase-workspace-directory.ts \
  packages/infrastructure/src/supabase/agent-registry/supabase-agent-registry.ts \
  packages/infrastructure/src/supabase/agent-registry/supabase-budget-source.ts \
  packages/infrastructure/src/supabase/profiles/supabase-profile-repository.ts \
  packages/infrastructure/test/supabase-access.test.ts \
  packages/infrastructure/test/supabase-agent-registry.test.ts \
  packages/infrastructure/test/supabase-profiles.test.ts \
  packages/infrastructure/test/supabase.test.ts \
  packages/infrastructure/test/fixtures/applicant.json
ls packages/infrastructure/src/supabase
```

Expected: `supabase-admin-client.ts` and `wallet-accounts.ts`, and nothing else. `git rm` stages thirteen deletions, all of files this task owns.

- [ ] **Step 3: Remove the re-exports, and make the documents true**

```sh
node $PLAN/tools/reline.mjs packages/infrastructure/src/index.ts $PLAN/maps/38-index.json
node $PLAN/tools/reline.mjs packages/infrastructure/AGENTS.md $PLAN/maps/38-infrastructure-agents.json
node $PLAN/tools/reline.mjs workers/api/AGENTS.md $PLAN/maps/38-api-agents.json
node $PLAN/tools/reline.mjs docs/public-data-audit.md $PLAN/maps/38-audit.json
npx prettier --write packages/infrastructure/src/index.ts packages/infrastructure/AGENTS.md workers/api/AGENTS.md docs/public-data-audit.md
```

Expected: `3`, `3`, `1` and `1` edit(s) applied.

| File                                | Edit                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                      | the nine `createSupabase*` data-adapter exports and the two types go                                                                                                                  |
| `packages/infrastructure/AGENTS.md` | says the data adapters were removed on 2026-09-29 and that supabase-js remains for auth only; the PostgreSQL classes are described by what they do, not by the adapters they mirrored |
| `workers/api/AGENTS.md`             | "Do not wire a `createSupabase*` data adapter back in here" becomes "No Supabase data adapter exists any more, and none is to be written for this Worker"                             |
| `docs/public-data-audit.md`         | the deployed path for applicants is `PostgresApplicants`                                                                                                                              |

- [ ] **Step 4: Gates**

```sh
npm run build:shared
node --import tsx --test packages/infrastructure/test/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Expected: `fail 0`, and `tests` lower than in task 37 by the tests of the four files removed.

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:staging`, `npm run build:workers`. `build:workers` and the API's tests are what prove nothing imported the adapters (spec 3.5).

- [ ] **Step 5: Commit**

```bash
git add packages/infrastructure/src/index.ts packages/infrastructure/AGENTS.md workers/api/AGENTS.md docs/public-data-audit.md
git commit -m "$(cat <<'MSG'
Infrastructure: nine Supabase data adapters nothing calls are gone

The API reads those tables through the PostgreSQL classes. supabase-js
stays for auth: the JWT verifier, the admin client and wallet accounts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- packages/infrastructure/src/supabase packages/infrastructure/test/supabase-access.test.ts \
  packages/infrastructure/test/supabase-agent-registry.test.ts \
  packages/infrastructure/test/supabase-profiles.test.ts packages/infrastructure/test/supabase.test.ts \
  packages/infrastructure/test/fixtures/applicant.json packages/infrastructure/src/index.ts packages/infrastructure/AGENTS.md workers/api/AGENTS.md docs/public-data-audit.md
```

`packages/infrastructure/src/supabase` is named as a folder so the commit takes the eight deletions in it; the two files that stay there are unchanged, so nothing of theirs is committed.

---

# Batch J — close

## Task 39: The documents say what the code does

**Owns:** `apps/web/AGENTS.md`, `packages/ui/AGENTS.md`, `docs/specs/cleanup-and-design-system-v1.md`, `docs/specs/design-system-v2.md`

The root `AGENTS.md` requires a project's instructions to change with the project. Two of them still tell a feature stylesheet to alias the tokens.

- [ ] **Step 1: Apply the patch**

```sh
git apply --check $PLAN/patches/39-docs.patch && git apply $PLAN/patches/39-docs.patch
npx prettier --write apps/web/AGENTS.md packages/ui/AGENTS.md docs/specs/cleanup-and-design-system-v1.md docs/specs/design-system-v2.md
```

| File                                                       | Change                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/AGENTS.md`, "Design system"                      | which shells are light and which dark (`/apply` is dark, the agent pages light); no screen paints a ground of its own; a sheet reads tokens by name, defines no alias and no `--pk-*`, holds no literal; `src/lib/accent.ts` is the one channel from TypeScript; `npm run design:source` enforces it |
| `apps/web/AGENTS.md`, "The new creation flow's pure logic" | `updateConfig` leaves the list of wrappers in `api.ts`                                                                                                                                                                                                                                               |
| `apps/web/AGENTS.md`, "Studio integration"                 | `sections/rail.ts` is the one list; a section with no screen is SOON and opens on `sections/soon.tsx`                                                                                                                                                                                                |
| `apps/web/AGENTS.md`, new section "Design checks"          | the three commands, the ports, the doors, and that a new screen gets a route in the same change                                                                                                                                                                                                      |
| `packages/ui/AGENTS.md`                                    | the file list and the exports gain `brand.tsx`, `tokens.ts`, `BrandMark`, `TOKEN_MIRROR`; the "Colour" rule is rewritten; the chart reads `--pk-rule-strong`                                                                                                                                         |
| `docs/specs/cleanup-and-design-system-v1.md`               | an appendix: the tokens kept, removed, added and renamed (D5), and where the runtime checks run (3.4)                                                                                                                                                                                                |
| `docs/specs/design-system-v2.md`                           | two dated corrections: under §6, that neither dark pin stands; under Validation, that "no literal colour left" was false and why the check could not see it                                                                                                                                          |

- [ ] **Step 2: Check the links, paths and commands**

The root `AGENTS.md` asks this of a documentation change. For each path and command the patch adds, check it exists:

```sh
ls apps/web/src/lib/accent.ts apps/web/src/features/studio/sections/rail.ts \
  apps/web/src/features/studio/sections/soon.tsx apps/web/test/studio-rail.test.ts \
  packages/ui/src/tokens.ts packages/ui/src/brand.tsx scripts/design/mirror.test.mjs \
  .github/workflows/design.yml docs/superpowers/plans/2026-09-29-cleanup-design-system.md
npm run | grep -E 'design:(check|shots|compare|source)'
```

Expected: nine paths and four scripts, no "No such file".

- [ ] **Step 3: Gates**

Run, and check each exit status is 0: `npm run format:check`, `npm run lint`, `npm run check:architecture`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/AGENTS.md \
  packages/ui/AGENTS.md \
  docs/specs/cleanup-and-design-system-v1.md \
  docs/specs/design-system-v2.md
git commit -m "$(cat <<'MSG'
Docs: the instructions and the specs say what the code does

Feature stylesheets read tokens by name and alias none; the agent pages
are light and /apply is dark without a backdrop; the studio has one
list of sections. The cleanup spec gains its appendix of tokens.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)" -- apps/web/AGENTS.md \
  packages/ui/AGENTS.md \
  docs/specs/cleanup-and-design-system-v1.md \
  docs/specs/design-system-v2.md
```

## Task 40: The last comparison and every gate

**Owns:** nothing. It commits nothing. It is the spec's section 5, "What done means", run as written.

- [ ] **Step 1: `npm run design:check` exits 0 with zero blocked routes**

Look at the ports, then run, with a timeout of twenty-five minutes:

```sh
npm run design:check > scripts/design/.shots/final-check.txt 2>&1; echo "exit $?"
grep -E '^(BLOCKED|FAIL)|clean over|^source' scripts/design/.shots/final-check.txt
```

Expected: `exit 0`, and exactly these five lines:

```
source: clean over 245 file(s).
surfaces: clean over all 60 route(s).
tokens: clean over all 60 route(s).
contrast: clean over all 60 route(s).
type: clean over all 60 route(s).
```

- [ ] **Step 2: The screenshots, before and after**

The folder `baseline` has been moved forward after tasks 9, 15, 26, 32 and 34, so it is the tree after task 34. Capture once more and compare:

```sh
DESIGN_SHOTS_DIR=scripts/design/.shots/final npm run design:shots
npm run --silent design:compare -- scripts/design/.shots/baseline scripts/design/.shots/final \
  --noise scripts/design/.shots/noise.txt
```

Expected: `wrote 120 shot(s)`; every line of the comparison starts with `NOISE`. Tasks 33, 35, 36, 37, 38 and 39 move no pixel.

Then report to the team lead the whole list of what changed between the first baseline and now, which is the sum of the expected differences of tasks 9, 15, 26 and 32:

| Screens                                             | Task      | Spec                                                                 |
| --------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| `agents`, `agent-profile`, `agent-ask`              | 5         | 3.1, D2: dark to light                                               |
| `apply-no-seat`                                     | 6, 15, 23 | 3.1, D3: the backdrop; A3: the brand's glow; the glow button's bevel |
| `signin`, `signup`, `signup-passkey`, `passkey-add` | 7, 24, 26 | 3.1, D1: the floor; A3: the glows and hairlines                      |
| the studio's shell and the empty home               | 32        | D8, A6: `SOON` in the rails, one panel                               |
| nine new `studio-*` screens                         | 34        | 3.4: coverage                                                        |

Every other screen is identical or within noise. That is the second line of the spec's section 5: a route differs only where the spec says it changes or where a literal moved to its token's value.

- [ ] **Step 3: Every gate, by exit status**

Check the ports are free. Check the database is up: `lsof -nP -iTCP:55432 -sTCP:LISTEN` prints a line; if not, start Docker Desktop and run `npm run db:up`.

```sh
for gate in build:shared typecheck lint format:check test build check:staging build:workers; do
  npm run $gate > scripts/design/.shots/gate-$gate.log 2>&1
  echo "$gate: exit $?"
done
```

Expected: eight lines, each `exit 0`. The contracts workflow is not run: no task touched `contracts/`.

If `test` exits 1 with a Postgres connection timeout while other agents are running tests, that is contention. Find the failing files in `scripts/design/.shots/gate-test.log` and run them alone: `node --import tsx --test <file> [<file>…]`. Report contention only if they pass alone, and name the files.

- [ ] **Step 4: Leave the worktree as you found it**

```sh
lsof -nP -iTCP:3001 -sTCP:LISTEN; lsof -nP -iTCP:8799 -sTCP:LISTEN
git status --short
```

Expected: the two `lsof` commands print nothing. `git status` prints nothing of yours: `scripts/design/.shots/` is ignored, and `apps/web/next-env.d.ts` is as committed.

- [ ] **Step 5: Report**

To the team lead: the five lines of step 1, the last line of the comparison, the eight exit statuses, and the table of step 2. Do not push.
