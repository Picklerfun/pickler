import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAddress } from "@pickler/core";
import { createSupabaseAdmin, createWalletAccounts, syntheticEmail } from "../src/index.js";

const EVM = normalizeAddress("eip155", "0xABC0000000000000000000000000000000000001");
const SOLANA = normalizeAddress("solana", "7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK");

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
test("a returning address is recovered by direct lookup, never by listing users", async () => {
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
    findUserIdByEmail: async () => "user-original",
    sessionClient: () => admin,
  });

  assert.deepEqual(await accounts.forAddress("eip155", EVM), { userId: "user-original" });
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
    findUserIdByEmail: async () => assert.fail("must not look up a user it just created"),
    sessionClient: () => admin,
  });
  assert.deepEqual(await accounts.forAddress("eip155", EVM), { userId: "user-new" });
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
    findUserIdByEmail: async () => null,
    sessionClient: () => throwaway.admin,
  });

  const session = await accounts.session(USER_ID);
  assert.equal(session.accessToken, "at-value");
  assert.equal(session.refreshToken, "rt-value");

  const { data } = await admin.auth.getSession();
  assert.equal(data.session, null);
});

const OWN_EMAIL = syntheticEmail("eip155", EVM, "wallet.pickler.fun");

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
    findUserIdByEmail: async () => null,
    sessionClient: () => admin,
  });
  await accounts.forAddress("eip155", EVM);

  const created = requests.find((r) => r.method === "POST" && r.url.includes("/admin/users"));
  const body = JSON.parse(created!.body) as Record<string, unknown>;
  assert.deepEqual(body["app_metadata"], { pickler_account: "wallet" });
});

/** The admin client over routes for one user record, answering an update with what it was sent. */
function accountsFor(user: { email: string; app_metadata: Record<string, unknown> }) {
  const client = clientOver([
    {
      match: (m, u) => m === "GET" && u.includes(`/admin/users/${USER_ID}`),
      body: { id: USER_ID, ...user },
    },
    {
      match: (m, u) => m === "PUT" && u.includes(`/admin/users/${USER_ID}`),
      body: { id: USER_ID, ...user },
    },
  ]);
  const accounts = createWalletAccounts({
    admin: client.admin,
    emailDomain: "wallet.pickler.fun",
    findUserIdByEmail: async () => null,
    sessionClient: () => client.admin,
  });
  const updates = () => client.requests.filter((r) => r.method === "PUT");
  return { accounts, updates };
}

test("a wallet sign-in backfills the marker on an account made before it existed", async () => {
  const { accounts, updates } = accountsFor({
    email: OWN_EMAIL,
    app_metadata: { provider: "email", providers: ["email"] },
  });
  await accounts.markWalletAccount(USER_ID, "eip155", EVM);

  assert.equal(updates().length, 1);
  assert.deepEqual(JSON.parse(updates()[0]!.body)["app_metadata"], {
    provider: "email",
    providers: ["email"],
    pickler_account: "wallet",
  });
});

test("an account that already carries the marker is not written again", async () => {
  const { accounts, updates } = accountsFor({
    email: OWN_EMAIL,
    app_metadata: { provider: "email", pickler_account: "wallet" },
  });
  await accounts.markWalletAccount(USER_ID, "eip155", EVM);
  assert.equal(updates().length, 0);
});

/**
 * An email account can link a wallet and then sign in with it. That opens the email account, which
 * is a studio account and must stay one: only the account this address's sign-in created is marked.
 */
test("an email account that linked the wallet is never marked", async () => {
  for (const email of ["ana@x.io", syntheticEmail("solana", SOLANA, "wallet.pickler.fun")]) {
    const { accounts, updates } = accountsFor({ email, app_metadata: { provider: "email" } });
    await accounts.markWalletAccount(USER_ID, "eip155", EVM);
    assert.equal(updates().length, 0, email);
  }
});
