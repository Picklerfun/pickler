import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideSession,
  dropWalletSession,
  EXPIRY_MARGIN_MS,
  tokenExpiry,
  type WalletSession,
} from "../src/features/wallet/lib/wallet-session";

const A = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-09-29T12:00:00.000Z");

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A token shaped like Supabase's: only the payload is read here, never the signature. */
function tokenExpiring(at: Date | null): string {
  const payload = at ? { sub: "user-a", exp: Math.floor(at.getTime() / 1000) } : { sub: "user-a" };
  return `${encode({ alg: "HS256" })}.${encode(payload)}.signature`;
}

function sessionFor(address: string, expires: Date | null): WalletSession {
  return { token: tokenExpiring(expires), address, namespace: "eip155", userId: "user-a" };
}

const inAnHour = new Date(NOW.getTime() + 60 * 60 * 1000);

test("the same address with a fresh token reuses it, spending no second prompt", () => {
  const cached = sessionFor(A, inAnHour);
  assert.deepEqual(decideSession(cached, { address: A, namespace: "eip155" }, NOW), {
    action: "reuse",
    token: cached.token,
  });
});

test("the same address in another spelling is still the same address", () => {
  const cached = sessionFor(A, inAnHour);
  const decided = decideSession(cached, { address: A.toLowerCase(), namespace: "eip155" }, NOW);
  assert.equal(decided.action, "reuse");
});

test("a different address signs again rather than acting as the last wallet", () => {
  const cached = sessionFor(A, inAnHour);
  assert.deepEqual(decideSession(cached, { address: B, namespace: "eip155" }, NOW), {
    action: "sign",
  });
});

test("the same address in another chain family signs again", () => {
  const cached = sessionFor(A, inAnHour);
  assert.deepEqual(decideSession(cached, { address: A, namespace: "solana" }, NOW), {
    action: "sign",
  });
});

test("nothing connected has no session, whatever is cached", () => {
  assert.deepEqual(decideSession(sessionFor(A, inAnHour), null, NOW), { action: "none" });
  assert.deepEqual(decideSession(null, null, NOW), { action: "none" });
});

test("a connected wallet with nothing cached signs", () => {
  assert.deepEqual(decideSession(null, { address: A, namespace: "eip155" }, NOW), {
    action: "sign",
  });
});

test("an expired token signs again", () => {
  const cached = sessionFor(A, new Date(NOW.getTime() - 1000));
  assert.deepEqual(decideSession(cached, { address: A, namespace: "eip155" }, NOW), {
    action: "sign",
  });
});

test("a token inside the safety margin counts as expired, so it cannot lapse in flight", () => {
  const cached = sessionFor(A, new Date(NOW.getTime() + EXPIRY_MARGIN_MS - 1000));
  assert.equal(decideSession(cached, { address: A, namespace: "eip155" }, NOW).action, "sign");
  const beyond = sessionFor(A, new Date(NOW.getTime() + EXPIRY_MARGIN_MS + 1000));
  assert.equal(decideSession(beyond, { address: A, namespace: "eip155" }, NOW).action, "reuse");
});

test("a token whose expiry cannot be read is never reused", () => {
  for (const token of [tokenExpiring(null), "not-a-token", "a.%%%.c", ""]) {
    assert.equal(tokenExpiry(token), null);
    const cached: WalletSession = { token, address: A, namespace: "eip155", userId: "user-a" };
    assert.equal(decideSession(cached, { address: A, namespace: "eip155" }, NOW).action, "sign");
  }
});

test("the expiry is read in milliseconds", () => {
  assert.equal(tokenExpiry(tokenExpiring(inAnHour)), inAnHour.getTime());
});

function fakeAuth(userId: string | null) {
  const calls: unknown[] = [];
  return {
    calls,
    auth: {
      async getSession() {
        return { data: { session: userId ? { user: { id: userId } } : null } };
      },
      async signOut(options: { scope: "local" }) {
        calls.push(options);
        return { error: null };
      },
    },
  };
}

test("dropping the wallet's session signs this browser out of it", async () => {
  const supabase = fakeAuth("user-a");
  await dropWalletSession(supabase, sessionFor(A, inAnHour));
  assert.deepEqual(supabase.calls, [{ scope: "local" }]);
});

test("a session that belongs to someone else is left alone", async () => {
  // The studio shares this client. Signing in there after the wallet replaces the session, and
  // switching wallet account must not sign the studio out.
  const supabase = fakeAuth("studio-user");
  await dropWalletSession(supabase, sessionFor(A, inAnHour));
  assert.deepEqual(supabase.calls, []);
});

test("nothing cached or no client means nothing to drop", async () => {
  const supabase = fakeAuth("user-a");
  await dropWalletSession(supabase, null);
  await dropWalletSession(null, sessionFor(A, inAnHour));
  assert.deepEqual(supabase.calls, []);
});
