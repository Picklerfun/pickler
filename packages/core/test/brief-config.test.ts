import { test } from "node:test";
import assert from "node:assert/strict";
import { briefToConfig, classifyRead } from "../src/features/studio/brief-config.js";
import { assertConfig, MAX_SITES, type AgentBrief } from "../src/features/research/types.js";
import { effectivePlugins } from "../src/features/research/plugins.js";

const brief: AgentBrief = {
  thesis: "Injury news moves the books first.",
  reads: ["https://www.espn.com/nfl/injuries", "nfl.com", "@AdamSchefter", "the Thursday report"],
  entersWhen: ["A starter is ruled out"],
  exitsWhen: [],
  never: [],
};
const spend = { perCallAusd: 5, perDayAusd: 20 };

test("a URL or a bare domain is a site; an @account and anything else is not yet read", () => {
  assert.deepEqual(classifyRead("https://www.espn.com/nfl/injuries"), {
    kind: "site",
    host: "espn.com",
  });
  assert.deepEqual(classifyRead("NFL.com/news"), { kind: "site", host: "nfl.com" });
  assert.deepEqual(classifyRead("rotowire.com"), { kind: "site", host: "rotowire.com" });
  assert.deepEqual(classifyRead("@AdamSchefter"), { kind: "account" });
  assert.deepEqual(classifyRead("the Thursday injury report"), { kind: "feed" });
  assert.deepEqual(classifyRead("http://localhost:3000"), { kind: "feed" });
});

test("the config is valid, scoped to sports, and carries the brief, the caps and the leverage", () => {
  const config = briefToConfig({ brief, spend, maxLeverage: 2 });
  assert.doesNotThrow(() => assertConfig(config));
  assert.equal(config.categoryIds, undefined);
  assert.deepEqual(config.marketScope, { version: 1, category: "sports", subcategories: "all" });
  assert.deepEqual(config.brief, brief);
  assert.notEqual(config.brief, brief);
  assert.deepEqual(config.spend, spend);
  assert.equal(config.maxLeverage, 2);
  assert.ok(effectivePlugins(config).enabled.includes("paper-trading"));
});

test("sites become a preferred web allow-list, once each", () => {
  const config = briefToConfig({
    brief: { ...brief, reads: [...brief.reads, "espn.com"] },
    spend,
    maxLeverage: 2,
  });
  assert.deepEqual(config.sources?.web, { mode: "prefer", sites: ["espn.com", "nfl.com"] });
});

test("with no site it searches anywhere", () => {
  const config = briefToConfig({
    brief: { ...brief, reads: ["@AdamSchefter"] },
    spend,
    maxLeverage: 2,
  });
  assert.deepEqual(config.sources?.web, { mode: "anywhere", sites: [] });
});

test("never more sites than the allow-list holds", () => {
  const reads = Array.from({ length: 12 }, (_, i) => `site${i}.com`);
  const config = briefToConfig({ brief: { ...brief, reads }, spend, maxLeverage: 2 });
  assert.ok((config.sources?.web?.sites.length ?? 0) <= MAX_SITES);
});

test("an X or Twitter link is an account, never a site to search", () => {
  for (const line of [
    "https://x.com/AdamSchefter",
    "https://www.twitter.com/AdamSchefter/status/1",
    "https://mobile.twitter.com/AdamSchefter",
    "x.com/AdamSchefter",
    "twitter.com/AdamSchefter",
  ]) {
    assert.deepEqual(classifyRead(line), { kind: "account" }, line);
  }
  const config = briefToConfig({
    brief: { ...brief, reads: ["https://x.com/AdamSchefter", "espn.com"] },
    spend,
    maxLeverage: 2,
  });
  assert.deepEqual(config.sources?.web, { mode: "prefer", sites: ["espn.com"] });
});
