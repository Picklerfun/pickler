import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPaperMarket } from "@pickler/trading/polymarket";
import { type Market } from "@pickler/core";
const soccer: Market = {
  id: "1",
  question: "Will team A win?",
  rules: "Win in regulation time (90 minutes). A draw resolves No.",
  active: true,
  categoryIds: ["1"],
  closesAt: null,
  liquidity: 1,
  sportsMarketType: "moneyline",
  outcomes: [
    { id: "2", label: "Yes" },
    { id: "3", label: "No" },
  ],
  classification: {
    version: 1,
    category: "sports",
    subcategory: "soccer",
    temporalClass: "match",
    provenance: {
      provider: "polymarket",
      mappingVersion: "1.0.0",
      tagIds: ["100350"],
      temporalBasis: "sportsMarketType",
    },
  },
};
test("paper accepts reviewed soccer regulation/extra-time and NFL game winners", () => {
  assert.doesNotThrow(() => assertPaperMarket(soccer));
  assert.doesNotThrow(() =>
    assertPaperMarket({ ...soccer, rules: "Winner including extra time." }),
  );
  assert.doesNotThrow(() =>
    assertPaperMarket({
      ...soccer,
      question: "NFL: team A vs team B",
      rules: "Full game including overtime",
      classification: {
        ...soccer.classification!,
        subcategory: "american-football",
        league: "nfl",
      },
    }),
  );
});
test("paper excludes awards, totals, unknown sports and ambiguous sporting periods", () => {
  for (const market of [
    { ...soccer, sportsMarketType: "totals" },
    { ...soccer, question: "First half winner" },
    { ...soccer, rules: "Who will win?" },
    { ...soccer, classification: { ...soccer.classification!, temporalClass: "award" as const } },
    { ...soccer, classification: undefined },
  ]) {
    assert.throws(() => assertPaperMarket(market), { code: "PAPER_UNSUPPORTED_MARKET" });
  }
});
