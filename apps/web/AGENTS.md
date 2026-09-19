# Web app instructions

Read [the root instructions](../../AGENTS.md) first. Before changing a dependency, read that package's own `AGENTS.md`. Keep this file current when app structure, server boundaries, commands, or conventions change.

## Responsibility and current state

`@pickler/web` is the Next.js App Router application. It owns presentation, HTTP transport, and the server composition root. Business logic and provider implementations live in separate workspace packages so the backend can later move to `apps/api`.

The app serves the Pickler landing page ("Pickler Landing" design canvas), the creator application at `/apply` ("Pickler Join" canvas), the token board at `/tokens`, token pages at `/tokens/[ticker]`, pick pages at `/tokens/[ticker]/picks/[pickId]`, the agents directory at `/agents`, agent pages at `/agents/[handle]`, the ask flow at `/agents/[handle]/ask`, paid reads at `/reads` and `/reads/[id]`, and `/leaderboard` ("Pickler Public" canvas), `GET /api/v1/health`, `GET /api/v1/landing`, `POST /api/v1/waitlist`, `GET|POST /api/v1/applications`, and `GET /api/v1/tickers/availability`. Health is a liveness check, not a check of databases or external services. Supabase authentication screens are implemented; token purchases and paid-read execution remain unavailable.

Auth screens ("Pickler Sign Up" canvas): `/signup` (method + email/password + terms, then name + @handle) and `/signin` (wallet or email), under `app/(auth)` with Manrope and `noindex`. They are not linked from the landing while the waitlist is the public entry point. Authentication uses Supabase Auth in the browser (`@supabase/ssr`, publishable key; wallet sign-in is Sign-In with Ethereum via `signInWithWeb3`). Name and handle are stored through the API worker (`GET /v1/handles/:handle/availability`, `GET|POST /v1/profile`), never written from the browser to the database. With email confirmation on, the details wait in user metadata and the profile is created on first sign-in; `/signup?complete=1` finishes a profile for a signed-in user. Without `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_PICKLER_API_URL` the screens render with a "not connected" notice and cannot submit. "Open the studio" is disabled until the studio exists.

Apply flow: a new waitlist signup sets the httpOnly `pk_apply` cookie (`src/server/http/apply-cookie.ts`) holding the seat's apply token, and the landing form redirects to `/apply`. The token is a bearer secret: keep it out of URLs, logs, and client code. `/apply` shows the form, the submitted state with referral sharing, or a "get in line first" screen without a seat. Share links are `/?ref=<code>`; the landing form forwards `ref` on signup. A repeat signup for the same email gets the cookie only from the browser that already holds it. Sending the "come back" and invite emails is not implemented.

Public pages, and which product each one is about:

- `/tokens` — the token board. Filters (`stage`, `sort`, `q`, `view`) live in the URL and are applied client-side over the full list. Cards carry the chain marks: the Pickler curve on Monad before graduation, Pons on Robinhood Chain after it.
- `/tokens/[ticker]` — the token: chart, buy panel, and what the agent is buying. The ticker slug is the ticker without `$`, lower-cased (`/tokens/half`). The buy panel shows a quote only; its button stays disabled until launcher contracts and wallet connection exist.
- `/tokens/[ticker]/picks/[pickId]` — one pick with its receipt and trail.
- `/agents` — who takes a paid read, on what, for how much. Ordered by the API: agents that are taking questions first, then by how close their stated odds have been to what happened. The beat filters come from the data, not from a list.
- `/agents/[handle]` — the agent itself: activity, its public answers, and the record under both. Addressed by Pickler handle, the namespace shared with people (`identity.handles`).
- `/agents/[handle]/ask` — compose and review a paid read. An agent that is not taking questions redirects back to its profile. Paying needs the testnet contracts and a wallet, so the pay button stays disabled and says so.
- `/reads` — the connected wallet's reads, filtered by the two clocks. `/reads/[id]` is the card an answer is written on.
- `/portfolio` — what the connected wallet holds: balance from the chain, what it has spent on reads, and why there are no agent tokens yet.
- `/activity` — the agents this wallet follows, as they act. Following lives in the browser, keyed by address.
- `/leaderboard` — ranked by calibration, with the published weights, the said-vs-happened plot and, underneath, the platform in numbers (`?range=7d|30d|90d`, read on the server). `/analytics` redirects here: the numbers are the context for the ranking, not a page of their own.

Buying a token never funds the agent's budget, and the agent's budget never buys its token; keep that separation in the copy and in the links.

Data source, chosen in `src/server/config.ts`: `PICKLER_DATA_SOURCE=supabase` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` uses Supabase for waitlist/applications; public landing and agent-directory snapshots still use labelled sample adapters; otherwise the app serves labelled sample data and an in-memory waitlist. See `.env.example`. The page renders the snapshot on the server, and `LandingDataProvider` refreshes it from `/api/v1/landing` every 30 seconds while the tab is visible.

```text
src/
  app/
    layout.tsx                 # Root layout and global/shared styles
    page.tsx                   # Server Component: loads the landing snapshot
    error.tsx                  # Fallback when the data source fails
    globals.css                # Base styles
    api/v1/health/route.ts      # HTTP presentation adapter
    api/v1/landing/route.ts     # Landing snapshot DTO, short shared cache
    api/v1/waitlist/route.ts    # Waitlist signup; sets the apply cookie
    api/v1/applications/route.ts        # Read or submit the cookie holder's application
    api/v1/tickers/availability/route.ts # Ticker availability check
    apply/page.tsx             # Creator application
    tokens/page.tsx            # Token board
    tokens/[ticker]/page.tsx   # One token: chart, buy panel, its calls
    tokens/[ticker]/picks/[pickId]/page.tsx # Pick detail
    agents/page.tsx            # Agents directory: who takes a paid read
    agents/[handle]/page.tsx   # The agent: decisions, thinking, record, answers
    analytics/page.tsx         # Redirect to the leaderboard
    portfolio/page.tsx         # What the connected wallet holds
    activity/page.tsx          # The agents it follows
    reads/page.tsx             # Reads
    reads/[id]/page.tsx        # One read: the card the answer is written on
    leaderboard/page.tsx       # Ranking and reputation weights
    not-found.tsx
  features/auth/
    components/                # Sign-up flow, sign-in card, done view, side panels
    lib/                       # Supabase browser client, Pickler API client, account flows, password meter
    auth.module.css
  features/agents/
    ../site/site-nav.tsx       # The one public navigation bar
    components/                # Token board and page, agents directory, agent page, ask flow, reads, leaderboard and the platform numbers, activity row, chart, buy panel, pick detail, nav shell
    lib/                       # Board filters (server-safe), formatting, reputation wording
    agents.module.css
  features/apply/
    components/                # Form, submitted view, no-seat screen
    lib/options.ts             # Category and personality swatches, ticker helpers
    apply.module.css
  features/landing/
    components/                # Sections; client components read LandingDataProvider
    lib/                       # Data provider, accents, formatting
    landing.module.css         # Design tokens, layout, animations
  server/
    config.ts                  # Data-source selection from environment
    container.ts               # Protected composition root
    http/                      # DTO mapping, apply cookie, JSON body parsing, safe error responses
  lib/accent.ts                # Accent colour custom properties shared by features
public/brand/                  # Logo, mascot and chain marks (Monad, Pons, Robinhood) exported from the design
```

In sample mode the in-memory store is pinned to `globalThis`, because Next.js loads pages and route handlers as separate module instances. Animations pause for `prefers-reduced-motion`. Sample data shows a "SAMPLE DATA" tag in the footer; keep that label whenever sample data is served.

## Three-layer rules

| Layer          | Location                                              | Owns                                                                                   | Must not own                                             |
| -------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Presentation   | `src/app`, future `src/components` and `src/features` | Pages, UI state, input parsing, authentication at the transport boundary, HTTP mapping | Business decisions, database queries, provider SDK calls |
| Business       | `packages/core/src`                                   | Domain rules, use cases, authorization decisions, dependency interfaces                | Next.js, React, HTTP objects, ORM/provider SDKs          |
| Infrastructure | `packages/infrastructure/src`                         | Repositories, provider/RPC adapters, technical error translation                       | HTTP responses, React components, product policy         |

`src/server/container.ts` is the composition root, not an additional business layer. It imports use-case factories and concrete adapters, wires them together, and exposes callable services. Its `server-only` import prevents client consumption. Any additional server facade or module that accesses credentials must also be protected with `server-only`.

Presentation must obtain services through `@/server/container` or a protected server facade. Do not directly import `@pickler/core` or `@pickler/infrastructure` from pages, components, or Route Handlers; the current ESLint configuration rejects these imports outside `src/server`. Do not bypass this restriction with relative cross-package paths or new re-export barrels.

Execution flows from handler to use case to adapter. Source dependencies point toward business: presentation → business ← infrastructure. The business layer owns each port; infrastructure implements it.

## Working example: health across all three layers

The snippets below describe the existing implementation. Read their actual source files before modifying them.

**1. Business port — `packages/core/src/ports/clock.ts`:**

```ts
export interface Clock {
  now(): Date;
}
```

**2. Use case — `packages/core/src/application/get-health.ts`:**

```ts
import type { Clock } from "../ports/clock.js";

export function createGetHealth(clock: Clock) {
  return () => ({ status: "ok" as const, checkedAt: clock.now() });
}
```

The use case receives an interface. It does not instantiate adapters or import Next.js.

**3. Infrastructure adapter — `packages/infrastructure/src/index.ts`:**

```ts
import type { Clock } from "@pickler/core";

export const systemClock: Clock = {
  now: () => new Date(),
};
```

**4. Composition — `src/server/container.ts`:**

```ts
import "server-only";
import { createGetHealth } from "@pickler/core";
import { systemClock } from "@pickler/infrastructure";

// Composition root: wire concrete adapters here, not inside business logic.
export const services = {
  getHealth: createGetHealth(systemClock),
};
```

**5. Presentation — `src/app/api/v1/health/route.ts`:**

```ts
import type { HealthResponse } from "@pickler/api-schema";
import { services } from "@/server/container";

export const runtime = "nodejs";

export function GET() {
  const health = services.getHealth();
  const body: HealthResponse = {
    status: health.status,
    checkedAt: health.checkedAt.toISOString(),
  };
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
```

The handler converts the internal `Date` to the public ISO string DTO. HTTP status, headers, serialization, and transport validation belong here or in shared HTTP helpers. This read-only endpoint has no inputs or authorization requirement; it is not a template for omitting those checks on business operations.

## Folder example for a new business feature

The following `bookings` feature is illustrative; it is not implemented and does not imply a selected database or provider. Create only the files a real feature needs.

```text
apps/web/src/
  app/
    bookings/page.tsx                        # Server-rendered presentation
    api/v1/bookings/route.ts                 # GET/POST transport adapters
  features/bookings/
    components/booking-form.tsx              # Client Component when interactive
  server/
    container.ts                            # Wire repositories into use cases
    http/
      errors.ts                             # Safe error-to-status mapping
      parse-create-booking.ts               # Runtime request validation
    auth/
      require-actor.ts                      # Resolve verified identity
packages/core/src/features/bookings/
  domain/
    booking.ts                              # Entities and invariants
    errors.ts                               # Domain-specific failures
  application/
    create-booking.ts                       # Authorization and orchestration
  ports/
    booking-repository.ts                   # Persistence interface
packages/infrastructure/src/bookings/
  booking-repository.ts                     # Actual provider implementation
packages/api-schema/src/bookings.ts          # Public request/response DTOs
packages/core/test/create-booking.test.ts    # Use-case and rule tests
```

Export new public functionality through each package's declared entry points and declare new workspace dependencies. Do not import another package's internal file directly. Keep request validation and response mapping out of core, and keep domain invariants out of the form and Route Handler. Client-side validation may improve UX but never replaces server validation.

## How to implement a feature

1. Define the operation, business invariants, and permissions. Put entities, domain errors, use cases, and ports in core. Pass plain inputs and a verified actor into use cases; never accept `NextRequest`, cookies, framework sessions, or an identity trusted from the request body.
2. Add tests for the rules and authorization behavior, including rejection paths. Use test doubles for ports in tests only. A use case must be testable without starting Next.js or contacting a provider.
3. Implement required ports in infrastructure. Keep SDK types inside the adapter. Validate external responses and translate failures into errors understood by core. Do not instantiate provider clients inside the use case.
4. Wire dependencies in the protected server composition root. Keep per-request identity and mutable request state out of module-level shared services.
5. Define public DTOs in `api-schema`. Validate untrusted HTTP input at runtime before calling a use case; TypeScript interfaces are not validators. Serialize dates and large integers deliberately rather than exposing internal objects.
6. Implement a thin Route Handler: parse and validate input, obtain verified identity, invoke the service, map output, and translate known failures. Return safe errors for unexpected failures and log diagnostic details only on the server. Set a caching policy appropriate to the data.
7. Add the UI. Prefer a Server Component calling a protected server facade directly for server-side reads. Use `/api/v1/*` from Client Components or external consumers. Do not make server-to-self HTTP requests just to reuse a handler.
8. Run relevant checks and update the affected projects' `AGENTS.md` files. If test files move outside the root test script's current glob, update discovery explicitly.

## Next.js and security conventions

- Use named HTTP method exports in `route.ts`, App Router, and the Node.js runtime. Keep route-specific transport behavior inside the app.
- Keep components server-rendered by default. Add `"use client"` only at interactive boundaries. Never import server facades or infrastructure into Client Components.
- Follow the installed Next.js version's asynchronous request APIs: await dynamic params, `cookies()`, and `headers()` when using them.
- Authenticate at the transport boundary; enforce business permissions in the use case. Treat Server Actions, if introduced, as public entry points with the same validation and authorization requirements.
- Keep credentials server-side. `NEXT_PUBLIC_*` values are public. Never expose provider credentials, private keys, or internal errors to the browser.
- Do not share authenticated or user-specific responses in a public cache. Choose caching and invalidation for each data flow explicitly.
- Keep long-running jobs, event indexing, and transaction confirmation loops outside the request lifecycle when those features are introduced.
- Wallet signing belongs at the client wallet boundary. Server-side blockchain reads belong in infrastructure behind business ports; public ABIs and deployment metadata belong in `packages/chain`.
- Put reusable, product-independent components in `packages/ui`; keep booking forms, wallet connection flows, and other product-specific UI in this app.

## Commands and validation

Run from the repository root:

```sh
npm run dev
npm run typecheck --workspace=@pickler/web
npm run lint
npm test
npm run build
```

Use root `npm run build` and `npm run typecheck` when validating changes across packages. For behavior changes, verify affected HTTP methods, runtime input rejection, safe failures, caching, and the UI flow as applicable. The existing health test covers core behavior only; it is not an end-to-end test suite.

## Design system

Shapes, control sizes and button variants live in `@pickler/ui` (see its `AGENTS.md`): pill for actions and chips, 16 for cards, 12 for inputs and tiles, 6 for small marks. Feature stylesheets reference the `--pk-radius-*` tokens and never hard-code a radius. Each shell declares its surface: the landing, apply and public pages use `data-surface="public"`, the auth screens use `data-surface="console"`, which is the dashboard's tone. Type is the same on both: Chakra Petch for titles and the lead figure of a view, JetBrains Mono for tabular data and labels, Manrope for body text and every control.

Controls come from `@pickler/ui`: `Button`/`ButtonLink` for actions (`glow` is the lit marketing call to action — the hero, the waitlist, the application), `Chip` for filters and toggles (`ChipLink` when it navigates, `ChipText` when it only reads), `Segmented` for an exclusive choice that is always on screen, `Tag` for read-only status, `Meter` for a filled track, `Icon` for every icon. Feature stylesheets keep only what a control does differently and pass it through `className`; they do not re-declare shape, type or state. Colour is the same: each sheet aliases the system tokens (`--ink: var(--pk-ink)`) and holds no literal. Panels take the shared surface with `composes: pk-panel from global` instead of redeclaring a border and a radius.

Market data is drawn with `CandleChart` and `BarChart` from `@pickler/ui` — the price panel on a token page and every series under the leaderboard. Features hand them timestamped buckets and nothing else; colours and type come from the surface. The library's own logo is off, so `PublicShell` carries the TradingView credit its licence asks for; any new surface that shows a chart needs that credit too.

## The wallet

`features/wallet/` owns the connection: an EIP-1193 conversation with the injected wallet, no connector library. It asks for accounts, reads the chain and the native balance, follows `accountsChanged` and `chainChanged`, and offers to switch to Monad testnet using the metadata in `@pickler/chain`. It never signs or sends anything — connecting is a read that tells the site which address to show a portfolio and a read history for.

**Connecting is not signing in.** The creator account at `/signin` is for people building agents; the wallet is for people reading and backing them. Do not fold one into the other.

Three pages only mean something for a connected wallet — `/portfolio`, `/activity` and `/reads` — and they say so through `ConnectGate` rather than showing an empty table. Following an agent is kept in the browser against the address, so a different wallet in the same browser has a different list and nothing about it reaches a server.

What is real today: the address, the chain and the native balance. What is not: agent tokens, because the launcher contracts are not deployed, which is what the portfolio says instead of showing a zero. Paying for a read needs those contracts too, so the ask flow connects a wallet and then stops at a disabled Pay with the reason on it. The trade panel reads the same way: Connect wallet is live and lime, a wallet on the wrong network is offered the switch, and only once both are right does the button become the trade that the missing contract disables.

## One navigation bar

`features/site/site-nav.tsx` is the navigation for every public route, landing included: the same brand, the same Explore / Build / Resources menus, the same height. Only two things change. The landing hangs the price tape above it, and nowhere else does. The explore routes — everything inside `PublicShell` — also carry the wallet: CONNECT WALLET beside JOIN TESTNET, and once connected the address, its balance, and the three pages that only exist for it.

The apply flow and the auth screens keep their own bar on purpose — a flow that is asking for something should not offer six ways out of it — but the bar is the same height as the navigation and carries the same brand, so only the right-hand side differs. The brand mark is lit in cyan on every surface, the flows included. Lime stays for what the product does — a filled action, a win, a graduated token — not for who made it.

## Paid reads

An agent sells one thing publicly: a read. Someone picks one of its markets, pays, and gets back a probability with the reasoning, the sources and the limits under it. The question is never written by the person asking — every read asks whether the named market is above its price at delivery 24 hours later — which is what makes two answers comparable and an agent's record meaningful. `readQuestion` in core writes it; the DTO carries it so a page never re-derives it.

Two clocks run per read and they are separate in the UI as well as the data. Delivery is what the agent owes inside its stated window, and the money returns if it misses. Evaluation is what the market did afterwards; `not_evaluable` is an honest gap and counts neither way. Asking is violet everywhere it appears, so it never reads as backing the token.

Nothing charges yet: the pay button carries the note rather than pretending. A read is not a trading permission, and the copy says so on the review step and on the card.

## Dashboard and the public site

The dashboard for creators is built by the infrastructure owner on top of `apps/agent-service`; this branch owns the public surface: landing, `/apply`, the auth screens, `/tokens`, `/agents`, `/reads` and `/leaderboard`. Keep the two apart inside `app/`: public routes and `features/` folders here, dashboard routes in their own segment, and no shared component edited by both without saying so in this file.

## Planned agent pilot

The [agent runtime V1](../../docs/specs/agent-runtime-v1.md) has a research-only pilot in the separate `apps/agent-service` host. See its README for the current laboratory API. Future web routes act as authenticated facades: verify workspace access, forward trusted scope server-to-server, and expose safe run status/events. Keep Mastra runtime and worker code out of the frontend. The proposed routes are not implemented; the specification lets frontend work proceed independently.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

The public Worker and Next.js routes coexist: profiles/authenticated agent reads use `workers/api`,
while growth endpoints remain Next.js Route Handlers. Neither surface currently maps product
workspaces to research tenants. Preserve sample labels until a real, authorized adapter replaces
them; never use laboratory tokens in browser code. See [integration boundaries](../../docs/frontend-integration.md).
