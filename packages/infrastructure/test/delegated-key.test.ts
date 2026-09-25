import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, createPublicKey, createVerify } from "node:crypto";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { devVarsLines, generateDelegatedKeyPair } from "../src/turnkey/delegated-key.js";

test("a pair is a compressed P-256 public key and its 32-byte private scalar", () => {
  const pair = generateDelegatedKeyPair();

  assert.match(pair.publicKey, /^0[23][0-9a-f]{64}$/);
  assert.match(pair.privateKey, /^[0-9a-f]{64}$/);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(pair.privateKey, "hex");
  assert.equal(ecdh.getPublicKey("hex", "compressed"), pair.publicKey);
});

test("Turnkey's own stamper signs with the pair, and the signature verifies against the public key", async () => {
  const pair = generateDelegatedKeyPair();
  const stamper = new ApiKeyStamper({
    apiPublicKey: pair.publicKey,
    apiPrivateKey: pair.privateKey,
  });

  const stamp = await stamper.stamp("{}");

  const decoded = JSON.parse(Buffer.from(stamp.stampHeaderValue, "base64url").toString()) as {
    publicKey: string;
    signature: string;
  };
  assert.equal(decoded.publicKey, pair.publicKey);
  const point = createECDH("prime256v1");
  point.setPrivateKey(pair.privateKey, "hex");
  const raw = point.getPublicKey();
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: raw.subarray(1, 33).toString("base64url"),
      y: raw.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
  const verify = createVerify("SHA256");
  verify.update("{}");
  assert.equal(verify.verify(key, Buffer.from(decoded.signature, "hex")), true);
});

test("the .dev.vars lines refuse a file that already names a delegated key", () => {
  const pair = { publicKey: "02aa", privateKey: "bb" };

  assert.equal(
    devVarsLines("APP_ENV=local", pair),
    "\nTURNKEY_DELEGATED_API_PUBLIC_KEY=02aa\nTURNKEY_DELEGATED_API_PRIVATE_KEY=bb\n",
  );
  assert.throws(() => devVarsLines("TURNKEY_DELEGATED_API_PUBLIC_KEY=\n", pair));
});
