import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAddress } from "@pickler/core";
import { createSupabaseAdmin, createWalletAccounts, syntheticEmail } from "../src/index.js";

const EVM = normalizeAddress("eip155", "0xABC0000000000000000000000000000000000001");
const SOLANA = normalizeAddress("solana", "7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK");

test("the synthetic address is derived from the wallet and is not deliverable", () => {
  assert.equal(
    syntheticEmail("eip155", EVM, "wallet.pickler.fun"),
    "eip155-0xabc0000000000000000000000000000000000001@wallet.pickler.fun",
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
 * The derivation adds no case rule of its own. `normalizeAddress` already decided the spelling —
 * lower-case for EVM, untouched for base58 — and a second `toLowerCase()` here would silently map
 * two distinct Solana addresses onto one account.
 */
test("a Solana address keeps its case in the key, because base58 is case-significant", () => {
  assert.equal(
    syntheticEmail("solana", SOLANA, "wallet.pickler.fun"),
    "solana-7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK@wallet.pickler.fun",
  );
});

/**
 * The collision itself, with two addresses that are both valid base58 and differ only in case.
 * A second `toLowerCase()` in the derivation maps them onto one synthetic address and therefore
 * one Supabase account — two people sharing an identity, which is the failure this whole
 * specification exists to prevent. It is invisible on EVM, where `normalizeAddress` has already
 * lower-cased, so every test one would naturally write there passes either way.
 */
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
  const requests: { method: string; url: string }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, url: request.url });
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
