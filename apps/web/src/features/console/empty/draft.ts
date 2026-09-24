/**
 * The draft an agent is before it exists.
 *
 * `Pickler Studio Empty.dc.html` draws five steps, and four of the five collect something the API
 * actually stores: the name, the handle derived from it, the beat that becomes a market scope, and
 * the edge that becomes the profile. This module is those rules and nothing else — no React, no
 * transport — so each one can be pinned on its own rather than through a rendered step.
 *
 * What the canvas draws that the product cannot store is named here too, in `UNBACKED`, because a
 * field with nowhere to go is a fact about the screen and not a detail of one component.
 */
import type { Config, Profile } from "../api";

/** The four the market catalog carries. The API takes these ids and no others. */
export type Sport = Extract<NonNullable<Config["marketScope"]>["subcategories"], string[]>[number];

export const STEPS = ["start", "name", "beat", "edge", "run"] as const;
export type Step = (typeof STEPS)[number];

/** The canvas's eight beats. One of them has a market catalog behind it. */
export const BEATS = [
  { name: "Sports", swatch: "lime", category: "sports" },
  { name: "Crypto", swatch: "blue", category: null },
  { name: "Politics", swatch: "violet", category: null },
  { name: "Economics", swatch: "amber", category: null },
  { name: "Culture", swatch: "orange", category: null },
  { name: "Tech & Science", swatch: "indigo", category: null },
  { name: "World", swatch: "magenta", category: null },
  { name: "Weather", swatch: "soft", category: null },
] as const;

/** The swatches a beat, a voice or a block can be drawn in: §4's agent palette, plus a quiet one. */
export type Swatch = (typeof BEATS)[number]["swatch"];

export type BeatName = (typeof BEATS)[number]["name"];

/**
 * Fields the canvas collects that no endpoint stores. Kept as data so the screen can mark each one
 * where it is drawn, rather than each component deciding on its own what to admit to.
 */
export const UNBACKED = {
  ticker: "Tickers are not reserved anywhere yet — there is no curve and no contract behind one.",
  voice: "Voice is not modelled. Today the brief is the only thing that shapes how it reads.",
  x: "There is no account-linking endpoint, so a handle typed here is not verified or stored.",
  wallet: "Agent sub-wallets are specification two of the custody work. Nothing signs this yet.",
  fund: "Funding an agent needs its wallet first, and that wallet does not exist.",
} as const;

export type Draft = {
  prompt: string;
  name: string;
  ticker: string;
  tickerTouched: boolean;
  beat: BeatName | "";
  sports: Sport[];
  why: string;
};

export const emptyDraft = (): Draft => ({
  prompt: "",
  name: "",
  ticker: "",
  tickerTouched: false,
  beat: "",
  sports: [],
  why: "",
});

/** The longest the edge may run. The canvas counts against 140; the API allows 4,000. */
export const EDGE_MAX = 140;

/**
 * The ticker the canvas suggests from a name — first four letters, upper case. It is a suggestion
 * and stays one: nothing reserves it, so it is never checked against anything.
 */
export function suggestTicker(name: string): string {
  const letters = name
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 4);
  return letters ? `$${letters}` : "";
}

export const tickerOf = (draft: Draft): string =>
  draft.tickerTouched ? draft.ticker : suggestTicker(draft.name);

/**
 * The handle the agent gets, derived from its name. Unlike the ticker this one is real: the API
 * takes `^[a-z0-9_]{3,15}$` and rejects anything else, so the rule here is that rule.
 */
export function suggestHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 15);
}

export const handleOk = (handle: string): boolean => /^[a-z0-9_]{3,15}$/.test(handle);

/**
 * The canvas offers to fill the draft in from one sentence. There is no endpoint that reads a
 * sentence, so this is the canvas's own keyword table and nothing more — it matches words and
 * suggests, which is why the screen calls it a suggestion rather than dressing it as a model.
 */
/*
 * The canvas's own table matches anywhere in the line, which makes several of its words fire inside
 * ordinary English: `eth` hits "som(eth)ing", `ai` hits "ag(ai)n" and "s(ai)d", `rate` hits
 * "accu(rate)", `temp` hits "at(temp)t" and `rain` hits "t(rain)ing". "Something else entirely" came
 * back as Crypto. So the short whole words are anchored on both sides and the stems only on the
 * left, which is the difference between a suggestion and a coin toss.
 */
const GUESSES: { pattern: RegExp; beat: BeatName; name: string }[] = [
  {
    pattern: /\b(?:nba|nfl|mlb|game|match|team)\b|\b(?:soccer|sport|injur)/i,
    beat: "Sports",
    name: "Overtime",
  },
  {
    pattern: /\b(?:fed|rate|rates|cpi|gdp|jobs)\b|\b(?:inflation|econ)/i,
    beat: "Economics",
    name: "Rate Desk",
  },
  {
    pattern: /\b(?:btc|eth|defi|coin|coins)\b|\b(?:crypto|token|listing)/i,
    beat: "Crypto",
    name: "Listing Hawk",
  },
  {
    pattern: /\b(?:vote|votes|poll|polls|senate)\b|\b(?:elect|president|politic)/i,
    beat: "Politics",
    name: "Exit Poll",
  },
  { pattern: /\b(?:rain|temp|storm)\b|\bweather/i, beat: "Weather", name: "Cold Front" },
  {
    pattern: /\b(?:ai|chip|chips|tech|launch)\b|\b(?:science|spacex)/i,
    beat: "Tech & Science",
    name: "Launch Window",
  },
];

export function guessFrom(prompt: string): { beat: BeatName; name: string; why: string } {
  const hit = GUESSES.find((guess) => guess.pattern.test(prompt));
  return {
    beat: hit?.beat ?? "Culture",
    name: hit?.name ?? "Hot Take",
    why: prompt.trim().slice(0, EDGE_MAX),
  };
}

/** Whether a step has what it needs to move on. One rule per step, and no step skips another. */
export function stepReady(step: Step, draft: Draft): boolean {
  switch (step) {
    case "start":
      return draft.prompt.trim().length > 0;
    case "name":
      return draft.name.trim().length > 0 && handleOk(suggestHandle(draft.name));
    case "beat":
      // Only a beat with a market catalog can go further, and only with a market chosen inside it.
      return draft.beat === "Sports" && draft.sports.length > 0;
    case "edge":
      return draft.why.trim().length > 0 && draft.why.length <= EDGE_MAX;
    case "run":
      return true;
  }
}

/** How far a person may jump back and forth: every step before this one has to be satisfied. */
export function stepReachable(step: Step, draft: Draft): boolean {
  return STEPS.slice(0, STEPS.indexOf(step)).every((earlier) => stepReady(earlier, draft));
}

/**
 * The draft as the API takes it. Only the fields that have somewhere to go travel — the ticker does
 * not appear here because there is nothing to put it in, and the screen says so where it is typed.
 */
export function toCreate(
  draft: Draft,
  defaults: Config,
): { name: string; handle: string; config: Config; profile: Profile } {
  return {
    name: draft.name.trim().slice(0, 40),
    handle: suggestHandle(draft.name),
    config: {
      ...defaults,
      profile: draft.why.trim(),
      marketScope: { version: 1, category: "sports", subcategories: draft.sports },
    } as Config,
    profile: DRAFT_PROFILE,
  };
}

/**
 * The public profile the API requires with every agent. The stepped flow asks for none of it — the
 * accent, venue and blurb are the full form's questions — so it sends the same defaults that form
 * opens on, and each one is a value the database accepts as written.
 */
export const DRAFT_PROFILE: Profile = {
  accent: "lime",
  blurb: "",
  venue: "predictions",
  vibe: "",
  voice: "",
  decides: "",
  wrong: "",
  xHandle: null,
};
