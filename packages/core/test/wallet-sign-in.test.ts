import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWalletSignIn,
  ExpiredNonceError,
  UnknownNonceError,
  WrongDomainError,
  BadSignatureError,
  AddressTakenError,
  normalizeAddress,
  type NonceStore,
  type WalletLink,
  type WalletLinkRepository,
} from "../src/index.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const DOMAIN = "pickler.fun";
/**
 * Built by the same function production uses rather than cast to `NormalizedAddress`. A cast would
 * assert the literal is in the normalised spelling; this proves it, and costs one regex.
 */
const ADDRESS = normalizeAddress("eip155", "0xabc0000000000000000000000000000000000001");

function nonces(rows = new Map<string, Date>()): NonceStore & { rows: Map<string, Date> } {
  return {
    rows,
    issue: async (nonce, expiresAt) => void rows.set(nonce, expiresAt),
    consume: async (nonce) => {
      const expiresAt = rows.get(nonce);
      if (!expiresAt) {
        return null;
      }
      rows.delete(nonce); // one statement in Postgres; one operation here
      return { expiresAt };
    },
  };
}

function links(rows: WalletLink[] = []): WalletLinkRepository & { rows: WalletLink[] } {
  return {
    rows,
    findByAddress: async (ns, a) => rows.find((r) => r.namespace === ns && r.address === a) ?? null,
    link: async (l) => {
      if (rows.some((r) => r.namespace === l.namespace && r.address === l.address)) {
        return { created: false };
      }
      rows.push({ ...l, verifiedAt: NOW });
      return { created: true };
    },
    listForUser: async (userId) => rows.filter((r) => r.userId === userId),
  };
}

/**
 * The fakes round-trip a string, because that is what the real pair does: infrastructure builds a
 * SIWE message and parses it back. A fake that passed an object straight through would not be
 * exercising the thing the service actually depends on.
 */
const build = (f: { domain: string; address: string; chainReference: number; nonce: string }) =>
  `${f.domain}|${f.address}|${f.chainReference}|${f.nonce}`;

const parse = (raw: string) => {
  const [domain, address, chainReference, nonce] = raw.split("|");
  return {
    domain: domain!,
    address: address!,
    namespace: "eip155" as const,
    chainReference: Number(chainReference),
    nonce: nonce!,
    statement: "Sign in to Pickler",
    issuedAt: NOW.toISOString(),
  };
};

function service(over: Partial<Parameters<typeof createWalletSignIn>[0]> = {}) {
  return createWalletSignIn({
    clock: { now: () => NOW },
    domain: DOMAIN,
    nonces: nonces(),
    links: links(),
    verifier: { verify: async () => true },
    accounts: {
      forAddress: async () => ({ userId: "user-1" }),
      session: async () => ({ accessToken: "at", refreshToken: "rt" }),
    },
    randomNonce: () => "nonce-1",
    buildMessage: build,
    parseMessage: parse,
    ...over,
  });
}

/** A string of the shape the service hands out, with one field overridable per test. */
const signed = (over: { domain?: string; nonce?: string; address?: string } = {}) =>
  build({
    domain: over.domain ?? DOMAIN,
    address: over.address ?? ADDRESS,
    chainReference: 10143,
    nonce: over.nonce ?? "nonce-1",
  });

test("a nonce is issued with a five-minute expiry, and the string to sign comes with it", async () => {
  const store = nonces();
  const signIn = service({ nonces: store });
  const { nonce, message } = await signIn.issueNonce({
    address: ADDRESS,
    namespace: "eip155",
    chainReference: 10143,
  });
  assert.equal(nonce, "nonce-1");
  assert.deepEqual(store.rows.get("nonce-1"), new Date("2026-09-23T12:05:00Z"));
  // The browser signs this and sends it back; it never builds one of its own.
  assert.equal(message, `${DOMAIN}|${ADDRESS}|10143|nonce-1`);
});

test("the address in the message is normalised, so one wallet is one link", async () => {
  const signIn = service();
  const { message } = await signIn.issueNonce({
    address: ADDRESS.toUpperCase().replace("0X", "0x"),
    namespace: "eip155",
    chainReference: 10143,
  });
  assert.ok(message.includes(ADDRESS));
});

/**
 * The happy path goes through the real round trip — issue, then verify the exact string issued —
 * rather than hand-seeding the nonce as the failure cases below do. That is the extra thing worth
 * proving here: the message `issueNonce` hands out is the one `verify` accepts. Two builders that
 * disagree by a byte would leave every other test in this file green.
 */
test("a good signature returns a session", async () => {
  const signIn = service();
  const { message } = await signIn.issueNonce({
    address: ADDRESS,
    namespace: "eip155",
    chainReference: 10143,
  });
  const result = await signIn.verify({ raw: message, signature: "0xsig" });
  assert.equal(result.userId, "user-1");
  assert.equal(result.session.accessToken, "at");
});

test("the same nonce cannot be spent twice", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store });
  await signIn.verify({ raw: signed(), signature: "0xsig" });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    UnknownNonceError,
  );
});

/**
 * The rule this pins is the *order* inside `proven`: the nonce is spent on presentation, not on
 * success. "The same nonce cannot be spent twice" cannot pin it — spend it twice sequentially and
 * both orderings behave identically, because the window the ordering closes is a concurrent one
 * and a sequential test has no concurrency. What does distinguish them is a failed attempt: spend
 * first and a bad signature still burns the nonce; verify first and the nonce survives every
 * rejection, so a harvested message can be retried against it until one signature lands.
 */
test("a bad signature still spends the nonce, so it cannot be retried", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store, verifier: { verify: async () => false } });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    BadSignatureError,
  );
  assert.equal(store.rows.has("nonce-1"), false);
});

test("an expired nonce is refused even though it exists", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T11:59:59Z")]]));
  const signIn = service({ nonces: store });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    ExpiredNonceError,
  );
});

test("a signature for another domain is refused", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store });
  await assert.rejects(
    () => signIn.verify({ raw: signed({ domain: "evil.example" }), signature: "0xsig" }),
    WrongDomainError,
  );
});

test("a signature that does not belong to the address is refused", async () => {
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store, verifier: { verify: async () => false } });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    BadSignatureError,
  );
});

test("signing in with an already-linked address returns that account, not a new one", async () => {
  const existing: WalletLink = {
    userId: "user-original",
    namespace: "eip155",
    address: ADDRESS,
    verifiedChain: "eip155:10143",
    kind: "external",
    verifiedAt: NOW,
  };
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({
    nonces: store,
    links: links([existing]),
    // forAddress must not be consulted; if it is, the test's assertion on userId catches it.
    accounts: {
      forAddress: async () => ({ userId: "user-newly-made" }),
      session: async (userId) => ({ accessToken: `at:${userId}`, refreshToken: "rt" }),
    },
  });
  const result = await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.equal(result.userId, "user-original");
});

test("linking an address owned by another account fails rather than moving it", async () => {
  const existing: WalletLink = {
    userId: "user-other",
    namespace: "eip155",
    address: ADDRESS,
    verifiedChain: "eip155:10143",
    kind: "external",
    verifiedAt: NOW,
  };
  const store = nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));
  const signIn = service({ nonces: store, links: links([existing]) });
  await assert.rejects(
    () => signIn.link("user-1", { raw: signed(), signature: "0xsig" }),
    AddressTakenError,
  );
});

test("a failed read of someone's links propagates rather than reading as none", async () => {
  const broken = links();
  broken.listForUser = async () => {
    throw new Error("connection reset");
  };
  const signIn = service({ links: broken });
  await assert.rejects(() => signIn.listLinks("user-1"), /connection reset/);
});
