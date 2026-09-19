"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authConfig } from "./config";
import { ApiError, createProfile, getProfile, type ProfileDto } from "./pickler-api";

export type AccountResult =
  | { kind: "ready"; profile: ProfileDto }
  | { kind: "needs_profile" }
  | { kind: "confirm_email"; email: string };

const STATEMENT = "Sign in to Pickler. This does not move funds.";

/** Sign-In with Ethereum through Supabase Auth, using the browser wallet (EIP-1193). */
export async function signInWithWallet(supabase: SupabaseClient): Promise<void> {
  if (typeof window === "undefined" || !(window as { ethereum?: unknown }).ethereum) {
    throw new Error("No wallet found in this browser. Install a wallet extension or use email.");
  }
  const { error } = await supabase.auth.signInWithWeb3({
    chain: "ethereum",
    statement: STATEMENT,
    options: { signInWithEthereum: { chainId: authConfig.siweChainId } },
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** After any sign-in: load the profile, or create it from the details given at sign-up. */
export async function ensureProfile(
  supabase: SupabaseClient,
  pending?: { displayName: string; handle: string },
): Promise<AccountResult> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    throw new Error("Not signed in");
  }

  try {
    return { kind: "ready", profile: await getProfile(session.access_token) };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }

  const metadata = session.user.user_metadata as { display_name?: unknown; handle?: unknown };
  const details =
    pending ??
    (typeof metadata.display_name === "string" && typeof metadata.handle === "string"
      ? { displayName: metadata.display_name, handle: metadata.handle }
      : null);
  if (!details) {
    return { kind: "needs_profile" };
  }

  try {
    return { kind: "ready", profile: await createProfile(session.access_token, details) };
  } catch (error) {
    // The handle picked at sign-up was claimed before the email was confirmed.
    if (
      error instanceof ApiError &&
      (error.code === "handle_taken" || error.code === "invalid_profile")
    ) {
      return { kind: "needs_profile" };
    }
    throw error;
  }
}

export async function signUpWithEmail(
  supabase: SupabaseClient,
  input: { email: string; password: string; displayName: string; handle: string },
): Promise<AccountResult> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      // Kept on the auth user so the profile can be created after email confirmation.
      data: { display_name: input.displayName, handle: input.handle },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
  if (!data.session) {
    return { kind: "confirm_email", email: input.email.trim() };
  }
  return ensureProfile(supabase, { displayName: input.displayName, handle: input.handle });
}
