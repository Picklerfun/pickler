"use client";

// The five routes workers/api mounts at /v1/signing, typed from the browser's side. Nothing here
// invents a shape: each one is the response signing.ts actually builds, and the DTOs are pinned
// against @pickler/core's own types in apps/web/test/custody-api.test.ts wherever core has one.
//
// It is built on pickler-api's `call` rather than a second fetch layer: that one already turns a
// non-2xx or `success: false` envelope into an ApiError carrying the status, the error code and
// the reason, which is exactly what a caller needs to tell a spent challenge (400) from an
// account with no wallet yet (404).

import { call } from "./pickler-api";

/** Passed to `navigator.credentials.create()` after the base64url fields are decoded. */
export interface ChallengeOptionsDto {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  authenticatorSelection?: {
    residentKey: ResidentKeyRequirement;
    userVerification: UserVerificationRequirement;
  };
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
}

/** What the ceremony produces and every write route below accepts. */
export interface AttestationDto {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

/**
 * What POST /passkeys/register answers with.
 *
 * Deliberately not the same type as WalletDto below, though the plan asked for one: the register
 * route answers with the sub-organization and the master wallet and no balances, and
 * GET /wallets/me answers with balances and neither id. A single type carrying all four would
 * declare fields that one of the two responses never sends, and `call`'s `as T` would never
 * notice — the caller would read `undefined` from a field the type promises.
 */
export interface RegisteredWalletDto {
  sub_organization_id: string;
  master_wallet_id: string;
  address: string;
}

/** A balance that could not be read comes back with a null `raw` rather than a zero. */
export interface BalanceDto {
  symbol: string;
  decimals: number;
  raw: string | null;
}

/**
 * One passkey, as GET /passkeys sends it.
 *
 * Both nullable fields are nullable here too, deliberately. `device_type` is null when the
 * transports named no device class, and `last_used_at` is null for a passkey that has never signed
 * anything — a fact the account screen shows rather than fills in. Widening either to a string
 * would make the DTO promise a value the route does not always send, and `call`'s `as T` would
 * never notice.
 */
export interface PasskeyDto {
  id: string;
  credential_id: string;
  label: string;
  transports: string[];
  device_type: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** What GET /wallets/me answers with. */
export interface WalletDto {
  address: string;
  balances: { native: BalanceDto; token: BalanceDto };
}

/** The Turnkey request the browser must stamp, answered in the shape the stamper consumes. */
export interface UnsignedActivityDto {
  url: string;
  body: string;
  /** A string, not a number: Turnkey's timestamps are milliseconds as decimal text. */
  timestampMs: string;
  organizationId: string;
}

/** The stamped request, in the shape @turnkey/http's stamper produces. */
export interface SignedActivityDto {
  url: string;
  body: string;
  stamp: { stampHeaderName: string; stampHeaderValue: string };
}

/** The id and status of the activity that added the device; not the whole activity. */
export interface AddedPasskeyDto {
  activity_id: string;
  status: string;
}

const SIGNING = "/v1/signing";

const post = <T>(path: string, token: string, body?: unknown) =>
  call<T>(`${SIGNING}${path}`, {
    method: "POST",
    token,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Issues a challenge and the WebAuthn options that go with it. The challenge expires in 5 min. */
export const challenge = (token: string) => post<ChallengeOptionsDto>("/passkeys/challenge", token);

/** Idempotent: a second call for an account that already has a wallet answers with that wallet. */
export const register = (
  token: string,
  input: { label: string; challenge: string; attestation: AttestationDto },
) => post<RegisteredWalletDto>("/passkeys/register", token, input);

export const prepareAdd = (
  token: string,
  input: { label: string; challenge: string; attestation: AttestationDto },
) => post<UnsignedActivityDto>("/passkeys/add/prepare", token, input);

/** `credentialId` becomes `credential_id` on the wire, which is what this route validates. */
export const confirmAdd = (
  token: string,
  input: {
    label: string;
    credentialId: string;
    transports: string[];
    signed: SignedActivityDto;
  },
) =>
  post<AddedPasskeyDto>("/passkeys/add/confirm", token, {
    label: input.label,
    credential_id: input.credentialId,
    transports: input.transports,
    signed: input.signed,
  });

/** Throws ApiError 404 when this account has no wallet yet, which is an ordinary first-run state. */
export const wallet = (token: string) => call<WalletDto>(`${SIGNING}/wallets/me`, { token });

/**
 * Every passkey on this account, oldest first. An account with none answers `[]` rather than 404.
 *
 * **A rejection here must not be turned into an empty list by any caller.** The route does not
 * catch, core does not catch, and the repository method behind it exists separately from
 * `listCredentials` precisely so that the deliberate swallow feeding `excludeCredentials` cannot
 * reach this answer. A screen that renders `[]` for a failed read tells somebody they have no
 * passkeys when nobody looked, which is the more alarming of the two ways to be wrong.
 */
export const passkeys = (token: string) => call<PasskeyDto[]>(`${SIGNING}/passkeys`, { token });
