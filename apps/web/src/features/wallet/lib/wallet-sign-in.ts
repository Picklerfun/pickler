import type { ConnectResult, Signer } from "./connect";
import { signInWords } from "./sign-in-words";
import { decideSession, type HeldSession, type WalletSession } from "./wallet-session";

/**
 * What signing in answered. The error travels in the result rather than through the context's
 * `sessionError`, because a caller that awaits this and then reads the context is reading the
 * render it started in — the error set during the await is not there yet, and nothing is shown.
 *
 * `error: null` is the person closing the prompt: an answer, with nothing to say about it.
 */
export type SignInResult = { token: string } | { error: string | null };

/** The one verb of Supabase's auth client this needs, so a test can stand in for it. */
export interface SignInClient {
  auth: {
    setSession(tokens: {
      access_token: string;
      refresh_token: string;
    }): Promise<{ error: { message: string } | null }>;
  };
}

export interface SignInAttempt {
  cached: HeldSession | null;
  /** The connected wallet, or null when nothing is connected. */
  signer: Signer | null;
  supabase: SignInClient | null;
  signIn: (signer: Signer) => Promise<ConnectResult>;
  now: Date;
}

/**
 * Sign in as the connected wallet. `session` is the one to keep from now on, present only when a
 * new one was issued; it is bound to the address that signed.
 */
export async function signInAs(
  attempt: SignInAttempt,
): Promise<{ result: SignInResult; session?: WalletSession }> {
  const { signer, supabase } = attempt;
  const decided = decideSession(
    attempt.cached,
    signer && { address: signer.address, namespace: "eip155" },
    attempt.now,
  );
  // Already signed in as this address: hand back what we have rather than spend another prompt on
  // a signature that would prove the same thing twice.
  if (decided.action === "reuse") {
    return { result: { token: decided.token } };
  }
  if (!signer) {
    return { result: { error: "Connect a wallet before signing in." } };
  }
  if (!supabase) {
    // No Supabase in this build: there is nowhere to put a session, so asking for a signature
    // would spend somebody's prompt on nothing.
    return { result: { error: "Signing in is not configured in this build." } };
  }
  try {
    const issued = await attempt.signIn(signer);
    const { error: refused } = await supabase.auth.setSession({
      access_token: issued.session.accessToken,
      refresh_token: issued.session.refreshToken,
    });
    if (refused) {
      throw new Error(refused.message);
    }
    return {
      result: { token: issued.session.accessToken },
      session: {
        token: issued.session.accessToken,
        userId: issued.userId,
        address: signer.address,
        namespace: "eip155",
      },
    };
  } catch (caught) {
    return { result: { error: signInWords(caught) } };
  }
}
