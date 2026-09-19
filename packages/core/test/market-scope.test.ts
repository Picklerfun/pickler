import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  SPORT_IDS,
  selectedSports,
  assertConfig,
  configuredMarketExclusion,
  protocolForMarket,
  assertCanQueue,
  assertPaperAllowed,
  type AgentConfig,
  type Market,
  type MarketScope,
} from "../src/index.js";
const now = Date.parse("2026-09-17T12:00:00Z");
const { categoryIds: _categories, ...base } = DEFAULT_CONFIG;
void _categories;
const scope: MarketScope = { version: 1, category: "sports", subcategories: ["soccer"] };
const config: AgentConfig = { ...base, marketScope: scope };
const market: Market = {
  id: "1",
  question: "Award",
  rules: "Official award winner",
  active: true,
  categoryIds: ["100350", "18"],
  closesAt: "2026-10-31T00:00:00Z",
  liquidity: 1,
  outcomes: [
    { id: "2", label: "Yes" },
    { id: "3", label: "No" },
  ],
  classification: {
    version: 1,
    category: "sports",
    subcategory: "soccer",
    temporalClass: "award",
    provenance: {
      provider: "polymarket",
      mappingVersion: "1.0.0",
      tagIds: ["100350", "18"],
      temporalBasis: "award-tag:18",
    },
  },
};
test("catalog version one has exactly four sports; invalid or mixed scopes never widen permission", () => {
  assert.deepEqual(selectedSports({ ...scope, subcategories: "all" }), SPORT_IDS);
  assert.doesNotThrow(() => assertConfig(config));
  for (const subcategories of [[], ["soccer", "soccer"], ["unknown"]]) {
    assert.throws(
      () => assertConfig({ ...config, marketScope: { ...scope, subcategories } as MarketScope }),
      { code: "INVALID_INPUT" },
    );
  }
  for (const extra of [
    { categoryIds: [] },
    { researchProtocol: "nfl-winner-v1" as const },
    {
      discoveryPolicy: {
        version: 1 as const,
        mode: "open-market" as const,
        minLeadMinutes: 15,
        maxHorizonDays: 7,
      },
    },
  ]) {
    assert.throws(() => assertConfig({ ...config, ...extra }), { code: "INVALID_INPUT" });
  }
  assert.doesNotThrow(() => assertConfig(DEFAULT_CONFIG));
  assert.doesNotThrow(() =>
    assertCanQueue(
      {
        id: "a",
        tenantId: "a",
        config,
        version: 1,
        paused: false,
        scheduleEnabled: false,
        nextDueAt: null,
      },
      0,
    ),
  );
});
test("awards and seasons use future close while matches require verified kickoff within bounds", () => {
  assert.equal(configuredMarketExclusion(market, config, now), null);
  assert.equal(protocolForMarket(market, config), "general-market-v1");
  assert.equal(
    configuredMarketExclusion({ ...market, classification: undefined }, config, now),
    "MARKET_CLASSIFICATION_UNKNOWN",
  );
  assert.equal(
    configuredMarketExclusion(
      market,
      { ...config, marketScope: { ...scope, subcategories: ["tennis"] } },
      now,
    ),
    "SUBCATEGORY_NOT_ALLOWED",
  );
  const match = {
    ...market,
    classification: { ...market.classification!, temporalClass: "match" as const },
    startsAt: new Date(now + 15 * 60000).toISOString(),
    timingSource: "polymarket.gameStartTime",
  };
  assert.equal(configuredMarketExclusion(match, config, now), null);
  assert.equal(configuredMarketExclusion(match, config, now + 1), "EVENT_STARTED_OR_TOO_SOON");
  assert.equal(
    configuredMarketExclusion({ ...match, startsAt: null }, config, now),
    "UNKNOWN_EVENT_TIME",
  );
  assert.equal(
    configuredMarketExclusion(
      { ...match, startsAt: new Date(now + 8 * 86400000).toISOString() },
      config,
      now,
    ),
    "EVENT_OUTSIDE_HORIZON",
  );
  assert.equal(
    configuredMarketExclusion(
      { ...market, classification: { ...market.classification!, temporalClass: "season" } },
      config,
      now,
    ),
    null,
  );
  assert.equal(
    configuredMarketExclusion(
      { ...market, classification: { ...market.classification!, temporalClass: "unknown" } },
      config,
      now,
    ),
    "MARKET_TIMING_CLASS_UNKNOWN",
  );
  assert.equal(
    configuredMarketExclusion({ ...market, active: false }, config, now),
    "MARKET_NOT_OPEN",
  );
});
test("only verified NFL game winners select the NFL protocol", () => {
  const nfl = {
    ...market,
    question: "NFL Lions vs Bills",
    sportsMarketType: "moneyline",
    classification: {
      ...market.classification!,
      subcategory: "american-football" as const,
      temporalClass: "match" as const,
      league: "nfl" as const,
    },
  };
  assert.equal(protocolForMarket(nfl, config), "nfl-winner-v1");
  assert.equal(
    protocolForMarket({ ...nfl, sportsMarketType: "spreads" }, config),
    "general-market-v1",
  );
  assert.equal(
    protocolForMarket(
      { ...nfl, classification: { ...nfl.classification, league: undefined } },
      config,
    ),
    "general-market-v1",
  );
});
test("a general v4 trade cannot enter manual paper trading", () => {
  const agent = {
    paused: false,
    version: 1,
    config: {
      ...config,
      plugins: { version: 1 as const, enabled: ["paper-trading", "polymarket"] as const },
    },
  };
  assert.throws(
    () =>
      assertPaperAllowed(
        {
          status: "completed",
          configVersion: 1,
          decision: { schemaVersion: 4, protocol: "general-market-v1" } as never,
        },
        agent as never,
        now,
      ),
    { code: "PAPER_UNSUPPORTED_PROTOCOL" },
  );
});
