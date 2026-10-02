// apps/web/src/features/studio/draft/model.ts
/**
 * The draft studio's shell and Overview rules (docs/specs/studio-draft-dashboard-v1.md, the
 * "Pickler Studio Draft" canvas): the rail and its locks, the header tiles, Go Public's state,
 * Connect X's card, the publish blockers' words, Overview's wallet card and activity, and Identity
 * & voice's name, voice and X account. The Build sections' rules are `build-model.ts`'s, the Run
 * and YOU sections' `run-model.ts`'s, and every clock is `clock.ts`'s. Pure, no React and no
 * transport, so each rule is pinned in `apps/web/test/studio-draft-model.test.ts`.
 *
 * Section keys are the canvas's (`picks` is Trades, `skills` is Sources & rules).
 */
import type { PublishBlockerDto, WalletsDto } from "@pickler/api-schema";
import { formatUnits, shortAddress, unitsOf, VOICES, type VoiceKey } from "../new-agent/model";
import { agentWalletRead, type Caps } from "./build-model";
import { dayLabel, dayNumber, stamp } from "./clock";

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
  /** The last "Check again" did not find the post. */
  missed: boolean;
}

export interface XView {
  button: "Verify" | "Checking…" | "Check again";
  disabled: boolean;
  /** `missed` is the last check's answer, said inside the block so it is announced. */
  miss: { title: string; line: string; hint: string; missed: string | null } | null;
  unavailable: string | null;
  taken: string | null;
}

/** The last check's answer when the post was not there. */
export const X_NOT_FOUND_LINE = "Not found yet. Post the line, then check again.";

/**
 * Connect X's card: "Verify" asks for a challenge and shows the line to post (spec §3.1); with one
 * issued the button reads "Check again" and the miss block stays until the post is found. A handle
 * typed since (`typed`, as `xHandleInput` reads it) that is not the challenge's gets a new line, so
 * the button says Verify again.
 */
export function xView(state: XCardState, typed: string | null = null): XView {
  const { challenge } = state;
  const sameHandle =
    challenge !== null &&
    (typed === null || typed.toLowerCase() === challenge.handle.toLowerCase());
  let button: XView["button"] = "Verify";
  if (state.checking) {
    button = "Checking…";
  } else if (challenge && sameHandle) {
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
            missed: state.missed && sameHandle ? X_NOT_FOUND_LINE : null,
          }
        : null,
    unavailable: state.unavailable ? X_UNAVAILABLE_LINE : null,
    taken: state.taken ? `@${state.taken} is already another agent's.` : null,
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

/* ---------- Identity & voice (spec D14, §3.2) ---------- */

/** The name's bounds, as `PUT /identity` holds them: 1–40 once trimmed. */
export const NAME_MAX = 40;

/**
 * What leaving the NAME box does: nothing when the trimmed name is the saved one (no request),
 * the reason when it is out of bounds, else the trimmed name to save.
 */
export function nameChange(
  saved: string | undefined,
  typed: string,
): { kind: "same" } | { kind: "bad"; text: string } | { kind: "save"; name: string } {
  const name = typed.trim();
  if (name === (saved ?? "").trim()) {
    return { kind: "same" };
  }
  if (!name) {
    return { kind: "bad", text: "IT NEEDS A NAME" };
  }
  if (name.length > NAME_MAX) {
    return { kind: "bad", text: `${NAME_MAX} CHARACTERS AT MOST` };
  }
  return { kind: "save", name };
}

/** The voice the config holds, or the first (Analyst) for a config without one. */
export const voiceOf = (voice: string | undefined): VoiceKey =>
  VOICES.find((option) => option.key === voice)?.key ?? "analyst";

/** The X ACCOUNT card's tag. */
export const xAccountTag = (handle: string | null): "CONNECTED" | "NOT CONNECTED" =>
  handle ? "CONNECTED" : "NOT CONNECTED";

/** DISCONNECT refused, in words: a public agent keeps its account (D6); anything else as said. */
export const disconnectProblem = (code: string, fallback: string): string =>
  code === "X_ON_PUBLIC_AGENT" ? "A public agent keeps its X account." : fallback;
