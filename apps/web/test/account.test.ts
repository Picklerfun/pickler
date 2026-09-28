import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_CALLBACK_PATH,
  isEmail,
  sendEmailCode,
  signInWithProvider,
  verifyEmailCode,
} from "../src/features/auth/lib/account";
import type { AuthCalls } from "../src/features/auth/lib/account";

/**
 * Records every argument Supabase was handed and fails on anything the helper has no business
 * calling. Nothing here answers a useful constant: a fake that returned one would let a test
 * assert that constant and prove only that the fake ran.
 */
class FakeAuth implements AuthCalls {
  readonly oauth: Parameters<AuthCalls["signInWithOAuth"]>[0][] = [];
  readonly otp: Parameters<AuthCalls["signInWithOtp"]>[0][] = [];
  readonly verify: Parameters<AuthCalls["verifyOtp"]>[0][] = [];

  constructor(private readonly error: { message: string; status?: number; code?: string } | null) {}

  private answer() {
    return { error: this.error } as never;
  }
  async signInWithOAuth(credentials: Parameters<AuthCalls["signInWithOAuth"]>[0]) {
    this.oauth.push(credentials);
    return this.answer();
  }
  async signInWithOtp(credentials: Parameters<AuthCalls["signInWithOtp"]>[0]) {
    this.otp.push(credentials);
    return this.answer();
  }
  async verifyOtp(params: Parameters<AuthCalls["verifyOtp"]>[0]) {
    this.verify.push(params);
    return this.answer();
  }
}

const clientOf = (auth: FakeAuth) => ({ auth });

const ORIGIN = "https://app.pickler.xyz";

test("an address is plausible only with a name, an @ and a dotted domain", () => {
  for (const good of ["ana@pickler.xyz", " ana.robles+tag@mail.co.uk "]) {
    assert.equal(isEmail(good), true, good);
  }
  for (const bad of ["", "ana", "ana@", "@pickler.xyz", "ana@pickler", "an a@pickler.xyz"]) {
    assert.equal(isEmail(bad), false, bad);
  }
});

test("a provider sign-in comes back to the callback route that exchanges the code", async () => {
  const auth = new FakeAuth(null);
  await signInWithProvider(clientOf(auth), "google", ORIGIN);
  assert.equal(auth.oauth.length, 1);
  assert.deepEqual(auth.oauth[0], {
    provider: "google",
    options: { redirectTo: `${ORIGIN}${AUTH_CALLBACK_PATH}` },
  });
  // The route that exists and already exchanges the PKCE code, spelled out rather than derived
  // from the constant under test.
  assert.equal(auth.oauth[0]?.options?.redirectTo, "https://app.pickler.xyz/auth/callback");
  assert.equal(auth.otp.length, 0);
  assert.equal(auth.verify.length, 0);
});

test("X is Supabase's twitter provider, not a provider named x", async () => {
  const auth = new FakeAuth(null);
  await signInWithProvider(clientOf(auth), "twitter", ORIGIN);
  assert.equal(auth.oauth[0]?.provider, "twitter");
});

test("a provider that will not start says so rather than leaving the button dead", async () => {
  const auth = new FakeAuth({ message: "Unsupported provider: provider is not enabled" });
  await assert.rejects(
    () => signInWithProvider(clientOf(auth), "twitter", ORIGIN),
    /provider is not enabled/,
  );
});

test("one email call serves both sign-up and sign-in, because it may create the user", async () => {
  const auth = new FakeAuth(null);
  await sendEmailCode(clientOf(auth), "  Ana@Pickler.xyz  ");
  assert.equal(auth.otp.length, 1);
  assert.deepEqual(auth.otp[0], {
    email: "Ana@Pickler.xyz",
    options: { shouldCreateUser: true },
  });
  // Spelled out on its own: false here is the difference between a sign-up flow that works and
  // one that silently refuses every new address.
  assert.equal(auth.otp[0]?.options?.shouldCreateUser, true);
});

test("a send that fails carries Supabase's own words out", async () => {
  const auth = new FakeAuth({
    message: "For security purposes, you can only request this after 47 seconds.",
    status: 429,
    code: "over_email_send_rate_limit",
  });
  await assert.rejects(() => sendEmailCode(clientOf(auth), "ana@pickler.xyz"), /after 47 seconds/);
});

test("the code is verified as an email token, against the address it was sent to", async () => {
  const auth = new FakeAuth(null);
  assert.equal(await verifyEmailCode(clientOf(auth), "  Ana@Pickler.xyz  ", "482913"), true);
  assert.equal(auth.verify.length, 1);
  assert.deepEqual(auth.verify[0], {
    email: "Ana@Pickler.xyz",
    token: "482913",
    type: "email",
  });
});

test("a rejected code is a false, not a throw — the screen lets them try again", async () => {
  // GoTrue answers 403 `otp_expired` for a code that is wrong AND for one that has run out; the
  // two cannot be told apart from here, which is why both are the same "try again".
  for (const rejection of [
    { message: "Token has expired or is invalid", status: 403, code: "otp_expired" },
    { message: "Token has expired or is invalid", status: 403 },
  ]) {
    const auth = new FakeAuth(rejection);
    assert.equal(
      await verifyEmailCode(clientOf(auth), "ana@pickler.xyz", "000000"),
      false,
      JSON.stringify(rejection),
    );
  }
});

test("anything that is not a rejected code throws, so it is not read as a wrong code", async () => {
  for (const broken of [
    { message: "Request rate limit reached", status: 429, code: "over_request_rate_limit" },
    { message: "Database error", status: 500, code: "unexpected_failure" },
    { message: "Email logins are disabled", status: 422, code: "email_provider_disabled" },
  ]) {
    const auth = new FakeAuth(broken);
    await assert.rejects(
      () => verifyEmailCode(clientOf(auth), "ana@pickler.xyz", "482913"),
      new RegExp(broken.message),
      JSON.stringify(broken),
    );
  }
});
