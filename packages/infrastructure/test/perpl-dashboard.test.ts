import test from "node:test";
import assert from "node:assert/strict";
import { PerplDashboardGateway } from "../src/perpl/dashboard.js";
import { controlledPerpl, DASHBOARD_WALLET } from "./perpl-dashboard-fixture.js";
const signal = new AbortController().signal;
function proofs(now: number) {
  const proof = {
    apiKey: "controlled-read-token",
    timestamp: String(now),
    nonce: "a".repeat(22),
    signature: "b".repeat(86),
  };
  return {
    wallet: DASHBOARD_WALLET,
    walletProof: proof,
    positionsProof: { ...proof, nonce: "c".repeat(22) },
  };
}
test("gateway reads fixed private GET paths, real-model projections and no signing secrets", async () => {
  const fake = controlledPerpl();
  const gateway = new PerplDashboardGateway(fake.fetcher);
  const result = await gateway.portfolio(proofs(Date.now()), signal);
  assert.equal(result.wallet.toLowerCase(), DASHBOARD_WALLET);
  assert.equal(result.positions.length, 2);
  assert.equal(result.availableAusd, "480");
  assert.equal(result.realizedPnlAusd, "32.5");
  assert.equal(result.block, 100);
  assert.ok(fake.calls.every((call) => call.method === "GET" && call.body === null));
  assert.equal(JSON.stringify(result).includes("controlled-read-token"), false);
});
test("wrong wallet and stale/replayed credential proofs are refused", async () => {
  const fake = controlledPerpl();
  const gateway = new PerplDashboardGateway(fake.fetcher);
  const input = proofs(Date.now());
  await assert.rejects(
    gateway.portfolio({ ...input, positionsProof: input.walletProof }, signal),
    /INVALID_AUTHORIZATION/,
  );
  assert.equal(fake.calls.length, 0);
  fake.setWrongWallet(true);
  await assert.rejects(gateway.portfolio(input, signal), /INVALID_RESPONSE/);
});
test("public context is cached; failed refresh becomes stale, then unavailable, never invented", async () => {
  let now = Date.now();
  const fake = controlledPerpl(() => now);
  const gateway = new PerplDashboardGateway(fake.fetcher, () => now);
  const first = await gateway.markets(signal);
  assert.equal(first.stale, false);
  await gateway.markets(signal);
  assert.equal(fake.calls.length, 1);
  now += 11000;
  fake.setUnavailable(true);
  const stale = await gateway.markets(signal);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.markets, first.markets);
  now += 60000;
  await assert.rejects(gateway.markets(signal), /UNAVAILABLE/);
});
test("payload requests only read scope and validates unchanged signer/public key/expiry", async () => {
  const fake = controlledPerpl();
  const gateway = new PerplDashboardGateway(fake.fetcher);
  const input = {
    wallet: DASHBOARD_WALLET,
    publicKey: "0x" + "6".repeat(64),
    expiresAt: Date.now() + 3500000,
  };
  const result = await gateway.payload(input, signal);
  assert.equal(result.typedData.message.scope, "1");
  assert.equal(result.typedData.message.expiresAt, String(input.expiresAt));
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]?.path, "/api/v1/api-key/payload");
});

test("another collateral asset cannot be labelled AUSD", async () => {
  const fake = controlledPerpl();
  const gateway = new PerplDashboardGateway(async (url, init) => {
    const response = await fake.fetcher(url, init);
    const body = await response.json();
    if (String(url).endsWith("/pub/context")) {
      body.tokens[0].decimals = 18;
    }
    return Response.json(body);
  });
  await assert.rejects(gateway.markets(signal), /INVALID_RESPONSE/);
});
