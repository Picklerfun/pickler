import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  SPEND_ENFORCED,
  assertConfig,
  type AgentConfig,
  type SpendLimits,
} from "../src/features/research/types.js";

function withSpend(spend?: SpendLimits): AgentConfig {
  const config: AgentConfig = {
    ...DEFAULT_CONFIG,
    marketScope: { version: 1, category: "sports", subcategories: ["american-football"] },
  };
  delete config.categoryIds;
  if (spend) {
    config.spend = spend;
  }
  return config;
}

test("spend limits are optional and absent by default", () => {
  assert.equal(DEFAULT_CONFIG.spend, undefined);
  assert.doesNotThrow(() => assertConfig(withSpend()));
});

test("spend limits accept the bounds themselves", () => {
  for (const spend of [
    { perCallAusd: 1, perDayAusd: 1 },
    { perCallAusd: 1_000, perDayAusd: 10_000 },
    { perCallAusd: 2.5, perDayAusd: 25 },
  ]) {
    assert.doesNotThrow(() => assertConfig(withSpend(spend)), JSON.stringify(spend));
  }
});

test("spend limits outside 1–1000 a call or 1–10000 a day are refused", () => {
  for (const spend of [
    { perCallAusd: 0, perDayAusd: 10 },
    { perCallAusd: 0.99, perDayAusd: 10 },
    { perCallAusd: 1_000.01, perDayAusd: 10_000 },
    { perCallAusd: 1, perDayAusd: 0 },
    { perCallAusd: 1, perDayAusd: 10_001 },
    { perCallAusd: Number.NaN, perDayAusd: 10 },
    { perCallAusd: 5, perDayAusd: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () => assertConfig(withSpend(spend)),
      { code: "INVALID_INPUT" },
      JSON.stringify(spend),
    );
  }
});

test("a day's cap below one call's is refused", () => {
  assert.throws(() => assertConfig(withSpend({ perCallAusd: 50, perDayAusd: 49 })), {
    code: "INVALID_INPUT",
  });
  assert.doesNotThrow(() => assertConfig(withSpend({ perCallAusd: 50, perDayAusd: 50 })));
});

test("spend limits are not enforced yet, and say so", () => {
  assert.equal(SPEND_ENFORCED, false);
});
