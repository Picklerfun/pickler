import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BRIEF,
  STARTER_CAPS,
  prepareDraft,
  type CreateDraftInput,
} from "../src/features/studio/create.js";
import { reviseSetup, type SetupPatch } from "../src/features/studio/revise.js";
import { setupChangeSummary } from "../src/features/studio/setup-summary.js";

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
const { config } = prepareDraft(input);
const brief = {
  thesis: DEFAULT_BRIEF.thesis,
  entersWhen: [...DEFAULT_BRIEF.entersWhen],
  exitsWhen: [...DEFAULT_BRIEF.exitsWhen],
  never: [...DEFAULT_BRIEF.never],
};
const summary = (patch: SetupPatch, from = config) =>
  setupChangeSummary(from, reviseSetup(from, patch));

test("a changed thesis", () => {
  assert.equal(summary({ brief: { ...brief, thesis: "BTC moves first" } }), "Thesis changed");
});

test("a changed, an added and a removed line name their section and number", () => {
  const [first, , third] = brief.entersWhen;
  assert.equal(
    summary({ brief: { ...brief, entersWhen: [first!, "Something else", third!] } }),
    "Entry 2 changed",
  );
  assert.equal(
    summary({ brief: { ...brief, exitsWhen: [...brief.exitsWhen.slice(0, 2)] } }, config),
    "Exit 3 removed",
  );
  const twoExits = reviseSetup(config, {
    brief: { ...brief, exitsWhen: brief.exitsWhen.slice(0, 2) },
  });
  assert.equal(summary({ brief }, twoExits), "Exit 3 added");
  assert.equal(
    summary({ brief: { ...brief, never: [brief.never[0]!, brief.never[2]!] } }),
    "Never 2 removed",
  );
  // A line put in the middle is one added line, not every later line changed.
  const [a, b, c] = brief.never;
  assert.equal(summary({ brief: { ...brief, never: [a!, "New line", b!, c!] } }), "Never 2 added");
});

test("several changes are joined, with a capital only on the first", () => {
  assert.equal(
    summary({
      brief: { ...brief, thesis: "BTC moves first", entersWhen: [...brief.entersWhen, "One more"] },
    }),
    "Thesis changed · entry 4 added",
  );
  const twoEntries = reviseSetup(config, {
    brief: { ...brief, entersWhen: brief.entersWhen.slice(0, 2) },
  });
  assert.equal(
    summary({ brief: { ...brief, thesis: "BTC moves first" } }, twoEntries),
    "Thesis changed · entry 3 added",
  );
});

test("caps name the numbers, with risk only when the config has it", () => {
  assert.equal(
    summary({ caps: { perTradeAusd: 25, perDayAusd: 100, maxLeverage: 3 } }),
    "Caps 25 / 100 / 3×",
  );
  assert.equal(
    summary({
      caps: {
        perTradeAusd: 25,
        perDayAusd: 100,
        maxLeverage: 3,
        maxOpenPositions: 3,
        dayLossStopAusd: 20,
      },
    }),
    "Caps 25 / 100 / 3× · 3 open · −20 day-loss",
  );
  // Only risk changed: the caps are still named whole.
  assert.equal(
    summary({ caps: { ...STARTER_CAPS, maxOpenPositions: 2, dayLossStopAusd: 15 } }),
    "Caps 5 / 20 / 1× · 2 open · −15 day-loss",
  );
});

test("sources and voice", () => {
  assert.equal(
    summary({ sources: { web: { mode: "prefer", sites: ["coindesk.com"] } } }),
    "Sources changed",
  );
  assert.equal(summary({ voice: "hype" }), "Voice · Hype");
  assert.equal(
    summary({ voice: "trash_talker", sources: { web: { mode: "anywhere", sites: [] } } }),
    "Sources changed · voice · Trash talker",
  );
});

test("how it enters", () => {
  assert.equal(
    summary({ entry: { mode: "auto", meanwhile: "wait", smallAusd: 5 } }),
    "Enters on its own",
  );
  assert.equal(
    summary({ entry: { mode: "approve", meanwhile: "wait", smallAusd: 5 } }),
    "Asks before entering",
  );
  assert.equal(
    summary({
      caps: { perTradeAusd: 25, perDayAusd: 100, maxLeverage: 3 },
      entry: { mode: "approve", meanwhile: "small", smallAusd: 10 },
    }),
    "Caps 25 / 100 / 3× · goes in at 10 while you decide",
  );
});

test("nothing changed", () => {
  assert.equal(setupChangeSummary(config, config), "No change");
  assert.equal(summary({}), "No change");
  assert.equal(summary({ brief, caps: STARTER_CAPS, voice: "analyst" }), "No change");
});

test("a long summary is cut to 200 characters", () => {
  const lines = (tag: string) => Array.from({ length: 8 }, (_, i) => `${tag} ${i}`);
  const text = summary({
    brief: {
      thesis: "Everything is different",
      entersWhen: lines("enter"),
      exitsWhen: lines("exit"),
      never: lines("never"),
    },
  });
  assert.equal(text.length, 200);
  assert.ok(text.startsWith("Thesis changed · entry 1 changed"));
});
