import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaperOrder } from "@pickler/trading/polymarket";
import { PolymarketPaperResolution } from "../src/polymarket/paper-resolution.js";

const order = {
  marketId: "1",
  outcomeId: "2",
  fill: {
    conditions: {
      resolution: { conditionId: "0x" + "a".repeat(64), outcomeIndex: 0, outcomeCount: 2 },
    },
    market: { outcomes: [{ id: "2" }, { id: "3" }] },
  },
} as PaperOrder;
const uint = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const blockHash = "0x" + "b".repeat(64);
function rpc(values: unknown[]) {
  const calls: { method: string; params: unknown[] }[] = [];
  const fetcher = (async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    assert.ok(!request.method.includes("send"));
    assert.equal(init?.redirect, "manual");
    return Response.json({ jsonrpc: "2.0", id: 1, result: values.shift() });
  }) as typeof fetch;
  return { calls, provider: new PolymarketPaperResolution(fetcher) };
}

test("settlement uses finalized CTF fraction, including split payouts; no market price is used", async () => {
  const f = rpc(["0x89", { number: "0x10", hash: blockHash }, uint(2), uint(2), uint(1)]);
  const result = await f.provider.resolution(order, AbortSignal.timeout(1000));
  assert.equal(result?.numerator, "1");
  assert.equal(result?.denominator, "2");
  assert.equal(result?.blockNumber, "16");
  assert.equal(f.calls[1]?.params[0], "finalized");
  for (const call of f.calls.slice(2)) {
    assert.equal(call.method, "eth_call");
    assert.deepEqual(call.params[1], { blockHash, requireCanonical: true });
  }
});
test("unresolved contract leaves a position open, errors never become a payout", async () => {
  const pending = rpc(["0x89", { number: "0x10", hash: blockHash }, uint(0)]);
  assert.equal(await pending.provider.resolution(order, AbortSignal.timeout(1000)), null);
  const bad = rpc(["0x89", { number: "0x10", hash: blockHash }, "0x"]);
  await assert.rejects(bad.provider.resolution(order, AbortSignal.timeout(1000)), {
    code: "PAPER_RESOLUTION_UNAVAILABLE",
  });
  const network = new PolymarketPaperResolution(async () => {
    throw new Error("offline");
  });
  await assert.rejects(network.resolution(order, AbortSignal.timeout(1000)), {
    code: "INVALID_PROVIDER_RESPONSE",
  });
});
test("reject wrong chain, missing finality, outcome count mismatch and historical missing identity", async () => {
  for (const values of [
    ["0x1"],
    ["0x89", null],
    ["0x89", { number: "0x10", hash: blockHash }, uint(1), uint(3)],
  ]) {
    await assert.rejects(rpc(values).provider.resolution(order, AbortSignal.timeout(1000)), {
      code: "PAPER_RESOLUTION_UNAVAILABLE",
    });
  }
  const f = rpc([]);
  await assert.rejects(f.provider.resolution({ ...order, fill: null }, AbortSignal.timeout(1000)), {
    code: "PAPER_RESOLUTION_IDENTITY_MISSING",
  });
  assert.equal(f.calls.length, 0);
});

test("revocation between RPC reads stops further requests", async () => {
  const f = rpc(["0x89", { number: "0x10", hash: blockHash }, uint(1)]);
  let checks = 0;
  await assert.rejects(
    f.provider.resolution(order, AbortSignal.timeout(1000), async () => {
      if (++checks === 2) {
        throw new Error("permission revoked");
      }
    }),
    /permission revoked/,
  );
  assert.equal(f.calls.length, 1);
});

test("a forecast resolves from public identity without constructing an order", async () => {
  const f = rpc(["0x89", { number: "0x10", hash: blockHash }, uint(1), uint(2), uint(1)]);
  const identity = { ...order.fill!.conditions.resolution!, marketId: "1", outcomeId: "2" };
  const result = await f.provider.resolutionFor(identity, AbortSignal.timeout(1000));
  assert.equal(result?.marketId, "1");
  assert.equal(result?.outcomeId, "2");
  assert.equal(result?.numerator, "1");
  const invalid = rpc([]);
  await assert.rejects(
    invalid.provider.resolutionFor({ ...identity, outcomeIndex: -1 }, AbortSignal.timeout(1000)),
  );
  assert.equal(invalid.calls.length, 0);
});
