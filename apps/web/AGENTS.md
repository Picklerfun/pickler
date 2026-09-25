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
  studio/page.tsx           # The studio (private research UI); no agents sends you to /studio/new
  studio/new/page.tsx       # Creating an agent: `?step=` names the screen
  (auth)/                  # Existing signup/signin design
  apply/                   # Creator application using API-backed cookie access
  agents/, tokens/, reads/  # Existing public demonstrations
  markets/                  # The perpetuals board and one market's level × time surface
src/features/studio/       # Studio sections, history, research result and API client
src/features/studio/create # Creating an agent: describe, seven steps, review, passkey ceremony, first run
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

The auth callback exchanges a Supabase authorization code and returns to the studio. Studio
onboarding finishes missing profiles and idempotently provisions a workspace. Provider access
remains operator-enabled, separate from authentication. The completed signup screen links to
^the studio; public wallet/token/read demonstrations retain their existing design and limits.

## Worker build

OpenNext 1.20.6 adapts the existing Next.js build. Use `npm run build:worker --workspace=@pickler/web`;
`wrangler.jsonc` binds API and static assets. No shared incremental cache is configured. Test the
compiled Worker and same-origin auth/cookies before deployment. See ../../docs/cloudflare-staging.md.

## Studio integration

The private studio uses the Studio shell and sections under `features/studio/sections`.
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
text builders (`tradesText`, `callsText`, `readsText`, `skillsText`, `decidesText`), `fromApiDraft`
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
funding surface: `draftAgent`, `createAgent`, `startRun`, `runEvents`, `run`, `paperOrder`,
`updateConfig`/`setInterval`, `saveLimits`, `setSchedule`, `depositPrepare`/`depositConfirm`, and
the passkey ceremony under `/v1/signing/agents` (`agentState`, `prepareDelegated`/
`confirmDelegated`, `prepareWallet`/`confirmWallet`, `preparePolicies`/`confirmPolicies`) plus the
public `handleAvailable`. The signing and handle routes answer Relayer's envelope
(`{ success, message, data, ... }`); `envelopeApi` unwraps it into the same `StudioError` the
plain-JSON studio routes throw through `studioApi`, so a caller branches on `errorCode` the same
way regardless of which family a request belongs to.

## Creating an agent

`/studio/new` is the only place an agent is created, and `/studio` sends a person with no agents
there (the old empty studio, its stepped flow and `AgentForm` are gone). `create/create.tsx` owns the
screen: a `useReducer` over `flowReducer` (`create/flow.ts`, pure and tested in
`studio-create-flow.test.ts`) holding the `Draft`, the screen, `auto`/`manual` mode and the Edit
snapshot that Cancel restores. `?step=` mirrors the screen through `router.replace`; `describe` is
the first screen's URL name. Outside production a link past Describe opens on the canvas's example
draft (`sampleDraft`) so the design harness has every screen to measure — one route per step in
`scripts/design/routes.mjs`, each proving `#create-<step>`. Without Supabase configured it renders
from the preview options and says so; nothing can be drafted, checked or created there.

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
`studio-ceremony.test.ts`: `wallet` (register the sub-organization if there is none — the existing
enrolment ceremony — add the delegated user if there is none, then the wallet named for the handle,
or reuse the `existing` one an earlier attempt left), `rules` (policies), `agent`, `run`. A first
agent is four passkey prompts, a later one two; any failure propagates and stops the sequence. The
screen stamps with `WebauthnStamper`, whose `rpId` comes from the passkey challenge's `rp.id`.
Idempotency keys for the create and the run are kept per draft, so "Try again with your passkey"
replays the same attempt. `first-run.tsx` draws the four steps as the rail's first lines, then polls
the run's events and status every 1.5 s through `startPolling` until terminal, creates the paper
order once for a completed TRADE (`paperOrder(runId, runId)`), and after 20 s still queued shows
"Waiting for a runner" with `npm run dev:agent`. `trace.ts` turns events into those lines.

## Custody boundary

No private key is ever derived or held in this app. Custody of the person's Pickler wallet belongs
to Turnkey, and a passkey registered against `TURNKEY_RPID` exists to authorise activities — never
to be read as key material by anything else on the same host. A connected browser wallet is not
authenticated server identity either: connecting is a read that says which address to show.
