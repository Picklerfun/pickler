// The five screens this change builds, and the ground each must paint. Everything in scripts/design
// reads this, so a route added here is a route every check covers.
// `task` is the plan task that builds each screen. A route that answers 404 has not been built yet
// rather than broken, and naming the task turns "this is missing" into "this is not your turn".
//
// `proves` is the floor, and it is the most important field here. /console answered 200 and rendered
// a sign-in stub wherever Supabase was unconfigured — which is every environment these checks run
// in — so all four checks walked 33 elements of the stub and reported green. A check that matches
// nothing reports what a check that passes reports. So every route names something the real screen
// contains and a stub cannot, and a route that does not show it is reported like a route that never
// loaded: named, not measured, not counted as passing.
//
// A selector is preferred over `floor`, a minimum count of text-carrying elements, because a count
// drifts into passing as a stub grows. `floor` is only for screens with no authored hook to point
// at yet. Every route must carry one or the other; render.mjs refuses a route with neither, since a
// route nobody wrote a floor for is exactly the route this was built to catch.
// `product` is which host owns the route, by the same first-segment rule
// apps/web/src/server/hosts.ts applies: /console and /account are the studio, everything else here
// is the marketplace. In development the middleware is inert and both answer on one origin, so this
// field does nothing locally — it decides which base URL a check measures once the two products sit
// on two. render.mjs refuses a route that has no `product` rather than falling back, for the same
// reason it refuses a route with no floor: the fallback would be a number about the wrong server,
// and a number about the wrong server is indistinguishable from a number about the right one.
export const ROUTES = [
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
    // The weights panel. It is authored on this page and on no stub.
    proves: "#score",
  },
  {
    path: "/console",
    name: "studio",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    // The rail. A sign-in stub has no sections to navigate, which is exactly the screen that was
    // being measured and reported green for the whole of this change until now.
    proves: 'nav[aria-label="Studio sections"]',
  },
  // The studio keeps its section in state, so /console alone has only ever shown the overview —
  // three screens' worth of composition behind a rail click that no check has ever read. The one
  // most affected by a token change is always the one nothing measures. `?section=` opens each,
  // outside production only. Picks carries the forecast, the policy codes and the report; activity
  // carries the trace; skills carries the plugin rows; token is a section with no backend, which is
  // where the copy saying so lives.
  // The panel carries the section it is showing, so each of these proves the query param put the
  // screen it named on the page rather than proving the shell loaded around the overview again.
  {
    path: "/console?section=picks",
    name: "studio-picks",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-panel-picks",
  },
  {
    path: "/console?section=activity",
    name: "studio-activity",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-panel-activity",
  },
  {
    path: "/console?section=skills",
    name: "studio-skills",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-panel-skills",
  },
  {
    path: "/console?section=token",
    name: "studio-token",
    product: "studio",
    surface: "dark",
    task: "Task 11",
    proves: "#studio-panel-token",
  },
  // The empty studio is a state, not a route: the console renders it when the signed-in person has
  // no agents. ?state=empty reaches it without emptying a database, outside production only.
  //
  // It proves its own panel and not the rail: the rail is the one thing it shares with Studio v4,
  // so a rail selector would have gone on passing if the whole stepped flow had failed to render.
  {
    path: "/console?state=empty",
    name: "studio-empty",
    product: "studio",
    surface: "dark",
    task: "Task 12",
    proves: "#studio-panel-empty",
  },
  // The second half of that screen: the checklist between a draft agent and a public one. It is
  // only reachable by finishing the first half, so without ?phase= no check ever saw it — and it is
  // the half where every row is a thing the product cannot do yet, which is the copy most worth
  // measuring. It proves the checklist and not the panel, because the panel is the half it shares.
  {
    path: "/console?state=empty&phase=draft",
    name: "studio-draft",
    product: "studio",
    surface: "dark",
    task: "Task 12",
    proves: "#go-public",
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
  // The (auth) group. No route in it had ever been measured: this list carried fifteen routes and
  // not one of them was /signin or /signup, so those two screens were never unconverted — nobody
  // had looked. A claim that every colour any route can reach resolved to a token was withdrawn
  // over exactly this, and the first run here found nine violation classes waiting on each.
  //
  // Both are the studio by the same rule as /console: apps/web/src/server/hosts.ts lists `signin`
  // and `signup` among STUDIO_SEGMENTS. The (auth) layout pins data-surface="dark", so the ground
  // is the dark one on both.
  //
  // Each proves its own title and the board in the same selector, and that pairing is the point.
  // The board is the half a stub cannot have; the title is the half that says which rail rendered.
  // /signin and /signup are one component with one prop between them, so a selector that only
  // proved the composition would report green for a /signin that had quietly opened the sign-up
  // rail — the same class of failure as measuring the console's sign-in stub, one prop smaller.
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
  "Task 11": ["apps/web/src/features/console"],
  "Task 12": ["apps/web/src/features/console"],
  "Task 13": ["apps/web/src/features/account"],
  // No task builds it; what it is made of is still someone's to edit.
  Inherited: ["apps/web/src/features/agents"],
  // Neither does any task build the auth screens — they predate this design work, which is how
  // they went fifteen routes without being measured. Their own key rather than `Inherited`
  // because attribution is the whole purpose of this map: sharing a key with the leaderboard
  // would mark a leaderboard failure [held] whenever somebody was editing auth.
  Auth: ["apps/web/src/features/auth"],
};
