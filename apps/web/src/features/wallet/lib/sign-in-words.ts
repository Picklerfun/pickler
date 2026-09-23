import { ConnectError } from "./connect";
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
export function signInWords(caught: unknown): string | null {
  // 4001 is EIP-1193 for "the person closed the prompt". An answer, not a failure, and a red box
  // for it would be the site arguing with a decision somebody just made.
  if ((caught as { code?: unknown } | null)?.code === 4001) {
    return null;
  }
  // Mera's PRF failure arrives as a MeraError carrying `code: "PRF_UNAVAILABLE"`, and this is the
  // conversion: `describeSignerFailure` turns it into a PasskeyUnusableError whose message names a
  // cause the person did not create and says what to do instead. That message then falls through
  // to the bottom of this function unchanged. There is deliberately no branch for it here — an
  // earlier draft had one, and deleting it broke no test, because the fallthrough already does the
  // work. A branch nothing can distinguish is a branch that is not there.
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
