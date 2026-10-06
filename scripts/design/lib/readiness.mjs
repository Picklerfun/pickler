/** Prove the intended screen after client mounting, without accepting another screen. */
export async function proveScreen(page, selector, timeout = 10_000) {
  try {
    await page.locator(selector).first().waitFor({ state: "attached", timeout });
    return null;
  } catch {
    return `nothing matches ${selector} after ${timeout}ms`;
  }
}

/** Runs in the browser. Infinite decoration does not prevent measuring a stable screen. */
export function finiteMotionFinished() {
  return document.getAnimations().every((animation) => {
    if (animation.effect?.getComputedTiming().iterations === Infinity) {
      return true;
    }
    return animation.playState === "finished" || animation.playState === "idle";
  });
}

/** Refuse an unsettled screen rather than reading transient colours or swallowing a timeout. */
export async function settleMotion(page, timeout = 5000) {
  try {
    await page.waitForFunction(finiteMotionFinished, null, { timeout });
    return null;
  } catch {
    return `finite motion still active after ${timeout}ms`;
  }
}
