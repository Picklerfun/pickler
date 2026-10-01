/* The small words the status screens compute, apart from the screens so the suite can test them. */

/**
 * The code a person can send us: Next's digest for the failure when the server made one (it is
 * the key into the server's logs), and the UTC time either way, so a report can be found.
 */
export function errorCode(digest: string | undefined, at: Date): string {
  const time = at.toISOString().slice(11, 19);
  return digest ? `ERR ${digest.slice(0, 12).toUpperCase()} · ${time} UTC` : `${time} UTC`;
}

/** How long ago, in the words the screen uses: "just now", "3 min ago", "2 h ago". */
export function ago(sinceMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - sinceMs) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

/** The chains a wallet is most often left on, by name; anything else is named by its id. */
const KNOWN: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  143: "Monad",
  8453: "Base",
  42161: "Arbitrum",
};

export const chainName = (chainId: number): string => KNOWN[chainId] ?? `chain ${chainId}`;

/** The handle out of `/agents/<handle>` or `/agents/<handle>/ask`, as typed. */
export function handleFromPath(path: string | null): string {
  const segment = path?.split("/")[2] ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape is still what was typed; show it rather than fail the 404.
    return segment;
  }
}
