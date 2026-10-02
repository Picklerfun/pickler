import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWalletSignIn,
  ExpiredNonceError,
  UnknownNonceError,
  WrongDomainError,
  BadSignatureError,
  AddressTakenError,
  AccountNotJoinableError,
  joinStatement,
  SIGN_IN_STATEMENT,
  WrongPurposeError,
  NoAccountToJoinError,
  SameAccountError,
  normalizeAddress,
  InvalidAddressError,
  InvalidChainError,
  type NonceStore,
  type WalletLink,
  type WalletLinkRepository,
  isWalletAccountEmail,
  WalletAccountConflictError,
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
    // What the store's one statement holds: the account given up has exactly one wallet, and
    // the account kept still has one.
    reassignSole: async (from, to) => {
      const moving = rows.filter((r) => r.userId === from);
      if (moving.length !== 1 || !rows.some((r) => r.userId === to)) {
        return false;
      }
      moving[0]!.userId = to;
      return true;
    },
  };
}

/**
 * The fakes round-trip a string, because that is what the real pair does: infrastructure builds a
 * SIWE message and parses it back. A fake that passed an object straight through would not be
 * exercising the thing the service actually depends on.
 */
const build = (f: {
  domain: string;
  address: string;
  chainReference: number;
  nonce: string;
  statement: string;
}) => `${f.domain}|${f.address}|${f.chainReference}|${f.nonce}|${f.statement}`;

const parse = (raw: string) => {
  const [domain, address, chainReference, nonce, statement] = raw.split("|");
  return {
    domain: domain!,
    address: address!,
    namespace: "eip155" as const,
    chainReference: Number(chainReference),
    nonce: nonce!,
    statement: statement!,
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
      forAddress: async () => ({ userId: "user-1", created: true }),
      session: async () => ({ accessToken: "at", refreshToken: "rt" }),
      markWalletAccount: async () => {},
      discardAccount: async () => {},
      isOwnWalletAccount: async () => true,
    },
    hasProfile: async () => false,
    hasCustodyAccount: async () => false,
    randomNonce: () => "nonce-1",
    buildMessage: build,
    parseMessage: parse,
    ...over,
  });
}

/** A string of the shape the service hands out, with one field overridable per test. */
const signed = (
  over: { domain?: string; nonce?: string; address?: string; statement?: string } = {},
) =>
  build({
    domain: over.domain ?? DOMAIN,
    address: over.address ?? ADDRESS,
    chainReference: 10143,
    nonce: over.nonce ?? "nonce-1",
    statement: over.statement ?? SIGN_IN_STATEMENT,
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
  assert.equal(message, `${DOMAIN}|${ADDRESS}|10143|nonce-1|Sign in to Pickler`);
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

test("an address that is not one is refused before any nonce is stored", async () => {
  const store = nonces();
  const signIn = service({ nonces: store });
  await assert.rejects(
    signIn.issueNonce({ address: "nope", namespace: "eip155", chainReference: 10143 }),
    InvalidAddressError,
  );
  assert.equal(store.rows.size, 0);
});

test("a chain that is not a positive whole number is refused before any nonce is stored", async () => {
  const store = nonces();
  const signIn = service({ nonces: store });
  for (const chainReference of [1.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
    await assert.rejects(
      signIn.issueNonce({ address: ADDRESS, namespace: "eip155", chainReference }),
      InvalidChainError,
      String(chainReference),
    );
  }
  assert.equal(store.rows.size, 0);
});

test("a message that cannot be built leaves no nonce behind", async () => {
  const store = nonces();
  const signIn = service({
    nonces: store,
    buildMessage: () => {
      throw new Error("the builder refused a field");
    },
  });
  await assert.rejects(
    signIn.issueNonce({ address: ADDRESS, namespace: "eip155", chainReference: 10143 }),
    /the builder refused a field/,
  );
  assert.equal(store.rows.size, 0);
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

test("a nonce whose expiry is unreadable is refused rather than trusted", async () => {
  const store = nonces(new Map([["nonce-1", new Date("not a date")]]));
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
      forAddress: async () => ({ userId: "user-newly-made", created: true }),
      session: async (userId) => ({ accessToken: `at:${userId}`, refreshToken: "rt" }),
      markWalletAccount: async () => {},
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

test("a wallet account is recognised by its synthetic email domain, and only by it", () => {
  const synthetic =
    "eip155-2e911ddf15b7bd5963df3f09e9f34c2f580d701a2647bbca89cdb91e0941c59d@wallet.pickler.fun";
  assert.equal(isWalletAccountEmail(synthetic, "wallet.pickler.fun"), true);
  assert.equal(isWalletAccountEmail(synthetic.toUpperCase(), "Wallet.Pickler.Fun"), true);
  assert.equal(isWalletAccountEmail("ana@pickler.fun", "wallet.pickler.fun"), false);
  // A lookalike is not the domain: the check is on the whole domain after the @.
  assert.equal(isWalletAccountEmail("ana@evilwallet.pickler.fun", "wallet.pickler.fun"), false);
  assert.equal(isWalletAccountEmail(undefined, "wallet.pickler.fun"), false);
  // No domain configured: wallet sign-in is off, so nobody is a wallet account.
  assert.equal(isWalletAccountEmail(synthetic, undefined), false);
  assert.equal(isWalletAccountEmail(synthetic, ""), false);
});

/**
 * The wallet-account marker is what the API trusts to exempt an account from studio-only rules, and
 * accounts made before it existed get it on their next sign-in. So every sign-in — a new address and
 * a returning one — asks for it, before the session is minted, so the token carries it.
 */
test("every sign-in marks the wallet account before minting its session", async () => {
  for (const returning of [false, true]) {
    const calls: string[] = [];
    const existing: WalletLink = {
      userId: "user-original",
      namespace: "eip155",
      address: normalizeAddress("eip155", ADDRESS),
      verifiedChain: "eip155:10143",
      kind: "external",
      verifiedAt: NOW,
    };
    const signIn = service({
      nonces: nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]])),
      links: links(returning ? [existing] : []),
      accounts: {
        forAddress: async () => ({ userId: "user-new", created: true }),
        markWalletAccount: async (userId, namespace, address) => {
          calls.push(`mark:${userId}:${namespace}:${address}`);
        },
        session: async (userId) => {
          calls.push(`session:${userId}`);
          return { accessToken: "at", refreshToken: "rt" };
        },
      },
    });
    await signIn.verify({ raw: signed(), signature: "0xsig" });
    const user = returning ? "user-original" : "user-new";
    assert.deepEqual(
      calls,
      [`mark:${user}:eip155:${normalizeAddress("eip155", ADDRESS)}`, `session:${user}`],
      returning ? "returning" : "new",
    );
  }
});

/**
 * A refused account is never linked and never given a session: on a first sign-in the refusal comes
 * from `forAddress`, before the link; on a returning one from `markWalletAccount`, before the session.
 */
test("an account refused as a pre-registration is not linked and gets no session", async () => {
  for (const returning of [false, true]) {
    const existing: WalletLink = {
      userId: "user-attacker",
      namespace: "eip155",
      address: normalizeAddress("eip155", ADDRESS),
      verifiedChain: "eip155:10143",
      kind: "external",
      verifiedAt: NOW,
    };
    const store = links(returning ? [existing] : []);
    const calls: string[] = [];
    const signIn = service({
      nonces: nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]])),
      links: store,
      accounts: {
        forAddress: async () => {
          throw new WalletAccountConflictError();
        },
        markWalletAccount: async () => {
          throw new WalletAccountConflictError();
        },
        session: async () => {
          calls.push("session");
          return { accessToken: "at", refreshToken: "rt" };
        },
      },
    });
    await assert.rejects(
      signIn.verify({ raw: signed(), signature: "0xsig" }),
      WalletAccountConflictError,
    );
    assert.deepEqual(calls, [], "no session was minted");
    assert.equal(store.rows.length, returning ? 1 : 0, "nothing new was linked");
  }
});

/**
 * The race `verify` has to survive: the address was linked to nobody when it looked, an account
 * was made for it, and by the time the link was written somebody else — a signed-in studio account
 * linking the same wallet — held it. `link` answers `created: false`, and the wallet belongs to
 * that account, not to the one this call just made.
 */
function lostRace(holder: string) {
  const calls: string[] = [];
  const held: WalletLink = {
    userId: holder,
    namespace: "eip155",
    address: ADDRESS,
    verifiedChain: "eip155:10143",
    kind: "external",
    verifiedAt: NOW,
  };
  let linked = false;
  const repository: WalletLinkRepository = {
    // Nothing on the first read, the winner's link once the insert has been refused.
    findByAddress: async () => (linked ? held : null),
    link: async (link) => {
      calls.push(`link:${link.userId}`);
      linked = true;
      return { created: false };
    },
    listForUser: async () => [],
  };
  return { calls, repository };
}

function racing(
  holder: string,
  accounts: Partial<Parameters<typeof createWalletSignIn>[0]["accounts"]> = {},
  made = true,
) {
  const { calls, repository } = lostRace(holder);
  const signIn = service({
    nonces: nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]])),
    links: repository,
    accounts: {
      forAddress: async () => ({ userId: "user-synthetic", created: made }),
      markWalletAccount: async (userId) => void calls.push(`mark:${userId}`),
      session: async (userId) => {
        calls.push(`session:${userId}`);
        return { accessToken: `at:${userId}`, refreshToken: "rt" };
      },
      discardAccount: async (userId, namespace, address) =>
        void calls.push(`discard:${userId}:${namespace}:${address}`),
      ...accounts,
    },
  });
  return { calls, signIn };
}

test("a link lost to another account signs in as the account that holds the wallet", async () => {
  const { calls, signIn } = racing("user-studio");
  const result = await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.equal(result.userId, "user-studio");
  assert.equal(result.session.accessToken, "at:user-studio");
  assert.equal(
    calls.some((call) => call === "session:user-synthetic" || call === "mark:user-synthetic"),
    false,
    "the account this call made holds no wallet and gets nothing",
  );
  assert.deepEqual(calls.slice(-2), ["mark:user-studio", "session:user-studio"]);
});

test("the account made for a lost link is removed, because nothing will ever use it", async () => {
  const { calls, signIn } = racing("user-studio");
  await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.deepEqual(
    calls.filter((call) => call.startsWith("discard:")),
    [`discard:user-synthetic:eip155:${ADDRESS}`],
  );
});

test("an account this call did not make is never removed", async () => {
  const { calls, signIn } = racing("user-studio", {}, false);
  const result = await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.equal(result.userId, "user-studio");
  assert.deepEqual(
    calls.filter((call) => call.startsWith("discard:")),
    [],
  );
});

test("a link lost to the same account is that account's sign-in, and nothing is removed", async () => {
  // Two first sign-ins of one wallet at once: both resolve to one account and one wins the insert.
  const { calls, signIn } = racing("user-synthetic");
  const result = await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.equal(result.userId, "user-synthetic");
  assert.deepEqual(calls, ["link:user-synthetic", "mark:user-synthetic", "session:user-synthetic"]);
});

test("the holder of a lost link is held to the same conflict check before any session", async () => {
  const { calls, signIn } = racing("user-studio", {
    markWalletAccount: async () => {
      throw new WalletAccountConflictError();
    },
  });
  await assert.rejects(
    () => signIn.verify({ raw: signed(), signature: "0xsig" }),
    WalletAccountConflictError,
  );
  assert.equal(
    calls.some((call) => call.startsWith("session:")),
    false,
  );
});

test("failing to remove the leftover account does not refuse the sign-in", async () => {
  const { signIn } = racing("user-studio", {
    discardAccount: async () => {
      throw new Error("admin API unavailable");
    },
  });
  const result = await signIn.verify({ raw: signed(), signature: "0xsig" });
  assert.equal(result.userId, "user-studio");
});

test("a lost link that nobody holds after all is a failure, never a session", async () => {
  const calls: string[] = [];
  const signIn = service({
    nonces: nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]])),
    links: {
      findByAddress: async () => null,
      link: async () => ({ created: false }),
      listForUser: async () => [],
    },
    accounts: {
      forAddress: async () => ({ userId: "user-synthetic", created: true }),
      markWalletAccount: async () => {},
      session: async (userId) => {
        calls.push(`session:${userId}`);
        return { accessToken: "at", refreshToken: "rt" };
      },
      discardAccount: async (userId) => void calls.push(`discard:${userId}`),
    },
  });
  await assert.rejects(() => signIn.verify({ raw: signed(), signature: "0xsig" }));
  assert.deepEqual(calls, []);
});

test("a nonce is issued to the address asked for, and spent for the address in the message", async () => {
  const seen: unknown[] = [];
  const signIn = service({
    nonces: {
      issue: async (nonce, _expiresAt, holder) => {
        seen.push(["issue", nonce, holder]);
      },
      consume: async (nonce, holder) => {
        seen.push(["consume", nonce, holder]);
        return { expiresAt: new Date("2026-09-23T12:05:00Z") };
      },
    },
  });
  const { message } = await signIn.issueNonce({
    address: ADDRESS.toUpperCase().replace("0X", "0x"),
    namespace: "eip155",
    chainReference: 10143,
  });
  await signIn.verify({ raw: message, signature: "0xsig" });
  const holder = { namespace: "eip155", address: ADDRESS };
  assert.deepEqual(seen, [
    ["issue", "nonce-1", holder],
    ["consume", "nonce-1", holder],
  ]);
});

/** A nonce store holding the one nonce `signed()` names, still inside its five minutes. */
const issued = () => nonces(new Map([["nonce-1", new Date("2026-09-23T12:05:00Z")]]));

test("a wallet that says it is a passkey wallet is linked as one, and one that says nothing is not", async () => {
  const mera = links();
  await service({ nonces: issued(), links: mera }).verify({
    raw: signed(),
    signature: "0xsig",
    kind: "mera",
  });
  assert.equal(mera.rows[0]!.kind, "mera");

  const silent = links();
  await service({ nonces: issued(), links: silent }).verify({ raw: signed(), signature: "0xsig" });
  assert.equal(silent.rows[0]!.kind, "external");

  const browser = links();
  await service({ nonces: issued(), links: browser }).verify({
    raw: signed(),
    signature: "0xsig",
    kind: "eoa",
  });
  assert.equal(browser.rows[0]!.kind, "external");
});

test("the kind a wallet was linked with stands, whatever a later sign-in says", async () => {
  const held = links([
    {
      userId: "user-original",
      namespace: "eip155",
      address: ADDRESS,
      verifiedChain: "eip155:10143",
      kind: "external",
      verifiedAt: NOW,
    },
  ]);

  await service({ nonces: issued(), links: held }).verify({
    raw: signed(),
    signature: "0xsig",
    kind: "mera",
  });

  assert.equal(held.rows.length, 1);
  assert.equal(held.rows[0]!.kind, "external");
});

test("linking to a signed-in account records the kind as well", async () => {
  const linked = links();

  await service({ nonces: issued(), links: linked }).link("user-1", {
    raw: signed(),
    signature: "0xsig",
    kind: "mera",
  });

  assert.equal(linked.rows[0]!.kind, "mera");
});

/* Joining: the account a wallet's first sign-in just made is folded into the account the person
   already had, proved by a signature of that account's wallet. The one place an address moves. */

const NEW_WALLET = normalizeAddress("eip155", "0xabc0000000000000000000000000000000000002");
const linkOf = (userId: string, address: typeof ADDRESS, kind: WalletLink["kind"] = "external") =>
  ({
    userId,
    namespace: "eip155",
    address,
    verifiedChain: "eip155:10143",
    kind,
    verifiedAt: NOW,
  }) satisfies WalletLink;

/** `kept` holds ADDRESS and a username; `fresh` was made a moment ago for NEW_WALLET. */
function joining(over: Partial<Parameters<typeof createWalletSignIn>[0]> = {}) {
  const repo = links([linkOf("kept", ADDRESS, "mera"), linkOf("fresh", NEW_WALLET)]);
  const calls: string[] = [];
  const signIn = service({
    nonces: issued(),
    links: repo,
    accounts: {
      forAddress: async () => ({ userId: "unused", created: false }),
      session: async (userId) => ({ accessToken: `at-${userId}`, refreshToken: `rt-${userId}` }),
      markWalletAccount: async (userId) => void calls.push(`mark ${userId}`),
      discardAccount: async (userId, _ns, address) =>
        void calls.push(`discard ${userId} ${address}`),
      isOwnWalletAccount: async () => true,
    },
    hasProfile: async (userId) => userId === "kept",
    ...over,
  });
  return { signIn, repo, calls };
}

/**
 * The other wallet's proof: the kept account's wallet signed the server's message, which says it
 * lets `joining` in.
 */
const proof = (address = ADDRESS, joining: string = NEW_WALLET) => ({
  raw: signed({ address, statement: joinStatement(joining) }),
  signature: "0xsig",
});

test("a wallet with a bare account joins the account of the wallet that signed", async () => {
  const { signIn, repo, calls } = joining();

  const result = await signIn.join("fresh", proof());

  assert.deepEqual(result, {
    userId: "kept",
    session: { accessToken: "at-kept", refreshToken: "rt-kept" },
  });
  // Both wallets now open the kept account; the kind each was linked with stands.
  assert.deepEqual(
    repo.rows.map((row) => [row.userId, row.address, row.kind]),
    [
      ["kept", ADDRESS, "mera"],
      ["kept", NEW_WALLET, "external"],
    ],
  );
  // The kept account passes the check every sign-in gets, and the bare one is removed.
  assert.deepEqual(calls, ["mark kept", `discard fresh ${NEW_WALLET}`]);
});

test("joining needs the other wallet's signature: a bad one moves nothing", async () => {
  const { signIn, repo } = joining({ verifier: { verify: async () => false } });

  await assert.rejects(signIn.join("fresh", proof()), BadSignatureError);

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
});

test("a wallet that opens no account is nothing to join", async () => {
  const stranger = normalizeAddress("eip155", "0xabc0000000000000000000000000000000000003");
  const { signIn, repo } = joining();

  await assert.rejects(signIn.join("fresh", proof(stranger)), NoAccountToJoinError);

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
});

test("signing with the account's own wallet is not joining another account", async () => {
  const { signIn } = joining();

  await assert.rejects(signIn.join("kept", proof()), SameAccountError);
});

test("an account with a username is never given up", async () => {
  const { signIn, repo, calls } = joining({ hasProfile: async () => true });

  await assert.rejects(
    signIn.join("fresh", proof()),
    (caught: unknown) =>
      caught instanceof AccountNotJoinableError && caught.reason === "has_profile",
  );

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
  assert.deepEqual(calls, []);
});

test("only the bare account wallet sign-in made is given up", async () => {
  // An email or Google account that linked a wallet is opened by that wallet and is not its.
  const studio = joining({
    accounts: {
      forAddress: async () => ({ userId: "unused", created: false }),
      session: async () => ({ accessToken: "at", refreshToken: "rt" }),
      markWalletAccount: async () => {},
      discardAccount: async () => {},
      isOwnWalletAccount: async () => false,
    },
  });
  await assert.rejects(
    studio.signIn.join("fresh", proof()),
    (caught: unknown) =>
      caught instanceof AccountNotJoinableError && caught.reason === "not_wallet_account",
  );

  // An account that already holds a second wallet is more than the one it was made for.
  const two = joining();
  two.repo.rows.push(
    linkOf("fresh", normalizeAddress("eip155", "0xabc0000000000000000000000000000000000004")),
  );
  await assert.rejects(two.signIn.join("fresh", proof()), AccountNotJoinableError);

  // And one with no wallet at all has nothing to bring.
  const none = joining();
  await assert.rejects(none.signIn.join("nobody", proof()), AccountNotJoinableError);

  for (const { repo } of [studio, two]) {
    assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
  }
});

test("a kept account that sign-in would refuse is refused before anything moves", async () => {
  const { signIn, repo } = joining({
    accounts: {
      forAddress: async () => ({ userId: "unused", created: false }),
      session: async () => ({ accessToken: "at", refreshToken: "rt" }),
      markWalletAccount: async () => {
        throw new WalletAccountConflictError();
      },
      discardAccount: async () => {},
      isOwnWalletAccount: async () => true,
    },
  });

  await assert.rejects(signIn.join("fresh", proof()), WalletAccountConflictError);

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
});

test("failing to remove the account given up does not refuse the join", async () => {
  const { signIn, repo } = joining({
    accounts: {
      forAddress: async () => ({ userId: "unused", created: false }),
      session: async (userId) => ({ accessToken: `at-${userId}`, refreshToken: "rt" }),
      markWalletAccount: async () => {},
      discardAccount: async () => {
        throw new Error("the admin API is down");
      },
      isOwnWalletAccount: async () => true,
    },
  });

  const result = await signIn.join("fresh", proof());

  assert.equal(result.userId, "kept");
  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "kept");
});

test("adding a wallet to an account still never takes it from another", async () => {
  const { signIn, repo } = joining();

  await assert.rejects(
    signIn.link("kept", { raw: signed({ address: NEW_WALLET }), signature: "0xsig" }),
    AddressTakenError,
  );

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
});

test("an account with a custody wallet is never given up", async () => {
  // A Turnkey sub-organization and its master wallet hang off the user id with nothing to remove
  // them: deleting the account would strand whatever that wallet holds.
  const { signIn, repo, calls } = joining({ hasCustodyAccount: async () => true });

  await assert.rejects(
    signIn.join("fresh", proof()),
    (caught: unknown) =>
      caught instanceof AccountNotJoinableError && caught.reason === "has_custody",
  );

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
  assert.deepEqual(calls, []);
});

test("a join the store refuses at the last moment hands out no session and removes nothing", async () => {
  // Another request changed the account between the checks and the move.
  const { signIn, repo, calls } = joining();
  repo.reassignSole = async () => false;

  await assert.rejects(
    signIn.join("fresh", proof()),
    (caught: unknown) => caught instanceof AccountNotJoinableError && caught.reason === "changed",
  );

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
  assert.deepEqual(calls, ["mark kept"]);
});

test("an account that claimed a username while its wallet moved is not removed", async () => {
  let asked = 0;
  const { signIn, calls } = joining({
    // No profile when the join checks; one by the time the account would be removed.
    hasProfile: async (userId) => userId === "fresh" && ++asked > 1,
  });

  const result = await signIn.join("fresh", proof());

  assert.equal(result.userId, "kept");
  assert.deepEqual(calls, ["mark kept"]);
});

/* What the signature is for is part of what was signed. */

test("the message to sign in says so, and the one to join names the wallet being let in", async () => {
  const signIn = service();

  const plain = await signIn.issueNonce({
    address: ADDRESS,
    namespace: "eip155",
    chainReference: 10143,
  });
  const joining = await signIn.issueNonce({
    address: ADDRESS,
    namespace: "eip155",
    chainReference: 10143,
    // However it is spelled: the sentence carries the one spelling the store keeps.
    joining: { namespace: "eip155", address: NEW_WALLET.toLowerCase() },
  });

  assert.equal(parse(plain.message).statement, "Sign in to Pickler");
  assert.equal(
    parse(joining.message).statement,
    `Link wallet ${NEW_WALLET} to this wallet's Pickler account`,
  );
});

test("a wallet to let in that is not an address is refused before a nonce is stored", async () => {
  const store = nonces();
  const signIn = service({ nonces: store });

  await assert.rejects(
    signIn.issueNonce({
      address: ADDRESS,
      namespace: "eip155",
      chainReference: 10143,
      joining: { namespace: "eip155", address: "not-an-address" },
    }),
    InvalidAddressError,
  );

  assert.equal(store.rows.size, 0);
});

test("a signature given to sign in does not join an account", async () => {
  const { signIn, repo } = joining();

  await assert.rejects(
    signIn.join("fresh", { raw: signed({ address: ADDRESS }), signature: "0xsig" }),
    WrongPurposeError,
  );

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
});

test("a signature that lets one wallet in does not let another in", async () => {
  const other = normalizeAddress("eip155", "0xabc0000000000000000000000000000000000005");
  const { signIn, repo } = joining();

  await assert.rejects(signIn.join("fresh", proof(ADDRESS, other)), WrongPurposeError);

  assert.equal(repo.rows.find((row) => row.address === NEW_WALLET)!.userId, "fresh");
});

test("a signature given to join an account neither signs in nor links", async () => {
  const signIn = service({ nonces: issued() });
  await assert.rejects(signIn.verify(proof()), WrongPurposeError);

  const linking = service({ nonces: issued() });
  await assert.rejects(linking.link("user-1", proof()), WrongPurposeError);
});

test("a message refused for its purpose has spent its nonce all the same", async () => {
  const store = issued();
  const signIn = service({ nonces: store });

  await assert.rejects(signIn.verify(proof()), WrongPurposeError);

  assert.equal(store.rows.size, 0);
});
