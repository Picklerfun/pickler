import assert from "node:assert/strict";
import test from "node:test";
import { probePolymarketPreproduction } from "../src/polymarket/preproduction.js";

test("preproduction probes only public fixed GET routes, without credentials or trading", async () => {
  const calls: string[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    assert.deepEqual(init?.headers, { Accept: "application/json" });
    assert.equal(init?.body, undefined);
    return Response.json(calls.length === 1 ? 1790418554 : [{ id: "test" }]);
  };
  const report = await probePolymarketPreproduction(transport);
  assert.deepEqual(calls, [
    "https://clob-preprod-int-v2.polymarket.com/time",
    "https://gamma-api-preprod-int.polymarket.com/markets?limit=1&active=true&closed=false",
  ]);
  assert.equal(report.publicReadAccess, true);
  assert.equal(report.environment.configuredChainId, 137);
  assert.equal(report.environment.tradingEnabled, false);
  assert.equal(report.environment.testFundsVerified, false);
  assert.equal(report.orderAcceptanceVerified, false);
});

for (const [name, response] of [
  ["redirect", () => new Response(null, { status: 302 })],
  ["denied", () => new Response("secret", { status: 403 })],
  ["invalid JSON", () => new Response("secret")],
  ["invalid schema", () => Response.json({ secret: "hidden" })],
] as const) {
  test(`fails safely on ${name} without retries or response body logging`, async () => {
    let calls = 0;
    const report = await probePolymarketPreproduction(async () => {
      calls++;
      return response();
    });
    assert.equal(calls, 2);
    assert.equal(report.publicReadAccess, false);
    assert.equal(JSON.stringify(report).includes("secret"), false);
  });
}

test("cancellation stops subsequent probes and sanitizes transport errors", async () => {
  const controller = new AbortController();
  const report = await probePolymarketPreproduction(async () => {
    controller.abort();
    throw new Error("credential-bearing error");
  }, controller.signal);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]?.outcome, "CANCELLED");
  assert.equal(JSON.stringify(report).includes("credential-bearing"), false);
});
