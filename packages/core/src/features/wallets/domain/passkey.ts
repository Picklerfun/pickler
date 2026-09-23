// Ported from Relayer apps/web/lib/webauthn/buffer-utils.ts#toTurnkeyTransports and
// apps/api/src/kits/signing/passkeys/device-type.util.ts (commit bb6bb1226e92).
// Changed: device type is derived from transports rather than from an AAGUID vendor table.
// Relayer's table needs upkeep per vendor and is only used to label a row in the interface.

/** What `navigator.credentials.create()` gives us, base64url-encoded. */
export interface PasskeyAttestation {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export type DeviceType = "platform" | "cross_device" | "security_key";

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
