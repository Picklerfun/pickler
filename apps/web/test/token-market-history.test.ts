import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialTokenPriceRange,
  tokenHistoryForRange,
  tokenPricePoints,
} from "../src/features/tokens/market-history";

const point = (at: string, priceWad = "488780853606281") => ({ at, priceWad });

test("an idle token opens its recorded seven-day history instead of an empty 24h chart", () => {
  const market = {
    windowEnd: "2026-10-16T02:09:36Z",
    history: [
      point("2026-10-11T23:00:44Z", "476190476160714"),
      point("2026-10-12T13:52:57Z", "485070781685270"),
      point("2026-10-13T21:56:52Z"),
    ],
  };

  assert.equal(initialTokenPriceRange(market), "7D");
  assert.deepEqual(tokenHistoryForRange(market, "24H"), []);
  assert.deepEqual(tokenHistoryForRange(market, "7D"), market.history);
  assert.equal(tokenPricePoints(tokenHistoryForRange(market, "7D")).length, 3);
});

test("history remains reachable after all returned observations age beyond seven days", () => {
  const market = {
    windowEnd: "2026-10-23T12:00:00Z",
    history: [point("2026-10-11T23:00:44Z"), point("2026-10-13T21:56:52Z")],
  };

  assert.equal(initialTokenPriceRange(market), "ALL");
  assert.deepEqual(tokenHistoryForRange(market, "7D"), []);
  assert.deepEqual(tokenHistoryForRange(market, "ALL"), market.history);
});

test("recent activity keeps 24h as the initial range", () => {
  const market = {
    windowEnd: "2026-10-16T12:00:00Z",
    history: [point("2026-10-16T08:00:00Z"), point("2026-10-16T11:00:00Z")],
  };

  assert.equal(initialTokenPriceRange(market), "24H");
  assert.deepEqual(tokenHistoryForRange(market, "1H"), [market.history[1]]);
});

test("range selection counts drawable seconds, keeping same-second receipts from hiding history", () => {
  const market = {
    windowEnd: "2026-10-16T12:00:00Z",
    history: [
      point("2026-10-13T08:00:00Z"),
      point("2026-10-16T11:00:00.100Z"),
      point("2026-10-16T11:00:00.900Z", "490000000000000"),
    ],
  };

  assert.equal(initialTokenPriceRange(market), "7D");
  assert.deepEqual(tokenPricePoints(tokenHistoryForRange(market, "24H")), [
    { at: Date.parse("2026-10-16T11:00:00Z"), value: 0.00049 },
  ]);
});

test("range boundaries use the server window and never add observations or include future ones", () => {
  const market = {
    windowEnd: "2026-10-16T12:00:00Z",
    history: [
      point("2026-10-15T11:59:59Z"),
      point("2026-10-15T12:00:00Z"),
      point("2026-10-16T12:00:00Z"),
      point("2026-10-16T12:00:01Z"),
    ],
  };

  assert.deepEqual(tokenHistoryForRange(market, "24H"), market.history.slice(1, 3));
  assert.deepEqual(tokenHistoryForRange(market, "ALL"), market.history.slice(0, 3));
  assert.deepEqual(tokenHistoryForRange(undefined, "ALL"), []);
  assert.equal(initialTokenPriceRange(undefined), "24H");
});
