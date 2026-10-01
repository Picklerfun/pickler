/* Which routes a run visits.
 *
 * DESIGN_ROUTES names them, by `name`, separated by commas: the screens one task changed, so it
 * can look at them without visiting the other fifty. A name that matches nothing is refused rather
 * than ignored, because a run that silently visits nothing reports the same green as one that
 * passed. Without the variable, every route. */
export function only(routes, asked) {
  if (!asked) {
    return routes;
  }
  const names = asked
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = names.filter((name) => !routes.some((route) => route.name === name));
  if (unknown.length) {
    throw new Error(`DESIGN_ROUTES names no such route: ${unknown.join(", ")}`);
  }
  return routes.filter((route) => names.includes(route.name));
}
