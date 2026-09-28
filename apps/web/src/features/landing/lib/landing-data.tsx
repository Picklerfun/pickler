"use client";

import type { LandingResponse } from "@pickler/api-schema";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const REFRESH_MS = 30_000;
const CLOCK_MS = 15_000;

interface LandingState {
  data: LandingResponse;
  /** Wall clock for relative times; starts at the snapshot time so server and client render alike. */
  nowMs: number;
}

const LandingContext = createContext<LandingState | null>(null);

/**
 * The landing's one source of numbers.
 *
 * Everything on the page is a figure out of this snapshot, and the only thing that moves it is the
 * API answering differently. Nothing here counts up on its own: an interval that increments a
 * number nothing produced would read as live and be invented, which is the one thing a page full of
 * money figures cannot do.
 */
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
