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

test("confirmation resolves the published token and validates identity before its driver", async () => {
  const context = { agentId: "agent-id", token: "0x" + "1".repeat(40), chainId: 10143 };
  let calls = 0;
  const driver = {
    prepare: async () => ({}) as never,
    confirm: async (c: unknown, i: unknown) => {
      calls++;
      assert.deepEqual(c, context);
      assert.deepEqual(i, confirmation);
      return { status: "confirmed" as const };
    },
  };
  const confirmation = { wallet: input.wallet, txHash: "0x" + "2".repeat(64) };
  const service = createPublicTokenTrading({ enabled: true, token: async () => context, driver });
  assert.deepEqual(await service.confirm("agent", confirmation), { status: "confirmed" });
  for (const patch of [{ wallet: "0x" + "0".repeat(40) }, { txHash: "bad" }]) {
    await assert.rejects(service.confirm("agent", { ...confirmation, ...patch }));
  }
  for (const enabled of [false, true]) {
    await assert.rejects(
      createPublicTokenTrading({ enabled, token: async () => null, driver }).confirm(
        "agent",
        confirmation,
      ),
    );
  }
  assert.equal(calls, 1);
});
