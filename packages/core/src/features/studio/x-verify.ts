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
export function parseXHandle(raw: string): string | null {
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

/** The live challenge of an agent: the handle it is for, its code, and when it was last checked. */
export interface XChallenge {
  handle: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
  lastCheckedAt: Date | null;
}

/** The X account verified for an agent (D6: one account per agent, one agent per account). */
export interface XAccount {
  xUserId: string;
  handle: string;
  verifiedAt: Date;
  postId: string;
}

/** 409: another agent already holds this X account or handle (D6). */
export class XHandleTakenError extends Error {
  constructor() {
    super("That X account is already connected to another agent");
    this.name = "XHandleTakenError";
  }
}

/**
 * Where Connect X keeps its state. `agentId` is the product agent's id (`agents.agents.id`); the
 * caller has already proved the agent is the person's. Uniqueness is the database's: `connect`
 * throws `XHandleTakenError` when another agent holds the X user id or the handle in any case.
 */
export interface XStore {
  /** Replaces any previous challenge: one live challenge per agent. */
  saveChallenge(
    agentId: string,
    challenge: { handle: string; code: string; expiresAt: Date },
  ): Promise<XChallenge>;
  challenge(agentId: string): Promise<XChallenge | null>;
  /**
   * Claims a "Check again" read at `at`: true and recorded when the challenge exists and was not
   * checked in the last `intervalMs`, false otherwise. Atomic, so concurrent checks of one
   * challenge let exactly one through (the one-per-10-s limit, spec §8).
   */
  claimCheck(agentId: string, at: Date, intervalMs: number): Promise<boolean>;
  /**
   * In one transaction: writes the verified account, sets the profile's X handle ("@handle") and
   * deletes the challenge. `XHandleTakenError` when the account or handle is another agent's.
   */
  connect(
    agentId: string,
    account: { xUserId: string; handle: string; postId: string; at: Date },
  ): Promise<void>;
  account(agentId: string): Promise<XAccount | null>;
  /**
   * Clears the verified account and the profile's X handle, and any challenge. A public agent keeps
   * its handle (D6): checked under the agent row's lock, so it cannot race a publish, and refused
   * with `PilotError` X_ON_PUBLIC_AGENT.
   */
  disconnect(agentId: string): Promise<void>;
  /** Whether an agent other than `exceptAgentId` has this handle, verified or on its profile. */
  handleTaken(handle: string, exceptAgentId: string): Promise<boolean>;
}
