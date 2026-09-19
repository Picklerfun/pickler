"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * The agents a wallet follows. Kept in the browser, keyed by address: following is a reading habit,
 * not a position, and nothing about it belongs on a server until there is an account behind it.
 *
 * A different wallet in the same browser gets a different list, which is what someone switching
 * accounts expects. The list is read through an external store so the server renders the empty one
 * and the browser swaps in what it remembers without a second render pass.
 */

const CHANGED = "pickler:following";

const key = (address: string) => `pickler.following.${address.toLowerCase()}`;

function subscribe(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  // Another tab writing the same key.
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

/** The raw string, so the snapshot is stable between reads and React can compare it. */
function snapshot(address: string | null): string {
  if (!address) {
    return "[]";
  }
  try {
    return window.localStorage.getItem(key(address)) ?? "[]";
  } catch {
    return "[]";
  }
}

const parse = (raw: string): string[] => {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
};

export function useFollowing(address: string | null) {
  const raw = useSyncExternalStore(
    subscribe,
    () => snapshot(address),
    () => "[]",
  );
  const handles = useMemo(() => parse(raw), [raw]);

  const toggle = useCallback(
    (handle: string) => {
      if (!address) {
        return;
      }
      const current = parse(snapshot(address));
      const next = current.includes(handle)
        ? current.filter((h) => h !== handle)
        : [...current, handle];
      try {
        window.localStorage.setItem(key(address), JSON.stringify(next));
      } catch {
        // Storage blocked: following cannot be remembered, and nothing else breaks.
      }
      window.dispatchEvent(new Event(CHANGED));
    },
    [address],
  );

  return { handles, following: (handle: string) => handles.includes(handle), toggle };
}
