import { ConnectError, JoinUnsettledError } from "./connect";
import { describeSignerFailure } from "./signer-adapters";

/**
 * What to put on screen when signing in with a wallet did not work, or null when there is nothing
 * to say because the person simply closed the prompt.
 *
 * Pure, and taking the thrown thing as an argument, so every branch can be pinned without a
 * browser or a wallet — the same shape as `productFor(host, hosts)` and `previewAllowed(...)`.
 *
 * The distinctions here are the point. A stale nonce and a refused signature arrive as the same
 * red box unless something separates them, and they mean opposite things: one is "that took too
 * long, go again", the other is "that signature did not come from this wallet". Telling somebody
 * to try again when trying again cannot work is a loop with no exit.
 */
/**
 * The same for joining an account the person already has: the API's refusals, said as what the
 * person should do next. Anything else is whatever a sign-in would have said.
 */
export function joinWords(caught: unknown): string | null {
  if (caught instanceof JoinUnsettledError) {
    return "That did not finish, and the wallet may already be linked. Try again to find out.";
  }
  if (caught instanceof ConnectError) {
    switch (caught.code) {
      case "no_account":
        return "That wallet doesn't have a Pickler account.";
      case "same_account":
        return "That's the wallet you're already connected with.";
      case "join_has_profile":
        return "This wallet's account already has a username, so it cannot be moved into another.";
      case "join_has_custody":
        return "This wallet's account already has a Pickler wallet of its own, so it cannot be moved into another.";
      case "join_not_wallet_account":
        return "This account cannot be moved into another. Pick a username for it instead.";
      case "join_changed":
        return "That account changed while it was being linked. Try again.";
      case "wrong_purpose":
        return "That signature was for something else. Try again.";
    }
  }
  return signInWords(caught);
}

export function signInWords(caught: unknown): string | null {
  // 4001 is EIP-1193 for "the person closed the prompt". An answer, not a failure, and a red box
  // for it would be the site arguing with a decision somebody just made.
  if ((caught as { code?: unknown } | null)?.code === 4001) {
    return null;
  }
  // Whatever else was thrown becomes an Error, and its own message falls through to the bottom
  // of this function unchanged.
  // A request that ran out of time (`AbortSignal.timeout`), which a browser words as "signal
  // timed out": true, and no use to anybody.
  if ((caught as { name?: unknown } | null)?.name === "TimeoutError") {
    return "That sign-in took too long to come back. Try again.";
  }
  const described = describeSignerFailure(caught);
  if (caught instanceof ConnectError) {
    switch (caught.code) {
      case "nonce_invalid":
        // The challenge expired between asking and signing. Nothing is wrong and the fix is to go
        // round once more, which the screen can offer without explaining nonces to anybody.
        return "That sign-in took too long to come back. Try again.";
      case "wrong_domain":
        return "That signature was for a different site. Try again from this page.";
      case "401":
        return "That signature did not match the wallet that asked. Check the account your wallet has selected and try again.";
      default:
        return caught.message;
    }
  }
  return described.message || "That sign-in did not go through.";
}
