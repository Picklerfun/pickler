// apps/web/src/features/studio/draft/model.ts
/**
 * The draft studio's shell and Overview rules (docs/specs/studio-draft-dashboard-v1.md, the
 * "Pickler Studio Draft" canvas): the rail and its locks, the header tiles, Go Public's state, the
 * publish blockers' words, and Overview's wallet card and activity. The caps are `caps-model.ts`'s,
 * the Run and YOU sections' rules `run-model.ts`'s. What the live studio shares is in `../shell/`:
 * Connect X's card (`x-model.ts`), Identity & voice (`identity-model.ts`), the brief and sources
 * (`build-model.ts`), the ledger (`wallet-model.ts`) and every clock (`clock.ts`). Pure, no React
 * and no transport, so each rule is pinned in `apps/web/test/studio-draft-model.test.ts`.
 *
 * Section keys are the canvas's (`picks` is Trades, `skills` is Sources & rules).
 */
import type { PerpsPositionsResponseDto, PublishBlockerDto, WalletsDto } from "@pickler/api-schema";
import { formatSignedTwo, formatTwo } from "../../agents/lib/format";
import { formatUnits, shortAddress, unitsOf } from "../new-agent/model";
import { agentWalletRead } from "../shell/build-model";
import { dayLabel, dayNumber, stamp } from "../shell/clock";
import type { HeaderTile, RailGroup, RailItem } from "../shell/model";
import type { Caps } from "./caps-model";

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

/** A draft rail item: the shell's, with its icon, its lock and its hover title always set. */
export interface DraftRailItem extends RailItem<DraftSectionKey> {
  icon: DraftIcon;
  locked: boolean;
  /** The hover title: a locked item says when it opens. */
  title: string;
}

/** The rail with the current section on and its locked items marked. */
export const draftRail = (
  current: DraftSectionKey,
): (RailGroup<DraftSectionKey> & { items: DraftRailItem[] })[] =>
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

/**
 * IN YOUR POSITIONS and OPEN P&L from the draft's open paper positions (perpl-paper-runtime-v1
 * R17): the margin they hold and their P&L at the board's marks, a dash while a mark is unknown;
 * "Soon" while it holds none.
 */
function paperTiles(positions: PerpsPositionsResponseDto | null): HeaderTile[] {
  const open = positions?.open ?? [];
  if (open.length === 0) {
    return [
      { label: "IN YOUR POSITIONS · AUSD", value: "Soon", soon: true },
      { label: "OPEN P&L · AUSD", value: "Soon", soon: true },
    ];
  }
  const margin = open.reduce((sum, p) => sum + Number(p.margin), 0);
  const marks = open.map((p) => (p.unrealizedPnl === null ? null : Number(p.unrealizedPnl)));
  const pnl = marks.some((value) => value === null)
    ? "—"
    : formatSignedTwo(Math.round(marks.reduce<number>((sum, v) => sum + (v ?? 0), 0) * 100) / 100);
  return [
    { label: "IN YOUR POSITIONS · PAPER · AUSD", value: formatTwo(margin), soon: false },
    { label: "OPEN P&L · PAPER · AUSD", value: pnl, soon: false },
  ];
}

/**
 * The header's five tiles: master and the agents' wallets are read from `GET /wallets`; IN YOUR
 * POSITIONS and OPEN P&L from its open paper positions once it holds one (`paperTiles`), else
 * "Soon"; AI CREDITS "Soon". Dashes while the wallets are unread, and when any agent wallet's chain
 * read failed, because a total with a hole in it is not a smaller total.
 */
export function headerTiles(
  wallets: WalletsDto | null,
  positions: PerpsPositionsResponseDto | null = null,
): HeaderTile[] {
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
    { label: "MASTER WALLET · AUSD", value: master, soon: false },
    { label: "IN AGENT WALLETS · AUSD", value: inAgents, soon: false },
    ...paperTiles(positions),
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
  /** Spliced into "it shows on Pickler{xNote}" and the live button (D19). */
  xNote: string;
}

/**
 * Go Public is one task, Connect X, which can be skipped (spec D3; the skip is a screen choice,
 * not stored). The button opens when the task is done or skipped.
 */
export function goPublicView(input: {
  xHandle: string | null;
  skipped: boolean;
  publishing: boolean;
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
  };
}

/** api-schema's `PUBLISH_BLOCKERS`, as a type: the web keeps no list of its own. */
export type PublishBlocker = PublishBlockerDto;

/**
 * Each blocker's words. A `Record` over api-schema's type, so a blocker added there fails the
 * build here until it has words; it is also the set `publishProblem` accepts.
 */
const PUBLISH_BLOCKER_TEXT: Record<PublishBlocker, string> = {
  KILLED: "It has been shut down, so it can't go public.",
  WALLET: "It needs its own wallet to go public.",
  FUNDS: "Its wallet needs at least 10 AUSD to go public.",
};

/** The 409 `PUBLISH_BLOCKED` blockers in words (spec §3.1); only FUNDS has a fix on the screen. */
export function publishBlockedCopy(
  blockers: readonly PublishBlocker[],
): { blocker: PublishBlocker; text: string; fund: boolean }[] {
  return blockers.map((blocker) => ({
    blocker,
    text: PUBLISH_BLOCKER_TEXT[blocker],
    fund: blocker === "FUNDS",
  }));
}

/** What Go Public shows when `POST /publish` fails. */
export type PublishProblem =
  | { kind: "blocked"; lines: ReturnType<typeof publishBlockedCopy> }
  | { kind: "preview" }
  | { kind: "error"; text: string };

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
      ? raw.filter(
          (blocker): blocker is PublishBlocker =>
            typeof blocker === "string" && Object.hasOwn(PUBLISH_BLOCKER_TEXT, blocker),
        )
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
 * Overview's wallet card, read as Limits reads it: AUSD and MON from `GET /wallets` once read,
 * the AUSD from the studio agent's `wallet.balanceAusd` until then (MON a dash until read, or when
 * the chain did not answer), and its caps as `capsOf` gives them, "STARTER CAPS" for the starter
 * caps it was never given. Null for a draft without a wallet (spec §3.1).
 */
export function walletCardView(
  wallet: { walletId: string; address: string; balanceAusd: number } | null,
  caps: { caps: Caps; starter: boolean },
  wallets: WalletsDto | null,
): WalletCardView | null {
  if (!wallet) {
    return null;
  }
  const read = agentWalletRead(wallets, wallet.walletId);
  const ausdMicro = read?.ausdMicro ?? BigInt(Math.round(wallet.balanceAusd * 1_000_000));
  const monWei = read?.monWei ?? null;
  const { perTradeAusd, perDayAusd, maxLeverage } = caps.caps;
  const capsLabel = caps.starter ? "STARTER CAPS" : "CAPS";
  return {
    address: wallet.address,
    short: shortAddress(wallet.address),
    caps: `${capsLabel} ${perTradeAusd} / ${perDayAusd} / ${maxLeverage}×`,
    ausd: formatUnits(ausdMicro, "AUSD"),
    mon: formatUnits(monWei, "MON"),
    ausdFunded: ausdMicro > 0n,
    monFunded: monWei !== null && monWei > 0n,
  };
}

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
  const rows = events.map((event) => ({
    kind: event.kind,
    text: event.text,
    at: stamp(new Date(event.at), now),
    iso: event.at,
  }));
  const newest = events[0] ? new Date(events[0].at) : null;
  return {
    label: !newest || dayNumber(newest) === today ? "TODAY" : dayLabel(newest),
    rows,
  };
}
