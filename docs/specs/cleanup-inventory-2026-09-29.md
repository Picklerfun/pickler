# Cleanup inventory, 2026-09-29

Evidence for [Cleanup and one design system v1](cleanup-and-design-system-v1.md). Visual authority:
[Design system v2](design-system-v2.md).

Measured on branch `codex/cleanup-design-system` at `572980d` (one documentation commit on top of
`origin/main` at `f02fb99`, which includes the launchpad, custody and `packages/trading` merges).
Nothing was rendered: no server was listening on port 3001 and none was started, so every statement
about what a route shows is reasoned from the code. An earlier inventory was lost; each section ends
with what changed against its headline numbers.

Paths in tables are relative to `apps/web/src/features/` unless they start with `app/`, `lib/`,
`server/` (relative to `apps/web/src/`), `ui/` (`packages/ui/src/`) or a top-level directory.

## Summary of counts

| Section | Finding                                               | Now                                 | Earlier          |
| ------- | ----------------------------------------------------- | ----------------------------------- | ---------------- |
| 1       | Routes drawing the backdrop                           | 7 (3 sky, 1 sky and floor, 3 floor) | 7                |
| 1       | Backdrop classes / keyframes / tokens                 | 6 live + 2 dead / 3 / 7             | not counted      |
| 2       | Routes (pages + handlers)                             | 22 pages, 2 handlers, 2 fallbacks   | not counted      |
| 2       | Routes on the wrong surface                           | 3                                   | 3                |
| 3       | Unreferenced CSS classes                              | 96                                  | 75               |
| 3       | Unused exports (nowhere / test-only)                  | 124 (78 / 46)                       | 95 (61 / 34)     |
| 4       | Custom properties defined in CSS modules              | 107 in 7 modules (72 plain aliases) | 100 in 7 modules |
| 4       | Reads of `--label`                                    | 153                                 | 153              |
| 4       | Carried-forward tokens / their uses                   | 21 / 270                            | 21               |
| 4       | Colour literals in CSS (modules / `styles.css` rules) | 97 / 5                              | 92               |
| 4       | Hex literals in TS                                    | 24 in 5 files                       | 17               |
| 4       | Tokens read but never defined                         | 1 (`--pk-font-mono`)                | 1                |
| 4       | `--pk-*:` assignments outside `styles.css`            | 0                                   | 0                |
| 5       | Studio section keys (real / stub)                     | 13 (7 / 6)                          | 6 stubs          |
| 6       | Harness route entries / predicted BLOCKED             | 50 / 14                             | 13 blocked       |
| 7       | Unused `createSupabase*` adapters / their test files  | 9 / 4                               | 9 / 4            |
| 7       | API handlers with no web caller                       | 18, plus 2 alias mounts             | 14               |

## 1. The backdrop ("the space one")

Three drawings make up the pre-v2 backdrop: a radial-gradient night sky (`.space`), a dotted
starfield (`.stars`) and a perspective neon floor grid (`.floorGrid`, `.floor`). `design-system-v2.md`
assigns the marketplace the light surface and the studio the dark one (lines 17-18, 102-104), and
names `apply` and `agents` as the two modules that paint an opaque dark layer of their own (lines
252-263).

### 1.1 Routes that draw it

| Route                  | Page file                             | Wrapper                                              | Draws                    | Surface now | Surface per spec                   |
| ---------------------- | ------------------------------------- | ---------------------------------------------------- | ------------------------ | ----------- | ---------------------------------- |
| `/agents`              | `app/agents/page.tsx:19`              | `PublicShell surface="dark"`                         | sky, stars               | dark        | light                              |
| `/agents/[handle]`     | `app/agents/[handle]/page.tsx:32`     | `PublicShell surface="dark"`                         | sky, stars               | dark        | light                              |
| `/agents/[handle]/ask` | `app/agents/[handle]/ask/page.tsx:45` | `PublicShell surface="dark"`                         | sky, stars               | dark        | light                              |
| `/apply`               | `app/apply/page.tsx:23`, `:29`        | `ApplyShell` (`apply/components/apply-shell.tsx:11`) | sky, moving stars, floor | dark        | dark (studio segment), no backdrop |
| `/signin`              | `app/(auth)/signin/page.tsx`          | `app/(auth)/layout.tsx:10-11`                        | moving floor             | dark        | dark, no backdrop                  |
| `/signup`              | `app/(auth)/signup/page.tsx`          | `app/(auth)/layout.tsx:10-11`                        | moving floor             | dark        | dark, no backdrop                  |
| `/passkey`             | `app/(auth)/passkey/page.tsx`         | `app/(auth)/layout.tsx:10-11`                        | moving floor             | dark        | dark, no backdrop                  |

The other ten `PublicShell` routes pass no `surface` and render light with no backdrop
(`agents/components/public-shell.tsx:17`, `:32`).

### 1.2 Markup and props

| Item                                        | Where                                                                   | Note                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `surface` prop of `PublicShell`             | `agents/components/public-shell.tsx:17`, `:21`                          | Default `"light"`. Only three callers pass `"dark"` (table above)                  |
| `data-surface={surface}`                    | `agents/components/public-shell.tsx:31`                                 | Becomes a constant `"light"` when the prop goes                                    |
| Backdrop markup, sky and stars              | `agents/components/public-shell.tsx:32-37`                              | Rendered only when `surface === "dark"`                                            |
| `surface` passed on to `SiteNav`            | `agents/components/public-shell.tsx:38`                                 | `SiteNav` keeps its own `surface` prop (`site/site-nav.tsx:60-64`, read at `:141`) |
| Comment explaining the prop                 | `agents/components/public-shell.tsx:7-14`                               | Says the prop goes when the last body is redrawn                                   |
| Backdrop markup, sky, stars and floor       | `apply/components/apply-shell.tsx:12-16`                                | Unconditional                                                                      |
| `data-surface="dark"` on `/apply`           | `apply/components/apply-shell.tsx:11`                                   | Stays (D3); comment at `:9-10` names `.space`                                      |
| Floor markup                                | `app/(auth)/layout.tsx:11`                                              | `data-surface="dark"` at `:10` stays                                               |
| Harness entries pinned dark "until redrawn" | `scripts/design/routes.mjs:110-126`, `:131`, `:144`, `:156`, `:313-319` | Four entries flip to `light` (three agents routes) or stay dark (`/apply`)         |

### 1.3 Classes and keyframes

| Class or keyframes | Defined at                       | Used at                                 | Paints                                                                                            |
| ------------------ | -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `.space`           | `agents/agents.module.css:54-64` | `agents/components/public-shell.tsx:34` | `radial-gradient(120% 70% at 50% 0%, core, mid 45%, edge)`                                        |
| `.stars`           | `agents/agents.module.css:66-73` | `agents/components/public-shell.tsx:35` | 1px white dots at 0.7, 130px tile, opacity 0.4, static                                            |
| `.space`           | `apply/apply.module.css:118-128` | `apply/components/apply-shell.tsx:13`   | Same gradient at `120% 80%`                                                                       |
| `.stars`           | `apply/apply.module.css:130-145` | `apply/components/apply-shell.tsx:14`   | Two dot layers (0.8 and 0.5), opacity 0.45, `animation: stars 26s`                                |
| `.floorGrid`       | `apply/apply.module.css:147-162` | `apply/components/apply-shell.tsx:15`   | Cyan `#5AD8FF` at 0.4 and violet at 0.35 lines, 64px, `perspective(520px) rotateX(75deg)`, masked |
| `@keyframes stars` | `apply/apply.module.css:868-875` | `apply/apply.module.css:144`            | `translateY(0)` to `translateY(-40px)`                                                            |
| `.floor`           | `auth/auth.module.css:76-93`     | `app/(auth)/layout.tsx:11`              | Cyan at 0.3 and violet at 0.26 lines, 64px, `rotateX(76deg)`, fixed, `animation: grid 9s`         |
| `@keyframes grid`  | `auth/auth.module.css:939`       | `auth/auth.module.css:92`               | Moves the grid                                                                                    |
| `.signinGlow`      | `auth/auth.module.css:649-658`   | nowhere (dead, section 3)               | Violet radial glow fading to the old console ground `rgba(8, 8, 10, 0)`                           |
| `.signinStars`     | `auth/auth.module.css:660-675`   | nowhere (dead, section 3)               | Two dot layers, `animation: stars 90s`                                                            |
| `@keyframes stars` | `auth/auth.module.css:1007-1018` | `auth/auth.module.css:674` only         | Goes with `.signinStars`                                                                          |

Reduced motion is handled by a blanket rule in each module (`apply/apply.module.css:816-823`,
`auth/auth.module.css:931-937`), not per backdrop class, so nothing there needs to change.

### 1.4 Tokens, and every reader

| Token                    | Defined (`ui/styles.css`) | Uses | Readers                                                                                  |
| ------------------------ | ------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `--pk-space-core`        | 56                        | 2    | `agents/agents.module.css`: 60<br>`apply/apply.module.css`: 124                          |
| `--pk-space-mid`         | 57                        | 2    | `agents/agents.module.css`: 61<br>`apply/apply.module.css`: 125                          |
| `--pk-space-edge`        | 58                        | 2    | `agents/agents.module.css`: 62<br>`apply/apply.module.css`: 126                          |
| `--pk-space-edge-rgb`    | 70                        | 3    | `markets/markets.module.css`: 1028<br>`ui/styles.css`: 90, 91                            |
| `--pk-space-veil`        | 90                        | 4    | `apply/apply.module.css`: 107, 405, 504, 630                                             |
| `--pk-space-veil-strong` | 91                        | 3    | `apply/apply.module.css`: 170, 475, 768                                                  |
| `--pk-glow-rim`          | 100                       | 4    | `apply/apply.module.css`: 61, 435<br>`auth/auth.module.css`: 167<br>`ui/styles.css`: 511 |
| `--pk-font-mono`         | not defined               | 1    | `wallet/components/claim-handle.module.css`: 17                                          |

Seven tokens belong to the backdrop (`--pk-font-mono` is in the table only because section 4 needs
it). Three findings an implementer has to act on, because the cleanup spec (3.1) assumes these
tokens are read only by the backdrop:

| Token                              | Backdrop readers                 | Readers that are not the backdrop                                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pk-space-core`, `-mid`, `-edge` | the two `.space` rules (6 reads) | none                                                                                                                                                                                                                                                                 |
| `--pk-space-edge-rgb`              | none directly                    | `markets/markets.module.css:1028` (`.order`, the review phase of the trade ticket, on a light panel; comment at `:1019-1027`), and the two veils at `ui/styles.css:90-91`                                                                                            |
| `--pk-space-veil`                  | none                             | 4 live rules in `/apply`: `.page .secondaryButton` (107), `.chip` (405), `.well` (504), `.tile` (630)                                                                                                                                                                |
| `--pk-space-veil-strong`           | none                             | 3 live rules in `/apply`: `.header` (170), `.piece` shadow (475), `.post` (768)                                                                                                                                                                                      |
| `--pk-glow-rim`                    | none                             | `.pk-button[data-glow="true"]` (`ui/styles.css:511`, used by `glow` at `apply/components/application-form.tsx:354`, `no-seat.tsx:22`, `submitted.tsx:154`); `.primary` (`auth/auth.module.css:167`, five call sites); `.pixel` (`apply/apply.module.css:61`, `:435`) |

So only the core, mid and edge tokens go with the markup. The veils and the edge triple need a v2
replacement first (`--pk-panel`, `--pk-nav-bg` and `--pk-rule` are the candidates on a plain dark
ground), and `--pk-glow-rim` is a live part of the button system, not backdrop.

Comments that describe the backdrop and must move with it: `ui/styles.css:46-55`, `:60-69`,
`:72-89`, `:93-99`; `scripts/design/lib/probe.mjs` (the sentinel that excludes the triple, named at
`ui/styles.css:66`).

### Method

Text search for the class names, then the token names, over `apps/web/src`, `packages/ui/src` and
`scripts/design`; each hit read in place. Token readers come from the script in section 4.

```sh
grep -rn -E 'space|stars|floor|glow-rim' --include='*.css' --include='*.tsx' --include='*.ts' \
  apps/web/src packages/ui/src \
  | grep -v -E 'white-space|letter-spacing|namespace|workspace|spacing|Math\.floor|space-(between|around|evenly)'
grep -rn -E 'PublicShell|ApplyShell|surface=' apps/web/src --include='*.tsx'
grep -rn 'data-surface' apps/web/src --include='*.tsx'
```

**Changed since the earlier inventory:** the same seven routes. New: the veils, the edge triple and
`--pk-glow-rim` all have readers outside the backdrop (15 reads), and `auth.module.css` holds a
second, already dead sky (`.signinGlow`, `.signinStars`).

## 2. Routes

22 pages, 2 route handlers, the root layout, one group layout and 2 fallbacks. Data column: "API"
means the web's server facade (`server/container.ts:20-74`) or a client wrapper calling
`workers/api`; the adapter behind each API route is named from `workers/api/src/growth/services.ts:33-42`
and `workers/api/src/container.ts:384`.

| Route                             | Page file                                     | Feature component                                        | Shell or layout                 | Surface now     | Spec  | Data source                                                                                             | Linked from                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------------- | ------------------------------- | --------------- | ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                               | `app/page.tsx`                                | `LandingPage` (`landing/components/landing-page.tsx:25`) | own                             | light           | light | **Sample**: `GET /v1/landing`, `createSampleLandingReadModel`                                           | brand links: `site/site-nav.tsx:77`, `landing/components/landing-nav.tsx:24`, `apply/components/apply-shell.tsx:19`, `:32`, `auth/components/auth-header.tsx:15`, `account/account.tsx:235`, `studio/studio.tsx:521`, `studio/home/home.tsx:225`, `studio/home/empty.tsx:308`, `studio/create/create.tsx:449` |
| `/tokens`                         | `app/tokens/page.tsx`                         | `LaunchBoard` (`agents/components/launch-board.tsx`)     | `PublicShell`                   | light           | light | Real: `GET /v1/launches`, `PostgresLaunchReadModel`; a 404 becomes `null` (`server/container.ts:24-36`) | `site/site-nav.tsx:24`, `app/not-found.tsx:10`, `agents/components/token-page.tsx:33`, `wallet/components/portfolio-page.tsx:258`                                                                                                                                                                             |
| `/tokens/[ticker]`                | `app/tokens/[ticker]/page.tsx`                | `TokenPage`                                              | `PublicShell charts`            | light           | light | Real: `/v1/marketplace/profiles/:ticker`, `PostgresAgentDirectory`                                      | `agents/components/launch-board.tsx:55`, `agents/components/persona-page.tsx:127`                                                                                                                                                                                                                             |
| `/tokens/[ticker]/picks/[pickId]` | `app/tokens/[ticker]/picks/[pickId]/page.tsx` | `PickDetail`                                             | `PublicShell`                   | light           | light | Real: `/v1/marketplace/profiles/:ticker/picks/:id`                                                      | `agents/components/token-page.tsx:100`                                                                                                                                                                                                                                                                        |
| `/agents`                         | `app/agents/page.tsx`                         | `AgentsDirectory`                                        | `PublicShell surface="dark"`    | **dark**        | light | Real: `/v1/marketplace/directory`                                                                       | `site/site-nav.tsx:25`, `agents/components/persona-page.tsx:68`, `reads-page.tsx:63`, `markets/components/ask-ticket.tsx:90`, `market-view.tsx:189`, `wallet/components/activity-page.tsx:57`                                                                                                                 |
| `/agents/[handle]`                | `app/agents/[handle]/page.tsx`                | `PersonaPage`                                            | `PublicShell surface="dark"`    | **dark**        | light | Real: `/v1/marketplace/personas/:handle`                                                                | `agents/components/agents-directory.tsx:96`, `:152`, `leaderboard-page.tsx:113`, `token-page.tsx:65`, `activity-row.tsx:32`, `read-card.tsx:46`, `ask-flow.tsx:48`, redirect at `app/agents/[handle]/ask/page.tsx:39`                                                                                         |
| `/agents/[handle]/ask`            | `app/agents/[handle]/ask/page.tsx`            | `AskFlow`                                                | `PublicShell surface="dark"`    | **dark**        | light | Real: persona as above; redirects to the persona when the service is closed                             | `agents/components/agents-directory.tsx:141`, `persona-page.tsx:118`, `read-card.tsx:128`                                                                                                                                                                                                                     |
| `/markets`                        | `app/markets/page.tsx`                        | `MarketsBoard`                                           | `PublicShell`                   | light           | light | **Sample**: `/v1/marketplace/markets`, `createSampleMarketBoard`                                        | `site/site-nav.tsx:26`, `markets/components/market-view.tsx:138`, `wallet/components/portfolio-page.tsx:238`                                                                                                                                                                                                  |
| `/markets/[symbol]`               | `app/markets/[symbol]/page.tsx`               | `MarketView`                                             | `PublicShell`                   | light           | light | **Sample**: `/v1/marketplace/markets/:symbol`                                                           | `markets/components/markets-board.tsx:126`                                                                                                                                                                                                                                                                    |
| `/leaderboard`                    | `app/leaderboard/page.tsx`                    | `LeaderboardPage`                                        | `PublicShell charts`            | light           | light | Real: `/v1/marketplace/leaderboard`, `/analytics`                                                       | `site/site-nav.tsx:29`, `:42`, `agents/components/persona-page.tsx:239`, `platform-numbers.tsx:99`                                                                                                                                                                                                            |
| `/reads`                          | `app/reads/page.tsx`                          | `ReadsPage`                                              | `PublicShell`                   | light           | light | Real: `/v1/marketplace/reads`                                                                           | `wallet/components/account-menu.tsx:111`, `agents/components/read-card.tsx:43`                                                                                                                                                                                                                                |
| `/reads/[id]`                     | `app/reads/[id]/page.tsx`                     | `ReadCard`                                               | `PublicShell`                   | light           | light | Real: `/v1/marketplace/reads/:id`                                                                       | `agents/components/read-parts.tsx:52`, `reads-page.tsx:77`, `wallet/components/portfolio-page.tsx:287`                                                                                                                                                                                                        |
| `/portfolio`                      | `app/portfolio/page.tsx`                      | `PortfolioPage`                                          | `PublicShell`                   | light           | light | Real: `/v1/marketplace/agents`, `/reads`; wallet state in the browser                                   | `wallet/components/account-menu.tsx:103`, `markets/components/trade-ticket.tsx:583`                                                                                                                                                                                                                           |
| `/activity`                       | `app/activity/page.tsx`                       | `ActivityPage`                                           | `PublicShell`                   | light           | light | Real: `/v1/marketplace/directory`, `/analytics`                                                         | `wallet/components/account-menu.tsx:107`                                                                                                                                                                                                                                                                      |
| `/apply`                          | `app/apply/page.tsx`                          | `NoSeat` or `ApplyFlow`                                  | `ApplyShell`                    | dark + backdrop | dark  | Real: `GET /v1/applications` with the apply cookie, `PostgresApplicants`                                | `landing/components/waitlist-form.tsx:30`, `:59`, `:61` (after joining the waitlist)                                                                                                                                                                                                                          |
| `/signin`                         | `app/(auth)/signin/page.tsx`                  | `PasskeyFlow mode="in"`                                  | `app/(auth)/layout.tsx`         | dark + floor    | dark  | **Sample** board (`getLanding`); Supabase and `/v1/signing` for the flow                                | `account/account.tsx:289`; redirects at `studio/studio.tsx:255`, `:639`, `studio/create/create.tsx:190`, `server/guard.ts:87`, `app/auth/callback/route.ts:15`, `:31`                                                                                                                                         |
| `/signup`                         | `app/(auth)/signup/page.tsx`                  | `PasskeyFlow mode="up"`                                  | `app/(auth)/layout.tsx`         | dark + floor    | dark  | As `/signin`                                                                                            | **No link.** Only redirect targets: `auth/lib/callback.ts:21`, `:31`, `:32`                                                                                                                                                                                                                                   |
| `/passkey`                        | `app/(auth)/passkey/page.tsx`                 | `PasskeyFlow mode="add"`                                 | `app/(auth)/layout.tsx`         | dark + floor    | dark  | As `/signin`; behind a session (`server/guard.ts:27`)                                                   | `auth/components/passkey-flow.tsx:339`, `auth/lib/second-passkey.ts:23`                                                                                                                                                                                                                                       |
| `/studio`                         | `app/studio/page.tsx`                         | `Studio` (`studio/studio.tsx`)                           | own                             | dark            | dark  | Real: `/v1/studio/*`; fixtures behind `?stage=` and when auth is unconfigured (section 7d)              | `useStudioHref`: `site/site-nav.tsx:67`, `auth/components/passkey-flow.tsx:202`, `:639`, `account/account.tsx:75`, `studio/create/create.tsx:123`, `locked.tsx:16`; rewrite of `/` on the studio host (`middleware.ts:72`)                                                                                    |
| `/studio/new`                     | `app/studio/new/page.tsx`                     | `CreateAgent`                                            | own                             | dark            | dark  | Real: `/v1/studio/*`; sample draft when not production (`allowSample`)                                  | `studio/studio.tsx:581`, `studio/home/menu.tsx:129`, `studio/home/empty.tsx:448`                                                                                                                                                                                                                              |
| `/account`                        | `app/account/page.tsx`                        | `Account`                                                | own                             | dark            | dark  | Real: `/v1/profile`, `/v1/signing/*`; preview when auth is unconfigured                                 | `studio/home/home.tsx:256`, `studio/home/empty.tsx:334`                                                                                                                                                                                                                                                       |
| `/console`                        | `app/console/page.tsx`                        | none, `redirect("/studio")` at `:14`                     | none                            | none            | none  | none                                                                                                    | **No link anywhere**                                                                                                                                                                                                                                                                                          |
| `/auth/callback`                  | `app/auth/callback/route.ts`                  | handler                                                  | none                            | none            | none  | Supabase code exchange, `/v1/profile`, `/v1/signing/wallets/me`                                         | the e-mail link Supabase sends (`auth/lib/account.ts:24`)                                                                                                                                                                                                                                                     |
| `/api/v1/[...path]`               | `app/api/v1/[...path]/route.ts`               | proxy to the API                                         | none                            | none            | none  | forwards any method and path                                                                            | every browser `fetch` in the features                                                                                                                                                                                                                                                                         |
| not found                         | `app/not-found.tsx:6`                         | inline                                                   | `.fallback` (`app/globals.css`) | light           | light | none                                                                                                    | `notFound()` and the middleware (`middleware.ts`, `notFound` case)                                                                                                                                                                                                                                            |
| error                             | `app/error.tsx:12`                            | inline                                                   | `.fallback`                     | light           | light | none                                                                                                    | error boundary                                                                                                                                                                                                                                                                                                |

### Flags

| Flag                                        | Route                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong surface                               | the three `/agents` routes                                                                                              | Section 1.1                                                                                                                                                                                                                                                                                                                                                                    |
| Unlinked, and dead on both production hosts | `/console`                                                                                                              | No `href` or `push` names it. `console` is not in `STUDIO_SEGMENTS` (`server/hosts.ts:44-52`), so `ownerOf` gives `marketplace` (`:83-89`): the studio host answers 404, and the marketplace host redirects to `/studio`, which it then refuses as a studio path (`middleware.ts:58-62`). It works only on a host that is neither (localhost, a preview). Reasoned, not probed |
| Unlinked                                    | `/signup`                                                                                                               | No link in `apps/web/src`. Reached by typing the address or by the callback redirect. `app/(auth)/layout.tsx:5` says the auth screens are deliberately not linked from the landing while the waitlist is the entry                                                                                                                                                             |
| Linked from one place                       | `/activity`, `/account`, `/apply`                                                                                       | One menu or one screen each (table above)                                                                                                                                                                                                                                                                                                                                      |
| Announced, not built                        | five nav items with no `href`                                                                                           | `site/site-nav.tsx:38-39`, `:51-53`: Deploy Agent, MCP & Skills, Docs, API Reference, MCP                                                                                                                                                                                                                                                                                      |
| Preview-only doors                          | `/studio?stage=`, `?section=`; `/studio/new?step=`; `/account?section=`; `/signup?state=`; `/portfolio?state=connected` | Each is gated on `NODE_ENV` in its page file (`app/studio/page.tsx`, `app/studio/new/page.tsx`, `app/account/page.tsx`, `app/(auth)/signup/page.tsx`, `app/portfolio/page.tsx`). D9 keeps them                                                                                                                                                                                 |
| New from main                               | `/console`, and the body of `/tokens`                                                                                   | The merge `91e3cd4` changed two files under `app/` against its first parent: it added `app/console/page.tsx` and rewrote `app/tokens/page.tsx` to render `LaunchBoard` over `/v1/launches`. The second orphaned the old token board classes (section 3) and staled the harness proof (section 6). Custody and trading added no route                                           |
| Sample data shown                           | `/`, `/markets`, `/markets/[symbol]`, and the board on `/signin`, `/signup`, `/passkey`                                 | Section 7d                                                                                                                                                                                                                                                                                                                                                                     |

### Method

Listed `apps/web/src/app`, read every page, layout and handler, then collected every internal
address from `href`, `router.push`, `router.replace` and `redirect`. Links built through
`useStudioHref` and `useStudioUrl` were searched by name. No route was requested.

```sh
git ls-files apps/web/src/app
lsof -nP -iTCP:3001 -sTCP:LISTEN   # nothing listening
grep -rn -o -E "(href|push|replace|redirect)[=(: ]+\{?[\`\"']/[A-Za-z0-9_/\${}.?=&#-]*" apps/web/src \
  --include='*.ts' --include='*.tsx'
grep -rn -E 'useStudioUrl\(|useStudioHref\(|studioHref\(' apps/web/src
```

Caveat: an address assembled from variables with no leading literal would be missed. None was
found by reading the navigation components.

**Changed since the earlier inventory:** the route list was not preserved, so there is no number to
compare. Main added `/console` and replaced the body of `/tokens`; `/console` being refused by both
production hosts is new.

## 3. Dead code inside reachable files

### 3.1 Unreferenced CSS classes: 96

| Module                        | Classes defined | Unreferenced | Earlier |
| ----------------------------- | --------------- | ------------ | ------- |
| `auth/auth.module.css`        | 147             | 59           | 55      |
| `agents/agents.module.css`    | 275             | 32           | 15      |
| `studio/home/home.module.css` | 151             | 2            | 2       |
| `studio/studio.module.css`    | 141             | 2            | 2       |
| `landing/landing.module.css`  | 93              | 1            | 1       |
| the other 12 modules          | 481             | 0            | 0       |

"Classes defined" counts every class name in a selector, including the `:global(.pk-*)` names
excluded below. The rise in `agents` is the old token board (`.grid`, `.card*`, `.curve*`, `.table*`, `.viewToggle`,
`.stageButton`) that `LaunchBoard` replaced. The rise in `auth` was not traced to a commit.
**`apps/web/src/features/agents/agents.module.css`: 32**

| Class             | Line                            |
| ----------------- | ------------------------------- |
| `.navTab`         | `agents/agents.module.css:127`  |
| `.navTabActive`   | `agents/agents.module.css:131`  |
| `.spacer`         | `agents/agents.module.css:179`  |
| `.search`         | `agents/agents.module.css:194`  |
| `.stageButton`    | `agents/agents.module.css:199`  |
| `.resultCount`    | `agents/agents.module.css:220`  |
| `.grid`           | `agents/agents.module.css:228`  |
| `.card`           | `agents/agents.module.css:237`  |
| `.cardTop`        | `agents/agents.module.css:251`  |
| `.cardFoot`       | `agents/agents.module.css:261`  |
| `.cardHead`       | `agents/agents.module.css:270`  |
| `.cardName`       | `agents/agents.module.css:305`  |
| `.cardStats`      | `agents/agents.module.css:353`  |
| `.cardStat`       | `agents/agents.module.css:361`  |
| `.curve`          | `agents/agents.module.css:402`  |
| `.cardCta`        | `agents/agents.module.css:415`  |
| `.followChip`     | `agents/agents.module.css:484`  |
| `.backCurve`      | `agents/agents.module.css:698`  |
| `.bar`            | `agents/agents.module.css:698`  |
| `.barFill`        | `agents/agents.module.css:703`  |
| `.chartStats`     | `agents/agents.module.css:928`  |
| `.heroPrice`      | `agents/agents.module.css:955`  |
| `.navCta`         | `agents/agents.module.css:958`  |
| `.navItem`        | `agents/agents.module.css:963`  |
| `.filterRowSplit` | `agents/agents.module.css:985`  |
| `.viewToggle`     | `agents/agents.module.css:995`  |
| `.viewButton`     | `agents/agents.module.css:1001` |
| `.curveLabel`     | `agents/agents.module.css:1050` |
| `.tableMark`      | `agents/agents.module.css:1108` |
| `.tableStage`     | `agents/agents.module.css:1141` |
| `.tableCta`       | `agents/agents.module.css:1152` |
| `.ghostButton`    | `agents/agents.module.css:1282` |

**`apps/web/src/features/auth/auth.module.css`: 59**

| Class            | Line                        |
| ---------------- | --------------------------- |
| `.switchNote`    | `auth/auth.module.css:146`  |
| `.switchButton`  | `auth/auth.module.css:151`  |
| `.ghostButton`   | `auth/auth.module.css:152`  |
| `.good`          | `auth/auth.module.css:189`  |
| `.warn`          | `auth/auth.module.css:193`  |
| `.bad`           | `auth/auth.module.css:197`  |
| `.open`          | `auth/auth.module.css:202`  |
| `.eyebrow`       | `auth/auth.module.css:246`  |
| `.headline`      | `auth/auth.module.css:253`  |
| `.steps`         | `auth/auth.module.css:268`  |
| `.step`          | `auth/auth.module.css:277`  |
| `.stepActive`    | `auth/auth.module.css:293`  |
| `.methods`       | `auth/auth.module.css:299`  |
| `.method`        | `auth/auth.module.css:306`  |
| `.methodText`    | `auth/auth.module.css:323`  |
| `.check`         | `auth/auth.module.css:341`  |
| `.card`          | `auth/auth.module.css:345`  |
| `.strength`      | `auth/auth.module.css:356`  |
| `.strengthBar`   | `auth/auth.module.css:362`  |
| `.strengthFill`  | `auth/auth.module.css:370`  |
| `.strengthLabel` | `auth/auth.module.css:377`  |
| `.terms`         | `auth/auth.module.css:385`  |
| `.box`           | `auth/auth.module.css:399`  |
| `.termsText`     | `auth/auth.module.css:421`  |
| `.continue`      | `auth/auth.module.css:429`  |
| `.cardNote`      | `auth/auth.module.css:434`  |
| `.actions`       | `auth/auth.module.css:444`  |
| `.back`          | `auth/auth.module.css:454`  |
| `.signin`        | `auth/auth.module.css:639`  |
| `.signinGlow`    | `auth/auth.module.css:649`  |
| `.signinStars`   | `auth/auth.module.css:660`  |
| `.fallingPiece`  | `auth/auth.module.css:677`  |
| `.fall`          | `auth/auth.module.css:689`  |
| `.fallSpin`      | `auth/auth.module.css:693`  |
| `.signinColumn`  | `auth/auth.module.css:697`  |
| `.mascotTop`     | `auth/auth.module.css:707`  |
| `.glassCard`     | `auth/auth.module.css:717`  |
| `.cardTitle`     | `auth/auth.module.css:729`  |
| `.cardLead`      | `auth/auth.module.css:736`  |
| `.walletButton`  | `auth/auth.module.css:742`  |
| `.stack`         | `auth/auth.module.css:778`  |
| `.boardNow`      | `auth/auth.module.css:788`  |
| `.boardNowHead`  | `auth/auth.module.css:801`  |
| `.callRow`       | `auth/auth.module.css:816`  |
| `.callTicker`    | `auth/auth.module.css:822`  |
| `.callText`      | `auth/auth.module.css:829`  |
| `.callResult`    | `auth/auth.module.css:839`  |
| `.footerLinks`   | `auth/auth.module.css:845`  |
| `.done`          | `auth/auth.module.css:871`  |
| `.doneBox`       | `auth/auth.module.css:880`  |
| `.doneBadge`     | `auth/auth.module.css:886`  |
| `.icon`          | `auth/auth.module.css:900`  |
| `.doneTitle`     | `auth/auth.module.css:905`  |
| `.doneBody`      | `auth/auth.module.css:913`  |
| `.doneFoot`      | `auth/auth.module.css:920`  |
| `.notBuilt`      | `auth/auth.module.css:1341` |
| `.created`       | `auth/auth.module.css:1489` |
| `.addressButton` | `auth/auth.module.css:1501` |
| `.copyFailed`    | `auth/auth.module.css:1519` |

**`apps/web/src/features/landing/landing.module.css`: 1**

| Class      | Line                            |
| ---------- | ------------------------------- |
| `.display` | `landing/landing.module.css:42` |

**`apps/web/src/features/studio/home/home.module.css`: 2**

| Class          | Line                              |
| -------------- | --------------------------------- |
| `.briefName`   | `studio/home/home.module.css:394` |
| `.briefPrompt` | `studio/home/home.module.css:450` |

**`apps/web/src/features/studio/studio.module.css`: 2**

| Class           | Line                            |
| --------------- | ------------------------------- |
| `.accentRow`    | `studio/studio.module.css:1493` |
| `.accentSwatch` | `studio/studio.module.css:1498` |

Kept, and why (dynamic access, 12 sites in two modules):

| Classes                                                                                                      | Reached through                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.resultWon`, `.resultLost`, `.resultOpen` (`agents/agents.module.css:641-653`)                              | `styles[outcomeClass[...]]` at `agents/components/token-page.tsx:113`, `pick-detail.tsx:54`; map at `agents/lib/format.ts:63-67`                                                                                            |
| `.kindCALL`, `.kindPOSITION`, `.kindPASS`, `.kindANSWER`, `.kindPERP` (`agents/agents.module.css:1233-1253`) | ``styles[`kind${kindLabel[event.kind]}`]`` at `agents/components/activity-row.tsx:37`. `kindSETTLED` has no rule                                                                                                            |
| tone classes                                                                                                 | `styles[scoreTone()]`, `styles[calibrationTone()]`, `styles[cardTone[...]]` in `leaderboard-page.tsx:124-234`, `persona-page.tsx:99`, `:233`, `platform-numbers.tsx:52`. All are also named statically, so none was at risk |
| `.ticket.long`, `.ticket.short` (`markets/markets.module.css:791`, `:796`)                                   | `styles[quote.side]` at `markets/components/trade-ticket.tsx:51`, `:105`                                                                                                                                                    |

`:global(.pk-*)` names inside modules (`pk-button`, `pk-chip`, `pk-input`, `pk-input-inner`,
`pk-input-prefix`, `pk-field-note`) are references to the shared stylesheet, not module classes, and
are excluded.

Keyframes that go with the classes above or with the backdrop:

| Keyframes  | Defined at                   | Used by              | Fate                       |
| ---------- | ---------------------------- | -------------------- | -------------------------- |
| `stars`    | `apply/apply.module.css:868` | `.stars` (144)       | used only by rules that go |
| `grid`     | `auth/auth.module.css:939`   | `.floor` (92)        | used only by rules that go |
| `fallSpin` | `auth/auth.module.css:973`   | `.fallSpin` (694)    | used only by rules that go |
| `fall`     | `auth/auth.module.css:990`   | `.fall` (690)        | used only by rules that go |
| `stars`    | `auth/auth.module.css:1007`  | `.signinStars` (674) | used only by rules that go |
| `pop`      | `auth/auth.module.css:1045`  | `.doneBadge` (897)   | used only by rules that go |

Two custom properties are read and never set anywhere: `--dur` and `--delay`
(`auth/auth.module.css:690`, `:694`), in the dead `.fall` and `.fallSpin` rules.

### Method

For each module, every class in a selector (comments removed) against every `name.class` and
`name["class"]` in the files that import that module, under whatever name they import it
(`styles`, `shell`, `create`). `composes:` within the module counts as a use. Each unreferenced
name was then searched as a quoted string across `apps/web/src` and `apps/web/test`; the hits were
read, and only the two groups above reach a module through `styles[...]`.

<details>
<summary>deadcss.mjs</summary>

```js
// Classes defined in a CSS module that no importer names.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
const all = execSync("git ls-files apps/web/src", { encoding: "utf8" }).trim().split("\n");
const mods = all.filter((f) => f.endsWith(".module.css"));
const code = all.filter((f) => /\.tsx?$/.test(f));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const out = [];
for (const mod of mods) {
  const css = strip(readFileSync(mod, "utf8"));
  const defined = new Map();
  css.split("\n").forEach((line, i) => {
    // selector lines only: skip declarations (contain ':' followed by value and ';')
    if (/^\s*[\w-]+\s*:.*;\s*$/.test(line) || /^\s*--/.test(line)) return;
    if (/^\s*(from|to|\d+%)/.test(line)) return;
    for (const m of line.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (/\d/.test(line[m.index - 1] ?? "")) continue; // 0.5s
      if (!defined.has(m[1])) defined.set(m[1], i + 1);
    }
  });
  const used = new Set();
  const dynamic = [];
  for (const m of css.matchAll(/composes:\s*([^;]+?)(\s+from\s+[^;]+)?;/g))
    if (!m[2])
      m[1]
        .trim()
        .split(/\s+/)
        .forEach((c) => used.add(c));
  for (const f of code) {
    const src = readFileSync(f, "utf8");
    for (const im of src.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+\.module\.css)["']/g)) {
      const target = im[2].startsWith("@/")
        ? "apps/web/src/" + im[2].slice(2)
        : path.join(path.dirname(f), im[2]);
      if (path.normalize(target) !== mod) continue;
      const n = im[1];
      for (const u of src.matchAll(new RegExp(`\\b${n}\\.([A-Za-z_][\\w]*)`, "g"))) used.add(u[1]);
      for (const u of src.matchAll(new RegExp(`\\b${n}\\[\\s*["']([^"']+)["']\\s*\\]`, "g")))
        used.add(u[1]);
      src.split("\n").forEach((line, i) => {
        if (new RegExp(`\\b${n}\\[\\s*[^"'\\s]`).test(line)) dynamic.push(`${f}:${i + 1}`);
      });
    }
  }
  for (const [c, line] of defined) if (!used.has(c)) out.push({ mod, c, line, dynamic });
  console.error(
    mod,
    "defined",
    defined.size,
    "unreferenced",
    [...defined.keys()].filter((c) => !used.has(c)).length,
    "dynamic sites",
    dynamic.length,
  );
}
for (const o of out) console.log(`${o.mod}:${o.line}\t${o.c}`);
```

</details>

Caveats: a class applied by string concatenation outside `styles[...]` would be missed (none found).
A class that appears only as a descendant of a dead class is reported only if it is itself
unnamed in code. A rule whose selector mixes a live and a dead class is not split.

### 3.2 Unused exports: 124

| Group                         | Count | Of which types | Of which values |
| ----------------------------- | ----- | -------------- | --------------- |
| No reference outside its file | 78    | 59             | 19              |
| Referenced only by tests      | 46    | 15             | 31              |

Ten of the 124 are not used even in their own file, so the declaration is dead, not only the
`export` keyword: `VenueMarks`, `VenueChip` (`agents/components/agent-parts.tsx:72`, `:112`),
`agentsWithToken` (`agents/lib/empty.ts:14`), `stepsFor` (`auth/lib/flow.ts:143`), `SHAPE_ACCENT`
(`auth/lib/shapes.ts:33`), `Plugin` and `updateConfig` (`studio/api.ts:31`, `:177`), `forgetRail`
(`studio/lib/rail.ts:62`), `fromViemAccount` (`wallet/lib/signer-adapters.ts:76`), `ACCENT_ORDER`
(`lib/accent.ts:27`). For the other 114, removing `export` is the whole change unless the test that
imports it goes too (cleanup spec 3.3).

`packages/ui/src` was measured with the same program: 0 unused exports.

**No reference outside its own file (78)**

| Export                | Kind  | Defined at                                     | Used in its own file |
| --------------------- | ----- | ---------------------------------------------- | -------------------- |
| `Coverage`            | type  | `account/lib/coverage.ts:16`                   | yes                  |
| `CoverageCopy`        | type  | `account/lib/coverage.ts:25`                   | yes                  |
| `PreviewState`        | type  | `account/lib/preview.ts:26`                    | yes                  |
| `VenueMarks`          | value | `agents/components/agent-parts.tsx:72`         | no                   |
| `VenueChip`           | value | `agents/components/agent-parts.tsx:112`        | no                   |
| `deliveryLabel`       | value | `agents/components/read-parts.tsx:12`          | yes                  |
| `evaluationLabel`     | value | `agents/components/read-parts.tsx:18`          | yes                  |
| `UsePhonePhase`       | type  | `auth/components/steps/new-device-step.tsx:20` | yes                  |
| `AccountResult`       | type  | `auth/lib/account.ts:6`                        | yes                  |
| `OAuthProvider`       | type  | `auth/lib/account.ts:27`                       | yes                  |
| `CustodyApi`          | type  | `auth/lib/custody.ts:44`                       | yes                  |
| `Landing`             | type  | `auth/lib/custody.ts:184`                      | yes                  |
| `EnrolmentStore`      | type  | `auth/lib/custody.ts:211`                      | yes                  |
| `Mode`                | type  | `auth/lib/flow.ts:28`                          | yes                  |
| `HandleCheck`         | type  | `auth/lib/handle.ts:27`                        | yes                  |
| `HandleNote`          | type  | `auth/lib/handle.ts:37`                        | yes                  |
| `SHAPE_ACCENT`        | value | `auth/lib/shapes.ts:33`                        | no                   |
| `SheetInput`          | type  | `auth/lib/sheet.ts:37`                         | yes                  |
| `SheetCopy`           | type  | `auth/lib/sheet.ts:58`                         | yes                  |
| `SIGNUP_PREVIEWS`     | value | `auth/lib/signup-entry.ts:16`                  | yes                  |
| `liquidationPrice`    | value | `markets/lib/ticket.ts:33`                     | yes                  |
| `Quote`               | type  | `markets/lib/ticket.ts:38`                     | yes                  |
| `AgentRecord`         | type  | `studio/api.ts:27`                             | yes                  |
| `Plugin`              | type  | `studio/api.ts:31`                             | no                   |
| `CreateAgentInput`    | type  | `studio/api.ts:38`                             | yes                  |
| `updateConfig`        | value | `studio/api.ts:177`                            | no                   |
| `DepositPrepared`     | type  | `studio/api.ts:205`                            | yes                  |
| `UnsignedActivityDto` | type  | `studio/api.ts:258`                            | yes                  |
| `PrepareWalletResult` | type  | `studio/api.ts:288`                            | yes                  |
| `HandleAvailability`  | type  | `studio/api.ts:330`                            | yes                  |
| `StepperKey`          | type  | `studio/brief/model.ts:13`                     | yes                  |
| `TERMINAL`            | value | `studio/brief/model.ts:240`                    | yes                  |
| `CreateProblem`       | type  | `studio/brief/model.ts:315`                    | yes                  |
| `CreatePress`         | type  | `studio/brief/model.ts:352`                    | yes                  |
| `RunResult`           | type  | `studio/brief/result.ts:10`                    | yes                  |
| `policyReasonText`    | value | `studio/brief/result.ts:46`                    | yes                  |
| `AgentWallet`         | type  | `studio/create/ceremony.ts:45`                 | yes                  |
| `ExistingWallet`      | type  | `studio/create/ceremony.ts:51`                 | yes                  |
| `CeremonyResult`      | type  | `studio/create/ceremony.ts:89`                 | yes                  |
| `LINE_MAX`            | value | `studio/create/describe.tsx:7`                 | yes                  |
| `CustomSkill`         | type  | `studio/create/draft.ts:85`                    | yes                  |
| `SoonRow`             | type  | `studio/create/draft.ts:190`                   | yes                  |
| `CreateAgentBody`     | type  | `studio/create/draft.ts:387`                   | yes                  |
| `StepState`           | type  | `studio/create/first-run.tsx:18`               | yes                  |
| `Mode`                | type  | `studio/create/flow.ts:11`                     | yes                  |
| `FlowAction`          | type  | `studio/create/flow.ts:31`                     | yes                  |
| `StepParam`           | type  | `studio/create/flow.ts:147`                    | yes                  |
| `handleHint`          | value | `studio/create/name.tsx:11`                    | yes                  |
| `REVEAL_MS`           | value | `studio/create/reading.tsx:8`                  | yes                  |
| `blockedBy`           | value | `studio/create/review.tsx:27`                  | yes                  |
| `TraceTint`           | type  | `studio/create/trace.ts:10`                    | yes                  |
| `TraceLine`           | type  | `studio/create/trace.ts:12`                    | yes                  |
| `ReasonCode`          | type  | `studio/decision.ts:18`                        | yes                  |
| `ReportSection`       | type  | `studio/decision.ts:23`                        | yes                  |
| `MenuAccess`          | type  | `studio/home/access.ts:14`                     | yes                  |
| `HomeFixture`         | type  | `studio/home/fixture.ts:17`                    | yes                  |
| `HomePreview`         | type  | `studio/home/home.tsx:36`                      | yes                  |
| `BRIEF_STAGES`        | value | `studio/home/stage.ts:21`                      | yes                  |
| `Mood`                | type  | `studio/home/status.ts:25`                     | yes                  |
| `Tint`                | type  | `studio/home/status.ts:26`                     | yes                  |
| `StatusInput`         | type  | `studio/home/status.ts:39`                     | yes                  |
| `elapsed`             | value | `studio/home/status.ts:126`                    | yes                  |
| `ScheduleView`        | type  | `studio/home/status.ts:466`                    | yes                  |
| `Landing`             | type  | `studio/lib/landing.ts:10`                     | yes                  |
| `session`             | value | `studio/lib/passkey.ts:19`                     | yes                  |
| `PreviewState`        | type  | `studio/preview.ts:21`                         | yes                  |
| `ViemAccountLike`     | type  | `wallet/lib/signer-adapters.ts:66`             | yes                  |
| `WalletStatus`        | type  | `wallet/lib/wallet-context.tsx:49`             | yes                  |
| `SessionStatus`       | type  | `wallet/lib/wallet-context.tsx:60`             | yes                  |
| `SessionNamespace`    | type  | `wallet/lib/wallet-session.ts:12`              | yes                  |
| `ConnectedWallet`     | type  | `wallet/lib/wallet-session.ts:14`              | yes                  |
| `AdoptedSession`      | type  | `wallet/lib/wallet-session.ts:31`              | yes                  |
| `SessionDecision`     | type  | `wallet/lib/wallet-session.ts:38`              | yes                  |
| `ClientSession`       | type  | `wallet/lib/wallet-session.ts:131`             | yes                  |
| `SessionClient`       | type  | `wallet/lib/wallet-session.ts:150`             | yes                  |
| `SignInAttempt`       | type  | `wallet/lib/wallet-sign-in.ts:24`              | yes                  |
| `ACCENT_COLORS`       | value | `lib/accent.ts:17`                             | yes                  |
| `ACCENT_ORDER`        | value | `lib/accent.ts:27`                             | no                   |

**Referenced only by tests (46)**

| Export                 | Kind  | Defined at                         | Used in its own file | Tests that import it                               |
| ---------------------- | ----- | ---------------------------------- | -------------------- | -------------------------------------------------- |
| `previewAllowed`       | value | `account/lib/preview.ts:39`        | yes                  | `account-screen.test.ts`                           |
| `agentsWithToken`      | value | `agents/lib/empty.ts:14`           | no                   | `marketplace-empty.test.ts`                        |
| `AuthCalls`            | type  | `auth/lib/account.ts:18`           | yes                  | `account.test.ts`                                  |
| `AUTH_CALLBACK_PATH`   | value | `auth/lib/account.ts:24`           | yes                  | `account.test.ts`                                  |
| `shortenAddress`       | value | `auth/lib/address.ts:15`           | yes                  | `address.test.ts`                                  |
| `SIGNUP_RESUME`        | value | `auth/lib/callback.ts:32`          | yes                  | `callback.test.ts`                                 |
| `landing`              | value | `auth/lib/custody.ts:194`          | yes                  | `custody.test.ts`                                  |
| `Step`                 | type  | `auth/lib/flow.ts:24`              | yes                  | `flow.test.ts`                                     |
| `FlowState`            | type  | `auth/lib/flow.ts:30`              | yes                  | `flow.test.ts`                                     |
| `RailPhase`            | type  | `auth/lib/flow.ts:105`             | yes                  | `flow.test.ts`                                     |
| `stepsFor`             | value | `auth/lib/flow.ts:143`             | no                   | `flow.test.ts`                                     |
| `HANDLE_MIN`           | value | `auth/lib/handle.ts:10`            | yes                  | `handle.test.ts`                                   |
| `isHandleLongEnough`   | value | `auth/lib/handle.ts:24`            | yes                  | `handle.test.ts`                                   |
| `MAX_ATTEMPTS`         | value | `auth/lib/otp.ts:8`                | yes                  | `otp.test.ts`                                      |
| `CodeCell`             | type  | `auth/lib/otp.ts:27`               | yes                  | `otp.test.ts`                                      |
| `SessionStore`         | type  | `auth/lib/second-passkey.ts:28`    | yes                  | `second-passkey.test.ts`                           |
| `NOTHING_HAPPENED`     | value | `auth/lib/sheet.ts:21`             | yes                  | `sheet.test.ts`                                    |
| `CANCELLED_TITLE`      | value | `auth/lib/sheet.ts:24`             | yes                  | `sheet.test.ts`                                    |
| `BRIEF_LIMITS`         | value | `studio/brief/model.ts:73`         | yes                  | `studio-brief.test.ts`                             |
| `LEVERAGE_BOUNDS`      | value | `studio/brief/model.ts:82`         | yes                  | `studio-brief.test.ts`                             |
| `STARTER`              | value | `studio/brief/model.ts:86`         | yes                  | `studio-brief.test.ts`                             |
| `UnsignedActivity`     | type  | `studio/create/ceremony.ts:31`     | yes                  | `studio-ceremony.test.ts`                          |
| `SignedActivity`       | type  | `studio/create/ceremony.ts:39`     | yes                  | `studio-ceremony.test.ts`                          |
| `CeremonyDeps`         | type  | `studio/create/ceremony.ts:67`     | yes                  | `studio-ceremony.test.ts`                          |
| `SPORT_SUB_IDS`        | value | `studio/create/draft.ts:48`        | yes                  | `studio-create-draft.test.ts`                      |
| `STYLE_POLICIES`       | value | `studio/create/draft.ts:56`        | yes                  | `studio-create-draft.test.ts`                      |
| `readsText`            | value | `studio/create/draft.ts:229`       | yes                  | `studio-create-draft.test.ts`                      |
| `FlowState`            | type  | `studio/create/flow.ts:13`         | yes                  | `studio-create-flow.test.ts`                       |
| `sampleDraft`          | value | `studio/create/flow.ts:167`        | yes                  | `studio-create-flow.test.ts`                       |
| `NEEDS_AGENT`          | value | `studio/home/access.ts:10`         | yes                  | `studio-landing.test.ts`                           |
| `VIEW_ONLY`            | value | `studio/home/access.ts:12`         | yes                  | `studio-landing.test.ts`                           |
| `STAGES`               | value | `studio/home/stage.ts:16`          | yes                  | `studio-status.test.ts`                            |
| `StatusAgent`          | type  | `studio/home/status.ts:29`         | yes                  | `studio-status.test.ts`                            |
| `Timers`               | type  | `studio/lib/pending-save.ts:10`    | yes                  | `studio-pending-save.test.ts`                      |
| `forgetRail`           | value | `studio/lib/rail.ts:62`            | no                   | `studio.test.ts`                                   |
| `previewAllowed`       | value | `studio/preview.ts:219`            | yes                  | `studio.test.ts`                                   |
| `SECTIONS`             | value | `studio/sections/keys.ts:9`        | yes                  | `studio.test.ts`                                   |
| `PasskeyUnusableError` | value | `wallet/lib/signer-adapters.ts:27` | yes                  | `sign-in-words.test.ts`, `signer-adapters.test.ts` |
| `fromViemAccount`      | value | `wallet/lib/signer-adapters.ts:76` | no                   | `signer-adapters.test.ts`                          |
| `EXPIRY_MARGIN_MS`     | value | `wallet/lib/wallet-session.ts:45`  | yes                  | `wallet-session.test.ts`                           |
| `tokenExpiry`          | value | `wallet/lib/wallet-session.ts:52`  | yes                  | `wallet-session.test.ts`                           |
| `madeByWalletSignIn`   | value | `wallet/lib/wallet-session.ts:140` | yes                  | `wallet-session.test.ts`                           |
| `SignInClient`         | type  | `wallet/lib/wallet-sign-in.ts:15`  | yes                  | `wallet-sign-in.test.ts`                           |
| `Decision`             | type  | `middleware.ts:5`                  | yes                  | `middleware.test.ts`                               |
| `AuthState`            | type  | `middleware.ts:13`                 | yes                  | `middleware.test.ts`                               |
| `decide`               | value | `middleware.ts:41`                 | yes                  | `middleware.test.ts`                               |

### Method

A TypeScript program built from `apps/web/tsconfig.json` (which includes `src` and `test`) plus
`packages/ui/src`. Every identifier in every file is resolved to its symbol with the type checker,
following import aliases, and recorded against the file it appears in. An export is reported when
no file other than its own holds a reference in `src`; "test-only" when the only other files are
under `apps/web/test`. Next.js conventions in `app/` and `middleware.ts` are skipped (`default`,
`metadata`, `generateMetadata`, `viewport`, `dynamic`, `config`, `middleware`, the HTTP verbs).

<details>
<summary>exports.mjs (run from the repository root so `typescript` resolves)</summary>

```js
// Exports of apps/web/src (and packages/ui/src) with no reference outside their own file.
// Run from the repository root: node exports.mjs
import ts from "typescript";
import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const root = process.cwd();
const cfgPath = path.join(root, "apps/web/tsconfig.json");
const cfg = ts.getParsedCommandLineOfConfigFile(
  cfgPath,
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} },
);
const extra = execSync("git ls-files packages/ui/src", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => path.join(root, f));
const program = ts.createProgram([...cfg.fileNames, ...extra], cfg.options);
const checker = program.getTypeChecker();
const rel = (f) => path.relative(root, f);
const inScope = (f) => /^(apps\/web\/(src|test)|packages\/ui\/src)\//.test(rel(f));
const target = (s) => {
  let t = s;
  while (t && t.flags & ts.SymbolFlags.Alias) {
    const n = checker.getAliasedSymbol(t);
    if (!n || n === t) break;
    t = n;
  }
  return t;
};
const uses = new Map(); // symbol -> Set(file)
const add = (sym, file) => {
  if (!sym) return;
  const t = target(sym);
  if (!uses.has(t)) uses.set(t, new Set());
  uses.get(t).add(file);
};
for (const sf of program.getSourceFiles()) {
  const f = rel(sf.fileName);
  if (!inScope(sf.fileName)) continue;
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isDeclName =
        parent &&
        parent.name === node &&
        (ts.isFunctionDeclaration(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isClassDeclaration(parent) ||
          ts.isInterfaceDeclaration(parent) ||
          ts.isTypeAliasDeclaration(parent) ||
          ts.isEnumDeclaration(parent));
      if (!isDeclName) {
        let sym = checker.getSymbolAtLocation(node);
        if (sym && ts.isShorthandPropertyAssignment(parent))
          sym = checker.getShorthandAssignmentValueSymbol(parent);
        add(sym, f);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const NEXT = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "viewport",
  "dynamic",
  "revalidate",
  "runtime",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "generateStaticParams",
  "config",
  "middleware",
  "proxy",
  "fetchCache",
  "maxDuration",
]);
const rows = [];
for (const sf of program.getSourceFiles()) {
  const f = rel(sf.fileName);
  if (!/^(apps\/web\/src|packages\/ui\/src)\//.test(f)) continue;
  const mod = checker.getSymbolAtLocation(sf);
  if (!mod) continue;
  for (const ex of checker.getExportsOfModule(mod)) {
    const t = target(ex);
    const decl = (t.declarations ?? [])[0];
    if (!decl) continue;
    const declFile = rel(decl.getSourceFile().fileName);
    if (declFile !== f) continue; // re-export: counted at its definition
    const convention =
      (/^apps\/web\/src\/app\//.test(f) ||
        /^apps\/web\/src\/(middleware|proxy|instrumentation)\.ts$/.test(f)) &&
      NEXT.has(ex.name);
    if (convention) continue;
    const users = [...(uses.get(t) ?? [])];
    const others = users.filter((u) => u !== f);
    // a re-export line in another file is a use by identifier; separate barrels
    const prod = others.filter((u) => !u.startsWith("apps/web/test/"));
    const tests = others.filter((u) => u.startsWith("apps/web/test/"));
    const line = sf.getLineAndCharacterOfPosition(decl.getStart()).line + 1;
    const kind =
      t.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias) &&
      !(t.flags & ts.SymbolFlags.Value)
        ? "type"
        : "value";
    const local = users.includes(f);
    if (prod.length === 0)
      rows.push({
        f,
        line,
        name: ex.name,
        kind,
        where: tests.length ? "test-only" : "nowhere",
        local,
        tests,
      });
  }
}
// textual second opinion: scripts/ and other workspaces naming the export
const others = execSync("git ls-files scripts workers packages/infrastructure apps/agent-service", {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((f) => /\.(m?[tj]sx?|mts)$/.test(f));
const blob = others.map((f) => [f, readFileSync(f, "utf8")]);
for (const r of rows) {
  const base = path.basename(r.f).replace(/\.tsx?$/, "");
  r.outside = blob
    .filter(
      ([, s]) =>
        new RegExp(`\\b${r.name}\\b`).test(s) &&
        s.includes(base) &&
        /apps\/web|@pickler\/ui/.test(s),
    )
    .map(([f]) => f);
}
rows.sort((a, b) => a.f.localeCompare(b.f) || a.line - b.line);
for (const r of rows)
  console.log(
    [
      `${r.f}:${r.line}`,
      r.name,
      r.kind,
      r.where,
      r.local ? "used in own file" : "unused in own file",
      r.tests.join(" "),
      r.outside.join(" "),
    ].join("\t"),
  );
```

</details>

Caveats: a type used only through inference (never named at the use site) counts as unreferenced,
which is correct for the `export` keyword but says nothing about the declaration. Members reached
through a namespace import would be missed; `apps/web/src` has no `import * as` and no `export *`.
`scripts/design` imports nothing from `apps/web/src`; the two textual hits (`Coverage`, `session`)
are ordinary words in `routes.mjs` and `render.mjs`.

**Changed since the earlier inventory:** classes 75 to 96 (auth 55 to 59, agents 15 to 32, the
other three unchanged). Exports 95 to 124 (nowhere 61 to 78, test-only 34 to 46). The earlier method
is unknown, so part of the difference may be method and not code.

## 4. Token system

### 4.1 The source

`packages/ui/src/styles.css` (905 lines) is the only file that defines a `--pk-*` property:
111 distinct names, 39 on `:root` (`:14-130`), the surface-dependent set on
`[data-surface="light"], :root` (`:136-284`) and again on `[data-surface="dark"]` (`:289-383`).
`apps/web/src/app/layout.tsx:5` imports it once. `--pk-*:` assignments outside it: **0**, in CSS and
in TS.

It also defines three un-prefixed properties, `--tint-fg`, `--tint-bg` and `--tint-bd`
(`ui/styles.css:872-904`, seven tones), read 37 times in `studio/studio.module.css`. They are inside
the token file but outside the `--pk-` namespace, so the static check in the cleanup spec (3.4)
would not see them as tokens.

Defined and never read through `var()` in CSS: `--pk-orange`, `--pk-state-warm-bg`,
`--pk-state-warm-ink`, `--pk-state-win-bg`, `--pk-state-win-ink`, and the fourteen
`--pk-agent-<hue>-bg` and `-ink`. The agent pairs are read by name from TS
(`lib/accent.ts:67-70`, a template string), so they are live; the first five have no reader found.

### 4.2 Read but never defined: 1

| Token            | Reader                                         | Note                                                                                                                                            |
| ---------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pk-font-mono` | `wallet/components/claim-handle.module.css:17` | `var(--pk-font-mono, var(--pk-font))`, so it renders in `--pk-font`. `design-system-v2.md:214` removed the token. Replace with `var(--pk-font)` |

### 4.3 The alias layer: 107 definitions in 7 modules

| Kind                                                        | Count | Modules                                         |
| ----------------------------------------------------------- | ----- | ----------------------------------------------- |
| Plain alias on the module's root class (`--x: var(--pk-y)`) | 72    | agents 15, apply 14, auth 25, markets 18        |
| Variant-scoped variable, set per `data-*` value or modifier | 35    | landing 11, markets 9, create 7, auth 4, home 4 |

The 72 plain aliases use 33 distinct names and are read 667 times, each module reading only its
own definitions (no module reads an alias it does not define). Two are defined and never read:
`--magenta` (`agents/agents.module.css:14`) and `--amber` (`markets/markets.module.css:19`).

By name, across modules:

| Alias             | Maps to                | Modules defining it | Reads in total |
| ----------------- | ---------------------- | ------------------- | -------------- |
| `--label`         | `--pk-font`            | 4                   | 153            |
| `--body`          | `--pk-font`            | 4                   | 96             |
| `--faint`         | `--pk-ink-faint`       | 3                   | 69             |
| `--ink`           | `--pk-ink`             | 4                   | 51             |
| `--muted`         | `--pk-ink-muted`       | 4                   | 51             |
| `--lime-ink`      | `--pk-lime-ink`        | 4                   | 32             |
| `--rule`          | `--pk-rule`            | 3                   | 29             |
| `--ink-soft`      | `--pk-ink-soft`        | 4                   | 27             |
| `--display`       | `--pk-font-display`    | 4                   | 24             |
| `--cyan-ink`      | `--pk-cyan-ink`        | 4                   | 23             |
| `--lime`          | `--pk-lime`            | 4                   | 16             |
| `--ink-dim`       | `--pk-ink-dim`         | 2                   | 13             |
| `--line-strong`   | `--pk-rule-strong`     | 1                   | 11             |
| `--pink-ink`      | `--pk-pink-ink`        | 2                   | 10             |
| `--panel`         | `--pk-panel`           | 1                   | 10             |
| `--line`          | `--pk-rule`            | 1                   | 8              |
| `--placeholder`   | `--pk-ink-placeholder` | 2                   | 7              |
| `--cyan`          | `--pk-cyan`            | 2                   | 5              |
| `--amber-ink`     | `--pk-amber-ink`       | 2                   | 5              |
| `--border`        | `--pk-border`          | 1                   | 5              |
| `--violet-ink`    | `--pk-violet-ink`      | 1                   | 4              |
| `--magenta`       | `--pk-magenta`         | 3                   | 3              |
| `--field`         | `--pk-field`           | 1                   | 3              |
| `--bg`            | `--pk-bg`              | 1                   | 2              |
| `--on-lime`       | `--pk-on-lime`         | 1                   | 2              |
| `--border-strong` | `--pk-border-strong`   | 1                   | 1              |
| `--cyan-tint`     | `--pk-cyan-tint`       | 1                   | 1              |
| `--cyan-edge`     | `--pk-cyan-edge`       | 1                   | 1              |
| `--amber`         | `--pk-amber`           | 2                   | 1              |
| `--magenta-ink`   | `--pk-magenta-ink`     | 1                   | 1              |
| `--magenta-tint`  | `--pk-magenta-tint`    | 1                   | 1              |
| `--magenta-edge`  | `--pk-magenta-edge`    | 1                   | 1              |
| `--violet`        | `--pk-violet`          | 1                   | 1              |

Two names do not mean what they say: `--label` and `--body` both map to `--pk-font` (the comment at
`agents/agents.module.css:18-19` explains that `--label` was the monospace), and `--line` and
`--line-strong` in `auth` are `--pk-rule` and `--pk-rule-strong` under another name. `--ink` is a
plain alias in four modules and a variant variable holding a different token in `landing`
(`landing/landing.module.css:747-756`).

Every plain alias, with its definition:

| Alias             | Defined at                      | Maps to                | Reads in its module | Reads of the name, all modules |
| ----------------- | ------------------------------- | ---------------------- | ------------------- | ------------------------------ |
| `--ink`           | `agents/agents.module.css:4`    | `--pk-ink`             | 28                  | 52                             |
| `--ink-soft`      | `agents/agents.module.css:5`    | `--pk-ink-soft`        | 12                  | 27                             |
| `--ink-dim`       | `agents/agents.module.css:6`    | `--pk-ink-dim`         | 6                   | 13                             |
| `--muted`         | `agents/agents.module.css:7`    | `--pk-ink-muted`       | 6                   | 51                             |
| `--faint`         | `agents/agents.module.css:8`    | `--pk-ink-faint`       | 47                  | 69                             |
| `--cyan-ink`      | `agents/agents.module.css:9`    | `--pk-cyan-ink`        | 10                  | 23                             |
| `--lime`          | `agents/agents.module.css:10`   | `--pk-lime`            | 3                   | 16                             |
| `--lime-ink`      | `agents/agents.module.css:11`   | `--pk-lime-ink`        | 14                  | 32                             |
| `--cyan`          | `agents/agents.module.css:12`   | `--pk-cyan`            | 3                   | 5                              |
| `--pink-ink`      | `agents/agents.module.css:13`   | `--pk-pink-ink`        | 7                   | 10                             |
| `--magenta`       | `agents/agents.module.css:14`   | `--pk-magenta`         | 0                   | 3                              |
| `--rule`          | `agents/agents.module.css:15`   | `--pk-rule`            | 16                  | 29                             |
| `--display`       | `agents/agents.module.css:16`   | `--pk-font-display`    | 9                   | 24                             |
| `--body`          | `agents/agents.module.css:17`   | `--pk-font`            | 42                  | 96                             |
| `--label`         | `agents/agents.module.css:20`   | `--pk-font`            | 69                  | 153                            |
| `--ink`           | `apply/apply.module.css:4`      | `--pk-ink`             | 6                   | 52                             |
| `--ink-soft`      | `apply/apply.module.css:5`      | `--pk-ink-soft`        | 5                   | 27                             |
| `--muted`         | `apply/apply.module.css:6`      | `--pk-ink-muted`       | 10                  | 51                             |
| `--faint`         | `apply/apply.module.css:7`      | `--pk-ink-faint`       | 2                   | 69                             |
| `--placeholder`   | `apply/apply.module.css:8`      | `--pk-ink-placeholder` | 2                   | 7                              |
| `--cyan-ink`      | `apply/apply.module.css:9`      | `--pk-cyan-ink`        | 4                   | 23                             |
| `--rule`          | `apply/apply.module.css:10`     | `--pk-rule`            | 4                   | 29                             |
| `--lime`          | `apply/apply.module.css:11`     | `--pk-lime`            | 1                   | 16                             |
| `--lime-ink`      | `apply/apply.module.css:12`     | `--pk-lime-ink`        | 4                   | 32                             |
| `--cyan`          | `apply/apply.module.css:13`     | `--pk-cyan`            | 2                   | 5                              |
| `--magenta`       | `apply/apply.module.css:14`     | `--pk-magenta`         | 2                   | 3                              |
| `--display`       | `apply/apply.module.css:15`     | `--pk-font-display`    | 4                   | 24                             |
| `--body`          | `apply/apply.module.css:16`     | `--pk-font`            | 12                  | 96                             |
| `--label`         | `apply/apply.module.css:19`     | `--pk-font`            | 18                  | 153                            |
| `--bg`            | `auth/auth.module.css:4`        | `--pk-bg`              | 2                   | 2                              |
| `--panel`         | `auth/auth.module.css:5`        | `--pk-panel`           | 10                  | 10                             |
| `--field`         | `auth/auth.module.css:6`        | `--pk-field`           | 3                   | 3                              |
| `--ink`           | `auth/auth.module.css:7`        | `--pk-ink`             | 12                  | 52                             |
| `--ink-soft`      | `auth/auth.module.css:8`        | `--pk-ink-soft`        | 8                   | 27                             |
| `--muted`         | `auth/auth.module.css:9`        | `--pk-ink-muted`       | 30                  | 51                             |
| `--line`          | `auth/auth.module.css:10`       | `--pk-rule`            | 8                   | 8                              |
| `--line-strong`   | `auth/auth.module.css:11`       | `--pk-rule-strong`     | 11                  | 11                             |
| `--border-strong` | `auth/auth.module.css:15`       | `--pk-border-strong`   | 1                   | 1                              |
| `--lime`          | `auth/auth.module.css:16`       | `--pk-lime`            | 10                  | 16                             |
| `--lime-ink`      | `auth/auth.module.css:17`       | `--pk-lime-ink`        | 10                  | 32                             |
| `--on-lime`       | `auth/auth.module.css:18`       | `--pk-on-lime`         | 2                   | 2                              |
| `--cyan-ink`      | `auth/auth.module.css:19`       | `--pk-cyan-ink`        | 7                   | 23                             |
| `--cyan-tint`     | `auth/auth.module.css:20`       | `--pk-cyan-tint`       | 1                   | 1                              |
| `--cyan-edge`     | `auth/auth.module.css:21`       | `--pk-cyan-edge`       | 1                   | 1                              |
| `--amber`         | `auth/auth.module.css:22`       | `--pk-amber`           | 1                   | 1                              |
| `--amber-ink`     | `auth/auth.module.css:23`       | `--pk-amber-ink`       | 3                   | 5                              |
| `--magenta`       | `auth/auth.module.css:24`       | `--pk-magenta`         | 1                   | 3                              |
| `--magenta-ink`   | `auth/auth.module.css:25`       | `--pk-magenta-ink`     | 1                   | 1                              |
| `--magenta-tint`  | `auth/auth.module.css:26`       | `--pk-magenta-tint`    | 1                   | 1                              |
| `--magenta-edge`  | `auth/auth.module.css:27`       | `--pk-magenta-edge`    | 1                   | 1                              |
| `--violet`        | `auth/auth.module.css:28`       | `--pk-violet`          | 1                   | 1                              |
| `--display`       | `auth/auth.module.css:29`       | `--pk-font-display`    | 9                   | 24                             |
| `--body`          | `auth/auth.module.css:30`       | `--pk-font`            | 26                  | 96                             |
| `--label`         | `auth/auth.module.css:33`       | `--pk-font`            | 30                  | 153                            |
| `--ink`           | `markets/markets.module.css:8`  | `--pk-ink`             | 5                   | 52                             |
| `--ink-soft`      | `markets/markets.module.css:9`  | `--pk-ink-soft`        | 2                   | 27                             |
| `--ink-dim`       | `markets/markets.module.css:10` | `--pk-ink-dim`         | 7                   | 13                             |
| `--muted`         | `markets/markets.module.css:11` | `--pk-ink-muted`       | 5                   | 51                             |
| `--faint`         | `markets/markets.module.css:12` | `--pk-ink-faint`       | 20                  | 69                             |
| `--placeholder`   | `markets/markets.module.css:13` | `--pk-ink-placeholder` | 5                   | 7                              |
| `--lime`          | `markets/markets.module.css:14` | `--pk-lime`            | 2                   | 16                             |
| `--lime-ink`      | `markets/markets.module.css:15` | `--pk-lime-ink`        | 4                   | 32                             |
| `--cyan-ink`      | `markets/markets.module.css:16` | `--pk-cyan-ink`        | 2                   | 23                             |
| `--violet-ink`    | `markets/markets.module.css:17` | `--pk-violet-ink`      | 4                   | 4                              |
| `--pink-ink`      | `markets/markets.module.css:18` | `--pk-pink-ink`        | 3                   | 10                             |
| `--amber`         | `markets/markets.module.css:19` | `--pk-amber`           | 0                   | 1                              |
| `--amber-ink`     | `markets/markets.module.css:20` | `--pk-amber-ink`       | 2                   | 5                              |
| `--rule`          | `markets/markets.module.css:21` | `--pk-rule`            | 9                   | 29                             |
| `--border`        | `markets/markets.module.css:22` | `--pk-border`          | 5                   | 5                              |
| `--display`       | `markets/markets.module.css:23` | `--pk-font-display`    | 2                   | 24                             |
| `--body`          | `markets/markets.module.css:24` | `--pk-font`            | 16                  | 96                             |
| `--label`         | `markets/markets.module.css:27` | `--pk-font`            | 36                  | 153                            |

Variant-scoped variables. These are not aliases of one token: the value changes with a `data-*`
attribute, which is what the cleanup spec (3.2) allows only for non-colour values. Each needs a
decision: keep as a local variable, or write the property once per variant.

| Variable        | Defined at                            | Value                          | Reads in its module |
| --------------- | ------------------------------------- | ------------------------------ | ------------------- |
| `--accent`      | `auth/auth.module.css:1364`           | `var(--lime)`                  | 3                   |
| `--accent`      | `auth/auth.module.css:1378`           | `var(--violet)`                | 3                   |
| `--accent`      | `auth/auth.module.css:1382`           | `var(--amber)`                 | 3                   |
| `--accent`      | `auth/auth.module.css:1541`           | `var(--muted)`                 | 3                   |
| `--hue`         | `landing/landing.module.css:75`       | `var(--pk-agent-lime-fill)`    | 1                   |
| `--hue`         | `landing/landing.module.css:78`       | `var(--pk-agent-indigo-fill)`  | 1                   |
| `--hue`         | `landing/landing.module.css:81`       | `var(--pk-agent-amber-fill)`   | 1                   |
| `--hue`         | `landing/landing.module.css:84`       | `var(--pk-agent-orange-fill)`  | 1                   |
| `--hue`         | `landing/landing.module.css:87`       | `var(--pk-agent-magenta-fill)` | 1                   |
| `--hue`         | `landing/landing.module.css:90`       | `var(--pk-agent-blue-fill)`    | 1                   |
| `--hue`         | `landing/landing.module.css:93`       | `var(--pk-agent-violet-fill)`  | 1                   |
| `--ink`         | `landing/landing.module.css:747`      | `var(--pk-lime-ink)`           | 1                   |
| `--ink`         | `landing/landing.module.css:750`      | `var(--pk-violet-ink)`         | 1                   |
| `--ink`         | `landing/landing.module.css:753`      | `var(--pk-amber-ink)`          | 1                   |
| `--ink`         | `landing/landing.module.css:756`      | `var(--pk-magenta-ink)`        | 1                   |
| `--accent-ink`  | `markets/markets.module.css:432`      | `var(--lime-ink)`              | 5                   |
| `--accent-on`   | `markets/markets.module.css:433`      | `var(--pk-lime-edge)`          | 2                   |
| `--accent-soft` | `markets/markets.module.css:434`      | `var(--pk-state-good-bg)`      | 1                   |
| `--accent-ink`  | `markets/markets.module.css:440`      | `var(--pink-ink)`              | 5                   |
| `--accent-on`   | `markets/markets.module.css:441`      | `var(--pk-magenta-edge)`       | 2                   |
| `--accent-soft` | `markets/markets.module.css:442`      | `var(--pk-state-loss-bg)`      | 1                   |
| `--accent-ink`  | `markets/markets.module.css:446`      | `var(--violet-ink)`            | 5                   |
| `--accent-on`   | `markets/markets.module.css:447`      | `var(--pk-violet-edge)`        | 2                   |
| `--accent-soft` | `markets/markets.module.css:448`      | `var(--pk-state-info-bg)`      | 1                   |
| `--dot`         | `studio/create/create.module.css:348` | `var(--pk-agent-lime-fill)`    | 4                   |
| `--dot`         | `studio/create/create.module.css:354` | `var(--pk-agent-violet-fill)`  | 4                   |
| `--dot`         | `studio/create/create.module.css:360` | `var(--pk-agent-amber-fill)`   | 4                   |
| `--dot`         | `studio/create/create.module.css:366` | `var(--pk-agent-blue-fill)`    | 4                   |
| `--dot`         | `studio/create/create.module.css:372` | `var(--pk-agent-orange-fill)`  | 4                   |
| `--dot`         | `studio/create/create.module.css:378` | `var(--pk-agent-magenta-fill)` | 4                   |
| `--dot`         | `studio/create/create.module.css:384` | `var(--pk-ink)`                | 4                   |
| `--mood`        | `studio/home/home.module.css:1046`    | `var(--pk-violet-ink)`         | 2                   |
| `--mood`        | `studio/home/home.module.css:1049`    | `var(--pk-lime-ink)`           | 2                   |
| `--mood`        | `studio/home/home.module.css:1052`    | `var(--pk-ink-muted)`          | 2                   |
| `--mood`        | `studio/home/home.module.css:1055`    | `var(--pk-magenta-ink)`        | 2                   |

Set from TS rather than CSS:

| Variable                                                  | Set at                               | Read (CSS)                                                                                                        |
| --------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `--accent`, `--accent-rgb`, `--accent-bg`, `--accent-ink` | `lib/accent.ts:67-70` (`accentVars`) | `--accent` 11, `--accent-rgb` 4, `--accent-bg` 2, `--accent-ink` 7, in agents, apply, auth, markets, studio, home |
| `--accent`, `--accent-rgb`                                | `lib/accent.ts:76` (`colorVars`)     | as above; callers at `apply/components/application-form.tsx:169`, `:485`, `:514`, `:591`, `submitted.tsx:122`     |
| `--i`                                                     | `landing/components/backed.tsx:39`   | `landing/landing.module.css`, 1 read (an index, not a colour)                                                     |

### 4.4 Carried-forward tokens: 21, used 270 times

Defined twice each, in the "Carried forward" blocks at `ui/styles.css:256-283` (light) and
`:361-382` (dark). "Replace with" is the token the definition itself resolves to. Where the
definition holds a literal there is no v2 token, and `design-system-v2.md:486` says the `-edge`
definitions belong in `styles.css`. Line numbers after each file are the reads.

| Token                  | Defined (`ui/styles.css`) | Uses | Replace with                                                                                   | Readers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------- | ---- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pk-ink-dim`         | 260, 362                  | 10   | `--pk-ink-muted` on light, `--pk-ink-soft` on dark: two tokens, chosen by the reader's surface | `agents/agents.module.css`: 6<br>`markets/markets.module.css`: 10<br>`wallet/components/activity-page.module.css`: 69<br>`wallet/components/connect-gate.module.css`: 38<br>`wallet/components/connect-modal.module.css`: 50, 86<br>`ui/styles.css`: 461, 591, 625, 675                                                                                                                                                                                                                                                                         |
| `--pk-ink-placeholder` | 261, 363                  | 6    | `--pk-ink-faint`                                                                               | `apply/apply.module.css`: 8<br>`markets/markets.module.css`: 13<br>`studio/create/create.module.css`: 216<br>`studio/studio.module.css`: 539, 948<br>`ui/styles.css`: 752                                                                                                                                                                                                                                                                                                                                                                       |
| `--pk-surface`         | 262, 364                  | 9    | `--pk-panel`                                                                                   | `studio/studio.module.css`: 153, 334, 594, 679, 735<br>`wallet/components/connect-modal.module.css`: 107<br>`ui/styles.css`: 456, 474, 850                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--pk-surface-strong`  | 263, 365                  | 9    | `--pk-panel-2`                                                                                 | `markets/markets.module.css`: 602<br>`studio/studio.module.css`: 148, 289, 738, 839, 914<br>`wallet/components/connect-modal.module.css`: 118<br>`ui/styles.css`: 693, 855                                                                                                                                                                                                                                                                                                                                                                      |
| `--pk-field`           | 264, 366                  | 19   | `--pk-panel`                                                                                   | `agents/agents.module.css`: 185, 1023, 1584, 1619, 1655, 1750, 2242<br>`auth/auth.module.css`: 6<br>`markets/markets.module.css`: 960<br>`studio/studio.module.css`: 74, 211, 571, 670, 1277, 1518, 1707<br>`ui/styles.css`: 635, 666, 744                                                                                                                                                                                                                                                                                                      |
| `--pk-field-autofill`  | 265, 367                  | 2    | `--pk-panel`                                                                                   | `ui/styles.css`: 825, 831                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--pk-border`          | 266, 368                  | 42   | `--pk-rule-strong`                                                                             | `markets/markets.module.css`: 22<br>`studio/home/home.module.css`: 141, 176, 199, 942, 952, 964, 1029, 1042, 1043, 1205, 1228<br>`studio/studio.module.css`: 46, 75, 212, 345, 457, 466, 572, 595, 662, 703, 959, 1117, 1296, 1305<br>`wallet/components/activity-page.module.css`: 61<br>`wallet/components/claim-handle.module.css`: 10<br>`wallet/components/connect-gate.module.css`: 10<br>`wallet/components/connect-modal.module.css`: 23, 47, 105, 132<br>`ui/chart.tsx`: 47<br>`ui/styles.css`: 475, 588, 621, 633, 742, 848, 874, 904 |
| `--pk-border-strong`   | 268, 369                  | 27   | no equivalent (own value: ink at 0.28 light, white at 0.32 dark)                               | `agents/agents.module.css`: 247, 1226, 1484, 2053<br>`auth/auth.module.css`: 15<br>`markets/markets.module.css`: 170, 544, 545, 892<br>`studio/create/create.module.css`: 458, 593<br>`studio/home/home.module.css`: 149, 271, 1235, 1442<br>`studio/studio.module.css`: 52, 84, 120, 353, 579, 669, 811, 1285<br>`wallet/components/connect-modal.module.css`: 117<br>`ui/styles.css`: 451, 480, 602                                                                                                                                           |
| `--pk-cyan`            | 271, 370                  | 3    | `--pk-blue`                                                                                    | `agents/agents.module.css`: 12<br>`apply/apply.module.css`: 13<br>`markets/markets.module.css`: 1107                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--pk-cyan-ink`        | 272, 371                  | 9    | `--pk-state-cool-ink`                                                                          | `app/globals.css`: 46<br>`account/account.module.css`: 348<br>`agents/agents.module.css`: 9<br>`apply/apply.module.css`: 9<br>`auth/auth.module.css`: 19<br>`markets/markets.module.css`: 16<br>`wallet/components/activity-page.module.css`: 15<br>`wallet/components/connect-modal.module.css`: 134<br>`scripts/design/levels.test.mjs`: 47                                                                                                                                                                                                   |
| `--pk-pink-ink`        | 273, 372                  | 9    | `--pk-magenta-ink`                                                                             | `agents/agents.module.css`: 13<br>`auth/auth.module.css`: 1278<br>`markets/markets.module.css`: 18<br>`studio/studio.module.css`: 512, 895, 998, 1048<br>`wallet/components/connect-modal.module.css`: 185<br>`scripts/design/levels.test.mjs`: 48                                                                                                                                                                                                                                                                                              |
| `--pk-lime-tint`       | 274, 373                  | 9    | `--pk-state-good-bg`                                                                           | `markets/markets.module.css`: 395<br>`studio/home/home.module.css`: 95, 631, 1320<br>`studio/studio.module.css`: 356, 600, 1098, 1529<br>`wallet/components/connect-modal.module.css`: 153                                                                                                                                                                                                                                                                                                                                                      |
| `--pk-lime-edge`       | 275, 374                  | 28   | no equivalent (good ink at 0.28 light, 0.4 dark)                                               | `agents/agents.module.css`: 341, 643, 1046, 1171, 1235, 1378, 2041, 2070, 2387<br>`markets/markets.module.css`: 394, 433, 792<br>`studio/create/create.module.css`: 409, 480<br>`studio/home/home.module.css`: 603, 1117, 1208, 1321<br>`studio/studio.module.css`: 357, 601, 611, 941, 973, 1099, 1530<br>`wallet/components/connect-modal.module.css`: 151<br>`ui/styles.css`: 609, 879                                                                                                                                                       |
| `--pk-magenta-tint`    | 276, 375                  | 4    | `--pk-state-loss-bg`                                                                           | `auth/auth.module.css`: 26, 1263<br>`studio/studio.module.css`: 508, 892                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--pk-magenta-edge`    | 277, 376                  | 14   | no equivalent (loss ink at 0.28 / 0.4)                                                         | `agents/agents.module.css`: 649, 1255, 2058, 2076, 2396<br>`auth/auth.module.css`: 27, 1264<br>`markets/markets.module.css`: 441, 797<br>`studio/create/create.module.css`: 569<br>`studio/studio.module.css`: 509, 893, 1397<br>`ui/styles.css`: 884                                                                                                                                                                                                                                                                                           |
| `--pk-amber-tint`      | 278, 377                  | 4    | `--pk-state-caution-bg`                                                                        | `auth/auth.module.css`: 1524<br>`auth/components/second-passkey.module.css`: 12<br>`markets/markets.module.css`: 750, 808                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--pk-amber-edge`      | 279, 378                  | 13   | no equivalent (caution ink at 0.28 / 0.4)                                                      | `agents/agents.module.css`: 331, 1245, 2082, 2405<br>`auth/auth.module.css`: 1522<br>`auth/components/second-passkey.module.css`: 10<br>`markets/markets.module.css`: 748, 807<br>`studio/create/create.module.css`: 412, 609<br>`studio/home/home.module.css`: 628<br>`studio/studio.module.css`: 1726<br>`ui/styles.css`: 889                                                                                                                                                                                                                 |
| `--pk-cyan-tint`       | 280, 379                  | 3    | `--pk-state-cool-bg`                                                                           | `auth/auth.module.css`: 20<br>`markets/markets.module.css`: 301<br>`wallet/components/connect-modal.module.css`: 67                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--pk-cyan-edge`       | 281, 380                  | 10   | no equivalent (cool ink at 0.28 / 0.4)                                                         | `agents/agents.module.css`: 422, 655, 1040, 1240, 2048, 2064<br>`auth/auth.module.css`: 21<br>`markets/markets.module.css`: 300<br>`wallet/components/connect-modal.module.css`: 65<br>`ui/styles.css`: 894                                                                                                                                                                                                                                                                                                                                     |
| `--pk-violet-tint`     | 282, 381                  | 11   | `--pk-state-info-bg`                                                                           | `markets/markets.module.css`: 295, 389<br>`studio/home/home.module.css`: 91, 1346, 1404<br>`studio/studio.module.css`: 921, 970, 1153, 1163, 1460<br>`wallet/components/connect-gate.module.css`: 23                                                                                                                                                                                                                                                                                                                                            |
| `--pk-violet-edge`     | 283, 382                  | 29   | no equivalent (info ink at 0.28 / 0.4)                                                         | `agents/agents.module.css`: 1250, 1832, 2091, 2113, 2200, 2213, 2472, 2556, 2569, 2587, 2640<br>`markets/markets.module.css`: 294, 388, 447, 802<br>`studio/home/home.module.css`: 1280, 1347<br>`studio/studio.module.css`: 815, 845, 922, 931, 966, 980, 1154, 1164, 1187, 1461<br>`wallet/components/connect-gate.module.css`: 21<br>`ui/styles.css`: 899                                                                                                                                                                                    |

Notes for the implementer:

- `--pk-ink-dim` resolves to a different token per surface, so a reader on a page that inverts
  (a dark panel in a light page) must be checked before it is replaced by one name.
- `--pk-border` is also read from TS: `ui/chart.tsx:47`.
- `scripts/design/levels.test.mjs:47-48` names `--pk-cyan-ink` and `--pk-pink-ink`; the test moves
  with them.
- 7 of the 21 have no single v2 equivalent (`--pk-border-strong` and the five `-edge` tokens hold
  literals; `--pk-ink-dim` maps to two). They are used 131 times between them. Under D5 they stay.

### 4.5 Colour literals in CSS: 102

97 in five CSS modules and 5 in rules of `styles.css` (token definitions are not counted). No named
colour (`white`, `black`, …) is used as a value anywhere. No `hsl()`.

| File                                         | Literals | Backdrop | In a dead class | Live   |
| -------------------------------------------- | -------- | -------- | --------------- | ------ |
| `apply/apply.module.css`                     | 49       | 6        | 0               | 43     |
| `auth/auth.module.css`                       | 43       | 8        | 18              | 17     |
| `agents/agents.module.css`                   | 2        | 1        | 0               | 1      |
| `markets/markets.module.css`                 | 2        | 0        | 0               | 2      |
| `wallet/components/connect-modal.module.css` | 1        | 0        | 0               | 1      |
| `ui/styles.css` (rules, not tokens)          | 5        | 0        | 0               | 5      |
| **Total**                                    | **102**  | **15**   | **18**          | **69** |

So 33 literals disappear with sections 1 and 3, and 69 need a token. Of the live ones, the base
colours that are in no v2 token at all are the old public ink `#F5F6FF`, the old cyan `#5AD8FF`, the
old console bone ink `#F3F1EC` and three old console grounds; those cannot be "moved to their
token" and need a drawing decision (the nearest v2 roles are `--pk-rule`, `--pk-rule-strong`,
`--pk-panel` and `--pk-border-strong`).

| Where                                           | Selector                                            | Property             | Literal                               | Base colour                                 | Becomes                                                                            | Fate of the rule                 |
| ----------------------------------------------- | --------------------------------------------------- | -------------------- | ------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| `agents/agents.module.css:71`                   | `.stars`                                            | `background-image`   | `rgba(255, 255, 255, 0.7)`            | white (`--pk-ink` on dark)                  | new token: white at 0.7                                                            | backdrop (goes with section 1)   |
| `agents/agents.module.css:91`                   | `.glass`                                            | `box-shadow`         | `rgba(255, 255, 255, 0.22)`           | white (`--pk-ink` on dark)                  | new token: white at 0.22                                                           | live                             |
| `apply/apply.module.css:62`                     | `.pixel`                                            | `box-shadow`         | `rgba(var(--accent-rgb), 0.6)`        | `--accent-rgb`                              | stays computed from the pinned JS palette, or a new glow token (alpha 0.6)         | live                             |
| `apply/apply.module.css:82`                     | `.glass`                                            | `background`         | `rgba(245, 246, 255, 0.06)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:84`                     | `.glass`                                            | `border`             | `rgba(245, 246, 255, 0.22)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:85`                     | `.glass`                                            | `box-shadow`         | `rgba(255, 255, 255, 0.26)`           | white (`--pk-ink` on dark)                  | new token: white at 0.26                                                           | live                             |
| `apply/apply.module.css:98`                     | `.primaryButton:disabled`                           | `background`         | `rgba(245, 246, 255, 0.08)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:100`                    | `.primaryButton:disabled`                           | `border-color`       | `rgba(245, 246, 255, 0.2)`            | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:108`                    | `.page .secondaryButton`                            | `border-color`       | `rgba(245, 246, 255, 0.3)`            | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:136`                    | `.stars`                                            | `(continued value)`  | `rgba(255, 255, 255, 0.8)`            | white (`--pk-ink` on dark)                  | new token: white at 0.8                                                            | backdrop (goes with section 1)   |
| `apply/apply.module.css:137`                    | `.stars`                                            | `(continued value)`  | `rgba(255, 255, 255, 0.5)`            | exact token value                           | `--pk-glow-rim`                                                                    | backdrop (goes with section 1)   |
| `apply/apply.module.css:155`                    | `.floorGrid`                                        | `(continued value)`  | `rgba(90, 216, 255, 0.4)`             | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | backdrop (goes with section 1)   |
| `apply/apply.module.css:156`                    | `.floorGrid`                                        | `(continued value)`  | `rgba(155, 123, 255, 0.35)`           | `--pk-agent-violet-fill`                    | new token: `--pk-agent-violet-fill` at 0.35                                        | backdrop (goes with section 1)   |
| `apply/apply.module.css:160`                    | `.floorGrid`                                        | `-webkit-mask-image` | `#000`                                | mask stop, not a painted colour             | goes with the floor grid                                                           | backdrop (goes with section 1)   |
| `apply/apply.module.css:161`                    | `.floorGrid`                                        | `mask-image`         | `#000`                                | mask stop, not a painted colour             | goes with the floor grid                                                           | backdrop (goes with section 1)   |
| `apply/apply.module.css:194`                    | `.brandLogo`                                        | `filter`             | `rgba(90, 216, 255, 0.55)`            | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:286`                    | `.inviteBar`                                        | `background`         | `rgba(90, 216, 255, 0.1)`             | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:287`                    | `.inviteBar`                                        | `border`             | `rgba(90, 216, 255, 0.4)`             | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:312`                    | `.card`                                             | `background`         | `rgba(245, 246, 255, 0.06)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:314`                    | `.card`                                             | `box-shadow`         | `rgba(255, 255, 255, 0.25)`           | white (`--pk-ink` on dark)                  | new token: white at 0.25                                                           | live                             |
| `apply/apply.module.css:319`                    | `.cardDone`                                         | `border-color`       | `rgba(200, 240, 58, 0.45)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.45                                                     | live                             |
| `apply/apply.module.css:324`                    | `.cardError`                                        | `border-color`       | `rgba(255, 95, 162, 0.6)`             | `--pk-magenta`                              | new token: `--pk-magenta` at 0.6                                                   | live                             |
| `apply/apply.module.css:354`                    | `.tickerInput`                                      | `border-color`       | `rgba(200, 240, 58, 0.45)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.45                                                     | live                             |
| `apply/apply.module.css:406`                    | `.chip`                                             | `border`             | `rgba(245, 246, 255, 0.24)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:414`                    | `.chip:hover`                                       | `border-color`       | `rgba(245, 246, 255, 0.6)`            | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:421`                    | `.chip .pixel`                                      | `border-color`       | `rgba(255, 255, 255, 0.35)`           | white (`--pk-ink` on dark)                  | new token: white at 0.35                                                           | live                             |
| `apply/apply.module.css:428`                    | `.chip[aria-checked="true"]`                        | `background`         | `rgba(245, 246, 255, 0.14)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:436`                    | `.chip[aria-checked="true"] .pixel`                 | `box-shadow`         | `rgba(var(--accent-rgb), 0.6)`        | `--accent-rgb`                              | stays computed from the pinned JS palette, or a new glow token (alpha 0.6)         | live                             |
| `apply/apply.module.css:470`                    | `.piece`                                            | `background`         | `rgba(245, 246, 255, 0.05)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:472`                    | `.piece`                                            | `border`             | `rgba(245, 246, 255, 0.22)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:474`                    | `.piece`                                            | `(continued value)`  | `rgba(255, 255, 255, 0.26)`           | white (`--pk-ink` on dark)                  | new token: white at 0.26                                                           | live                             |
| `apply/apply.module.css:484`                    | `.pieceHead`                                        | `border-bottom`      | `rgba(245, 246, 255, 0.18)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:503`                    | `.well`                                             | `border`             | `rgba(245, 246, 255, 0.2)`            | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:506`                    | `.well`                                             | `(continued value)`  | `rgba(245, 246, 255, 0.07)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:507`                    | `.well`                                             | `(continued value)`  | `rgba(245, 246, 255, 0.07)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:529`                    | `.blockCells .pixel`                                | `(continued value)`  | `rgba(255, 255, 255, 0.45)`           | white (`--pk-ink` on dark)                  | new token: white at 0.45                                                           | live                             |
| `apply/apply.module.css:530`                    | `.blockCells .pixel`                                | `(continued value)`  | `rgba(var(--accent-rgb), 0.6)`        | `--accent-rgb`                              | stays computed from the pinned JS palette, or a new glow token (alpha 0.6)         | live                             |
| `apply/apply.module.css:576`                    | `.sentHero`                                         | `background`         | `rgba(155, 123, 255, 0.14)`           | `--pk-agent-violet-fill`                    | new token: `--pk-agent-violet-fill` at 0.14                                        | live                             |
| `apply/apply.module.css:578`                    | `.sentHero`                                         | `border`             | `rgba(245, 246, 255, 0.3)`            | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:580`                    | `.sentHero`                                         | `(continued value)`  | `rgba(255, 255, 255, 0.35)`           | white (`--pk-ink` on dark)                  | new token: white at 0.35                                                           | live                             |
| `apply/apply.module.css:581`                    | `.sentHero`                                         | `(continued value)`  | `rgba(155, 123, 255, 0.28)`           | `--pk-agent-violet-fill`                    | new token: `--pk-agent-violet-fill` at 0.28                                        | live                             |
| `apply/apply.module.css:599`                    | `.liveDot`                                          | `box-shadow`         | `rgba(200, 240, 58, 0.9)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.9                                                      | live                             |
| `apply/apply.module.css:631`                    | `.tile`                                             | `border`             | `rgba(245, 246, 255, 0.24)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:648`                    | `.tileLime`                                         | `background`         | `rgba(200, 240, 58, 0.12)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.12                                                     | live                             |
| `apply/apply.module.css:649`                    | `.tileLime`                                         | `border-color`       | `rgba(200, 240, 58, 0.4)`             | exact token value                           | `--pk-lime-edge` (its dark value)                                                  | live                             |
| `apply/apply.module.css:654`                    | `.tileCyan`                                         | `background`         | `rgba(90, 216, 255, 0.12)`            | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:655`                    | `.tileCyan`                                         | `border-color`       | `rgba(90, 216, 255, 0.4)`             | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:685`                    | `.heldRow`                                          | `border-bottom`      | `rgba(245, 246, 255, 0.14)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `apply/apply.module.css:755`                    | `.shareButton`                                      | `(continued value)`  | `rgba(255, 255, 255, 0.4)`            | white (`--pk-ink` on dark)                  | new token: white at 0.4                                                            | live                             |
| `apply/apply.module.css:756`                    | `.shareButton`                                      | `(continued value)`  | `rgba(200, 240, 58, 0.45)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.45                                                     | live                             |
| `apply/apply.module.css:769`                    | `.post`                                             | `border`             | `rgba(245, 246, 255, 0.24)`           | old public ink `#F5F6FF`, in no token       | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `auth/auth.module.css:85`                       | `.floor`                                            | `(continued value)`  | `rgba(90, 216, 255, 0.3)`             | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | backdrop (goes with section 1)   |
| `auth/auth.module.css:86`                       | `.floor`                                            | `(continued value)`  | `rgba(155, 123, 255, 0.26)`           | `--pk-agent-violet-fill`                    | new token: `--pk-agent-violet-fill` at 0.26                                        | backdrop (goes with section 1)   |
| `auth/auth.module.css:90`                       | `.floor`                                            | `-webkit-mask-image` | `#000`                                | mask stop, not a painted colour             | goes with the floor grid                                                           | backdrop (goes with section 1)   |
| `auth/auth.module.css:91`                       | `.floor`                                            | `mask-image`         | `#000`                                | mask stop, not a painted colour             | goes with the floor grid                                                           | backdrop (goes with section 1)   |
| `auth/auth.module.css:122`                      | `.brandLogo`                                        | `filter`             | `rgba(90, 216, 255, 0.55)`            | old cyan `#5AD8FF`, in no token             | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `auth/auth.module.css:159`                      | `.page a.switchButton:hover, .ghostButton:hover`    | `border-color`       | `rgba(243, 241, 236, 0.36)`           | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:170`                      | `.primary`                                          | `(continued value)`  | `rgba(255, 255, 255, 0.4)`            | white (`--pk-ink` on dark)                  | new token: white at 0.4                                                            | live                             |
| `auth/auth.module.css:171`                      | `.primary`                                          | `(continued value)`  | `rgba(200, 240, 58, 0.38)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.38                                                     | live                             |
| `auth/auth.module.css:294`                      | `.stepActive`                                       | `border-color`       | `rgba(200, 240, 58, 0.34)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.34                                                     | dead class (goes with section 3) |
| `auth/auth.module.css:295`                      | `.stepActive`                                       | `background`         | `rgba(200, 240, 58, 0.1)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.1                                                      | dead class (goes with section 3) |
| `auth/auth.module.css:314`                      | `.method:hover`                                     | `border-color`       | `rgba(243, 241, 236, 0.34)`           | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:318`                      | `.method[aria-checked="true"]`                      | `border-color`       | `rgba(243, 241, 236, 0.3)`            | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:367`                      | `.strengthBar`                                      | `background`         | `rgba(243, 241, 236, 0.08)`           | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:406`                      | `.box`                                              | `border`             | `rgba(243, 241, 236, 0.26)`           | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:437`                      | `.cardNote`                                         | `border-top`         | `rgba(243, 241, 236, 0.1)`            | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:482`                      | `.mascotSmall`                                      | `filter`             | `rgba(200, 240, 58, 0.35)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.35                                                     | live                             |
| `auth/auth.module.css:501`                      | `.liveDot`                                          | `box-shadow`         | `rgba(200, 240, 58, 0.8)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.8                                                      | live                             |
| `auth/auth.module.css:511`                      | `.bigNumber`                                        | `text-shadow`        | `rgba(200, 240, 58, 0.45)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.45                                                     | live                             |
| `auth/auth.module.css:555`                      | `.well`                                             | `(continued value)`  | `rgba(243, 241, 236, 0.06)`           | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `auth/auth.module.css:556`                      | `.well`                                             | `(continued value)`  | `rgba(243, 241, 236, 0.06)`           | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `auth/auth.module.css:566`                      | `.wellClear`                                        | `background`         | `rgba(200, 240, 58, 0.2)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.2                                                      | live                             |
| `auth/auth.module.css:570`                      | `.wellClear`                                        | `text-shadow`        | `rgba(200, 240, 58, 0.9)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.9                                                      | live                             |
| `auth/auth.module.css:604`                      | `.cellOn`                                           | `(continued value)`  | `rgba(255, 255, 255, 0.4)`            | white (`--pk-ink` on dark)                  | new token: white at 0.4                                                            | live                             |
| `auth/auth.module.css:605`                      | `.cellOn`                                           | `(continued value)`  | `rgba(var(--accent-rgb), 0.55)`       | `--accent-rgb`                              | stays computed from the pinned JS palette, or a new glow token (alpha 0.55)        | live                             |
| `auth/auth.module.css:655`                      | `.signinGlow`                                       | `(continued value)`  | `rgba(155, 123, 255, 0.18)`           | `--pk-agent-violet-fill`                    | new token: `--pk-agent-violet-fill` at 0.18                                        | backdrop (goes with section 1)   |
| `auth/auth.module.css:656`                      | `.signinGlow`                                       | `(continued value)`  | `rgba(8, 8, 10, 0)`                   | old console ground `#08080A`, in no token   | no equivalent: redraw from a v2 token, or drop                                     | backdrop (goes with section 1)   |
| `auth/auth.module.css:666`                      | `.signinStars`                                      | `(continued value)`  | `rgba(255, 255, 255, 0.7)`            | white (`--pk-ink` on dark)                  | new token: white at 0.7                                                            | backdrop (goes with section 1)   |
| `auth/auth.module.css:667`                      | `.signinStars`                                      | `(continued value)`  | `rgba(255, 255, 255, 0.45)`           | white (`--pk-ink` on dark)                  | new token: white at 0.45                                                           | backdrop (goes with section 1)   |
| `auth/auth.module.css:713`                      | `.mascotTop`                                        | `filter`             | `rgba(200, 240, 58, 0.4)`             | exact token value                           | `--pk-lime-edge` (its dark value)                                                  | dead class (goes with section 3) |
| `auth/auth.module.css:721`                      | `.glassCard`                                        | `background`         | `rgba(13, 13, 16, 0.82)`              | old console panel `#0D0D10`, in no token    | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:724`                      | `.glassCard`                                        | `(continued value)`  | `rgba(255, 255, 255, 0.14)`           | white (`--pk-ink` on dark)                  | new token: white at 0.14                                                           | dead class (goes with section 3) |
| `auth/auth.module.css:725`                      | `.glassCard`                                        | `(continued value)`  | `rgba(0, 0, 0, 0.6)`                  | black, in no token                          | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:726`                      | `.glassCard`                                        | `(continued value)`  | `rgba(155, 123, 255, 0.14)`           | `--pk-agent-violet-fill`                    | new token: `--pk-agent-violet-fill` at 0.14                                        | dead class (goes with section 3) |
| `auth/auth.module.css:752`                      | `.walletButton:hover:not(:disabled)`                | `border-color`       | `rgba(243, 241, 236, 0.32)`           | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:797`                      | `.boardNow`                                         | `background`         | `rgba(13, 13, 16, 0.7)`               | old console panel `#0D0D10`, in no token    | no equivalent: redraw from a v2 token, or drop                                     | dead class (goes with section 3) |
| `auth/auth.module.css:892`                      | `.doneBadge`                                        | `border`             | `rgba(200, 240, 58, 0.4)`             | exact token value                           | `--pk-lime-edge` (its dark value)                                                  | dead class (goes with section 3) |
| `auth/auth.module.css:894`                      | `.doneBadge`                                        | `background`         | `rgba(200, 240, 58, 0.12)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.12                                                     | dead class (goes with section 3) |
| `auth/auth.module.css:896`                      | `.doneBadge`                                        | `box-shadow`         | `rgba(200, 240, 58, 0.3)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.3                                                      | dead class (goes with section 3) |
| `auth/auth.module.css:1216`                     | `.codeFilled`                                       | `border-color`       | `rgba(200, 240, 58, 0.6)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.6                                                      | live                             |
| `auth/auth.module.css:1220`                     | `.codeCaret`                                        | `border-color`       | `rgba(243, 241, 236, 0.4)`            | old console bone ink `#F3F1EC`, in no token | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `auth/auth.module.css:1224`                     | `.codeWrong`                                        | `border-color`       | `rgba(255, 95, 162, 0.8)`             | `--pk-magenta`                              | new token: `--pk-magenta` at 0.8                                                   | live                             |
| `auth/auth.module.css:1247`                     | `.codeInput:focus-visible ~ .codeCell`              | `border-color`       | `rgba(200, 240, 58, 0.45)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.45                                                     | live                             |
| `auth/auth.module.css:1433`                     | `.sheet::backdrop`                                  | `background`         | `rgba(6, 6, 9, 0.72)`                 | `#060609`, in no token                      | no equivalent: redraw from a v2 token, or drop                                     | live                             |
| `markets/markets.module.css:353`                | `.tile`                                             | `box-shadow`         | `rgba(255, 255, 255, 0.22)`           | white (`--pk-ink` on dark)                  | new token: white at 0.22                                                           | live                             |
| `markets/markets.module.css:1028`               | `.order`                                            | `background`         | `rgba(var(--pk-space-edge-rgb), 0.4)` | `--pk-space-edge-rgb`                       | new token, alpha 0.4 of the edge; or `--pk-rule` once the review phase is measured | live                             |
| `wallet/components/connect-modal.module.css:13` | `.dialog::backdrop`                                 | `background`         | `rgba(11, 13, 26, 0.72)`              | `--pk-bg` on dark                           | new token: `--pk-bg` on dark at 0.72                                               | live                             |
| `ui/styles.css:513`                             | `.pk-button[data-glow="true"]`                      | `(continued value)`  | `rgba(255, 255, 255, 0.3)`            | white (`--pk-ink` on dark)                  | new token: white at 0.3                                                            | live                             |
| `ui/styles.css:514`                             | `.pk-button[data-glow="true"]`                      | `(continued value)`  | `rgba(200, 240, 58, 0.32)`            | `--pk-lime`                                 | new token: `--pk-lime` at 0.32                                                     | live                             |
| `ui/styles.css:522`                             | `.pk-button[data-glow="true"]:hover:not(:disabled)` | `(continued value)`  | `rgba(255, 255, 255, 0.3)`            | white (`--pk-ink` on dark)                  | new token: white at 0.3                                                            | live                             |
| `ui/styles.css:523`                             | `.pk-button[data-glow="true"]:hover:not(:disabled)` | `(continued value)`  | `rgba(200, 240, 58, 0.5)`             | `--pk-lime`                                 | new token: `--pk-lime` at 0.5                                                      | live                             |
| `ui/styles.css:857`                             | `.pk-panel[data-tone="raised"]`                     | `box-shadow`         | `rgba(255, 255, 255, 0.22)`           | white (`--pk-ink` on dark)                  | new token: white at 0.22                                                           | live                             |

### 4.6 Colour literals in TS: 24 hex in 5 files

| Where                                  | Literal                                    | Token it mirrors or should become                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx:34`                    | `themeColor: "#FFFFFF"`                    | `--pk-bg` (light). Next metadata cannot read CSS; belongs in the pinned mirror                                                                                                              |
| `apply/lib/options.ts:13`              | `#C8F03A` + `200,240,58`                   | `--pk-agent-lime-fill`                                                                                                                                                                      |
| `apply/lib/options.ts:14`              | `#5AD8FF` + `90,216,255`                   | **no token.** The old cyan. `lib/accent.ts:12-15` records that the same value was removed from `ACCENT_COLORS`; this copy was missed                                                        |
| `apply/lib/options.ts:15`              | `#FFC93F`                                  | `--pk-agent-amber-fill`                                                                                                                                                                     |
| `apply/lib/options.ts:16`              | `#FF7A3D`                                  | `--pk-agent-orange-fill`                                                                                                                                                                    |
| `apply/lib/options.ts:17`              | `#FF5FA2`                                  | `--pk-agent-magenta-fill`                                                                                                                                                                   |
| `apply/lib/options.ts:18`              | `#9B7BFF`                                  | `--pk-agent-violet-fill`                                                                                                                                                                    |
| `apply/lib/options.ts:19`              | `#5B8CFF`                                  | `--pk-agent-blue-fill`                                                                                                                                                                      |
| `apply/lib/options.ts:20`              | `#F5F6FF` + `245,246,255`                  | **no token.** The old public ink                                                                                                                                                            |
| `apply/lib/options.ts:21`              | `#A9B0D0` + `169,176,208`                  | **no token**                                                                                                                                                                                |
| `lib/accent.ts:18-24`                  | 7 hex, each with an `r,g,b` triple         | `--pk-agent-<hue>-fill`; `cyan` holds indigo's `#5B3CE0`. The `color` half is read by nothing outside the file (`ACCENT_COLORS` is in the unused-export list); only `rgb` is used, at `:60` |
| `ui/chart.tsx:46`                      | fallback `#6b7186`                         | `--pk-ink-faint`. Stale: the token is `#5a5f78` on light (through `--pk-ink-muted`), `#8c91a9` on dark                                                                                      |
| `ui/chart.tsx:47`                      | fallback `rgba(11, 13, 26, 0.12)`          | `--pk-border`, which is `--pk-rule-strong`. Matches light                                                                                                                                   |
| `ui/chart.tsx:48`                      | fallback `#2e7d32`                         | `--pk-win`. Stale: the token is `#2b732e`                                                                                                                                                   |
| `ui/chart.tsx:49`                      | fallback `#c62c62`                         | `--pk-loss`. Stale: the token is `#bb2a5d`                                                                                                                                                  |
| `ui/brand.tsx:27`, `:31`, `:35`, `:39` | `#4285F4`, `#34A853`, `#FBBC05`, `#EA4335` | none: a third party's logo colours (Google). An exemption the static check has to name                                                                                                      |

`ui/brand.tsx` is not in the file list of `packages/ui/AGENTS.md`.

### Method

Custom properties: every `--name: value` line in CSS (comments removed) outside `styles.css`, and
every `var(--name` read, per file. Literals: every hex, `rgb()`, `rgba()`, `hsl()` and named colour
in a declaration value, comments removed, with the selector of the enclosing rule; each is matched
against the token values in `styles.css` by exact value, then by base colour for an `rgba()`.
"Fate" marks a literal whose rule names a backdrop class (section 1.3) or an unreferenced class
(section 3.1).

<details>
<summary>aliases.mjs (custom properties and reads; `defs` or `reads` as the argument)</summary>

```js
// Custom properties defined outside styles.css, and reads of each.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execSync("git ls-files apps/web/src packages/ui/src", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => /\.(css|tsx?|mjs)$/.test(f));
const defs = [];
const reads = {};
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  let inComment = false;
  lines.forEach((raw, i) => {
    let line = raw;
    if (f.endsWith(".css")) {
      // strip comments
      let out = "";
      let j = 0;
      while (j < line.length) {
        if (inComment) {
          const e = line.indexOf("*/", j);
          if (e < 0) {
            j = line.length;
          } else {
            inComment = false;
            j = e + 2;
          }
        } else {
          const s = line.indexOf("/*", j);
          if (s < 0) {
            out += line.slice(j);
            j = line.length;
          } else {
            out += line.slice(j, s);
            inComment = true;
            j = s + 2;
          }
        }
      }
      line = out;
      const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.*?);?\s*$/);
      if (m && f !== "packages/ui/src/styles.css")
        defs.push({ name: m[1], value: m[2], file: f, line: i + 1 });
    }
    for (const r of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
      reads[r[1]] ??= {};
      reads[r[1]][f] = (reads[r[1]][f] ?? 0) + 1;
    }
    if (!f.endsWith(".css")) {
      for (const r of line.matchAll(/["'`](--[\w-]+)["'`]\s*[:\]]/g))
        defs.push({ name: r[1], value: "(set from TS)", file: f, line: i + 1 });
    }
  });
}
const mode = process.argv[2];
if (mode === "defs") {
  for (const d of defs) {
    const r = reads[d.name] ?? {};
    const own = r[d.file] ?? 0;
    const total = Object.values(r).reduce((a, b) => a + b, 0);
    console.log([d.file + ":" + d.line, d.name, d.value, own, total].join("\t"));
  }
} else if (mode === "reads") {
  const name = process.argv[3];
  for (const [n, r] of Object.entries(reads))
    if (!name || n.startsWith(name))
      console.log(
        n,
        Object.values(r).reduce((a, b) => a + b, 0),
        JSON.stringify(r),
      );
}
```

</details>

<details>
<summary>literals.mjs</summary>

```js
// Colour literals in CSS outside token definitions, with the token holding the same value.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const tokensCss = strip(readFileSync("packages/ui/src/styles.css", "utf8"));
const norm = (v) => v.toLowerCase().replace(/\s+/g, "");
const hex3 = (r, g, b) =>
  "#" + [r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
// token values per surface
const byValue = new Map();
const rgbOf = new Map();
let surface = "root";
tokensCss.split("\n").forEach((line) => {
  if (/^\[data-surface="light"\]/.test(line)) surface = "light";
  if (/^\[data-surface="dark"\]/.test(line)) surface = "dark";
  if (/^\.pk-|^h1|^\[data-face/.test(line)) surface = "rules";
  const m = line.match(/^\s*(--pk-[\w-]+):\s*(.+?);/);
  if (!m || surface === "rules") return;
  const v = norm(m[2]);
  if (/^#|^rgba?\(/.test(v)) {
    const k = v;
    if (!byValue.has(k)) byValue.set(k, []);
    byValue.get(k).push(`${m[1]} (${surface})`);
    if (/^#[0-9a-f]{6}$/.test(v)) {
      const key = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).join(",");
      if (!rgbOf.has(key)) rgbOf.set(key, []);
      rgbOf.get(key).push(`${m[1]} (${surface})`);
    }
  }
});
const files = execSync("git ls-files apps/web/src packages/ui/src", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => f.endsWith(".css"));
const NAMED =
  /(?<![\w-])(white|black|red|green|blue|yellow|orange|purple|gray|grey|silver|navy|teal|lime|aqua|fuchsia|maroon|olive)(?![\w-])/gi;
let total = 0;
const per = {};
for (const f of files) {
  const lines = strip(readFileSync(f, "utf8")).split("\n");
  lines.forEach((line, i) => {
    if (f === "packages/ui/src/styles.css" && /^\s*--pk-[\w-]+:/.test(line)) return; // a token definition
    const found = [];
    for (const m of line.matchAll(
      /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*(?:\([^()]*\)[^()]*)*\)|hsla?\([^()]*\)/g,
    ))
      found.push(m[0]);
    const decl = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (
      decl &&
      !/^(font|font-family|animation|animation-name|transition|grid-area|grid-template-areas|content|composes|will-change)$/.test(
        decl[1],
      )
    ) {
      const v = decl[2].replace(/var\([^)]*\)/g, "").replace(/url\([^)]*\)/g, "");
      for (const m of v.matchAll(NAMED)) found.push(m[0] + " (named)");
    }
    for (const lit of found) {
      let suggestion = "no token holds this value";
      const n = norm(lit);
      if (byValue.has(n)) suggestion = "= " + byValue.get(n).join(", ");
      else {
        const a = n.match(/^rgba?\((\d+),(\d+),(\d+),([\d.]+)\)$/);
        const v = n.match(/^rgba\(var\((--[\w-]+)\),([\d.]+)\)$/);
        if (a) {
          const key = `${a[1]},${a[2]},${a[3]}`;
          const base = rgbOf.get(key);
          suggestion = base
            ? `${hex3(a[1], a[2], a[3])} at ${a[4]}: alpha of ${base.join(", ")}; needs a named token`
            : `${hex3(a[1], a[2], a[3])} at ${a[4]}: base colour is in no token`;
        } else if (v) suggestion = `alpha ${v[2]} of ${v[1]}; needs a named token`;
        else if (/^#[0-9a-f]{3}$/.test(n)) {
          const e = "#" + [...n.slice(1)].map((c) => c + c).join("");
          if (byValue.has(e)) suggestion = "= " + byValue.get(e).join(", ");
        }
      }
      const prop = decl ? decl[1] : "";
      console.log([`${f}:${i + 1}`, prop, lit, suggestion].join("\t"));
      total++;
      per[f] = (per[f] ?? 0) + 1;
    }
  });
}
console.error(total, JSON.stringify(per, null, 1));
```

</details>

```sh
# hex in TS, comments and fragment links excluded
grep -rn -E '#[0-9a-fA-F]{3,8}\b' apps/web/src packages/ui/src --include='*.ts' --include='*.tsx' \
  | grep -v -E '^\S+:[0-9]+:\s*(\*|//|/\*)' | grep -v -E 'href="#|"#[a-z-]+"'
# --pk-* assigned outside the token file
grep -rn -E '^\s*--pk-[a-z0-9-]+\s*:' apps/web/src packages/ui/src --include='*.css' \
  | grep -v 'packages/ui/src/styles.css'
```

Caveats: a legacy-token count includes reads inside `styles.css` rules (the shared components), which
is where some of the replacement has to happen. The literal scan reads declarations line by line, so
a value continued over several lines is attributed to its own line with the property shown as
"(continued value)".

**Changed since the earlier inventory:** custom properties in modules 100 to 107, still 7 modules;
`--label` still 153. Legacy tokens still 21. CSS literals 92 to 97 in modules (102 with the five in
`styles.css` rules, which the earlier count may not have included). TS hex 17 to 24: the earlier
list named three files; `app/layout.tsx` and `ui/brand.tsx` are the other two. `--pk-font-mono`
still the one undefined token; `--pk-*` assignments outside the token file still 0.

## 5. Studio sections

13 section keys, 13 rail rows (plus a Home row). 7 sections have a real component (8 components,
because `limits` renders two). 6 are stubs drawn from one copy table. `trading` is a component but
not a section key. The empty home's rail lists 9 rows, 3 of which name no section that exists.

### 5.1 Section by section

Rail source: `GROUPS` in `studio/studio.tsx:51-80`. Keys: `SECTIONS` in
`studio/sections/keys.ts:9-23`. Render switch: `studio/studio.tsx:762-853`. Paths in this section
are relative to `apps/web/src/features/studio/`.

| Section id | Rail group / label (`studio.tsx`) | Component                                              | Rendered at          | Real / stub                         | Data source                                                                                                                                                              |
| ---------- | --------------------------------- | ------------------------------------------------------ | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `overview` | RUN / Overview (`:55`)            | `sections/overview.tsx:24`                             | `studio.tsx:766-791` | Real                                | Props from the shell: `GET /agents`, `GET /agents/:id/runs` (`studio.tsx:207-208`, `:317`); writes `POST /agents/:id/runs` (`:389`), `PUT /agents/:id/schedule` (`:780`) |
| `context`  | RUN / Context (`:56`)             | `sections/context.tsx:14`                              | `studio.tsx:849-850` | Real, read-only                     | The agent's saved config only, no fetch of its own. Its own comment says the canvas's conversation has no backend (`context.tsx:7-13`)                                   |
| `picks`    | RUN / Picks (`:57`)               | `sections/picks.tsx:192`                               | `studio.tsx:792-802` | Real                                | Shell runs and events, plus `GET /runs/:id/paper-order` (`picks.tsx:219`)                                                                                                |
| `activity` | RUN / Activity (`:58`)            | `sections/activity.tsx:65`                             | `studio.tsx:803-813` | Real                                | Shell runs and `GET /runs/:id/events` (`studio.tsx:325`)                                                                                                                 |
| `brief`    | BUILD / Brief (`:64`)             | `sections/brief.tsx:16`                                | `studio.tsx:824-832` | Real, but the older brief (see 5.2) | `agent.config.profile` and `marketScope`; saved through `PUT /agents/:id/config` (`studio.tsx:401-413`)                                                                  |
| `skills`   | BUILD / Skills (`:65`)            | `sections/skills.tsx:17`                               | `studio.tsx:814-823` | Real                                | `GET /options` (`studio.tsx:282`); saved through `PUT /agents/:id/config`                                                                                                |
| `sources`  | BUILD / Sources (`:66`)           | `sections/stub.tsx:20-26`                              | `studio.tsx:852`     | Stub, state `LIVES IN SKILLS`       | None, static copy                                                                                                                                                        |
| `limits`   | BUILD / Limits & funding (`:67`)  | `sections/trading.tsx:11` and `sections/limits.tsx:37` | `studio.tsx:833-848` | Real (two components)               | Limits: `PUT /agents/:id/config`. Trading: see 5.3                                                                                                                       |
| `identity` | BUILD / Identity & voice (`:68`)  | `sections/stub.tsx:27-33`                              | `studio.tsx:852`     | Stub, state `HALF BUILT`            | None                                                                                                                                                                     |
| `profile`  | GROW / Public profile (`:74`)     | `sections/stub.tsx:34-40`, link at `:106-119`          | `studio.tsx:852`     | Stub, state `RECORD PENDING`        | None; one link to `/agents/<handle>`                                                                                                                                     |
| `audience` | GROW / Audience (`:75`)           | `sections/stub.tsx:41-47`                              | `studio.tsx:852`     | Stub, state `NO BACKEND`            | None                                                                                                                                                                     |
| `token`    | GROW / Token (`:76`)              | `sections/stub.tsx:48-54`                              | `studio.tsx:852`     | Stub, state `NO BACKEND`            | None                                                                                                                                                                     |
| `board`    | PUBLIC / The board (`:79`)        | `sections/stub.tsx:55-61`, links at `:82-105`          | `studio.tsx:852`     | Stub, state `BUILT`                 | None; two links, to `/agents` and `/leaderboard`                                                                                                                         |

Notes an implementer needs:

- The stub is the switch's fall-through (`studio.tsx:851-853`), so any key without a branch renders
  `Stub`. `Stub` returns `null` for a key missing from `PAGES` (`sections/stub.tsx:67-70`).
- `PAGES` is typed `Record<string, …>` (`sections/stub.tsx:16-19`), not keyed by `SectionKey`.
  Removing a section key will not produce a type error there.
- Rail badges are hardcoded for three stubs: `profile: SAMPLE`, `audience: PLANNED`,
  `token: PLANNED` (`studio.tsx:442-444`).
- `SectionKey` is re-exported from the client module `sections/stub.tsx:9`. Three files import the
  type from there rather than from `keys.ts`: `studio.tsx:40`, `sections/overview.tsx:6`,
  `sections/context.tsx:4`. Deleting `stub.tsx` breaks those imports.
- The stub copy for `token` says "No curve, no contracts, no purchases" (`sections/stub.tsx:53`).
  Main has since merged the launchpad, so that copy may be out of date. Not verified against the
  launchpad code.

### 5.2 `sections/brief.tsx` versus the `brief/` folder

`sections/brief.tsx` is still imported and still rendered. It is not dead code.

| Item                                    | Evidence                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sections/brief.tsx` (146 lines) import | `studio.tsx:35` is its only importer                                                                                                          |
| `sections/brief.tsx` render             | `studio.tsx:824-832`, the rail's Brief row for an existing agent                                                                              |
| What it edits                           | One free-text `config.profile` and the sports scope (`sections/brief.tsx:30-36`)                                                              |
| Last touched                            | `628e8ff`, 2026-09-24 (a rename commit)                                                                                                       |
| `brief/` folder (5 files, 972 lines)    | `brief-form.tsx` 180, `fixture.ts` 102, `model.ts` 448, `paper-run.tsx` 135, `result.ts` 107                                                  |
| `brief/` importers in `src`             | `home/empty.tsx:18` (`BriefFields`), `home/empty.tsx:41` (`model`), `home/empty.tsx:42` (`PaperRun`), `studio.tsx:42` (`briefFixture`)        |
| `brief/` importers in tests             | `apps/web/test/studio-brief.test.ts:34`, `studio-brief-run.test.ts:4`, `studio-landing.test.ts:114-115`                                       |
| What `brief/` edits                     | The five-section brief on the empty home, with a paper run: `startPreviewRun` (`home/empty.tsx:221`) and `createDraft` (`home/empty.tsx:275`) |
| Last touched                            | `80fc73d`, 2026-09-29                                                                                                                         |

So there are two brief editors with different models. The new one is only reachable before the
first agent exists (`home/empty.tsx`). Once an agent exists, the rail's Brief row opens the old one.
`brief/model.ts:28` also exports its own `SECTIONS`, a different list from `sections/keys.ts:9`,
under the same name.

### 5.3 The trading section main added

| Item        | Evidence                                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component   | `sections/trading.tsx:11` (235 lines)                                                                                                                                                                                               |
| Import      | `studio.tsx:36`                                                                                                                                                                                                                     |
| Render      | `studio.tsx:833-840`, inside the `limits` branch, above `Limits`                                                                                                                                                                    |
| Section key | None. `trading` is not in `SECTIONS` (`sections/keys.ts:9-23`), not in `GROUPS` (`studio.tsx:51-80`), not in the home menu (`home/menu.tsx:57-86`)                                                                                  |
| Deep link   | `?section=trading` is rejected by `sectionFromSearch` (`sections/keys.ts:44`), so no harness route can open it by name                                                                                                              |
| Data        | `GET /agents/:id/trading/account` (`sections/trading.tsx:38`), `GET /agents/:id/trading/orders` (`:39`), `POST /agents/:id/trading/prepare` (`:152`), `POST /trading/orders/:id/submit` (`:197`), mode saved through config (`:78`) |
| History     | Two commits: `628e8ff` 2026-09-24 and `294d310` 2026-09-29                                                                                                                                                                          |

Trading is real and API-backed, but it is a panel of Limits & funding, not a rail section.

### 5.4 What each of the three navigation lists shows

| List                                      | Source                                                | Rows                   | Contents                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell rail                                | `studio.tsx:51-80`, drawn at `:652-697`               | 13 + Home              | RUN: Overview, Context, Picks, Activity. BUILD: Brief, Skills, Sources, Limits & funding, Identity & voice. GROW: Public profile, Audience, Token. PUBLIC: The board           |
| Home menu (Studio v5 home and empty home) | `home/menu.tsx:57-86`                                 | 13                     | Same 13 keys. Differences: `profile` is labelled "Public page" (`:80`), `board` sits under GROW (`:83`), there is no PUBLIC group, `token` carries the note `OPTIONAL` (`:82`) |
| Empty home rail                           | `RAIL` in `home/empty.tsx:49-69`, drawn at `:345-358` | 9, all `aria-disabled` | RUN: Overview, Console, Trades, Activity. BUILD: Brief, Sources & rules, Limits & funding, Identity & voice. GROW: Public profile                                              |

The empty rail is label-only (`[IconName, string]` pairs, no section key). Three of its labels match
nothing in the other two lists: "Console" (`home/empty.tsx:54`), "Trades" (`:55`) and "Sources &
rules" (`:63`). It omits Context, Picks, Skills, Sources, Audience, Token and The board.

The Studio v5 home (`home/home.tsx`) has no rail. It lists these parts:

| Part                      | Harness id                    | File:line                                                                                            |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Menu                      | `home-menu`                   | `home/menu.tsx:110`, mounted at `home/home.tsx:247`                                                  |
| Draft chip                | `home-draft-chip`             | `home/home.tsx:242`                                                                                  |
| Strip                     | `home-strip`                  | `home/strip.tsx:19`, mounted at `home/home.tsx:266`                                                  |
| Second-passkey suggestion | `home-second-passkey`         | `home/home.tsx:282`                                                                                  |
| Agent card                | `home-agent`                  | `home/agent-card.tsx:22`                                                                             |
| Wallet and deposit        | `home-wallet`, `home-deposit` | `home/wallet-card.tsx:48`, `:87`; `home/deposit-sheet.tsx:172`; draft variant at `home/home.tsx:289` |
| Schedule                  | `home-schedule`               | `home/schedule.tsx:58`                                                                               |
| Picks                     | `home-picks`                  | `home/picks.tsx:56`; loading variant at `home/home.tsx:326`                                          |
| Next up (funded agent)    | `home-next`                   | `home/next-up.tsx:17`, mounted at `home/home.tsx:336`                                                |
| Go Public (draft)         | `home-go-public`              | `home/go-public.tsx:19`, mounted at `home/home.tsx:334`                                              |

### Method

Read the rail, key list and render switch directly, then searched for importers. Git history per
file for the question of which brief is newer.

```sh
find apps/web/src/features/studio -type f | sort | xargs wc -l
grep -rn "sections/\|brief/" apps/web/src apps/web/test | grep -E "import|from"
grep -n "studioApi\|onSave" apps/web/src/features/studio/sections/*.tsx
grep -n 'id="home-' apps/web/src/features/studio/home/*.tsx
git log --format='%h %ad %s' --date=short -3 -- apps/web/src/features/studio/sections/brief.tsx
git log --format='%h %ad %s' --date=short -3 -- apps/web/src/features/studio/brief
```

Not verified: whether the stub copy for `token` and `profile` is still accurate after the launchpad
merge, and what the Studio v5 and Studio Empty v4 canvases themselves draw (the code and its
comments were read, not the canvases).

**Changed since the earlier inventory:** the six stubs are unchanged (sources, identity, profile,
audience, token, board). `sections/brief.tsx` is confirmed live, not superseded. New:
`sections/trading.tsx` exists but has no section key and renders inside `limits`. New: the empty
home rail carries three labels that name no section.

## 6. Design harness

50 route entries over 20 distinct pathnames (20 marketplace, 30 studio; 34 dark, 16 light). 5
runtime checks plus 2 unit-test files (13 tests, all passing when run by hand). 14 routes are
predicted BLOCKED on the current tree in the documented local setup. The harness itself was not
run: nothing was listening on port 3001 and no server was started.

### 6.1 Files

The fixture API is `scripts/design/fixture-api.mjs`, not `scripts/design/lib/fixture-api.mjs`.
`lib/` holds four other files.

| File                                 | Lines   | Role                                                                 |
| ------------------------------------ | ------- | -------------------------------------------------------------------- |
| `scripts/design/routes.mjs`          | 657     | `ROUTES` (`:34-620`), `GROUND` (`:622`), `HOLDS` (`:631-657`)        |
| `scripts/design/contrast.mjs`        | 146     | Runtime check                                                        |
| `scripts/design/surfaces.mjs`        | 141     | Runtime check                                                        |
| `scripts/design/tokens.mjs`          | 65      | Runtime check                                                        |
| `scripts/design/type.mjs`            | 60      | Runtime check                                                        |
| `scripts/design/shots.mjs`           | 43      | Screenshots, two widths                                              |
| `scripts/design/fixture-api.mjs`     | 157     | Loopback stand-in API                                                |
| `scripts/design/lib/render.mjs`      | 615     | `eachRoute`, `finish`, BLOCKED kinds, guard cookie                   |
| `scripts/design/lib/probe.mjs`       | 217     | In-page functions                                                    |
| `scripts/design/lib/colour.mjs`      | 80      | Parse, composite, ratio                                              |
| `scripts/design/lib/tokens-file.mjs` | 44      | Reads `packages/ui/src/styles.css`                                   |
| `scripts/design/colour.test.mjs`     | 123     | 8 unit tests                                                         |
| `scripts/design/levels.test.mjs`     | 132     | 5 unit tests                                                         |
| `scripts/design/fixtures/*.mts`      | 3 files | Sample agents, personas, reads                                       |
| `scripts/design/shots/`              | 62 PNGs | Gitignored (`.gitignore:27-28`), last written 2026-09-25 03:16-03:18 |

### 6.2 Routes covered

| Pathname                    | Entries | Names                                                                           | Declared surface |
| --------------------------- | ------- | ------------------------------------------------------------------------------- | ---------------- |
| `/`                         | 1       | landing                                                                         | light            |
| `/portfolio`                | 3       | portfolio, portfolio-connected, portfolio-no-positions                          | light            |
| `/leaderboard`              | 1       | leaderboard                                                                     | light            |
| `/agents`                   | 1       | agents                                                                          | dark             |
| `/agents/halftime`          | 1       | agent-profile                                                                   | dark             |
| `/agents/halftime/ask`      | 1       | agent-ask                                                                       | dark             |
| `/tokens`                   | 1       | tokens                                                                          | light            |
| `/tokens/half`              | 1       | token                                                                           | light            |
| `/tokens/half/picks/half-1` | 1       | token-pick                                                                      | light            |
| `/markets`                  | 1       | markets                                                                         | light            |
| `/markets/BTC-PERP`         | 4       | market-ask, market-trade, market-trade-picked, market-ask-picked                | light            |
| `/reads`                    | 1       | reads-gate                                                                      | light            |
| `/reads/r1`                 | 1       | read                                                                            | light            |
| `/activity`                 | 1       | activity-gate                                                                   | light            |
| `/apply`                    | 1       | apply-no-seat                                                                   | dark             |
| `/studio`                   | 14      | studio, 4 home stages, empty, 3 brief stages, draft, second-passkey, 4 sections | dark             |
| `/studio/new`               | 10      | create-describe … create-run                                                    | dark             |
| `/account`                  | 3       | account, account-security, account-profile                                      | dark             |
| `/signup`                   | 2       | signup-passkey, signup                                                          | dark             |
| `/signin`                   | 1       | signin                                                                          | dark             |

The four dark marketplace entries are declared dark on purpose, to measure the ground they ship on
rather than the ground the spec assigns (`routes.mjs:110-126`, `:313-314`). When the backdrop is
removed, the three agents entries flip to `light` (`routes.mjs:131`, `:144`, `:156`); `/apply`
(`:319`) stays dark.

### 6.3 App routes not covered

| Route                                               | Why it matters                                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/passkey`                                          | No entry. A stale shot `passkey-none-yet-*.png` remains in `shots/` from a route entry since removed                                                                                                                                   |
| `/console`                                          | Redirect to `/studio` only (`apps/web/src/app/console/page.tsx:14`)                                                                                                                                                                    |
| `/auth/callback`, `/api/v1/[...path]`               | Route handlers, nothing to render                                                                                                                                                                                                      |
| `not-found.tsx`, `error.tsx`                        | Detected only as a blocking condition (`render.mjs:405-408`), never measured                                                                                                                                                           |
| `/apply` with a seat                                | Only `NoSeat` is measured; the form needs the apply cookie (`routes.mjs:308-311`)                                                                                                                                                      |
| `/reads`, `/activity`, `/portfolio` behind the gate | `/reads` and `/activity` measure the connect gate only (`routes.mjs:275-307`)                                                                                                                                                          |
| `/agents/[handle]/ask` steps 2 and 3                | Only COMPOSE is reached (`routes.mjs:158-161`)                                                                                                                                                                                         |
| `/signup` and `/signin` later steps                 | Code, handle and welcome steps have no entry                                                                                                                                                                                           |
| Studio sections                                     | 4 of 13 have an entry (picks, activity, skills, token: `routes.mjs:426-457`). Unmeasured: overview, context, brief, sources, limits, identity, profile, audience, board. The trading panel is inside `limits`, so it is unmeasured too |

### 6.4 Routes reported BLOCKED, and why

The BLOCKED kinds are defined in `render.mjs:209-268`: `server-down`, `not-built` (any 404,
`render.mjs:395-398`), `server-error`, `stub` (proof selector matches nothing, `render.mjs:434-439`),
`click-missed`, `no-floor`, `no-product`, `error-boundary`.

Prediction for the documented local setup: a dev server on 3001 with Supabase configured and the
real local API. `apps/web/.env.local` does define `NEXT_PUBLIC_SUPABASE_URL` (checked for presence
only; the value was not read).

| #   | Route name       | Path                        | Kind            | Reason                                                                                                                                                                                                                                                          |
| --- | ---------------- | --------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | agent-profile    | `/agents/halftime`          | not-built (404) | `halftime` exists only in `scripts/design/fixtures/sample-personas.mts:28`; no product source serves it                                                                                                                                                         |
| 2   | agent-ask        | `/agents/halftime/ask`      | not-built (404) | Same handle; `notFound()` at `apps/web/src/app/agents/[handle]/ask/page.tsx` when the persona is null                                                                                                                                                           |
| 3   | token            | `/tokens/half`              | not-built (404) | `notFound()` when no profile (`apps/web/src/app/tokens/[ticker]/page.tsx:30-32`); `$HALF` is at `fixtures/sample-agent-directory.mts:61`                                                                                                                        |
| 4   | token-pick       | `/tokens/half/picks/half-1` | not-built (404) | `notFound()` (`apps/web/src/app/tokens/[ticker]/picks/[pickId]/page.tsx:29-31`)                                                                                                                                                                                 |
| 5   | read             | `/reads/r1`                 | not-built (404) | `r1` is at `fixtures/sample-reads.mts:186` only                                                                                                                                                                                                                 |
| 6   | studio           | `/studio`                   | stub            | With Supabase configured and no session, the shell redirects to `/signin` (`studio/studio.tsx:253-257`); `#home-agent` never renders                                                                                                                            |
| 7   | studio-picks     | `/studio?section=picks`     | stub            | Same. `?section=` needs an agent; the fixture path needs auth unconfigured (`studio/preview.ts:219-226`, `studio/studio.tsx:223-252`)                                                                                                                           |
| 8   | studio-activity  | `/studio?section=activity`  | stub            | Same                                                                                                                                                                                                                                                            |
| 9   | studio-skills    | `/studio?section=skills`    | stub            | Same                                                                                                                                                                                                                                                            |
| 10  | studio-token     | `/studio?section=token`     | stub            | Same                                                                                                                                                                                                                                                            |
| 11  | account          | `/account`                  | stub            | Preview only when auth is unconfigured (`account/lib/preview.ts:39-47`)                                                                                                                                                                                         |
| 12  | account-security | `/account?section=security` | stub            | Same                                                                                                                                                                                                                                                            |
| 13  | account-profile  | `/account?section=profile`  | stub            | Same                                                                                                                                                                                                                                                            |
| 14  | tokens           | `/tokens`                   | stub            | **New.** The proof is stale: `routes.mjs:176-177` wants `#tokens-empty` or an `h1` reading "EVERY AGENT TOKEN.". Neither string exists anywhere in `apps/web/src` or `packages/ui/src`. The page now renders `LaunchBoard` (`apps/web/src/app/tokens/page.tsx`) |

Why the cookie does not help routes 6 to 13: the harness adds a dummy `sb-<ref>-auth-token` cookie
to studio routes on loopback (`render.mjs:103-113`). That passes the middleware's name-only check
(`apps/web/src/server/guard.ts:27-31`, `:75-80`) but is not a session, so the client redirects.

The 28 staged studio routes do not need a session and should render: `?stage=` is gated on the
build alone (`studio/home/stage.ts:8-12`, `studio/studio.tsx:159-165`), as are `?step=` and
`?state=passkey`.

Supporting evidence from the last real run. `shots.mjs` clears the folder each run (`shots.mjs:18`),
so `shots/` reflects one run on 2026-09-25:

| Group                       | Count | Names                                                             |
| --------------------------- | ----- | ----------------------------------------------------------------- |
| Current routes with a shot  | 30    | includes `tokens`, which rendered then                            |
| Shot with no current route  | 1     | `passkey-none-yet`                                                |
| Current routes with no shot | 20    | the 13 in rows 1 to 13 above, plus 7 added on or after 2026-09-25 |

The 7 later additions are `signup-passkey`, `studio-home-second-passkey`, `studio-home-empty`,
`studio-brief-running`, `studio-brief-done`, `studio-brief-stale` and `studio-home-draft` (commits
`c351b90`, `8e486de`, `742373e`, `ef63752`, `c5b07bc`). They have never been photographed. They are
expected to render, but that is unverified.

Two alternative setups change the result:

| Setup                             | Effect                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture API behind the dev server | Rows 1 to 5 render. `/tokens` stays blocked: the fixture has no `/v1/launches` route, answers 404 (`fixture-api.mjs:144-146`), and `listLaunches` turns that into `null` (`apps/web/src/server/container.ts:24-29`) |
| Supabase env unset                | Rows 6 to 13 render from fixtures (`studio/preview.ts:219-226`, `account/lib/preview.ts:39-47`)                                                                                                                     |

The repository's own comments disagree about which setup is normal. `routes.mjs:7-8` says Supabase
is unconfigured in every environment the checks run in; `studio/home/stage.ts:10-11` says the local
server has it configured.

### 6.5 What each check measures and misses

| Check             | Measures                                                                                                                                              | Evidence                                                | Misses                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.mjs`      | Every painted colour must equal a value some `--pk-*` token resolves to on that page                                                                  | `tokens.mjs:26-57`; `lib/probe.mjs:58-92`               | See below                                                                                                                                                                                                        |
| `contrast.mjs`    | WCAG ratio for every visible element with its own text, compositing opacity and grounds; 4.5, or 3 for large text                                     | `contrast.mjs:13-15`, `:96-103`                         | Text over any `background-image` is counted and skipped (`:41-43`, `:76-81`). Opacity-0 text is noted, not scored (`:89-95`). No non-text contrast, no focus rings, no pseudo-elements, no hover or focus states |
| `surfaces.mjs`    | The ground colour of the deepest full-viewport element equals `GROUND[surface]`; `--pk-bg` resolves correctly; nested opposite `data-surface` inverts | `surfaces.mjs:43-56`, `:61-80`; `lib/probe.mjs:103-216` | Reads `backgroundColor` only (`lib/probe.mjs:104-112`), so a gradient or starfield painted over a correct ground colour passes. Required inversions are named for 3 routes only (`surfaces.mjs:31-35`)           |
| `type.mjs`        | Visible `h1` and `h2` use Archivo and carry a `wdth` axis                                                                                             | `type.mjs:13`, `:38-50`                                 | `h3` and below, body face, sizes, weights, tracking. Anything marked `data-face="body"` is exempt (`:13`)                                                                                                        |
| `shots.mjs`       | Full-page PNG at 1400x1000 and 390x844                                                                                                                | `shots.mjs:11-14`, `:29`                                | No comparison of any kind. Output is gitignored, so nothing is reviewed or diffed                                                                                                                                |
| `colour.test.mjs` | 8 unit tests of the colour arithmetic                                                                                                                 | `colour.test.mjs:24-94`                                 | Pure arithmetic, no page                                                                                                                                                                                         |
| `levels.test.mjs` | 5 tests: every ink on every ground per surface, every state ink on its tint, ink levels distinct                                                      | `levels.test.mjs:68`, `:89`, `:111`                     | Reads `styles.css` only; says nothing about what components use                                                                                                                                                  |

The claim about `tokens.mjs` is **confirmed**. `paintedColours` reads exactly three things:

- `backgroundColor` (`lib/probe.mjs:74-76`)
- `color`, for elements carrying text (`lib/probe.mjs:77-82`)
- `border{Top,Right,Bottom,Left}Color`, where the border has width (`lib/probe.mjs:83-89`)

It never reads `background-image`, `box-shadow`, `text-shadow`, `outline`, `filter`, SVG `fill` or
`stroke`, or any `::before` or `::after`. So the `.space` gradient, the `.stars` dots, the neon
floor grid and every glow pass this check untouched. Of the 102 CSS literals in section 4.5, the
ones in `box-shadow`, `text-shadow`, `filter`, `background-image` and `mask-image` are invisible
to it.

Two further gaps in the same check:

- The token side collects every property starting `--pk-` from every stylesheet rule on the page
  (`lib/probe.mjs:11-23`), not only from `styles.css`. A `--pk-*` assigned in a feature module would
  count as a token.
- Carried-forward tokens count as tokens. The check cannot tell a v2 token from a legacy one.

A rule that applies to all four runtime checks: the harness refuses to run without
`DESIGN_BASE_URL` (`lib/render.mjs:14-23`) and refuses a server whose tokens differ from this
tree's (`lib/render.mjs:305-360`, `:409-429`).

### 6.6 Wiring in package.json and CI

| Thing                      | Wired?           | Evidence                                                                                                                                                                  |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type-check of the fixtures | Yes              | `package.json:42` (`typecheck:design`), made a dependency of `typecheck` in `turbo.json:23` and `:25`; CI runs `npm run typecheck` at `.github/workflows/postgres.yml:34` |
| Scope of that type-check   | Fixtures only    | `scripts/design/tsconfig.json:3` includes `fixtures/*.mts`; none of the `.mjs` checks                                                                                     |
| The 5 runtime checks       | No               | No script in any `package.json`; no workflow mentions them. Workflows present: `contracts.yml`, `format.yml`, `postgres.yml`                                              |
| The 2 unit-test files      | No               | The root `test` script's globs (`package.json:18`) do not include `scripts/design/*.test.mjs`                                                                             |
| Playwright                 | Not a dependency | Resolved from a global install (`lib/render.mjs:115-132`), so CI could not run the checks as they stand                                                                   |
| Formatting                 | Yes, indirectly  | `npm run format:check` covers the directory (`.github/workflows/format.yml:22`)                                                                                           |

### 6.7 How the fixture API is meant to be used

Three processes, started by hand, in this order. The commands are the harness's own
(`fixture-api.mjs:15-21`, `lib/render.mjs:203-204`):

```sh
node --import tsx scripts/design/fixture-api.mjs 8799
cd apps/web && PICKLER_API_LOCAL_URL=http://127.0.0.1:8799 npx next dev -p 3001
DESIGN_BASE_URL=http://localhost:3001 node scripts/design/<check>.mjs
```

- Do not use `npm run dev`: Turborepo strips `PICKLER_API_LOCAL_URL` (`fixture-api.mjs:17-19`,
  `lib/render.mjs:215-216`).
- The port is inconsistent in the source: the file header and default say 8787
  (`fixture-api.mjs:21`, `:149`), the remedies say 8799 (`lib/render.mjs:203-204`).
- Optional overrides: `DESIGN_MARKETPLACE_URL`, `DESIGN_STUDIO_URL` (`lib/render.mjs:33-36`),
  `DESIGN_SESSION_COOKIE` (`lib/render.mjs:86-88`), `DESIGN_CHROMIUM` (`lib/render.mjs:155-157`).

What it serves: 12 endpoints, 11 in the table (`fixture-api.mjs:82-115`) plus analytics
(`:127-130`). Agents come from the harness's own fixtures (`:43`, `:60`). The market board and the
landing model are still the product's sample adapters, imported from `@pickler/infrastructure`
(`:38-42`, `:61-62`). That import is one of the live consumers of `createSampleMarketBoard` and
`createSampleLandingReadModel`, which matters for section 7d.

It also imports across a package boundary by relative path, from `workers/api/src/growth/*`
(`fixture-api.mjs:44-58`), which the root `AGENTS.md` forbids for product code.

What it does not serve: `/v1/launches`, and every studio, signing, profile and trading endpoint.
Unmapped paths answer 404 with a warning (`fixture-api.mjs:144-146`).

### Method

Read every file in `scripts/design` in full. Counted route entries by search. Checked every proof
selector in `routes.mjs` against the source tree by fixed-string search. Compared route names with
the shots left by the last run. Traced the session path through `guard.ts`, `studio.tsx` and the two
preview modules. Nothing was rendered.

```sh
lsof -nP -iTCP:3001 -sTCP:LISTEN          # nothing listening
grep -c '^    name: "' scripts/design/routes.mjs
grep -c 'product: "marketplace"' scripts/design/routes.mjs
grep -c 'surface: "dark"' scripts/design/routes.mjs
grep -n 'path: "' scripts/design/routes.mjs | sed -E 's/.*path: "([^"?]*).*/\1/' | sort | uniq -c

# routes with no shot from the last run
grep -n '^    name: "' scripts/design/routes.mjs | sed 's/.*name: "\(.*\)",/\1/' | sort > names.txt
ls scripts/design/shots | sed -E 's/-(desktop|phone)\.png$//' | sort -u > shot.txt
comm -23 names.txt shot.txt
comm -13 names.txt shot.txt

# stale proof selectors
grep -rnF 'tokens-empty' apps/web/src packages/ui/src
grep -rnF 'EVERY AGENT TOKEN' apps/web/src packages/ui/src

# wiring
grep -rn "scripts/design\|typecheck:design" package.json turbo.json .github
node --test scripts/design/colour.test.mjs scripts/design/levels.test.mjs
```

Not verified:

- The BLOCKED list is a prediction from the code and from the 2026-09-25 shots. No check was run.
- Whether the 7 routes added after the last run render.
- Whether the two `market-*-picked` clicks still land. Their labels hardcode `63,902.1`
  (`routes.mjs:258`, `:271`), which depends on the sample board's mark.

**Changed since the earlier inventory:** the 13 blocked routes are confirmed by name (5 that answer
404, 8 that need a session), plus 1 new: `/tokens`, whose proof selector went stale when main
replaced the token board with `LaunchBoard`. Total 14 of 50. The `tokens.mjs` claim is confirmed.
"Not in package.json or CI" needs a correction: the runtime checks and unit tests are not wired, but
`typecheck:design` is, through `turbo.json:23` and CI's typecheck step. The fixture API is at
`scripts/design/fixture-api.mjs`.

## 7. API and infrastructure leftovers

### 7a. `createSupabase*` adapters

11 `createSupabase*` exports exist in `packages/infrastructure`. `workers/api` uses 2 (both for
auth); the other 9 have no production importer anywhere in `apps/`, `workers/`, `packages/` or
`scripts/`.

Paths in the definition column are under `packages/infrastructure/src/`; test paths are under
`packages/infrastructure/`; the re-export column is a line of `packages/infrastructure/src/index.ts`.

| Export                             | Definition                                               | Re-export | `workers/api` production                                  | Other production | Tests                                                              |
| ---------------------------------- | -------------------------------------------------------- | --------- | --------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `createSupabaseJwtVerifier`        | `auth/supabase-jwt-verifier.ts:26`                       | `:34`     | `workers/api/src/container.ts:15`, `:359`                 | none             | `test/supabase-jwt-verifier.test.ts:5`                             |
| `createSupabaseAdmin`              | `supabase/supabase-admin-client.ts:16`                   | `:38`     | `workers/api/src/container.ts:14`, `:264`, `:269`, `:272` | none             | `test/wallet-accounts.test.ts:6` and the 3 admin-based tests below |
| `createSupabaseApiKeyDirectory`    | `supabase/access/supabase-api-key-directory.ts:17`       | `:43`     | none                                                      | none             | `test/supabase-access.test.ts:6`                                   |
| `createSupabaseWorkspaceDirectory` | `supabase/access/supabase-workspace-directory.ts:36`     | `:42`     | none                                                      | none             | `test/supabase-access.test.ts:7`                                   |
| `createSupabaseAgentRegistry`      | `supabase/agent-registry/supabase-agent-registry.ts:79`  | `:47`     | none                                                      | none             | `test/supabase-agent-registry.test.ts:7`                           |
| `createSupabaseAgentEventLog`      | `supabase/agent-registry/supabase-agent-registry.ts:138` | `:46`     | none                                                      | none             | `test/supabase-agent-registry.test.ts:6`                           |
| `createSupabaseBudgetSource`       | `supabase/agent-registry/supabase-budget-source.ts:7`    | `:49`     | none                                                      | none             | none (no test at all)                                              |
| `createSupabaseProfileRepository`  | `supabase/profiles/supabase-profile-repository.ts:28`    | `:62`     | none                                                      | none             | `test/supabase-profiles.test.ts:4`                                 |
| `createSupabaseRestClient`         | `supabase/supabase-rest-client.ts:20`                    | `:19`     | none                                                      | none             | `test/supabase.test.ts:7`                                          |
| `createSupabaseWaitlist`           | `supabase/supabase-waitlist.ts:16`                       | `:23`     | none                                                      | none             | `test/supabase.test.ts:8`                                          |
| `createSupabaseApplicants`         | `supabase/supabase-applicants.ts:50`                     | `:24`     | none                                                      | none             | `test/supabase.test.ts:6`                                          |

Test files that exist only for the unused adapters (4):

| Test file                                                      | Covers                            |
| -------------------------------------------------------------- | --------------------------------- |
| `packages/infrastructure/test/supabase-access.test.ts`         | workspace and API-key directories |
| `packages/infrastructure/test/supabase-agent-registry.test.ts` | agent registry and event log      |
| `packages/infrastructure/test/supabase-profiles.test.ts`       | profile repository                |
| `packages/infrastructure/test/supabase.test.ts`                | REST client, waitlist, applicants |

`packages/infrastructure/test/fixtures/applicant.json` is read only by `supabase.test.ts:13`, so it
goes with that test.

Blockers to deleting the files outright: three unused adapter files also export values that live
production code imports.

| Shared export                      | Defined in                                               | Production reader (`packages/infrastructure/src/`) |
| ---------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `placementSchema`                  | `supabase/supabase-waitlist.ts:6`                        | `persistence/growth-store.ts:13`, `:52`            |
| `applicantSchema`, `outcomeSchema` | `supabase/supabase-applicants.ts:13`, `:34`              | `persistence/growth-store.ts:12`, `:70`, `:91`     |
| `ANALYTICS_ROW_LIMIT`              | `supabase/agent-registry/supabase-agent-registry.ts:136` | `persistence/agent-registry.ts:12`, `:111`         |

These must move before the adapter files are removed. `supabase/wallet-accounts.ts`
(`createWalletAccounts` `:123`, `createAuthUserLookup` `:264`) is in the same folder but is live:
`workers/api/src/container.ts:263`, `:269`.

The documentation agrees with the code: `packages/infrastructure/AGENTS.md:9` states the API does
not use the Supabase data adapters, and `workers/api/AGENTS.md:331` forbids wiring one back in.
Both files need updating in the change that removes the adapters.

### 7b. Mera/PRF signer adapter

File: `apps/web/src/features/wallet/lib/signer-adapters.ts`. No `mera` package appears in any
`package.json` in the repository, so there is no SDK that could produce the account
`fromViemAccount` expects.

| Export                        | Line   | Production importers                                                                                                                  | Test importers                                                                     |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `PasskeyUnusableError`        | `:27`  | none outside the file (constructed inside it by `describeSignerFailure`; `wallet/lib/sign-in-words.ts:23` names it in a comment only) | `apps/web/test/sign-in-words.test.ts:4`, `apps/web/test/signer-adapters.test.ts:6` |
| `describeSignerFailure`       | `:60`  | `wallet/lib/sign-in-words.ts:2`, `:28`                                                                                                | `apps/web/test/signer-adapters.test.ts:7`                                          |
| `ViemAccountLike` (interface) | `:66`  | none outside the file                                                                                                                 | none                                                                               |
| `fromViemAccount`             | `:76`  | none                                                                                                                                  | `apps/web/test/signer-adapters.test.ts:4`, `:29`                                   |
| `fromInjectedProvider`        | `:100` | `wallet/lib/wallet-context.tsx:18`, `:291`                                                                                            | `apps/web/test/signer-adapters.test.ts:5`, `:49`                                   |

`fromViemAccount` is still test-only, and `ViemAccountLike` exists only to type it. The file as a
whole cannot go: `describeSignerFailure` and `fromInjectedProvider` are live. The PRF error path
(`PasskeyUnusableError`, `describeSignerFailure`) is reachable in production through
`sign-in-words.ts`, but with no Mera SDK installed nothing can throw the `MeraError` it recognises
(`signer-adapters.ts:50`). Comment-only mentions of Mera remain at `wallet/lib/connect.ts:1` and
`packages/infrastructure/src/chain/siwe.ts:56`.

### 7c. API routes and their web callers

Apps under `apps/`: `agent-service` and `web` only. **There is no mobile app in this repository.**
Workers: `api`, `indexer`, `research`, `trading`.

`workers/api/src/index.ts:9-19` exposes only `fetch`, delegating to `createApp`. Mounts are in
`workers/api/src/app.ts:45-68`. There are 82 distinct handlers; two route groups are mounted twice,
giving 127 reachable paths.

| Mount                             | `app.ts` | Handlers | Web callers |
| --------------------------------- | -------- | -------- | ----------- |
| `GET /health`                     | `:45`    | 1        | none        |
| `/v1/auth`                        | `:46`    | 1        | none        |
| `/v1/agents`                      | `:47`    | 6        | none        |
| `/v1/handles`                     | `:48`    | 1        | all         |
| `/v1/profile`                     | `:49`    | 2        | all         |
| `/v1/studio`                      | `:52`    | 34       | 29 of 34    |
| `/v1/console` (alias of studio)   | `:53`    | 34       | none        |
| `/v1/signing`                     | `:56`    | 13       | all         |
| `/v1/auth/wallet`                 | `:59`    | 4        | 2 of 4      |
| `/v1/launches`                    | `:62`    | 3        | 1 of 3      |
| `/v1` growth                      | `:65`    | 6        | 5 of 6      |
| `/v1/marketplace`                 | `:67`    | 11       | all         |
| `/v1/demo` (alias of marketplace) | `:68`    | 11       | none        |

The web reaches the API three ways: the server facade `apps/web/src/server/container.ts:22-62`
(through `apiJson` and `apiFetch`), browser `fetch` through the catch-all proxy
`apps/web/src/app/api/v1/[...path]/route.ts:3-7` (rewrites `/api/v1` to `/v1`, any method), and the
client wrappers `studio/api.ts`, `auth/lib/custody-api.ts`, `auth/lib/pickler-api.ts`.

Routes with no web caller: 18 handlers, plus the 2 alias mounts. Paths in the "Registered" column
are under `workers/api/src/`.

| #   | Method and path                               | Registered                  | Likely non-web consumer                                                               |
| --- | --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `GET /health`                                 | `app.ts:45`                 | platform liveness probe                                                               |
| 2   | `GET /v1/health`                              | `routes/growth.ts:31`       | monitoring; none found in the repository                                              |
| 3   | `GET /v1/auth/me`                             | `routes/auth.ts:11`         | ported from Relayer; none found                                                       |
| 4   | `GET /v1/agents`                              | `routes/agents.ts:34`       | workspace user or API key (Relayer port)                                              |
| 5   | `GET /v1/agents/:id/status`                   | `routes/agents.ts:38`       | agent HMAC (`agentScoped`, `middleware/agent-auth.ts:22-40`)                          |
| 6   | `GET /v1/agents/:id/analytics`                | `routes/agents.ts:42`       | agent HMAC                                                                            |
| 7   | `GET /v1/agents/:id/budget`                   | `routes/agents.ts:50`       | agent HMAC                                                                            |
| 8   | `GET /v1/agents/:id/audit`                    | `routes/agents.ts:61`       | workspace user or API key                                                             |
| 9   | `GET /v1/agents/:id`                          | `routes/agents.ts:71`       | workspace user or API key                                                             |
| 10  | `POST /v1/auth/wallet/link`                   | `routes/wallet-auth.ts:118` | none found; tested in `workers/api/test/wallet-auth.test.ts:304`                      |
| 11  | `GET /v1/auth/wallet/links`                   | `routes/wallet-auth.ts:125` | none found; tested at `:320`                                                          |
| 12  | `GET /v1/launches/:id`                        | `launches/routes.ts:37`     | none found                                                                            |
| 13  | `GET /v1/launches/:id/trades`                 | `launches/routes.ts:47`     | none found                                                                            |
| 14  | `POST /v1/studio/runs/:id/paper-order/settle` | `routes/studio.ts:663`      | none found (see the caveat on agent-service)                                          |
| 15  | `GET /v1/studio/agents/:id/paper-summary`     | `routes/studio.ts:676`      | none found                                                                            |
| 16  | `GET /v1/studio/agents/:id/trading/positions` | `routes/studio.ts:754`      | none found                                                                            |
| 17  | `GET /v1/studio/trading/orders/:id`           | `routes/studio.ts:767`      | none found                                                                            |
| 18  | `POST /v1/studio/runs/:id/live-order`         | `routes/studio.ts:820`      | none found                                                                            |
| A   | `/v1/console/*` (34 paths)                    | `app.ts:53`                 | none; `docs/specs/studio-create-and-fund-v1.md:29` records the rename to `/v1/studio` |
| B   | `/v1/demo/*` (11 paths)                       | `app.ts:68`                 | none; `docs/specs/marketplace-real-data-v1.md:306` lists retiring it as a step        |

Routes with a web caller, for completeness of evidence. Registered paths are under
`workers/api/src/`; callers under `apps/web/src/features/` unless they start with `app/` or
`server/`.

| Path                                                                     | Registered                                             | Web caller                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `GET /v1/handles/:handle/availability`                                   | `routes/profiles.ts:23`                                | `auth/lib/pickler-api.ts:81`, `studio/api.ts:338`, `wallet/lib/handles.ts:54`                    |
| `GET`, `POST /v1/profile`                                                | `routes/profiles.ts:37`, `:44`                         | `auth/lib/pickler-api.ts:85`, `:88`; `app/auth/callback/route.ts:37`; `wallet/lib/handles.ts:67` |
| `POST /v1/auth/wallet/nonce`, `/verify`                                  | `routes/wallet-auth.ts:77`, `:111`                     | `wallet/lib/connect.ts:41`, `:50`                                                                |
| `GET /v1/launches`                                                       | `launches/routes.ts:21`                                | `server/container.ts:25`                                                                         |
| `GET /v1/landing`                                                        | `routes/growth.ts:30`                                  | `server/container.ts:22`, `landing/lib/landing-data.tsx:44`                                      |
| `POST /v1/waitlist`                                                      | `routes/growth.ts:32`                                  | `landing/components/waitlist-form.tsx:36`                                                        |
| `GET`, `POST /v1/applications`                                           | `routes/growth.ts:33`, `:34`                           | `apply/components/application-form.tsx:97`, `:109`; `submitted.tsx:36`; `server/container.ts:62` |
| `GET /v1/tickers/availability`                                           | `routes/growth.ts:35`                                  | `apply/components/application-form.tsx:436`                                                      |
| `/v1/marketplace/*` (11)                                                 | `routes/marketplace.ts:27-56`                          | `server/container.ts:23`, `:37-56`                                                               |
| `/v1/signing/passkeys/*`, `/wallets/me` (6)                              | `routes/signing.ts:293-405`                            | `auth/lib/custody-api.ts:116-158`; `app/auth/callback/route.ts:38`                               |
| `/v1/signing/agents/*` (7)                                               | `routes/signing.ts:424-511`                            | `studio/api.ts:273-326`                                                                          |
| `/v1/studio/onboard`, `/me`, `/options`                                  | `routes/studio.ts:250`, `:254`, `:263`                 | `studio/create/create.tsx:210-213`, `studio/studio.tsx:207`, `:278`, `:282`                      |
| `/v1/studio/market-categories`                                           | `routes/studio.ts:268`                                 | `studio/studio.tsx:281` only                                                                     |
| `/v1/studio/preview-runs`, `/preview-runs/:id`                           | `routes/studio.ts:279`, `:306`                         | `studio/api.ts:107`, `:111`                                                                      |
| `/v1/studio/agents` GET, POST, `/agents/draft`, `/drafts`, `/agents/:id` | `routes/studio.ts:409`, `:426`, `:455`, `:481`, `:510` | `studio/api.ts:142`, `:126`, `:100`, `:115`, `:152`                                              |
| `PUT /v1/studio/agents/:id/config`                                       | `routes/studio.ts:530`                                 | `studio/studio.tsx:407` only                                                                     |
| `PUT .../limits`, `.../interval`, `.../schedule`                         | `routes/studio.ts:555`, `:565`, `:717`                 | `studio/api.ts:194`, `:188`, `:200`                                                              |
| `PUT .../pause`                                                          | `routes/studio.ts:711`                                 | `studio/studio.tsx:719` only                                                                     |
| `POST .../deposit/prepare`, `/confirm`                                   | `routes/studio.ts:583`, `:602`                         | `studio/api.ts:214`, `:220`                                                                      |
| `/agents/:id/runs` GET, POST; `/runs/:id`; `/runs/:id/events`            | `routes/studio.ts:616`, `:629`, `:651`, `:655`         | `studio/api.ts:156`, `:145`, `:161`, `:159`                                                      |
| `/runs/:id/paper-order` POST, GET                                        | `routes/studio.ts:684`, `:702`                         | `studio/api.ts:168`, `:165`; `studio/sections/picks.tsx:219`                                     |
| `.../trading/account`, `/orders`, `/check`, `/prepare`                   | `routes/studio.ts:736`, `:744`, `:779`                 | `studio/sections/trading.tsx:38`, `:39`, `:106`, `:152`                                          |
| `POST /trading/orders/:id/submit`                                        | `routes/studio.ts:800`                                 | `studio/sections/trading.tsx:197`                                                                |

Related dead wrapper: `updateConfig` at `studio/api.ts:177` has no importer in `apps/web/src` or
`apps/web/test` (it is in the unused-export list of section 3.2); the config route is called
directly at `studio/studio.tsx:407` instead.

### 7d. Sample data sources still served

| Source                         | Definition                                                                                                | Wired in production                                                 | Served at                                                                                                      | Web routes that show it                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `createSampleLandingReadModel` | `packages/infrastructure/src/landing/sample-landing-read-model.ts:55` (marks `source: "sample"` at `:61`) | `workers/api/src/growth/services.ts:36`                             | `GET /v1/landing` (`routes/growth.ts:30`)                                                                      | `/` (`app/page.tsx`), `/signin`, `/signup`, `/passkey` (the board beside the flow, `app/(auth)/*/page.tsx`)                      |
| `createSampleMarketBoard`      | `packages/infrastructure/src/markets/sample-market-board.ts:135` (data at `:6`, `:100`)                   | `workers/api/src/growth/services.ts:39`                             | `GET /v1/marketplace/markets`, `/markets/:symbol` (`routes/marketplace.ts:48`, `:49`) and the `/v1/demo` twins | `/markets`, `/markets/[symbol]`                                                                                                  |
| `createInMemoryApplicantStore` | `packages/infrastructure/src/applicants/in-memory-applicant-store.ts:29`                                  | not wired                                                           | none                                                                                                           | none; tests only (`packages/infrastructure/test/in-memory-applicant-store.test.ts:3`, `workers/api/test/growth-route.test.ts:9`) |
| `SAMPLE_AGENT_TICKERS`         | `packages/infrastructure/src/landing/sample-landing-read-model.ts:34`                                     | re-exported at `packages/infrastructure/src/index.ts:12`, no reader | none                                                                                                           | none                                                                                                                             |
| `createSampleAgentDirectory`   | `scripts/design/fixtures/sample-agent-directory.mts:752`                                                  | not in the worker                                                   | design fixture API only (`scripts/design/fixture-api.mjs:43`, `:60`)                                           | only when the web app is pointed at the fixture API                                                                              |

Both wired sample sources are deliberate according to the code comments
(`workers/api/src/growth/services.ts:35`, `:38`). The landing footer labels the data:
`landing/components/footer.tsx:20` renders "SAMPLE DATA" when `source === "sample"`. Every other
growth adapter is Postgres-backed (`growth/services.ts:37`, `:40`, `:41`), and the launches read
model is `PostgresLaunchReadModel` (`workers/api/src/container.ts:384`).

Web-side fixtures, not served by the API but shipped in the bundle:

| Fixture                                            | Definition                             | Reader                                                        | Gate                                                                     |
| -------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `homeFixture`, `draftFixture`                      | `studio/home/fixture.ts:108`, `:182`   | `studio/studio.tsx:44`, `:160`                                | `studioPreview` / `previewAllowed` (`studio/preview.ts:219`, `:224-225`) |
| `briefFixture`                                     | `studio/brief/fixture.ts:69`           | `studio/studio.tsx:42`, `:162`                                | same                                                                     |
| `studioPreview`, `previewOptions`, `previewConfig` | `studio/preview.ts:224`, `:210`, `:33` | `studio/studio.tsx:29`, `:229`; `studio/create/create.tsx:39` | `NODE_ENV` and auth configuration                                        |
| `accountPreview`                                   | `account/lib/preview.ts:44`            | `account/account.tsx:31`                                      | `previewAllowed` (`:39`, `:45`)                                          |

The body of `previewAllowed` was not read, so the exact condition (which `NODE_ENV` values, and how
auth configuration combines) is unverified.

### Method

All searches used `git grep` over tracked files in `apps`, `workers`, `packages` and `scripts`,
excluding Markdown where noted. Route registrations were collected by pattern, then each path was
searched for in `apps/web/src`, and each client wrapper was checked for at least one importer.
Importers of the signer adapter's exports were confirmed with the type-checker program of section
3.2.

```sh
# 7a: definitions, then every reference outside the adapter folder
git grep -nE "export (async )?(function|const) createSupabase\w*" -- packages workers apps scripts
git grep -nE "createSupabase\w*" -- packages workers apps scripts ':!packages/infrastructure/src/supabase/*'
grep -nE "^export " packages/infrastructure/src/supabase/*.ts packages/infrastructure/src/supabase/*/*.ts
for n in placementSchema applicantSchema outcomeSchema ANALYTICS_ROW_LIMIT; do
  git grep -nw $n -- apps workers packages scripts ':!*.md' ':!packages/infrastructure/src/supabase'
done

# 7b: signer adapter
git grep -nIE "fromViemAccount|Mera|\bPRF\b" -- packages workers apps scripts ':!*.md'
git grep -n "mera" -- '*package.json'

# 7c: registrations, then web path strings
git grep -nE "\.(get|post|put|patch|delete|all|route|use)\(\s*[\"'\`]" -- workers/api/src
git grep -nE "v1/|/(studio|console|marketplace|demo|signing|launches|handles|landing|waitlist|applications|tickers)/?" -- apps/web/src ':!*.css'
git grep -nE "studioApi(<[^(]*>)?\(" -- apps/web/src
for p in "paper-order/settle" "paper-summary" "trading/positions" "trading/orders/" "live-order" \
         "auth/wallet/link" "/auth/me" "v1/health" "/v1/agents" "v1/console" "v1/demo" "launches/"; do
  git grep -nF -e "$p" -- apps workers packages scripts ':!workers/api/src' ':!workers/api/test' ':!*.md'
done

# 7d: sample sources
git grep -nE "createSample\w*" -- packages workers apps scripts
git grep -nw createInMemoryApplicantStore -- apps workers packages scripts ':!*.md'
git ls-files apps/web/src packages workers | grep -iE "sample|fixture|mock|demo|preview"
```

Caveats:

- The proxy at `app/api/v1/[...path]/route.ts` forwards any path, so "no web caller" means no
  string in `apps/web/src` builds that path. A path assembled from variables would be missed; none
  was found, but the search is textual.
- The registration pattern matches a quoted first argument on the same line. The two trading routes
  built in a loop (`workers/api/src/routes/studio.ts:778-779`) were found by reading the file.
- Some web callers live only in `studio/studio.tsx` (`market-categories`, `PUT config`, `pause`).
- `apps/agent-service` defines routes with identical names
  (`apps/agent-service/src/api/app.ts:134`, `:146`, `:196`, `:219`, `:238`) and its CLI calls them
  at `http://127.0.0.1:4111/pilot` (`apps/agent-service/src/cli.ts:131`). That is its own server,
  not `workers/api`, so it does not count as a consumer of rows 14 to 18.
- Consumers outside this repository (a phone app, an agent SDK, uptime monitors) cannot be seen from
  here. The HMAC attribution for rows 5 to 7 comes from the middleware, and
  `packages/core/test/agent-registry.test.ts:199-221` signs `/v1/agents/...` paths, including
  `/v1/agents/events/batch`, which is not registered in `workers/api` at all.

**Changed since the earlier inventory:** unused Supabase adapters unchanged at 9, with the same 4
dedicated test files. New detail: 3 of the adapter files also export schemas or constants that live
Postgres code imports, and `createSupabaseBudgetSource` has no test. `fromViemAccount` is still
test-only, and `PasskeyUnusableError` has no production importer either. API handlers with no web
caller are 18 rather than 14, plus the `/v1/console` and `/v1/demo` alias mounts; the growth comes
from the merged launchpad (`/v1/launches/:id`, `/:id/trades`), wallet linking (`/link`, `/links`)
and trading (`trading/positions`, `trading/orders/:id`, `live-order`), though which routes made up
the earlier 14 is not recorded. Both sample sources are still served. There is no mobile app under
`apps/`.

## Open questions

1. **The veils and the glow rim are not backdrop.** `--pk-space-veil`, `--pk-space-veil-strong`
   (7 live reads in `/apply`), `--pk-space-edge-rgb` (`markets/markets.module.css:1028`) and
   `--pk-glow-rim` (the shared glow button, the auth primary button, the apply pixel) cannot be
   removed with the sky as the cleanup spec (3.1) says. Which v2 token does each veil become, and
   does `--pk-glow-rim` stay as part of the system?
2. **Literals with no v2 base colour.** 29 live literals (24 in `apply`, 5 in `auth`) are alphas of
   `#F5F6FF`, `#5AD8FF` or `#F3F1EC`, none of which is in the palette. D6 assumes every literal is
   an alpha of a token colour. Do these become `--pk-rule` / `--pk-rule-strong` / `--pk-panel`
   (which changes how the screens look), or new tokens with old values?
3. **Seven carried-forward tokens have no single v2 equivalent** and are used 131 times. D5 keeps them; do
   the five `-edge` tokens and `--pk-border-strong` get new names, given that "edge" and "border"
   are not v2 words?
4. **`--tint-fg`, `--tint-bg`, `--tint-bd`** are un-prefixed and live in `styles.css`. Rename to
   `--pk-tint-*`, or exempt them in the static check?
5. **Variant-scoped variables (35)** hold colours chosen by a `data-*` attribute. The cleanup spec
   (3.2) allows a local variable only for a non-colour value. Rewrite each as one rule per variant,
   or allow the pattern?
6. **`apply/lib/options.ts` offers applicants `#5AD8FF`, `#F5F6FF` and `#A9B0D0`** as agent colours,
   and submitted applications may already hold them. Are those three swatches removed, remapped or
   given tokens?
7. **Two brief editors.** `studio/sections/brief.tsx` is what an existing agent's Brief row opens;
   the `studio/brief/` folder is reachable only before the first agent exists. D8 removes the old
   one "if `brief/` supersedes it": it does not yet.
8. **The empty studio rail names three sections that do not exist** (Console, Trades, Sources &
   rules). Is the Studio Empty v4 canvas or the section key list the authority?
9. **`trading` has no section key**, so `?section=trading` is refused and the harness cannot open
   it. Does it become a rail section or stay a panel of Limits & funding?
10. **`/console`** is refused by both production hosts and linked from nowhere. The cleanup spec
    removes no route a person can reach; this one cannot be reached in production. Remove it?
11. **`/v1/console` and `/v1/demo` alias mounts** (45 paths) have no caller in this repository.
    D12 keeps API routes; are the aliases covered by that, or are they the retirement
    `marketplace-real-data-v1.md:306` already lists?
12. **Which local setup is normal for the harness?** `scripts/design/routes.mjs:7-8` says Supabase
    is unconfigured wherever the checks run; `studio/home/stage.ts:10-11` says the local server has
    it configured. D10's "zero blocked routes" depends on the answer, and the fixture API serves no
    `/v1/launches`, studio, signing, profile or trading endpoint today.
13. **Test-only exports (46).** The cleanup spec (3.3) removes an export used only by a test along
    with the test, unless the test pins behaviour the product still has. Most of the 46 are
    constants and pure functions used inside their own file, whose tests do pin live behaviour.
    Proposed reading: keep those, and remove only the ten that are unused in their own file.
14. **The rise of dead classes in `auth` (55 to 59)** was not traced. If it matters which commit
    orphaned them, that is a `git log -S` per class.
