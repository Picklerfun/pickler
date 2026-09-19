// Ported from Relayer apps/api/src/api/utils/crypto.util.ts (commit bb6bb1226e92).
// Same byte formats, so values written by Relayer's backend decrypt here and vice versa.
// Node's scryptSync is replaced by @noble/hashes and node:crypto by WebCrypto so this
// runs unchanged on Cloudflare Workers and Node.

import { scryptAsync } from "@noble/hashes/scrypt.js";

const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// Node's scryptSync defaults, which Relayer relied on implicitly.
const SCRYPT = { N: 2 ** 14, r: 8, p: 1, dkLen: KEY_LENGTH } as const;
const LEGACY_STATIC_SALT = "salt";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export class DecryptionError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Unable to decrypt value", options);
    this.name = "DecryptionError";
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new DecryptionError();
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function deriveKey(secret: string, salt: Uint8Array | string): Promise<CryptoKey> {
  const raw = await scryptAsync(
    encoder.encode(secret),
    typeof salt === "string" ? encoder.encode(salt) : salt,
    SCRYPT,
  );
  return crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function open(
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: Uint8Array,
  authTag: Uint8Array,
): Promise<string> {
  // WebCrypto expects the tag appended to the ciphertext.
  const sealed = new Uint8Array(ciphertext.length + authTag.length);
  sealed.set(ciphertext);
  sealed.set(authTag, ciphertext.length);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: AUTH_TAG_LENGTH * 8 },
      key,
      sealed,
    );
    return decoder.decode(plain);
  } catch (cause) {
    throw new DecryptionError({ cause });
  }
}

/** hex(salt[16] ‖ iv[16] ‖ ciphertext ‖ tag[16]), key = scrypt(secret, salt). */
export async function encryptAes256Gcm(plaintext: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(secret, salt);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: AUTH_TAG_LENGTH * 8 },
      key,
      encoder.encode(plaintext),
    ),
  );
  const out = new Uint8Array(SALT_LENGTH + IV_LENGTH + sealed.length);
  out.set(salt);
  out.set(iv, SALT_LENGTH);
  out.set(sealed, SALT_LENGTH + IV_LENGTH);
  return toHex(out);
}

export async function decryptAes256Gcm(ciphertextHex: string, secret: string): Promise<string> {
  const data = fromHex(ciphertextHex);
  if (data.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new DecryptionError();
  }
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH, data.length - AUTH_TAG_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  return open(await deriveKey(secret, salt), iv, ciphertext, authTag);
}

/** Legacy JSON format {"iv","data","tag"} (hex fields) with a static scrypt salt. Read-only. */
export async function decryptLegacyAes256Gcm(
  encryptedJson: string,
  secret: string,
): Promise<string> {
  let parsed: { iv?: unknown; data?: unknown; tag?: unknown };
  try {
    parsed = JSON.parse(encryptedJson) as typeof parsed;
  } catch (cause) {
    throw new DecryptionError({ cause });
  }
  if (
    typeof parsed.iv !== "string" ||
    typeof parsed.data !== "string" ||
    typeof parsed.tag !== "string"
  ) {
    throw new DecryptionError();
  }
  return decryptLegacySeparateColumns(parsed.data, parsed.iv, parsed.tag, secret);
}

/** Legacy format stored across three hex columns with a static scrypt salt. Read-only. */
export async function decryptLegacySeparateColumns(
  encryptedHex: string,
  ivHex: string,
  authTagHex: string,
  secret: string,
): Promise<string> {
  return open(
    await deriveKey(secret, LEGACY_STATIC_SALT),
    fromHex(ivHex),
    fromHex(encryptedHex),
    fromHex(authTagHex),
  );
}

export const isLegacyFormat = (stored: string) => stored.startsWith("{");
