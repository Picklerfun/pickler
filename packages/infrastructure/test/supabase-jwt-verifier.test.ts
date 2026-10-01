import { test } from "node:test";
import assert from "node:assert/strict";
import { InvalidAccessTokenError } from "@pickler/core";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createSupabaseJwtVerifier } from "../src/index.js";

const issuer = "https://ref.supabase.co/auth/v1";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const other = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
  const verifier = createSupabaseJwtVerifier({
    jwksUrl: "https://unused.invalid",
    issuer,
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
  const sign = (
    claims: Record<string, unknown>,
    opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string; alg?: string } = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: opts.alg ?? "ES256", kid: "k1" })
      .setIssuer(opts.iss ?? issuer)
      .setAudience(opts.aud ?? "authenticated")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(opts.key ?? privateKey);
  return { verifier, sign, otherKey: other.privateKey };
}

test("valid Supabase tokens resolve the user", async () => {
  const { verifier, sign } = await setup();
  const token = await sign({ sub: "user-1", email: "ana@x.io" });
  assert.deepEqual(await verifier.verify(token), {
    userId: "user-1",
    email: "ana@x.io",
    walletAccount: false,
  });
});

test("only the server-only app_metadata marker makes a wallet account, never the email", async () => {
  const { verifier, sign } = await setup();
  const synthetic =
    "eip155-2e911ddf15b7bd5963df3f09e9f34c2f580d701a2647bbca89cdb91e0941c59d@wallet.pickler.fun";
  const marked = await sign({
    sub: "w",
    email: synthetic,
    app_metadata: { pickler_account: "wallet" },
  });
  assert.equal((await verifier.verify(marked)).walletAccount, true);
  // The spoof: anyone can sign up with an address in the synthetic domain. No marker, no exemption.
  const spoofed = await sign({ sub: "s", email: synthetic, app_metadata: { provider: "email" } });
  assert.equal((await verifier.verify(spoofed)).walletAccount, false);
  // user_metadata is writable by the person, so the same key there means nothing.
  const userWritten = await sign({ sub: "u", user_metadata: { pickler_account: "wallet" } });
  assert.equal((await verifier.verify(userWritten)).walletAccount, false);
});

test("wrong signer, issuer, audience, expiry or missing sub are rejected", async () => {
  const { verifier, sign, otherKey } = await setup();
  const bad = [
    await sign({ sub: "u" }, { key: otherKey }),
    await sign({ sub: "u" }, { iss: "https://evil.example/auth/v1" }),
    await sign({ sub: "u" }, { aud: "anon" }),
    await sign({ sub: "u" }, { exp: "-1m" }),
    await sign({}),
    "not.a.jwt",
  ];
  for (const token of bad) {
    await assert.rejects(verifier.verify(token), InvalidAccessTokenError);
  }
});

test("an issuer is mandatory", () => {
  assert.throws(() => createSupabaseJwtVerifier({ jwksUrl: "https://x.invalid", issuer: "" }));
});
