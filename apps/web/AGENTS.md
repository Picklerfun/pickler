# Web app instructions

Read the root and affected dependency AGENTS.md files before changes. Keep documentation in English.

## Responsibility and structure

Next.js owns presentation and authentication transport. Hono in `workers/api` is the only
business API. All web API requests use the same origin and delegate through a Service Binding.
The web has no database, provider-secret, Mastra or infrastructure dependency. Public Supabase
Auth values are the exception: authentication uses its publishable key in the browser/callback.

```text
src/app/
  api/v1/[...path]/route.ts # Transport-only delegation; no business decisions
  auth/callback/route.ts    # Supabase code exchange, cookies, return to studio
  studio/page.tsx           # The studio: opens on the home; no agents opens its empty state
  studio/new/page.tsx       # Creating an agent: `?step=` names the screen
  (auth)/                  # Existing signup/signin design
  apply/                   # Creator application using API-backed cookie access
  agents/, tokens/, reads/  # Existing public demonstrations
  markets/                  # The perpetuals board and one market's level × time surface
src/features/studio/       # Studio sections, history, research result and API client
src/features/studio/create # Creating an agent: describe, seven steps, review, passkey ceremony, first run
src/features/studio/home   # The home after the first run: status, wallet and deposit, schedule, picks
src/features/markets/      # Surface, trade ticket, ask ticket and the ticket's own arithmetic
src/server/
  api-client.ts            # API Service Binding; explicit loopback-only next-dev fallback
  container.ts             # Typed presentation facade over HTTP DTOs
  http/apply-cookie.ts     # Read the incoming cookie for the application page
  http/auth-board.ts       # Presentation formatting only
```

Landing, signup, applications, token pages, paid reads, wallet and ranking designs are retained.
The marketplace reads `/api/v1/marketplace/*`: agents come from the database, the perpetuals board
is still sample content, and research results never appear there automatically. `/api/v1/landing` keeps its polling behavior. Hono sets the HttpOnly,
Secure `pk_apply` cookie; the web only transports it. Never put that bearer token in URLs or JSON.

## Three-layer implementation example

For a new business operation, implement the domain rule/use case/port in `packages/core`, the
PostgreSQL/provider adapter in `packages/infrastructure`, and the Hono handler in `workers/api`.
Compose adapters in that Worker. Publish runtime-validated HTTP DTOs from `packages/api-schema`.
The web adds a form and calls `/api/v1/...`; it does not duplicate the authorization or use case.

```text
packages/core/src/features/example/          # Framework-free business operation and ports
packages/infrastructure/src/example/         # Concrete adapter with validated external data
packages/api-schema/src/example.ts           # Request/response wire contract
workers/api/src/routes/example.ts            # Verified actor, DTO parsing, use-case call
apps/web/src/features/example/               # Form, loading/error states and DTO rendering
```

This is a proposed example, not an existing example feature. Use public workspace exports,
never cross-package relative source imports. Server-only presentation facades remain protected
with `server-only`. ESLint disallows core/infrastructure imports throughout the web app.
Client validation improves feedback; API validation and core authorization remain authoritative.

## Commands and checks

Use root `npm run build:shared`, lint, typecheck, tests and build. `npm run dev` starts Next.js;
set the explicit loopback PICKLER_API_LOCAL_URL when using a separately running local API.
Public Supabase Auth values are supplied at build time. No provider or database credentials
belong in `.env` here. The final deployment must be tested using OpenNext/workerd, not only
next dev. Check cookies, protected routes, session refresh, signout and tenant isolation.

## Design system

Shapes, control sizes and button variants live in `@pickler/ui` (see its `AGENTS.md`): one radius scale from `mark` to `3xl` in which a step names a role — chips and tiles, menu rows, stat tiles, cards, panels, sections — and a pill for every action, chip and status. Feature stylesheets reference the `--pk-radius-*` tokens and never hard-code a radius. Each shell declares its surface: the marketplace — landing, apply, the public pages — uses `data-surface="light"`, and the studio, account and auth screens use `data-surface="dark"`. Either value nests inside the other to invert a subtree. Type is the same on both: Archivo for titles and the lead figure of a view, always with its width axis (`font-variation-settings: var(--pk-display-wdth)`), and Instrument Sans for everything else — body text, every control, and the small tracked labels that used to be a monospace.

Controls come from `@pickler/ui`: `Button`/`ButtonLink` for actions (`glow` is the lit marketing call to action — the hero, the waitlist, the application), `Chip` for filters and toggles (`ChipLink` when it navigates, `ChipText` when it only reads), `Segmented` for an exclusive choice that is always on screen, `Tag` for read-only status, `Meter` for a filled track, `Icon` for every icon. Feature stylesheets keep only what a control does differently and pass it through `className`; they do not re-declare shape, type or state. Colour is the same: each sheet aliases the system tokens (`--ink: var(--pk-ink)`) and holds no literal. Panels take the shared surface with `composes: pk-panel from global` instead of redeclaring a border and a radius.

Market data is drawn with `CandleChart` and `BarChart` from `@pickler/ui` — the price panel on a token page and every series under the leaderboard. Features hand them timestamped buckets and nothing else; colours and type come from the surface. The library's own logo is off, so `PublicShell` carries the TradingView credit its licence asks for; any new surface that shows a chart needs that credit too.

## The wallet

`features/wallet/` owns the connection. `lib/signer.ts` is the contract the rest of the site talks to — address, chain, balance, connect, disconnect — and one adapter implements it. `injected-signer.ts` is the EIP-1193 conversation with the browser wallet, with no connector library: it asks for accounts, reads the chain and the native balance, follows `accountsChanged` and `chainChanged`, and offers to switch to Monad testnet using the metadata in `@pickler/chain`.

`connect` is for a wallet the person already had, and that is all it is for. The person's own Pickler wallet is not a signer here: it is custodied in Turnkey, the key stays in the enclave under their passkey, and the site reaches it through the signing API. Nothing in this app derives or holds a private key, and no new signer may. The PRF path that used to do so (`mera-signer.ts`, over `@category-labs/mera`) is retired: it asked for whichever passkey the person had for `pickler.fun`, which once Turnkey passkeys exist on that host means taking a credential that authorises activities and turning it into key material.

The account menu names which wallet you are looking at, so a portfolio is never shown without saying whose it is. A signer without a chain of its own is never "on the wrong network", so `onTargetChain` is true for it and `canSwitchChain` is how a page asks whether the verb exists at all.

`connect(holding?)` opens the chooser rather than prompting a wallet directly, and `holding` is what the person was about to do — the modal keeps it in front of them while they pick, the way the app's own sign-in screen does. There is no "unsupported" state: a browser with nothing to connect still opens the chooser, which names what is missing on each choice rather than presenting a dead button.

It never signs or sends anything — connecting is a read that tells the site which address to show a portfolio and a read history for.

**Connecting is not signing in.** The creator account at `/signin` is for people building agents; the wallet is for people reading and backing them. Do not fold one into the other.

A wallet session belongs to one address. `lib/wallet-session.ts` keeps the token with the address and chain family it was issued for (`WalletSession`), and `decideSession(cached, connected, now)` is the only thing that hands it back: the same address with a token more than `EXPIRY_MARGIN_MS` from its `exp` reuses it, a different address or an expired or unreadable token signs again, and nothing connected has no session. `wallet-context.tsx` lets go of the session when the account changes or the wallet disconnects (a change of chain keeps it), and `dropWalletSession` signs the shared Supabase client out locally only when its session is still that wallet account's, so a studio session is never ended by a wallet switch. `session` on the context is derived from whose session is held, never stored. `signInWithWallet` answers `{ token }` or `{ error }` (`lib/wallet-sign-in.ts`, `signInAs`; `error: null` is a closed prompt), and a caller shows the error from that result — `sessionError` read after the await is the value of the render the call started in.

Three pages only mean something for a connected wallet — `/portfolio`, `/activity` and `/reads` — and they say so through `ConnectGate` rather than showing an empty table. Following an agent is kept in the browser against the address, so a different wallet in the same browser has a different list and nothing about it reaches a server.

What is real today: the address, the chain and the native balance. What is not: agent tokens, because the launcher contracts are not deployed, which is what the portfolio says instead of showing a zero. Paying for a read needs those contracts too, so the ask flow connects a wallet and then stops at a disabled Pay with the reason on it. The trade panel reads the same way: Connect wallet is live and lime, a wallet on the wrong network is offered the switch, and only once both are right does the button become the trade that the missing contract disables.

## One navigation bar

`features/site/site-nav.tsx` is the navigation for every public route, landing included: the same brand, the same Explore / Build / Resources menus, the same height. Only two things change. The landing hangs the price tape above it, and nowhere else does. The explore routes — everything inside `PublicShell` — also carry the wallet: CONNECT WALLET beside JOIN TESTNET, and once connected the address, its balance, and the three pages that only exist for it.

The apply flow and the auth screens keep their own bar on purpose — a flow that is asking for something should not offer six ways out of it — but the bar is the same height as the navigation and carries the same brand, so only the right-hand side differs. The brand mark is lit in cyan on every surface, the flows included. Lime stays for what the product does — a filled action, a win, a graduated token — not for who made it.

## Markets

`/markets` lists every perpetual market on Perpl and `/markets/[symbol]` is one of them: a grid of
price levels crossed with how long you give a position. One square, two meanings. Under **Trade**
it is a position of your own money — above the mark a long, below a short — and under **Ask** the
same square is a paid read. The tab is the only thing that changes; the surface is shared, which is
the point of the page.

Ask moves the level and never the clock. Every read still resolves `READ_HORIZON_DTO` after
delivery, so the shorter columns are dimmed under Ask and the banner says why: two answers are only
comparable when they were asked over the same distance in time. The question itself comes from the
DTO (`readQuestion`, written by core) with the level filled in — a page never phrases a read.

The ticket is built in full and then stops. Connecting a wallet is live, switching to Monad testnet
is live, Review costs nothing and is ours — and **Sign and send** is disabled with the reason on
it, because Perpl's contracts are not deployed and this site's wallet never signs. What a sent
order would look like afterwards (no Perpl account, sent, filled, not filled) lives behind an
explicit **design preview**, and every one of those panels carries `DESIGN PREVIEW · NO ORDER
EXISTS` on its face. Never let one of them read as a position: nothing here has touched a chain.

`features/markets/lib/ticket.ts` holds the preview arithmetic — size, liquidation, fee, the phrase
— against the mirrored limits in `@pickler/api-schema`. It moves to core when an order is really
sent. `lib/format.ts` owns every number the surface and the ticket print, so a price is written the
same way in both.

The phone gets the same two screens, not a reduced pair: the grid keeps its nine levels and four
columns and gives up the trail column instead, and the ticket moves under the surface. A market is
the one page where a smaller screen must not mean fewer squares.

## Paid reads

An agent sells one thing publicly: a read. Someone picks one of its markets, pays, and gets back a probability with the reasoning, the sources and the limits under it. The question is never written by the person asking — every read asks whether the named market is above its price at delivery 24 hours later — which is what makes two answers comparable and an agent's record meaningful. `readQuestion` in core writes it; the DTO carries it so a page never re-derives it.

Two clocks run per read and they are separate in the UI as well as the data. Delivery is what the agent owes inside its stated window, and the money returns if it misses. Evaluation is what the market did afterwards; `not_evaluable` is an honest gap and counts neither way. Asking is violet everywhere it appears, so it never reads as backing the token.

Nothing charges yet: the pay button carries the note rather than pretending. A read is not a trading permission, and the copy says so on the review step and on the card.

## Dashboard and the public site

The private creator studio lives at `/studio` and calls the Hono API. The studio lived at `/console` until 2026-09-25; no redirect is kept because nobody had launched. The public surface retains landing, `/apply`, auth screens, `/tokens`, `/agents`, `/reads` and `/leaderboard`. Keep private research and public demonstration data separate; share visual components without automatically publishing results.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Unified API transport and private studio

`src/server/container.ts`
is now a typed API client facade. No core or infrastructure dependency is permitted anywhere
in this app. `src/app/api/v1/[...path]/route.ts` delegates requests through the API Service
Binding; the explicit loopback-only fallback is for local development. Cookies and JWT headers
are transported, never interpreted as workspace authority by the web Worker. Hono validates
identity and owns business decisions. Only public Supabase Auth configuration reaches the web.

`features/studio` and `/studio` provide private agent configuration, manual research, schedule
and pause controls, history and evidence. Reuse the existing shared control system with
`data-surface="dark"`. API mutation errors remain explicit; do not automatically retry paid
research. Reuse an idempotency key after an uncertain admission response. Poll pending/active
research every three seconds, stop at terminal status, suspend in hidden tabs and clean up
requests/timers on navigation. Results are not added to the public sample directory.

The auth callback exchanges a Supabase authorization code and redirects once, from what the account
holds (`callbackDestination` in `features/auth/lib/callback.ts`): no master wallet →
`/signup?step=passkey` whatever the profile, a wallet and no profile → `/signup?step=handle`, both
→ the studio, and a failed read → `/signup`, which reads again. Studio onboarding idempotently
provisions a workspace. Provider access
remains operator-enabled, separate from authentication. The completed signup screen links to
^the studio; public wallet/token/read demonstrations retain their existing design and limits.

## Worker build

OpenNext 1.20.6 adapts the existing Next.js build. Use `npm run build:worker --workspace=@pickler/web`;
`wrangler.jsonc` binds API and static assets. No shared incremental cache is configured. Test the
compiled Worker and same-origin auth/cookies before deployment. See ../../docs/cloudflare-staging.md.

Worker branch previews use the explicit `previews` block in `wrangler.jsonc`. They retain the
production Next.js runtime mode but deliberately have no service bindings, including API and
self-reference. They validate the web build and presentation only; backend routes and features
requiring those bindings are unavailable. A successful preview is not full-stack acceptance.

## Studio integration

The private studio uses the Studio shell and sections under `features/studio/sections`, reached
from the home's Menu.
Keep the existing backend permissions: research enablement is required to create or edit agents,
not just to run them. Agent creation selects the ID returned by the API, never an array position.
The create request carries the public profile, built by `toCreate` in `create/draft.ts` (accent from
the draft, the edge as the blurb, the venue from where it trades).
Swatches paint from `accentVars`, never from a hue name typed into a token.
`features/studio/lib/polling.ts` coordinates cancellable read requests. Refresh active runs and
the selected trace every three seconds; stop when terminal unless scheduling needs discovery.
Abort on page hiding, agent changes and unmount. Mutations trigger an immediate read refresh.
Never retry paid mutations automatically. `apps/web/test/*.test.ts` is included in the root suite;
run its controlled-clock regression tests with `node --import tsx --test apps/web/test/*.test.ts`.

## The new creation flow's pure logic

`features/studio/create/draft.ts` is the "Pickler Create First Agent v2" canvas's rules with no
React and no transport: the `Draft` the Describe screen and seven manual steps (`name, trades,
looks, reads, skills, decides, review`, `ORDER`) build up, `ready(step, draft)` for each step's
gate, `soonRows` for the Soon venue/beat rows that block Review, the six `reviewRows` and their
text builders (`readsText` is exported; `tradesText`, `callsText`, `skillsText` and `decidesText`
are private to the module), `fromApiDraft`
to fill the form from `POST /v1/studio/agents/draft`, `addSite`/`toggleIn` for the reads and looks
steps, and `toCreate(draft, walletId, defaults)` for the `POST /agents` body, following the same
`{ ...defaults, ... }` shape core's `draftToConfig` builds (`defaults` is `/options`'s answer).
The web cannot be turned off in this plan, so there is no `webOn` field, only `webMode`.

`SOON_VENUES`, `SOON_BEATS`, `SPORT_SUB_IDS`, `STYLE_POLICIES` and `SUGGESTED_SKILLS` inside this
file are literal copies of the same-named exports in `@pickler/api-schema` (`src/studio.ts`), not
imports of them: `apps/web` is CommonJS to node's module resolver and `@pickler/api-schema`
publishes only an `"import"` condition, so a module that reads its values at load time cannot be
required by a `node:test` here — the same constraint `features/wallet/lib/handles.ts` documents.
Only types cross the boundary (`import type`), which cost nothing because they are erased before
this ever runs. Core is the one authority for all five; api-schema's copies are pinned against it
by `workers/api/test/accent-venue-mirror.test.ts`, and this file's five copies are exported and
pinned against api-schema's own values by a test in `studio-create-draft.test.ts` that reaches
api-schema with a dynamic `import()` — the one way that test file can still resolve a package
publishing only an `"import"` condition, since a dynamic import always goes through node's ESM
loader even from a CommonJS file, unlike this module's own static `import`.

`api.ts` adds thin, untested-beyond-typecheck fetch wrappers for the rest of the creation and
funding surface: `draftAgent`, `createAgent`, `studioAgent` (`GET /agents/:id`), `agentRuns`,
`startRun`, `runEvents`, `run`, `paperOrder` and `readPaperOrder` (its `GET`), `updateConfig`,
`setIntervalHours` (`PUT /interval`, which keeps the version), `saveLimits`, `setSchedule`,
`depositPrepare`/`depositConfirm`, and
the passkey ceremony under `/v1/signing/agents` (`agentState`, `prepareDelegated`/
`confirmDelegated`, `prepareWallet`/`confirmWallet`, `preparePolicies`/`confirmPolicies`) plus the
public `handleAvailable`. The signing and handle routes answer Relayer's envelope
(`{ success, message, data, ... }`); `envelopeApi` unwraps it into the same `StudioError` the
plain-JSON studio routes throw through `studioApi`, so a caller branches on `errorCode` the same
way regardless of which family a request belongs to.

## Creating an agent

`/studio/new` is the only place an agent is created. `/studio` no longer sends a person with no
agents there: they land on the empty home and choose to go (the old stepped flow and `AgentForm`
are gone). `create/create.tsx` owns the
screen: a `useReducer` over `flowReducer` (`create/flow.ts`, pure and tested in
`studio-create-flow.test.ts`) holding the `Draft`, the screen, `auto`/`manual` mode and the Edit
snapshot that Cancel restores. `?step=` mirrors the screen through `router.replace`; `describe` is
the first screen's URL name. Outside production a link past Describe opens on the canvas's example
draft (`sampleDraft`) so the design harness has every screen to measure — one route per step in
`scripts/design/routes.mjs`, each proving `#create-<step>`. Without Supabase configured it renders
from the preview options and says so; nothing can be drafted, checked or created there. Outside
production, a browser that reached the screen with no Supabase session (the middleware lets a
request through on the cookie's name alone) renders the same labelled preview on `previewOptions()`
instead of redirecting to `/signin`; in production it still redirects. That is what the design
harness sees: `scripts/design/lib/render.mjs` adds a dummy `sb-<project-ref>-auth-token` cookie,
named from `NEXT_PUBLIC_SUPABASE_URL` (or `DESIGN_SESSION_COOKIE`), to studio routes on a loopback
base URL only. It passes the middleware's presence check and is not a session: the API still
refuses every call behind it. The reading screen opened by a deep link on the sample draft is held
(`FlowState.held`): every row shows at once and it does not run on to the review, so it can be
measured. Reached from Describe with a real draft, it reveals and advances as before.

One component per screen, each with its own id: `describe.tsx`, `reading.tsx` (reveals
`reviewRows` one per 620 ms, then review), `name.tsx`, `trades.tsx`, `looks.tsx`, `reads.tsx`,
`skills.tsx`, `decides.tsx`, `review.tsx`, `first-run.tsx`, and `stack.tsx` for the block stack
beside them. `map.ts` holds the canvas's copy and lists and may read `@pickler/api-schema` values,
because only bundled screens import it. Soon venues and beats are drawn and cannot be chosen; a
model draft that chose one reaches the review with the row flagged and creation off. The handle is
checked against `/v1/handles/:handle/availability` wherever it changes, debounced, so a model's
suggestion is checked too. "Set it up from my line" calls `draftAgent`; `DRAFT_UNAVAILABLE` sends the
person to the manual steps with "The model is busy. Build it step by step instead."

`create/ceremony.ts` is "Create and run it once" as a sequence, pure and pinned in
`studio-ceremony.test.ts`: `wallet` (add the delegated user if there is none, then the wallet named
for the handle, or reuse the `existing` one an earlier attempt left), `rules` (policies; skipped
when that `existing` wallet comes back with `policiesApproved`, so a retry after a reload never
writes the rules twice), `agent`, `run`. It never creates a sub-organization: without one it throws
`NoSubOrganization` before any prompt and the screen sends the person to the signup's passkey step. A first agent
is three passkey prompts (delegated user, wallet, policies), a later one two; any failure
propagates and stops the sequence. `onFirstAgent` tells the screen which, so the rail's Wallet line
says it covers two prompts on a first agent. The screen stamps with `WebauthnStamper`, whose `rpId` comes from the passkey challenge's `rp.id`.
Idempotency keys for the create and the run are kept per draft, and `runCeremony` carries a
`CeremonyProgress` (wallet, approved policies, agent, run) across retries, so "Try again with your
passkey" resumes where the attempt stopped: a failed run start retries only the start, a refused
create retries only the create, and neither asks for the passkey again. Leaving the screen aborts
the ceremony between prompts. `create/gate.ts` is pure and pinned in `studio-create-gate.test.ts`:
`createGate(agents)` answers `{ open: true }` or `{ open: false, agent }` (one unfunded agent at a
time, from each agent's `canCreateAnother`, naming the first below 10 AUSD). The create screen
reads `GET /agents` (`studioAgents`) on load and, when closed, shows `locked.tsx`
(`create-locked`: "Fund <name> first.", "One unfunded agent at a time.", a button to the studio
opened on that agent, `gateHref(agent, useStudioHref())`) instead of the flow; "Create and run it once" goes through
`startIfOpen`, which reads the agents again and never starts the ceremony through a closed gate.
That gate is the funding lock only, and a private draft is never the agent it names: a draft has
no wallet to fund. The API's other reason, `draft_limit` (three drafts), closes only the making of
drafts, so `/studio/new` stays open at three. The menus' "+ New agent" (the home's Menu and the
shell's) read `newAgentGate(agents)` / `newAgentLock(agents)`, which answer funding first
("Fund <wallet agent> first. One unfunded agent at a time.") and then the draft limit ("At most 3
drafts at a time."); `menuAccess` orders the reasons research, view-only, funding, draft limit. A
409 `DRAFT_LIMIT` on the brief's create reads the same sentence (`lib/messages.ts`).
An attempt that already created its agent, and a preview, skip the gate. The shell's agent-switcher
"New agent" item is disabled with the same note. `createAgent` in `api.ts` shows the server's own
message for `CONFLICT` and `NOT_FOUND` ("Approve the wallet's rules first", "That wallet already
belongs to an agent", "Wallet not found"), which `StudioError.serverMessage` carries.
`first-run.tsx` draws the four steps as the rail's first lines, then polls
the run's events and status every 1.5 s through `startPolling` until terminal, creates the paper
order once for a completed TRADE (`paperOrder(runId, runId)`), and after 20 s still queued shows
"Waiting for a runner" with `npm run dev:agent`. `trace.ts` turns events into those lines.

## The studio home

With no agents, `/studio` opens on `home/empty.tsx` (`EmptyHome`, `#home-empty`), drawn from the
"Pickler Studio Empty v4" canvas: a top bar with the dashed "No agent yet" chip, TESTNET and the
profile; the studio rail with every section disabled ("After you create your agent"); and the first
agent's brief — its five sections (thesis, reads, enters, exits, never) drawn blank as prompts, a
"Starting point: Blank" card and an idle paper run beside it, the second-passkey suggestion above it.
The canvas edits the brief and runs it on paper in place; neither has a backend (the brief is not
the `/studio/new` draft, and a scripted run would be fake), so "Create your first agent" goes to
`/studio/new` (disabled with the reason when research is not enabled or the person cannot manage)
and "Start from: a ranked agent" goes to `/agents`. Below 860px the rail is hidden and the Menu
appears in the top bar instead. `HomeMenu` takes `agent: null` then: "+ New agent" is open
(`createGate([])`) and every section is listed disabled with "After you create your agent".
`home/access.ts` holds that decision, pure: `menuAccess` answers whether sections open and whether
"+ New agent" is a link, with one reason (research access, then view-only, then the unfunded-agent
lock), and the empty home's button and rail read the same answer.
Creating the draft and opening it are two steps: once `createDraft` answered, a failed reload reads
"Created {Name}. Couldn't load it · reload" on the button, and a press only reloads, never creates a
second draft (`createPress` and `createdLabel` in `brief/model.ts`, pinned in `studio-brief.test.ts`).
`lib/landing.ts` decides the screen: `studioLanding(loaded, agents, section)` is `home` or `section`
with an agent, `empty` for none once read — whatever `?section=` asked — and `loading` before the
read, when the shell says "Reading your agents…". Both are pinned in `studio-landing.test.ts`. The
wallet and profile gates run before it, unchanged.

No link in the studio, account or auth screens names a cross-product path as a literal. On the
studio host the studio is `/` and `/studio`, `/agents`, `/agents/<handle>` and `/leaderboard` are
404s, so the studio's home comes from `useStudioHref()` (with `studioAgentHref(home, id)` from
`lib/select.ts` to open it on an agent) and a marketplace path from `useMarketplaceHref(path)`
(`features/site/studio-href.tsx`, over `marketplaceUrl` in `server/hosts.ts`): relative on a host
serving both products, `https://<marketplace host>/path` from the studio host. The middleware's
rewrite of the studio root keeps the query, so `/?agent=<id>&section=<key>` is
`/studio?agent=<id>&section=<key>` there.

`/studio` opens on `home/home.tsx` once an agent exists: the "Pickler Studio v5" canvas limited to
docs/specs/studio-create-and-fund-v1.md §5, with its own top bar (agent chip, status pill, Menu)
instead of the rail. The Menu reaches every section the rail does, grouped RUN / BUILD / GROW, and
the rail has a Home item back. `/studio?agent=<id>` opens on that agent (the creation flow's
"Open the studio" links there); without it, or for an id that is not the person's, the studio opens
on the first agent. `lib/select.ts` decides it, pure and pinned in `studio-select.test.ts`, and it
is not a preview parameter, so it works in production. `Agent` in `api.ts` is the studio agent DTO (wallet, balance,
`canSchedule`, `canCreateAnother`, `spend`, `spendEnforced`); the writes answer `AgentRecord`.

`home/status.ts` is pure and pinned branch by branch in `studio-status.test.ts`: `homeStatus` turns
the latest run, its events and the agent into the pill (WORKING, FIRST CALL IN, LIVE, or NO CALL
YET before any call), the mood (THINKING until a `selection` or `market_classification` event,
RESEARCHING after, then PICKED for a TRADE, PASSED for an abstention, WAITING while the schedule is
on, STOPPED for a failed or empty run), the first-person "say" line and the strip ("First run
finished in 2m 11s · 8 steps, 6 sources"). `pickCard` builds the decided card (range, market,
reason, "TRACKED ON PAPER · size AT price"), `scheduleView` the switch's lock and note from
`canSchedule.reason`, `nextUp` the one item ("Fund its wallet" until 10 AUSD), and `depositFailure`
the deposit's errors in the person's terms. Market names come from the `eligible_candidates` and
`selection` events, never invented. It imports only types from `api.ts`.

The home polls its own latest run through `startPolling`: every 3 s while it is queued or running,
every 20 s while the schedule is on, not at all once terminal, and it reads the agent again when a
run finishes. The shell's own loop pauses while the home is showing. A TRADE's paper order is read
with `readPaperOrder`; a missing one says "NOT TRACKED ON PAPER" rather than a fill. One component
per part, each with a harness id: `strip.tsx` (`home-strip`), `agent-card.tsx` (`home-agent`),
`wallet-card.tsx` and `deposit-sheet.tsx` (`home-wallet`), `schedule.tsx` (`home-schedule`),
`picks.tsx` (`home-picks`), `next-up.tsx` (`home-next`) and `menu.tsx` (`home-menu`).

The deposit prepares, stamps the exact body the API returned with `WebauthnStamper` (the relying
party from a custody challenge, read as the first sheet opens and kept for the session by
`relyingParty()`, so later openings store no challenge) and confirms, then reads the balance now
and twice more while the transfer lands. `lib/passkey.ts` holds that stamper, `session()` and
`custody()`, shared with the creation ceremony. The limits save themselves 700 ms after a change
through `PUT /limits` and say "Applies when it trades for real"; closing the sheet inside that
delay saves the pending change at once rather than dropping it (`lib/pending-save.ts`, pinned in
`studio-pending-save.test.ts`). The interval picker calls
`setIntervalHours`, so choosing it never turns the schedule off. The mark and the top-bar chip paint
from the DTO's `accent` through `accentVars`, like every other agent on the site (`cyan` renders
indigo). A staged or preview studio refuses every write, the shell's included, and says so.

`?stage=live|researching|decided` (`home/stage.ts`, outside production only) renders the home from
`home/fixture.ts`, and `?stage=empty` renders the empty home with no fixture (`StudioStage`);
the run stages come from the canvas's run, built from real event types on a fixed clock so the server's
HTML matches the browser's. It is gated on the build alone, like the creation flow's sample, because
`previewAllowed` also needs Supabase unconfigured. The staged home reads no session, fetches
nothing, disables every write and says it is a preview. `scripts/design/routes.mjs` proves one id
per stage.

## Custody boundary

No private key is ever derived or held in this app. Custody of the person's Pickler wallet belongs
to Turnkey, and a passkey registered against `TURNKEY_RPID` exists to authorise activities — never
to be read as key material by anything else on the same host. A connected browser wallet is not
authenticated server identity either: connecting is a read that says which address to show.

A sub-organization is born at signup, before any agent (spec §4.1): the studio's profile shows the
master wallet from the first visit, and a signed-in person without one does not get in anywhere.
Signup: email → code → passkey (mandatory; creates the master wallet) → handle (creates the profile
and workspace) → welcome. `lib/flow.ts` is the pure machine, pinned in `flow.test.ts`: signup is
`auth → code → passkey → handle → welcome`, and the only event that leaves `passkey` is
`passkey_created { profile }`, which goes to `handle` when there is no profile yet and to `welcome`
when there is one (an account made before the order changed). The handle step's
`POST /v1/profile` (`ensureProfile`) runs only after the wallet exists, and the API refuses it
otherwise (409 `wallet_required`) for a studio (email or Google) account. A wallet sign-in account
— only one whose token carries the server-only `app_metadata.pickler_account = "wallet"` — is
exempt and claims its handle from the marketplace portfolio (`wallet/components/claim-handle.tsx`)
with no custody account; one that has not signed in since the marker existed gets 409 until its
next wallet sign-in sets it. If it opens the studio, the gates send it to the passkey step. Signin is
`auth → code → welcome`, or `auth → code → passkey → welcome` when the landing check (`landing` in
`lib/custody.ts`, reading `GET /v1/signing/wallets/me` and `GET /v1/profile`) finds no
sub-organization on an account with a profile and sends `wallet_missing { profile: true }`. The
landing check puts the wallet first: no wallet → `passkey` whatever the profile; a wallet and no
profile → `handle` (`profile_missing { wallet: true }`, the finding carried in the event's type);
both → welcome, or the new-device rail when this browser is
not marked enrolled. What the landing check dispatches is `verifiedEvent`
(pure, in `lib/custody.ts`, over `landing`); a read that fails other than with a 404 dispatches
nothing, and the screen says the account could not be read, with "Try again". Every event is
accepted only on the steps whose screen can send it. `FlowState.wallet` (`none`, `found`,
`created`) is set only by the events that establish a wallet — `passkey_created`, `profile_missing`,
`account_found`, `device_unknown` — and `handle_claimed` is ignored while it is `none`. A walk from
`INITIAL` over every event pins that no state on the handle step or welcome lacks a wallet, and
that neither step is reachable at all without those events; a second walk, after `verifiedEvent`
for every account shape, pins that the handle step comes only after the passkey step for an account
without a wallet. `welcomeTitle` says WALLET CREATED only on the sign-up rail after the ceremony
created the wallet in this session, and WELCOME BACK otherwise.

The step is `steps/create-wallet-step.tsx` (`#signup-passkey`, recovered from the `PasskeyStep`
commit c4383d2 deleted): one prompt, the enrolment ceremony (`createWallet`: challenge fetched as
the sheet opens → WebAuthn from the sheet's confirm click → `POST /v1/signing/passkeys/register`),
which creates the sub-organization with the passkey as its only root and the master wallet. It is
the only place a sub-organization is created. A closed or failed prompt leaves the person on the
step with "Try again"; there is no skip. A failed create first reads the sub-organization again
(`afterFailedCreate`): if another tab created it meanwhile — this authenticator then refuses a
duplicate through `excludeCredentials` — the step advances rather than looping. `register` is
idempotent and core returns the winner of a two-tab race, so after a create the account's passkey
list is read and `enrolmentOutcome` decides: the browser is marked enrolled only if the credential
it just made is on the list; one that is not (`orphan`) goes to `/passkey`'s add-device screen, and
an unreadable list marks nothing.

Every signed-in custody screen sends a person without a sub-organization to the signup's passkey
step, whatever the profile, and one with a wallet and no profile to its handle step: the studio
shell (`studio.tsx`), the create screen (`create/create.tsx`, also when the agent ceremony throws
`NoSubOrganization`), `/account` with every section (`features/account/account.tsx`, where the
master wallet is shown) and `/passkey` read the wallet through `readSubOrganization` (the wallet,
or null for a 404; any other failure propagates — to the studio's load error, the account's wallet
card, or /passkey's "could not be read") and the profile (null only for a 404), and ask
`redirectFor({ wallet, profile })`, which answers `SIGNUP_PASSKEY_STEP` (`/signup?step=passkey`)
for a null wallet, `SIGNUP_HANDLE_STEP` (`/signup?step=handle`) for a wallet and a null profile,
and null otherwise, after the session guard; they `router.replace` there before rendering anything
else. The studio and the create screen read the wallet first and call `ensureProfile` only once it
exists, because `ensureProfile` can write a profile from sign-up metadata; nothing sends anyone to
`?complete=1` any more. `/portfolio` and the marketplace screens are wallet-connection surfaces,
not custody, and do not redirect. `/signup` and `/signin` resume any session they are opened with, whatever the URL
(`arrivalFor` in `features/auth/lib/signup-entry.ts`; `/signup?step=passkey` is just the readable
redirect target): the flow reads the account on arrival and sends the landing event from the
account screen, so it lands on the passkey step with no wallet (the signup rail, ACCOUNT done, when
there is no profile either; the signin rail ACCOUNT → PASSKEY → IN for a profile without a wallet),
on the handle step with a wallet and no profile (ACCOUNT and PASSKEY done), or on welcome for a
complete account (`account_found`, a sign-in on either rail). The URL's `?step=` is cosmetic. The email form appears
only when there is no session; the form column says "READING YOUR ACCOUNT…" until that is known,
and a failed read offers "Try again" rather than a guess. `/passkey` is add-device only: the add-passkey ceremony and the device list.

The account's passkey list, wherever a screen already has it, drives the second-passkey suggestion:
`suggestSecondPasskey` (`features/auth/lib/second-passkey.ts`, pure, pinned in
`second-passkey.test.ts`) is true only for a list that was read and holds exactly one — loading, a
failed read and an empty list suggest nothing. `components/second-passkey.tsx` draws it ("You have
one passkey…", a link to `/passkey`, and "Not now", which hides it for the browser session through
`sessionStorage` and never for good). It shows on the signup's welcome right after the create step
(`#welcome-second-passkey`, from the list the create step already reads for `enrolmentOutcome`),
on the studio home (`#home-second-passkey`, from one read in the shell's load path, passed to
`Home`; the staged home carries one fixture passkey so `studio-home-second-passkey` in
`scripts/design/routes.mjs` measures it), and in `/account`'s security section next to the list
(`#account-second-passkey`). No screen reads the list a second time for it.

`/signup?state=passkey` (`signupPreviewFromSearch`, outside production only, gated on the build like
`?stage=`) opens the signup on its passkey step with no session and no reads, because a real visit
needs a session with no wallet and the design harness has none;
`scripts/design/routes.mjs` measures it as `signup-passkey`.

## Cloudflare trading pilot

The studio Limits & funding section includes `sections/trading.tsx`: public account, preparation/explicit confirmation, mode and order history. Use private studio API DTOs and visibility-aware polling. Never import signer or infrastructure code.
