import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BRIEF,
  STARTER_CAPS,
  prepareDraft,
  type CreateDraftInput,
} from "../src/features/studio/create.js";
import { reviseDraft } from "../src/features/studio/revise.js";

const input: CreateDraftInput = {
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: DEFAULT_BRIEF,
  caps: STARTER_CAPS,
  walletId: "w",
};

test("a brief revision normalizes like create and keeps everything else", () => {
  const { config } = prepareDraft(input);
  const next = reviseDraft(config, {
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
  const on = reviseDraft(config, { sources: { web: { mode: "prefer", sites: ["coindesk.com"] } } });
  assert.ok(on.plugins?.enabled.includes("exa"));
  assert.ok(on.tools.includes("searchWeb") && on.tools.includes("readPage"));
  const off = reviseDraft(on, { sources: { web: null } });
  assert.ok(!off.plugins?.enabled.includes("exa"));
  assert.ok(!off.tools.includes("searchWeb"));
});

test("caps keep create's bounds", () => {
  const { config } = prepareDraft(input);
  assert.deepEqual(
    reviseDraft(config, { caps: { perTradeAusd: 10, perDayAusd: 40, maxLeverage: 2 } }).spend,
    { perCallAusd: 10, perDayAusd: 40 },
  );
  assert.throws(() =>
    reviseDraft(config, { caps: { perTradeAusd: 50, perDayAusd: 10, maxLeverage: 1 } }),
  );
  assert.throws(() =>
    reviseDraft(config, { caps: { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 99 } }),
  );
});

test("an unknown voice is refused; a known one is set", () => {
  const { config } = prepareDraft(input);
  assert.equal(reviseDraft(config, { voice: "hype" }).voice, "hype");
  assert.throws(() => reviseDraft(config, { voice: "loud" as never }), /voice/i);
});

test("an empty patch is the same config", () => {
  const { config } = prepareDraft(input);
  assert.deepEqual(reviseDraft(config, {}), config);
});
