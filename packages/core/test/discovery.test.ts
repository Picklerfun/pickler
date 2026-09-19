import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketExclusion,
  publicSourceUrl,
  type Market,
  type DiscoveryPolicy,
} from "../src/index.ts";
const now = Date.parse("2026-09-17T12:00:00Z");
const policy: DiscoveryPolicy = {
  version: 1,
  mode: "pre-event",
  minLeadMinutes: 15,
  maxHorizonDays: 7,
};
const market: Market = {
  id: "1",
  question: "Fixture",
  rules: "Rules",
  categoryIds: ["1"],
  active: true,
  closesAt: new Date(now + 8 * 86400000).toISOString(),
  startsAt: new Date(now + 3600000).toISOString(),
  timingSource: "polymarket.gameStartTime",
  sportsMarketType: "moneyline",
  liquidity: 1,
  outcomes: [],
};
test("pre-event eligibility uses start provenance and inclusive lead/horizon boundaries", () => {
  for (const [offset, expected] of [
    [0, "EVENT_STARTED_OR_TOO_SOON"],
    [899999, "EVENT_STARTED_OR_TOO_SOON"],
    [900000, null],
    [7 * 86400000, null],
    [7 * 86400000 + 1, "EVENT_OUTSIDE_HORIZON"],
  ] as const) {
    assert.equal(
      marketExclusion({ ...market, startsAt: new Date(now + offset).toISOString() }, now, policy),
      expected,
    );
  }
  assert.equal(marketExclusion({ ...market, startsAt: null }, now, policy), "UNKNOWN_EVENT_TIME");
  assert.equal(
    marketExclusion({ ...market, timingSource: "endDate" }, now, policy),
    "UNKNOWN_EVENT_TIME",
  );
  assert.equal(
    marketExclusion({ ...market, sportsMarketType: "season-winner" }, now, policy),
    "SEASON_MARKET",
  );
  assert.equal(marketExclusion({ ...market, startsAt: null }, now), null);
});
test("only exact normalized public HTTP resources can be granted", () => {
  assert.equal(publicSourceUrl("https://Example.com/rules#section"), "https://example.com/rules");
  for (const value of [
    "https://user:pass@example.com",
    "http://localhost",
    "http://localhost./",
    "http://127.0.0.1",
    "http://2130706433",
    "http://10.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://service.internal",
    "http://internal",
    "file:///etc/passwd",
    "https://example.com:1234",
  ]) {
    assert.equal(publicSourceUrl(value), null, value);
  }
});
