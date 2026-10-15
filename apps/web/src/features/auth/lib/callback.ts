import { returnTo } from "../../../server/guard";
/**
 * Where the provider callback sends a person, decided on the server before any redirect, from
 * what the account already holds. One hop, straight to the step that is missing, in the signup's
 * order — the master wallet before the handle:
 *
 * - no master wallet → the signup's passkey step, whatever the profile
 * - a wallet, no profile → the handle step
 * - both → the studio
 *
 * A read that failed for any reason other than a 404 decides nothing: `/signup` with a session
 * reads the account again and offers to retry, rather than guessing a step or waving someone
 * without a wallet into the studio.
 */
export type Read = "found" | "missing" | "failed";

/**
 * Where a signed-in person without a master wallet is sent, from the callback and from every
 * screen (`redirectFor` in `custody.ts`): the signup's own passkey step. Nobody gets in anywhere
 * without the wallet.
 */
export const SIGNUP_PASSKEY_STEP = "/signup?step=passkey";

/**
 * Where a signed-in person with a master wallet and no profile is sent: the signup's handle step.
 *
 * Both URLs are cosmetic. `/signup` resumes an existing session by reading the account and landing
 * on whatever it still needs (`landing` in `custody.ts`), whatever the query says, so neither can
 * send somebody to a step they do not need, and neither can loop: the step they land on is decided
 * by the same two reads that sent them.
 */
export const SIGNUP_HANDLE_STEP = "/signup?step=handle";
export const SIGNUP_RESUME = "/signup";

export function callbackDestination(
  account: { profile: Read; wallet: Read },
  studio: string,
  requested?: string,
): string {
  const next = returnTo(requested);
  const resume = (path: string) =>
    next ? `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}` : path;
  if (account.wallet === "failed") {
    return resume(SIGNUP_RESUME);
  }
  if (account.wallet === "missing") {
    return resume(SIGNUP_PASSKEY_STEP);
  }
  if (account.profile === "failed") {
    return resume(SIGNUP_RESUME);
  }
  return account.profile === "missing" ? resume(SIGNUP_HANDLE_STEP) : (next ?? studio);
}

/** A status code as a read: 2xx found, 404 missing, anything else failed. */
export function readOf(status: number): Read {
  if (status >= 200 && status < 300) {
    return "found";
  }
  return status === 404 ? "missing" : "failed";
}
