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

export const HANDLE_STEP = "/signup?step=handle";
export const PASSKEY_STEP = "/signup?step=passkey";
export const SIGNUP_RESUME = "/signup";

export function callbackDestination(
  account: { profile: Read; wallet: Read },
  studio: string,
): string {
  if (account.wallet === "failed") {
    return SIGNUP_RESUME;
  }
  if (account.wallet === "missing") {
    return PASSKEY_STEP;
  }
  if (account.profile === "failed") {
    return SIGNUP_RESUME;
  }
  return account.profile === "missing" ? HANDLE_STEP : studio;
}

/** A status code as a read: 2xx found, 404 missing, anything else failed. */
export function readOf(status: number): Read {
  if (status >= 200 && status < 300) {
    return "found";
  }
  return status === 404 ? "missing" : "failed";
}
