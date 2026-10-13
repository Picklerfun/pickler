import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import {
  sendInjectedTokenTransaction,
  validatePublicTokenTransaction,
  WalletSubmissionUnknown,
} from "../src/features/wallet/lib/public-token-transaction";
import { WalletRequestError } from "../src/features/wallet/lib/wallet-request-error";
import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
const wallet = "0x" + "c".repeat(40),
  token = "0x" + "a".repeat(40),
  curve = "0x" + "b".repeat(40),
  hash = "0x" + "d".repeat(64);
async function prepared(approval = true): Promise<PublicTokenTradePreparedDto> {
  const { AUSD, PicklerBondingCurveAbi } = await import("@pickler/chain");
  const expiry = Math.floor(Date.now() / 1000) + 290;
  return {
    version: 1,
    token,
    curve,
    quoteToken: AUSD[10143].address,
    expiresAt: new Date(expiry * 1000).toISOString(),
    quote: {
      side: "buy",
      amount: "1000000",
      slippageBps: 50,
      approval,
      expectedOutput: "1000000000000000000",
      minimumOutput: "995000000000000000",
      balance: "2000000",
      allowance: "0",
      feeBps: 100,
    },
    transaction: {
      chainId: 10143,
      from: wallet,
      to: approval ? AUSD[10143].address : curve,
      nonce: 7,
      value: "0x0",
      gas: "0x10000",
      maxFeePerGas: "0x3",
      maxPriorityFeePerGas: "0x1",
      data: approval
        ? "0x095ea7b3" + curve.slice(2).padStart(64, "0") + 1000000n.toString(16).padStart(64, "0")
        : encodeFunctionData({
            abi: PicklerBondingCurveAbi,
            functionName: "buyExactInput",
            args: [1000000n, 995000000000000000n, wallet as `0x${string}`, BigInt(expiry)],
          }),
    },
  };
}
function provider(send: () => unknown = () => hash, change: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === "eth_sendTransaction") {
        return send();
      }
      const answers: Record<string, unknown> = {
        eth_accounts: [wallet],
        eth_chainId: "0x279f",
        eth_getTransactionCount: "0x7",
        eth_call: "0x",
        ...change,
      };
      if (!(method in answers)) {
        throw new Error("Unexpected call");
      }
      return answers[method];
    },
  };
}
test("one explicit browser submission after exact-target checks and simulation", async () => {
  const p = provider();
  const tx = await prepared();
  assert.equal(await sendInjectedTokenTransaction(p, tx, wallet, token), hash);
  assert.equal(p.calls.filter((x) => x === "eth_sendTransaction").length, 1);
  await validatePublicTokenTransaction(await prepared(false), wallet, token);
});
test("modified amount, target, recipient, expiry, network and nonce never submit", async () => {
  const base = await prepared();
  for (const tx of [
    { ...base, token: wallet },
    { ...base, expiresAt: new Date(0).toISOString() },
    { ...base, transaction: { ...base.transaction, to: wallet } },
    { ...base, transaction: { ...base.transaction, from: token } },
    { ...base, transaction: { ...base.transaction, chainId: 143 } },
    { ...base, quote: { ...base.quote, amount: "2" } },
  ]) {
    const p = provider();
    await assert.rejects(() => sendInjectedTokenTransaction(p, tx as typeof base, wallet, token));
    assert.equal(p.calls.includes("eth_sendTransaction"), false);
  }
  for (const change of [
    { eth_accounts: [token] },
    { eth_chainId: "0x8f" },
    { eth_getTransactionCount: "0x8" },
  ]) {
    const p = provider(() => hash, change);
    await assert.rejects(() => sendInjectedTokenTransaction(p, base, wallet, token));
    assert.equal(p.calls.includes("eth_sendTransaction"), false);
  }
});
test("cancel remains retryable, lost response becomes uncertain and is never retried", async () => {
  const cancelled = provider(() => {
    throw Object.assign(new Error("cancelled"), { code: 4001 });
  });
  const tx = await prepared();
  await assert.rejects(
    () => sendInjectedTokenTransaction(cancelled, tx, wallet, token),
    (e: { code?: number }) => e.code === 4001,
  );
  const uncertain = provider(() => {
    throw new Error("lost response");
  });
  await assert.rejects(
    () => sendInjectedTokenTransaction(uncertain, tx, wallet, token),
    (e) => e instanceof WalletSubmissionUnknown && e.hash === null,
  );
  assert.equal(uncertain.calls.filter((x) => x === "eth_sendTransaction").length, 1);
});

test("nested simulation failures expose the failed method and never reach submission", async () => {
  const p = provider();
  const request = p.request;
  p.request = async (args) => {
    if (args.method === "eth_call") {
      p.calls.push(args.method);
      throw {
        code: -32603,
        data: { originalError: { code: -32000, message: "execution reverted" } },
      };
    }
    return request(args);
  };
  const trade = await prepared();
  await assert.rejects(
    () => sendInjectedTokenTransaction(p, trade, wallet, token),
    (error) =>
      error instanceof WalletRequestError &&
      error.failure.method === "eth_call" &&
      error.failure.title === "Trade simulation failed",
  );
  assert.equal(p.calls.includes("eth_sendTransaction"), false);
});

test("nested cancellation and invalid parameters remain definitive while internal send errors stay uncertain", async () => {
  const trade = await prepared();
  for (const code of [4001, 4100, -32602]) {
    const p = provider(() => {
      throw { code: -32603, data: { originalError: { code } } };
    });
    await assert.rejects(
      () => sendInjectedTokenTransaction(p, trade, wallet, token),
      (error) =>
        error instanceof WalletRequestError &&
        error.code === code &&
        error.failure.method === "eth_sendTransaction",
    );
    assert.equal(p.calls.filter((method) => method === "eth_sendTransaction").length, 1);
  }
  const p = provider(() => {
    throw {
      code: -32603,
      data: { originalError: { code: -32000, message: "insufficient funds" } },
    };
  });
  await assert.rejects(
    () => sendInjectedTokenTransaction(p, trade, wallet, token),
    (error) => error instanceof WalletSubmissionUnknown && error.failure?.code === -32000,
  );
  assert.equal(p.calls.filter((method) => method === "eth_sendTransaction").length, 1);
});
