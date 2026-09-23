// The five screens this change builds, and the ground each must paint. Everything in scripts/design
// reads this, so a route added here is a route every check covers.
export const ROUTES = [
  { path: "/", name: "landing", surface: "light" },
  { path: "/portfolio", name: "portfolio", surface: "light" },
  { path: "/console", name: "studio", surface: "dark" },
  // The empty studio is a state, not a route: the console renders it when the signed-in person has
  // no agents. A later task adds ?state=empty so it can be reached without emptying a database.
  { path: "/console?state=empty", name: "studio-empty", surface: "dark" },
  { path: "/account", name: "account", surface: "dark" },
];

export const GROUND = { light: "rgb(255, 255, 255)", dark: "rgb(11, 13, 26)" };
