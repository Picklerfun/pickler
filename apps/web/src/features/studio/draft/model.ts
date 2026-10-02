// apps/web/src/features/studio/draft/model.ts
/**
 * The draft studio's rules (docs/specs/studio-draft-dashboard-v1.md, the "Pickler Studio Draft"
 * canvas): the rail and its locks, the header tiles, Go Public's state, Connect X's card, the
 * publish blockers' words, the caps steppers, the brief's tags, the sources list and the schedule's
 * next runs. Pure, no React and no transport, so each rule is pinned in
 * `apps/web/test/studio-draft-model.test.ts`.
 *
 * Section keys are the canvas's (`picks` is Trades, `skills` is Sources & rules).
 */
import type { WalletsDto } from "@pickler/api-schema";
import {
  LEVERAGE_BOUNDS,
  MAX_SITES,
  SPEND_BOUNDS,
  formatUnits,
  lines,
  shortAddress,
  siteHost,
  unitsOf,
} from "../new-agent/model";

export type DraftSectionKey =
  | "overview"
  | "console"
  | "picks"
  | "activity"
  | "brief"
  | "skills"
  | "limits"
  | "identity"
  | "profile"
  | "trade"
  | "master";

export type DraftIcon =
  | "grid"
  | "chat"
  | "target"
  | "activity"
  | "file"
  | "sliders"
  | "wallet"
  | "user"
  | "globe"
  | "coin";

const SECTION_LABELS: Record<DraftSectionKey, string> = {
  overview: "Overview",
  console: "Console",
  picks: "Trades",
  activity: "Activity",
  brief: "Brief",
  skills: "Sources & rules",
  limits: "Limits & funding",
  identity: "Identity & voice",
  profile: "Public profile",
  trade: "Trade",
  master: "Master wallet",
};

/** Sections that open once the agent is public (spec D2): the canvas's `OPEN_SECTIONS` leaves them out. */
const LOCKED: readonly DraftSectionKey[] = ["activity", "profile"];

export const sectionLabel = (key: DraftSectionKey): string => SECTION_LABELS[key];

const item = (key: DraftSectionKey, icon: DraftIcon) => ({
  key,
  icon,
  label: SECTION_LABELS[key],
  locked: LOCKED.includes(key),
});

export const DRAFT_SECTIONS = [
  {
    title: "RUN",
    items: [
      item("overview", "grid"),
      item("console", "chat"),
      item("picks", "target"),
      item("activity", "activity"),
    ],
  },
  {
    title: "BUILD",
    items: [
      item("brief", "file"),
      item("skills", "sliders"),
      item("limits", "wallet"),
      item("identity", "user"),
    ],
  },
  { title: "GROW", items: [item("profile", "globe")] },
  { title: "YOU", items: [item("trade", "coin"), item("master", "wallet")] },
] as const;

export interface RailItem {
  key: DraftSectionKey;
  icon: DraftIcon;
  label: string;
  locked: boolean;
  /** The current section. */
  on: boolean;
  /** The hover title: a locked item says when it opens. */
  title: string;
}

/** The rail with the current section on and its locked items marked. */
export const draftRail = (current: DraftSectionKey): { title: string; items: RailItem[] }[] =>
  DRAFT_SECTIONS.map((group) => ({
    title: group.title,
    items: group.items.map((entry) => ({
      ...entry,
      on: entry.key === current,
      title: entry.locked ? "Opens when it's public" : entry.label,
    })),
  }));

export const isLockedSection = (key: DraftSectionKey): boolean => LOCKED.includes(key);

/** The locked panel's line. */
export const lockedCopy = (key: DraftSectionKey): string =>
  `${SECTION_LABELS[key]} opens when it's public.`;

export interface HeaderTile {
  label: string;
  value: string;
  /** Not built yet: drawn as "Soon", never as a number (spec D15). */
  soon: boolean;
}

/**
 * The header's five tiles: master and the agents' wallets are read from `GET /wallets`, the other
 * three read "Soon". Dashes while the wallets are unread, and when any agent wallet's chain read
 * failed, because a total with a hole in it is not a smaller total.
 */
export function headerTiles(wallets: WalletsDto | null): HeaderTile[] {
  let master = "—";
  let inAgents = "—";
  if (wallets) {
    master = formatUnits(unitsOf(wallets.master.ausdMicro), "AUSD");
    const balances = wallets.agents.map((agent) => unitsOf(agent.ausdMicro));
    inAgents = balances.some((balance) => balance === null)
      ? "—"
      : formatUnits(
          balances.reduce<bigint>((sum, balance) => sum + (balance ?? 0n), 0n),
          "AUSD",
        );
  }
  return [
    { label: "MASTER · AUSD", value: master, soon: false },
    { label: "IN AGENT WALLETS · AUSD", value: inAgents, soon: false },
    { label: "IN YOUR POSITIONS · AUSD", value: "Soon", soon: true },
    { label: "OPEN P&L · AUSD", value: "Soon", soon: true },
    { label: "AI CREDITS", value: "Soon", soon: true },
  ];
}

export interface GoPublicView {
  title: "GO PUBLIC";
  done: 0 | 1;
  of: 1;
  task: { title: "Connect X"; meta: string; done: boolean };
  canPublish: boolean;
  label: string;
  skipLabel: string;
  /** Spliced into "its calls post on Pickler{xNote}". */
  xNote: string;
  error: string | null;
}

/**
 * Go Public is one task, Connect X, which can be skipped (spec D3; the skip is a screen choice,
 * not stored). The button opens when the task is done or skipped.
 */
export function goPublicView(input: {
  xHandle: string | null;
  skipped: boolean;
  publishing: boolean;
  error: string | null;
}): GoPublicView {
  const done = input.xHandle !== null;
  const open = done || input.skipped;
  const canPublish = open && !input.publishing;
  let label = "Connect X to go public";
  if (input.publishing) {
    label = "Going public…";
  } else if (open) {
    label = "Go public";
  }
  let skipLabel = "SKIP X FOR NOW · IT POSTS ON PICKLER ONLY";
  if (done) {
    skipLabel = "";
  } else if (input.skipped) {
    skipLabel = "POSTS ON PICKLER ONLY · UNDO";
  }
  return {
    title: "GO PUBLIC",
    done: done ? 1 : 0,
    of: 1,
    task: {
      title: "Connect X",
      meta: input.xHandle ? `@${input.xHandle.toUpperCase()}` : "WHERE IT POSTS",
      done,
    },
    canPublish,
    label,
    skipLabel,
    xNote: done ? " and X" : "",
    error: input.error,
  };
}

/** Spec D5: nothing pretends to verify without Pickler's X app. */
export const X_UNAVAILABLE_LINE =
  "X verification isn't open yet. Skip it for now; you can connect X later in Identity & voice.";

export interface XCardState {
  /** The issued challenge: the handle it was issued for and the line to post. */
  challenge: { handle: string; text: string } | null;
  checking: boolean;
  /** The API answered 503 `X_UNAVAILABLE`. */
  unavailable: boolean;
  /** The handle the API said is another agent's (409 `X_HANDLE_TAKEN`). */
  taken: string | null;
}

export interface XView {
  button: "Verify" | "Checking…" | "Check again";
  disabled: boolean;
  miss: { title: string; line: string; hint: string } | null;
  unavailable: string | null;
  taken: string | null;
}

/**
 * Connect X's card: "Verify" asks for a challenge and shows the line to post (spec §3.1); with one
 * issued the button reads "Check again" and the miss block stays until the post is found.
 */
export function xView(state: XCardState): XView {
  const { challenge } = state;
  let button: XView["button"] = "Verify";
  if (state.checking) {
    button = "Checking…";
  } else if (challenge) {
    button = "Check again";
  }
  return {
    button,
    disabled: state.checking,
    miss:
      challenge && !state.unavailable
        ? {
            title: "We couldn't find the post yet.",
            line: challenge.text,
            hint: `POST THIS FROM @${challenge.handle.toUpperCase()} · THEN CHECK AGAIN`,
          }
        : null,
    unavailable: state.unavailable ? X_UNAVAILABLE_LINE : null,
    taken: state.taken ? `@${state.taken} is already another agent's.` : null,
  };
}

export type PublishBlocker = "KILLED" | "WALLET" | "FUNDS";

/** The 409 `PUBLISH_BLOCKED` blockers in words (spec §3.1); only FUNDS has a fix on the screen. */
export function publishBlockedCopy(
  blockers: readonly PublishBlocker[],
): { blocker: PublishBlocker; text: string; fund: boolean }[] {
  const text: Record<PublishBlocker, string> = {
    KILLED: "It has been shut down, so it can't go public.",
    WALLET: "It needs its own wallet to go public.",
    FUNDS: "Its wallet needs at least 10 AUSD to go public.",
  };
  return blockers.map((blocker) => ({ blocker, text: text[blocker], fund: blocker === "FUNDS" }));
}

export interface Caps {
  perTradeAusd: number;
  perDayAusd: number;
  maxLeverage: number;
}

/* The canvas's steps and floors; the ceilings are core's bounds, so + and − never reach a value
   the API would refuse. */
const CAP_ROWS = [
  {
    key: "perTradeAusd",
    title: "PER TRADE",
    unit: " AUSD",
    step: 5,
    min: 5,
    max: SPEND_BOUNDS.perCallAusd.max,
  },
  {
    key: "perDayAusd",
    title: "PER DAY",
    unit: " AUSD",
    step: 10,
    min: 10,
    max: SPEND_BOUNDS.perDayAusd.max,
  },
  {
    key: "maxLeverage",
    title: "MAX LEVERAGE",
    unit: "×",
    step: 1,
    min: LEVERAGE_BOUNDS.min,
    max: LEVERAGE_BOUNDS.max,
  },
] as const;

export interface CapRow {
  key: keyof Caps;
  title: string;
  value: number;
  display: string;
  /** The value one step down or up, or null at the floor or ceiling. */
  prev: number | null;
  next: number | null;
}

export interface CapsView {
  rows: CapRow[];
  dirty: boolean;
  tag: "SAVED" | "UNSAVED CHANGES";
  /** A day's cap below one trade's: the caps contradict each other (core refuses it). */
  inverted: boolean;
  canSave: boolean;
}

export function capsStepper(current: Caps, saved: Caps): CapsView {
  const rows = CAP_ROWS.map((row) => {
    const value = current[row.key];
    return {
      key: row.key,
      title: row.title,
      value,
      display: `${value}${row.unit}`,
      prev: value > row.min ? Math.max(row.min, value - row.step) : null,
      next: value < row.max ? Math.min(row.max, value + row.step) : null,
    };
  });
  const dirty = CAP_ROWS.some((row) => current[row.key] !== saved[row.key]);
  const inverted = current.perDayAusd < current.perTradeAusd;
  return {
    rows,
    dirty,
    tag: dirty ? "UNSAVED CHANGES" : "SAVED",
    inverted,
    canSave: dirty && !inverted,
  };
}

export interface BriefText {
  thesis: string;
  enters: string;
  exits: string;
  never: string;
}

export type BriefKey = keyof BriefText;

/**
 * Each section's tag (the canvas's `sections`): EMPTY, or the line count of the three lists, then
 * EDITED against the saved text or DEFAULT when it matches. The thesis has no count. `edited`
 * lights the tag.
 */
export function briefTags(
  brief: BriefText,
  saved: BriefText,
): Record<BriefKey, { text: string; edited: boolean }> {
  const tag = (key: BriefKey) => {
    const value = brief[key];
    if (!value.trim()) {
      return { text: "EMPTY", edited: false };
    }
    const edited = value.trim() !== saved[key].trim();
    const state = edited ? "EDITED" : "DEFAULT";
    if (key === "thesis") {
      return { text: state, edited };
    }
    const count = lines(value).length;
    return { text: `${count} ${count === 1 ? "LINE" : "LINES"} · ${state}`, edited };
  };
  return { thesis: tag("thesis"), enters: tag("enters"), exits: tag("exits"), never: tag("never") };
}

/**
 * Adding a typed site (the canvas's `addSite`): the bare host is added; anything else stays in the
 * box, as the host it would be, with the reason. An empty box does nothing.
 */
export function addSite(
  sites: readonly string[],
  draft: string,
): { sites: string[]; draft: string; error: string | null } {
  const unchanged = (error: string | null, next = draft) => ({
    sites: [...sites],
    draft: next,
    error,
  });
  if (!draft.trim()) {
    return unchanged(null);
  }
  const host = siteHost(draft);
  if (!host) {
    return unchanged("BARE HOSTNAMES ONLY · NO HTTPS, NO PATHS");
  }
  if (sites.includes(host)) {
    return unchanged("ALREADY LISTED", host);
  }
  if (sites.length >= MAX_SITES) {
    return unchanged(`${MAX_SITES} SITES IS THE LIMIT`, host);
  }
  return { sites: [...sites, host], draft: "", error: null };
}

/** The schedule's choices (spec D13), not the canvas's 1 / 6 / 12 / 24. */
export const INTERVAL_OPTIONS = [3, 6, 12, 24] as const;

export const runsPerDay = (intervalHours: number): number =>
  Math.max(1, Math.round(24 / intervalHours));

const clock = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const dayNumber = (date: Date): number =>
  Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

/**
 * The next three runs, an interval apart from `now`, in local time: "TMRW" the next calendar day,
 * "+nD" beyond it (the canvas says TMRW for any other day).
 */
export function nextRuns(intervalHours: number, now: Date): { label: string; at: string }[] {
  return [1, 2, 3].map((n) => {
    const at = new Date(now.getTime() + n * intervalHours * 3_600_000);
    const days = dayNumber(at) - dayNumber(now);
    let suffix = "";
    if (days === 1) {
      suffix = " · TMRW";
    } else if (days > 1) {
      suffix = ` · +${days}D`;
    }
    return {
      label: n === 1 ? "First run after go public" : "Then · reads sources, decides, posts",
      at: `${clock(at)}${suffix}`,
    };
  });
}

/**
 * The handle as typed, without its "@", or null when X would not take it: core's `parseXHandle`
 * rule (1 to 15 letters, digits or _), mirrored so Verify can say so before anything is sent. The
 * server parses it again and decides.
 */
export function xHandleInput(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/** What Connect X shows for a failed challenge or check, by the API's error code. */
export type XProblem =
  /** 503 X_UNAVAILABLE: spec D5's line, in the card's own place for it. */
  | { kind: "unavailable" }
  /** 409 X_HANDLE_TAKEN: the card's taken line for this handle. */
  | { kind: "taken"; handle: string }
  /** The challenge lapsed or is gone: drop it, so the button reads Verify again, and say why. */
  | { kind: "expired"; text: string }
  /** A staged or preview studio: nothing is sent, the caller shows the preview note. */
  | { kind: "preview" }
  | { kind: "error"; text: string };

export function xProblem(code: string, handle: string, fallback: string): XProblem {
  switch (code) {
    case "X_UNAVAILABLE":
      return { kind: "unavailable" };
    case "X_HANDLE_TAKEN":
      return { kind: "taken", handle };
    case "TOO_MANY_CHECKS":
      return { kind: "error", text: "Wait a few seconds, then check again." };
    case "INVALID_X_HANDLE":
      return { kind: "error", text: "That isn't an X handle." };
    case "CHALLENGE_EXPIRED":
    case "CHALLENGE_NOT_FOUND":
      return { kind: "expired", text: "That line has lapsed. Press Verify for a new one." };
    case "X_ALREADY_CONNECTED":
      return { kind: "error", text: "It already has an X account." };
    case "PREVIEW":
      return { kind: "preview" };
    default:
      return { kind: "error", text: fallback };
  }
}

/** What Go Public shows when `POST /publish` fails. */
export type PublishProblem =
  | { kind: "blocked"; lines: ReturnType<typeof publishBlockedCopy> }
  | { kind: "preview" }
  | { kind: "error"; text: string };

const PUBLISH_BLOCKER_SET: readonly string[] = ["KILLED", "WALLET", "FUNDS"];

/**
 * A failed Go Public in words: 409 PUBLISH_BLOCKED names its blockers (`detail.blockers`, the
 * ones this screen knows; none known reads as the fallback), PUBLISH_CONFLICT asks for another
 * try, and an unread wallet balance (503) is never told as too little money.
 */
export function publishProblem(
  code: string,
  details: Record<string, unknown> | undefined,
  fallback: string,
): PublishProblem {
  if (code === "PREVIEW") {
    return { kind: "preview" };
  }
  if (code === "PUBLISH_BLOCKED") {
    const detail = details?.detail;
    const raw =
      detail && typeof detail === "object" ? (detail as { blockers?: unknown }).blockers : null;
    const blockers = Array.isArray(raw)
      ? raw.filter((blocker): blocker is PublishBlocker => PUBLISH_BLOCKER_SET.includes(blocker))
      : [];
    if (blockers.length > 0) {
      return { kind: "blocked", lines: publishBlockedCopy(blockers) };
    }
    return { kind: "error", text: fallback };
  }
  if (code === "PUBLISH_CONFLICT") {
    return { kind: "error", text: "Something changed while it went public. Try again." };
  }
  if (code === "BALANCES_UNAVAILABLE" || code === "WALLETS_UNAVAILABLE" || code === "503") {
    return { kind: "error", text: "Couldn't read its wallet. Try again." };
  }
  return { kind: "error", text: fallback };
}

export interface WalletCardView {
  address: string;
  short: string;
  caps: string;
  ausd: string;
  mon: string;
  /** Lit when it holds any: the canvas draws a funded balance lime. */
  ausdFunded: boolean;
  monFunded: boolean;
}

/**
 * Overview's wallet card: the agent's own AUSD (the studio agent's `wallet.balanceAusd`), its MON
 * from `GET /wallets` (a dash until read, or when the chain did not answer), and its caps (a dash
 * for one it has none of, never a default it was not given). Null
 * for a draft without a wallet (spec §3.1).
 */
export function walletCardView(
  wallet: { walletId: string; address: string; balanceAusd: number } | null,
  caps: { [K in keyof Caps]: number | undefined },
  wallets: WalletsDto | null,
): WalletCardView | null {
  if (!wallet) {
    return null;
  }
  const ausdMicro = BigInt(Math.round(wallet.balanceAusd * 1_000_000));
  const read = wallets?.agents.find((entry) => entry.walletId === wallet.walletId);
  const monWei = read ? unitsOf(read.monWei) : null;
  return {
    address: wallet.address,
    short: shortAddress(wallet.address),
    caps: `CAPS ${caps.perTradeAusd ?? "—"} / ${caps.perDayAusd ?? "—"} / ${caps.maxLeverage ?? "—"}×`,
    ausd: formatUnits(ausdMicro, "AUSD"),
    mon: formatUnits(monWei, "MON"),
    ausdFunded: ausdMicro > 0n,
    monFunded: monWei !== null && monWei > 0n,
  };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const dayLabel = (date: Date): string => `${MONTHS[date.getMonth()]} ${date.getDate()}`;

export interface ActivityRow {
  kind: "created" | "wallet" | "transfer";
  text: string;
  /** "hh:mm" today, the day ("OCT 1") before it, in local time. */
  at: string;
  iso: string;
}

/**
 * Overview's Activity (spec D18): the API's events as they come, newest first, each with its time;
 * the heading reads TODAY while the newest is from today, else that day.
 */
export function activityView(
  events: readonly { kind: ActivityRow["kind"]; text: string; at: string }[],
  now: Date,
): { label: string; rows: ActivityRow[] } {
  const today = dayNumber(now);
  const rows = events.map((event) => {
    const at = new Date(event.at);
    return {
      kind: event.kind,
      text: event.text,
      at: dayNumber(at) === today ? clock(at) : dayLabel(at),
      iso: event.at,
    };
  });
  const newest = events[0] ? new Date(events[0].at) : null;
  return {
    label: !newest || dayNumber(newest) === today ? "TODAY" : dayLabel(newest),
    rows,
  };
}
