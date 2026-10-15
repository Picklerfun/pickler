import test from "node:test";
import assert from "node:assert/strict";
import { PerplDashboardGateway } from "../src/perpl/dashboard.js";
import { perplPositionMarkets } from "../src/perpl/dashboard-chain.js";
import { controlledPerplChain } from "./perpl-dashboard-chain-fixture.js";
import { DASHBOARD_WALLET } from "./perpl-dashboard-fixture.js";
const signal = new AbortController().signal;

test("public contract snapshot needs no key and pins every account/position read to one canonical block", async () => {
  const fake = controlledPerplChain();
  const result = await new PerplDashboardGateway(fake.fetcher).publicPortfolio(
    DASHBOARD_WALLET,
    signal,
  );
  assert.equal(result.source, "onchain");
  assert.equal(result.positions.length, 2);
  assert.equal(result.availableAusd, "480");
  assert.equal(result.realizedPnlAusd, null);
  assert.equal(result.positions[0]?.leverage, null);
  assert.deepEqual(
    result.positions.map((p) => [p.marketId, p.side]),
    [
      [16, "long"],
      [32, "short"],
    ],
  );
  assert.equal(result.block, 100);
  assert.ok(
    fake.calls.every((c) => ["eth_chainId", "eth_getBlockByNumber", "eth_call"].includes(c.method)),
  );
  assert.equal(
    fake.venue.calls.some((c) => c.path.includes("api-key") || c.path.includes("trading")),
    false,
  );
});

test("bitmap skips reserved flags and crosses all bank boundaries without dropping hidden markets", async () => {
  assert.deepEqual(
    perplPositionMarkets([(1n << 255n) | (1n << 252n), 1n, 1n, 1n]),
    [252, 253, 509, 765],
  );
  const fake = controlledPerplChain();
  fake.addMarket(300);
  const result = await new PerplDashboardGateway(fake.fetcher).publicPortfolio(
    DASHBOARD_WALLET,
    signal,
  );
  assert.equal(result.positions.length, 3);
  assert.equal(result.positions.find((p) => p.marketId === 300)?.markPrice, null);
  assert.equal(result.equityEstimateAusd, null);
  assert.equal(result.grossExposureAusd, null);
});

test("only the typed missing-account error yields an empty portfolio; RPC, identity and partial failures never do", async () => {
  const fake = controlledPerplChain();
  const gateway = new PerplDashboardGateway(fake.fetcher);
  fake.setFailure("missing");
  const empty = await gateway.publicPortfolio(DASHBOARD_WALLET, signal);
  assert.equal(empty.accountCount, 0);
  assert.equal(empty.positions.length, 0);
  for (const reason of ["unavailable", "chain", "identity", "position", "partial"]) {
    fake.setFailure(reason);
    await assert.rejects(gateway.publicPortfolio(DASHBOARD_WALLET, signal), /UNAVAILABLE/);
  }
});

test("an invalid oracle mark retains positions but keeps dependent risk and totals unknown", async () => {
  const fake = controlledPerplChain();
  fake.setFailure("mark");
  const result = await new PerplDashboardGateway(fake.fetcher).publicPortfolio(
    DASHBOARD_WALLET,
    signal,
  );
  assert.equal(result.positions.length, 2);
  assert.equal(result.positions[0]?.pricePnlAusd, null);
  assert.equal(result.positions[0]?.priceBufferBps, null);
  assert.equal(result.equityEstimateAusd, null);
  assert.equal(result.collateralAusd, "300");
});
