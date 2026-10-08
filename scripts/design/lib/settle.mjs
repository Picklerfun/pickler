/* Some screens are still busy when the network goes quiet.
 *
 * `networkidle` means 500ms with no request, and a debounced request can start after that window
 * has closed: the studio's name step checks the handle 400ms after it mounts, so the shot caught
 * CHECKING on one run and "could not be checked" on another, and the comparison reported a change
 * no stylesheet made. A sleep would be a guess that ages, so a route that has such a state names
 * it, `settles: { gone: "<selector>" }`, and the page is read only once nothing matches it.
 *
 * The selector must match the busy state as soon as the screen is proved: waiting for something
 * that has not appeared yet passes at once. A state that never clears is reported, not waited
 * past, because a picture of a screen mid-request is the flaky shot this exists to remove. */
export const SETTLE_MS = 10_000;

/** Waits until the route's busy selector matches nothing. Returns null once settled, or the reason
 *  it did not; a route without `settles` is settled already. */
export async function settle(page, route, timeout = SETTLE_MS) {
  if (!route.settles) {
    return null;
  }
  const { gone } = route.settles;
  if (typeof gone !== "string" || !gone) {
    return "declares `settles` without a `gone` selector";
  }
  try {
    await page.locator(gone).first().waitFor({ state: "detached", timeout });
    return null;
  } catch {
    return `${gone} still matched after ${timeout}ms`;
  }
}

/** Wait for finite entry animations and transitions on every route, including routes without a
 * click. Infinite decorative loops remain active. A stuck finite animation blocks measurement. */
export async function settleMotion(page, timeout = SETTLE_MS) {
  try {
    await page.waitForFunction(
      () =>
        document.getAnimations().every((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            timing?.iterations === Infinity ||
            animation.playState === "finished" ||
            animation.playState === "idle"
          );
        }),
      null,
      { timeout },
    );
    return null;
  } catch {
    return `finite animation or transition did not finish within ${timeout}ms`;
  }
}
