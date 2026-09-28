"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, createProfile, getProfile, type ProfileDto } from "./pickler-api";

export type AccountResult =
  | { kind: "ready"; profile: ProfileDto }
  | { kind: "needs_profile" }
  | { kind: "confirm_email"; email: string };

/**
 * The three calls the account and code screens make, and nothing else. Typed as a slice rather
 * than as the whole `SupabaseClient` for the same reason ceremony.ts takes a CredentialsContainer:
 * a real client cannot be created in node:test, and every assertion about what Supabase was
 * actually handed — that `shouldCreateUser` is true, that the redirect is the callback route —
 * exists because a fake can stand in here. A real client satisfies it structurally.
 */
export type AuthCalls = Pick<
  SupabaseClient["auth"],
  "signInWithOAuth" | "signInWithOtp" | "verifyOtp"
>;

/** The route that already exists and already exchanges the PKCE code for a session. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Supabase's own name for the X provider is still `twitter`; the button says X. */
export type OAuthProvider = "google" | "twitter";

/** Plausible enough to be worth sending a code to. The server is the real judge. */
export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Hands the browser off to the provider. It never returns normally on success — Supabase
 * navigates away — so anything after the await is a failure worth showing.
 *
 * @param origin injected so this is testable; it is the page's own origin in a browser.
 */
export async function signInWithProvider(
  supabase: { auth: AuthCalls },
  provider: OAuthProvider,
  origin: string = window.location.origin,
): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}${AUTH_CALLBACK_PATH}` },
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Sends the six-digit code. `shouldCreateUser: true` is what makes one call serve both rails:
 * an address nobody has used becomes an account, and one that exists just gets a code. It is
 * also why the account screen's toggle is a matter of which rail the flow takes afterwards,
 * not of which call it makes.
 *
 * The Supabase project's magic-link template has to include `{{ .Token }}`, or the email
 * arrives with a link and no digits to type.
 */
export async function sendEmailCode(supabase: { auth: AuthCalls }, email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Verifies the code and signs the person in.
 *
 * Returns false when the code was not accepted, and throws for everything else, so the screen
 * can tell "try again" from "something broke". GoTrue answers a wrong code and an expired one
 * with the same 403 `otp_expired` — "Token has expired or is invalid" — so those two cannot be
 * separated here, and the screen must not claim to know which happened.
 */
export async function verifyEmailCode(
  supabase: { auth: AuthCalls },
  email: string,
  code: string,
): Promise<boolean> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code,
    type: "email",
  });
  if (!error) {
    return true;
  }
  // The status is checked as well as the code because older GoTrue releases send the 403 without
  // an `error_code`, and a rejected code read as a fault would show a red banner for a typo.
  if (error.code === "otp_expired" || error.status === 403) {
    return false;
  }
  throw new Error(error.message);
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
