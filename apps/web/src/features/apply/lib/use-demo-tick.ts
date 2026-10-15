"use client";

import { useEffect } from "react";

/**
 * A timer for a decorative animation. It never starts under `prefers-reduced-motion: reduce`, read
 * once when the component mounts, and it skips ticks while the tab is hidden, so a page left open in
 * the background neither burns the battery nor piles up state changes to paint on return.
 *
 * `tick` is a dependency: pass a stable one (a functional `setState` inside `useCallback`), or the
 * interval is set again on every render.
 */
export function useDemoTick(intervalMs: number, tick: () => void): void {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        tick();
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, tick]);
}
