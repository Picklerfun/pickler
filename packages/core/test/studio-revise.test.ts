import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BRIEF,
  STARTER_CAPS,
  prepareDraft,
  type CreateDraftInput,
} from "../src/features/studio/create.js";
import { reviseSetup } from "../src/features/studio/revise.js";
import {
  ENTRY_DEFAULTS,
  PilotError,
  RISK_BOUNDS,
  RISK_DEFAULTS,
  effectiveEntry,
  effectiveRisk,
} from "../src/features/research/types.js";

const invalid = (error: unknown) => error instanceof PilotError && error.code === "INVALID_INPUT";

const input: CreateDraftInput = {
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: DEFAULT_BRIEF,
  caps: STARTER_CAPS,
  markets: ["BTC", "ETH"],
  walletId: "w",
};

test("a brief revision normalizes like create and keeps everything else", () => {
  const { config } = prepareDraft(input);
  const next = reviseSetup(config, {
    brief: { thesis: "  BTC moves first ", entersWhen: [" a ", ""], exitsWhen: [], never: [] },
  });
  assert.equal(next.brief?.thesis, "BTC moves first");
  assert.deepEqual(next.brief?.entersWhen, ["a"]);
  assert.deepEqual(next.perpl, config.perpl);
  assert.equal(next.voice, config.voice);
  assert.equal("marketScope" in next, "marketScope" in config);
});

test("turning the web on adds exa and the web tools; off removes them", () => {
  const { config } = prepareDraft(input);
  const on = reviseSetup(config, { sources: { web: { mode: "prefer", sites: ["coindesk.com"] } } });
  assert.ok(on.plugins?.enabled.includes("exa"));
  assert.ok(on.tools.includes("searchWeb") && on.tools.includes("readPage"));
  const off = reviseSetup(on, { sources: { web: null } });
  assert.ok(!off.plugins?.enabled.includes("exa"));
  assert.ok(!off.tools.includes("searchWeb"));
  assert.ok(!off.tools.includes("readPage"));
  // The config it was given is never changed.
  assert.ok(on.plugins?.enabled.includes("exa"));
});

test("caps keep create's bounds", () => {
  const { config } = prepareDraft(input);
  assert.deepEqual(
    reviseSetup(config, { caps: { perTradeAusd: 10, perDayAusd: 40, maxLeverage: 2 } }).spend,
    { perCallAusd: 10, perDayAusd: 40 },
  );
  assert.throws(() =>
    reviseSetup(config, { caps: { perTradeAusd: 50, perDayAusd: 10, maxLeverage: 1 } }),
  );
  assert.throws(() =>
    reviseSetup(config, { caps: { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 99 } }),
  );
});

test("an unknown voice is refused; a known one is set", () => {
  const { config } = prepareDraft(input);
  assert.equal(reviseSetup(config, { voice: "hype" }).voice, "hype");
  assert.throws(() => reviseSetup(config, { voice: "loud" as never }), /voice/i);
});

test("an empty patch is the same config", () => {
  const { config } = prepareDraft(input);
  assert.deepEqual(reviseSetup(config, {}), config);
});

test("caps with the two new fields write risk; without them risk stays as it was", () => {
  const { config } = prepareDraft(input);
  const caps = { perTradeAusd: 25, perDayAusd: 100, maxLeverage: 3 };
  const next = reviseSetup(config, { caps: { ...caps, maxOpenPositions: 3, dayLossStopAusd: 20 } });
  assert.deepEqual(next.risk, { maxOpenPositions: 3, dayLossStopAusd: 20 });
  assert.deepEqual(next.spend, { perCallAusd: 25, perDayAusd: 100 });
  assert.equal(next.maxLeverage, 3);
  assert.equal("risk" in reviseSetup(config, { caps }), false);
  assert.deepEqual(reviseSetup(next, { caps }).risk, next.risk);
  // One of the two alone keeps the other where it was (the default, for a config without risk).
  assert.deepEqual(reviseSetup(config, { caps: { ...caps, maxOpenPositions: 4 } }).risk, {
    maxOpenPositions: 4,
    dayLossStopAusd: RISK_DEFAULTS.dayLossStopAusd,
  });
  assert.deepEqual(reviseSetup(next, { caps: { ...caps, dayLossStopAusd: 50 } }).risk, {
    maxOpenPositions: 3,
    dayLossStopAusd: 50,
  });
});

test("risk outside its bounds is INVALID_INPUT", () => {
  const { config } = prepareDraft(input);
  const caps = { perTradeAusd: 25, perDayAusd: 100, maxLeverage: 3 };
  for (const maxOpenPositions of [0, 7, 1.5]) {
    assert.throws(
      () => reviseSetup(config, { caps: { ...caps, maxOpenPositions, dayLossStopAusd: 20 } }),
      invalid,
    );
  }
  for (const dayLossStopAusd of [4, 205, 12, 0]) {
    assert.throws(
      () => reviseSetup(config, { caps: { ...caps, maxOpenPositions: 3, dayLossStopAusd } }),
      invalid,
    );
  }
  for (const edge of [
    { maxOpenPositions: 1, dayLossStopAusd: 5 },
    { maxOpenPositions: 6, dayLossStopAusd: 200 },
  ]) {
    assert.deepEqual(reviseSetup(config, { caps: { ...caps, ...edge } }).risk, edge);
  }
});

test("entry is stored as sent, bounded by the per-trade cap", () => {
  const { config } = prepareDraft(input);
  const roomy = reviseSetup(config, {
    caps: { perTradeAusd: 25, perDayAusd: 100, maxLeverage: 3 },
  });
  const entry = { mode: "approve", meanwhile: "small", smallAusd: 10 } as const;
  assert.deepEqual(reviseSetup(roomy, { entry }).entry, entry);
  // No normalization: auto keeps the meanwhile and the amount it was sent.
  const auto = { mode: "auto", meanwhile: "wait", smallAusd: 7 } as const;
  assert.deepEqual(reviseSetup(roomy, { entry: auto }).entry, auto);
  // The starter per-trade cap is 5: 10 is above it, unless the same patch raises the cap.
  assert.throws(() => reviseSetup(config, { entry }), invalid);
  assert.deepEqual(
    reviseSetup(config, {
      entry,
      caps: { perTradeAusd: 10, perDayAusd: 40, maxLeverage: 1 },
    }).entry,
    entry,
  );
  assert.throws(
    () => reviseSetup(roomy, { entry, caps: { perTradeAusd: 9, perDayAusd: 40, maxLeverage: 1 } }),
    invalid,
  );
  assert.throws(() => reviseSetup(roomy, { entry: { ...entry, smallAusd: 0.5 } }), invalid);
  assert.throws(() => reviseSetup(roomy, { entry: { ...entry, smallAusd: Number.NaN } }), invalid);
  assert.throws(() => reviseSetup(roomy, { entry: { ...entry, mode: "yolo" as never } }), invalid);
  assert.throws(
    () => reviseSetup(roomy, { entry: { ...entry, meanwhile: "big" as never } }),
    invalid,
  );
  // An entry patch leaves the caps and risk alone.
  assert.deepEqual(reviseSetup(roomy, { entry }).spend, roomy.spend);
  assert.equal("risk" in reviseSetup(roomy, { entry }), false);
});

test("the risk and entry bounds and defaults are the spec's", () => {
  assert.deepEqual(RISK_BOUNDS, {
    maxOpenPositions: { min: 1, max: 6 },
    dayLossStopAusd: { min: 5, max: 200, step: 5 },
  });
  assert.deepEqual(RISK_DEFAULTS, { maxOpenPositions: 1, dayLossStopAusd: 10 });
  assert.deepEqual(ENTRY_DEFAULTS, { mode: "approve", meanwhile: "wait", smallAusd: 5 });
});

test("effective risk and entry are the stored value, or the defaults", () => {
  const { config } = prepareDraft(input);
  assert.deepEqual(effectiveRisk(config), RISK_DEFAULTS);
  assert.deepEqual(effectiveEntry(config), ENTRY_DEFAULTS);
  const set = reviseSetup(config, {
    caps: {
      perTradeAusd: 25,
      perDayAusd: 100,
      maxLeverage: 3,
      maxOpenPositions: 3,
      dayLossStopAusd: 20,
    },
    entry: { mode: "approve", meanwhile: "small", smallAusd: 10 },
  });
  assert.deepEqual(effectiveRisk(set), { maxOpenPositions: 3, dayLossStopAusd: 20 });
  assert.deepEqual(effectiveEntry(set), { mode: "approve", meanwhile: "small", smallAusd: 10 });
  // The default 5 is clamped to a smaller per-trade cap, and so is a stored amount the cap has
  // since dropped under (PUT /limits writes spend alone).
  const tight = { ...config, spend: { perCallAusd: 2, perDayAusd: 20 } };
  assert.deepEqual(effectiveEntry(tight), { ...ENTRY_DEFAULTS, smallAusd: 2 });
  assert.equal(effectiveEntry({ ...set, spend: { perCallAusd: 4, perDayAusd: 20 } }).smallAusd, 4);
  // What it returns is its own copy: the defaults are never handed out to be changed.
  assert.notEqual(effectiveRisk(config), RISK_DEFAULTS);
  assert.notEqual(effectiveEntry(config), ENTRY_DEFAULTS);
});

test("explicit dynamic selection upgrades only the edited agent and preserves the original", () => {
  const created = prepareDraft({ ...input, markets: ["SOL", "MON"] }, "mainnet").config;
  assert.deepEqual(created.perpl, { version: 2, network: "mainnet", markets: ["SOL", "MON"] });
  assert.deepEqual(created.perpsStrategy, { id: "combined", version: "2.1.0" });
  const legacy = {
    ...created,
    perpl: { version: 1 as const, network: "testnet" as const, markets: ["BTC" as const] },
    perpsStrategy: { id: "deepseek" as const, version: "2.0.0" as const },
  };
  assert.deepEqual(reviseSetup(legacy, { voice: "hype" }).perpl, legacy.perpl);
  const next = reviseSetup(legacy, { markets: ["SOL"] });
  assert.deepEqual(next.perpl, { version: 2, network: "testnet", markets: ["SOL"] });
  assert.deepEqual(next.perpsStrategy, { id: "deepseek", version: "2.1.0" });
  assert.deepEqual(legacy.perpl.markets, ["BTC"]);
  assert.throws(() => prepareDraft({ ...input, markets: [] }), invalid);
  assert.throws(() => reviseSetup(legacy, { markets: ["SOL", "SOL"] }), invalid);
});
