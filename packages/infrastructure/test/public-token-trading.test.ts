import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, type Abi, type Hex } from "viem";
import { PicklerLaunchFactoryAbi, PicklerBondingCurveAbi } from "@pickler/chain";
import { createPublicTokenTradeDriver } from "../src/launch/public-trading.js";
import { tokenAgentKey } from "../src/studio/token-launch-store.js";
import { deploymentCode, uniswapLaunchPolicy } from "./launch-policy-fixture.js";
const token = "0x" + "a".repeat(40),
  curve = "0x" + "b".repeat(40),
  wallet = "0x" + "c".repeat(40),
  agentId = "11111111-1111-4111-8111-111111111111";
function fixture(change: Record<string, unknown> = {}) {
  const policy = uniswapLaunchPolicy();
  let calls = 0,
    reserved = false;
  const abis: Record<string, Abi> = {
    [policy.factory.address]: PicklerLaunchFactoryAbi,
    [curve]: PicklerBondingCurveAbi,
    [token]: erc20Abi,
    [policy.preset.quoteAddress]: erc20Abi,
  } as Record<string, Abi>;
  const values: Record<string, unknown> = {
    token,
    quoteToken: policy.preset.quoteAddress,
    deployer: policy.deployer.address,
    phase: 0,
    decimals: 18,
    balanceOf: 10000000000000000000000n,
    allowance: 0n,
    quoteBuy: 1900000000000000000000n,
    quoteSell: 500000n,
    remainingTokens: 16800000000000000000000000n,
    ...change,
  };
  const driver = createPublicTokenTradeDriver({
    policy,
    now: () => 1700000000000,
    reserve: async () => {
      reserved = true;
    },
    rpc: {
      async call(method, params) {
        assert.ok(reserved);
        calls++;
        if (method === "eth_chainId") {
          return change.chain ?? "0x279f";
        }
        if (method === "eth_blockNumber") {
          return "0x10";
        }
        if (method === "eth_getCode") {
          return change.code ?? deploymentCode;
        }
        if (method === "eth_getStorageAt") {
          return "0x" + "0".repeat(24) + policy.quote.implementation!.address.slice(2);
        }
        if (method === "eth_getTransactionCount") {
          return "0x7";
        }
        if (method === "eth_maxPriorityFeePerGas") {
          return "0x1";
        }
        if (method === "eth_getBlockByNumber") {
          return { baseFeePerGas: "0x1" };
        }
        if (method === "eth_getBalance") {
          return change.native ?? "0xffffffffffffffff";
        }
        if (method === "eth_estimateGas") {
          return "0x10000";
        }
        if (method === "eth_call") {
          const q = params[0] as { to: string; data: Hex };
          const abi = abis[q.to.toLowerCase()]!;
          const decoded = decodeFunctionData({ abi, data: q.data });
          const name = decoded.functionName;
          const result =
            name === "getLaunch"
              ? {
                  creator: wallet,
                  creatorFeeRecipient: wallet,
                  agentKey: change.agentKey ?? tokenAgentKey(10143, agentId),
                  token,
                  curve,
                  quoteToken: policy.preset.quoteAddress,
                  presetHash: policy.preset.configHash,
                  creationBlock: 1n,
                }
              : name === "decimals" && q.to.toLowerCase() === policy.preset.quoteAddress
                ? (change.quoteDecimals ?? 6)
                : values[name];
          return encodeFunctionResult({ abi, functionName: name, result });
        }
        throw new Error("Unexpected RPC " + method);
      },
    },
  });
  return { driver, policy, calls: () => calls };
}
const context = { agentId, token, chainId: 10143 };
const input = { wallet, side: "buy" as const, amount: "1000000", slippageBps: 50 };
test("public exact approval uses visitor, AUSD and canonical curve only", async () => {
  const f = fixture();
  const prepared = await f.driver.prepare(context, input);
  assert.equal(prepared.quote.approval, true);
  assert.equal(prepared.transaction.from, wallet);
  assert.equal(prepared.transaction.to.toLowerCase(), f.policy.preset.quoteAddress);
  const call = decodeFunctionData({ abi: erc20Abi, data: prepared.transaction.data as Hex });
  assert.equal(call.functionName, "approve");
  assert.deepEqual(
    call.args?.map((v) => (typeof v === "string" ? v.toLowerCase() : v)),
    [curve, 1000000n],
  );
  assert.ok(f.calls() <= 40);
});
for (const side of ["buy", "sell"] as const) {
  test("public " + side + " freezes minimum, recipient and deadline", async () => {
    const f = fixture({ allowance: 2n ** 255n });
    const prepared = await f.driver.prepare(context, { ...input, side });
    const call = decodeFunctionData({
      abi: PicklerBondingCurveAbi,
      data: prepared.transaction.data as Hex,
    });
    assert.equal(call.functionName, side === "buy" ? "buyExactInput" : "sellExactInput");
    assert.deepEqual(
      call.args?.map((v) => (typeof v === "string" ? v.toLowerCase() : v)),
      [1000000n, BigInt(prepared.quote.minimumOutput), wallet, 1700000300n],
    );
    assert.equal(prepared.quote.feeBps, 100);
    assert.ok(f.calls() <= 40);
  });
}
for (const [name, change] of Object.entries({
  closed: { phase: 1 },
  identity: { agentKey: "0x" + "0".repeat(64) },
  decimals: { quoteDecimals: 18 },
  chain: { chain: "0x8f" },
  code: { code: "0x01" },
  balance: { balanceOf: 0n },
  gas: { native: "0x0" },
  small: { quoteBuy: 0n },
  inventory: { remainingTokens: 1n },
})) {
  test("public preparation rejects " + name, async () => {
    await assert.rejects(() => fixture(change).driver.prepare(context, input));
  });
}
