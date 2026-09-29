import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAddress, WalletAccountConflictError } from "@pickler/core";
import {
  createAuthUserLookup,
  createSupabaseAdmin,
  createWalletAccounts,
  syntheticEmail,
  type AuthUserFacts,
} from "../src/index.js";

const EVM = normalizeAddress("eip155", "0xABC0000000000000000000000000000000000001");
const SOLANA = normalizeAddress("solana", "7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK");
const OWN_EMAIL = syntheticEmail("eip155", EVM, "wallet.pickler.fun");

/** An auth user at this address's synthetic email, as wallet sign-in made it before the marker. */
const facts = (over: Partial<AuthUserFacts> = {}): AuthUserFacts => ({
  id: USER_ID,
  email: OWN_EMAIL,
  hasPassword: false,
  providers: ["email"],
  appMetadata: { provider: "email", providers: ["email"] },
  ...over,
});

/**
 * A golden value, pinned deliberately. This derivation is an identity key: every existing account
 * is found by it, so a change that alters it does not produce a bug report — it orphans everyone
 * who has signed in before. Anything that moves this digest should have to edit this line and say
 * why.
 */
test("the synthetic address is derived from the wallet and is not deliverable", () => {
  assert.equal(
    syntheticEmail("eip155", EVM, "wallet.pickler.fun"),
    "eip155-2e911ddf15b7bd5963df3f09e9f34c2f580d701a2647bbca89cdb91e0941c59d@wallet.pickler.fun",
  );
  assert.equal(
    syntheticEmail("solana", SOLANA, "wallet.pickler.fun"),
    "solana-f34b68f88b3ac7876624d9521582daeb632899822f728bb90b8619281b72c2fb@wallet.pickler.fun",
  );
});

test("two spellings of one address give one account", () => {
  const lower = syntheticEmail("eip155", normalizeAddress("eip155", EVM), "d");
  const upper = syntheticEmail(
    "eip155",
    normalizeAddress("eip155", "0xABC0000000000000000000000000000000000001"),
    "d",
  );
  assert.equal(lower, upper);
});

/**
 * The property that makes the other two leaks harmless. This value travels in every access token's
 * `email` claim, so it reaches the browser on every request and lands in whatever log or screen
 * reads a user's email. If the address were spelled into it, all of those would disclose which
 * wallet an account belongs to; a digest makes them an opaque token only `wallet_links` resolves.
 */
test("the wallet address never appears in the key it derives", () => {
  for (const [namespace, address] of [
    ["eip155", EVM],
    ["solana", SOLANA],
  ] as const) {
    const email = syntheticEmail(namespace, address, "wallet.pickler.fun");
    assert.equal(email.includes(address), false, `${namespace} address leaked into the key`);
    assert.equal(
      email.toLowerCase().includes(address.toLowerCase()),
      false,
      `${namespace} address leaked in another spelling`,
    );
    assert.match(email, /^(eip155|solana)-[0-9a-f]{64}@wallet\.pickler\.fun$/);
  }
});

test("two Solana addresses differing only in case are two accounts, never one", () => {
  const one = normalizeAddress("solana", "7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK");
  const other = normalizeAddress("solana", "7eQqDeuLXwCRAvX3MxkfJC84LHcKmgzcKrUdPVCmWjEk");
  assert.notEqual(one, other);
  assert.equal(one.toLowerCase(), other.toLowerCase(), "they collide under a second lower-casing");
  assert.notEqual(
    syntheticEmail("solana", one, "wallet.pickler.fun"),
    syntheticEmail("solana", other, "wallet.pickler.fun"),
  );
});

test("the same address on two chain families gives two accounts", () => {
  assert.notEqual(syntheticEmail("eip155", EVM, "d"), syntheticEmail("solana", SOLANA, "d"));
  assert.ok(syntheticEmail("eip155", EVM, "d").startsWith("eip155-"));
  assert.ok(syntheticEmail("solana", SOLANA, "d").startsWith("solana-"));
});

interface Route {
  match: (method: string, url: string) => boolean;
  status?: number;
  body: unknown;
}

/** A real admin client over a fake transport, so the assertions are about the requests it makes. */
function clientOver(routes: Route[]) {
  const requests: { method: string; url: string; body: string }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, url: request.url, body: await request.text() });
    const route = routes.find((r) => r.match(request.method, request.url));
    return new Response(JSON.stringify(route ? route.body : { message: "no route" }), {
      status: route?.status ?? (route ? 200 : 500),
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const admin = createSupabaseAdmin({
    url: "https://ref.supabase.co",
    secretKey: "sb_secret_x",
    fetch: fetchFn,
  });
  return { admin, requests, fetchFn };
}

const USER_ID = "11111111-2222-4333-8444-555555555555";

const SESSION_BODY = {
  access_token: "at-value",
  refresh_token: "rt-value",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: USER_ID, email: `eip155-${EVM}@wallet.pickler.fun`, app_metadata: {} },
};

/**
 * The admin API has no lookup by email: `getUserById` is its only direct read and `listUsers` is
 * paged with no filter, so a scan would silently miss every user past the first page — and would
 * do it to a returning person, whose sign-in is the thing that breaks.
 */
/**
 * The genuine lost race: two first-time sign-ins for one address, and this one's createUser found
 * the winner's account already there. The winner's account carries the marker, so it is accepted.
 * The admin API has no lookup by email: `getUserById` is its only direct read and `listUsers` is
 * paged with no filter, so a scan would silently miss every user past the first page.
 */
test("a lost race between two wallet sign-ins recovers the winner by direct lookup", async () => {
  const { admin, requests } = clientOver([
    {
      match: (m, u) => m === "POST" && u.includes("/admin/users"),
      status: 422,
      body: {
        code: "email_exists",
        message: "A user with this email address has already been registered",
      },
    },
  ]);
  const accounts = createWalletAccounts({
    admin,
    emailDomain: "wallet.pickler.fun",
    findAuthUser: async (where) => {
      assert.deepEqual(where, { email: OWN_EMAIL });
      return facts({ id: "user-original", appMetadata: { pickler_account: "wallet" } });
    },
    sessionClient: () => admin,
  });

  assert.deepEqual(await accounts.forAddress("eip155", EVM), {
    userId: "user-original",
    created: false,
  });
  assert.equal(
    requests.some((r) => r.method === "GET" && /\/admin\/users(\?|$)/.test(r.url)),
    false,
  );
});

test("an address nobody has seen gets an account made", async () => {
  const { admin } = clientOver([
    {
      match: (m, u) => m === "POST" && u.includes("/admin/users"),
      body: { id: "user-new", email: `eip155-${EVM}@wallet.pickler.fun` },
    },
  ]);
  const accounts = createWalletAccounts({
    admin,
    emailDomain: "wallet.pickler.fun",
    findAuthUser: async () => assert.fail("must not look up a user it just created"),
    sessionClient: () => admin,
  });
  assert.deepEqual(await accounts.forAddress("eip155", EVM), {
    userId: "user-new",
    created: true,
  });
});

/**
 * `verifyOtp` leaves the session on whichever client performs the exchange. The admin client is
 * long-lived and shared across requests in a Worker isolate, so if the exchange happened on it,
 * one person's session would be readable by the next request through `admin.auth.getSession()`.
 */
test("minting a session leaves no session on the shared admin client", async () => {
  const routes: Route[] = [
    {
      match: (m, u) => m === "GET" && u.includes(`/admin/users/${USER_ID}`),
      body: { id: USER_ID, email: `eip155-${EVM}@wallet.pickler.fun` },
    },
    {
      match: (m, u) => m === "POST" && u.includes("/admin/generate_link"),
      body: {
        action_link: "https://x/verify",
        hashed_token: "hashed-token-value",
        email_otp: "000000",
      },
    },
    { match: (m, u) => m === "POST" && u.includes("/verify"), body: SESSION_BODY },
  ];
  const { admin } = clientOver(routes);
  const throwaway = clientOver(routes);
  const accounts = createWalletAccounts({
    admin,
    emailDomain: "wallet.pickler.fun",
    findAuthUser: async () => null,
    sessionClient: () => throwaway.admin,
  });

  const session = await accounts.session(USER_ID);
  assert.equal(session.accessToken, "at-value");
  assert.equal(session.refreshToken, "rt-value");

  const { data } = await admin.auth.getSession();
  assert.equal(data.session, null);
});

test("a new wallet account is created with the server-only wallet-account marker", async () => {
  const { admin, requests } = clientOver([
    {
      match: (m, u) => m === "POST" && u.includes("/admin/users"),
      body: { id: "user-new", email: OWN_EMAIL },
    },
  ]);
  const accounts = createWalletAccounts({
    admin,
    emailDomain: "wallet.pickler.fun",
    findAuthUser: async () => null,
    sessionClient: () => admin,
  });
  await accounts.forAddress("eip155", EVM);

  const created = requests.find((r) => r.method === "POST" && r.url.includes("/admin/users"));
  const body = JSON.parse(created!.body) as Record<string, unknown>;
  assert.deepEqual(body["app_metadata"], { pickler_account: "wallet" });
});

/** Wallet accounts over one auth user's facts, recording every admin write it makes. */
function accountsFor(user: AuthUserFacts, created: "ok" | "exists" = "exists") {
  const client = clientOver([
    {
      match: (m, u) => m === "POST" && u.includes("/admin/users"),
      ...(created === "exists"
        ? { status: 422, body: { code: "email_exists", message: "already registered" } }
        : { body: { id: "user-new", email: OWN_EMAIL } }),
    },
    {
      match: (m, u) => m === "PUT" && u.includes(`/admin/users/${user.id}`),
      body: { id: user.id, email: user.email },
    },
  ]);
  const accounts = createWalletAccounts({
    admin: client.admin,
    emailDomain: "wallet.pickler.fun",
    findAuthUser: async (where) =>
      ("id" in where ? where.id === user.id : where.email === user.email) ? user : null,
    sessionClient: () => client.admin,
  });
  const updates = () => client.requests.filter((r) => r.method === "PUT");
  return { accounts, updates };
}

test("a legacy wallet account with no password is accepted and backfilled", async () => {
  const user = facts();
  const { accounts, updates } = accountsFor(user);

  assert.deepEqual(await accounts.forAddress("eip155", EVM), {
    userId: user.id,
    created: false,
  });
  await accounts.markWalletAccount(user.id, "eip155", EVM);

  assert.equal(updates().length, 1);
  assert.deepEqual(JSON.parse(updates()[0]!.body)["app_metadata"], {
    provider: "email",
    providers: ["email"],
    pickler_account: "wallet",
  });
});

test("a marked wallet account is accepted and not written again", async () => {
  const user = facts({ hasPassword: null, appMetadata: { pickler_account: "wallet" } });
  const { accounts, updates } = accountsFor(user);
  assert.deepEqual(await accounts.forAddress("eip155", EVM), {
    userId: user.id,
    created: false,
  });
  await accounts.markWalletAccount(user.id, "eip155", EVM);
  assert.equal(updates().length, 0);
});

/**
 * The takeover: the synthetic email is sha256 of a public address, so with password sign-up open
 * anyone can register it before the wallet's holder signs in. That account is refused on the first
 * sign-in (createUser finds it) and on a returning one (an address linked to it before this check),
 * and nothing is written to it.
 */
test("an account pre-registered at the synthetic email is refused, never accepted or marked", async () => {
  const cases: [string, Partial<AuthUserFacts>][] = [
    ["a password", { hasPassword: true }],
    [
      "a password and a spoofed namespace",
      { hasPassword: true, appMetadata: { provider: "email" } },
    ],
    ["an identity wallet sign-in never makes", { providers: ["email", "google"] }],
    ["an unknown password on an unmarked account", { hasPassword: null }],
  ];
  for (const [label, over] of cases) {
    const attacker = facts({ id: "user-attacker", ...over });
    const { accounts, updates } = accountsFor(attacker);
    await assert.rejects(accounts.forAddress("eip155", EVM), WalletAccountConflictError, label);
    await assert.rejects(
      accounts.markWalletAccount(attacker.id, "eip155", EVM),
      WalletAccountConflictError,
      label,
    );
    assert.equal(updates().length, 0, `${label}: the attacker's account was written`);
  }
});

/**
 * An email account can link a wallet and then sign in with it. That opens the email account, which
 * is a studio account and must stay one: only the account this address's sign-in created is marked.
 */
test("an email account that linked the wallet is never marked, whatever its password", async () => {
  for (const email of ["ana@x.io", syntheticEmail("solana", SOLANA, "wallet.pickler.fun")]) {
    const { accounts, updates } = accountsFor(facts({ email, hasPassword: true }));
    await accounts.markWalletAccount(USER_ID, "eip155", EVM);
    assert.equal(updates().length, 0, email);
  }
});

/** Wallet accounts over one auth user's facts, recording the deletes asked of the admin API. */
function discarding(user: AuthUserFacts | null, status = 200) {
  const client = clientOver([
    {
      match: (m, u) => m === "DELETE" && u.includes("/admin/users/"),
      status,
      body: status === 200 ? {} : { code: "unexpected_failure", message: "could not delete" },
    },
  ]);
  const accounts = createWalletAccounts({
    admin: client.admin,
    emailDomain: "wallet.pickler.fun",
    findAuthUser: async (where) => ("id" in where && where.id === user?.id ? user : null),
    sessionClient: () => client.admin,
  });
  const deletes = () => client.requests.filter((r) => r.method === "DELETE").map((r) => r.url);
  return { accounts, deletes };
}

/**
 * The account `forAddress` made a moment ago, whose link went to another account: it holds no
 * wallet, nothing points at it, and it is this address's own marked wallet account.
 */
test("a wallet account made for a link that was lost is deleted", async () => {
  const user = facts({ appMetadata: { pickler_account: "wallet" } });
  const { accounts, deletes } = discarding(user);
  await accounts.discardAccount(user.id, "eip155", EVM);
  assert.deepEqual(deletes(), [`https://ref.supabase.co/auth/v1/admin/users/${user.id}`]);
});

test("nothing but this address's own marked wallet account is ever deleted", async () => {
  const cases: [string, Partial<AuthUserFacts>][] = [
    ["an email account", { email: "ana@x.io", appMetadata: { pickler_account: "wallet" } }],
    [
      "another address's wallet account",
      {
        email: syntheticEmail("solana", SOLANA, "wallet.pickler.fun"),
        appMetadata: { pickler_account: "wallet" },
      },
    ],
    ["an unmarked account at the synthetic email", {}],
    ["a pre-registration with a password", { hasPassword: true }],
  ];
  for (const [label, over] of cases) {
    const { accounts, deletes } = discarding(facts(over));
    await assert.rejects(accounts.discardAccount(USER_ID, "eip155", EVM), /not removed/, label);
    assert.deepEqual(deletes(), [], label);
  }
});

test("an account that is already gone is nothing to delete", async () => {
  const { accounts, deletes } = discarding(null);
  await accounts.discardAccount(USER_ID, "eip155", EVM);
  assert.deepEqual(deletes(), []);
});

test("a delete the admin API refuses is reported, not swallowed", async () => {
  const user = facts({ appMetadata: { pickler_account: "wallet" } });
  const { accounts } = discarding(user, 500);
  await assert.rejects(accounts.discardAccount(user.id, "eip155", EVM));
});

test("the lookup reads auth.users where it exists, and says nothing it cannot know elsewhere", async () => {
  const { admin } = clientOver([
    {
      match: (m, u) => m === "GET" && u.includes(`/admin/users/${USER_ID}`),
      body: {
        id: USER_ID,
        email: OWN_EMAIL,
        app_metadata: { provider: "email" },
        identities: [{ provider: "email" }],
      },
    },
  ]);
  const seen: unknown[][] = [];
  const hosted = createAuthUserLookup({
    admin,
    pool: {
      query: async <Row>(_text: string, values: unknown[]) => {
        seen.push(values);
        return {
          rows: [
            {
              id: USER_ID,
              email: OWN_EMAIL,
              has_password: true,
              providers: ["email"],
              app_metadata: null,
            },
          ] as Row[],
        };
      },
    },
  });
  assert.deepEqual(await hosted({ email: OWN_EMAIL }), {
    id: USER_ID,
    email: OWN_EMAIL,
    hasPassword: true,
    providers: ["email"],
    appMetadata: {},
  });
  assert.deepEqual(seen, [[OWN_EMAIL]]);

  // A local run: no auth schema. By id the admin API answers, but it never says whether a password
  // is set; by email there is no admin lookup at all.
  const local = createAuthUserLookup({
    admin,
    pool: {
      query: async () => {
        throw Object.assign(new Error('relation "auth.users" does not exist'), { code: "42P01" });
      },
    },
  });
  assert.equal((await local({ id: USER_ID }))?.hasPassword, null);
  assert.equal(await local({ email: OWN_EMAIL }), null);

  // Any other database failure is a failure, not "no user".
  const down = createAuthUserLookup({
    admin,
    pool: {
      query: async () => {
        throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      },
    },
  });
  await assert.rejects(down({ id: USER_ID }), /connection refused/);
});
