import test from "node:test";
import assert from "node:assert/strict";
import {
  createPublicTokenTrading,
  PublicTokenTradeError,
  type PublicTokenTradeDriver,
} from "../src/features/launch/public-token-trading.js";
const input = {
  wallet: "0x" + "5".repeat(40),
  side: "buy" as const,
  amount: "1000000",
  slippageBps: 50,
};
test("public trading is closed without its independent configuration, before reads", async () => {
  let reads = 0;
  const service = createPublicTokenTrading({
    enabled: false,
    token: async () => {
      reads++;
      return null;
    },
  });
  await assert.rejects(
    () => service.prepare("agent", input),
    (e) => e instanceof PublicTokenTradeError && e.code === "TRADING_UNAVAILABLE",
  );
  assert.equal(reads, 0);
});
test("every visitor may prepare against a published canonical token; no creator scope", async () => {
  let asked: unknown;
  const context = { agentId: "agent-id", token: "0x" + "1".repeat(40), chainId: 10143 };
  const driver = {
    prepare: async (c: unknown, i: unknown) => {
      asked = { c, i };
      return {} as never;
    },
  } satisfies PublicTokenTradeDriver;
  await createPublicTokenTrading({ enabled: true, token: async () => context, driver }).prepare(
    "agent",
    input,
  );
  assert.deepEqual(asked, { c: context, i: input });
});
test("missing/mainnet tokens and invalid trades never reach the driver", async () => {
  let calls = 0;
  const driver = {
    prepare: async () => {
      calls++;
      return {} as never;
    },
  };
  for (const context of [null, { agentId: "id", token: "token", chainId: 143 }]) {
    await assert.rejects(() =>
      createPublicTokenTrading({ enabled: true, token: async () => context, driver }).prepare(
        "agent",
        input,
      ),
    );
  }
  const service = createPublicTokenTrading({ enabled: true, token: async () => null, driver });
  for (const mutation of [
    { amount: "0" },
    { amount: (2n ** 256n).toString() },
    { wallet: "0x" + "0".repeat(40) },
    { side: "other" },
    { slippageBps: 101 },
  ]) {
    await assert.rejects(() => service.prepare("agent", { ...input, ...mutation } as typeof input));
  }
  assert.equal(calls, 0);
});
