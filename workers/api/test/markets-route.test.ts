import test from "node:test";
import assert from "node:assert/strict";
import { createGetMarket, createListMarkets, READ_HORIZON } from "@pickler/core";
import { createSampleMarketBoard } from "../../../scripts/design/fixtures/sample-market-board.mts";
import { marketplaceRoutes } from "../src/routes/marketplace.js";
import type { createGrowthServices } from "../src/growth/services.js";
import { marketDetailDtoSchema } from "@pickler/api-schema";
import { toMarketDetailDto } from "../src/growth/market-responses.js";
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

test("market detail preserves aligned UTC times without requiring them from legacy producers", async () => {
  const detail = await createSampleMarketBoard().getMarket("BTC-PERP");
  assert.ok(detail);
  const legacy = toMarketDetailDto(detail);
  assert.ok(marketDetailDtoSchema.safeParse(legacy).success);
  assert.equal(legacy.trailTimestamps, undefined);
  const times = detail.trail.map((_, index) => new Date(Date.UTC(2026, 9, 8, index)).toISOString());

  const timed = toMarketDetailDto({ ...detail, trailTimestamps: times });
  assert.deepEqual(marketDetailDtoSchema.parse(timed).trailTimestamps, times);
  assert.notEqual(timed.trailTimestamps, times);
  assert.ok(
    !marketDetailDtoSchema.safeParse({ ...timed, trailTimestamps: ["not a date"] }).success,
  );
});

test("timestamped longer history is additive, cloned and bounded on the public contract", async () => {
  const detail = await createSampleMarketBoard().getMarket("BTC-PERP");
  assert.ok(detail);
  const history = [{ price: 10, at: "2026-10-08T12:00:00.000Z" }];

  const response = toMarketDetailDto({ ...detail, priceHistory: history });

  assert.deepEqual(marketDetailDtoSchema.parse(response).priceHistory, history);
  assert.notEqual(response.priceHistory, history);
  assert.notEqual(response.priceHistory?.[0], history[0]);
  assert.equal(toMarketDetailDto(detail).priceHistory, undefined);
  assert.ok(
    !marketDetailDtoSchema.safeParse({ ...response, priceHistory: [{ price: 10, at: "bad" }] })
      .success,
  );
  assert.ok(
    !marketDetailDtoSchema.safeParse({ ...response, priceHistory: Array(722).fill(history[0]) })
      .success,
  );
});
