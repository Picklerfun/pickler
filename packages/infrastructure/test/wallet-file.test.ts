import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeTradingWallet, saveTradingCredentials } from "../src/trading/wallet-file.js";
// Public deterministic test vector, never a generated or funded wallet.
const fixtureKey = `0x${"0".repeat(63)}1` as const;
test("wallet initializer preserves env, writes private mode and never returns private material", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pickler-wallet-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, ".env");
  await writeFile(
    path,
    "UNRELATED=keep\nPOLYMARKET_SIGNER_PRIVATE_KEY=\nPOLYMARKET_SIGNER_ADDRESS=\n",
  );
  const first = await initializeTradingWallet(path, () => fixtureKey);
  assert.equal(first.created, true);
  assert.equal(first.address, "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
  assert.equal(JSON.stringify(first).includes(fixtureKey), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const saved = await readFile(path, "utf8");
  assert.ok(saved.includes("UNRELATED=keep"));
  assert.equal(
    (
      await initializeTradingWallet(path, () => {
        throw new Error("must not regenerate");
      })
    ).created,
    false,
  );
  assert.equal(await readFile(path, "utf8"), saved);
  await saveTradingCredentials(path, { POLYMARKET_CLOB_API_KEY: "fixture-only" });
  await assert.rejects(saveTradingCredentials(path, { POLYMARKET_CLOB_API_KEY: "different" }));
  await assert.rejects(saveTradingCredentials(path, { UNRELATED: "replace" }));
});
test("wallet initializer refuses ambiguous keys, mismatch and symlinks", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pickler-wallet-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, ".env");
  for (const content of [
    "POLYMARKET_SIGNER_ADDRESS=0x1\n",
    "POLYMARKET_SIGNER_PRIVATE_KEY=\nPOLYMARKET_SIGNER_PRIVATE_KEY=\n",
    `POLYMARKET_SIGNER_PRIVATE_KEY=${fixtureKey}\nPOLYMARKET_SIGNER_ADDRESS=0x1\n`,
  ]) {
    await writeFile(path, content);
    await assert.rejects(initializeTradingWallet(path, () => fixtureKey));
    assert.equal(await readFile(path, "utf8"), content);
  }
  const link = join(dir, "linked");
  await symlink(path, link);
  await assert.rejects(initializeTradingWallet(link, () => fixtureKey));
});
