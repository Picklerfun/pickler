import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_PATTERNS,
  DEFAULT_BRIEF,
  DRAFT_PROFILE,
  MIN_START_MICRO_AUSD,
  MIN_START_MON_WEI,
  STARTER_CAPS,
  VOICES,
  WalletUnderfundedError,
  fundingShortfall,
  prepareDraft,
  type CreateDraftInput,
} from "../src/features/studio/create.js";
import {
  BriefError,
  PilotError,
  VOICE_KEYS,
  assertConfig,
} from "../src/features/research/types.js";

const input = (patch: Partial<CreateDraftInput> = {}): CreateDraftInput => ({
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: { ...DEFAULT_BRIEF },
  caps: { ...STARTER_CAPS },
  walletId: "wal-agent",
  ...patch,
});

test("there are six voices, keyed and named as the canvas names them", () => {
  assert.deepEqual(
    VOICES.map((voice) => voice.name),
    ["Analyst", "Contrarian", "Trash talker", "Deadpan", "Hype", "Professor"],
  );
});

test("the voices carry the keys assertConfig accepts, in order", () => {
  assert.deepEqual(
    VOICES.map((voice) => voice.key),
    [...VOICE_KEYS],
  );
});

test("there are six avatar patterns of sixteen cells each", () => {
  assert.equal(AVATAR_PATTERNS.length, 6);
  assert.ok(AVATAR_PATTERNS.every((pattern) => /^[01]{16}$/.test(pattern)));
});

test("the starter caps are 5 per trade, 20 per day and 1×", () => {
  assert.deepEqual(STARTER_CAPS, { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 });
});

test("the minimums to start are 10 AUSD and 0.5 MON in base units", () => {
  assert.equal(MIN_START_MICRO_AUSD, 10_000_000n);
  assert.equal(MIN_START_MON_WEI, 500_000_000_000_000_000n);
});

test("a draft's config is a valid Perpl paper config with the brief, caps and voice", () => {
  const { config } = prepareDraft(input());
  assertConfig(config);
  assert.deepEqual(config.perpl, { version: 1, network: "testnet", markets: ["BTC", "ETH"] });
  assert.deepEqual(config.plugins, { version: 1, enabled: ["perpl", "perps-paper"] });
  assert.deepEqual(config.spend, { perCallAusd: 5, perDayAusd: 20 });
  assert.equal(config.maxLeverage, 1);
  assert.equal(config.voice, "analyst");
  assert.deepEqual(config.brief?.reads, []);
});

test("the web on adds Exa, its tools and its sites", () => {
  const { config } = prepareDraft(
    input({ sources: { web: { mode: "prefer", sites: ["coindesk.com"] } } }),
  );
  assert.deepEqual(config.plugins?.enabled, ["perpl", "perps-paper", "exa"]);
  assert.ok(config.tools.includes("searchWeb"));
  assert.deepEqual(config.sources?.web, { mode: "prefer", sites: ["coindesk.com"] });
});

test("the web off is null in sources and no Exa tool", () => {
  const { config } = prepareDraft(input());
  assert.equal(config.sources?.web, null);
  assert.ok(!config.tools.includes("searchWeb"));
});

test("the profile carries the accent, the pattern and the voice's name", () => {
  const { profile } = prepareDraft(
    input({ voice: "trash_talker", avatar: { accent: "blue", pattern: 3 } }),
  );
  assert.deepEqual(profile, { accent: "blue", avatarPattern: 3, voice: "Trash talker" });
});

test("an unknown voice is refused", () => {
  assert.throws(
    () => prepareDraft(input({ voice: "loud" as never })),
    (error: unknown) => error instanceof PilotError && error.code === "INVALID_INPUT",
  );
});

const invalid = (error: unknown) =>
  error instanceof PilotError && !(error instanceof BriefError) && error.code === "INVALID_INPUT";

test("a pattern outside 0 to 5 is refused", () => {
  assert.throws(() => prepareDraft(input({ avatar: { accent: "lime", pattern: 6 } })), invalid);
});

test("a pattern of 1.5 or -1 is refused", () => {
  for (const pattern of [1.5, -1]) {
    assert.throws(() => prepareDraft(input({ avatar: { accent: "lime", pattern } })), invalid);
  }
});

test("an unknown accent is refused", () => {
  assert.throws(
    () => prepareDraft(input({ avatar: { accent: "teal" as never, pattern: 0 } })),
    invalid,
  );
});

test("a brief with no entry rule is refused naming the section", () => {
  assert.throws(
    () => prepareDraft(input({ brief: { ...DEFAULT_BRIEF, entersWhen: [] } })),
    (error: unknown) => error instanceof BriefError && error.field === "entersWhen",
  );
});

test("a day's cap below a trade's is refused", () => {
  assert.throws(
    () => prepareDraft(input({ caps: { perTradeAusd: 10, perDayAusd: 5, maxLeverage: 1 } })),
    invalid,
  );
});

test("leverage above 10 is refused", () => {
  assert.throws(() => prepareDraft(input({ caps: { ...STARTER_CAPS, maxLeverage: 11 } })), invalid);
});

test("'only' with no sites is refused", () => {
  assert.throws(
    () => prepareDraft(input({ sources: { web: { mode: "only", sites: [] } } })),
    invalid,
  );
});

test("a draft's profile is the Perpl one, not the prediction-market default", () => {
  assert.equal(prepareDraft(input()).config.profile, DRAFT_PROFILE);
});

test("enough of both is no shortfall", () => {
  assert.equal(
    fundingShortfall({ ausdMicro: MIN_START_MICRO_AUSD, monWei: MIN_START_MON_WEI }),
    null,
  );
});

test("too little MON is a shortfall naming both balances and both minimums", () => {
  assert.deepEqual(fundingShortfall({ ausdMicro: 25_000_000n, monWei: 1n }), {
    ausdMicro: "25000000",
    monWei: "1",
    minAusdMicro: "10000000",
    minMonWei: "500000000000000000",
  });
});

test("a balance that could not be read is a shortfall, never enough", () => {
  assert.notEqual(fundingShortfall({ ausdMicro: null, monWei: MIN_START_MON_WEI }), null);
});

test("WalletUnderfundedError carries the shortfall and the code", () => {
  const shortfall = fundingShortfall({ ausdMicro: 0n, monWei: 0n })!;
  const error = new WalletUnderfundedError(shortfall);
  assert.equal(error.code, "WALLET_UNDERFUNDED");
  assert.deepEqual(error.detail, shortfall);
  assert.equal(error.message, "Fund its wallet with at least 10 AUSD and 0.5 MON first");
});
