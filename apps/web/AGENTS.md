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
  studio/page.tsx           # The studio: opens on the home; no agents opens the create screen
  (auth)/                  # Existing signup/signin design
  apply/                   # Creator application using API-backed cookie access
  agents/, tokens/, reads/  # Existing public demonstrations
  markets/                  # The perpetuals board and one market's level × time surface
src/features/studio/       # Studio sections, history, research result and API client
src/features/studio/new-agent # Creating an agent: one screen, wallet first, then funding, then Create
src/features/studio/home   # The home: status, wallet and deposit, schedule, picks; the create gate
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

Shapes, control sizes and button variants live in `@pickler/ui` (see its `AGENTS.md`): one radius scale from `mark` to `3xl` in which a step names a role — chips and tiles, menu rows, stat tiles, cards, panels, sections — and a pill for every action, chip and status. Feature stylesheets reference the `--pk-radius-*` tokens and never hard-code a radius. Each shell declares its surface: the marketplace — the landing and every page inside `PublicShell`, the agent pages included — uses `data-surface="light"`, and the studio, account, auth and apply screens use `data-surface="dark"`. No screen paints a ground of its own: the night sky, the starfield and the neon floor were removed on 2026-09-29. Either value nests inside the other to invert a subtree. Type is the same on both: Archivo for titles and the lead figure of a view, always with its width axis (`font-variation-settings: var(--pk-display-wdth)`), and Instrument Sans for everything else — body text, every control, and the small tracked labels that used to be a monospace.

Controls come from `@pickler/ui`: `Button`/`ButtonLink` for actions (`glow` is the lit marketing call to action — the hero, the waitlist, the application), `Chip` for filters and toggles (`ChipLink` when it navigates, `ChipText` when it only reads), `Segmented` for an exclusive choice that is always on screen, `Tag` for read-only status, `Meter` for a filled track, `Icon` for every icon. Feature stylesheets keep only what a control does differently and pass it through `className`; they do not re-declare shape, type or state. Colour is the same: each sheet reads the system tokens by name (`var(--pk-ink)`) and holds no literal, no alias of a token (`--ink: var(--pk-ink)`) and no `--pk-*` definition. Every token has one source, `packages/ui/src/styles.css`; that includes the seven carried forward from before v2 and kept under their own names — `--pk-ink-dim`, `--pk-border-strong` and the five `--pk-*-edge` (lime, magenta, amber, cyan, violet) — which are defined per surface there like the rest. A custom property of a sheet's own is for a computed value that is not a colour. The one place a token reaches CSS from TypeScript is `src/lib/accent.ts` (`accentVars`, `swatchVars`), because which agent a screen shows is data. `npm run design:source` fails on any of these, on a class no component names, and on `data-third-party-mark` (which the runtime check skips) anywhere but `packages/ui/src/brand.tsx`. Panels take the shared surface with `composes: pk-panel from global` instead of redeclaring a border and a radius.

Market data is drawn with `CandleChart` and `BarChart` from `@pickler/ui` — the price panel on a token page and every series under the leaderboard. Features hand them timestamped buckets and nothing else; colours and type come from the surface. The library's own logo is off, so `PublicShell` carries the TradingView credit its licence asks for; any new surface that shows a chart needs that credit too.

## The wallet

`features/wallet/` owns the connection. `lib/signer.ts` is the contract the rest of the site talks to — address, chain, balance, connect, disconnect — and one adapter implements it. `injected-signer.ts` is the EIP-1193 conversation with the browser wallet, with no connector library: it asks for accounts, reads the chain and the native balance, follows `accountsChanged` and `chainChanged`, and offers to switch to Monad testnet using the metadata in `@pickler/chain`.

`connect` is for a wallet the person already had, and that is all it is for. The person's own Pickler wallet is not a signer here: it is custodied in Turnkey, the key stays in the enclave under their passkey, and the site reaches it through the signing API. Nothing in this app derives or holds a private key, and no new signer may. The PRF path that used to do so (`mera-signer.ts`, over `@category-labs/mera`) is retired: it asked for whichever passkey the person had for `pickler.fun`, which once Turnkey passkeys exist on that host means taking a credential that authorises activities and turning it into key material.

The account menu names which wallet you are looking at, so a portfolio is never shown without saying whose it is. A signer without a chain of its own is never "on the wrong network", so `onTargetChain` is true for it and `canSwitchChain` is how a page asks whether the verb exists at all.

`connect(holding?)` opens the chooser rather than prompting a wallet directly, and `holding` is what the person was about to do — the modal keeps it in front of them while they pick, the way the app's own sign-in screen does. There is no "unsupported" state: a browser with nothing to connect still opens the chooser, which names what is missing on each choice rather than presenting a dead button.

It never signs or sends anything — connecting is a read that tells the site which address to show a portfolio and a read history for.

**Connecting is not signing in.** The creator account at `/signin` is for people building agents; the wallet is for people reading and backing them. Do not fold one into the other.

A wallet session belongs to one address. `lib/wallet-session.ts` keeps the token with the address and chain family it was issued for (`WalletSession`), and `decideSession(cached, connected, now)` is the only thing that hands it back: the same address with a token more than `EXPIRY_MARGIN_MS` from its `exp` reuses it, a different address or an expired or unreadable token signs again, and nothing connected has no session. `wallet-context.tsx` lets go of the session when the account changes or the wallet disconnects (a change of chain keeps it), and `dropWalletSession` signs the shared Supabase client out locally only when its session is that same user's and a wallet account's (`madeByWalletSignIn`: `app_metadata.pickler_account === "wallet"`). A studio account that linked the wallet is opened by signing in with it, but its session also came from a passkey, an email or Google, so a wallet switch never ends it. After a reload the page holds nothing while the browser is still signed in, so on mount a wallet account's session found on the client is adopted (`adoptSession`). The session does not record its address — the token carries a digest — so an `AdoptedSession` has none: it is never reused as a token (the next action signs again), and `releases(held, previous, next)` lets go of it on any change of address, on disconnect, and on connecting when nothing was connected. `session` on the context is derived from whose session is held, never stored. `signInWithWallet` answers `{ token }` or `{ error }` (`lib/wallet-sign-in.ts`, `signInAs`; `error: null` is a closed prompt), and a caller shows the error from that result — `sessionError` read after the await is the value of the render the call started in.

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
— against the mirrored limits in `@pickler/api-schema`. It moves to trading when an order is really
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
`sections/rail.ts` is the one list of sections: `RAIL`, four groups (RUN, BUILD, GROW, PUBLIC) of
the thirteen keys of `sections/keys.ts`, in their order, each with its icon, label and `soon`. The
shell's rail, the home's Menu and the create screen's rail all draw it. `sources`, `identity`,
`profile`, `audience` and `token` have no screen: `isSoon` marks them SOON in all three, and they
open on the one Soon panel (`sections/soon.tsx`, copy in `PANELS`), which the board also draws,
without SOON, for its two links out. `isPanel` decides which sections draw it; both are pinned in
`studio-rail.test.ts`. `sections/brief.tsx` is the Brief row's editor for an existing agent.
Keep the existing backend permissions: research enablement is required to create or edit agents,
not just to run them. Agent creation selects the ID returned by the API, never an array position.
The create request (`POST /drafts`) is built by `toDraftRequest` in `new-agent/model.ts`.
Swatches paint from `accentVars`, never from a hue name typed into a token.
`features/studio/lib/polling.ts` coordinates cancellable read requests. Refresh active runs and
the selected trace every three seconds; stop when terminal unless scheduling needs discovery.
Abort on page hiding, agent changes and unmount. Mutations trigger an immediate read refresh.
Never retry paid mutations automatically. `apps/web/test/*.test.ts` is included in the root suite;
run its controlled-clock regression tests with `node --import tsx --test apps/web/test/*.test.ts`.

## Creating an agent

There is one creation flow, the create screen in `features/studio/new-agent/` ("Pickler Studio
Empty v5", docs/specs/studio-create-simplified-v1.md). `/studio/new`, `features/studio/create`, the
brief home (`home/empty.tsx`, `brief/*`) and its paper run are gone. The screen renders inside
`/studio`: a person with no agents lands on it, and with agents "+ New agent" (the home's Menu and
the shell's switcher) opens it, with "Back to {agent}" in the top bar in place of the chip (shut
while a passkey is up or once the draft exists). `lib/landing.ts` decides this:
`studioLanding(loaded, agents, section)` answers `new` with no agents once read (whatever
`?section=` asked) or for the section `new`, `home` or `section` with an agent, and `loading`
before the read; pinned in `studio-landing.test.ts`.

The order is fixed: the agent's wallet first, then funding, then "Create {name}".

1. "Create its wallet" (`createWallet` in `ceremony.ts`): the wallet under the person's passkey,
   then, the first time only, Pickler's delegated user ("Let Pickler trade from it", step 2 of the
   wallet sheet). A wallet an earlier attempt left unlinked is reused, so a cancelled step 2
   resumes at step 2.
2. Funding: the wallet must hold the minimums (`MIN_START`, 10 AUSD and 0.5 MON) before Create
   opens. "Fund from master wallet" opens "Your wallets" (`wallets-modal.tsx`, rules in
   `transfer-model.ts`), which moves AUSD or MON between the master wallet and an agent wallet.
3. "Create {name}" (`createAgent` in `ceremony.ts`): the wallet's policies with one passkey
   (skipped when already approved, so a retry never writes them twice), then `POST /drafts`
   (`createDraft`). The API checks the funding again and answers `WALLET_UNDERFUNDED` below the
   minimums. Once the draft exists the button only opens it, never creates a second one.

The pure modules are required from `node:test` through CommonJS and value-import neither
`@pickler/api-schema` nor `@pickler/core`: `model.ts` (the form, handle, labels, minimums, voices,
patterns and the request; literal copies of core's constants, pinned by a dynamic import in
`studio-new-agent.test.ts`), `ceremony.ts` (`studio-new-agent-ceremony.test.ts`), `wallet-reads.ts`
(ordered reads; approved policies stay approved; `studio-new-agent-wallet.test.ts`) and
`transfer-model.ts` (`studio-new-agent-transfer.test.ts`). `new-agent.tsx` holds the screen's state
and transport; `chrome.tsx` the top bar and the disabled rail; `identity.tsx`, `voice.tsx`,
`reads.tsx` and `advanced.tsx` the brief column; `wallet-panel.tsx` "Its wallet";
`passkey-sheet.tsx`, `wallets-modal.tsx`, `credits-modal.tsx` and `avatar-picker.tsx` the native
dialogs (`use-dialog.ts`). The words on the screen come from `model.ts`, never from the components.

`api.ts` holds thin fetch wrappers for this surface: `createDraft`, `studioWallets` and the
transfer routes, and the passkey ceremony under `/v1/signing/agents` (`agentState`,
`prepareDelegated`/`confirmDelegated`, `prepareWallet`/`confirmWallet`,
`preparePolicies`/`confirmPolicies`) plus the public `handleAvailable`. The signing and handle
routes answer Relayer's envelope (`{ success, message, data, ... }`); `envelopeApi` unwraps it into
the same `StudioError` the plain-JSON studio routes throw through `studioApi`, so a caller branches
on `errorCode` the same way for either family.

`home/gate.ts` is the lock the "+ New agent" entries read before opening the screen (pinned in
`studio-gate.test.ts`). `newAgentLock` says the funding lock first (one unfunded agent at a time,
naming a wallet agent, never a draft), then the draft limit: `draftLimitLock` counts the drafts
against `MAX_DRAFTS` (core's `MAX_DRAFTS_PER_WORKSPACE`, restated and pinned) and also closes when
the API's `canCreateAnother` already answers `draft_limit`. Every agent is created as a draft, so
the limit closes the entries before any wallet is made or funded. The create screen gets the same
note (`draftLock`): the wallet step's button and "Fund from master wallet" are shut with it, and
`createBlock` answers that note before anything else. A 409 `DRAFT_LIMIT` from
`POST /drafts` still reads "At most 3 drafts at a time." (`DRAFT_LIMIT_NOTE` in `lib/messages.ts`).
`home/trace.ts` turns a run's events into the lines the home's status reads (`studio-trace.test.ts`).

`?stage=create-*` (`CREATE_STAGES` in `home/stage.ts`, outside production only) draws the screen
from `new-agent/fixture.ts` at each moment of spec §7: `create-empty`, `create-wallet`,
`create-funded`, `create-advanced`, `create-web`, `create-sheet` and its `-busy`, `-ok` and
`-cancelled` phases, `create-wallet-sheet` and `create-wallet-sheet-step2`, `create-wallets`,
`create-credits` and `create-avatar`. A staged screen is always a preview: it reads nothing and
sends nothing. `?stage=empty` is the screen with no fixture. Each stage has exactly one route in
`scripts/design/routes.mjs`, pinned in `studio-landing.test.ts`; the routes prove what the stage
draws: `#new-agent-wallet[data-state="none|empty|funded"]`, the sheet's `data-phase` and
`data-step`, each modal's `[open]`, and `#new-agent[data-staged="false"]` for `?stage=empty`.

## The studio home

With no agents, `/studio` opens on the create screen above. Below 860px its rail is hidden and the
Menu appears in the top bar instead. `HomeMenu` takes `agent: null` then: every section is listed
disabled with "After you create your agent". `home/access.ts` holds that decision, pure:
`menuAccess` answers whether sections open and whether "+ New agent" is open, with one reason
(research access, then view-only, then the unfunded-agent lock), and the create screen reads the
same answer. The wallet and profile gates run before `studioLanding`, unchanged.

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
instead of the rail. The Menu reaches every section the rail does, built from `RAIL` in its four groups, and
the rail has a Home item back. `/studio?agent=<id>` opens on that agent; without it, or for an id that is not the person's, the studio opens
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
`home/fixture.ts`, `?stage=draft` the draft's home, and `?stage=empty` and `?stage=create-*` the
create screen (`StudioStage`); the run stages come from the canvas's run, built from real event types on a fixed clock so the server's
HTML matches the browser's. It is gated on the build alone, because
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
shell (`studio.tsx`, which also holds the create screen), `/account` with every section (`features/account/account.tsx`, where the
master wallet is shown) and `/passkey` read the wallet through `readSubOrganization` (the wallet,
or null for a 404; any other failure propagates — to the studio's load error, the account's wallet
card, or /passkey's "could not be read") and the profile (null only for a 404), and ask
`redirectFor({ wallet, profile })`, which answers `SIGNUP_PASSKEY_STEP` (`/signup?step=passkey`)
for a null wallet, `SIGNUP_HANDLE_STEP` (`/signup?step=handle`) for a wallet and a null profile,
and null otherwise, after the session guard; they `router.replace` there before rendering anything
else. The studio reads the wallet first and calls `ensureProfile` only once it
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

`/tokens` renders the real launch catalogue through the API, with explicit unavailable/empty states; it does not restore the removed sample token board.

## Design checks

`npm run design:check` runs the static source check and then the rendered checks (surfaces, tokens,
contrast, type) over every route in `scripts/design/routes.mjs`. It starts the fixture API on 8799
and this app on 3001 with authentication switched off, and stops both when it ends; a port that is
already taken is refused, not reused. `npm run design:source` is the static check alone.
`npm run design:shots` writes screenshots to the folder `DESIGN_SHOTS_DIR` names, and
`npm run design:compare -- <before> <after>` says which screens differ. A screen that needs a
session to render gets a door that is shut in production (`?stage=`, `?section=`,
`/signup?state=passkey`, `/passkey?state=add`, `/portfolio?state=connected`) and a route that
proves it. A route proves an id the screen itself renders, never a container that is there
whatever it holds: each studio section's root carries `studio-section-<key>` and the Soon panel
`studio-soon-<key>`. A new screen gets a route in the same change.
