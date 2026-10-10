"use client";

import { useEffect, useRef } from "react";

/**
 * A clock for an illustration. It ticks every `ms` while the page is visible, and not at all for
 * someone who asked for reduced motion: the illustrations then stay on their first frame, which is
 * a complete picture on its own. The callback is read through a ref so a re-render never restarts
 * the interval.
 */
export function useTicker(ms: number, onTick: () => void) {
  const callback = useRef(onTick);
  useEffect(() => {
    callback.current = onTick;
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) {
        timer = setInterval(() => callback.current(), ms);
      }
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
}
