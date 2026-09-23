"use client";

// The custody ceremonies, in the order they happen, as functions rather than as a hook.
//
// This is the one thing the shell owns that crosses screens, and it is the one thing in the shell
// worth checking: which call follows which, what is still true when one of them fails halfway, and
// which token each write is signed with. None of that can be driven from node:test while it lives
// inside a useCallback, so it lives here and passkey-flow.tsx calls it.
//
// Two orderings below are load-bearing rather than incidental:
//
// - The WebAuthn ceremony comes first, before the session token is read. Safari requires transient
//   user activation for `credentials.create()`, and an awaited fetch between the click and the
//   prompt can spend it. Everything the ceremony needs is already in hand by then: the challenge
//   was fetched when the sheet opened.
// - The token is read again after the ceremony, and again after the stamp. A prompt can sit on
//   screen for minutes while somebody finds their phone, and supabase-js refreshes an expired
//   session as it hands the token over — so a token read afterwards is one the API will still
//   accept, where the one read beforehand may not be.

import { createPasskey, describeCeremonyFailure, type Attachment } from "./ceremony";
import type {
  AddedPasskeyDto,
  ChallengeOptionsDto,
  RegisteredWalletDto,
  SignedActivityDto,
  UnsignedActivityDto,
  WalletDto,
} from "./custody-api";
import { challenge, confirmAdd, prepareAdd, register } from "./custody-api";
import { ApiError } from "./pickler-api";

/** Thrown when there is no session to read a token from at all, rather than an expired one. */
export class SessionExpired extends Error {
  constructor() {
    super("Not signed in");
    this.name = "SessionExpired";
  }
}

/** The four signing routes a ceremony touches. A test hands the same shape with fakes. */
export interface CustodyApi {
  challenge(token: string): Promise<ChallengeOptionsDto>;
  register(
    token: string,
    input: { label: string; challenge: string; attestation: AttestationInput },
  ): Promise<RegisteredWalletDto>;
  prepareAdd(
    token: string,
    input: { label: string; challenge: string; attestation: AttestationInput },
  ): Promise<UnsignedActivityDto>;
  confirmAdd(
    token: string,
    input: {
      label: string;
      credentialId: string;
      transports: string[];
      signed: SignedActivityDto;
    },
  ): Promise<AddedPasskeyDto>;
}

type AttestationInput = Awaited<ReturnType<typeof createPasskey>>;

/** The real routes, bound here so the shell cannot put one of them in the wrong slot. */
export const CUSTODY_API: CustodyApi = { challenge, register, prepareAdd, confirmAdd };

export interface CustodyDeps {
  /** Reads a fresh access token, or throws SessionExpired. */
  token: () => Promise<string>;
  /** `navigator.credentials` in a browser; injected so the sequencing below is testable. */
  credentials: CredentialsContainer;
  api: CustodyApi;
  /** `new WebauthnStamper({ rpId }).stamp(body)`, injected for the same reason. */
  stamp: (rpId: string, body: string) => Promise<SignedActivityDto["stamp"]>;
}

/**
 * Step zero of every ceremony, run when the sheet opens rather than when it is confirmed.
 *
 * Two things come of doing it early: the sheet can name the relying party the ceremony will
 * actually use, which is the domain worth checking before agreeing to anything, and the confirm
 * that follows reaches `credentials.create()` without awaiting a fetch on the way.
 */
export async function openChallenge(deps: CustodyDeps): Promise<ChallengeOptionsDto> {
  return deps.api.challenge(await deps.token());
}

/**
 * The first passkey: this device's own, and the wallet that comes back with it.
 *
 * The address in the response is the only place an address enters the browser; the caller puts it
 * on the flow machine and every screen reads it from there.
 */
export async function createWallet(
  deps: CustodyDeps,
  input: { options: ChallengeOptionsDto; label: string },
): Promise<RegisteredWalletDto> {
  const attestation = await createPasskey(deps.credentials, input.options, "platform");
  return deps.api.register(await deps.token(), {
    label: input.label,
    challenge: input.options.challenge,
    attestation,
  });
}

/**
 * A second passkey on an account that already has one — a backup, or this new device.
 *
 * Both are the same two ceremonies back to back and differ only in which authenticator the first
 * one asks for: "cross-platform" to put a backup on a phone or a security key, "platform" to save
 * one on the browser in front of you. The second ceremony is the stamp, and it is the phone's: the
 * operating system draws the QR code for it, not us.
 *
 * It is not atomic, and cannot be. The credential exists on the device the moment the first
 * ceremony returns; nothing has admitted it to the account until `confirmAdd`. A failure between
 * the two leaves a passkey that authorises nothing — see the caller, which says so.
 */
export async function addPasskey(
  deps: CustodyDeps,
  input: {
    options: ChallengeOptionsDto;
    label: string;
    attachment: Attachment;
    /** Which half is running, for the sheet's "1 of 2". */
    onStep?: (step: 1 | 2) => void;
  },
): Promise<AddedPasskeyDto> {
  input.onStep?.(1);
  const attestation = await createPasskey(deps.credentials, input.options, input.attachment);
  const activity = await deps.api.prepareAdd(await deps.token(), {
    label: input.label,
    challenge: input.options.challenge,
    attestation,
  });

  input.onStep?.(2);
  const stamp = await deps.stamp(input.options.rp.id, activity.body);
  return deps.api.confirmAdd(await deps.token(), {
    label: input.label,
    credentialId: attestation.credentialId,
    transports: attestation.transports,
    signed: { url: activity.url, body: activity.body, stamp },
  });
}

const EXPIRED = "Your sign-in expired while that was open. Sign in again — nothing was created.";

/**
 * What the sheet says when a ceremony ends badly, or null when there is nothing to say.
 *
 * `describeCeremonyFailure` answers for the ceremony itself and returns null for a prompt the
 * person dismissed. This adds the one failure that is neither the authenticator's nor a fault of
 * theirs: the session running out while the prompt was up. Saying "please try again" to that would
 * send somebody round the same loop for ever.
 */
export function describeCustodyFailure(error: unknown): string | null {
  if (error instanceof SessionExpired) {
    return EXPIRED;
  }
  if (error instanceof ApiError && error.status === 401) {
    return EXPIRED;
  }
  return describeCeremonyFailure(error);
}

/** Which screen a signed-in person belongs on. */
export type Landing = "handle" | "passkey" | "recover" | "welcome";

/**
 * Where to put somebody who has just proved an email address, from what the account actually
 * holds rather than from which link they arrived on.
 *
 * `enrolledHere` is the one part that is not server truth: no browser API says whether this device
 * holds a credential for an account without running a ceremony to find out, so it is a mark this
 * browser left on itself. It is read only to choose between `welcome` and `recover` — the
 * new-device path is what an unmarked browser gets, which is the safe way round, because its
 * remedy is to add a passkey and adding a second one costs a ceremony rather than an account.
 */
export function landing(account: {
  /** The profile's handle, or null when there is no profile yet. */
  handle: string | null;
  /** From GET /wallets/me; null for an account that never finished creating a passkey. */
  wallet: WalletDto | null;
  enrolledHere: boolean;
}): Landing {
  if (account.handle === null) {
    return "handle";
  }
  if (account.wallet === null) {
    return "passkey";
  }
  return account.enrolledHere ? "welcome" : "recover";
}

/** `window.localStorage`, narrowed to what the mark needs and nullable where there is none. */
export interface EnrolmentStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MARK = "pickler.passkey.";

/**
 * Whether this browser has ever finished a ceremony for this account.
 *
 * Every failure reads as "no": a private window throws on the property, a cleared store has
 * forgotten, and both should send somebody down the path that offers to add a passkey rather than
 * the one that assumes they have one here.
 */
export function isEnrolledHere(store: EnrolmentStore | null, userId: string): boolean {
  try {
    return store?.getItem(MARK + userId) === "1";
  } catch {
    // A browser that refuses storage is one that will never remember; that is not an error here.
    return false;
  }
}

/** Left after any ceremony this browser completes, per account. */
export function markEnrolled(store: EnrolmentStore | null, userId: string): void {
  try {
    store?.setItem(MARK + userId, "1");
  } catch {
    // Nothing is lost that was not already unavailable: see isEnrolledHere.
  }
}
