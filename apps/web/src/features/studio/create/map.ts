/**
 * The creation canvas's copy and lists, for the screens. The rules over them live in `draft.ts`;
 * this is only what each option is called, what it says under it and which colour it is drawn in.
 *
 * Unlike `draft.ts`, this module reads `@pickler/api-schema` values directly: it is imported only
 * by the screens, which Next bundles, and never by a `node:test`.
 */
import { BEAT_SUBS, SPORTSBOOKS, type BeatName } from "@pickler/api-schema";
import { SOON_BEATS, SOON_VENUES, type VenueOnMap, type WebMode } from "./draft";
import type { StyleDto } from "@pickler/api-schema";

export type Tint = "lime" | "violet" | "amber" | "blue" | "orange" | "magenta" | "ink";

export const PROMPTS = [
  { label: "NFL INJURY NEWS", text: "Calls NFL games off injury news before the lines move." },
  { label: "FED RATE CALLS", text: "Calls Fed rate decisions off the CPI prints." },
  { label: "BTC FUNDING FLIPS", text: "Goes long BTC when funding turns negative." },
] as const;

export const VENUES: {
  key: VenueOnMap;
  name: string;
  kind: string;
  note: string;
  soon: boolean;
}[] = [
  {
    key: "polymarket",
    name: "Polymarket",
    kind: "PREDICTION MARKETS",
    note: "Calls events that resolve yes or no: games, elections, rate decisions.",
    soon: SOON_VENUES.includes("polymarket"),
  },
  {
    key: "perpl",
    name: "Perpl",
    kind: "PERPETUALS",
    note: "Goes long or short on crypto prices, on Monad.",
    soon: SOON_VENUES.includes("perpl"),
  },
];

const BEAT_TINTS: Record<BeatName, Tint> = {
  Sports: "lime",
  Crypto: "blue",
  Politics: "violet",
  Economics: "amber",
  Culture: "orange",
  Tech: "magenta",
};

export const BEATS = (Object.keys(BEAT_SUBS) as BeatName[]).map((name) => ({
  name,
  tint: BEAT_TINTS[name],
  subs: BEAT_SUBS[name],
  soon: SOON_BEATS.includes(name),
}));

export function beatTint(beat: string): Tint | null {
  return BEATS.find((candidate) => candidate.name === beat)?.tint ?? null;
}

export const PERPS = ["BTC", "ETH", "SOL", "MON"] as const;

/** The sportsbooks the odds plugin can quote; `key` is what the config stores. */
export const BOOKS = SPORTSBOOKS.map((book) => ({ key: book.key as string, label: book.label }));

/** What the canvas turns on with the odds: three books, before the person picks. */
export const DEFAULT_BOOKS = ["draftkings", "fanduel", "pinnacle"];

export const WEB_MODES: { value: WebMode; label: string; note: string }[] = [
  {
    value: "anywhere",
    label: "Anywhere",
    note: "Searches the whole web. Your sites are not used.",
  },
  {
    value: "prefer",
    label: "Prefer these",
    note: "Starts with these sites, and goes wider when they are not enough.",
  },
  { value: "only", label: "Only these", note: "Never reads anything outside this list." },
];

export const STYLES: { value: StyleDto; label: string; note: string }[] = [
  {
    value: "careful",
    label: "Careful",
    note: "Only calls with a clear edge. Passes a lot, and that is fine.",
  },
  {
    value: "balanced",
    label: "Balanced",
    note: "Calls when its view sits clearly away from the price. Passes when unsure.",
  },
  {
    value: "bold",
    label: "Bold",
    note: "Calls more often, with thinner edges. Expect more misses.",
  },
];

export const RAIL_LABELS = {
  name: "NAME",
  trades: "TRADES",
  looks: "CALLS",
  reads: "READS",
  skills: "SKILLS",
  decides: "DECIDES",
  review: "REVIEW",
} as const;

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }
  return trimmed
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
