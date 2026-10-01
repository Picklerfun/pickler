import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PostgresCustodyStore } from "../src/persistence/custody-store.js";
import { TransferAlreadyRecordedError } from "@pickler/core";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL is not set";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HASH = `0x${"cd".repeat(32)}`;

test("an unlinked agent wallet is found whatever its name, and counted", { skip }, async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const store = new PostgresCustodyStore(pool);
    await pool.query("DELETE FROM wallets.wallets WHERE user_id=$1", [USER]);
    await store.saveWallet({
      userId: USER,
      walletId: "wal-test-1",
      subOrganizationId: "sub-test",
      kind: "agent",
      name: "Agent wallet 1",
      address: "0x3333333333333333333333333333333333333333",
      path: "m/44'/60'/0'/0/0",
    });
    assert.equal((await store.findUnlinkedWallet(USER))?.walletId, "wal-test-1");
    assert.equal(await store.countAgentWallets(USER), 1);
    assert.deepEqual(
      (await store.listAgentWallets(USER)).map((wallet) => wallet.agentId),
      [null],
    );
  } finally {
    await pool.end();
  }
});

test(
  "a transfer is recorded once; the same hash again is TransferAlreadyRecordedError",
  { skip },
  async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const store = new PostgresCustodyStore(pool);
      await pool.query("DELETE FROM wallets.transfers WHERE tx_hash=$1", [HASH]);
      const transfer = {
        userId: USER,
        fromWalletId: "master",
        toWalletId: "wal-test-1",
        token: "mon" as const,
        amount: 5n,
        txHash: HASH,
      };
      await store.saveTransfer(transfer);
      assert.equal(await store.transferRecorded(HASH.toUpperCase().replace("0X", "0x")), true);
      await assert.rejects(store.saveTransfer(transfer), TransferAlreadyRecordedError);
    } finally {
      await pool.end();
    }
  },
);
