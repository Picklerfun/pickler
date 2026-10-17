import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { documentationServices } from "../src/openapi/composition.js";
import { PublicTokenTradeError, type PublicTokenTradePrepared } from "@pickler/core";
const wallet = "0x" + "c".repeat(40),
  token = "0x" + "a".repeat(40),
  curve = "0x" + "b".repeat(40);
const input = { wallet, side: "buy", amount: "1000000", slippageBps: 50 };
function app(prepare: (handle: string, input: unknown) => Promise<PublicTokenTradePrepared>) {
  return createApp({
    ...documentationServices({ growth: true }),
    publicTokenTrading: {
      prepare,
      quote: async (handle, input) => {
        const prepared = await prepare(handle, input);
        return {
          version: prepared.version,
          token: prepared.token,
          curve: prepared.curve,
          quoteToken: prepared.quoteToken,
          expiresAt: prepared.expiresAt,
          quote: prepared.quote,
        };
      },
      confirm: async () => ({ status: "confirmed" }),
    },
  });
}
function request(instance: ReturnType<typeof app>, body: unknown = input) {
  return instance.request(
    "/v1/marketplace/personas/agent/token/prepare",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    { APP_ENV: "local" } as never,
  );
}
test("public preparation needs no owner JWT and never invokes custody authentication", async () => {
  const result: PublicTokenTradePrepared = {
    version: 1,
    token,
    curve,
    quoteToken: wallet,
    expiresAt: new Date().toISOString(),
    quote: {
      amount: input.amount,
      slippageBps: input.slippageBps,
      side: "buy",
      approval: true,
      expectedOutput: "1",
      minimumOutput: "1",
      balance: "1000000",
      allowance: "0",
      feeBps: 100,
    },
    transaction: {
      from: wallet,
      to: curve,
      data: "0x01",
      value: "0x0",
      chainId: 10143,
      nonce: 0,
      gas: "0x1",
      maxFeePerGas: "0x2",
      maxPriorityFeePerGas: "0x1",
    },
  };
  const response = await request(
    app(async (handle, body) => {
      assert.equal(handle, "agent");
      assert.deepEqual(body, input);
      return result;
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), result);
});
test("arbitrary contracts, calldata and invalid amounts are refused before preparation", async () => {
  let calls = 0;
  const instance = app(async () => {
    calls++;
    return {} as never;
  });
  for (const body of [
    { ...input, to: curve },
    { ...input, data: "0x01" },
    { ...input, amount: "0" },
    { ...input, amount: "1".repeat(79) },
    { ...input, slippageBps: 101 },
  ]) {
    const response = await request(instance, body);
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});
test("quota and disabled composition remain explicit without provider details", async () => {
  for (const [code, status] of [
    ["RPC_LIMIT", 429],
    ["TRADING_UNAVAILABLE", 503],
  ] as const) {
    const response = await request(
      app(async () => {
        throw new PublicTokenTradeError(code);
      }),
    );
    assert.equal(response.status, status);
    if (status === 429) {
      assert.equal(response.headers.get("retry-after"), "60");
    }
  }
  const response = await request(
    app(async () => {
      throw new Error("private RPC endpoint");
    }),
  );
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private RPC endpoint/);
});

test("public confirmation is strict, no-store and does not accept contracts or financial values", async () => {
  const instance = app(async () => {
    throw new Error("Preparation must not run");
  });
  const url = "/v1/marketplace/personas/agent/token/confirm";
  const confirmation = { wallet, txHash: "0x" + "a".repeat(64) };
  for (const body of [
    confirmation,
    { ...confirmation, token },
    { ...confirmation, priceWad: "1" },
    { ...confirmation, wallet: "invalid" },
  ]) {
    const response = await instance.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { APP_ENV: "local" } as never,
    );
    assert.equal(response.status, body === confirmation ? 200 : 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("quote is public and no-store, returns quantities without a transaction, and validates strict input", async () => {
  let calls = 0;
  const instance = createApp({
    ...documentationServices({ growth: true }),
    publicTokenTrading: {
      prepare: async () => {
        throw new Error("Must not prepare");
      },
      confirm: async () => ({ status: "pending" }),
      quote: async (handle, requested) => {
        calls++;
        assert.equal(handle, "agent");
        assert.deepEqual(requested, input);
        return {
          version: 1,
          token,
          curve,
          quoteToken: wallet,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          quote: {
            amount: input.amount,
            slippageBps: input.slippageBps,
            side: "buy",
            approval: true,
            expectedOutput: "1900000000000000000000",
            minimumOutput: "1890500000000000000000",
            balance: "0",
            allowance: "0",
            feeBps: 100,
          },
        };
      },
    },
  });
  for (const body of [input, { ...input, to: curve }, { ...input, amount: "0" }]) {
    const response = await instance.request(
      "/v1/marketplace/personas/agent/token/quote",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { APP_ENV: "local" } as never,
    );
    assert.equal(response.status, body === input ? 200 : 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (body === input) {
      const quoted = (await response.json()) as Record<string, unknown>;
      assert.equal("transaction" in quoted, false);
    }
  }
  assert.equal(calls, 1);
});
