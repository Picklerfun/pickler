# Landing Trade and Create Agent v1: the marketplace front door and the creator application

Status: implemented from the owner's canvases on 2026-10-08, decisions below taken by the
implementing agent and listed for the owner to confirm or reverse. Branch
`codex/landing-trade-create-agent`, from `main` at `a7dede3e`.

Canvases (Claude Design project "Marketplace de agentes AI", `c03aadb4-7bb2-429e-aa49-98ae4218bc1f`):
`Pickler Landing Trade v2.dc.html` for `/`, `Pickler Create Agent.dc.html` for `/create`, and the
four mobile screens the landing shows inside its phones: `Sign In Mobile Light`, `Wallet Mobile
Light`, `Agents Mobile Light`, `Market Mobile Light`.

## 1. Problem

The landing at `/` is the waitlist landing (`Pickler Landing Waitlist`): PREDICT, a picks tape, a
mascot card, FOUR MOVES and an email box. The product it describes is the one creators build in the
studio. The product people arrive at now is the marketplace: hire an agent for a read, back its
token, trade the perp next to its call, from the phone first. The owner redrew the front door for
that ("ASK IT. BACK IT. TRADE IT.") and redrew the application page as a public form.

The application page `/create` today opens only for a browser that joined the waitlist from the
landing in the same session (the `pk_apply` cookie); otherwise it shows "GET IN LINE FIRST" and
sends people back to the landing's email box, which the new landing no longer has.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reversible? |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| L1  | **`/` is rebuilt from `Pickler Landing Trade v2`**, section for section: nav, news pill, headline, hero phone with the question/answer bubbles, INVEST IN WHAT COMES NEXT (hire / back / trade), FOUR STEPS with its phone, NOTHING HIDDEN (record, ask, keys, curve), QUESTIONS, BEAT THE MARKET, footer. The tape, the mascot card, FOUR MOVES, RUNS ON and the waitlist email box are removed.                                                                                                                                                                                                                                                                                                                        | yes         |
| L2  | **The only live datum on the landing is the announcement pill**, which keeps reading `/api/v1/landing`. Every other figure on the page is copy inside an explanatory card (a candle game, a chat, a curve) and is drawn as the canvas draws it: animated, decorative to assistive technology, still under `prefers-reduced-motion`. None is presented as a platform statistic; the stats row of earlier canvases is not drawn.                                                                                                                                                                                                                                                                                           | yes         |
| L3  | **One navigation bar, `SiteNav`, on both pages.** Radix menus retain responsive groups and keyboard behavior. Build does not duplicate the primary creation action. The bar's action "Create agent" goes to `/create` on the marketplace, where before it went to the studio's entry: the studio is behind an invite, and the application is the way to one. A second, quiet pill beside it reads "Get the app" and goes to `/#app`. On `/create` the secondary link reads "Trade with AI" (to `/`); the single primary action remains "Create agent" (to `/create`). On small screens both links move into the compact menu footer. The landing passes `connect`, so the wallet sits in its bar as the canvas draws it. | yes         |
| L4  | **The four phone screens are static mockups**, one component each under `features/landing/components/phone/`, built from the mobile canvases' default state at 441px, `aria-hidden` and never interactive. The hero shows Market; the FOUR STEPS panel shows the step's screen (Sign in, Wallet, Agents, Market). Importing the mobile app's own components is not an option: the app is Expo and the web is Next.js.                                                                                                                                                                                                                                                                                                    | yes         |
| L5  | **The App Store buttons are live only with a link.** `NEXT_PUBLIC_APP_STORE_URL` names the TestFlight or App Store page; unset, the two "Download on the App Store" controls are drawn `aria-disabled` with the reason in their title ("The TestFlight link is not public yet"). "Get the app" goes to the `#app` section either way.                                                                                                                                                                                                                                                                                                                                                                                    | yes         |
| A1  | **`/create` is public and the email is a field of the form.** Sending runs two existing requests in order: `POST /api/v1/waitlist` with the email (and `?ref=` when the page was opened with one), which seats the browser with the `pk_apply` cookie, then `POST /api/v1/applications` with the six answers. No API, schema or core change.                                                                                                                                                                                                                                                                                                                                                                             | yes         |
| A2  | **A seat is still bound to a browser.** An email already in line, typed in a browser that does not hold its seat, is refused by the existing rule (`createJoinWaitlist`): the form says "This email is already in line. Finish from the browser you signed up with." and keeps the answers. A browser that already holds a seat with an application sees the SUBMITTED screen on load, read server-side as today.                                                                                                                                                                                                                                                                                                        | yes         |
| A3  | **The limits are core's**: name 40, edge 140, why-you 200. The canvas's 280 for why-you is a drift from the canvas, not a decision; `APPLICATION_LIMITS_DTO` is the one source and the counters read it. The ticker availability check, the server's field errors and `already_submitted` recovery are kept from the current form.                                                                                                                                                                                                                                                                                                                                                                                       | —           |
| A4  | **The SUBMITTED screen follows the canvas**: "{NAME} IS IN LINE.", the batch line, access under the submitted email, "Post it from @handle" (the X intent with the applicant's referral link, as today) and "Back to the markets" (`/markets`), with WHAT YOU SENT beside it. The position-in-line figure and the copy-link control of the current screen are not drawn; the referral still travels in the post.                                                                                                                                                                                                                                                                                                         | yes         |
| A5  | **`/create` is the light surface**, as the canvas is, with the dark hero card, the arena and the YOUR PIECE well nested inside it. `ApplyShell` (dark, its own bar) and `NoSeat` are deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | yes         |
| A6  | **Accepting an applicant is out of scope.** Applications land in `growth.applications` as `submitted`, as today; the owner reviews them and the invite email is a later piece.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —           |

## 3. The landing, block by block

Light page; every dark block is a subtree taking `data-surface="dark"` (`design-system-v2.md`).

1. **Nav** — `SiteNav` with `connect`, "Get the app" → `#app`, "Create agent" → `/create`.
2. **News pill** — the first announcement from the snapshot, dismissible (unchanged component).
3. **Headline** — "ASK IT. BACK IT. TRADE IT." with three coloured full stops (violet, amber, lime);
   the lead; two actions: "Get the app" (lime, to `#app`) and "Create an agent" (ink, to `/create`).
4. **Hero phone** (`#hero-phone`, dark) — THE APP · MONAD TESTNET and iOS · TESTFLIGHT tags, a violet
   glow, the Market screen floating, and two bubble columns: YOU on the left, THE AGENTS ANSWER on the
   right. Six question/answer pairs cycle on a 2.4 s tick: question in, answer in, both hold, next
   pair. Hidden under 900px. The bubbles are `aria-hidden`; the closing line "Hire. Back. Trade. The
   agents show their work; you decide what to do with it." is read.
5. **INVEST IN WHAT COMES NEXT** (`#how`) — three dark cards: HIRE → `/agents`, BACK → `/tokens`,
   TRADE → `/markets`. (The canvas sends BACK to the agents page; the launchpad is `/tokens`.)
6. **FOUR STEPS** (`#app`) — four step buttons on the left (the chosen one lifts), "Download on the
   App Store" (L5), and the dark phone panel (`#steps-phone`) showing the step's screen with the
   STEP 0n · NAME label.
7. **NOTHING HIDDEN** — four panels on `--pk-panel`: the record (BTC 64,120 dashed mark, columns of
   cells dropping above or below, "CANDLE CLOSED · SETTLED" flash every eight), the ask (a fixed
   chat: question, HIRED · 2 AUSD · ESCROW, Unlock Watch's 0.38 card, DELIVERED, "Short it. 3×,
   small.", the passkey sheet), the keys (the 9×9 pixel lock), the curve (`$PRNT` filling to $5,000,
   GRADUATED, holding, starting over).
8. **QUESTIONS** — six questions, one open at a time, the first open by default.
9. **BEAT THE MARKET. READY?** (`#download`, dark) — the two download/create actions and "iOS ONLY
   FOR NOW · ANDROID LATER".
10. **Footer** — the seven swatches, AGENTS, MARKETS, THE APP, CREATE AN AGENT, PICKLER · 2026.

Hover lifts and colour changes come from the system controls where a control exists (`ButtonLink`,
`Chip`); the canvas's bespoke pills (the hero actions with a round arrow badge) are feature CSS
reading tokens.

## 4. The application, block by block

1. **Nav** — `SiteNav` without the wallet, "Trade with AI" → `/`, "Apply" → `#apply`.
2. **Hero** — the dark card (`#apply-hero`): CLOSED TESTNET · MONAD · CREATORS, "TELL US WHAT YOU
   WOULD BUILD.", the lead, "Apply for a seat" and the batch line; beside it the mascot card with A
   FEW CREATORS A WEEK and the `$PICK` curve strip (PRE-GRAD → GRADUATED loop).
3. **What an agent is** — three panels: it calls in public, it trades inside your caps, it earns when
   traders ask.
4. **The arena** (`#arena`, dark) — AGENTS FIGHT FOR THE LIQUIDITY: five rows whose AUSD moves between
   them every 2.2 s weighted by hit rate, THE POOL total, the last three flows, YOUR SEAT.
5. **THE APPLICATION** (`#apply`) — the form (`#apply-form`) and the YOUR PIECE rail:
   - INVITE GOES TO: the email field (new; A1).
   - 01 NAME IT AND PICK ITS TICKER (ticker suggested from the name, availability checked).
   - 02 ITS X ACCOUNT. 03 WHAT WILL IT CALL? (eight chips). 04 GIVE IT A PERSONALITY (six chips with
     the sample line). 05 WHAT EDGE DOES IT HAVE? (140). 06 WHY YOU, FOR THIS CATEGORY? (200).
   - "Send it", lit only when all six are in, within limits, the email has an `@` and the ticker is
     not invalid or taken; the hint beside it counts what is left. The progress label over the
     section reads "N TO GO" / "ALL SIX IN" / "TRIM THE LONG ANSWERS" / "SENT".
   - YOUR PIECE: the email block, then one block per answer dropping in; IF YOU GET A SEAT, three
     lines.
   - Sending: `submitting` disables the button; a waitlist refusal or an application error is said
     under the button and the answers stay. Field errors from the API land on their cards.
6. **SUBMITTED** (A4), replacing the form in place.
7. **Footer** — swatches, TRADE WITH AI, AGENTS, MARKETS, PICKLER · 2026.

The pure rules live in `features/apply/lib/form-model.ts` and are pinned in
`apps/web/test/apply-form.test.ts`: `answersOf`, `progressOf`, `canSubmit`, `blocksOf`,
`tickerHint`, `sendHint`, `waitlistRefusal`. `options.ts` keeps the swatches, the batch copy and the
ticker/handle helpers.

## 5. Design harness

- `routes.mjs`: `landing` proves `#how`, light; `apply` (renamed from `apply-no-seat`) proves
  `#apply-form`, light.
- `surfaces.mjs` `MUST_NEST.landing` becomes `["#hero-phone", "#how-hire", "#steps-phone", "#download"]`
  and gains `apply: ["#apply-hero", "#arena", "#apply-piece"]`.
- Every colour is a `--pk-*` token; the violet glow the canvases paint under the phones is a new
  token, `--pk-glow-violet`, defined per surface in `packages/ui/src/styles.css`.
- Animations pause under `prefers-reduced-motion: reduce`; the record, the bubbles and the curve then
  show their first frame.

## 6. Out of scope

The acceptance email and any operator screen over `growth.applications` (A6); a TestFlight link
(L5); Android; the mobile app itself; a change to how a seat is issued (A2).

## 7. Reviewing applications (added 2026-10-08, owner's request)

The point of the application is to filter. `growth` is used by this flow and nothing else, so the
review lives on it:

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Reversible? |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| R1  | **`growth.applications` records the decision**: `reviewed_at`, `reviewed_by` (the operator's email), `decision_note`, `invited_at` (migration 0039). `status` keeps its three values; `growth.review_application(id, status, note, reviewer)` is the only thing that changes it, and it accepts `invited` or `rejected` only.                                                                                                                                                                                                                                                                       | yes         |
| R2  | **Only super admins review.** Core's `createApplicationReview` refuses any principal that is not a user on `SUPER_ADMIN_EMAILS`. The API is `GET /v1/studio/applications` (newest first, `?status=`) and `PUT /v1/studio/applications/:id`.                                                                                                                                                                                                                                                                                                                                                         | yes         |
| R3  | **The inbox is in the studio's Account › Creator access section**, under the notice, for operators only: filters by status, the six answers, Invite / Reject with an optional note. The preview draws it from fixture rows.                                                                                                                                                                                                                                                                                                                                                                         | yes         |
| R4  | **The studio no longer asks for an access request.** A signed-in person without creator access reads "Not approved yet", that the team reads every application and the decision is checked in Account, with a link to `/create`. `POST /v1/studio/access-request` is retired, with core's `request` and the adapter's write; the two GETs stay (own status, and the requests recorded before this).                                                                                                                                                                                                 | yes         |
| R5  | **Inviting turns studio access on, by email** (migration 0040). `growth.review_application` enables `pickler.research_access` for an account that already carries the invited email; an account created afterwards claims its invite as it onboards (`growth.claim_invite`, called by `onboard(userId, email)`). The studio's notice reads the application under the account's email (`growth.application_status_for`): in review, invited, not accepted, or none. The acceptance email is still a later piece with its own provider and template; the operator command remains for the exceptions. | yes         |
