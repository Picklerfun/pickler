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

/**
 * The same clock for a page rendered on the server first.
 *
 * A market writes the hour each column closes at, so the first paint must agree with what the
 * server sent or React rehydrates into a different time. The server's instant is the first value;
 * the browser takes over on mount.
 */
export function useServerNow(startIso: string, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.parse(startIso));
  useEffect(() => {
    const sync = () => setNow(Date.now());
    // The handover happens just after the first paint, so hydration still matches the server.
    const handover = setTimeout(sync, 0);
    const timer = setInterval(sync, intervalMs);
    return () => {
      clearTimeout(handover);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
