import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPaperMarket } from "@pickler/trading/polymarket";
import { isSoccerFullGameWinner, type Market } from "@pickler/core";
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
test("one predicate decides a soccer full-game winner, and paper follows it", () => {
  const cases: [Market, boolean][] = [
    [soccer, true],
    [{ ...soccer, rules: "Resolves on the result after 90 minutes." }, true],
    [{ ...soccer, rules: "Resolves on regular time only." }, true],
    [{ ...soccer, rules: "Winner including extra time." }, true],
    [{ ...soccer, rules: "Winner with overtime and penalties." }, true],
    [{ ...soccer, sportsMarketType: "match_winner" }, true],
    [{ ...soccer, rules: "Overtime is excluded. The winner is decided later." }, false],
    [{ ...soccer, sportsMarketType: "spread" }, false],
    [{ ...soccer, sportsMarketType: undefined }, false],
    [{ ...soccer, question: "Will team A qualify?" }, false],
    [{ ...soccer, question: "Second half winner" }, false],
    [{ ...soccer, classification: { ...soccer.classification!, temporalClass: "award" } }, false],
    [{ ...soccer, classification: { ...soccer.classification!, subcategory: "tennis" } }, false],
    [{ ...soccer, classification: undefined }, false],
  ];

  for (const [market, expected] of cases) {
    assert.equal(isSoccerFullGameWinner(market), expected, `${market.question} · ${market.rules}`);
    if (expected) {
      assert.doesNotThrow(() => assertPaperMarket(market));
    } else {
      assert.throws(() => assertPaperMarket(market), { code: "PAPER_UNSUPPORTED_MARKET" });
    }
  }
});
