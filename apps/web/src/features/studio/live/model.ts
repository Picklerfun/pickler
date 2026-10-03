/**
 * The live studio's rules (docs/specs/studio-live-v1.md, the "Pickler Studio v5 Live" canvas): which
 * studio an agent opens, the rail, the status, the header's line and tiles, the live strip, the
 * warnings and what fixes them, health, meters, how it enters, the five caps, the markets it watches,
 * the brief's bar and its versions, what it may do, Posts' header, the marketplace's directory,
 * board and leaderboard, the wallets and the account's rows.
 *
 * Pure, no React and no transport, and it value-imports neither `@pickler/api-schema` nor
 * `@pickler/core`: `RISK_BOUNDS`, `RISK_DEFAULTS` and `ENTRY_DEFAULTS` are literal copies of core's
 * (`packages/core/src/features/research/types.ts`), pinned by a dynamic import in
 * `apps/web/test/studio-live-model.test.ts`, which pins every rule here. What it shares with the
 * draft studio is `../shell/`'s: the rail and tile shapes, an agent wallet's read, a stepper's row
 * and every clock.
 *
 * Section keys are the canvas's (`skills` is Sources & rules, `master` is Wallets, `leaders` is
 * Leaderboard), so a `?section=` both studios know carries over.
 */
import type {
  DirectoryAgentDto,
  LeaderboardDto,
  MarketDetailDto,
  MarketSourceDto,
  PerpMarketDto,
  WalletsDto,
} from "@pickler/api-schema";
import { formatPercent, formatSignedTwo } from "../../agents/lib/format";
import { formatChange, formatFunding, formatPrice } from "../../markets/lib/format";
import { agentInitials } from "../lib/initials";
import {
  LEVERAGE_BOUNDS,
  SPEND_BOUNDS,
  STARTER_CAPS,
  formatUnits,
  shortAddress,
  unitsOf,
} from "../new-agent/model";
import { agentWalletRead, type CapRow } from "../shell/build-model";
import { stamp } from "../shell/clock";
import type { HeaderTile, RailGroup } from "../shell/model";

// ─── Which studio ──────────────────────────────────────────────────────────────────────────────

export type StudioKind = "draft" | "live" | "legacy";

/**
 * Spec L1: a private draft opens the draft studio; a published agent made by the simplified flow
 * (`config.perpl`) the live one; anything else, a legacy Polymarket agent, today's home and rail.
 */
export function studioKind(agent: { draft: boolean; config: { perpl?: unknown } }): StudioKind {
  if (agent.draft) {
    return "draft";
  }
  return agent.config.perpl ? "live" : "legacy";
}

// ─── The rail ──────────────────────────────────────────────────────────────────────────────────

export type LiveSectionKey =
  | "overview"
  | "positions"
  | "record"
  | "decisions"
  | "console"
  | "posts"
  | "brief"
  | "skills"
  | "limits"
  | "controls"
  | "identity"
  | "agents"
  | "markets"
  | "leaders"
  | "master"
  | "account";

export type LiveIcon =
  | "grid"
  | "target"
  | "chart"
  | "activity"
  | "chat"
  | "send"
  | "file"
  | "sliders"
  | "wallet"
  | "shield"
  | "user"
  | "users"
  | "bars"
  | "trophy";

/** The canvas's `SECTION_LABELS`. */
const SECTION_LABELS: Record<LiveSectionKey, string> = {
  overview: "Overview",
  positions: "Positions",
  record: "Record",
  decisions: "Decisions",
  console: "Console",
  posts: "Posts",
  brief: "Brief",
  skills: "Sources & rules",
  limits: "Limits",
  controls: "Controls",
  identity: "Identity & voice",
  agents: "Agents",
  markets: "Markets",
  leaders: "Leaderboard",
  master: "Wallets",
  account: "Account",
};

export const liveSectionLabel = (key: LiveSectionKey): string => SECTION_LABELS[key];

/** Every section key, in the rail's order. */
export const LIVE_SECTIONS: readonly LiveSectionKey[] = [
  "overview",
  "positions",
  "record",
  "decisions",
  "console",
  "posts",
  "brief",
  "skills",
  "limits",
  "controls",
  "identity",
  "agents",
  "markets",
  "leaders",
  "master",
  "account",
];

export const isLiveSection = (value: string | undefined): value is LiveSectionKey =>
  (LIVE_SECTIONS as readonly string[]).includes(value ?? "");

const RAIL_DEFS: readonly {
  title: string;
  items: readonly { key: LiveSectionKey; icon: LiveIcon; title?: string }[];
}[] = [
  {
    title: "RUN",
    items: [
      { key: "overview", icon: "grid" },
      { key: "positions", icon: "target" },
      { key: "record", icon: "chart" },
      { key: "decisions", icon: "activity" },
      { key: "console", icon: "chat" },
      { key: "posts", icon: "send" },
    ],
  },
  {
    title: "BUILD",
    items: [
      { key: "brief", icon: "file" },
      { key: "skills", icon: "sliders" },
      { key: "limits", icon: "wallet" },
      { key: "controls", icon: "shield" },
      { key: "identity", icon: "user" },
    ],
  },
  {
    title: "MARKETPLACE",
    items: [
      { key: "agents", icon: "users", title: "Who takes a paid read, on what, for how much" },
      { key: "markets", icon: "bars", title: "Every perp, the board, your ticket" },
      { key: "leaders", icon: "trophy", title: "Who said the truth" },
    ],
  },
  {
    title: "YOU",
    items: [
      { key: "master", icon: "wallet" },
      { key: "account", icon: "user" },
    ],
  },
];

/**
 * What the rail counts: open positions and proposals waiting on the owner. Both are 0 while the
 * Perpl runtime is off; with it on, `runtimeCounts` (`./runtime-model.ts`) fills them.
 */
export interface RailCounts {
  positions: number;
  decisions: number;
}

/**
 * Spec L3: RUN, BUILD, MARKETPLACE (each item titled with its canvas subtitle), YOU; Positions and
 * Decisions carry their count only above zero.
 */
export function liveRail(current: LiveSectionKey, counts: RailCounts): RailGroup<LiveSectionKey>[] {
  return RAIL_DEFS.map((group) => ({
    title: group.title,
    items: group.items.map((item) => {
      let badge: number | undefined;
      if (item.key === "positions" && counts.positions > 0) {
        badge = counts.positions;
      } else if (item.key === "decisions" && counts.decisions > 0) {
        badge = counts.decisions;
      }
      return {
        key: item.key,
        icon: item.icon,
        label: SECTION_LABELS[item.key],
        on: item.key === current,
        ...(badge !== undefined ? { badge } : {}),
        ...(item.title ? { title: item.title } : {}),
      };
    }),
  }));
}

/** The rail's foot (spec L3, canvas `helpLinks`); each opens in a new tab, `noopener noreferrer`. */
export const HELP_LINKS: readonly {
  label: string;
  icon: "book" | "chat" | "life";
  href: string;
}[] = [
  { label: "Docs", icon: "book", href: "https://docs.pickler.fun" },
  { label: "Community", icon: "chat", href: "https://x.com/picklerfun" },
  { label: "Support", icon: "life", href: "mailto:support@pickler.fun" },
];

/** "ITS PUBLIC PROFILE": the marketplace path of the agent's page, or null without a handle. */
export const publicProfilePath = (handle: string | undefined): string | null =>
  handle ? `/agents/${handle}` : null;

// ─── Status, header and tiles ──────────────────────────────────────────────────────────────────

export interface LiveStatus {
  state: "public" | "paused";
  /**
   * Spec L4: not the canvas's "LIVE · WATCHING", because nothing watches yet (D19); once the Perpl
   * runtime is on, "LIVE · ON PAPER" (`runtimeStatus` in `./runtime-model.ts`).
   */
  label: "PUBLIC · RUNS SOON" | "LIVE · ON PAPER" | "PAUSED · EXITS ONLY";
  tone: "good" | "caution";
  /** The header's control: "Pause entries" while public, "Resume" while paused. */
  action: "Pause entries" | "Resume";
}

export function liveStatus(agent: { paused: boolean }): LiveStatus {
  if (agent.paused) {
    return { state: "paused", label: "PAUSED · EXITS ONLY", tone: "caution", action: "Resume" };
  }
  return { state: "public", label: "PUBLIC · RUNS SOON", tone: "good", action: "Pause entries" };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_MS = 86_400_000;

/**
 * The header's "PUBLIC SINCE OCT 1 · DAY 2", in UTC so the server and the browser write the same
 * line: day 1 is the day it went public. Without a date (never expected of a public agent) it reads
 * "PUBLIC".
 */
export function sinceLabel(publishedAt: string | null, now: number): string {
  if (!publishedAt) {
    return "PUBLIC";
  }
  const published = new Date(publishedAt);
  const days = Math.floor(now / DAY_MS) - Math.floor(published.getTime() / DAY_MS) + 1;
  const day = `${MONTHS[published.getUTCMonth()]} ${published.getUTCDate()}`;
  return `PUBLIC SINCE ${day} · DAY ${Math.max(1, days)}`;
}

/** The header's line: `@HANDLE · PERPL · MONAD · PUBLIC SINCE … · {SECTION}`, as its parts. */
export function headerParts(input: {
  handle: string | undefined;
  publishedAt: string | null;
  now: number;
  section: LiveSectionKey;
}): string[] {
  return [
    input.handle ? `@${input.handle.toUpperCase()}` : "NO HANDLE",
    "PERPL · MONAD",
    sinceLabel(input.publishedAt, input.now),
    SECTION_LABELS[input.section].toUpperCase(),
  ];
}

/** Its wallet's balances, read: `GET /wallets` once read, the agent DTO's AUSD until then. */
export interface LiveWalletRead {
  ausdMicro: bigint | null;
  monWei: bigint | null;
}

export function liveWalletRead(
  wallet: { walletId: string; balanceAusd: number } | null,
  wallets: WalletsDto | null,
): LiveWalletRead | null {
  if (!wallet) {
    return null;
  }
  const read = agentWalletRead(wallets, wallet.walletId);
  return {
    ausdMicro: read?.ausdMicro ?? BigInt(Math.round(wallet.balanceAusd * 1_000_000)),
    monWei: read?.monWei ?? null,
  };
}

/** Spec L5: EQUITY is its wallet's AUSD; TODAY, OPEN and PUT IN TODAY read "Soon". */
export function liveTiles(read: LiveWalletRead | null, perDayAusd: number): HeaderTile[] {
  return [
    {
      label: "EQUITY · AUSD IN ITS WALLET",
      value: formatUnits(read?.ausdMicro ?? null, "AUSD"),
      soon: false,
    },
    { label: "TODAY · AUSD", value: "Soon", soon: true },
    { label: "OPEN · POSITIONS", value: "Soon", soon: true },
    { label: `PUT IN TODAY · OF ${perDayAusd} CAP`, value: "Soon", soon: true },
  ];
}

// ─── The live strip ────────────────────────────────────────────────────────────────────────────

export interface StripView {
  line: string;
  count: string;
  /** The last check's steps, newest first: empty until the runtime checks anything. */
  log: { at: string; text: string }[];
  /** "EVERY DECISION →" opens Decisions. */
  more: string;
}

/** Spec L6: with no runtime there is no check to show, and it says so. */
export const stripView = (): StripView => ({
  line: "No checks yet · it starts checking when the Perpl runtime opens",
  count: "0 CHECKS",
  log: [],
  more: "EVERY DECISION →",
});

// ─── Warnings, health and meters ───────────────────────────────────────────────────────────────

/** Spec L14: below this much MON its gas is low (0.2 MON). */
export const GAS_LOW_WEI = 200_000_000_000_000_000n;

export interface LiveWarning {
  key: "gas" | "ausd";
  text: string;
  /** The section that fixes it: Limits, for both. */
  fix: LiveSectionKey;
}

/**
 * The degraded banner (spec L14): MON under 0.2, free AUSD under one trade. A balance the chain did
 * not answer for claims nothing.
 */
export function liveWarnings(read: LiveWalletRead | null, perTradeAusd: number): LiveWarning[] {
  const warnings: LiveWarning[] = [];
  if (read?.monWei != null && read.monWei < GAS_LOW_WEI) {
    warnings.push({
      key: "gas",
      text: `MON FOR GAS IS LOW · ${formatUnits(read.monWei, "MON")} LEFT`,
      fix: "limits",
    });
  }
  if (read?.ausdMicro != null && read.ausdMicro < BigInt(perTradeAusd) * 1_000_000n) {
    warnings.push({
      key: "ausd",
      text: "FREE AUSD BELOW ONE TRADE · IT CAN EXIT BUT NOT ENTER",
      fix: "limits",
    });
  }
  return warnings;
}

/** "Fix it": the section that fixes the first warning, or null with none. */
export const fixTarget = (warnings: readonly LiveWarning[]): LiveSectionKey | null =>
  warnings[0]?.fix ?? null;

/** The banner's one line. */
export const warningLine = (warnings: readonly LiveWarning[]): string =>
  warnings.map((warning) => warning.text).join(" · ");

export type MarketHealth = "connected" | "sample" | "stale" | "unreachable" | "unread";

export interface HealthRow {
  /** `runtime` and `cost` are added once the record is read (`runtimeHealthRows`). */
  key: "perpl" | "sources" | "gas" | "credits" | "brief" | "runtime" | "cost";
  label: string;
  value: string;
  tone: "good" | "caution" | "bad" | "quiet";
}

const MARKET_HEALTH: Record<MarketHealth, { value: string; tone: HealthRow["tone"] }> = {
  connected: { value: "CONNECTED", tone: "good" },
  sample: { value: "SAMPLE DATA", tone: "caution" },
  stale: { value: "STALE", tone: "caution" },
  unreachable: { value: "UNREACHABLE", tone: "bad" },
  unread: { value: "—", tone: "quiet" },
};

/**
 * Spec L13's HEALTH: Perpl's market data (from L8's read), sources, gas, AI credits, the brief. The
 * brief's row is always "v{n} · APPLIED": Brief's edits live in the Brief section and are dropped
 * when it closes, so while HEALTH shows nothing can be unapplied (a deviation from L13 noted there).
 */
export function healthRows(input: {
  market: MarketHealth;
  /** Perpl, and the web when it is on. */
  sourcesOn: number;
  monWei: bigint | null;
  version: number;
}): HealthRow[] {
  const gasLow = input.monWei !== null && input.monWei < GAS_LOW_WEI;
  let gas: Pick<HealthRow, "value" | "tone"> = { value: "—", tone: "quiet" };
  if (input.monWei !== null) {
    gas = {
      value: `${formatUnits(input.monWei, "MON")} · ${gasLow ? "LOW" : "OK"}`,
      tone: gasLow ? "caution" : "good",
    };
  }
  return [
    { key: "perpl", label: "Perpl · market data", ...MARKET_HEALTH[input.market] },
    { key: "sources", label: "Sources", value: `${input.sourcesOn} ON`, tone: "good" },
    { key: "gas", label: "Gas · MON", ...gas },
    { key: "credits", label: "AI credits", value: "Soon", tone: "quiet" },
    { key: "brief", label: "Brief", value: `v${input.version} · APPLIED`, tone: "good" },
  ];
}

/**
 * How many things HEALTH says need fixing: the banner's warnings, plus every row that is bad
 * (Perpl UNREACHABLE). A low-gas row is caution, and the gas warning already counts it.
 */
export const healthIssues = (warnings: number, rows: readonly HealthRow[]): number =>
  warnings + rows.filter((row) => row.tone === "bad").length;

/** HEALTH's tag: what needs fixing, or ALL GOOD. */
export const healthLabel = (issues: number): string =>
  issues > 0 ? `${issues} TO FIX` : "ALL GOOD";

export interface MeterRow {
  key: "putIn" | "open" | "dayLoss" | "leverage";
  title: string;
  value: string;
  /** How full the track is, 0–1: nothing is in use before the runtime. */
  fill: number;
}

/** Spec L13: real zeros against the caps it holds. */
export function meters(caps: LiveCaps): MeterRow[] {
  return [
    {
      key: "putIn",
      title: "PUT IN TODAY",
      value: `0 / ${caps.perDayAusd} AUSD`,
      fill: 0,
    },
    { key: "open", title: "OPEN POSITIONS", value: `0 / ${caps.maxOpenPositions}`, fill: 0 },
    {
      key: "dayLoss",
      title: "DAY-LOSS STOP",
      value: `0 / −${caps.dayLossStopAusd} AUSD`,
      fill: 0,
    },
    {
      key: "leverage",
      title: "LEVERAGE IN USE",
      value: `0× / ${caps.maxLeverage}× max`,
      fill: 0,
    },
  ];
}

// ─── The caps (Limits) ─────────────────────────────────────────────────────────────────────────

/** Core's `RISK_BOUNDS`, restated (pinned in the test). */
export const RISK_BOUNDS = {
  maxOpenPositions: { min: 1, max: 6 },
  dayLossStopAusd: { min: 5, max: 200, step: 5 },
} as const;

/** Core's `RISK_DEFAULTS`, restated (pinned in the test). */
export const RISK_DEFAULTS = { maxOpenPositions: 1, dayLossStopAusd: 10 } as const;

export interface LiveCaps {
  perTradeAusd: number;
  perDayAusd: number;
  maxLeverage: number;
  maxOpenPositions: number;
  dayLossStopAusd: number;
}

type LiveCapKey = keyof LiveCaps;

/** What the caps are read from: the studio agent's `spend` and its config. */
export interface LiveCapsSource {
  spend: { perCallAusd: number; perDayAusd: number } | null;
  config: {
    spend?: { perCallAusd: number; perDayAusd: number } | undefined;
    maxLeverage?: number | undefined;
    risk?: { maxOpenPositions: number; dayLossStopAusd: number } | undefined;
  };
}

/**
 * The five caps it holds (spec L12): the spend Pickler enforces (the DTO's before the config's),
 * its leverage, and `config.risk` as core's `effectiveRisk` reads it. What it was never given is
 * the starter cap or the risk default, and `defaults` says so.
 */
export function liveCaps(source: LiveCapsSource): { caps: LiveCaps; defaults: boolean } {
  const spend = source.spend ?? source.config.spend ?? null;
  const risk = source.config.risk ?? RISK_DEFAULTS;
  return {
    caps: {
      perTradeAusd: spend?.perCallAusd ?? STARTER_CAPS.perTradeAusd,
      perDayAusd: spend?.perDayAusd ?? STARTER_CAPS.perDayAusd,
      maxLeverage: source.config.maxLeverage ?? STARTER_CAPS.maxLeverage,
      maxOpenPositions: risk.maxOpenPositions,
      dayLossStopAusd: risk.dayLossStopAusd,
    },
    defaults: spend === null || source.config.maxLeverage == null || !source.config.risk,
  };
}

/*
 * What the canvas says the runtime will do, said of the setting (draft spec D19): nothing runs yet,
 * so a line that describes behaviour starts with when it will hold.
 */
const ONCE_IT_RUNS = "ONCE IT RUNS";

/* The canvas's `CAP_DEFS`: titles, the line under each, steps and floors. The spend and leverage
   ceilings are core's bounds (as the draft's are), the risk rows core's `RISK_BOUNDS`. */
const CAP_DEFS: readonly {
  key: LiveCapKey;
  title: string;
  sub: string;
  step: number;
  min: number;
  max: number;
  show(value: number): string;
}[] = [
  {
    key: "perTradeAusd",
    title: "PER TRADE",
    sub: "THE MOST IT PUTS INTO ONE POSITION",
    step: 5,
    min: 5,
    max: SPEND_BOUNDS.perCallAusd.max,
    show: (value) => `${value} AUSD`,
  },
  {
    key: "perDayAusd",
    title: "PER DAY",
    sub: "THE MOST IT PUTS IN, ALL DAY",
    step: 10,
    min: 10,
    max: SPEND_BOUNDS.perDayAusd.max,
    show: (value) => `${value} AUSD`,
  },
  {
    key: "maxLeverage",
    title: "MAX LEVERAGE",
    sub: "PERPL ALLOWS UP TO 20×",
    step: 1,
    min: LEVERAGE_BOUNDS.min,
    max: LEVERAGE_BOUNDS.max,
    show: (value) => `${value}×`,
  },
  {
    key: "maxOpenPositions",
    title: "OPEN AT ONCE",
    sub: "POSITIONS",
    step: 1,
    min: RISK_BOUNDS.maxOpenPositions.min,
    max: RISK_BOUNDS.maxOpenPositions.max,
    show: (value) => String(value),
  },
  {
    key: "dayLossStopAusd",
    title: "DAY-LOSS STOP",
    sub: `LOST IN A DAY · ${ONCE_IT_RUNS}, IT PAUSES ITSELF THERE`,
    step: RISK_BOUNDS.dayLossStopAusd.step,
    min: RISK_BOUNDS.dayLossStopAusd.min,
    max: RISK_BOUNDS.dayLossStopAusd.max,
    show: (value) => `−${value} AUSD`,
  },
];

/** A cap's row, with the canvas's line under its title. */
export interface LiveCapRow extends CapRow<LiveCapKey> {
  sub: string;
}

export interface LiveCapsView {
  rows: LiveCapRow[];
  dirty: boolean;
  /** "SAVED · 25/100/3/3/20", "UNSAVED CHANGES", or "DEFAULTS · …" for caps it was never given. */
  tag: string;
  /** A day's cap below one trade's: core refuses it. */
  inverted: boolean;
  /** "Save caps" opens when edited (or when the defaults were never saved) and not inverted. */
  canSave: boolean;
  /** The line under the caps (spec L12): saved, not signed. */
  note: string;
}

const capsLine = (caps: LiveCaps): string =>
  [
    caps.perTradeAusd,
    caps.perDayAusd,
    caps.maxLeverage,
    caps.maxOpenPositions,
    caps.dayLossStopAusd,
  ].join("/");

/** The five caps with − and +, against what is saved (spec L12). */
export function liveCapsStepper(
  current: LiveCaps,
  saved: LiveCaps,
  defaults = false,
): LiveCapsView {
  const rows = CAP_DEFS.map((def) => {
    const value = current[def.key];
    return {
      key: def.key,
      title: def.title,
      sub: def.sub,
      value,
      display: def.show(value),
      prev: value > def.min ? Math.max(def.min, value - def.step) : null,
      next: value < def.max ? Math.min(def.max, value + def.step) : null,
    };
  });
  const dirty = CAP_DEFS.some((def) => current[def.key] !== saved[def.key]);
  const inverted = current.perDayAusd < current.perTradeAusd;
  let tag = `SAVED · ${capsLine(saved)}`;
  if (dirty) {
    tag = "UNSAVED CHANGES";
  } else if (defaults) {
    tag = `DEFAULTS · ${capsLine(saved)}`;
  }
  return {
    rows,
    dirty,
    tag,
    inverted,
    canSave: (dirty || defaults) && !inverted,
    note: "Pickler will hold every trade to these once it runs. On-chain caps come with live trading.",
  };
}

// ─── How it enters (Controls) ──────────────────────────────────────────────────────────────────

/** Core's `ENTRY_DEFAULTS`, restated (pinned in the test). */
export const ENTRY_DEFAULTS = { mode: "approve", meanwhile: "wait", smallAusd: 5 } as const;

export interface LiveEntry {
  mode: "approve" | "auto";
  meanwhile: "wait" | "small";
  smallAusd: number;
}

/**
 * Core's `effectiveEntry`: the stored entry or the defaults, with the small amount never above the
 * per-trade cap (pinned against core in the test).
 */
export function liveEntry(config: {
  entry?: LiveEntry | undefined;
  spend?: { perCallAusd: number } | undefined;
}): LiveEntry {
  const entry = config.entry ?? ENTRY_DEFAULTS;
  const cap = config.spend?.perCallAusd ?? Infinity;
  return { ...entry, smallAusd: Math.min(entry.smallAusd, cap) };
}

export interface EntryView {
  mode: LiveEntry["mode"];
  /** "While you decide" shows under "With my approval" only. */
  asks: boolean;
  /** "Go in small" is on (and its amount shows). */
  small: boolean;
  /** The small amount, clamped to 1..per trade, with − and +. */
  amount: { value: number; display: string; prev: number | null; next: number | null };
  /** HOW IT RUNS' paragraph (spec L13). */
  statusNote: string;
  /** The canvas's three mode notes, each said of the setting ("ONCE IT RUNS · …"). */
  modeNote: string;
  /** The canvas's mode chip. */
  chip: string;
}

/* The small amount's steps: 1, then round fives, never above the per-trade cap. */
const smallPrev = (value: number): number | null => {
  if (value > 5) {
    return value - 5;
  }
  return value > 1 ? 1 : null;
};
const smallNext = (value: number, perTradeAusd: number): number | null => {
  if (value >= perTradeAusd) {
    return null;
  }
  return value < 5 ? Math.min(5, perTradeAusd) : Math.min(perTradeAusd, value + 5);
};

/**
 * Spec L13's "How it runs": `config.entry` with the canvas's control, notes and chip. The mode notes
 * describe the setting, not today's behaviour, so each starts "ONCE IT RUNS". The small amount steps
 * 1, 5, 10, 15… up to the per-trade cap.
 */
export function entryView(entry: LiveEntry, perTradeAusd: number): EntryView {
  const asks = entry.mode === "approve";
  const small = asks && entry.meanwhile === "small";
  const value = Math.max(1, Math.min(entry.smallAusd, perTradeAusd));
  let then = "enters on its own inside the caps";
  let modeNote = `${ONCE_IT_RUNS} · EVERY ENTRY INSIDE THE CAPS GOES ON ITS OWN · YOU CAN STILL CLOSE ANY POSITION · EXITS NEVER WAIT`;
  if (small) {
    then = `goes in at ${value} AUSD and asks you to size up`;
    modeNote = `${ONCE_IT_RUNS} · EVERY ENTRY GOES IN AT ${value} AUSD RIGHT AWAY · THE REST UP TO ${perTradeAusd} WAITS FOR YOU · EXITS NEVER WAIT`;
  } else if (asks) {
    then = "asks you before entering";
    modeNote = `${ONCE_IT_RUNS} · EVERY ENTRY WAITS FOR YOUR TAP · EXITS NEVER WAIT`;
  }
  let chip = "ENTERS ON ITS OWN";
  if (asks) {
    chip = small ? `ASKS YOU FIRST · IN AT ${value} MEANWHILE` : "ASKS YOU FIRST";
  }
  return {
    mode: entry.mode,
    asks,
    small,
    amount: {
      value,
      display: `${value} AUSD`,
      prev: smallPrev(value),
      next: smallNext(value, perTradeAusd),
    },
    statusNote: `It is public on Pickler. It starts watching Perpl and its sources when the Perpl runtime opens; then it ${then}.`,
    modeNote,
    chip,
  };
}

// ─── What it watches (Positions, Health) ───────────────────────────────────────────────────────

export type SourceTag = "SAMPLE DATA" | "STALE" | null;

/** Spec L8: a sample board says so; a venue answer not renewed is stale; Perpl's live answer, none. */
export function sourceTag(sources: readonly MarketSourceDto[]): SourceTag {
  if (sources.some((source) => source.venue === "sample")) {
    return "SAMPLE DATA";
  }
  if (sources.some((source) => source.venue === "perpl" && source.stale)) {
    return "STALE";
  }
  return null;
}

/** "BTC" in `config.perpl.markets` is the board's "BTC-PERP" (`base`), either way round. */
const sameMarket = (market: PerpMarketDto, wanted: string): boolean => {
  const name = wanted.trim().toUpperCase();
  return market.base.toUpperCase() === name || market.symbol.toUpperCase() === name;
};

/** The board's symbols for the markets it watches, to read one detail each (its trail). */
export const watchedSymbols = (
  markets: readonly PerpMarketDto[],
  wanted: readonly string[],
): string[] =>
  wanted.flatMap((name) => {
    const market = markets.find((entry) => sameMarket(entry, name));
    return market ? [market.symbol] : [];
  });

export const FUNDING_LABEL = "FUNDING · 1H";

export interface WatchCard {
  key: string;
  /** "BTC-PERP", or the config's name for a market the board does not list. */
  name: string;
  mark: string;
  change: string;
  /** The day's direction; null for a market the board does not list (drawn neutral). */
  up: boolean | null;
  /** The hourly rate. */
  funding: string;
  /** The last 24 h of marks, oldest first, for the sparkline; null until read. */
  trail: number[] | null;
  /** The board lists it: one it does not reads in dashes. */
  listed: boolean;
}

/** `GET /marketplace/markets`: the board, null before the read, `failed` when it did not answer. */
export type MarketsRead = PerpMarketDto[] | null | "failed";

export interface MarketsView {
  state: "loading" | "failed" | "ready";
  tag: SourceTag;
  cards: WatchCard[];
}

/**
 * WHAT IT WATCHES (spec L8): one card per market in `config.perpl.markets`, from the board and one
 * detail each (`details`, keyed by the board's symbol) for the trail.
 */
export function marketsView(
  markets: MarketsRead,
  details: Readonly<Record<string, MarketDetailDto | null>>,
  wanted: readonly string[],
): MarketsView {
  if (markets === null) {
    return { state: "loading", tag: null, cards: [] };
  }
  if (markets === "failed") {
    return { state: "failed", tag: null, cards: [] };
  }
  const watched = wanted.map((name) => ({
    name,
    market: markets.find((entry) => sameMarket(entry, name)) ?? null,
  }));
  const cards = watched.map(({ name, market }): WatchCard => {
    if (!market) {
      return {
        key: name,
        name: name.toUpperCase(),
        mark: "—",
        change: "—",
        up: null,
        funding: "—",
        trail: null,
        listed: false,
      };
    }
    return {
      key: market.symbol,
      name: market.symbol,
      mark: formatPrice(market.mark),
      change: formatChange(market.change24h),
      up: market.change24h >= 0,
      funding: formatFunding(market.funding1h),
      trail: details[market.symbol]?.trail ?? null,
      listed: true,
    };
  });
  const sources = watched.flatMap(({ market }) => (market ? [market.source] : []));
  return { state: "ready", tag: sourceTag(sources), cards };
}

/** Health's Perpl row, from the same read. */
export function marketHealth(view: MarketsView): MarketHealth {
  if (view.state === "loading") {
    return "unread";
  }
  if (view.state === "failed") {
    return "unreachable";
  }
  if (view.tag === "SAMPLE DATA") {
    return "sample";
  }
  return view.tag === "STALE" ? "stale" : "connected";
}

/** The failed read's words (spec L8), with Retry beside it. */
export const MARKETS_FAILED_LINE = "Couldn't read Perpl.";

// ─── The brief and its versions ────────────────────────────────────────────────────────────────

export interface BriefBar {
  text: string;
  dirty: boolean;
  /** "Apply as v{n+1}". */
  apply: string;
}

/** Spec L9: the note over the brief, live or with edits not applied. */
export function briefBar(version: number, dirty: boolean): BriefBar {
  return {
    text: dirty
      ? `EDITS NOT APPLIED · IT STILL RUNS ON V${version} · APPLYING TAKES EFFECT FROM THE NEXT DECISION`
      : `BRIEF V${version} · LIVE`,
    dirty,
    apply: `Apply as v${version + 1}`,
  };
}

/** Sources & rules' bar (spec L15). */
export const SOURCES_BAR = "CHANGES APPLY FROM THE NEXT DECISION · OPEN POSITIONS KEEP THEIR EXITS";

export interface VersionRow {
  key: string;
  label: string;
  text: string;
  /** "hh:mm" today, the day ("OCT 1") before; "" for the current version with no row. */
  at: string;
  current: boolean;
}

/**
 * VERSIONS (spec L10): the recorded saves, newest first. A current version from before the table
 * has no row: it is shown first as "v{n} · Current", with no invented text.
 */
export function versionRows(
  versions: readonly { version: number; summary: string; at: string }[],
  currentVersion: number,
  now: Date,
): VersionRow[] {
  const rows = versions.map((entry) => ({
    key: `v${entry.version}`,
    label: `v${entry.version}`,
    text: entry.summary,
    at: stamp(new Date(entry.at), now),
    current: entry.version === currentVersion,
  }));
  if (rows.some((row) => row.current)) {
    return rows;
  }
  return [
    {
      key: `v${currentVersion}`,
      label: `v${currentVersion}`,
      text: "Current",
      at: "",
      current: true,
    },
    ...rows,
  ];
}

// ─── Sources & rules: what it may do ───────────────────────────────────────────────────────────

export interface AbilityRow {
  key: "open" | "close" | "post" | "reply" | "withdraw";
  name: string;
  note: string;
  /** Read-only: the state, as a tag. */
  tag: "ON" | "PAUSED" | "ALWAYS" | "SOON" | "NEVER";
  on: boolean;
}

/** Spec L15's IT MAY, read-only: opening follows Pause entries; the rest are fixed or Soon. */
export function abilities(paused: boolean): AbilityRow[] {
  return [
    {
      key: "open",
      name: "Open positions",
      note: "Within the caps, on Perpl only · follows Pause entries",
      tag: paused ? "PAUSED" : "ON",
      on: !paused,
    },
    {
      key: "close",
      name: "Close positions",
      note: "Its own exits, always allowed",
      tag: "ALWAYS",
      on: true,
    },
    {
      key: "post",
      name: "Post calls",
      note: "Pickler, and X if connected",
      tag: "SOON",
      on: false,
    },
    {
      key: "reply",
      name: "Reply on X",
      note: "Answers mentions in its voice",
      tag: "SOON",
      on: false,
    },
    {
      key: "withdraw",
      name: "Move funds out",
      note: "Never. Only you, with a passkey",
      tag: "NEVER",
      on: false,
    },
  ];
}

// ─── Posts ─────────────────────────────────────────────────────────────────────────────────────

export interface PostsHeader {
  title: "Every call, in public";
  tag: string;
  /** Spec L7's empty line. */
  empty: string;
  /** Without X: the canvas's line over "Connect X", or null with X. */
  connect: string | null;
}

export function postsHeader(xHandle: string | null): PostsHeader {
  return {
    title: "Every call, in public",
    tag: xHandle ? `PICKLER + X · @${xHandle.toUpperCase()}` : "PICKLER ONLY",
    empty: `No posts yet. Entries and exits will post on Pickler${xHandle ? " and X" : ""} when it trades.`,
    connect: xHandle
      ? null
      : "Posts will go out on Pickler only. Connect an X account and every call will mirror there.",
  };
}

// ─── Marketplace: agents ───────────────────────────────────────────────────────────────────────

export interface BeatFilter {
  key: string;
  label: string;
  count: number;
  on: boolean;
}

/** "All" and each beat the directory has, in the order it first appears, with its count. */
function beatFilters(directory: readonly DirectoryAgentDto[], beat: string): BeatFilter[] {
  const beats = [...new Set(directory.map((entry) => entry.beat))];
  return [
    { key: "All", label: "All", count: directory.length, on: beat === "All" },
    ...beats.map((key) => ({
      key,
      label: key,
      count: directory.filter((entry) => entry.beat === key).length,
      on: beat === key,
    })),
  ];
}

export interface DirectoryCard {
  key: string;
  initials: string;
  accent: DirectoryAgentDto["agent"]["accent"];
  name: string;
  /** "$HALF · news", "— · news" before a token. */
  tickerBeat: string;
  /** "YOURS" on the owner's own agent; the DTO carries no token stage, so nothing otherwise. */
  stage: "YOURS" | null;
  note: string;
  net: string;
  netUp: boolean;
  /** The hit rate, "—" when the record has none. */
  hit: string;
  resolved: string;
  /** "Ask · 2 AUSD" when it sells reads, "Ask" otherwise; shut and tagged Soon either way. */
  ask: string;
  own: boolean;
}

export interface DirectoryView {
  filters: BeatFilter[];
  cards: DirectoryCard[];
  /** "6 AGENTS · BY CALIBRATION" only when every entry has a score; otherwise the count alone. */
  tag: string;
}

/**
 * Marketplace · Agents (spec L17): the real directory, filtered by beat, ordered by score when the
 * DTO carries one for every agent, else in the directory's own order.
 */
export function directoryCards(
  directory: readonly DirectoryAgentDto[],
  ownHandle: string | undefined,
  beat: string,
): DirectoryView {
  const scored = directory.length > 0 && directory.every((entry) => entry.score !== null);
  const ordered = scored
    ? [...directory].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : [...directory];
  const shown = ordered.filter((entry) => beat === "All" || entry.beat === beat);
  const count = `${directory.length} ${directory.length === 1 ? "AGENT" : "AGENTS"}`;
  return {
    filters: beatFilters(directory, beat),
    tag: scored ? `${count} · BY CALIBRATION` : count,
    cards: shown.map((entry) => {
      const own = ownHandle !== undefined && entry.agent.handle === ownHandle;
      return {
        key: entry.agent.handle,
        initials: agentInitials(entry.agent.name),
        accent: entry.agent.accent,
        name: entry.agent.name,
        tickerBeat: `${entry.agent.ticker ?? "—"} · ${entry.beat}`,
        stage: own ? "YOURS" : null,
        note: entry.decides,
        net: formatSignedTwo(entry.net),
        netUp: entry.net >= 0,
        hit: entry.resolved > 0 ? formatPercent(entry.hitRate) : "—",
        resolved: `${entry.resolved} RESOLVED`,
        ask: entry.service ? `Ask · ${entry.service.price} AUSD` : "Ask",
        own,
      };
    }),
  };
}

// ─── Marketplace: markets ──────────────────────────────────────────────────────────────────────

/** A market's category, from the DTO: Monad's own token, or crypto (the canvas's two). */
const marketCategory = (market: Pick<PerpMarketDto, "base">): "Monad" | "Crypto" =>
  market.base.toUpperCase() === "MON" ? "Monad" : "Crypto";

/** "All" and each category the board has, with its count; a category with none is left out. */
function boardFilters(markets: readonly PerpMarketDto[], category: string): BeatFilter[] {
  const categories = (["Crypto", "Monad"] as const).filter((key) =>
    markets.some((market) => marketCategory(market) === key),
  );
  return [
    { key: "All", label: "All", count: markets.length, on: category === "All" },
    ...categories.map((key) => ({
      key,
      label: key,
      count: markets.filter((market) => marketCategory(market) === key).length,
      on: category === key,
    })),
  ];
}

export interface BoardRow {
  key: string;
  base: string;
  pair: string;
  maxLeverage: string;
  /** "7 AGENTS", "— AGENTS" when nobody counted. */
  agents: string;
  mark: string;
  change: string;
  up: boolean;
  note: string;
}

export interface BoardView {
  filters: BeatFilter[];
  rows: BoardRow[];
  tag: SourceTag;
}

/** Marketplace · Markets (spec L18): the real board, filtered by category. */
export function boardRows(markets: readonly PerpMarketDto[], category: string): BoardView {
  const shown = markets.filter(
    (market) => category === "All" || marketCategory(market) === category,
  );
  return {
    filters: boardFilters(markets, category),
    tag: sourceTag(markets.map((market) => market.source)),
    rows: shown.map((market) => ({
      key: market.symbol,
      base: market.base,
      pair: market.symbol,
      maxLeverage: `${market.maxLeverage}×`,
      agents:
        market.agentsReading === null
          ? "— AGENTS"
          : `${market.agentsReading} ${market.agentsReading === 1 ? "AGENT" : "AGENTS"}`,
      mark: formatPrice(market.mark),
      change: formatChange(market.change24h),
      up: market.change24h >= 0,
      note: market.note,
    })),
  };
}

/** The board's header: "PERPL · FROM MASTER · {AUSD} AUSD", dashes until master is read. */
export const boardHeader = (wallets: WalletsDto | null): string =>
  `PERPL · FROM MASTER · ${formatUnits(unitsOf(wallets?.master.ausdMicro ?? null), "AUSD")} AUSD`;

// ─── Marketplace: leaderboard ──────────────────────────────────────────────────────────────────

export interface LeaderRow {
  key: string;
  rank: number;
  initials: string;
  accent: LeaderboardDto["entries"][number]["agent"]["accent"];
  name: string;
  ticker: string;
  /** "news · 48 RESOLVED". */
  beat: string;
  score: string;
  /** The leaderboard DTO has no hit rate: a dash, never a number made up. */
  hit: string;
  net: string;
  netUp: boolean;
  own: boolean;
}

/** The leaderboard's title (spec L19), drawn before its read answers. */
export const LEADER_TITLE = "Who said the truth";

export interface LeaderView {
  /** The canvas's line only when the score is calibration alone; otherwise the DTO's weights. */
  tag: string;
  rows: LeaderRow[];
}

const CALIBRATION_TAG = "SCORE = CALIBRATION · 30 DAYS · LOSSES STAY UP";

/** Marketplace · Leaderboard (spec L19): the DTO's order, which core ranks by score. */
export function leaderRows(board: LeaderboardDto, ownHandle?: string): LeaderView {
  const calibration =
    board.weights.length === 1 && /calibration/i.test(board.weights[0]?.label ?? "");
  let tag = "SCORE";
  if (calibration) {
    tag = CALIBRATION_TAG;
  } else if (board.weights.length > 0) {
    tag = `SCORE = ${board.weights.map((weight) => weight.label.toUpperCase()).join(" + ")}`;
  }
  return {
    tag,
    rows: board.entries.map((entry, index) => ({
      key: entry.agent.handle,
      rank: index + 1,
      initials: agentInitials(entry.agent.name),
      accent: entry.agent.accent,
      name: entry.agent.name,
      ticker: entry.agent.ticker ?? "—",
      beat: `${entry.beat} · ${entry.resolved} RESOLVED`,
      score: String(entry.score),
      hit: "—",
      net: formatSignedTwo(entry.net),
      netUp: entry.net >= 0,
      own: ownHandle !== undefined && entry.agent.handle === ownHandle,
    })),
  };
}

// ─── Wallets ───────────────────────────────────────────────────────────────────────────────────

/** The live canvas's words for the shell's `MasterCard` (its head, fund and deposit buttons). */
export interface MasterCardWords {
  title: string;
  /** "Fund {name}": the Wallets modal toward the agent. */
  fund: string;
  deposit: "Deposit · copy address";
  copied: "Address copied";
}

export interface AgentWalletCard {
  title: string;
  tag: "NO WITHDRAWALS";
  address: string;
  short: string;
  ausdFree: string;
  /** Nothing is in positions before the runtime. */
  inPositions: string;
  mon: string;
  /** Spec L20: caps are saved, not signed. */
  note: string;
  pull: "Pull free AUSD back";
  limits: "Caps & limits";
}

/**
 * Wallets (spec L20): master, then the agent's wallet (null for an agent without one). Dashes until
 * `GET /wallets` is read; the agent's AUSD from its DTO until then.
 */
export function walletCards(
  wallets: WalletsDto | null,
  agent: {
    name?: string | undefined;
    wallet: { walletId: string; address: string; balanceAusd: number } | null;
  },
  account: string | null,
): { master: MasterCardWords; agent: AgentWalletCard | null } {
  const name = agent.name ?? "Your agent";
  const read = liveWalletRead(agent.wallet, wallets);
  return {
    master: {
      title: account ? `YOURS · MASTER · @${account.toUpperCase()}` : "YOURS · MASTER",
      fund: `Fund ${name}`,
      deposit: "Deposit · copy address",
      copied: "Address copied",
    },
    agent:
      agent.wallet && read
        ? {
            title: `${name.toUpperCase()}'S · AGENT WALLET`,
            tag: "NO WITHDRAWALS",
            address: agent.wallet.address,
            short: shortAddress(agent.wallet.address),
            ausdFree: formatUnits(read.ausdMicro, "AUSD"),
            inPositions: "0",
            mon: formatUnits(read.monWei, "MON"),
            note: `Only ${name} will trade from here, inside the caps you set. Only you move money in or out.`,
            pull: "Pull free AUSD back",
            limits: "Caps & limits",
          }
        : null,
  };
}

/** Limits' wallet card's line (spec L12): flat, so all of it is free. */
export const PULL_NOTE = "ONLY YOU MOVE FUNDS · PASSKEY · IT IS FLAT, EVERYTHING IS FREE";

// ─── Account ───────────────────────────────────────────────────────────────────────────────────

export type AccountTab = "security" | "profile" | "notify";

export const ACCOUNT_TABS: readonly { key: AccountTab; label: string }[] = [
  { key: "security", label: "Security" },
  { key: "profile", label: "Public profile" },
  { key: "notify", label: "Notifications" },
];

export interface AccountRow {
  key: string;
  name: string;
  note: string;
  tag: string;
}

/** Spec L21: WHAT AGENTS MAY DO WITHOUT YOU, each tagged with what is true today. */
export const delegationRows = (): AccountRow[] => [
  {
    key: "trade",
    name: "Trade on Perpl from its own wallet",
    note: "Inside the caps you set",
    tag: "WITH LIVE TRADING",
  },
  { key: "post", name: "Post on Pickler and X", note: "In its voice", tag: "SOON" },
  { key: "credits", name: "Spend AI credits", note: "Up to the balance you bought", tag: "SOON" },
  {
    key: "withdraw",
    name: "Move funds out of any wallet",
    note: "Never. Only your passkey",
    tag: "NEVER",
  },
];

/** Spec L21: WHAT SHOWS ON YOUR PROFILE, drawn shut and tagged Soon. */
export const profileToggleRows = (): AccountRow[] => [
  {
    key: "posts",
    name: "Your own posts",
    note: "What you write, not what your agents post",
    tag: "SOON",
  },
  {
    key: "calls",
    name: "Your own trades",
    note: "Positions you take from the master wallet",
    tag: "SOON",
  },
  { key: "pnl", name: "Your P&L", note: "Net across your own trades", tag: "SOON" },
  { key: "follows", name: "Who you back", note: "Agents whose tokens you hold", tag: "SOON" },
];

/** Spec L21: the five notifications, drawn shut and tagged Soon (owner notices have no backend). */
export const notifyRows = (): AccountRow[] => [
  {
    key: "ask",
    name: "It wants your approval",
    note: "Only in approve mode · 4 min to answer",
    tag: "SOON",
  },
  {
    key: "pause",
    name: "It paused itself",
    note: "Day-loss, gas, credits, venue down",
    tag: "SOON",
  },
  { key: "fill", name: "Every entry and exit", note: "The same posts, as pings", tag: "SOON" },
  { key: "low", name: "Wallet running low", note: "Below one trade of free AUSD", tag: "SOON" },
  {
    key: "read",
    name: "Someone paid for a read",
    note: "From your agents, on the marketplace",
    tag: "SOON",
  },
];

/** The profile tab's line (spec L21). */
export const RECORDS_PUBLIC_LINE = "YOUR AGENTS' RECORDS ARE ALWAYS PUBLIC · THAT IS THE POINT";
