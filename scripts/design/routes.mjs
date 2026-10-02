// The five screens this change builds, and the ground each must paint. Everything in scripts/design
// reads this, so a route added here is a route every check covers.
// `task` is the plan task that builds each screen. A route that answers 404 has not been built yet
// rather than broken, and naming the task turns "this is missing" into "this is not your turn".
//
// `proves` is the floor, and it is the most important field here. /studio once answered 200 and
// rendered a sign-in stub, so all four checks walked 33 elements of the stub and reported green.
// A check that matches nothing reports what a check that passes reports. So every route names
// something the real screen contains and a stub cannot, and a route that does not show it is
// reported like a route that never loaded: named, not measured, not counted as passing.
//
// The checks run with authentication switched off (lib/servers.mjs), which is what lets the studio
// and the account render from their preview fixtures. A server with it on sends both to /signin.
//
// A selector is preferred over `floor`, a minimum count of text-carrying elements, because a count
// drifts into passing as a stub grows. `floor` is only for screens with no authored hook to point
// at yet. Every route must carry one or the other; render.mjs refuses a route with neither, since a
// route nobody wrote a floor for is exactly the route this was built to catch.
// `act` is for a screen that is a click deep rather than a URL away: `{ click, proves }`, clicked
// after the route has proved it loaded. It must always carry its own `proves`, and that selector
// must name something only the post-click screen has — the hook is otherwise a way to report green
// for the screen before the click, which is this file's oldest failure wearing a new shape.
//
// `settles` is for a screen still busy when the network goes quiet, such as a debounced request:
// `{ gone }` names the busy state, and the page is read only once nothing matches it
// (lib/settle.mjs). A state that never clears is reported as blocked, not waited past.
//
// It is not an alternative to `?state=` and `?section=`. Those exist because a wallet connection
// and a Supabase session are states no click produces, so a dev-guarded parameter in shipped code
// was the only way in and was worth its cost. A click is not a door: Playwright already has clicks,
// so a state a person reaches by clicking needs nothing added to the product to reach here.
//
// `product` is which host owns the route, by the same first-segment rule
// apps/web/src/server/hosts.ts applies: /studio and /account are the studio, everything else here
// is the marketplace. In development the middleware is inert and both answer on one origin, so this
// field does nothing locally — it decides which base URL a check measures once the two products sit
// on two. render.mjs refuses a route that has no `product` rather than falling back, for the same
// reason it refuses a route with no floor: the fallback would be a number about the wrong server,
// and a number about the wrong server is indistinguishable from a number about the right one.
import { only } from "./lib/only.mjs";

const ALL = [
  {
    path: "/",
    name: "landing",
    product: "marketplace",
    surface: "light",
    task: "Task 9",
    // The section the canvas is built around. Present only when the landing itself rendered.
    proves: "#four-moves-title",
  },
  {
    path: "/portfolio",
    name: "portfolio",
    product: "marketplace",
    surface: "light",
    task: "Task 10",
    // The gate now carries the hook this asked for. It was `floor: 15` against a gate that renders
    // twelve, which blocked the route it was guarding — and a count could not have said whether
    // that was a thinner gate or a stub, which is the reason the selector form is preferred.
    proves: "[data-connect-gate]",
  },
  // Everything on the portfolio below its heading is behind a connect gate, and nothing here has a
  // wallet to pass it with — so a check on /portfolio alone measures the gate and calls the screen
  // green. ?state=connected renders the connected state without one, outside production only.
  {
    path: "/portfolio?state=connected",
    name: "portfolio-connected",
    product: "marketplace",
    surface: "light",
    task: "Task 10",
    proves: '[role="tablist"][aria-label="What this wallet holds"]',
  },
  // The portfolio opens on the only tab with rows, so the two tabs with no source behind them —
  // which are the ones carrying the copy that says so — are never on screen for a check to read.
  // `?tab=` puts one there.
  {
    path: "/portfolio?state=connected&tab=positions",
    name: "portfolio-no-positions",
    product: "marketplace",
    surface: "light",
    task: "Task 10",
    // The panel, not the tablist: this proves the tab the query param asked for is the one on
    // screen, so a param that stopped working is caught rather than measured.
    proves: "#portfolio-panel-positions",
  },
  // Not one of the five canvases: the leaderboard inherits the marketplace shell and was never
  // measured, which is why two labels wearing <h2> sat there in the wrong face for the whole of
  // this change. A route nobody checks is where a defect lives longest, and this one has no task
  // coming to find it.
  {
    path: "/leaderboard",
    name: "leaderboard",
    product: "marketplace",
    surface: "light",
    task: "Inherited",
    // Two screens, one of which must be present. #leaderboard-empty is the launch-day screen:
    // nothing has settled, so the page draws that instead of an empty table. #score is the weights
    // panel of the populated board, authored on this page and on no stub. A page that has neither
    // is the stub this pairing refuses.
    proves: "#leaderboard-empty, #score",
  },

  /* The marketplace, which is the larger half of what had never been rendered in a check.
   *
   * Twelve screens — the agent directory and a profile, the ask flow, the token board and a token
   * and one of its calls, the market board and a market, the reads list and a read, the follow
   * feed, the application — and the same claim was made about all of them that was made about the
   * (auth) group: that every colour a route can reach resolves to a token. It was withdrawn there
   * because nobody had looked, and this is the same withdrawal, six screens larger.
   *
   * Every parameterised path below names a value the sample adapters actually serve, taken from a
   * link the index page renders rather than invented: `halftime` and `tapereader` are handles in
   * createSampleAgentDirectory, `half` is its slug, `half-1` one of its calls, `r1` a read,
   * BTC-PERP a symbol in createSampleMarketBoard. An invented one answers 404, which this file
   * reports as "not built yet" — the one wrong answer available here.
   */
  {
    path: "/agents",
    name: "agents",
    product: "marketplace",
    surface: "light",
    task: "Marketplace",
    // Two screens, one of which must be present. #agents-empty is the launch-day screen: no agent
    // exists yet, so the directory draws that instead of a beat filter with nothing under it. The
    // other selector is the populated directory — the beat filter is authored there and nowhere
    // else, and the row proves it has agents in it. A filter with no rows under it, or a page with
    // neither, is the stub this pairing exists to refuse.
    proves: '#agents-empty, main:has([role="group"][aria-label="Beat"]) a[href="/agents/halftime"]',
  },
  {
    path: "/agents/halftime",
    name: "agent-profile",
    product: "marketplace",
    surface: "light",
    task: "Marketplace",
    // The activity panel, on a page that also carries this agent's token link. The panel alone
    // would report green for any profile; the token link says it is Halftime's, which is the
    // /signin-and-/signup lesson one prop smaller — the persona page is one component for nine
    // agents, so a selector that proves only the composition proves nothing about the data.
    proves: 'main:has(a[href="/tokens/half"]) #panel-activity',
  },
  {
    path: "/agents/halftime/ask",
    name: "agent-ask",
    product: "marketplace",
    surface: "light",
    task: "Marketplace",
    // COMPOSE, which is step one of three and the only one a GET reaches. The market chooser and
    // the sentence under the fixed question both belong to that step: REVIEW replaces them, so
    // this proves the step as well as the screen. Steps two and three are unmeasured and named as
    // such in the report rather than quietly counted here.
    proves:
      'main:has([role="group"][aria-label="Market"]) p:text-is("clock starts at delivery · equal counts as no")',
  },
  {
    path: "/tokens",
    name: "tokens",
    product: "marketplace",
    surface: "light",
    task: "Marketplace",
    // The launch catalogue with rows in it: the harness's fixture API serves two launches, and
    // the link proves the first of them is on the board. #launch-board-empty is the screen the
    // product shows today, and a page showing it here means the fixture was not what answered.
    proves: '#launch-board a[href="/tokens/HALF"]',
  },
  {
    path: "/tokens/half",
    name: "token",
    product: "marketplace",
    surface: "light",
    task: "Marketplace",
    // The calls panel, on the page that links back to the agent it belongs to. Same pairing and
    // same reason as the profile: one component serves nine tokens.
    proves: 'main:has(a[href="/agents/halftime"]) #calls-title',
  },
  {
    path: "/tokens/half/picks/half-1",
    name: "token-pick",
    product: "marketplace",
    surface: "light",
    task: "Marketplace",
    // The trail and the post, which are the two blocks this screen exists for and which no list
    // page draws.
    proves: "main:has(#post-title) #trail-title",
  },
  {
    path: "/markets",
    name: "markets",
    product: "marketplace",
    surface: "light",
    task: "Markets",
    // The coverage filter is the board's own; the row proves markets under it.
    proves: 'main:has([role="group"][aria-label="Coverage"]) a[href="/markets/BTC-PERP"]',
  },
  /* One market, and the two things a square can be. This is the screen that matters most here and
   * the one that has escaped every sweep, because the part of it where a person commits money is
   * the ticket, and the ticket only fills once a square is clicked.
   *
   * These two routes reach the two modes and not the filled ticket. `?side=` is not a verification
   * door: the board's own ASK and TRADE buttons link to it and `page.tsx` reads it in production,
   * so this is the product's path and costs nothing to measure. What it reaches is each mode's
   * empty ticket — "PICK A SQUARE TO ASK." and its trade twin — which is a real authored screen,
   * but it is not the trade ticket. Margin, leverage, the liquidation line, the review phase and
   * the preview strip are all behind a click and all still unmeasured; reaching them needs a door
   * this file does not have, and inventing one silently is how a screen gets reported green.
   *
   * Each proves its own grid, by the label the squares carry in that mode. The grid is the half a
   * stub cannot have; the mode-specific wording is the half that says `?side=` did what it says.
   */
  {
    path: "/markets/BTC-PERP",
    name: "market-ask",
    product: "marketplace",
    surface: "light",
    task: "Markets",
    proves: '[aria-label^="Ask whether BTC-PERP is above"]',
  },
  {
    path: "/markets/BTC-PERP?side=trade",
    name: "market-trade",
    product: "marketplace",
    surface: "light",
    task: "Markets",
    proves: '[aria-label^="Long BTC-PERP to"]',
  },
  /* The ticket with a square in it, which is the half of this screen where a person commits money
   * and the half nothing had ever rendered. `act` clicks a square after the route has proved it
   * loaded, and asserts what the click produced — see lib/render.mjs for why the second assertion
   * is the whole point of the hook.
   *
   * Each `act.proves` names the filled composition *and* the square that was asked for. Naming
   * only `#ticket-title` would have been the bug the hook is built to prevent: the empty ticket
   * carries that id too, reading "PICK A SQUARE.", so a click that landed nowhere would have proved
   * itself. The leverage preset and the level stepper exist only once a square is picked; the title
   * text says which square, so a click that lands on a different one is caught rather than measured.
   */
  {
    path: "/markets/BTC-PERP?side=trade",
    name: "market-trade-picked",
    product: "marketplace",
    surface: "light",
    task: "Markets",
    proves: '[aria-label^="Long BTC-PERP to"]',
    act: {
      click: '[aria-label="Long BTC-PERP to 63,902.1 within 4H"]',
      proves:
        'main:has(button:text-is("10\u00d7")) #ticket-title:text-is("Long BTC-PERP to 63,902.1 within 4H")',
    },
  },
  {
    path: "/markets/BTC-PERP",
    name: "market-ask-picked",
    product: "marketplace",
    surface: "light",
    task: "Markets",
    proves: '[aria-label^="Ask whether BTC-PERP is above"]',
    act: {
      click: '[aria-label="Ask whether BTC-PERP is above 63,902.1 in 24H"]',
      proves: 'main:has([aria-label="Raise the level"]) #ticket-title:has-text("63,902.1")',
    },
  },
  // The reads list is the portfolio's situation exactly: everything below the heading is behind a
  // connect gate and no headless browser has a wallet to pass it with. So this route proves the
  // gate and says so in its name, and the table behind it — five rows, two clocks each, the filter
  // chips — is unmeasured until it has the door /portfolio was given.
  {
    path: "/reads",
    name: "reads-gate",
    product: "marketplace",
    surface: "light",
    task: "Gated",
    proves: "[data-connect-gate]",
  },
  {
    path: "/reads/r1",
    name: "read",
    product: "marketplace",
    surface: "light",
    task: "Marketplace",
    // A read detail is not gated — it is the one screen in this group that renders whole on a GET.
    // LIMITS sits inside the answer block, which is conditional on the read having been answered,
    // so this proves an answered read and not the header of an empty one; the agent link proves it
    // is r1's.
    proves: 'main:has(a[href="/agents/tapereader"]) p:text-is("LIMITS")',
  },
  // Same gate, the other feed. Named for the gate for the same reason /reads is.
  {
    path: "/activity",
    name: "activity-gate",
    product: "marketplace",
    surface: "light",
    task: "Gated",
    proves: "[data-connect-gate]",
  },
  // /apply has a gate of its own and it is not the wallet's: the six-question form renders only
  // for a request carrying the apply cookie, and without one the route answers with NoSeat — a
  // whole authored screen, so this measures a screen rather than a stub. The form behind it is
  // unmeasured, and the cookie is a door this file does not have either.
  //
  // The only dark ground in the marketplace list: ApplyShell pins data-surface="dark", where
  // PublicShell leaves every other route here on the light default.
  {
    path: "/apply",
    name: "apply-no-seat",
    product: "marketplace",
    surface: "dark",
    task: "Apply",
    proves: 'main h1:text-is("GET IN LINE FIRST.")',
  },

  {
    path: "/studio",
    name: "studio",
    product: "studio",
    surface: "dark",
    task: "Task 12",
    // The home, which is where /studio opens once an agent exists. It was the rail until the home
    // replaced the overview as the first screen; a sign-in stub has neither, which is the screen
    // this was measuring and reporting green before either existed.
    proves: "#home-agent",
  },
  // The home at the three moments of the canvas's first run, outside production only (`?stage=`):
  // still choosing a market, researching the one it chose, and decided. Each proves the part of
  // the home that stage changes most, so a stage that fell back to another is not reported green.
  {
    path: "/studio?stage=live",
    name: "studio-home-live",
    product: "studio",
    surface: "dark",
    task: "Task 12",
    proves: "#home-wallet",
  },
  {
    path: "/studio?stage=researching",
    name: "studio-home-researching",
    product: "studio",
    surface: "dark",
    task: "Task 12",
    proves: "#home-picks",
  },
  {
    path: "/studio?stage=decided",
    name: "studio-home-decided",
    product: "studio",
    surface: "dark",
    task: "Task 12",
    proves: "#home-schedule",
  },
  // The create screen before the first agent (`?stage=empty`), the "Pickler Studio Empty v5"
  // canvas with nothing staged: the top bar, the disabled rail, the brief and the wallet panel.
  // `data-staged="false"` is only on a screen no fixture drew, so a create stage is not this.
  {
    path: "/studio?stage=empty",
    name: "studio-home-empty",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent[data-staged="false"]',
  },
  // The create screen at each moment studio-create-simplified-v1 §7 lists (`?stage=create-*`): no
  // wallet, a wallet not funded, funded, advanced open, the web on with sites, the create sheet in
  // each phase, the wallet sheet at each of its two steps, the Wallets modal with a transfer open,
  // AI credits and the avatar picker. Each proves the state it stages, so a stage that fell back to
  // another is not reported green. The draft studio after create is `?stage=draft`, its Overview.
  {
    path: "/studio?stage=create-empty",
    name: "studio-create-empty",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-wallet[data-state="none"] #new-agent-wallet-step0',
  },
  {
    path: "/studio?stage=create-wallet",
    name: "studio-create-wallet",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-wallet[data-state="empty"]',
  },
  {
    path: "/studio?stage=create-funded",
    name: "studio-create-funded",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-wallet[data-state="funded"][data-funded="true"]',
  },
  {
    path: "/studio?stage=create-advanced",
    name: "studio-create-advanced",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: "#new-agent-risk",
  },
  {
    path: "/studio?stage=create-web",
    name: "studio-create-web",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: "#new-agent-web",
  },
  {
    path: "/studio?stage=create-sheet",
    name: "studio-create-sheet",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-sheet[open][data-phase="idle"]',
  },
  {
    path: "/studio?stage=create-sheet-busy",
    name: "studio-create-sheet-busy",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-sheet[open][data-phase="busy"]',
  },
  {
    path: "/studio?stage=create-sheet-ok",
    name: "studio-create-sheet-ok",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-sheet[open][data-phase="ok"]',
  },
  {
    path: "/studio?stage=create-sheet-cancelled",
    name: "studio-create-sheet-cancelled",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-sheet[open][data-phase="err"]',
  },
  {
    path: "/studio?stage=create-wallet-sheet",
    name: "studio-create-wallet-sheet",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-sheet[open][data-step="1"] [aria-label="Step 1 of 2"]',
  },
  {
    path: "/studio?stage=create-wallet-sheet-step2",
    name: "studio-create-wallet-sheet-step2",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: '#new-agent-sheet[open][data-step="2"] [aria-label="Step 2 of 2"]',
  },
  {
    path: "/studio?stage=create-wallets",
    name: "studio-create-wallets",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: "#new-agent-wallets[open] input[data-amount]",
  },
  {
    path: "/studio?stage=create-credits",
    name: "studio-create-credits",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: "#new-agent-credits[open]",
  },
  {
    path: "/studio?stage=create-avatar",
    name: "studio-create-avatar",
    product: "studio",
    surface: "dark",
    task: "Create v5",
    proves: "#new-agent-avatar[open]",
  },
  /* The draft studio (studio-draft-dashboard-v1 §7), one route per `?stage=draft*` in DRAFT_STAGES
   * (apps/web/src/features/studio/home/stage.ts). `draft` is the Overview right after create; the
   * four X stages are Go Public's card on the Overview with the X row open, the post not found
   * after "Check again", the account verified and X skipped, so each proves that card's state
   * rather than the Overview, which all four share. The rest prove their section, and
   * `draft-locked` proves the panel Activity shows while the agent is private. */
  {
    path: "/studio?stage=draft",
    name: "studio-draft-overview",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-overview",
  },
  {
    path: "/studio?stage=draft-x-open",
    name: "studio-draft-x-open",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-go-public-x:not(:has(#draft-go-public-x-miss)) #draft-go-public-x-handle",
  },
  {
    path: "/studio?stage=draft-x-miss",
    name: "studio-draft-x-miss",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-go-public-x-miss",
  },
  {
    path: "/studio?stage=draft-x-ok",
    name: "studio-draft-x-ok",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: '#draft-go-public [role="progressbar"][aria-valuenow="1"]',
  },
  {
    path: "/studio?stage=draft-x-skipped",
    name: "studio-draft-x-skipped",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves:
      '#draft-go-public:has(button[aria-pressed="true"]) #draft-go-public-button[data-state="ready"]',
  },
  {
    path: "/studio?stage=draft-console",
    name: "studio-draft-console",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-console",
  },
  {
    path: "/studio?stage=draft-trades",
    name: "studio-draft-trades",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-picks",
  },
  {
    path: "/studio?stage=draft-brief",
    name: "studio-draft-brief",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-brief",
  },
  {
    path: "/studio?stage=draft-sources",
    name: "studio-draft-sources",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-skills",
  },
  {
    path: "/studio?stage=draft-limits",
    name: "studio-draft-limits",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-limits",
  },
  {
    path: "/studio?stage=draft-identity",
    name: "studio-draft-identity",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-identity",
  },
  {
    path: "/studio?stage=draft-trade",
    name: "studio-draft-trade",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-trade",
  },
  {
    path: "/studio?stage=draft-master",
    name: "studio-draft-master",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-master",
  },
  {
    path: "/studio?stage=draft-locked",
    name: "studio-draft-locked",
    product: "studio",
    surface: "dark",
    task: "Draft dashboard",
    proves: "#draft-section-locked",
  },
  // The second-passkey suggestion on the home. The staged home carries the canvas's account, one
  // passkey, so the suggestion is drawn there with nothing read; this proves it rendered.
  {
    path: "/studio?stage=live",
    name: "studio-home-second-passkey",
    product: "studio",
    surface: "dark",
    task: "Auth",
    proves: "#home-second-passkey",
  },
  // The studio keeps its section in state, so /studio alone shows the home and nothing behind the
  // rail. `?section=` opens each of the thirteen, outside production only, in the rail's own order
  // (apps/web/src/features/studio/sections/rail.ts). Seven are screens; five are the Soon panel
  // and the board is the same panel with its two links. `limits` is also where the trading panel
  // is measured, because trading has no section of its own.
  // Each proves an id on the root of the section itself (`#studio-section-<key>`), or on the Soon
  // panel drawn for that key (`#studio-soon-<key>`). Not the main container's
  // `#studio-panel-<key>`: that id names the section asked for whatever the container holds, so it
  // also matched while the studio read its agents ("Reading your agents…") or showed an error —
  // the stub-proves-green failure this file exists to refuse.
  {
    path: "/studio?section=overview",
    name: "studio-overview",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-section-overview",
  },
  {
    path: "/studio?section=context",
    name: "studio-context",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-section-context",
  },
  {
    path: "/studio?section=picks",
    name: "studio-picks",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-section-picks",
  },
  {
    path: "/studio?section=activity",
    name: "studio-activity",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-section-activity",
  },
  {
    path: "/studio?section=brief",
    name: "studio-brief",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-section-brief",
  },
  {
    path: "/studio?section=skills",
    name: "studio-skills",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-section-skills",
  },
  {
    path: "/studio?section=sources",
    name: "studio-sources",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-soon-sources",
  },
  {
    path: "/studio?section=limits",
    name: "studio-limits",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-section-limits",
  },
  {
    path: "/studio?section=identity",
    name: "studio-identity",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-soon-identity",
  },
  {
    path: "/studio?section=profile",
    name: "studio-profile",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-soon-profile",
  },
  {
    path: "/studio?section=audience",
    name: "studio-audience",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-soon-audience",
  },
  {
    path: "/studio?section=token",
    name: "studio-token",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-soon-token",
  },
  {
    path: "/studio?section=board",
    name: "studio-board",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-soon-board",
  },
  // The account sits behind the same auth gate the studio did, so it needs the same floor for the
  // same reason. These three selectors are a contract with Task 13 rather than an observation: the
  // route does not exist yet, and until it renders them these entries report as unmeasured, which
  // is the correct answer and not a failure of the screen.
  {
    path: "/account",
    name: "account",
    product: "studio",
    surface: "dark",
    task: "Task 13",
    proves: "#account-panel-wallet",
  },
  // The account's three sections sit behind a rail and only the wallet renders on load, so the
  // other two are never on screen for a check to read. `?section=` puts one there, outside
  // production only. MUST_NEST in surfaces.mjs keys on name, so only `account` carries the nesting
  // assertion — right, because the white wallet card exists only in the wallet section.
  {
    path: "/account?section=security",
    name: "account-security",
    product: "studio",
    surface: "dark",
    task: "Task 13",
    proves: "#account-panel-security",
  },
  {
    path: "/account?section=profile",
    name: "account-profile",
    product: "studio",
    surface: "dark",
    task: "Task 13",
    proves: "#account-panel-profile",
  },
  // The signup's mandatory passkey step, straight after the code and before the handle: its one
  // prompt creates the sub-organization and the master wallet, and every signed-in screen sends a
  // person without that wallet back to it. A real visit reaches it only with a session that has
  // no wallet, which the harness
  // cannot have — its cookie passes the middleware's presence check and is not a session
  // (render.mjs). `?state=passkey` opens the signup on that step with no session and no reads,
  // outside production only. The studio by hosts.ts's segments, and the (auth) layout is dark.
  {
    path: "/signup?state=passkey",
    name: "signup-passkey",
    product: "studio",
    surface: "dark",
    task: "Auth",
    proves: "#signup-passkey",
  },
  // /passkey adds a passkey to an account that has one, so a real visit needs a session, a
  // master wallet and a profile. `?state=add` draws the screen from one fixture passkey instead,
  // outside production only (apps/web/src/features/auth/lib/passkey-entry.ts).
  {
    path: "/passkey?state=add",
    name: "passkey-add",
    product: "studio",
    surface: "dark",
    task: "Auth",
    proves: "#passkey-add",
  },
  // The (auth) group. No route in it had ever been measured: this list carried fifteen routes and
  // not one of them was /signin or /signup, so those two screens were never unconverted — nobody
  // had looked. A claim that every colour any route can reach resolved to a token was withdrawn
  // over exactly this, and the first run here found nine violation classes waiting on each.
  //
  // Both are the studio by the same rule as /studio: apps/web/src/server/hosts.ts lists `signin`
  // and `signup` among STUDIO_SEGMENTS. The (auth) layout pins data-surface="dark", so the ground
  // is the dark one on both.
  //
  // Each proves its own title and the board in the same selector, and that pairing is the point.
  // The board is the half a stub cannot have; the title is the half that says which rail rendered.
  // /signin and /signup are one component with one prop between them, so a selector that only
  // proved the composition would report green for a /signin that had quietly opened the sign-up
  // rail — the same class of failure as measuring the studio's sign-in stub, one prop smaller.
  {
    path: "/signin",
    name: "signin",
    product: "studio",
    surface: "dark",
    task: "Auth",
    proves: 'main:has(aside[aria-label="Sample agent activity"]) h1:text-is("GET IN")',
  },
  {
    path: "/signup",
    name: "signup",
    product: "studio",
    surface: "dark",
    task: "Auth",
    proves: 'main:has(aside[aria-label="Sample agent activity"]) h1:text-is("JOIN THE BOARD")',
  },
];

/** Every route, or the ones DESIGN_ROUTES names (lib/only.mjs). */
export const ROUTES = only(ALL, process.env.DESIGN_ROUTES);

export const GROUND = { light: "rgb(255, 255, 255)", dark: "rgb(11, 13, 26)" };

/* Which source a screen is built from, so a check can say when its failures may be someone's
 * half-finished edit rather than a defect. Keyed by task rather than by route because several
 * routes are states of one screen — the three portfolio entries share a directory, and a state
 * added later inherits this instead of repeating it.
 *
 * ALWAYS holds every route: the tokens are what every screen is made of, so an edit in flight there
 * puts every measurement on this page in question. */
export const HOLDS = {
  ALWAYS: ["packages/ui/src"],
  "Task 9": ["apps/web/src/features/landing"],
  "Task 10": ["apps/web/src/features/wallet", "apps/web/src/features/agents"],
  "Task 11": ["apps/web/src/features/studio"],
  "Task 12": ["apps/web/src/features/studio"],
  "Draft dashboard": ["apps/web/src/features/studio"],
  "Task 13": ["apps/web/src/features/account"],
  // No task builds it; what it is made of is still someone's to edit.
  Inherited: ["apps/web/src/features/agents"],
  /* No task builds the marketplace either — like the auth screens it predates this design work,
   * which is how twelve routes went unmeasured. Four keys rather than one, because attribution is
   * the purpose of this map and a single `Marketplace` would mark a market failure [held] whenever
   * somebody was editing the agent directory.
   *
   * `Gated` is /reads and /activity, which are the two screens whose measurable half is the
   * connect gate. It holds the gate's own directory as well as the page's, because the thing being
   * measured on those routes is the gate and the gate is the wallet's. */
  Marketplace: ["apps/web/src/features/agents"],
  Markets: ["apps/web/src/features/markets"],
  Gated: ["apps/web/src/features/wallet", "apps/web/src/features/agents"],
  Apply: ["apps/web/src/features/apply"],
  // Neither does any task build the auth screens — they predate this design work, which is how
  // they went fifteen routes without being measured. Their own key rather than `Inherited`
  // because attribution is the whole purpose of this map: sharing a key with the leaderboard
  // would mark a leaderboard failure [held] whenever somebody was editing auth.
  Auth: ["apps/web/src/features/auth"],
};
