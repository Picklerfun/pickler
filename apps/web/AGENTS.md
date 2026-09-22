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
  auth/callback/route.ts    # Supabase code exchange, cookies, return to console
  console/page.tsx          # Private research UI
  (auth)/                  # Existing signup/signin design
  apply/                   # Creator application using API-backed cookie access
  agents/, tokens/, reads/  # Existing public demonstrations
  markets/                  # The perpetuals board and one market's level × time surface
src/features/console/      # Agent form, history, research result and API client
src/features/markets/      # Surface, trade ticket, ask ticket and the ticket's own arithmetic
src/server/
  api-client.ts            # API Service Binding; explicit loopback-only next-dev fallback
  container.ts             # Typed presentation facade over HTTP DTOs
  http/apply-cookie.ts     # Read the incoming cookie for the application page
  http/auth-board.ts       # Presentation formatting only
```

Landing, signup, applications, token pages, paid reads, wallet and ranking designs are retained.
Public demo content comes from explicitly sample-labeled API endpoints; research results never
appear there automatically. `/api/v1/landing` keeps its polling behavior. Hono sets the HttpOnly,
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

Shapes, control sizes and button variants live in `@pickler/ui` (see its `AGENTS.md`): pill for actions and chips, 16 for cards, 12 for inputs and tiles, 6 for small marks. Feature stylesheets reference the `--pk-radius-*` tokens and never hard-code a radius. Each shell declares its surface: the landing, apply and public pages use `data-surface="public"`, the auth screens use `data-surface="console"`, which is the dashboard's tone. Type is the same on both: Chakra Petch for titles and the lead figure of a view, JetBrains Mono for tabular data and labels, Manrope for body text and every control.

Controls come from `@pickler/ui`: `Button`/`ButtonLink` for actions (`glow` is the lit marketing call to action — the hero, the waitlist, the application), `Chip` for filters and toggles (`ChipLink` when it navigates, `ChipText` when it only reads), `Segmented` for an exclusive choice that is always on screen, `Tag` for read-only status, `Meter` for a filled track, `Icon` for every icon. Feature stylesheets keep only what a control does differently and pass it through `className`; they do not re-declare shape, type or state. Colour is the same: each sheet aliases the system tokens (`--ink: var(--pk-ink)`) and holds no literal. Panels take the shared surface with `composes: pk-panel from global` instead of redeclaring a border and a radius.

Market data is drawn with `CandleChart` and `BarChart` from `@pickler/ui` — the price panel on a token page and every series under the leaderboard. Features hand them timestamped buckets and nothing else; colours and type come from the surface. The library's own logo is off, so `PublicShell` carries the TradingView credit its licence asks for; any new surface that shows a chart needs that credit too.

## The wallet

`features/wallet/` owns the connection. `lib/signer.ts` is the contract the rest of the site talks to — address, chain, balance, connect, disconnect — and two adapters implement it. `injected-signer.ts` is the EIP-1193 conversation with the browser wallet, with no connector library: it asks for accounts, reads the chain and the native balance, follows `accountsChanged` and `chainChanged`, and offers to switch to Monad testnet using the metadata in `@pickler/chain`. `mera-signer.ts` is the passkey account from the Pickler app, over `@category-labs/mera`.

The key is the passkey's PRF output, not a random secret held anywhere. Mera documents that output as a deterministic function of the credential, the host and a fixed salt (`sha256("mera.prf.salt.v1")`, which it promises not to change), so the same passkey derives the same private key and therefore the same address on a phone, a laptop or a borrowed browser, with nothing to sync. That is the only reason the app's account can be reached from the web at all, and it is why PR #31 — the Apple App Site Association that binds `fun.pickler.app` to `pickler.fun` — decides whether this works: the host is part of the key, so both surfaces must be the same relying party. Off `pickler.fun` the same passkey derives a different account holding different money; loopback is allowed while developing and the chooser says so in amber.

Mera's other model is a vault — a random key encrypted under the passkey — and it is not this one: it would need the app's vault shipped here before the web could open anything. If the app turns out to use it, the address derived on the web will not match the app's, which is why the address is shown rather than assumed.

The session is ended as soon as the address is derived. Connecting needs no signature, so a private key never waits in memory for a tab's lifetime, and anything that signs later asks the person again.

One signer is active at a time, because the two are different addresses holding different money, and the account menu always says which one you are looking at. A signer without a chain of its own is never "on the wrong network", so `onTargetChain` is true for it and `canSwitchChain` is how a page asks whether the verb exists at all.

`connect(holding?)` opens the chooser rather than prompting a wallet directly, and `holding` is what the person was about to do — the modal keeps it in front of them while they pick, the way the app's own sign-in screen does. There is no "unsupported" state: a browser with nothing to connect still opens the chooser, which names what is missing on each choice. A dead button teaches nobody that the app account exists.

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

The private creator console lives at `/console` and calls the Hono API. The public surface retains landing, `/apply`, auth screens, `/tokens`, `/agents`, `/reads` and `/leaderboard`. Keep private research and public demonstration data separate; share visual components without automatically publishing results.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Unified API transport and private console

`src/server/container.ts`
is now a typed API client facade. No core or infrastructure dependency is permitted anywhere
in this app. `src/app/api/v1/[...path]/route.ts` delegates requests through the API Service
Binding; the explicit loopback-only fallback is for local development. Cookies and JWT headers
are transported, never interpreted as workspace authority by the web Worker. Hono validates
identity and owns business decisions. Only public Supabase Auth configuration reaches the web.

`features/console` and `/console` provide private agent configuration, manual research, schedule
and pause controls, history and evidence. Reuse the existing shared control system with
`data-surface="console"`. API mutation errors remain explicit; do not automatically retry paid
research. Reuse an idempotency key after an uncertain admission response. Poll pending/active
research every three seconds, stop at terminal status, suspend in hidden tabs and clean up
requests/timers on navigation. Results are not added to the public sample directory.

The auth callback exchanges a Supabase authorization code and returns to the console. Console
onboarding finishes missing profiles and idempotently provisions a workspace. Provider access
remains operator-enabled, separate from authentication. The completed signup screen links to
the console; public wallet/token/read demonstrations retain their existing design and limits.

## Worker build

OpenNext 1.20.6 adapts the existing Next.js build. Use `npm run build:worker --workspace=@pickler/web`;
`wrangler.jsonc` binds API and static assets. No shared incremental cache is configured. Test the
compiled Worker and same-origin auth/cookies before deployment. See ../../docs/cloudflare-staging.md.

## Studio console integration

The private console uses the Studio shell and sections under `features/console/sections`.
Keep the existing backend permissions: research enablement is required to create or edit agents,
not just to run them. Agent creation selects the ID returned by the API, never an array position.
`features/console/lib/polling.ts` coordinates cancellable read requests. Refresh active runs and
the selected trace every three seconds; stop when terminal unless scheduling needs discovery.
Abort on page hiding, agent changes and unmount. Mutations trigger an immediate read refresh.
Never retry paid mutations automatically. `apps/web/test/*.test.ts` is included in the root suite;
run its controlled-clock regression tests with `node --import tsx --test apps/web/test/*.test.ts`.
