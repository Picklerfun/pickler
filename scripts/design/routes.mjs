// The five screens this change builds, and the ground each must paint. Everything in scripts/design
// reads this, so a route added here is a route every check covers.
// `task` is the plan task that builds each screen. A route that answers 404 has not been built yet
// rather than broken, and naming the task turns "this is missing" into "this is not your turn".
export const ROUTES = [
  { path: "/", name: "landing", surface: "light", task: "Task 9" },
  { path: "/portfolio", name: "portfolio", surface: "light", task: "Task 10" },
  { path: "/console", name: "studio", surface: "dark", task: "Task 11" },
  // The empty studio is a state, not a route: the console renders it when the signed-in person has
  // no agents. A later task adds ?state=empty so it can be reached without emptying a database.
  { path: "/console?state=empty", name: "studio-empty", surface: "dark", task: "Task 12" },
  { path: "/account", name: "account", surface: "dark", task: "Task 13" },
];

export const GROUND = { light: "rgb(255, 255, 255)", dark: "rgb(11, 13, 26)" };
