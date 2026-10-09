import test from "node:test";
import assert from "node:assert/strict";
import { createGetMarket, createListMarkets, READ_HORIZON } from "@pickler/core";
import { createSampleMarketBoard } from "../../../scripts/design/fixtures/sample-market-board.mts";
import { marketplaceRoutes } from "../src/routes/marketplace.js";
import type { createGrowthServices } from "../src/growth/services.js";
import type { MarketDetailDto, PerpMarketDto } from "@pickler/api-schema";

const env = { APP_ENV: "staging", ALLOWED_ORIGINS: "https://web.example" } as never;

function fixture() {
  const board = createSampleMarketBoard();
  return marketplaceRoutes({
    listMarkets: createListMarkets(board),
    getMarket: createGetMarket(board),
  } as ReturnType<typeof createGrowthServices>);
}

test("the market board lists six perpetual markets in the wire format", async () => {
  const response = await fixture().request("/markets", {}, env);

  assert.equal(response.status, 200);

  const markets = (await response.json()) as PerpMarketDto[];
  assert.equal(markets.length, 6);
  assert.equal(markets[0]!.symbol, "BTC-PERP");
  // Fractions on the wire, never percentages already multiplied out.
  assert.ok(Math.abs(markets[0]!.change24h) < 1);
  assert.ok(markets.every((market) => typeof market.hourlyReach === "number"));
});

test("one market carries its calls, its trail and the question a read would ask", async () => {
  const response = await fixture().request("/markets/btc-perp", {}, env);

  assert.equal(response.status, 200);
  const detail = (await response.json()) as MarketDetailDto;

  assert.equal(detail.market.symbol, "BTC-PERP");
  assert.equal(detail.calls.length, 3);
  assert.equal(detail.trail.length > 2, true);
  // Core writes the sentence; the page only fills in the level.
  assert.match(detail.readQuestion, /\{level\}/);
  assert.match(detail.readQuestion, new RegExp(`${READ_HORIZON.toLowerCase()} later`));
  assert.match(detail.readQuestion, /Perpl/);
});

test("a market the venue does not list is null, not an error", async () => {
  const response = await fixture().request("/markets/NOPE-PERP", {}, env);

  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
});
