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
export const ROUTES = [
  {
    path: "/",
    name: "landing",
    surface: "light",
    task: "Task 9",
    // The section the canvas is built around. Present only when the landing itself rendered.
    proves: "#four-moves-title",
  },
  {
    path: "/portfolio",
    name: "portfolio",
    surface: "light",
    task: "Task 10",
    // The connect gate is the screen here, and it carries no authored hook to point at — so this is
    // the weak form of the floor, and a count. Replace it with a selector when the gate gains one:
    // a count cannot tell a thinner gate from a stub, which is the whole failure this guards.
    floor: 15,
  },
  // Everything on the portfolio below its heading is behind a connect gate, and nothing here has a
  // wallet to pass it with — so a check on /portfolio alone measures the gate and calls the screen
  // green. ?state=connected renders the connected state without one, outside production only.
  {
    path: "/portfolio?state=connected",
    name: "portfolio-connected",
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
    surface: "light",
    task: "Task 10",
    // The panel, not the tablist: this proves the tab the query param asked for is the one on
    // screen, so a param that stopped working is caught rather than measured.
    proves: "#portfolio-panel-positions",
  },
  {
    path: "/console",
    name: "studio",
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
  { path: "/console?section=picks", name: "studio-picks", surface: "dark", task: "Task 11" },
  { path: "/console?section=activity", name: "studio-activity", surface: "dark", task: "Task 11" },
  { path: "/console?section=skills", name: "studio-skills", surface: "dark", task: "Task 11" },
  { path: "/console?section=token", name: "studio-token", surface: "dark", task: "Task 11" },
  // The empty studio is a state, not a route: the console renders it when the signed-in person has
  // no agents. A later task adds ?state=empty so it can be reached without emptying a database.
  {
    path: "/console?state=empty",
    name: "studio-empty",
    surface: "dark",
    task: "Task 12",
    proves: 'nav[aria-label="Studio sections"]',
  },
  // The account sits behind the same auth gate the studio did, so it needs the same floor for the
  // same reason. These three selectors are a contract with Task 13 rather than an observation: the
  // route does not exist yet, and until it renders them these entries report as unmeasured, which
  // is the correct answer and not a failure of the screen.
  {
    path: "/account",
    name: "account",
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
    surface: "dark",
    task: "Task 13",
    proves: "#account-panel-security",
  },
  {
    path: "/account?section=profile",
    name: "account-profile",
    surface: "dark",
    task: "Task 13",
    proves: "#account-panel-profile",
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
};
