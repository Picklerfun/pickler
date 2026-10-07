# Web app instructions

The compiled-product acceptance in [Studio acceptance](../../docs/studio-acceptance.md) uses
real requests and local Queue execution, separate from inert `?stage=` design previews.
Published Perpl Controls expose explicit hourly scheduling through the existing schedule API.
Activation requires preparation, runtime availability, management permission and an unpaused
agent; an existing schedule can still be disabled when those activation conditions disappear.
Publication alone never enables scheduling. The strategy selector has an explicit accessible name.
Passkey device copy uses a server-safe external-store snapshot, including closed ceremony sheets,
so the browser does not replace the server tree during hydration. Acceptance rejects page errors.

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
src/features/studio/draft  # A private draft's own studio: rail with locks, tiles, Go Public, its sections
src/features/studio/live   # A published Perpl agent's studio: strip, rail, Pause entries, its sections
src/features/studio/shell  # The chrome and parts both agent studios share (draft and live)
src/features/markets/      # Surface, trade ticket, ask ticket and the ticket's own arithmetic
src/server/
  api-client.ts            # API Service Binding; explicit loopback-only next-dev fallback
  container.ts             # Typed presentation facade over HTTP DTOs
  http/apply-cookie.ts     # Read the incoming cookie for the application page
  http/auth-board.ts       # Presentation formatting only
```

Landing, signup, applications, token pages, paid reads, wallet and ranking designs are retained.
The marketplace reads `/api/v1/marketplace/*`: agents come from the database, the perpetuals board
is read from Perpl (or is the sample board, labelled, where the API has no network configured), and research results never appear there automatically. `/api/v1/landing` keeps its polling behavior. Hono sets the HttpOnly,
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

`features/wallet/` owns the connection. `lib/signer.ts` is the contract the rest of the site talks to — address, chain, balance, connect, disconnect — and two adapters implement it, the marketplace's two wallets and no others (`docs/specs/mera-web-v1.md`):

- `injected-signer.ts` is the EIP-1193 conversation with the browser wallet the person brought, with no connector library: it asks for accounts, reads the chain and the native balance, follows `accountsChanged` and `chainChanged`, and offers to switch to Monad testnet using the metadata in `@pickler/chain`.
- `mera-signer.ts` is the Mera passkey wallet, the same account as in the mobile app: a passkey for `pickler.fun` gives the same PRF output here as on the phone, and `@pickler/mera-account` turns it into the same address. It has two ways in (`ConnectMode`): `create` makes a passkey, `existing` opens one the person already has, the app's included.

**The studio's Turnkey wallet is not a signer here and never will be.** Mera and Turnkey are kept apart five ways, and a change that weakens one needs the owner's decision:

1. Relying party. Mera asks WebAuthn for `pickler.fun`, a constant (`MERA_RELYING_PARTY` in `lib/mera-availability.ts`, pinned to core's by a test) and not configuration: a deployment that could set it could set it to a host where Turnkey passkeys live. Turnkey's passkeys are enrolled against `app.pickler.fun`. A browser never offers a credential for a relying party that was not asked for, and the API turns custody off if `TURNKEY_RPID` is ever the apex.
2. Host. `meraAvailability` (`lib/mera-availability.ts`, pure, pinned in `mera-availability.test.ts`) offers the passkey wallet only where the page's hostname is the relying party and is the host configured as the marketplace, and refuses the studio host by name even though WebAuthn would allow the parent domain there. Any other host — a preview, a staging host, which serves both products — has no passkey wallet until a specification gives it one. On `localhost` outside production it is offered with a note, because there both relying parties are `localhost` and the account is not the app's; `127.0.0.1` is refused, because an address cannot be a relying party. The signer checks again when a ceremony starts, not only when the chooser draws.
3. Code. ESLint (`eslint.config.mjs`, proved by `test/import-guard.test.ts`): nothing under `features/wallet` loads `@turnkey/*` or anything of `features/auth`, `features/studio` or `features/account` but the Supabase client and its configuration; only `features/wallet/lib/mera-*.ts` loads `@category-labs/mera` or `@pickler/mera-account` (closed to `packages/ui` too); and nothing outside `features/wallet` imports those `mera-*` modules. Static imports and `import()` of a string literal are both read, and an `import()` of anything else is refused in this app because it cannot be. The test also fails on a comment that switches either rule off. What the rules cannot see is a non-Mera module of the wallet re-exporting what a Mera module gave it; do not write one.
4. Account. A wallet sign-in account is marked `pickler_account = "wallet"` and has no custody account. The `kind` sent with a sign-in (`mera` or `eoa`) describes the link and grants nothing.
5. Switch. `NEXT_PUBLIC_MERA_WEB=off` takes the passkey wallet out of the chooser.

**No Mera key is kept.** `lib/mera-ceremony.ts` (`runMeraCeremony`, pure, its parts injected; `mera-ceremony.test.ts` runs it against the frozen vectors of `@pickler/mera-account` with the real libraries) takes the PRF output of one passkey prompt and:

- derives the key and zero-fills the PRF output before any request leaves;
- asks the API for the sign-in message (the address is needed to ask, so the key is alive across this one request, which has a timeout), signs it, then ends Mera's signing session and zero-fills the key — in a `finally`, so also when the ceremony is refused or throws;
- only then presents the signature. `@pickler/mera-account` wipes every HD node it derived through, the master included.

What cannot be wiped, and no comment or document may claim otherwise: the mnemonic is a string, the curve and derivation libraries compute with big integers and temporaries of their own, and the browser keeps its own copy of the PRF output inside the credential it returned. They are unreachable after the ceremony and left to the garbage collector. Nothing derived from the passkey is stored: the browser remembers the kind, the address and the credential id (`pk.wallet.kind`, `pk.wallet.mera`), so a reload shows the address without a prompt, and every later signature is another prompt. `lib/mera-kit.ts` loads the Mera SDK, its viem adapter and the derivation with `import()`; the chooser fetches them as it opens (`prepare`), so the passkey prompt follows the click with no download in between, and a page whose chooser never opens never loads them. Do not hold the key, a session over it, or the PRF output in module scope, React state or storage, and do not derive the account any other way: the PRF output used directly as the key, which the signer retired on 2026-09-22 did, opens a different address than the app. For those seconds the key is exposed to every script on the page, and `WalletProvider` sits in the root layout, so that is every page of both products on a host that serves both; a strict content-security policy and a signer in its own origin are required before mainnet funds (spec §5).

"Create one" whose sign-in then fails has still made a passkey. The signer keeps that credential id for the page's life (`unfinished` in `mera-signer.ts`), and the next "Create one" opens that passkey instead of making a second one with the same name and another address. One case is not covered: on an authenticator that does not evaluate PRF at creation the SDK asks a second time, and if the person closes that second prompt the SDK throws without the credential's id, so the passkey it made is left behind and "Create one" makes another.

**Connecting signs in, and then asks for a username.** `connect(holding?)` opens the chooser rather than prompting a wallet directly, and `holding` is what the person was about to do — the modal keeps it in front of them while they pick. The chooser's steps are a pure reducer, `connectFlow` in `lib/connect-flow.ts` (pinned in `connect-flow.test.ts`): `choose` → `signin` → `username`, then optionally `join` → `joined`, with `prf` beside them.

- The passkey wallet connects and signs in with one prompt, so it skips `signin`. A browser wallet answers its account prompt and lands on `signin`, whose button asks for one `personal_sign` over the same message. That step cannot be closed, only disconnected out of (below). A session that has since expired is asked for again by whatever first needs it (`signInWithWallet`).
- With the session, the context reads `GET /api/v1/profile` (`readProfile` in `lib/handles.ts`: the profile, `false`, or null when it could not be read). No profile opens `username`, whichever wallet signed in; the form is `useHandleClaim` (`lib/use-handle-claim.ts`), and the claim uses the session without signing again. A profile, or a read that failed, closes the chooser.
- **The username is not optional, and neither is signing in.** A wallet that connected finishes arriving or is disconnected. `mustFinish(state)` in `lib/connect-flow.ts` names the steps that cannot simply be closed — `signin`, `username`, `join`, and `prf` while joining — and on them the chooser ignores Escape and a click outside and draws **Disconnect** where the close button was (`onLeave`, which disconnects the wallet). Disconnect is never disabled, not even while a wallet is being asked to sign: a browser wallet that does not answer would otherwise leave a modal with every control dead. It supersedes whatever is in flight, and a sign-in that answers afterwards is dropped with the session it made. On load a remembered wallet is picked up only if the browser still holds a session — any session: a studio account that linked the wallet is opened by it, so the test cannot be "a wallet account's" — and nothing is picked up when nothing is remembered (a browser wallet goes on listing its accounts after a disconnect it could not revoke). So a reload does not bring back a wallet in a browser that is signed out; a build with no Supabase configured has no accounts, and there a browser wallet simply connects. An account found without a username when no chooser is open — after a reload the page adopts the browser's wallet-account session and reads its profile — is shown the username step at once, derived from `hasProfile === false` rather than dispatched, on every page that is not the studio's (`ownerOf(pathname)`). Only a known `false` holds anybody: `null` never does. There is no username panel on `/portfolio` any more. An adopted session may be another address's (the person switched account in their wallet between visits), so every sign-in that issues a session reads the profile again (`keep`), and what the page shows is about the account that signed. `hasProfile` is forgotten only when the session is let go of, not on a change of chain.
- A passkey that returns no PRF output is the step `prf`, not an error line: it says which password managers work and offers the other way.
- A closed prompt returns to the step it came from with no error. A choice this browser cannot offer stays in the list with the reason on it; there is no "unsupported" state. The chooser can be closed on its first step, on its last, and on `prf` reached from the first; a wallet whose prompt is approved after the person closed it on the first step is connected and brings the next step with it. A passkey ceremony always ends (its prompt is modal, its requests time out), so a second pick waits for it. A browser wallet may never answer, so closing the chooser stops the site saying it is waiting (a late answer still connects), and a later pick takes over, after which whatever the earlier one answers is dropped.

**"I already have an account."** The username step has a second way out, for somebody whose account is under their other wallet (spec §9). `join` is the step where they pick that wallet (`joinChoices`: the passkey wallet's "I already have one" and the browser wallet — never "create", and not the browser wallet while connected with it, because a second account of the same extension is the wallet changing under the page). The adapter's `join(token, joining)` has that wallet sign a message that names the connected wallet as the one it lets in (`challenge` with `joining`: not the sign-in message, so a browser wallet shows what is being agreed to) and presents it to `POST /api/v1/auth/wallet/join` with the session of the bare account the connected wallet was given (`join` in `lib/connect.ts`); the API folds that account into the other and answers with its session. `joinWith` in the context then lets go of the session it held — that account no longer exists — and keeps the new one for the same connected address, so the connection does not change and no wallet is switched. `joined` says which account the wallet opens now (`readProfile` gives the username); an account joined that has no username goes to `username` instead. Refusals are worded by `joinWords` (`lib/sign-in-words.ts`), `Back` returns to `username`, and `prf` reached from `join` returns to `join`. A join request that left and was not answered (`JoinUnsettledError` from `join` in `lib/connect.ts`: a timeout, a 5xx — never a failure before the request) may have happened, so the page lets go of the session it held, remembers which account was being given up, and says so; the next try signs in as the connected wallet, and if that wallet now opens another account the join is reported as done without asking the other wallet again. The session the API answers with is kept even when a later pick has taken over the chooser, but only while the wallet it was for is still the connected one. The username step shown after a reload carries the same link (`joinAccount()`); the page holds no usable session by then, so it opens on the sign-in step worded for it ("FIRST, THIS WALLET") rather than prompting the connected wallet unannounced.

The chooser moves focus to the step's title when a step arrives (to the field, on the username step), announces what it is waiting on through one persistent `role="status"` line, and marks a row that cannot be picked, and any control that is waiting, with `aria-disabled` and a guarded click rather than `disabled`, so the reason stays reachable by keyboard and the control just pressed keeps its focus.

The chooser's card is drawn from the canvas "Pickler Connect Link Wallet" (Claude Design project "Marketplace de agentes AI"): a tracked line naming the step, a title that ends in a coloured full stop, wallet rows with a status line under them (`Options` in `components/connect-modal.tsx`: idle, waiting with a ring on the mark, not available with the reason), a foot naming the connected wallet. The canvas draws the username, link, not-a-wallet and linked steps; the choice and sign-in steps wear the same card. Its colours are the dark surface's tokens, not the canvas's literals — the canvas's label grey fails the contrast floor on this ground — and it never names a wallet extension it merely detected.

`signInWithWallet` signs in through the connected adapter: an injected wallet signs the string on request, and the passkey wallet runs a ceremony restricted to the remembered credential and refuses a passkey that derives another address (`WrongPasskeyError`).

The account menu names which wallet you are looking at (`PASSKEY WALLET` or `BROWSER WALLET`), so a portfolio is never shown without saying whose it is. The passkey wallet has no chain of its own to be pointed at, so it is never "on the wrong network": `onTargetChain` is true for it and `canSwitchChain` is how a page asks whether the verb exists at all.

Signing in is the only thing either wallet signs here. Nothing sends a transaction: paying for a read, trading and enabling Perpl from the web are a later specification, and the buttons that would do it stay disabled with the reason on them.

**A wallet account is not a creator account.** The account at `/signin` is for people building agents, with a Turnkey wallet under a passkey for `app.pickler.fun`; the wallet account is for people reading and backing them. Do not fold one into the other.

`?wallet=choose|signin|username|prf|join|joined` opens the chooser on that step outside production, with a fixed sample address and nothing connected, so the design checks can measure steps that otherwise need a wallet's prompt or a session; `scripts/design/routes.mjs` proves `#connect-step-<step>` for each.

A wallet session belongs to one address. `lib/wallet-session.ts` keeps the token with the address and chain family it was issued for (`WalletSession`), and `decideSession(cached, connected, now)` is the only thing that hands it back: the same address with a token more than `EXPIRY_MARGIN_MS` from its `exp` reuses it, a different address or an expired or unreadable token signs again, and nothing connected has no session. `wallet-context.tsx` lets go of the session when the account changes or the wallet disconnects (a change of chain keeps it), and `dropWalletSession` signs the shared Supabase client out locally only when its session is that same user's and a wallet account's (`madeByWalletSignIn`: `app_metadata.pickler_account === "wallet"`). A studio account that linked the wallet is opened by signing in with it, but its session also came from a passkey, an email or Google, so a wallet switch never ends it. After a reload the page holds nothing while the browser is still signed in, so on mount a wallet account's session found on the client is adopted (`adoptSession`). The session does not record its address — the token carries a digest — so an `AdoptedSession` has none: it is never reused as a token (the next action signs again), and `releases(held, previous, next)` lets go of it on any change of address, on disconnect, and on connecting when nothing was connected. `session` on the context is derived from whose session is held, never stored. `signInWithWallet` answers `{ token }` or `{ error }` (`lib/wallet-sign-in.ts`, `signInAs`; `error: null` is a closed prompt), and a caller shows the error from that result — `sessionError` read after the await is the value of the render the call started in.

Three pages only mean something for a connected wallet — `/portfolio`, `/activity` and `/reads` — and they say so through `ConnectGate` rather than showing an empty table. Following an agent is kept in the browser against the address, so a different wallet in the same browser has a different list and nothing about it reaches a server.

What is real today: the address, the chain and the native balance. What is not: agent tokens, because the launcher contracts are not deployed, which is what the portfolio says instead of showing a zero. Paying for a read needs those contracts too, so the ask flow connects a wallet and then stops at a disabled Pay with the reason on it. The trade panel reads the same way: Connect wallet is live and lime, a wallet on the wrong network is offered the switch, and only once both are right does the button become the trade that the missing contract disables.

## One navigation bar

`features/site/site-nav.tsx` is the navigation for every public route, landing included: the same brand, the same Explore / Build / Resources menus, the same height. Only two things change. The landing hangs the price tape above it, and nowhere else does. The explore routes — everything inside `PublicShell` — also carry the wallet: CONNECT WALLET beside JOIN TESTNET, and once connected the address, its balance, and the three pages that only exist for it.

The apply flow and the auth screens keep their own bar on purpose — a flow that is asking for something should not offer six ways out of it — but the bar is the same height as the navigation and carries the same brand, so only the right-hand side differs. The brand mark is lit in cyan on every surface, the flows included. Lime stays for what the product does — a filled action, a win, a graduated token — not for who made it.

## Markets

`/markets` lists every perpetual market Perpl has open and `/markets/[symbol]` is one of them. The
API reads them from the venue through the parser the mobile app trades on
(`docs/specs/perps-board-live-v1.md`), and every market carries its `source`: the line over the
title names the venue, the network and the time of the read, adds `STALE` when the venue has not
answered since, and says `SAMPLE DATA` for the sample board (`sourceEyebrow` and `sourceFootnote`
in `lib/format.ts`). A count nobody has measured — agents reading, open calls — is `null` on the
wire and a dash on the page, never a zero; a `null` reach refuses no square. When the venue cannot be
read the API answers 503: the list shows its empty state with the catching-up line, and a market
page shows the error screen (`apiReadVenueItem`), because "market not found" would be untrue of a
market that exists. The market page reads its market once (`cache`) for the title and the body. Each market is a grid of
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
it, because the web sends no transaction yet: its wallets sign in and nothing else. Perpl's
contracts are deployed, and the mobile app trades on them; sending from here waits for its own
specification. What a sent
order would look like afterwards (no Perpl account, sent, filled, not filled) lives behind an
explicit **design preview**, and every one of those panels carries `DESIGN PREVIEW · NO ORDER
EXISTS` on its face. Never let one of them read as a position: nothing here has touched a chain.

`features/markets/lib/quote.ts` holds the preview arithmetic — size, liquidation, fee, the phrase
— against the venue's own limits for that market (`market.limits`: taker fee, maintenance margin,
slippage cap, smallest account), not constants of ours. It reads no value from another package, so
`apps/web/test/markets-format.test.ts` can load it; `lib/ticket.ts` re-exports it and adds
`leverageChoices`, which does. It moves to trading when an order is really sent. `lib/format.ts` owns every number the surface and the ticket print, so a price is written the
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
naming the agent to fund; a draft's wallet counts like any other, as the API's `fleet()` counts it,
and only an agent without a wallet is never named), then the draft limit: `draftLimitLock` counts the drafts
against `MAX_DRAFTS` (core's `MAX_DRAFTS_PER_WORKSPACE`, restated and pinned) and also closes when
the API's `canCreateAnother` already answers `draft_limit`. Every agent is created as a draft, so
the limit closes the entries before any wallet is made or funded. The create screen gets the same
note (`draftLock`): the wallet step's button and "Fund from master wallet" are shut, each saying
why (`walletLockNote`: "You're at the draft limit; open or delete a draft first."), and
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
404s, so the studio's home comes from `useStudioHref()` and a marketplace path from `useMarketplaceHref(path)`
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

`features/studio/shell/` holds what the draft studio and the live studio of a published Perpl agent
share (docs/specs/studio-live-v1.md L2); `draft/` keeps only what a private draft draws. The shell
is one implementation configured by props, never forked: `studio-shell.tsx` (`StudioShell`, the
frame: top bar, rail, preview note, header, tiles, failed read, section, the Wallets and credits
modals, with `useShellModals`), `top-bar.tsx` (global balances and account),
`agent-selector.tsx` (the existing workspace switcher above the sidebar navigation), `rail.tsx` (groups of items with `on`, `locked`, a
`badge` drawn above zero, and a footer slot), `header.tsx` (`StudioHeader`, `HeaderDot`,
`StudioTiles`), `status-chip.tsx`, `agent-avatar.tsx`, `banners.tsx`, `section.tsx`
(`StudioSection`, `#<idPrefix>-section-<key>`), `identity.tsx`, `master.tsx` (`Master`, which the
draft draws whole, and its two pieces `MasterCard` and `Ledger`, which the live Wallets draws with
its agent's wallet between them; `MasterCard`'s `copyChip={false}` drops the address's COPY chip, and
a view-only member's Fund is `aria-disabled` with `VIEW_ONLY_FUNDS` from `wallet-model.ts`),
`trade-soon.tsx`, `talk-soon.tsx`, `x-connect.tsx`, `setup-save.tsx`, `build-parts.tsx`
(`CapSteppers`, with an optional `sub` line under each row's title), `arrivals.tsx` (`useArrivals`
and `ArrivalList`: what arrived in an agent's wallet between two reads, both Limits) and
`web-sites.tsx` (`useSiteBox` and `WebSites`: WEB · WHERE EXA MAY LOOK with its site box, both
Sources & rules, `#<idPrefix>-sources-web`). The sidebar selector's new-agent item reads `newAgentLabel`
("+ New agent" by default; the live studio passes "Create another agent"). Every id
takes an `idPrefix` typed `StudioIdPrefix` (`"draft" | "live"`, `shell/model.ts`), so the draft's ids
are unchanged and a typo cannot move one; a rail item's id is `railItemId(idPrefix, key)`
(`rail.tsx`). `readMore` is held in a ref, so a reader that changes identity never reads again. `use-agent-studio.ts` is
the data core (wallets, X state, lazy ledger, `refresh`, setup, identity and X writes that reload
the agent, and the PREVIEW contract: a staged or preview studio reads nothing and every write
throws `PREVIEW`); `draft/use-draft.ts` is built on it through `readMore` and `StudioTools`, adding
the activity, the interval and Go Public. The pure rules are `model.ts` (rail and tile shapes),
`x-model.ts`, `identity-model.ts`, `build-model.ts` (brief, sources, a setup save's failure, a
wallet's read), `wallet-model.ts` (ledger, allocation row) and `clock.ts`; the draft's own are
`draft/model.ts`, `draft/caps-model.ts`, `draft/run-model.ts` and `draft/runtime-model.ts`. Shared rules live in
`shell/shell.module.css` (chrome, `srOnly`), `cards.module.css` (cards, pills, tags, Talk, Trade,
Master; its white and dark pills dim on `aria-disabled` as on `:disabled`), `x-connect.module.css`,
`build.module.css` (also the web's sites and the arrivals) and `identity.module.css`; a draft sheet composes them
under its own names. The bundler resolves one level of `composes`, so a class composing one that
itself composes names both, and `design:source` wants every shell class named by a shell component
or composed inside its own sheet.

The draft Console runs on the Perpl paper runtime (docs/specs/perpl-paper-runtime-v1.md R2, R17).
`use-draft.ts` reads `GET /perps/record`, `GET /perps/positions` and the newest check (the first
of `GET /perps/checks`, then `GET /perps/checks/:id`) with its other reads; their failures stay in
their own fields and never reach the shell's error, so a draft the runtime does not know still
opens. Only a record whose `runtimeEnabled` is true opens the Console; unread or false, the
Console, Trades and Overview's Trades keep the Soon state of D12, except that Trades' line
(`tradesNote`) says checks are paused by the operator while exits still run once the draft has a
paper account (R3). While it holds an open paper position, the header's IN YOUR POSITIONS and OPEN
P&L read its margin and P&L, labelled PAPER (`headerTiles(wallets, positions)` in `draft/model.ts`). Open, "Run it on paper"
(`runCheck`) posts a manual check with a fresh Idempotency-Key per press, and the check is polled
through `startPolling` every 1.5 s (`CHECK_POLL_MS`) until `finished`, then the positions and the
record are read again; a check found running on load is polled the same way, and a 409
CHECK_RUNNING reads and polls the running one. `runtime-model.ts` is pure and pinned in
`studio-draft-runtime.test.ts`: `runButtonView` ("Run it on paper" / "Running" / "Run it again",
shut with its reason while a check runs, at the manual limit or for a view-only member, always
with "N OF 6 TODAY"), `runState`, `didMeta`, `checkRefusal` (the words for MANUAL_LIMIT,
CHECK_RUNNING, RUNTIME_DISABLED, NOT_A_PERPL_AGENT), `stepLines` (What it did: each step timed
from the check's start, its dot from the runner's words, the last in the outcome's tone),
`outcomeCard` (the outcome tag, the call's instrument, action, probability and horizon, the paper
size of the position it opened, the entries met and held, exits met, never lines broken, the
rationale), `tradeRows` and `tradeCount` (Trades and Overview's newest three: open positions, then
closed, with P&L), `scheduleCopy` (Console's ON ITS OWN and Overview's switch row: "Unlocks with
the Perpl runtime" while it is off; once open, a draft runs only when you run it on paper and
requires publication, current preparation and explicit activation in Controls before hourly
checks; the interval picker is not drawn). Accept / Reject / Ask are decision review and stay out. The client calls are
the runtime block at the end of `api.ts` (`startPerpsCheck`, `perpsChecks`, `perpsCheck`,
`perpsPositions`, `perpsRecord`), which the live studio shares. `?stage=draft-console-ran` and
`?stage=draft-trades-active` stage one finished run (`DraftStaged.perps`); every other draft stage
has no runtime reads.

`features/studio/live/` is the studio of a published Perpl agent (docs/specs/studio-live-v1.md):
`studio.tsx` asks `studioKind(agent)` (`live/model.ts`: `draft`, `live` for a non-draft with
`config.perpl`, `legacy` otherwise, which keeps the old home and rail) and renders `LiveStudio`
whichever section was asked for; Go Public lands on its Overview, and a `?section=` key the live
rail also has carries over. `live-studio.tsx` configures the shell: the live strip under the top
bar (`live-strip.tsx`, the shell's `strip` slot), the rail of RUN / BUILD / MARKETPLACE / YOU with
Docs, Community, Support and "ITS PUBLIC PROFILE" (each http link in a new tab, `noopener
noreferrer`) in its footer, the shared account menu linking to the creator profile and sign-out,
the PUBLIC · RUNS SOON / PAUSED · EXITS ONLY chip, "Pause entries" /
"Resume" (real, `PUT /pause`, pending and inline failure) and "Stop · close all" shut with Soon,
the four tiles, and the degraded banner whose "Fix it" opens Limits. Section keys are the canvas's
(`skills` is Sources & rules, `master` Wallets, `leaders` Leaderboard). "Pause entries" / "Resume"
is one state for its two buttons, the header's and Controls' STOPS: `use-pause.ts`
(`usePauseToggle`, called once by `LiveStudio` and handed to sections as `LiveSectionProps.pause`)
marks both pending and says a failure under the one pressed. A section's own link to another
section ("Connect X", "Caps & limits") goes through `onSection`, which focuses the new section's rail
item, because the control pressed unmounts. A view-only member's writes stay focusable
(`aria-disabled`) and say why through `reason.tsx` (`Reason`, an `srOnly` line their
`aria-describedby` names, the same words in their title: `VIEW_ONLY_REASON`, `VIEW_ONLY_FUNDS`,
`pullReason` in `build-model.ts`). `live/model.ts` is pure and pinned in `studio-live-model.test.ts`:
rail, status, header line, tiles, strip, warnings, health (`healthIssues` counts the warnings and
every bad row; the brief row is always "v{n} · APPLIED", a noted L13 deviation, because Brief's
edits are dropped when Brief closes), meters, the five caps (`liveCaps`, `liveCapsStepper`;
`RISK_BOUNDS`, `RISK_DEFAULTS` and
`ENTRY_DEFAULTS` are literal copies of core's, pinned by a dynamic import, as is `liveEntry` against
`effectiveEntry`), how it enters (the small amount steps 1, 5, 10… to the per-trade cap), the
markets it watches and their SAMPLE DATA / STALE tag (a market the board does not list is drawn
neutral, `up: null`), the
brief's bar and versions, IT MAY, Posts' header, the directory, board and leaderboard, the wallet
cards and the account's rows; a field the DTO lacks reads "—". Every line that describes what the
runtime will do is worded there, at the source, as a description of the setting (draft spec D19):
the day-loss cap's "LOST IN A DAY · ONCE IT RUNS, IT PAUSES ITSELF THERE" and the three mode notes,
each "ONCE IT RUNS · …" with no timing, and the Limits line and the agent wallet card in the future
tense ("Pickler will hold every trade to these once it runs.", "Only {name} will trade from here");
the tests pin those strings.
`use-live.ts` is built on
`useAgentStudio` through `readMore` (versions, the board and one detail per watched market) and
reads the directory and leaderboard the first time their section opens; a failed live read sits in
its own field (`"failed"`), never in the shell's error; its `saveSetup` reads VERSIONS again after
every save, a refused one included (after a 409 CONFLICT the other writer's save is a version), so
the BUILD sections hand `live` straight to `useSetupSave`; `pause` is its one write of its own. The
marketplace reads are `marketplaceMarkets`, `marketplaceMarket`, `marketplaceDirectory` and
`marketplaceLeaderboard` in `api.ts` (browser, `/api/v1/marketplace/*`; `server/container.ts` is
server-only). Each section is its own file taking `LiveSectionProps` (`live-section.tsx`, whose
`LiveSection` is `#live-section-<key>`); Brief adds `stagedDraft` and Account `initialTab` and
`stagedPasskeys`.

The sections by file: RUN is `overview.tsx`, `positions.tsx` (also `FlatPositions`, which Overview
draws), `record.tsx`, `decisions.tsx`, `console.tsx` (the shell's `TalkSoon`) and `posts.tsx`, with
`sparkline.tsx` (WHAT IT WATCHES' trail, `aria-hidden` beside its words) and `run.module.css`; their
own rules are `run-model.ts` (empty lines, Decisions' filters, Console's words, the sparkline's
points; `studio-live-run.test.ts`). Posts' X glyph is `BrandMark` from `@pickler/ui`. BUILD is
`brief.tsx`, `sources.tsx`, `limits.tsx`, `controls.tsx` and `identity.tsx` with `build.module.css`,
on the shell's `setup-save.tsx`, `build-parts.tsx`, `arrivals.tsx` and `web-sites.tsx`; their rules
are `build-model.ts` (brief tags, plugins, stops, the entry form, the wallet card, the shut
reasons; `studio-live-build.test.ts`). Brief's and Sources' Apply stays drawn while a save has an
outcome ("Saved", the reload), so focus stays on it; Discard shows only with edits. MARKETPLACE is
`agents.tsx` (the directory), `markets.tsx` (the board) and `leaders.tsx` (the leaderboard): each
draws its read's loading, failed-with-Retry, empty and preview (`PREVIEW_NOTE`, a preview studio
that read nothing) states through `ReadNote`, and its Ask, Back and Trade buttons through `Shut`
(`market-parts.tsx`: `aria-disabled`, reachable, named "{label}, soon" with the reason in its
title, SOON); the owner's "Launch its token" gives `SHUT.launch` (`backReason`). YOU is
`wallets.tsx` (the shell's `MasterCard` worded for the live canvas, without its COPY chip since
Deposit copies the address, the agent's wallet card, the shell's `Ledger`) and `account.tsx` (a
tablist moved by arrow keys; only the selected tab names its panel, which is focusable;
Security with the account page's `PasskeyList` (`compact`: rows flush with the card, a wrapped
Remove kept right) and `useAddPasskey`, the list read again once a
passkey is added, the delegation rows and Sessions shut; Public profile with a PUBLIC PROFILE card
holding the account page's `ProfileSection` with `embedded` (only the link, the bio and its note;
`/account` draws the whole section), the WHAT SHOWS switches shut and the records line;
Notifications shut). Account reads the passkeys and the profile with the Supabase session when it
opens, and until the session is known "Add a device" is shut with no reason; a session that cannot
be read is an unread list. A staged studio reads neither (the stage's passkeys, `stagedProfile`); a
preview studio with no stage has no passkeys to show, so the list reads as unread. These five share
`market.module.css`, and their rules beyond `model.ts` are `market-model.ts` (`readState`, `SHUT`,
`READ_WORDS`, `backLabel`, `backReason`, `LEADER_ASK`, `liveAllocation`, `PASSKEY_NOTE`, `stagedProfile`,
`tabAfter`, `passkeyTag`; `studio-live-market.test.ts`).

The live studio shows the Perpl paper runtime (docs/specs/perpl-paper-runtime-v1.md §2, §3, §7)
once `GET /perps/record` answers `runtimeEnabled: true` (`runtimeOn` in `live/runtime-model.ts`), and
its paper also once the record answers `account: true` with the runtime off (`paperShown`): an
operator who turns the runtime off leaves the owner's positions open, still exited and closable
(R3), so positions with P&L, proposals (Enter shut with `ENTER_OFF_REASON`, Skip open), Record,
Decisions' feed, Close now, Stop · close all, the tiles, meters and rail counts stay, and the lines
say checks are paused (`RUNTIME_OFF_NOTE` "Checks are paused by the operator; exits and your closes
still run." under the positions' head and in place of "Run a check now", the chip "PAPER · CHECKS
PAUSED", the strip, the flat line, Auto-pause and HEALTH's "CHECKS PAUSED · EXITS RUN"); Limits'
wallet note (`pullNote`) stops saying it is flat. Unread, failed, or off with no paper account,
every screen keeps the "runs soon" copy above (draft spec D19). `use-live.ts` reads the record with
the other reads (`readMore`), then, with the runtime on or a paper account, the checks, positions
and proposals side by side (each failing alone into `"failed"`), the newest check's steps for the
strip (`lastCheck`) and the steps of any row opened (`checkDetails`, `readCheckDetail`), and older
pages of the feed (`readOlderChecks`). It polls through `lib/polling.ts`'s `startPolling`: every
30 s on Overview, Positions and Decisions while the page shows, and every 2 s while the manual
check (`checking`) has not finished or an owner action in `actions` is not settled. An approve, a
close and a stop are durable owner actions: the POST answers 202 `{ actionId }` and carries the
press's Idempotency-Key (one per press, kept while the answer is uncertain — none, or a 5xx — so
pressing again is the same action, as `runCheck`'s key is); each poll reads the unsettled actions
first (`GET /perps/actions/:id`), and once one is `done` its check (`GET /perps/checks/:checkId`)
for what really happened. `ownerActionView` in `runtime-model.ts` words it under the control
pressed (`ActionLine` in `runtime-parts.tsx`): "Sending…", queued for the worker, "Waiting for the
current check…" while a check holds the agent (`pending` with `lastError` CHECK_RUNNING), being
carried out, then the outcome (entered, not entered with the cap, closed, already closed) or
`lastError` in words (`actionErrorText`), with Dismiss. A card that went away with its action (the
position closed, the proposal approved) leaves the line at the head of its list (`GoneActions`).
The writes (`runCheck`, `approve`, `skip`, `closePosition`, `stopAll`, which also reloads the agent
because it pauses) throw a `StudioError` worded by `runtimeErrorText` (MANUAL_LIMIT,
RUNTIME_DISABLED, CHECK_RUNNING, POSITION_CLOSED, PROPOSAL_DECIDED, PROPOSAL_EXPIRED,
RUNTIME_UNAVAILABLE, RUNTIME_CEILING, AGENT_KILLED), said inline under the control pressed. The
client calls are `api.ts`'s runtime blocks: the reads and `startPerpsCheck` shared with the draft
Console, and the live studio's own `perpsChecksBefore`, `perpsProposals`, `approvePerpsProposal`,
`skipPerpsProposal`, `closePerpsPosition`, `stopPerps` and `perpsAction`. With it on: the chip reads LIVE · ON PAPER (`runtimeStatus`); TODAY, OPEN and PUT IN
TODAY are today's realized P&L, the open P&L and today's new margin (`runtimeTiles`; EQUITY stays
the wallet's AUSD); the strip is the newest check (`runtimeStrip`: time, outcome, duration, steps,
the all-time count, its steps as the log); the rail badges are the open positions and the
proposals waiting (`runtimeCounts`); Overview draws "Waiting on you" (`ProposalCards`: the canvas's
card, the check's entry lines, Enter / Skip, a countdown to `expiresAt` that ticks every second) and
"Its positions" (`PositionCards`, compact: the line, the stop–target meter, Close now); Positions
draws the full cards (figures, meter, time stop, entry, mark, liquidation, Close now, "Why this
trade") and then WHAT IT WATCHES; Record draws the paper equity sparkline, five figures
(`recordView`) and the closed list (`closedRow`); Decisions draws "Run a check now" (`RunCheck`,
`manualCheckView`: the day's manual checks of 6, shut at the limit), the six filters with real
counts over what was read (`runtimeFilters`; Posted stays 0) and a row per check (`decisionRow`)
that opens on its rationale, its entry / exit / never lines and its timed steps (`stepRows`); no
per-decision chat (Console stays Soon). "Why this trade" goes through `LiveSectionProps.onWhy`,
which opens Decisions on that one check (`focusCheck`, read with its steps if the feed lacks it)
until "Every decision" or any other way into the section. Controls' STOPS (`runtimeStopRows`) make
"Stop · close all" real on paper, the header's and Controls' each a `StopAll` with an inline confirm
(`stopConfirm`) and no passkey; Auto-pause reads ON · DAY-LOSS (R11 runs; gas, credits and losing
Perpl are said to come with live trading); HOW IT RUNS says it
checks hourly on paper (`runtimeEntryView`); the meters are today's (`runtimeMeters`); HEALTH adds
the runtime's state and "Model cost today ≈ $x" (`runtimeHealthRows`, `costLine`; AI credits stay
Soon); Limits' day-loss line and its note say what runs now (`runtimeCapsView`). The parts are
`live/runtime-parts.tsx` with `live/runtime.module.css`; the rules are `live/runtime-model.ts`, pure
and type-importing only, pinned in `apps/web/test/studio-live-runtime.test.ts`. `live/fixture.ts`
stages the runtime off on every `perpl-*` stage (a record with `runtimeEnabled: false`) and on, with
checks, a BTC long, an ETH proposal, closes and a record, on `perpl-live-active` (Overview),
`perpl-decisions-active`, `perpl-record-active` and `perpl-positions-active` (Positions, with an
hourly check running and the owner's close of the BTC long waiting for it, staged in
`LiveRuntimeStaged.actions`), and off with the BTC long still open on `perpl-positions-paused`;
`scripts/design/routes.mjs` proves `#live-overview-proposals`, `#live-decisions-feed`,
`#live-record-equity`, `#live-action-close-pos-preview-btc` and `#live-positions-open-off` for them.

`?stage=live|researching|decided` (`home/stage.ts`, outside production only) renders the home from
`home/fixture.ts`, `?stage=draft*` the draft studio from `draft/fixture.ts`, `?stage=perpl-*`
(`LIVE_STAGES`, spec §7) the live studio from `live/fixture.ts` (Perpl's board, but the labelled
sample board on `perpl-markets`), and `?stage=empty` and
`?stage=create-*` the create screen (`StudioStage`); the run stages come from the canvas's run, built from real event types on a fixed clock so the server's
HTML matches the browser's. It is gated on the build alone, because
`previewAllowed` also needs Supabase unconfigured. The staged home reads no session, fetches
nothing, disables every write and says it is a preview. `scripts/design/routes.mjs` proves one id
per stage.

## Custody boundary

No private key is ever derived or held by the studio, the account or the auth screens. Custody of
the person's Pickler wallet there belongs to Turnkey, and a passkey registered against
`TURNKEY_RPID` (`app.pickler.fun`) exists to authorise activities — never to be read as key
material by anything else. The one place this app derives a key is the marketplace's Mera passkey
wallet, from a passkey of another relying party (`pickler.fun`), for the length of one ceremony
(see "The wallet"); ESLint keeps that code out of these screens' modules and Turnkey out of that code, and at run time the passkey wallet refuses the studio's host. A
connected wallet is authenticated server identity only once it has signed in.

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
exempt and claims its handle in the wallet chooser's username step (`wallet/components/connect-modal.tsx`)
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
`/signup?state=passkey`, `/passkey?state=add`, `/portfolio?state=connected`, `?wallet=`) and a route that
proves it. A route proves an id the screen itself renders, never a container that is there
whatever it holds: each studio section's root carries `studio-section-<key>` and the Soon panel
`studio-soon-<key>`. A new screen gets a route in the same change.

## API documentation transport

The existing `/api/v1/[...path]` transport also forwards `/api/v1/openapi.json` to the API Worker's
public generated document. The web owns no duplicate specification or route catalogue. See
[API contract](../../docs/api-contract.md). This requires an API deployment to become remotely
available; no new web business endpoint is introduced.

## Studio strategy version 2

Studio setup selects a versioned common strategy; legacy absent selection resolves combined@2.0.0; new agents use combined@2.1.0.
New check results expose `strategyResult` with per-market proposals, three-state brief findings,
execution outcomes, funding status and incompleteness. Historical fields retain their recorded
values and are null/empty for new results rather than fabricated percentages. Model costs remain
USD micros, separately from virtual financial metrics; unknown daily costs stay null. The API
retains workspace authorization and generated OpenAPI. The web displays the strategy in both
agent studios and explicitly confirms clearing unsupported authored conditions for rules.
See [Studio perpetual execution](../../docs/studio-perps-execution.md).

## Initial Studio navigation

`features/studio/shell/pending.tsx` uses the modern Studio header and the shared expanded/icon rail preference during the initial session/agent read and on load errors. `studioLanding` must remain pending until that read completes, even when partial agent data has arrived. Never render the legacy section frame as a loading placeholder: its rail toggle moves the brand during account-to-Studio navigation.

## Creator access requests

The New agent access warning offers an authenticated request, never a passkey prompt or implicit
approval. `features/studio/access-request.tsx` is also Account's Creator access section. It reads
and posts `/v1/studio/access-request`; repeated requests keep the first timestamp. Preview controls
never send requests. Server-authorized operators see a pending inbox in that section, using
`SUPER_ADMIN_EMAILS`; ordinary users never receive another user's request. These are internal inbox
notifications, not email/Slack/Telegram delivery. Approval remains the existing operator command.

## Creator access layout and loading

The creation screen places the sole creator-access request panel inside Its wallet, step 0,
rather than above the identity form. Pending requests show a status tag and one secondary refresh
action; wallet creation stays blocked. On narrow screens this access card precedes the form.
The second-passkey reminder follows the setup fields. Account retains its own access section and
server-authorized team inbox. Request submission and permission checks remain unchanged.

`features/studio/skeleton.tsx` composes the shared UI `Skeleton` for workspace, wallet, access and
row reads. Initial Studio/Account reads, creator access, agent wallets, wallet modals, passkey lists
and handle availability use placeholders, not visible loading text. Accessible busy/status labels
remain. Errors retain retry actions; an unread or failed balance is never represented as zero.
`create-access`, `create-access-pending` and `create-access-loading` are inert non-production
creation fixtures for layout checks; none reads or submits an access request.

The shared Wallets modal exposes `Refresh balances` through the owning screen's existing wallet
read. Creation, home and agent Studio use the same control; no transfer or passkey authorization
is sent by refreshing. Balance and button placeholders use Skeleton while pending. Keep the
selected wallet, token, direction and typed amount mounted, disable transfers until the read
settles, and preserve last-known balances with a retryable error on failure. Reject duplicate
refresh presses and disable refresh during a transfer or on inert previews. The controlled
`scripts/design/studio-loading.mjs` regression covers successful and failed refreshes without
wallet writes or external requests.

The modal's network badge comes from the wallets response's `chainId`, resolved with public
`@pickler/chain` metadata. It labels all displayed balances and transfers as Monad Testnet or
Monad mainnet; never infer this from APP_ENV, SIWE or the agent's Perpl market configuration.
Absent/unknown network metadata shows an explicit unavailable state and disables transfer actions
until a successful refresh identifies it. This is a network indicator, not a chain selector:
the API deployment still selects the balance and custody transfer network. Controlled fixtures
declare their network and the browser regression verifies both labels and unavailable handling.

## Studio account menu

`features/studio/shell/account-menu.tsx` is the account disclosure for creation, home, draft,
live, legacy and pending Studio headers. Supply the authenticated creator's profile handle from
Studio's existing read, never the selected agent's handle. Hover and keyboard focus reveal the
username to the left by smoothly expanding the account chip in the header flow. The preceding
wallet, network and credits controls slide left while the account icon stays anchored on the right. The disclosure composes the shared shadcn `DropdownMenu`; Radix owns arrow-key navigation,
Escape, outside interactions, collision-aware placement and focus restoration. The profile item
renders the existing Next.js link with `asChild`. Do not add document listeners for menu behavior.
`/account?section=profile` opens the public-profile tab in every environment; other section query
links remain non-production design controls. Sign-out uses Supabase Auth, navigates only after
success, preserves errors and disables duplicate submissions. Design previews cannot sign out.
The busy sign-out action uses the shared Skeleton with an accessible status label. Menu rows have
separate hit areas and an inset focus outline; profile focus must not paint over sign-out. Preview
sign-out remains disabled, uses the standard exit icon and has a visible, associated explanation.
Run `node scripts/design/account-menu.mjs` for the controlled desktop/mobile interaction check,
alongside web tests, typecheck, lint and rendered design checks. It uses local fixture servers only.

The draft/live navbar contains global controls only. Their shared sidebar holds the existing
agent switcher and the selected agent wallet’s AUSD/MON balances. The status appears once beside
the agent name in the content header. On small screens the official mobile Sheet contains vertical navigation. Moving
that switcher must preserve its permissions, agent IDs and New agent callback. The draft status
is rendered once in the content header. Desktop header controls stay on one row during account expansion; the account
chip may shrink to the available width and its icon never leaves the pointer. At widths of 640px
or less, hover expansion is disabled. The selected-agent navbar keeps its controls on one row. The 360ms expansion reverses
once on pointer exit, rather than repeatedly entering/leaving a relocated icon.

Account profile links include a local `returnTo` carrying the active agent, section and any
non-production preview stage. `shell/account-return.ts` accepts only the Studio home path for
that host (`/` on the dedicated Studio host, `/studio` on shared hosts) and filters query keys.
Never send account return links to arbitrary origins or use unbounded browser history as the
fallback. `resume` restores only a section from the selected studio's existing rail registry;
agent selection still uses the authenticated workspace list. Preview stages remain disabled in
production. Returning restores navigation, not unsaved form edits. Direct Account visits fall
back to the host's Studio home. The controlled account-menu check covers round trips on desktop
and touch screens, including sections selected after the initial page load.

## Collapsible agent sidebar

The shared draft/live shell and pending frame compose the installed shadcn Sidebar from
`@pickler/ui/sidebar`. `shell/sidebar.tsx` only bridges the existing `lib/rail.ts` desktop
preference to the controlled `SidebarProvider` and labels `SidebarTrigger`. It does not implement
collapse, mobile state, keyboard listeners, animation or focus handling. Desktop widths remain
218px and 64px. shadcn owns state, layout slots and interactions; shared UI styling synchronizes
the gap/container, labels and header contraction with 320ms easing. Menu button nodes, row heights
and icon padding stay stable. Tooltips retain their trigger tree on desktop; only collapsed
TooltipContent mounts. Never reparent buttons when toggling state.

Below 768px, shadcn opens a modal Sheet with vertical navigation, backdrop, Escape dismissal,
focus containment and return to the navbar disclosure. Mobile state is separate from the saved
desktop preference. Selecting a section closes the Sheet. The same provider and skeleton menu
components render during loading. Do not restore the retired inline mobile rail or custom toggle
hook. Cmd/Ctrl+B is handled in the shared component with an editable-field/repeat guard.
Reduced motion disables the shared Sidebar, Sheet, DropdownMenu and Tooltip animations.

The agent switcher composes SidebarHeader/Menu/Button with shadcn DropdownMenu and the shared
paired `chevronsUpDown` icon. Preserve product/runtime IDs, permission checks and callbacks.
Rail groups, item badges, tooltips and footer links use shared Sidebar components. Locked sections
still open the existing explanatory panels; their labels include the reason, without granting
management access. No collapse or menu interaction changes agent configuration or backend rules.

Tailwind 4 is limited to installed shadcn components, with a `tw:` prefix and no preflight.
`postcss.config.mjs` compiles the utilities; root layout imports `@pickler/ui/shadcn.css`, which
also includes the existing Pickler stylesheet. Semantic colors/radii/shadows map directly to
`--pk-*` in that stylesheet. Existing CSS Modules and controls retain their presentation.
Use the package public subpaths, never relative imports into the UI package. See
[UI instructions](../../packages/ui/AGENTS.md) for adding or updating registry components.

## Studio layout and motion

The shell is a chrome wrapper with a global header, a body containing Sidebar and a single main
content landmark, and portal dialogs. The pending frame follows the same landmark hierarchy.
The selected-agent navbar keeps the global wallet/credits/account controls on one row at every
supported width. At 768px and below, the brand shows only its logo while retaining the link's
accessible name. At 560px and below, wallet and credits become labelled 38px icon buttons opening
the same existing dialogs; the wallet's accessible name retains its actual balances. Network and
account controls remain visible. Do not force a second controls row or hide an actionable control
to make the selected-agent header fit. Sidebar state never changes navbar dimensions.

The body is an inline-size container. The desktop reading measure is derived from its full width,
the configured expanded sidebar width and main padding, capped at 1120px. Collapsing navigation
centers the same canvas smoothly rather than reflowing cards. Below 768px the Sheet does not take
layout width and content uses the available mobile width. Use CSS for layout, not React resize
state, frame-by-frame DOM measurements or global `transition: all`.

Metrics and draft Overview/Build and live Build grids use explicit screen breakpoints rather than
`auto-fit` thresholds that change mid-collapse. Responsive row changes occur at documented screen
sizes; they are not animated as if CSS could interpolate grid row counts or text wrapping.
`scripts/design/sidebar-motion.mjs` checks both directions at 1440/1086/900/768px, DOM identity,
fading labels, geometry synchronization, stable content measure and vertical placement, then
resizes through the mobile and grid breakpoints. It is part of the Design rendered CI job and can
reuse an explicit loopback fixture with `DESIGN_BASE_URL`. Keep the account-menu acceptance for
keyboard, mobile Sheet and profile-return interactions.

The sidebar motion acceptance also checks delayed hover labels, pointer exit/activation, dropdown
return-focus without stale tooltips, genuine keyboard labels, collapse reset, and navigation icon
focus/stroke geometry on draft/live fixtures. Do not disable keyboard focus or remount menu controls
to clear a tooltip.

The Studio selector's 26px avatar uses stable 11px inline padding in `shell.module.css`, aligning
with the collapsed navigation center line. Shared Sidebar group buttons contract to centered
32px controls so active/hover backgrounds remain symmetric around their icons.

## Route loading indicator

The server root layout mounts `nextjs-toploader` once for both products, using `--pk-lime`,
a three-pixel fixed bar, no spinner and no shadow. Use the library's `useRouter` from
`nextjs-toploader/app` for programmatic `push`/`replace`; ordinary Next.js links remain unchanged.
Do not add another progress timer or navigation listener. Hash-only changes and sidebar section
selection are not route loads. Reduced-motion preferences disable bar transitions. This global
navigation indicator complements component Skeletons; it does not report model or trading progress.
The controlled account-menu acceptance delays a real local route response and verifies the bar
appears without layout displacement, then clears after navigation.

The top-loader's router object changes on every render. Effects that load Studio, Account or
passkeys depend on its memoized `replace` method, never on the whole object: otherwise state
updates cancel in-flight reads and restart loading. Keep the component cleanup guards.
`node scripts/design/studio-loading.mjs` exercises authenticated presentation with synthetic
session cookies and delayed API responses on dedicated loopback ports 3012/8812. It verifies
completed reads, bounded request counts, visible failure and missing-wallet redirection without
`?stage=`. This is a client regression test, not backend authorization or live-provider acceptance.

## Wallet ownership and transfers

`shell/wallet-balance-button.tsx` is the shared account-balance disclosure for creation and
agent Studio. Its `Master wallet` label identifies the creator's wallet, independently of the
selected agent. AUSD uses the official Agora mark from UI's BrandMark; MON keeps Monad's mark.
These balances share one control, never a combined total or an implied conversion.

Agent cards say `Agent wallet` or name the agent. `Add funds to agent` opens the existing Wallets
modal focused on that wallet; `Return to master wallet` reverses the same transfer flow. The focused
view displays From/To names and addresses, available balance for the selected asset, network,
and the existing passkey review. `All wallets` returns to the creator/agent overview. Reuse the
same transfer model, prepare/confirm endpoints and refresh ownership; do not create another wallet
picker, signer or transaction implementation. Persisted `master` identifiers and section keys
are unchanged even where their visible labels now say `Master wallet`.

The shared agent selector reads balances from the existing wallet list, matched by the selected
agent’s wallet ID; it never reads the master wallet or sends additional requests. Each asset uses
its own official mark. Unknown amounts use Skeletons, not zero. The balance row remains mounted
and fades/contracts with the existing sidebar motion; it is hidden from assistive technology
when the desktop rail is collapsed. Status stays in the content header beside the agent name,
alongside published-agent controls.

## Dynamic Studio markets

The shared shell/trading-markets selector is used by new, draft and live Sources & rules. It
composes shadcn DropdownMenu checkbox items with catalogue search and removable selected chips.
The menu exposes every returned market, including disabled rows with their blocking reasons;
multiple selections keep it open. Radix owns navigation, dismissal and focus restoration.
Preserve
forms/selections on read failures, use Skeletons and explicit retry, and never auto-select real
markets. Console distinguishes loading/read-error/confirmed-disabled/available; chat remains
non-actionable. Preview catalogue fixtures are not functional acceptance. The testnet selector preview uses the
public capture in `shell/perpl-testnet-catalogue.fixture.json`, obtained through PerplMarketData's
production catalogue adapter. Its preview clock is synthetic; never use that capture as a live
fallback or as evidence of current market availability. Production reads the protected Studio
catalogue endpoint, which fetches Perpl's original public context. The navbar wallet icon identifies
the master balance group; AUSD and MON retain their separate asset marks.

See [agent-selected Perpl markets](../../docs/studio-perpl-markets.md).
