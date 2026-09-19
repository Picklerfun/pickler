import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeCrypto from "node:crypto";
import {
  decryptAes256Gcm,
  decryptLegacyAes256Gcm,
  decryptLegacySeparateColumns,
  DecryptionError,
  encryptAes256Gcm,
  isLegacyFormat,
} from "../src/index.js";

// Relayer's original implementation, inlined as the compatibility oracle.
const relayer = {
  encrypt(plaintext: string, secret: string) {
    const salt = nodeCrypto.randomBytes(16);
    const key = nodeCrypto.scryptSync(secret, salt, 32);
    const iv = nodeCrypto.randomBytes(16);
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([salt, iv, encrypted, cipher.getAuthTag()]).toString("hex");
  },
  decrypt(hex: string, secret: string) {
    const data = Buffer.from(hex, "hex");
    const key = nodeCrypto.scryptSync(secret, data.subarray(0, 16), 32);
    const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, data.subarray(16, 32));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return (
      decipher.update(data.subarray(32, data.length - 16)).toString("utf8") + decipher.final("utf8")
    );
  },
  legacyParts(plaintext: string, secret: string) {
    const key = nodeCrypto.scryptSync(secret, "salt", 32);
    const iv = nodeCrypto.randomBytes(16);
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
    const data = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
    return { iv: iv.toString("hex"), data, tag: cipher.getAuthTag().toString("hex") };
  },
};

const SECRET = "test-encryption-key-for-unit-tests";
const PLAINTEXT = "secret-seed-phrase-here · ñ ✓";

test("values encrypted by Relayer decrypt in Pickler", async () => {
  assert.equal(await decryptAes256Gcm(relayer.encrypt(PLAINTEXT, SECRET), SECRET), PLAINTEXT);
});

test("values encrypted by Pickler decrypt in Relayer", async () => {
  const hex = await encryptAes256Gcm(PLAINTEXT, SECRET);
  assert.match(hex, /^[0-9a-f]+$/);
  assert.equal(relayer.decrypt(hex, SECRET), PLAINTEXT);
});

test("encryption is salted", async () => {
  assert.notEqual(
    await encryptAes256Gcm(PLAINTEXT, SECRET),
    await encryptAes256Gcm(PLAINTEXT, SECRET),
  );
});

test("wrong keys, tampering and malformed input raise DecryptionError", async () => {
  const hex = await encryptAes256Gcm(PLAINTEXT, SECRET);
  await assert.rejects(decryptAes256Gcm(hex, "wrong-key"), DecryptionError);
  const flipped = hex.slice(0, 70) + (hex[70] === "0" ? "1" : "0") + hex.slice(71);
  await assert.rejects(decryptAes256Gcm(flipped, SECRET), DecryptionError);
  await assert.rejects(decryptAes256Gcm("zz", SECRET), DecryptionError);
  await assert.rejects(decryptAes256Gcm("00".repeat(10), SECRET), DecryptionError);
});

test("legacy formats written by Relayer still decrypt", async () => {
  const parts = relayer.legacyParts(PLAINTEXT, SECRET);
  const json = JSON.stringify(parts);
  assert.equal(isLegacyFormat(json), true);
  assert.equal(await decryptLegacyAes256Gcm(json, SECRET), PLAINTEXT);
  assert.equal(
    await decryptLegacySeparateColumns(parts.data, parts.iv, parts.tag, SECRET),
    PLAINTEXT,
  );
  await assert.rejects(decryptLegacyAes256Gcm("{not json", SECRET), DecryptionError);
});
