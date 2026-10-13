import test from "node:test";
import assert from "node:assert/strict";
import { dashboardMarkets, dashboardPortfolio } from "../src/features/perpl-dashboard/model.js";
const market = {
  id: 16,
  symbol: "BTC",
  priceDecimals: 1,
  sizeDecimals: 5,
  mark: 1100000,
  prev: 1000000,
  maxLeverage: 15,
  maintenanceBps: 500,
  openInterest: 100000,
  fundingRate: 100,
  fundingIntervalSec: 3600,
};
const account = { id: 619, balance: "500000000", locked: "100000000", frozen: false };
const long = {
  id: 1,
  accountId: 619,
  marketId: 16,
  side: "long" as const,
  size: 1000,
  entry: 1000000,
  collateral: "200000000",
  leverage: 5,
};
test("real wallet projection uses exact scaled quantities and current collateral without inventing net funding", () => {
  const result = dashboardPortfolio({
    accounts: [account],
    positions: [long],
    markets: [market],
    stats: [{ accountId: 619, realizedPnl: "1234567", fees: "100001", volume: "12345678901" }],
  });
  assert.equal(result.availableAusd, "400");
  assert.equal(result.pricePnlAusd, "100");
  assert.equal(result.equityEstimateAusd, "800");
  assert.equal(result.grossExposureAusd, "1100");
  assert.equal(result.netExposureAusd, "1100");
  assert.equal(result.realizedPnlAusd, "1.234567");
  assert.equal(result.positions[0]?.collateralExhaustionPrice, "80000");
  const changed = dashboardPortfolio({
    accounts: [account],
    positions: [{ ...long, collateral: "300000000" }],
    markets: [market],
    stats: [],
  });
  assert.equal(changed.positions[0]?.collateralExhaustionPrice, "70000");
});
test("short price PnL and signed exposure differ from gross exposure", () => {
  const result = dashboardPortfolio({
    accounts: [account],
    positions: [{ ...long, side: "short" }],
    markets: [market],
    stats: [],
  });
  assert.equal(result.pricePnlAusd, "-100");
  assert.equal(result.grossExposureAusd, "1100");
  assert.equal(result.netExposureAusd, "-1100");
  assert.equal(result.positions[0]?.collateralExhaustionPrice, "120000");
});
test("missing market/statistics stays unknown and a verified empty wallet is zero", () => {
  const result = dashboardPortfolio({
    accounts: [account],
    positions: [long],
    markets: [],
    stats: [],
  });
  assert.equal(result.equityEstimateAusd, null);
  assert.equal(result.pricePnlAusd, null);
  assert.equal(result.grossExposureAusd, null);
  assert.equal(result.realizedPnlAusd, null);
  assert.equal(result.positions[0]?.markPrice, null);
  assert.equal(result.collateralAusd, "200");
  assert.equal(
    dashboardPortfolio({ accounts: [], positions: [], markets: [], stats: [] }).equityEstimateAusd,
    "0",
  );
});
test("unknown protocol interest/funding is not manufactured as zero", () => {
  const result = dashboardMarkets([{ ...market, openInterest: null, fundingRate: null }]);
  assert.equal(result.totalOpenInterestAusd, null);
  assert.equal(result.markets[0]?.fundingBps, null);
  assert.equal(dashboardMarkets([market]).totalOpenInterestAusd, "110000");
  assert.equal(dashboardMarkets([market]).markets[0]?.change24hBps, "1000");
});
test("unowned position and impossible account balances fail closed", () => {
  assert.throws(
    () => dashboardPortfolio({ accounts: [], positions: [long], markets: [market], stats: [] }),
    /another account/,
  );
  assert.throws(
    () =>
      dashboardPortfolio({
        accounts: [{ ...account, locked: "600000000" }],
        positions: [],
        markets: [market],
        stats: [],
      }),
    /balance/,
  );
});

test("on-chain Q16 entry residues preserve long ceil and short floor precision", () => {
  const project = (side: "long" | "short") =>
    dashboardPortfolio({
      accounts: [account],
      positions: [{ ...long, side, entryResidue: 32768, leverage: null }],
      markets: [market],
      stats: [],
    }).positions[0]!;
  assert.equal(project("long").entryPrice, "99999.95");
  assert.equal(project("short").entryPrice, "100000.05");
  assert.equal(project("long").pricePnlAusd, "100.0005");
  assert.equal(project("short").pricePnlAusd, "-99.9995");
});
