import type { HandleRules } from "@pickler/api-schema";

export type HandleProblem = "too_short" | "too_long" | "invalid_characters" | "reserved" | "taken";

/**
 * What is wrong with a handle as somebody types it, or null when nothing is.
 *
 * The rules arrive as arguments rather than as an import, which is what makes this testable at
 * all: `apps/web` is CommonJS to node's resolver and `@pickler/api-schema` publishes only an
 * "import" condition, so a module that reads its values at load time cannot be required by a test
 * here — not one of the five `apps/web/src` modules that import its values has a test. The type
 * above is erased at compile time, so it costs nothing. Same shape as `productFor(host, hosts)`
 * and `previewAllowed(nodeEnv, authConfigured)`, and for the same reason.
 *
 * This is guidance, not a gate. `POST /v1/profile` validates against core and refuses; the worst a
 * stale copy here can do is show someone an unhelpful message, never let a bad handle through.
 */
export function localProblem(
  raw: string,
  rules: HandleRules,
  reserved: ReadonlySet<string>,
): HandleProblem | null {
  const handle = raw.trim().toLowerCase();
  if (handle.length < rules.min) {
    return "too_short";
  }
  if (handle.length > rules.max) {
    return "too_long";
  }
  if (!rules.pattern.test(handle)) {
    return "invalid_characters";
  }
  if (reserved.has(handle)) {
    return "reserved";
  }
  return null;
}

/**
 * Whether a handle is free, as three answers rather than a boolean.
 *
 * `known: false` is the whole point. A lookup that failed must never come back as `available:
 * false`: telling somebody their handle is taken when the truth is that nobody looked sends them
 * off to pick a different name they did not want, and unlike an error they will never find out it
 * was a lie. This is the same rule the wallet panel follows for a balance the chain did not answer
 * for — an unread value is not a zero.
 */
export type Availability = { known: false } | { known: true; available: boolean };

export async function checkAvailability(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Availability> {
  const response = await fetchImpl(`/api/v1/handles/${encodeURIComponent(handle)}/availability`);
  if (!response.ok) {
    return { known: false as const };
  }
  const { data } = await response.json();
  return { known: true as const, available: data.available as boolean };
}

export async function claimHandle(
  input: { handle: string; displayName: string },
  token: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/v1/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ handle: input.handle, display_name: input.displayName }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "That handle could not be claimed");
  }
  return (await response.json()).data;
}

/**
 * Whether the signed-in account has a profile, and so a username: yes, no, or null when nobody
 * could tell. Three answers for the reason `Availability` has three: a failed read is not "no",
 * and asking somebody for a username they already have is worse than not asking.
 */
export async function hasProfile(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  try {
    const response = await fetchImpl("/api/v1/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return true;
    }
    return response.status === 404 ? false : null;
  } catch {
    return null;
  }
}
