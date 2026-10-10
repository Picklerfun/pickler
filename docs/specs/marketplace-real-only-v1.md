# Marketplace, real only v1: what exists is connected, what does not says soon

Status: requested by the owner on 2026-10-08 ("ya no quiero nada hardcodeado"); decisions below
taken by the implementing agent and listed for the owner to confirm or reverse. Branch
`codex/landing-trade-create-agent`, after `docs/specs/landing-trade-v1.md`.

## 1. Problem

The marketplace's navigation offers six destinations, and the product behind them is uneven:

| Destination        | Today                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Agents             | Real: `/marketplace/directory` and `/marketplace/personas/:handle` read public agents from the DB.     |
| Markets            | Real on Perpl when `PERPL_BOARD_NETWORK` is set; otherwise the API serves a **sample board** labelled. |
| Tokens             | Reads the real launch catalogue, which is empty until the launch contracts exist.                      |
| Leaderboard        | Reads analytics and a ranking from the DB that mean nothing yet.                                       |
| Reputation         | A link to `/leaderboard#score`.                                                                        |
| The landing's pill | `/api/v1/landing`, a **sample read model** (the announcement is invented).                             |

Two of those can still show invented data in a product build (the sample board, the sample
landing), and three are doors to rooms that are not furnished. The owner wants the invented data
gone and the unfurnished rooms announced as coming, not linked.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reversible? |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| N1  | **The navigation links only what is real.** Explore: Agents (`/agents`), Markets (`/markets`), Tokens · SOON, Leaderboard · SOON. Build: Create Agent (`/create`), MCP & Skills · SOON, Reputation · SOON. Resources stay as they are. A SOON row is announced, never linked (the bar's existing convention).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | yes         |
| N2  | **The routes behind SOON go away**: `/tokens`, `/tokens/[ticker]`, `/tokens/[ticker]/picks/[pickId]` and `/leaderboard` answer 404 until their product exists. Their components stay in `features/agents` for when it does; the design harness drops their routes. The wallet's three pages (`/portfolio`, `/activity`, `/reads`) are untouched: they read a connected wallet and real reads.                                                                                                                                                                                                                                                                                                                                                                                                                        | yes         |
| N3  | **No sample board in the product.** `createSampleMarketBoard` leaves the API: without `PERPL_BOARD_NETWORK` the markets endpoints answer 503 `VENUE_UNAVAILABLE`, which the pages already render as "catching up" (list) and the error screen (one market). `SAMPLE DATA` labelling stays in the web for the one place that still serves a sample: the design harness's fixture API.                                                                                                                                                                                                                                                                                                                                                                                                                                 | yes         |
| N4  | **No sample landing.** `/api/v1/landing`, `createGetLanding`, the sample landing read model, the web's `LandingDataProvider`, the news pill and `landingSchema` go. The landing is copy and illustrations, served with no API call. The waitlist count that rode on it has no reader left.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | yes         |
| N5  | **The landing's three ways follow the navigation.** HIRE → `/agents`, TRADE → `/markets`; BACK keeps its card and copy but its call to action is a SOON tag, not a link, because the launchpad is not open. The footer's links follow (AGENTS, MARKETS, THE APP, CREATE AN AGENT).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes         |
| N6  | **The landing's illustrations stay as illustrations.** The phone screens, the bubbles, the candle game, the curve and the chat are the canvas's worked examples of the mechanics, drawn `aria-hidden` and never presented as a figure of the platform (landing-trade-v1 L2). They are not data and this spec does not replace them with reads; if the owner wants live figures on the landing, that is a design question for a later canvas.                                                                                                                                                                                                                                                                                                                                                                         | —           |
| N8  | **The hero's bubbles are the agents' real actions** (owner's request, same day). `GET /v1/marketplace/activity` lists the newest finished checks of the Perpl paper runtime for public, living agents — the call (instrument, side, odds, window) and the outcome (`entered`, `exited`, `held`, `blocked`, `proposed`, with the runtime's own words) — never the rationale, the steps or the cost. The landing reads it at render: the tape above the bar runs through them — ticker or handle, the call, what came of it, labelled ON PAPER — and with nothing on record the tape is not drawn. The hero's dialogue beside the phone stays the canvas's worked example (N6): it is there to show the kinds of action, not to report any. The harness's fixture API serves invented actions for the invented agents. | yes         |
| N7  | **Samples live only with the harness.** The sample agents already do (`scripts/design/fixtures/`); the sample market board and the sample landing move there too, so a product build cannot import them. The fixture API keeps serving every route the harness measures, the removed ones excepted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | yes         |

## 3. What changes, by layer

- `workers/api`: `marketBoardFor` returns `null` for an unset or unknown network and the markets
  routes answer 503 then; `growthRoutes` loses `/landing`; `createGrowthServices` loses `landing`.
- `packages/core`: `createGetLanding`, the landing read model port and types go.
- `packages/infrastructure`: `createSampleLandingReadModel` and `createSampleMarketBoard` move to
  `scripts/design/fixtures/` (the harness imports them from there); the package's index stops
  exporting them.
- `packages/api-schema`: `landingSchema` and `LandingResponse` go.
- `apps/web`: `site-nav.tsx` MENUS per N1; `app/tokens/**` and `app/leaderboard` deleted; the
  landing stops reading the API (`app/page.tsx` renders `LandingPage` with no snapshot;
  `landing-data.tsx` and `news-pill.tsx` deleted; `ways.tsx` draws BACK with a SOON tag);
  `server/container.ts` loses `getLanding`, `listLaunches`, `getAgentProfile`, `getPickDetail`,
  `getPlatformAnalytics`, `getLeaderboard` only if no page reads them any more — the `/reads` pages
  and the agent persona keep theirs.
- `scripts/design`: routes for `/tokens*` and `/leaderboard` removed; the fixture API serves the
  sample board and sample landing from the fixtures folder; `surfaces.mjs` unchanged.
- Docs: `apps/web/AGENTS.md`, `workers/api/AGENTS.md`, `packages/infrastructure/AGENTS.md`,
  `docs/specs/perps-board-live-v1.md` B9 note (sample board is harness-only now).

## 4. Out of scope

Live figures on the landing (N6); the launchpad and the leaderboard themselves; the reads' payment;
the mobile app.
