/**
 * Connect X by verification post (docs/specs/studio-draft-dashboard-v1.md, D4): the handle the
 * owner types, the code Pickler issues, the line they post, and the match that proves the account
 * is theirs. Pure; the X API read and the stored challenge live in infrastructure.
 */

/** A challenge stays good for a day; after that the owner starts over. */
export const X_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
/** "Check again" is not spammed: one read per challenge per this long. */
export const X_CHECK_INTERVAL_MS = 10_000;

/** A post as the verification reads it from X. */
export interface XPost {
  id: string;
  authorId: string;
  text: string;
  createdAt: Date;
}

/** The handle without its "@", or null when X would not accept it (1 to 15 of letters, digits, _). */
export function normalizeXHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * "pk-" and eight base32 characters (RFC 4648, lowercase) of the given bytes. Five bytes are
 * exactly forty bits, so the caller passes `crypto.getRandomValues(new Uint8Array(5))`.
 */
export function challengeCode(bytes: Uint8Array): string {
  if (bytes.length !== 5) {
    throw new RangeError("A challenge code is made from exactly five random bytes");
  }
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return `pk-${out.slice(0, 8)}`;
}

/** The line the owner posts from their account. */
export function verificationText(name: string, code: string): string {
  return `Verifying ${name} on @pickler · ${code}`;
}

/**
 * The post that proves control: by the verified user, made at or after the challenge, carrying the
 * code as a whole token. Case is ignored, as people retype what they copy.
 */
export function findVerificationPost(
  posts: readonly XPost[],
  want: { userId: string; code: string; since: Date },
): XPost | null {
  const escaped = want.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9])`, "i");
  return (
    posts.find(
      (post) =>
        post.authorId === want.userId &&
        post.createdAt.getTime() >= want.since.getTime() &&
        token.test(post.text),
    ) ?? null
  );
}
