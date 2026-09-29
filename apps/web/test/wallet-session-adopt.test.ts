import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adoptSession,
  decideSession,
  dropWalletSession,
  heldBy,
  releases,
  type WalletSession,
} from "../src/features/wallet/lib/wallet-session";

const A = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-09-29T12:00:00.000Z");

/** Bound to an address, as signing in leaves it. The token is never read by these tests. */
const bound = (address: string): WalletSession => ({
  token: "a.b.c",
  address,
  namespace: "eip155",
  userId: "user-a",
});

/**
 * After a reload the page holds nothing, but the browser is still signed in. The session does not
 * say which address it is for — the token carries a digest, never the address — so it is adopted
 * without one: never reused, and let go of as soon as the wallet changes.
 */
test("a wallet account's session found on load is adopted, without an address", () => {
  const found = { user: { id: "user-a", app_metadata: { pickler_account: "wallet" } } };
  assert.deepEqual(adoptSession(found), { adopted: true, userId: "user-a" });
});

test("a studio session found on load is not the wallet's to adopt", () => {
  assert.equal(adoptSession({ user: { id: "user-a", app_metadata: { provider: "email" } } }), null);
  assert.equal(adoptSession(null), null);
});

test("an adopted session is never handed back as this wallet's token", () => {
  const adopted = { adopted: true as const, userId: "user-a" };
  assert.deepEqual(decideSession(adopted, { address: A, namespace: "eip155" }, NOW), {
    action: "sign",
  });
  assert.equal(heldBy(adopted, { address: A, namespace: "eip155" }), false);
});

const wallet = (address: string) => ({ address, namespace: "eip155" as const });

test("a session is kept while the wallet is the one it was issued to", () => {
  const cached = bound(A);
  // A change of chain arrives as the same address again.
  assert.equal(releases(cached, wallet(A), wallet(A.toLowerCase())), false);
  assert.equal(releases(null, wallet(A), wallet(B)), false);
});

test("a session is let go when the wallet changes or disconnects", () => {
  const cached = bound(A);
  assert.equal(releases(cached, wallet(A), wallet(B)), true);
  assert.equal(releases(cached, wallet(A), null), true);
});

test("an adopted session is kept only while the connected address stays the same", () => {
  const adopted = { adopted: true as const, userId: "user-a" };
  assert.equal(releases(adopted, wallet(A), wallet(A)), false);
  assert.equal(releases(adopted, wallet(A), wallet(B)), true);
  assert.equal(releases(adopted, wallet(A), null), true);
  // Nothing was connected, so whose session it is cannot be known: connecting lets go of it.
  assert.equal(releases(adopted, null, wallet(A)), true);
});

test("an adopted session is signed out like any other wallet session", async () => {
  const calls: unknown[] = [];
  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "user-a", app_metadata: { pickler_account: "wallet" } } } },
      }),
      signOut: async (options: { scope: "local" }) => void calls.push(options),
    },
  };
  await dropWalletSession(supabase, { adopted: true, userId: "user-a" });
  assert.deepEqual(calls, [{ scope: "local" }]);
});
