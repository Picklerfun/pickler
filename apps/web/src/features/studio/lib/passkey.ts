"use client";
import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import {
  CUSTODY_API,
  SessionExpired,
  openChallenge,
  type CustodyDeps,
} from "@/features/auth/lib/custody";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import type { SignedActivityDto } from "../api";

/**
 * The studio's passkey: the creation ceremony and the home's deposit stamp with the same
 * `WebauthnStamper`, against the relying party the custody challenge names.
 */

/** The access token, read again after every prompt: a prompt can outlive a session. */
export async function session() {
  const supabase = getSupabase();
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  if (!data.session) {
    throw new SessionExpired();
  }
  return { token: data.session.access_token, userId: data.session.user.id };
}

export function custody(): CustodyDeps {
  return {
    token: async () => (await session()).token,
    credentials: navigator.credentials,
    api: CUSTODY_API,
    stamp: (rpId, body) => new WebauthnStamper({ rpId }).stamp(body),
  };
}

/** The relying party a stamp must be made for: the `rp.id` of a fresh custody challenge. */
export async function relyingParty(): Promise<string> {
  return (await openChallenge(custody())).rp.id;
}

/**
 * Stamps an unsigned activity exactly as the API built it. The body is passed through untouched —
 * the API byte-compares it with what its prepare returned — so it is never parsed or re-serialized.
 */
export async function stampActivity(
  rpId: string,
  unsigned: { url: string; body: string },
): Promise<SignedActivityDto> {
  return {
    url: unsigned.url,
    body: unsigned.body,
    stamp: await new WebauthnStamper({ rpId }).stamp(unsigned.body),
  };
}
