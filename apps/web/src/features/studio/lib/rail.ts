/**
 * Whether the rail is wide, remembered.
 *
 * It is a per-person, per-device preference with nothing riding on it: a rail that comes back
 * expanded costs one click, and a rail that comes back wrong costs nothing at all. So it lives in
 * this browser's own storage rather than on the agent's config, where it would need a version, a
 * round trip and a conflict story for a thing that is not about the agent.
 *
 * It is exposed as an external store rather than as state copied in an effect, because that is what
 * it is: a value this component does not own, living outside React, which the server cannot see.
 * `railOnServer` is what the first paint uses, so the markup is the same on both sides and the
 * stored preference arrives with hydration rather than as a mismatch.
 */
const KEY = "pickler.studio.rail";

/** The rail starts wide where there is no browser to ask — the server, and a first paint. */
const DEFAULT = true;

const listeners = new Set<() => void>();
let snapshot: boolean | null = null;

function stored(): boolean | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "wide" ? true : value === "narrow" ? false : null;
  } catch {
    /* Storage can be denied outright. A rail that does not remember still opens and closes. */
    return null;
  }
}

export function subscribeRail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable between notifications, which is what useSyncExternalStore requires of a snapshot. */
export function railSnapshot(): boolean {
  snapshot ??= stored() ?? DEFAULT;
  return snapshot;
}

export function railOnServer(): boolean {
  return DEFAULT;
}

export function setRail(wide: boolean): void {
  snapshot = wide;
  try {
    window.localStorage.setItem(KEY, wide ? "wide" : "narrow");
  } catch {
    /* As above: the rail still moves, it just will not be there next time. */
  }
  for (const listener of listeners) {
    listener();
  }
}

/** Test seam. The snapshot is cached for React's sake, so a test has to be able to clear it. */
export function forgetRail(): void {
  snapshot = null;
}
