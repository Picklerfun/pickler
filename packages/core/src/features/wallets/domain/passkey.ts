// Ported from Relayer apps/web/lib/webauthn/buffer-utils.ts#toTurnkeyTransports and
// apps/api/src/kits/signing/passkeys/device-type.util.ts (commit bb6bb1226e92).
// Changed: device type is derived from transports rather than from an AAGUID vendor table.
// Relayer's table needs upkeep per vendor and is only used to label a row in the interface.

/**
 * The activity type that adds a device to an existing sub-organization.
 *
 * Turnkey's /public/v1/submit/create_authenticators endpoint accepts only the `_V2` literal:
 * @turnkey/http types the request's `type` as that single literal, so no other value is even
 * expressible. The un-suffixed `ACTIVITY_TYPE_CREATE_AUTHENTICATORS` also exists, but only as a
 * historical label on activities read back from get_activity and list_activities — it cannot be
 * submitted.
 *
 * It lives here, rather than as a literal on each side, because two places must agree on it: the
 * adapter that builds the unsigned body, and the allow-list `confirmAddPasskey` hands the
 * forwarder. When they disagreed, every add-device attempt failed at the forwarder — after the
 * person had completed both biometric ceremonies and after the challenge had been spent.
 */
export const ADD_PASSKEY_ACTIVITY_TYPE = "ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2";

/** What `navigator.credentials.create()` gives us, base64url-encoded. */
export interface PasskeyAttestation {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export type DeviceType = "platform" | "cross_device" | "security_key";

/**
 * What a passkey is labelled with, in the operating system's credential picker and in Turnkey's
 * dashboard. Deliberately not an email.
 *
 * WebAuthn's `user.name` and `user.displayName` are stored inside the authenticator and sync to
 * iCloud Keychain and Google Password Manager, so whatever goes here outlives the account and
 * cannot be edited afterwards by us or by the person. An auth identifier must therefore never be
 * passed in: for a wallet account that identifier is synthetic and derived from the wallet, and
 * labelling a credential with it would put a wallet address in someone's password manager for
 * good. The profile is the right source — it is the name the person chose to be known by.
 */
export interface DisplayIdentity {
  /** WebAuthn `user.name`: short and stable, the handle where there is one. */
  name: string;
  /** WebAuthn `user.displayName`: what a person recognises themselves as. */
  displayName: string;
}

export interface ChallengeOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  authenticatorSelection: { residentKey: "preferred"; userVerification: "preferred" };
  timeout: number;
  attestation: "none";
  excludeCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
}

/**
 * The transports a browser may report, in the WebAuthn spelling `AuthenticatorTransport` uses.
 *
 * It is the whole of what `toTurnkeyTransports` below can produce a valid Turnkey value from:
 * Turnkey's `v1AuthenticatorTransport` has exactly five members, and anything else — the
 * "smart-card" and "cable" the spec also defines, or a word an attacker invents — becomes an
 * `AUTHENTICATOR_TRANSPORT_SMART-CARD` that Turnkey rejects after the person has already
 * completed the biometric ceremony. Callers validate against this before the value travels.
 * The correspondence with the vendor enum is asserted against @turnkey/http's types in
 * @pickler/infrastructure, which is the only package allowed to see them.
 */
export const SUPPORTED_TRANSPORTS = ["ble", "hybrid", "internal", "nfc", "usb"] as const;

export function toTurnkeyTransports(transports: string[] | undefined): string[] {
  if (!transports?.length) {
    return ["AUTHENTICATOR_TRANSPORT_INTERNAL"];
  }
  return transports.map((t) => `AUTHENTICATOR_TRANSPORT_${t.toUpperCase()}`);
}

export function deviceTypeFromTransports(transports: string[]): DeviceType {
  if (transports.includes("hybrid")) {
    return "cross_device";
  }
  if (transports.some((t) => t === "usb" || t === "nfc" || t === "ble")) {
    return "security_key";
  }
  return "platform";
}

/**
 * The challenge was never issued, was already used, belongs to someone else, or has expired
 * (HTTP 400).
 *
 * The causes deliberately share one error and one message. Telling them apart would hand a
 * caller an enumeration oracle: "not yours" rather than "no such challenge" confirms that a
 * given challenge exists and is held by somebody, which is exactly what an attacker guessing
 * at them wants to learn. The callers also do equal work before rejecting — the challenge is
 * consumed first and every clause is judged on the record already in hand — so the three do
 * not differ in timing either. Resist adding a cause, a code or a more helpful message here
 * for debuggability; log the detail at the call site instead.
 */
export class ChallengeNotUsableError extends Error {
  constructor() {
    super("This passkey request expired. Start again.");
    this.name = "ChallengeNotUsableError";
  }
}

/** This person has no sub-organization yet, so there is nothing to add a device to (HTTP 409). */
export class NoCustodyAccountError extends Error {
  constructor() {
    super("No wallet exists for this account yet");
    this.name = "NoCustodyAccountError";
  }
}
