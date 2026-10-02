/**
 * The Build sections' rules both studios share (studio-draft-dashboard-v1 §3.3, §3.5; studio-live-v1
 * L2): a stepper's row, the brief in its textareas and back with its tags, Sources & rules' form and
 * its sites, a failed setup save in words, and an agent wallet's read. The draft's three caps are
 * `draft/caps-model.ts`'s. Pure, pinned in `apps/web/test/studio-draft-build.test.ts` and
 * `studio-draft-model.test.ts`.
 */
import type { WalletsDto } from "@pickler/api-schema";
import {
  MAX_SITES,
  lines,
  siteHost,
  unitsOf,
  type WalletView,
  type WebMode,
} from "../new-agent/model";
import { clock } from "./clock";

/** One stepper row (`CapSteppers` in `build-parts.tsx`): a cap with − and +, whatever its key. */
export interface CapRow<K extends string = string> {
  key: K;
  title: string;
  value: number;
  display: string;
  /** The value one step down or up, or null at the floor or ceiling. */
  prev: number | null;
  next: number | null;
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
 * box, as the host it would be, with the reason. An empty box does nothing. Unlike the canvas,
 * text that is no host at all stays as typed (there is no host to put back), so it can be fixed.
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
  if (code === "CONFLICT") {
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

/** A read's time as an arrival's stamp ("hh:mm", local). */
export const readClock = (readAt: number): string => clock(new Date(readAt));
