"use client";
import { useEffect, useState } from "react";

/**
 * The wall clock, as a value that re-renders.
 *
 * The studio counts down to the next run and counts runs inside a rolling day, so "now" is a real
 * input. Reading it during render would make the component unstable, so it is read once at mount
 * and then on a tick, and everything downstream stays a pure function of it.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
