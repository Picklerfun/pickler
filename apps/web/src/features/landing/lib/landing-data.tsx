"use client";

import type { LandingResponse } from "@pickler/api-schema";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const REFRESH_MS = 30_000;
const CLOCK_MS = 15_000;

interface LandingState {
  data: LandingResponse;
  /** Wall clock for relative times; starts at the snapshot time so server and client render alike. */
  nowMs: number;
}

const LandingContext = createContext<LandingState | null>(null);

export function LandingDataProvider({
  initial,
  children,
}: {
  initial: LandingResponse;
  children: ReactNode;
}) {
  const [data, setData] = useState(initial);
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.generatedAt));

  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/v1/landing", { signal: controller.signal });
        if (response.ok) {
          setData((await response.json()) as LandingResponse);
        }
      } catch {
        // Keep showing the last good snapshot; the next tick retries.
      }
    };
    const refreshTimer = setInterval(refresh, REFRESH_MS);
    const clockTimer = setInterval(() => setNowMs(Date.now()), CLOCK_MS);
    return () => {
      controller?.abort();
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
  }, []);

  return <LandingContext.Provider value={{ data, nowMs }}>{children}</LandingContext.Provider>;
}

export function useLanding(): LandingState {
  const value = useContext(LandingContext);
  if (!value) {
    throw new Error("useLanding must be used inside LandingDataProvider");
  }
  return value;
}

const noop = () => () => {};

/** False during server rendering and hydration, true afterwards. */
export function useIsClient() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** setInterval that pauses when the user prefers reduced motion. */
export function useAnimationInterval(callback: () => void, ms: number) {
  const reduced = usePrefersReducedMotion();
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    if (reduced) {
      return;
    }
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [reduced, ms]);
}
