import test from "node:test";
import assert from "node:assert/strict";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendMeraTokenTransaction } from "../src/features/wallet/lib/mera-token-transaction";
import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
const account = privateKeyToAccount(toHex(new Uint8Array(32).fill(1)));
const wallet = account.address,
  token = "0x" + "a".repeat(40),
  curve = "0x" + "b".repeat(40);
async function fixture(fail = false) {
  const { AUSD } = await import("@pickler/chain");
  const key = new Uint8Array(32).fill(1),
    prf = new Uint8Array(32).fill(2);
  let ended = false,
    sent = 0;
  const prepared: PublicTokenTradePreparedDto = {
    version: 1,
    token,
    curve,
    quoteToken: AUSD[10143].address,
    expiresAt: new Date(Date.now() + 290000).toISOString(),
    quote: {
      side: "buy",
      approval: true,
      amount: "1",
      slippageBps: 50,
      expectedOutput: "1",
      minimumOutput: "1",
      balance: "1",
      allowance: "0",
      feeBps: 100,
    },
    transaction: {
      from: wallet,
      to: AUSD[10143].address,
      data: "0x095ea7b3" + curve.slice(2).padStart(64, "0") + "1".padStart(64, "0"),
      value: "0x0",
      chainId: 10143,
      nonce: 0,
      gas: "0x1",
      maxFeePerGas: "0x2",
      maxPriorityFeePerGas: "0x1",
    },
  };
  return {
    key,
    prf,
    ended: () => ended,
    sent: () => sent,
    deps: {
      prepared,
      wallet,
      token,
      current: () => true,
      prf: async () => ({ credentialId: "test", prfOutput: prf }),
      rpc: async (method: string) => {
        assert.equal(key[0], 1);
        return method === "eth_getTransactionCount" ? "0x0" : "0x";
      },
      kit: {
        privateKeyFromPrf: () => key,
        openKey: () => ({
          address: wallet,
          signMessage: async () => "",
          signTransaction: async () => {
            assert.ok(prf.every((v) => v === 0));
            if (fail) {
              throw new Error("sign failed");
            }
            const tx = prepared.transaction;
            return account.signTransaction({
              type: "eip1559",
              chainId: tx.chainId,
              nonce: tx.nonce,
              to: tx.to as `0x${string}`,
              data: tx.data as `0x${string}`,
              value: 0n,
              gas: BigInt(tx.gas),
              maxFeePerGas: BigInt(tx.maxFeePerGas),
              maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
            });
          },
          end: () => {
            ended = true;
          },
        }),
      },
      submit: async () => {
        sent++;
        assert.ok(key.every((v) => v === 0));
        assert.ok(ended);
        return ("0x" + "d".repeat(64)) as `0x${string}`;
      },
    },
  };
}
test("Mera wipes PRF and key and ends the signing session before broadcasting", async () => {
  const f = await fixture();
  await sendMeraTokenTransaction(f.deps);
  assert.equal(f.sent(), 1);
});
test("Mera signing failure and wrong wallet wipe keys without broadcast", async () => {
  const failed = await fixture(true);
  await assert.rejects(() => sendMeraTokenTransaction(failed.deps));
  assert.ok(failed.key.every((v) => v === 0));
  assert.ok(failed.ended());
  assert.equal(failed.sent(), 0);
  const changed = await fixture();
  await assert.rejects(() => sendMeraTokenTransaction({ ...changed.deps, current: () => false }));
  assert.ok(changed.key.every((v) => v === 0));
  assert.equal(changed.sent(), 0);
});

test("Mera refuses altered signed bytes before broadcasting and after key cleanup", async () => {
  const f = await fixture();
  f.deps.kit.openKey = () => ({
    address: wallet,
    signMessage: async () => "",
    end: () => {},
    signTransaction: async () =>
      account.signTransaction({
        type: "eip1559",
        chainId: 10143,
        nonce: 0,
        to: token as `0x${string}`,
        data: "0x",
        value: 1n,
        gas: 1n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
      }),
  });
  await assert.rejects(() => sendMeraTokenTransaction(f.deps), /does not match/);
  assert.equal(f.sent(), 0);
  assert.ok(f.key.every((v) => v === 0));
});
