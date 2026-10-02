/**
 * The draft studio's Build sections' rules (studio-draft-dashboard-v1 §3.3, §3.5): the brief in
 * its textareas and back, the caps the agent holds, Sources & rules' form, a failed setup save in
 * words, and Limits' wallet reads. Pure, pinned in `apps/web/test/studio-draft-build.test.ts`.
 * Beside `model.ts` (whose caps stepper and brief tags these build on) so each stays one subject.
 */
import type { WalletsDto } from "@pickler/api-schema";
import {
  MAX_SITES,
  STARTER_CAPS,
  lines,
  unitsOf,
  type WalletView,
  type WebMode,
} from "../new-agent/model";
import { briefTags, type BriefText, type Caps } from "./model";

const clock = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

/** The brief as the config stores it: the thesis and the three lists, one rule per entry. */
export interface BriefLists {
  thesis: string;
  entersWhen: readonly string[];
  exitsWhen: readonly string[];
  never: readonly string[];
}

/** The brief in its four textareas: one rule per line. A config without one reads as empty. */
export const briefText = (brief: BriefLists | null | undefined): BriefText => ({
  thesis: brief?.thesis ?? "",
  enters: (brief?.entersWhen ?? []).join("\n"),
  exits: (brief?.exitsWhen ?? []).join("\n"),
  never: (brief?.never ?? []).join("\n"),
});

/** The textareas as the API takes them: the thesis trimmed, each list a trimmed line apiece. */
export const briefLists = (text: BriefText) => ({
  thesis: text.thesis.trim(),
  entersWhen: lines(text.enters),
  exitsWhen: lines(text.exits),
  never: lines(text.never),
});

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

export interface BriefView {
  tags: ReturnType<typeof briefTags>;
  /** The text saves to something other than what is saved: blank lines and edges don't count. */
  dirty: boolean;
  /** Core refuses a brief with no entry rule (`assertBrief`). */
  needsEntry: boolean;
}

export function briefView(current: BriefText, saved: BriefText): BriefView {
  const now = briefLists(current);
  const was = briefLists(saved);
  return {
    tags: briefTags(current, saved),
    dirty:
      now.thesis !== was.thesis ||
      !sameList(now.entersWhen, was.entersWhen) ||
      !sameList(now.exitsWhen, was.exitsWhen) ||
      !sameList(now.never, was.never),
    needsEntry: now.entersWhen.length === 0,
  };
}

/**
 * The caps the agent holds: the studio agent's `spend` (what Pickler enforces) before the
 * config's, and the create screen's starter caps for one it was never given.
 */
export function capsOf(input: {
  spend?: { perCallAusd: number; perDayAusd: number } | null | undefined;
  configSpend?: { perCallAusd: number; perDayAusd: number } | null | undefined;
  maxLeverage?: number | null | undefined;
}): Caps {
  const spend = input.spend ?? input.configSpend;
  return {
    perTradeAusd: spend?.perCallAusd ?? STARTER_CAPS.perTradeAusd,
    perDayAusd: spend?.perDayAusd ?? STARTER_CAPS.perDayAusd,
    maxLeverage: input.maxLeverage ?? STARTER_CAPS.maxLeverage,
  };
}

/** Sources & rules' form: the web switch, where it may look, and its sites. */
export interface WebForm {
  on: boolean;
  mode: WebMode;
  sites: string[];
}

/** The config's `sources.web` as the form holds it; off reads as "Anywhere" with no sites. */
export const webForm = (web: { mode: WebMode; sites: readonly string[] } | null | undefined) => ({
  on: Boolean(web),
  mode: web?.mode ?? "anywhere",
  sites: [...(web?.sites ?? [])],
});

export interface SourcesView {
  tag: "PERPL + WEB" | "PERPL ONLY";
  /** The sites line under the box: the add's error first, then the limit, "Only" without a site. */
  note: { text: string; bad: boolean };
  dirty: boolean;
  /** "Only these" with no site would let it read nothing. */
  needsSite: boolean;
  /** What `PUT /setup` takes. */
  sources: { web: { mode: WebMode; sites: string[] } | null };
}

export function sourcesView(current: WebForm, saved: WebForm, error: string | null): SourcesView {
  const needsSite = current.on && current.mode === "only" && current.sites.length === 0;
  let note = { text: `${current.sites.length} OF ${MAX_SITES} · ENTER TO ADD`, bad: false };
  if (error) {
    note = { text: error, bad: true };
  } else if (current.sites.length >= MAX_SITES) {
    note = { text: `${MAX_SITES} SITES IS THE LIMIT`, bad: false };
  } else if (needsSite) {
    note = { text: "“ONLY” NEEDS AT LEAST ONE SITE", bad: true };
  }
  const dirty =
    current.on !== saved.on ||
    (current.on && (current.mode !== saved.mode || !sameList(current.sites, saved.sites)));
  return {
    tag: current.on ? "PERPL + WEB" : "PERPL ONLY",
    note,
    dirty,
    needsSite,
    sources: { web: current.on ? { mode: current.mode, sites: [...current.sites] } : null },
  };
}

/** Spec §3.5: a stale save reloads the agent and says so. */
export const CONFLICT_LINE = "It changed somewhere else. Reloaded.";

/** What a failed `PUT /setup` shows, by the API's error code. */
export type SetupProblem =
  { kind: "conflict" } | { kind: "preview" } | { kind: "error"; text: string };

export function setupProblem(code: string, fallback: string): SetupProblem {
  if (code === "CONFLICT" || code === "STALE_CONFIG") {
    return { kind: "conflict" };
  }
  if (code === "PREVIEW") {
    return { kind: "preview" };
  }
  return { kind: "error", text: fallback };
}

/**
 * This agent's wallet in a `GET /wallets` read, as `arrived` compares two of them; null until read
 * or when the read does not list it.
 */
export function agentWalletRead(wallets: WalletsDto | null, walletId: string): WalletView | null {
  const read = wallets?.agents.find((entry) => entry.walletId === walletId);
  return read
    ? {
        walletId: read.walletId,
        address: read.address,
        ausdMicro: unitsOf(read.ausdMicro),
        monWei: unitsOf(read.monWei),
      }
    : null;
}

/** "LAST CHECKED hh:mm" in local time for a read's `readAt`, or that it has not been read. */
export const checkedLabel = (readAt: number | null): string =>
  readAt === null ? "NOT CHECKED YET" : `LAST CHECKED ${clock(new Date(readAt))}`;

/** A read's time as an arrival's stamp ("hh:mm", local). */
export const readClock = (readAt: number): string => clock(new Date(readAt));
