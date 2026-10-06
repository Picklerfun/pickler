// apps/web/test/studio-live-model.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DirectoryAgentDto,
  LeaderboardDto,
  MarketDetailDto,
  PerpMarketDto,
  WalletsDto,
} from "@pickler/api-schema";
import {
  ENTRY_DEFAULTS,
  GAS_LOW_WEI,
  HELP_LINKS,
  LIVE_SECTIONS,
  MARKETS_FAILED_LINE,
  RISK_BOUNDS,
  RISK_DEFAULTS,
  abilities,
  boardHeader,
  boardRows,
  briefBar,
  delegationRows,
  directoryCards,
  entryView,
  fixTarget,
  headerParts,
  healthIssues,
  healthLabel,
  healthRows,
  isLiveSection,
  leaderRows,
  liveCaps,
  liveCapsStepper,
  liveEntry,
  liveRail,
  liveSectionLabel,
  liveStatus,
  liveTiles,
  liveWalletRead,
  liveWarnings,
  marketHealth,
  marketsView,
  meters,
  notifyRows,
  postsHeader,
  profileToggleRows,
  publicProfilePath,
  sinceLabel,
  sourceTag,
  stripView,
  studioKind,
  versionRows,
  walletCards,
  warningLine,
  watchedSymbols,
  type LiveCaps,
} from "../src/features/studio/live/model";
import { liveStudioFixture } from "../src/features/studio/live/fixture";
import {
  LIVE_STAGES,
  isDraftStage,
  isLiveStage,
  stageFromSearch,
} from "../src/features/studio/home/stage";

/* One behaviour per test: these are the rules the live studio's screens are. */

const MON = 1_000_000_000_000_000_000n;

const market = (overrides: Partial<PerpMarketDto> = {}): PerpMarketDto => ({
  symbol: "BTC-PERP",
  base: "BTC",
  accent: "amber",
  mark: 97420,
  change24h: 0.018,
  funding1h: 0.0000875,
  openInterest: 1,
  maxLeverage: 10,
  agentsReading: 7,
  openCalls: null,
  lastCall: null,
  note: "Deepest book.",
  hourlyReach: null,
  limits: { takerFee: 0, maintenanceMargin: 0, slippageCap: 0, minimumAccountOpen: 0 },
  source: {
    venue: "perpl",
    network: "testnet",
    observedAt: "2026-10-02T14:29:40.000Z",
    stale: false,
  },
  ...overrides,
});

const wallets = (ausdMicro: string | null, monWei: string | null): WalletsDto => ({
  master: { address: "0x7f3a", ausdMicro: "177600000", monWei: "3700000000000000000" },
  agents: [
    {
      walletId: "w",
      address: "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07",
      ausdMicro,
      monWei,
      agentId: "a",
      agentName: "Halftime",
      caps: null,
      policiesApproved: true,
    },
  ],
  readAt: 0,
});

const caps: LiveCaps = {
  perTradeAusd: 25,
  perDayAusd: 100,
  maxLeverage: 3,
  maxOpenPositions: 3,
  dayLossStopAusd: 20,
};

// ─── Which studio ──────────────────────────────────────────────────────────────────────────────

test("a draft opens the draft studio, a published Perpl agent the live one, others the legacy one", () => {
  assert.equal(studioKind({ draft: true, config: { perpl: {} } }), "draft");
  assert.equal(studioKind({ draft: true, config: {} }), "draft");
  assert.equal(studioKind({ draft: false, config: { perpl: {} } }), "live");
  assert.equal(studioKind({ draft: false, config: {} }), "legacy");
});

// ─── Rail, status, header ──────────────────────────────────────────────────────────────────────

test("the rail is RUN, BUILD, MARKETPLACE, YOU with every section once, the current one on", () => {
  const rail = liveRail("controls", { positions: 0, decisions: 0 });

  assert.deepEqual(
    rail.map((group) => group.title),
    ["RUN", "BUILD", "MARKETPLACE", "YOU"],
  );
  assert.deepEqual(
    rail.flatMap((group) => group.items.map((item) => item.key)),
    [...LIVE_SECTIONS],
  );
  assert.deepEqual(
    rail.flatMap((group) => group.items.filter((item) => item.on).map((item) => item.key)),
    ["controls"],
  );
});

test("Positions and Decisions carry a badge only above zero", () => {
  const items = (counts: { positions: number; decisions: number }) =>
    liveRail("overview", counts).flatMap((group) => group.items);

  assert.equal(
    items({ positions: 0, decisions: 0 }).some((item) => item.badge !== undefined),
    false,
  );
  const counted = items({ positions: 2, decisions: 1 });
  assert.equal(counted.find((item) => item.key === "positions")?.badge, 2);
  assert.equal(counted.find((item) => item.key === "decisions")?.badge, 1);
});

test("the marketplace items are titled with the canvas's subtitles; the others are not", () => {
  const items = liveRail("overview", { positions: 0, decisions: 0 }).flatMap((g) => g.items);

  assert.equal(items.find((item) => item.key === "leaders")?.title, "Who said the truth");
  assert.equal(items.find((item) => item.key === "brief")?.title, undefined);
  assert.equal(liveSectionLabel("skills"), "Sources & rules");
  assert.equal(liveSectionLabel("master"), "Wallets");
});

test("the rail's foot is Docs, Community and Support, and the public profile is the agent's page", () => {
  assert.deepEqual(
    HELP_LINKS.map((link) => link.href),
    ["https://docs.pickler.fun", "https://x.com/picklerfun", "mailto:support@pickler.fun"],
  );
  assert.equal(publicProfilePath("halftime"), "/agents/halftime");
  assert.equal(publicProfilePath(undefined), null);
});

test("a section key from the URL carries over only when the live studio has it", () => {
  assert.equal(isLiveSection("brief"), true);
  assert.equal(isLiveSection("skills"), true);
  assert.equal(isLiveSection("picks"), false);
  assert.equal(isLiveSection(undefined), false);
});

test("the status is PUBLIC · RUNS SOON, or PAUSED · EXITS ONLY with Resume", () => {
  assert.deepEqual(liveStatus({ paused: false }), {
    state: "public",
    label: "PUBLIC · RUNS SOON",
    tone: "good",
    action: "Pause entries",
  });
  assert.equal(liveStatus({ paused: true }).label, "PAUSED · EXITS ONLY");
  assert.equal(liveStatus({ paused: true }).action, "Resume");
});

test("public since counts day 1 on the day it went public, in UTC", () => {
  const published = "2026-10-01T09:40:00.000Z";

  assert.equal(sinceLabel(published, Date.UTC(2026, 9, 1, 23, 59)), "PUBLIC SINCE OCT 1 · DAY 1");
  assert.equal(sinceLabel(published, Date.UTC(2026, 9, 2, 14, 30)), "PUBLIC SINCE OCT 1 · DAY 2");
  assert.equal(sinceLabel(null, 0), "PUBLIC");
});

test("the header's line is the handle, the venue, since when and the section", () => {
  assert.deepEqual(
    headerParts({
      handle: "halftime",
      publishedAt: "2026-10-01T09:40:00.000Z",
      now: Date.UTC(2026, 9, 2, 14, 30),
      section: "skills",
    }),
    ["@HALFTIME", "PERPL · MONAD", "PUBLIC SINCE OCT 1 · DAY 2", "SOURCES & RULES"],
  );
});

test("the tiles: EQUITY is its wallet's AUSD, the rest read Soon", () => {
  const read = liveWalletRead(
    { walletId: "w", balanceAusd: 10 },
    wallets("75800000", "900000000000000000"),
  );
  const tiles = liveTiles(read, 100);

  assert.deepEqual(tiles[0], { label: "EQUITY · AUSD IN ITS WALLET", value: "75.8", soon: false });
  assert.deepEqual(
    tiles.slice(1).map((tile) => [tile.label, tile.value, tile.soon]),
    [
      ["TODAY · AUSD", "Soon", true],
      ["OPEN · POSITIONS", "Soon", true],
      ["PUT IN TODAY · OF 100 CAP", "Soon", true],
    ],
  );
});

test("before the wallets are read, EQUITY is the DTO's balance and MON is unknown", () => {
  const read = liveWalletRead({ walletId: "w", balanceAusd: 12.5 }, null);

  assert.deepEqual(read, { ausdMicro: 12_500_000n, monWei: null });
  assert.equal(liveTiles(null, 100)[0]?.value, "—");
});

test("the strip says no check has run, with no log", () => {
  assert.deepEqual(stripView(), {
    line: "No checks yet · it starts checking when the Perpl runtime opens",
    count: "0 CHECKS",
    log: [],
    more: "EVERY DECISION →",
  });
});

// ─── Warnings, health, meters ──────────────────────────────────────────────────────────────────

test("low gas and free AUSD below one trade are warnings, both fixed in Limits", () => {
  const warnings = liveWarnings({ ausdMicro: 18_000_000n, monWei: 120_000_000_000_000_000n }, 25);

  assert.deepEqual(
    warnings.map((warning) => warning.text),
    ["MON FOR GAS IS LOW · 0.12 LEFT", "FREE AUSD BELOW ONE TRADE · IT CAN EXIT BUT NOT ENTER"],
  );
  assert.equal(fixTarget(warnings), "limits");
  assert.equal(
    warningLine(warnings),
    "MON FOR GAS IS LOW · 0.12 LEFT · FREE AUSD BELOW ONE TRADE · IT CAN EXIT BUT NOT ENTER",
  );
});

test("enough gas and a trade's AUSD warn of nothing; an unread balance claims nothing", () => {
  assert.deepEqual(liveWarnings({ ausdMicro: 25_000_000n, monWei: GAS_LOW_WEI }, 25), []);
  assert.deepEqual(liveWarnings({ ausdMicro: null, monWei: null }, 25), []);
  assert.deepEqual(liveWarnings(null, 25), []);
  assert.equal(fixTarget([]), null);
});

test("health reads the market data, sources, gas, credits Soon and the brief", () => {
  const rows = healthRows({
    market: "sample",
    sourcesOn: 2,
    monWei: MON / 10n,
    version: 4,
  });

  assert.deepEqual(
    rows.map((row) => [row.label, row.value, row.tone]),
    [
      ["Perpl · market data", "SAMPLE DATA", "caution"],
      ["Sources", "2 ON", "good"],
      ["Gas · MON", "0.1 · LOW", "caution"],
      ["AI credits", "Soon", "quiet"],
      ["Brief", "v4 · APPLIED", "good"],
    ],
  );
  assert.equal(healthLabel(0), "ALL GOOD");
  assert.equal(healthLabel(2), "2 TO FIX");
});

test("HEALTH's tag counts the warnings and every bad row: Perpl unreachable is one to fix", () => {
  const reachable = healthRows({ market: "connected", sourcesOn: 1, monWei: MON, version: 1 });
  const unreachable = healthRows({ market: "unreachable", sourcesOn: 1, monWei: MON, version: 1 });
  const lowGas = healthRows({ market: "connected", sourcesOn: 1, monWei: MON / 10n, version: 1 });

  assert.equal(healthIssues(0, reachable), 0);
  assert.equal(healthLabel(healthIssues(0, unreachable)), "1 TO FIX");
  assert.equal(healthIssues(1, lowGas), 1);
});

test("the meters are real zeros against the caps", () => {
  assert.deepEqual(
    meters(caps).map((row) => [row.title, row.value, row.fill]),
    [
      ["PUT IN TODAY", "0 / 100 AUSD", 0],
      ["OPEN POSITIONS", "0 / 3", 0],
      ["DAY-LOSS STOP", "0 / −20 AUSD", 0],
      ["LEVERAGE IN USE", "0× / 3× max", 0],
    ],
  );
});

// ─── Caps and entry ────────────────────────────────────────────────────────────────────────────

test("the risk bounds and both defaults are core's", async () => {
  const core = await import("@pickler/core");

  assert.deepEqual(RISK_BOUNDS, core.RISK_BOUNDS);
  assert.deepEqual(RISK_DEFAULTS, core.RISK_DEFAULTS);
  assert.deepEqual(ENTRY_DEFAULTS, core.ENTRY_DEFAULTS);
});

test("liveEntry reads the entry as core's effectiveEntry does", async () => {
  const core = await import("@pickler/core");
  const configs = [
    {},
    { spend: { perCallAusd: 3, perDayAusd: 10 } },
    {
      entry: { mode: "auto", meanwhile: "small", smallAusd: 40 } as const,
      spend: { perCallAusd: 25, perDayAusd: 100 },
    },
  ];

  for (const config of configs) {
    assert.deepEqual(liveEntry(config), core.effectiveEntry(config));
  }
});

test("the caps it holds: the DTO's spend, its leverage and its risk; defaults otherwise", () => {
  const set = liveCaps({
    spend: { perCallAusd: 25, perDayAusd: 100 },
    config: { maxLeverage: 3, risk: { maxOpenPositions: 3, dayLossStopAusd: 20 } },
  });
  const none = liveCaps({ spend: null, config: {} });

  assert.deepEqual(set, { caps, defaults: false });
  assert.deepEqual(none.caps, {
    perTradeAusd: 5,
    perDayAusd: 20,
    maxLeverage: 1,
    maxOpenPositions: 1,
    dayLossStopAusd: 10,
  });
  assert.equal(none.defaults, true);
});

test("five cap rows with the canvas's titles and lines, stepping within core's bounds", () => {
  const view = liveCapsStepper(
    { ...caps, maxOpenPositions: 6, dayLossStopAusd: 5 },
    { ...caps, maxOpenPositions: 6, dayLossStopAusd: 5 },
  );

  assert.deepEqual(
    view.rows.map((row) => [row.title, row.display]),
    [
      ["PER TRADE", "25 AUSD"],
      ["PER DAY", "100 AUSD"],
      ["MAX LEVERAGE", "3×"],
      ["OPEN AT ONCE", "6"],
      ["DAY-LOSS STOP", "−5 AUSD"],
    ],
  );
  assert.equal(view.rows[0]?.sub, "THE MOST IT PUTS INTO ONE POSITION");
  assert.equal(view.rows[4]?.sub, "LOST IN A DAY · ONCE IT RUNS, IT PAUSES ITSELF THERE");
  assert.equal(view.rows[3]?.next, null);
  assert.equal(view.rows[4]?.prev, null);
  assert.equal(view.rows[4]?.next, 10);
});

test("the caps' tag: SAVED with the five, UNSAVED CHANGES once edited, DEFAULTS never saved", () => {
  const saved = liveCapsStepper(caps, caps);
  const edited = liveCapsStepper({ ...caps, dayLossStopAusd: 25 }, caps);
  const defaults = liveCapsStepper(caps, caps, true);

  assert.equal(saved.tag, "SAVED · 25/100/3/3/20");
  assert.equal(saved.canSave, false);
  assert.equal(edited.tag, "UNSAVED CHANGES");
  assert.equal(edited.canSave, true);
  assert.equal(defaults.tag, "DEFAULTS · 25/100/3/3/20");
  assert.equal(defaults.canSave, true);
  assert.equal(
    saved.note,
    "Pickler will hold every trade to these once it runs. On-chain caps come with live trading.",
  );
});

test("a day's cap below one trade's cannot be saved", () => {
  const view = liveCapsStepper({ ...caps, perDayAusd: 20 }, caps);

  assert.equal(view.inverted, true);
  assert.equal(view.canSave, false);
});

test("How it runs: asking first, the status note and the mode note", () => {
  const view = entryView({ mode: "approve", meanwhile: "wait", smallAusd: 10 }, 25);

  assert.equal(view.asks, true);
  assert.equal(view.small, false);
  assert.equal(
    view.statusNote,
    "It is public on Pickler. It starts watching Perpl and its sources when the Perpl runtime opens; then it asks you before entering.",
  );
  assert.equal(view.modeNote, "ONCE IT RUNS · EVERY ENTRY WAITS FOR YOUR TAP · EXITS NEVER WAIT");
  assert.equal(view.chip, "ASKS YOU FIRST");
});

test("every mode note is said of the setting, not of today (D19)", () => {
  assert.equal(
    entryView({ mode: "auto", meanwhile: "wait", smallAusd: 5 }, 25).modeNote,
    "ONCE IT RUNS · EVERY ENTRY INSIDE THE CAPS GOES ON ITS OWN · YOU CAN STILL CLOSE ANY POSITION · EXITS NEVER WAIT",
  );
  assert.equal(
    entryView({ mode: "approve", meanwhile: "small", smallAusd: 5 }, 25).modeNote,
    "ONCE IT RUNS · EVERY ENTRY GOES IN AT 5 AUSD RIGHT AWAY · THE REST UP TO 25 WAITS FOR YOU · EXITS NEVER WAIT",
  );
});

test("the small entry steps 1, then round fives, up to the per-trade cap", () => {
  const amount = (smallAusd: number, perTrade = 25) =>
    entryView({ mode: "approve", meanwhile: "small", smallAusd }, perTrade).amount;

  assert.deepEqual([amount(1).prev, amount(1).next], [null, 5]);
  assert.deepEqual([amount(5).prev, amount(5).next], [1, 10]);
  assert.deepEqual([amount(10).prev, amount(10).next], [5, 15]);
  assert.deepEqual([amount(3).prev, amount(3).next], [1, 5]);
  assert.deepEqual([amount(1, 3).next, amount(3, 3).next], [3, null]);
});

test("going in small names the amount, clamped to the per-trade cap", () => {
  const view = entryView({ mode: "approve", meanwhile: "small", smallAusd: 40 }, 25);

  assert.equal(view.amount.value, 25);
  assert.equal(view.amount.next, null);
  assert.equal(view.amount.prev, 20);
  assert.match(view.statusNote, /goes in at 25 AUSD and asks you to size up\.$/);
  assert.equal(view.chip, "ASKS YOU FIRST · IN AT 25 MEANWHILE");
});

test("on its own, it enters inside the caps; the small choice is kept but not shown", () => {
  const view = entryView({ mode: "auto", meanwhile: "small", smallAusd: 10 }, 25);

  assert.equal(view.asks, false);
  assert.equal(view.small, false);
  assert.match(view.statusNote, /enters on its own inside the caps\.$/);
  assert.equal(view.chip, "ENTERS ON ITS OWN");
  assert.equal(
    entryView({ mode: "approve", meanwhile: "small", smallAusd: 1 }, 25).amount.prev,
    null,
  );
});

// ─── Markets it watches ────────────────────────────────────────────────────────────────────────

test("the source tag: SAMPLE DATA for the sample board, STALE for an old answer, none for Perpl", () => {
  assert.equal(sourceTag([{ venue: "sample" }]), "SAMPLE DATA");
  assert.equal(
    sourceTag([{ venue: "perpl", network: "testnet", observedAt: "x", stale: true }]),
    "STALE",
  );
  assert.equal(sourceTag([market().source]), null);
});

test("WHAT IT WATCHES: one card per configured market, matched on the base, with its trail", () => {
  const detail = { trail: [1, 2, 3] } as MarketDetailDto;
  const view = marketsView(
    [market(), market({ symbol: "ETH-PERP", base: "ETH", change24h: -0.009 })],
    { "BTC-PERP": detail },
    ["BTC", "ETH"],
  );

  assert.equal(view.state, "ready");
  assert.equal(view.tag, null);
  assert.deepEqual(view.cards[0], {
    key: "BTC-PERP",
    name: "BTC-PERP",
    mark: "97,420.0",
    change: "+1.8%",
    up: true,
    funding: "+0.0087%",
    trail: [1, 2, 3],
    listed: true,
  });
  assert.equal(view.cards[1]?.up, false);
  assert.equal(view.cards[1]?.trail, null);
});

test("a configured market the board does not list reads in dashes", () => {
  const view = marketsView([market()], {}, ["SOL"]);

  assert.equal(view.cards[0]?.listed, false);
  assert.equal(view.cards[0]?.mark, "—");
  assert.equal(view.cards[0]?.up, null);
});

test("loading, failed and the sample board each say so, and health follows", () => {
  const sample = marketsView([market({ source: { venue: "sample" } })], {}, ["BTC"]);

  assert.equal(marketHealth(marketsView(null, {}, ["BTC"])), "unread");
  assert.equal(marketHealth(marketsView("failed", {}, ["BTC"])), "unreachable");
  assert.equal(sample.tag, "SAMPLE DATA");
  assert.equal(marketHealth(sample), "sample");
  assert.equal(marketHealth(marketsView([market()], {}, ["BTC"])), "connected");
  assert.equal(MARKETS_FAILED_LINE, "Couldn't read Perpl.");
});

test("only the watched markets' details are read", () => {
  assert.deepEqual(
    watchedSymbols([market(), market({ symbol: "SOL-PERP", base: "SOL" })], ["BTC"]),
    ["BTC-PERP"],
  );
});

// ─── Brief, versions, abilities, posts ─────────────────────────────────────────────────────────

test("the brief's bar: live on its version, or edits not applied with Apply as the next", () => {
  assert.deepEqual(briefBar(3, false), {
    text: "BRIEF V3 · LIVE",
    dirty: false,
    apply: "Apply as v4",
  });
  assert.equal(
    briefBar(3, true).text,
    "EDITS NOT APPLIED · IT STILL RUNS ON V3 · APPLYING TAKES EFFECT FROM THE NEXT DECISION",
  );
});

test("versions are the recorded saves, the current one marked", () => {
  const now = new Date(Date.UTC(2026, 9, 2, 14, 30));
  const rows = versionRows(
    [
      { version: 4, summary: "Caps", at: "2026-10-01T09:00:00.000Z" },
      { version: 3, summary: "Exit 2", at: "2026-09-30T09:00:00.000Z" },
    ],
    4,
    now,
  );

  assert.deepEqual(
    rows.map((row) => [row.label, row.text, row.current]),
    [
      ["v4", "Caps", true],
      ["v3", "Exit 2", false],
    ],
  );
});

test("a current version from before the table reads v{n} · Current, with no invented text", () => {
  const rows = versionRows([], 2, new Date(0));

  assert.deepEqual(rows, [{ key: "v2", label: "v2", text: "Current", at: "", current: true }]);
});

test("IT MAY: opening follows Pause entries; closing always, posting Soon, moving funds never", () => {
  assert.deepEqual(
    abilities(false).map((row) => [row.key, row.tag]),
    [
      ["open", "ON"],
      ["close", "ALWAYS"],
      ["post", "SOON"],
      ["reply", "SOON"],
      ["withdraw", "NEVER"],
    ],
  );
  assert.equal(abilities(true)[0]?.tag, "PAUSED");
  assert.equal(abilities(true)[0]?.on, false);
});

test("Posts says where calls will go, and that there are none yet", () => {
  assert.deepEqual(postsHeader("HalftimeBot"), {
    title: "Every call, in public",
    tag: "PICKLER + X · @HALFTIMEBOT",
    empty: "No posts yet. Entries and exits will post on Pickler and X when it trades.",
    connect: null,
  });
  assert.equal(
    postsHeader(null).empty,
    "No posts yet. Entries and exits will post on Pickler when it trades.",
  );
  assert.equal(postsHeader(null).tag, "PICKLER ONLY");
  assert.equal(
    postsHeader(null).connect,
    "Posts will go out on Pickler only. Connect an X account and every call will mirror there.",
  );
});

// ─── Marketplace ───────────────────────────────────────────────────────────────────────────────

const entry = (
  name: string,
  beat: string,
  score: number | null,
  overrides: Partial<DirectoryAgentDto> = {},
): DirectoryAgentDto => ({
  agent: {
    name,
    handle: name.toLowerCase(),
    ticker: `$${name.slice(0, 4).toUpperCase()}`,
    slug: null,
    accent: "lime",
  },
  beat,
  venue: "perps",
  decides: `${name} decides.`,
  score,
  hitRate: 0.61,
  resolved: 48,
  net: 212,
  service: null,
  ...overrides,
});

test("beat filters: All and each beat with its count, the chosen one on", () => {
  const directory = [
    entry("Wire", "news", 84),
    entry("Drift", "trend", 71),
    entry("Half", "news", 51),
  ];

  assert.deepEqual(
    directoryCards(directory, undefined, "news").filters.map((filter) => [
      filter.label,
      filter.count,
      filter.on,
    ]),
    [
      ["All", 3, false],
      ["news", 2, true],
      ["trend", 1, false],
    ],
  );
});

test("directory cards are ordered by calibration when every agent has a score", () => {
  const view = directoryCards(
    [entry("Drift", "trend", 71), entry("Wire", "news", 84)],
    "wire",
    "All",
  );

  assert.equal(view.tag, "2 AGENTS · BY CALIBRATION");
  assert.deepEqual(
    view.cards.map((card) => card.name),
    ["Wire", "Drift"],
  );
  assert.equal(view.cards[0]?.stage, "YOURS");
  assert.equal(view.cards[0]?.own, true);
  assert.equal(view.cards[0]?.tickerBeat, "$WIRE · news");
  assert.equal(view.cards[0]?.hit, "61%");
  assert.equal(view.cards[0]?.net, "+212.00");
  assert.equal(view.cards[0]?.ask, "Ask");
});

test("without a score for every agent, the directory keeps its order and the tag is the count", () => {
  const view = directoryCards(
    [
      entry("Drift", "trend", 71),
      entry("Half", "news", null, {
        agent: { name: "Half", handle: "half", ticker: null, slug: null, accent: "lime" },
        resolved: 0,
        hitRate: null,
      }),
    ],
    undefined,
    "All",
  );

  assert.equal(view.tag, "2 AGENTS");
  assert.deepEqual(
    view.cards.map((card) => card.name),
    ["Drift", "Half"],
  );
  assert.equal(view.cards[1]?.tickerBeat, "— · news");
  assert.equal(view.cards[1]?.hit, "—");
  assert.equal(view.cards[1]?.stage, null);
});

test("the board's filters come from the markets, and rows say what nobody counted", () => {
  const markets = [market(), market({ symbol: "MON-PERP", base: "MON", agentsReading: null })];
  const view = boardRows(markets, "Monad");

  assert.deepEqual(
    boardRows(markets, "All").filters.map((filter) => [filter.label, filter.count]),
    [
      ["All", 2],
      ["Crypto", 1],
      ["Monad", 1],
    ],
  );
  assert.deepEqual(
    view.rows.map((row) => [row.pair, row.agents, row.maxLeverage]),
    [["MON-PERP", "— AGENTS", "10×"]],
  );
  assert.equal(view.tag, null);
  assert.equal(boardRows([market({ source: { venue: "sample" } })], "All").tag, "SAMPLE DATA");
});

test("the board's header is master's AUSD, a dash unread", () => {
  assert.equal(boardHeader(wallets("1", "1")), "PERPL · FROM MASTER · 177.6 AUSD");
  assert.equal(boardHeader(null), "PERPL · FROM MASTER · — AUSD");
});

test("the leaderboard ranks the DTO's entries; hit rate is a dash; the tag is calibration's", () => {
  const board: LeaderboardDto = {
    entries: [
      {
        agent: entry("Wire", "news", 84).agent,
        beat: "news",
        venue: "perps",
        score: 84,
        calibrationGap: 0,
        resolved: 48,
        net: 212,
      },
      {
        agent: entry("Print", "macro", 44).agent,
        beat: "macro",
        venue: "perps",
        score: 44,
        calibrationGap: 0,
        resolved: 22,
        net: -31,
      },
    ],
    weights: [{ label: "Calibration", weight: 1, note: "" }],
    calibration: [],
  };
  const view = leaderRows(board, "print");

  assert.equal(view.tag, "SCORE = CALIBRATION · 30 DAYS · LOSSES STAY UP");
  assert.deepEqual(
    view.rows.map((row) => [row.rank, row.name, row.score, row.hit, row.net, row.own]),
    [
      [1, "Wire", "84", "—", "+212.00", false],
      [2, "Print", "44", "—", "−31.00", true],
    ],
  );
  assert.equal(view.rows[0]?.beat, "news · 48 RESOLVED");
});

test("a score made of several weights says them instead", () => {
  const view = leaderRows({
    entries: [],
    weights: [
      { label: "Calibration", weight: 0.7, note: "" },
      { label: "Net", weight: 0.3, note: "" },
    ],
    calibration: [],
  });

  assert.equal(view.tag, "SCORE = CALIBRATION + NET");
  assert.deepEqual(view.rows, []);
});

// ─── Wallets and account ───────────────────────────────────────────────────────────────────────

test("the wallet cards: master named for the account, the agent's with no withdrawals", () => {
  const cards = walletCards(
    wallets("75800000", "900000000000000000"),
    {
      name: "Halftime",
      wallet: {
        walletId: "w",
        address: "0x91bE6f20A3c7D45e81B0F9a2C6d13E7b58Fd4a07",
        balanceAusd: 1,
      },
    },
    "nightowl",
  );

  assert.equal(cards.master.title, "YOUR WALLET · @NIGHTOWL");
  assert.equal(cards.master.fund, "Fund Halftime");
  assert.equal(cards.agent?.title, "HALFTIME'S · AGENT WALLET");
  assert.equal(cards.agent?.short, "0x91bE…4a07");
  assert.equal(cards.agent?.ausdFree, "75.8");
  assert.equal(cards.agent?.inPositions, "0");
  assert.equal(cards.agent?.mon, "0.9");
  assert.equal(
    cards.agent?.note,
    "Only Halftime will trade from here, inside the caps you set. Only you move money in or out.",
  );
});

test("unread wallets are dashes, and an agent without a wallet has no card", () => {
  const cards = walletCards(null, { name: "Halftime", wallet: null }, null);

  assert.equal(cards.master.title, "YOUR WALLET");
  assert.equal(cards.agent, null);
});

test("the account's rows say what is true today", () => {
  assert.deepEqual(
    delegationRows().map((row) => row.tag),
    ["WITH LIVE TRADING", "SOON", "SOON", "NEVER"],
  );
  assert.equal(profileToggleRows().length, 4);
  assert.equal(notifyRows().length, 5);
  assert.equal(
    [...profileToggleRows(), ...notifyRows()].every((row) => row.tag === "SOON"),
    true,
  );
});

// ─── Stages ────────────────────────────────────────────────────────────────────────────────────

test("each live stage is staged outside production only", () => {
  assert.equal(LIVE_STAGES.length, 26);
  for (const stage of LIVE_STAGES) {
    assert.equal(stageFromSearch("development", stage), stage);
    assert.equal(stageFromSearch("production", stage), undefined);
    assert.equal(isLiveStage(stage), true);
    assert.equal(isDraftStage(stage), false);
  }
  assert.equal(stageFromSearch("development", "perpl-nope"), undefined);
  assert.equal(isLiveStage("draft"), false);
});

test("every staged agent is public, a Perpl agent, and opens the live studio on its section", () => {
  for (const stage of LIVE_STAGES) {
    const staged = liveStudioFixture(stage);

    assert.equal(studioKind(staged.agent), "live", stage);
    assert.equal(staged.agent.visibility, "public", stage);
    assert.notEqual(staged.agent.publishedAt, null, stage);
    assert.equal(isLiveSection(staged.section), true, stage);
  }
  assert.equal(liveStudioFixture("perpl-sources").section, "skills");
  assert.equal(liveStudioFixture("perpl-wallets").section, "master");
  assert.equal(liveStudioFixture("perpl-leaders").section, "leaders");
});

test("the staged states: paused, warned, a dirty brief and the account's tabs", () => {
  const live = liveStudioFixture("perpl-live");
  const warned = liveStudioFixture("perpl-warnings");
  const read = (staged: typeof live) => liveWalletRead(staged.agent.wallet, staged.wallets);

  assert.equal(live.agent.paused, false);
  assert.equal(liveStudioFixture("perpl-paused").agent.paused, true);
  assert.deepEqual(liveWarnings(read(live), 25), []);
  assert.equal(liveWarnings(read(warned), 25).length, 2);
  assert.equal(live.briefDraft, null);
  assert.notEqual(liveStudioFixture("perpl-brief-dirty").briefDraft, null);
  assert.equal(live.accountTab, "security");
  assert.equal(liveStudioFixture("perpl-account-profile").accountTab, "profile");
  assert.equal(liveStudioFixture("perpl-account-notify").accountTab, "notify");
  assert.equal(sinceLabel(live.agent.publishedAt, live.now), "PUBLIC SINCE OCT 1 · DAY 2");
});

test("the staged board is Perpl's, but Markets reads the labelled sample board", () => {
  const positions = liveStudioFixture("perpl-positions");
  const markets = liveStudioFixture("perpl-markets");
  const wanted = positions.agent.config.perpl?.markets ?? [];

  assert.equal(marketsView(positions.markets, positions.details, wanted).tag, null);
  assert.equal(
    marketsView(positions.markets, positions.details, wanted).cards.every((card) => card.trail),
    true,
  );
  assert.equal(boardRows(markets.markets, "All").tag, "SAMPLE DATA");
});
