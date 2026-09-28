import test from "node:test";
import assert from "node:assert/strict";
import {
  comparisonTransport,
  type PublicRequestDiagnostic,
} from "../src/polymarket/comparison-transport.js";

test("public transport serializes requests and spaces starts by 500ms", async () => {
  let now = 0,
    inFlight = 0,
    max = 0;
  const starts: number[] = [],
    records: PublicRequestDiagnostic[] = [];
  const transport = comparisonTransport({
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    guard: async () => {},
    report: async (r) => {
      records.push(r);
    },
    fetcher: async () => {
      starts.push(now);
      inFlight++;
      max = Math.max(max, inFlight);
      await Promise.resolve();
      inFlight--;
      return Response.json({ ok: true });
    },
  });
  await Promise.all(
    [1, 2, 3].map(() => transport("https://api.exchange.coinbase.com/products/BTC-USD/ticker")),
  );
  assert.deepEqual(starts, [0, 500, 1000]);
  assert.equal(max, 1);
  assert.equal(records.length, 3);
});
test("429 honors Retry-After, defaults to sixty seconds and never retries", async () => {
  for (const header of [undefined, "12", "invalid"]) {
    let now = 1000,
      calls = 0;
    const records: PublicRequestDiagnostic[] = [];
    const transport = comparisonTransport({
      now: () => now,
      wait: async (ms) => {
        now += ms;
      },
      guard: async () => {},
      report: async (r) => {
        records.push(r);
      },
      fetcher: async () => {
        calls++;
        return new Response("secret body", {
          status: 429,
          headers: header ? { "Retry-After": header, "x-secret": "secret" } : {},
        });
      },
    });
    const response = await transport("https://gamma-api.polymarket.com/markets/1");
    assert.equal(await response.text(), "");
    await assert.rejects(transport("https://gamma-api.polymarket.com/markets/2"), /cooldown/);
    assert.equal(calls, 1);
    assert.equal(records[0]!.cooldownUntil, header === "12" ? 13000 : 61000);
    assert.equal(JSON.stringify(records).includes("secret"), false);
  }
});
test("diagnostics distinguish public operations and reject revoked permissions", async () => {
  const records: PublicRequestDiagnostic[] = [];
  let revoked = false,
    now = 0;
  const transport = comparisonTransport({
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    guard: async () => {
      if (revoked) {
        throw new Error("revoked");
      }
    },
    report: async (r) => {
      records.push(r);
    },
    fetcher: async () => new Response("private", { status: 400 }),
  });
  for (const url of [
    "https://polymarket.com/api/crypto/crypto-price",
    "https://clob.polymarket.com/book",
    "https://api.exchange.coinbase.com/products/BTC-USD/candles",
  ]) {
    await transport(url);
  }
  assert.deepEqual(
    records.map((r) => r.operation),
    ["opening", "book", "candles"],
  );
  assert.ok(records.every((r) => r.status === 400 && r.durationMs >= 0 && r.id));
  revoked = true;
  await assert.rejects(transport("https://clob.polymarket.com/book"), /revoked/);
  assert.equal(records.length, 3);
});
