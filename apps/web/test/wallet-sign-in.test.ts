import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectError, type ConnectResult, type Signer } from "../src/features/wallet/lib/connect";
import { signInAs, type SignInClient } from "../src/features/wallet/lib/wallet-sign-in";
import type { WalletSession } from "../src/features/wallet/lib/wallet-session";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-09-29T12:00:00.000Z");

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function freshToken(sub: string): string {
  const exp = Math.floor(NOW.getTime() / 1000) + 3600;
  return `${encode({ alg: "HS256" })}.${encode({ sub, exp })}.signature`;
}

function signerFor(address: string): Signer {
  return { address, chainId: 10143, signMessage: async () => "0xsigned" };
}

function client(refusal: string | null = null): SignInClient & { set: unknown[] } {
  const set: unknown[] = [];
  return {
    set,
    auth: {
      async setSession(tokens) {
        set.push(tokens);
        return { error: refusal ? { message: refusal } : null };
      },
    },
  };
}

function answering(userId: string) {
  const asked: string[] = [];
  const signIn = async (signer: Signer): Promise<ConnectResult> => {
    asked.push(signer.address);
    return { userId, session: { accessToken: freshToken(userId), refreshToken: "refresh" } };
  };
  return { asked, signIn };
}

function failing(caught: unknown) {
  return async (): Promise<ConnectResult> => {
    throw caught;
  };
}

test("a sign-in answers with the token and the session to keep, bound to the signer", async () => {
  const supabase = client();
  const { signIn } = answering("user-a");
  const outcome = await signInAs({
    cached: null,
    signer: signerFor(A),
    supabase,
    signIn,
    now: NOW,
  });
  assert.deepEqual(outcome.result, { token: freshToken("user-a") });
  assert.deepEqual(outcome.session, {
    token: freshToken("user-a"),
    userId: "user-a",
    address: A,
    namespace: "eip155",
  });
  assert.deepEqual(supabase.set, [
    { access_token: freshToken("user-a"), refresh_token: "refresh" },
  ]);
});

test("a session held for this address is reused without a prompt", async () => {
  const cached: WalletSession = {
    token: freshToken("user-a"),
    userId: "user-a",
    address: A,
    namespace: "eip155",
  };
  const { asked, signIn } = answering("user-a");
  const outcome = await signInAs({
    cached,
    signer: signerFor(A),
    supabase: client(),
    signIn,
    now: NOW,
  });
  assert.deepEqual(outcome.result, { token: cached.token });
  assert.deepEqual(asked, []);
});

test("a session held for another address is not handed to this one", async () => {
  const cached: WalletSession = {
    token: freshToken("user-a"),
    userId: "user-a",
    address: A,
    namespace: "eip155",
  };
  const { asked, signIn } = answering("user-b");
  const outcome = await signInAs({
    cached,
    signer: signerFor(B),
    supabase: client(),
    signIn,
    now: NOW,
  });
  assert.deepEqual(outcome.result, { token: freshToken("user-b") });
  assert.deepEqual(asked, [B]);
});

test("a refusal comes back in the result, in words for a screen", async () => {
  const outcome = await signInAs({
    cached: null,
    signer: signerFor(A),
    supabase: client(),
    signIn: failing(new ConnectError("Ask for a new one", "nonce_invalid")),
    now: NOW,
  });
  assert.ok("error" in outcome.result);
  assert.match(outcome.result.error ?? "", /took too long/);
  assert.equal(outcome.session, undefined);
});

test("closing the prompt is an answer with nothing to say", async () => {
  const outcome = await signInAs({
    cached: null,
    signer: signerFor(A),
    supabase: client(),
    signIn: failing({ code: 4001 }),
    now: NOW,
  });
  assert.deepEqual(outcome.result, { error: null });
});

test("nothing connected says so rather than prompting", async () => {
  const { asked, signIn } = answering("user-a");
  const outcome = await signInAs({
    cached: null,
    signer: null,
    supabase: client(),
    signIn,
    now: NOW,
  });
  assert.deepEqual(outcome.result, { error: "Connect a wallet before signing in." });
  assert.deepEqual(asked, []);
});

test("a build with nowhere to put a session spends no prompt", async () => {
  const { asked, signIn } = answering("user-a");
  const outcome = await signInAs({
    cached: null,
    signer: signerFor(A),
    supabase: null,
    signIn,
    now: NOW,
  });
  assert.deepEqual(outcome.result, { error: "Signing in is not configured in this build." });
  assert.deepEqual(asked, []);
});

test("a session the client refuses is a failure, and nothing is kept", async () => {
  const { signIn } = answering("user-a");
  const outcome = await signInAs({
    cached: null,
    signer: signerFor(A),
    supabase: client("Invalid refresh token"),
    signIn,
    now: NOW,
  });
  assert.deepEqual(outcome.result, { error: "Invalid refresh token" });
  assert.equal(outcome.session, undefined);
});
