export type HandleProblem = "too_short" | "too_long" | "bad_characters" | "reserved" | "taken";

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
