import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createSupabaseJwtVerifier } from "../src/auth/supabase-jwt-verifier.js";

test("separate request verifiers reuse public JWKS resolvers without sharing identity, registry caps eight keys", async (t) => {
  const pair = await generateKeyPair("ES256");
  let jwk = { ...(await exportJWK(pair.publicKey)), kid: "one", alg: "ES256" };
  const calls = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = request.url!;
    calls.set(path, (calls.get(path) ?? 0) + 1);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const issuer = `http://127.0.0.1:${address.port}/auth`;
  const token = async (sub: string, audience = "authenticated") =>
    new SignJWT({ sub })
      .setProtectedHeader({ alg: "ES256", kid: "one" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  const config = { issuer, jwksUrl: `${issuer}/keys` };
  assert.equal(
    (await createSupabaseJwtVerifier(config).verify(await token("user-a"))).userId,
    "user-a",
  );
  assert.equal(
    (await createSupabaseJwtVerifier(config).verify(await token("user-b"))).userId,
    "user-b",
  );
  assert.equal(calls.get("/auth/keys"), 1);
  await assert.rejects(
    createSupabaseJwtVerifier({ ...config, audience: "other" }).verify(await token("user-a")),
  );
  for (let i = 0; i < 8; i++) {
    await createSupabaseJwtVerifier({ ...config, jwksUrl: `${issuer}/key-${i}` }).verify(
      await token("user-a"),
    );
  }
  await createSupabaseJwtVerifier(config).verify(await token("user-a"));
  assert.equal(
    calls.get("/auth/keys"),
    3,
    "audience isolation and LRU eviction each require a fresh resolver",
  );
  const rotated = await generateKeyPair("ES256");
  jwk = { ...(await exportJWK(rotated.publicKey)), kid: "two", alg: "ES256" };
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(31000);
  const rotatedToken = await new SignJWT({ sub: "rotated-user" })
    .setProtectedHeader({ alg: "ES256", kid: "two" })
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setExpirationTime("5m")
    .sign(rotated.privateKey);
  assert.equal(
    (await createSupabaseJwtVerifier(config).verify(rotatedToken)).userId,
    "rotated-user",
  );
  assert.equal(
    calls.get("/auth/keys"),
    4,
    "jose refreshes an unknown key after its normal cooldown",
  );
});
