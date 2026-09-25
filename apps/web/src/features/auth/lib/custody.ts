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
import type { FlowEvent } from "./flow";
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
): Promise<RegisteredWalletDto & { credentialId: string }> {
  const attestation = await createPasskey(deps.credentials, input.options, "platform");
  const account = await deps.api.register(await deps.token(), {
    label: input.label,
    challenge: input.options.challenge,
    attestation,
  });
  // The credential this device just made, so the caller can check it is the one the account
  // holds: `register` is idempotent, and answers an account another tab created with a different
  // passkey exactly as it answers the one this call made (see `enrolmentOutcome`).
  return { ...account, credentialId: attestation.credentialId };
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

/**
 * The authenticator's word for "I already hold a credential for that account".
 *
 * It is raised by `excludeCredentials`, which every challenge carries, and on the new-device path
 * it is not a failure at all: it is the answer to the question that screen was asking, from the
 * one thing that actually knows. See `isEnrolledHere` for why that matters.
 */
export const alreadyEnrolled = (error: unknown): boolean =>
  error instanceof Error && error.name === "InvalidStateError";

/** Which screen a signed-in person belongs on. */
export type Landing = "handle" | "passkey" | "recover" | "welcome";

/**
 * Where to put somebody who has just proved an email address, from what the account actually
 * holds rather than from which link they arrived on.
 *
 * `enrolledHere` is the one part that is not server truth. It is read only to choose between
 * `welcome` and `recover`, and `isEnrolledHere` says at length why it is a hint rather than a fact.
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
 * Read this before trying to make it authoritative, because it cannot be. **No browser API answers
 * "does this account have a credential on this device"** without running a ceremony, which means
 * putting a prompt in front of somebody to find out what to show them. So the question is answered
 * from a mark the browser left on itself, and a mark is a hint. It is wrong in at least three
 * ordinary situations, none of them exotic:
 *
 * - the store was cleared, or is refused — a private window, "clear site data", a locked-down
 *   profile — so a browser that has enrolled reads as one that has not;
 * - the passkey is in a platform store that syncs, iCloud Keychain or Google Password Manager, so
 *   a second browser or a fresh profile on the same machine can use a credential it never made;
 * - the account was created on another device entirely and its passkey has since synced here.
 *
 * Every failure reads as "no" on purpose. The unmarked path is the new-device screen, whose remedy
 * costs a ceremony rather than an account, where the marked path would quietly assume a passkey
 * that may not exist. But being wrong in the safe direction is still being wrong, which is why
 * that screen has a way out of it and why `alreadyEnrolled` exists: when the authenticator refuses
 * a duplicate, it has just told us the truth this mark was guessing at, and the caller corrects
 * the mark rather than arguing with it.
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

/** Which half of /passkey a signed-in person sees. */
export type PasskeyScreen = "create" | "add";

/**
 * `/passkey` is where anyone who reached a signed-in screen without a sub-organization is sent
 * (spec §4.1): a sign-up closed at the passkey step, or an account from before the passkey was
 * mandatory. So it reads the same signal `landing` reads (GET /wallets/me; a 404 is an account
 * with no sub-organization) and draws either the enrolment ceremony that creates one, or the
 * add-a-device screen for one that exists. There is no third answer: a sub-organization with no
 * wallet is not a state this reads, because `register` cannot return without one.
 */
export function passkeyScreenFor(account: { hasSubOrganization: boolean }): PasskeyScreen {
  return account.hasSubOrganization ? "add" : "create";
}

/**
 * The signed-in person's master wallet from GET /wallets/me, or null when there is no
 * sub-organization (a 404). Any other failure propagates, because a wallet that could not be read
 * is not a missing one, and sending somebody with a wallet to create another would be the wrong
 * door.
 */
export async function readSubOrganization<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Where a signed-in screen sends a person, from `readSubOrganization`'s answer: `/passkey` when
 * there is no sub-organization (spec §4.1 — the master wallet comes before anything else), and
 * nowhere when there is one. The studio shell, the create screen and /account all ask this.
 */
export function redirectFor(wallet: unknown): "/passkey" | null {
  return wallet === null ? "/passkey" : null;
}

/**
 * A create ceremony failed; the sub-organization has been read again since. If it exists now —
 * another tab finished signup, or a /passkey screen was opened before one did, so the
 * authenticator refused a duplicate through `excludeCredentials` — the step is done and the
 * person moves on. Retrying would only fail the same way for ever.
 */
export function afterFailedCreate(subOrganizationNow: boolean): "advance" | "retry" {
  return subOrganizationNow ? "advance" : "retry";
}

/**
 * Whether the passkey this device just created is the one the account holds.
 *
 * `register` returns the existing account when there already is one, and core returns the
 * winner's when two tabs race (reporting the loser's sub-organization as an orphan). Either way
 * this device's credential authorises nothing, and marking the browser enrolled would be a lie the
 * sign-in screen then trusts. So the account's passkey list is read after the ceremony:
 *
 * - `enrolled` — the credential is on the account; mark the browser.
 * - `orphan` — the list was read and the credential is not on it; do not mark, and show the
 *   add-device screen, which lists what the account really holds.
 * - `unknown` — the list could not be read; do not mark (the mark is a hint, and "no" is its
 *   safe direction), and carry on.
 */
export function enrolmentOutcome(
  credentialId: string,
  passkeys: readonly { credential_id: string }[] | null,
): "enrolled" | "orphan" | "unknown" {
  if (passkeys === null) {
    return "unknown";
  }
  return passkeys.some((passkey) => passkey.credential_id === credentialId) ? "enrolled" : "orphan";
}

/**
 * What a verified code dispatches, from what the account holds. `handle` and `wallet` are null
 * for a 404; a read that failed any other way never reaches here — the code screen says so and
 * offers to try again, rather than guessing at a welcome.
 */
export function verifiedEvent(account: {
  mode: "up" | "in";
  handle: string | null;
  wallet: WalletDto | null;
  enrolledHere: boolean;
}): FlowEvent {
  switch (landing(account)) {
    case "handle":
      return { type: "profile_missing" };
    case "passkey":
      return { type: "wallet_missing" };
    case "recover":
      return { type: "device_unknown" };
    case "welcome":
      return account.mode === "in" ? { type: "code_verified" } : { type: "account_found" };
  }
}
