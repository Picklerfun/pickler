import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS as CORE_ACCENTS,
  VENUES as CORE_VENUES,
  SPORTSBOOKS as CORE_SPORTSBOOKS,
  BRIEF_LIMITS as CORE_BRIEF_LIMITS,
  LEVERAGE_BOUNDS as CORE_LEVERAGE_BOUNDS,
  normalizeBrief,
  briefToConfig,
  VOICES as CORE_VOICES,
  DEFAULT_BRIEF as CORE_DEFAULT_BRIEF,
  STARTER_CAPS as CORE_STARTER_CAPS,
  VOICE_KEYS as CORE_VOICE_KEYS,
  prepareDraft,
} from "@pickler/core";
import { PAPER_BUDGET_AUSD as TRADING_PAPER_BUDGET_AUSD } from "@pickler/trading/polymarket";
import {
  ACCENTS,
  VENUES,
  SPORTSBOOKS,
  sourcesSchema,
  BRIEF_LIMITS,
  LEVERAGE_BOUNDS,
  agentBriefSchema,
  agentConfigSchema,
  previewRunRequestSchema,
  draftCreateSchema,
  PAPER_BUDGET_AUSD,
  VOICE_KEYS,
} from "@pickler/api-schema";

/* api-schema may not import core, so it carries its own copy of each list. This is the one place
   that may hold both, so it is where a value added to one and not the other fails. */
test("the accent and venue lists in api-schema are core's lists", () => {
  assert.deepEqual(ACCENTS, CORE_ACCENTS);
  assert.deepEqual(VENUES, CORE_VENUES);
});
test("the sportsbooks in api-schema are core's, and the schema accepts exactly their keys", () => {
  const anywhere = { mode: "anywhere", sites: [] };

  assert.deepEqual(SPORTSBOOKS, CORE_SPORTSBOOKS);
  for (const book of CORE_SPORTSBOOKS) {
    assert.doesNotThrow(() => sourcesSchema.parse({ web: anywhere, books: [book.key] }));
  }
  assert.throws(() => sourcesSchema.parse({ web: anywhere, books: ["DraftKings"] }));
  assert.throws(() => sourcesSchema.parse({ web: anywhere, books: ["bovada"] }));
});
test("the brief's limits and the leverage bounds in api-schema are core's", () => {
  assert.deepEqual(BRIEF_LIMITS, CORE_BRIEF_LIMITS);
  assert.deepEqual(LEVERAGE_BOUNDS, CORE_LEVERAGE_BOUNDS);
});
test("a brief core normalized, at every limit, is a stored brief", () => {
  const brief = normalizeBrief({
    thesis: "x".repeat(CORE_BRIEF_LIMITS.thesis),
    reads: Array.from({ length: CORE_BRIEF_LIMITS.reads }, (_, i) => `site${i}.com`),
    entersWhen: Array.from({ length: CORE_BRIEF_LIMITS.entersWhen }, () => "y".repeat(200)),
    exitsWhen: [],
    never: [" padded "],
  });
  assert.doesNotThrow(() => agentBriefSchema.parse(brief));
  assert.throws(() => agentBriefSchema.parse({ ...brief, entersWhen: [] }));
});
test("a brief's config is a valid wire config", () => {
  const config = briefToConfig({
    brief: { thesis: "", reads: ["espn.com"], entersWhen: ["x"], exitsWhen: [], never: [] },
    spend: { perCallAusd: 5, perDayAusd: 20 },
    maxLeverage: 2,
  });
  assert.doesNotThrow(() => agentConfigSchema.parse(config));
});
test("the preview request leaves lengths to core", () => {
  const request = {
    brief: { thesis: "x".repeat(700), reads: [], entersWhen: [], exitsWhen: [], never: [] },
    spend: { perCallAusd: 5, perDayAusd: 20 },
    maxLeverage: 2,
  };
  assert.doesNotThrow(() => previewRunRequestSchema.parse(request));
});
test("the draft request's voices are core's, and core's starting draft is a valid request", () => {
  assert.deepEqual(
    draftCreateSchema.shape.voice.options,
    CORE_VOICES.map((voice) => voice.key),
  );
  assert.deepEqual(draftCreateSchema.shape.avatar.shape.accent.options, CORE_ACCENTS);
  const request = {
    name: "Halftime",
    handle: "halftime",
    voice: "analyst",
    avatar: { accent: "lime", pattern: 0 },
    sources: { web: null },
    brief: CORE_DEFAULT_BRIEF,
    caps: CORE_STARTER_CAPS,
    walletId: "wal-agent",
  };
  assert.doesNotThrow(() => draftCreateSchema.parse(request));
  assert.throws(() => draftCreateSchema.parse({ ...request, handle: "Half Time" }));
  assert.throws(() =>
    draftCreateSchema.parse({ ...request, previewRunId: "0000000a-0000-4000-8000-000000000000" }),
  );
});

test("api-schema's voice keys are core's", () => {
  assert.deepEqual([...VOICE_KEYS], [...CORE_VOICE_KEYS]);
});

/* A created draft is read back through agentConfigSchema on every GET /agents and in the create
   answer itself. A config field core writes that the strict schema does not know (voice, once)
   breaks the whole studio after the first create, so the real prepareDraft output is parsed here,
   web on and off. */
test("every config prepareDraft writes is a config the agent responses accept", () => {
  for (const web of [null, { mode: "prefer" as const, sites: ["coindesk.com"] }]) {
    const { config } = prepareDraft({
      name: "Halftime",
      handle: "halftime",
      voice: "analyst",
      avatar: { accent: "lime", pattern: 0 },
      sources: { web },
      brief: CORE_DEFAULT_BRIEF,
      caps: CORE_STARTER_CAPS,
      walletId: "wal-agent",
    });
    const parsed = agentConfigSchema.safeParse(config);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  }
});

test("the paper budget in api-schema is trading's", () => {
  assert.equal(PAPER_BUDGET_AUSD, TRADING_PAPER_BUDGET_AUSD);
});
