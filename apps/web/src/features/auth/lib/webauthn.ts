// Ported from Relayer apps/web/lib/webauthn/buffer-utils.ts (commit bb6bb1226e92).
// Changed: `toTurnkeyTransports` stayed behind. The browser reports WebAuthn spellings and the
// API refuses anything that is not one of them, so the vendor prefix is applied server side, in
// @pickler/core, where the list of names Turnkey knows already lives.
//
// The browser speaks ArrayBuffer and the wire speaks base64url. This module is the only place
// that conversion happens, so a padding or alphabet mistake has exactly one home.

/**
 * Encodes to base64url: standard base64 with `+`→`-`, `/`→`_` and the trailing `=` removed.
 *
 * The bytes are accumulated one at a time rather than through `String.fromCharCode(...bytes)`,
 * which spreads the whole buffer as arguments and overflows the stack on a large attestation
 * object — a failure that only shows up on the devices that produce large ones.
 */
export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Reverses `bufferToBase64url`, restoring the padding it stripped.
 *
 * `atob` rejects a length that is not a multiple of four, so the padding has to come back before
 * decoding; the API's own validator accepts values that still carry it, so a padded input must
 * decode to the same bytes as an unpadded one.
 */
export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * `getTransports()` is optional and absent on some authenticators; internal is the safe default.
 *
 * It matches what the API does with an empty list — a browser that reports nothing is almost
 * always a platform authenticator — so sending `["internal"]` and sending `[]` mean the same
 * thing there. Lower casing is for the few browsers that have shouted the names back.
 */
export function normalizeTransports(transports: string[] | undefined): string[] {
  if (!transports?.length) {
    return ["internal"];
  }
  return transports.map((transport) => transport.toLowerCase());
}
