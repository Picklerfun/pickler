/**
 * The live studio's RUN sections' own rules (docs/specs/studio-live-v1.md L7, L8; the "Pickler
 * Studio v5 Live" canvas 172–366): their empty lines, Decisions' six filters, Console's intro and
 * starters, and the sparkline's points and words. What they share with the rest of the live studio
 * (the markets it watches, Posts' header, the strip) is `./model.ts`'s.
 *
 * Pure, no React and no transport, and it value-imports neither `@pickler/api-schema` nor
 * `@pickler/core`, so `apps/web/test/studio-live-run.test.ts` can load it. No line here promises
 * what the Perpl runtime will do (draft spec D19): each says what is true now.
 */
import { formatPrice } from "../../markets/lib/format";

// ─── Empty lines (spec L7) ─────────────────────────────────────────────────────────────────────

/** Overview's "Its positions" and Positions' "Open", with no position. */
export const FLAT_LINE = "Flat. It opens positions once the Perpl runtime runs.";

/** The positions lists' head: none is open, which is true before the runtime too. */
export const OPEN_COUNT = "0 OPEN";

export const RECORD_EMPTY = "Its record starts with its first closed position.";

/** Record's head: nothing has closed. */
export const RECORD_META = "SINCE PUBLIC · 0 CLOSED";

export const DECISIONS_EMPTY =
  "No decisions yet. Once it runs, every check lands here with what it did and why. Nothing here is edited after the fact.";

/**
 * Posts' line under its head. The canvas's first sentence ("Entries and exits post on Pickler the
 * moment they fill") says what the runtime does; spec L7's empty line says it in the future, so the
 * line keeps only what is true now.
 */
export const POSTS_NOTE = "Voice is set in Identity & voice; the numbers are never edited.";

// ─── Decisions' filters ────────────────────────────────────────────────────────────────────────

export type DecisionFilterKey = "all" | "entered" | "held" | "exited" | "blocked" | "posted";

/** The canvas's six (`FILTERS`), in its order. */
const DECISION_FILTERS: readonly { key: DecisionFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "entered", label: "Entered" },
  { key: "held", label: "Held" },
  { key: "exited", label: "Exited" },
  { key: "blocked", label: "Blocked" },
  { key: "posted", label: "Posted" },
];

export interface DecisionFilter {
  key: DecisionFilterKey;
  label: string;
  /** How many decisions it holds: zero for each until the runtime decides anything. */
  count: number;
  on: boolean;
}

/** The six filters at zero (spec L7), the chosen one on. */
export const decisionFilters = (chosen: DecisionFilterKey): DecisionFilter[] =>
  DECISION_FILTERS.map(({ key, label }) => ({ key, label, count: 0, on: key === chosen }));

// ─── Console ───────────────────────────────────────────────────────────────────────────────────

/** The canvas's intro over the thread, with the agent's name ("it" for an agent without one). */
export const consoleIntro = (name: string | undefined): string =>
  `Everything you and ${name?.trim() || "it"} have said to each other, in order. Questions asked on a decision land here too, marked with the decision they belong to.`;

/** The canvas's starters (`askStarters`), drawn shut until talking to it opens. */
export const CONSOLE_STARTERS: readonly string[] = [
  "Why so quiet today?",
  "How much are you down today?",
  "Read coindesk.com too",
  "Go in at 10 while I decide",
];

export const CONSOLE_PLACEHOLDER =
  "Read coindesk.com too · go in at 10 while I decide · why so quiet today?";

// ─── The sparkline ─────────────────────────────────────────────────────────────────────────────

/** The line keeps clear of the box's top and bottom by this much of a 100-unit height. */
const SPARK_PAD = 8;

/**
 * A trail's points in a 100 × 100 box (the SVG stretches it), oldest at the left, on the trail's
 * own low and high; a flat trail is a line across the middle. Fewer than two marks draw nothing.
 */
export function sparkSamples(trail: readonly number[]): { value: number; x: number; y: number }[] {
  const marks = trail.filter((value) => Number.isFinite(value));
  if (marks.length < 2) {
    return [];
  }

  const low = Math.min(...marks);
  const high = Math.max(...marks);
  const span = high - low;

  return marks.map((value, index) => ({
    value,
    x: (index / (marks.length - 1)) * 100,
    y: span === 0 ? 50 : SPARK_PAD + ((high - value) / span) * (100 - 2 * SPARK_PAD),
  }));
}

const priceDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const priceClock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** An explicit UTC label, identical on server and client; unknown dates stay unknown. */
export function priceTime(at: string | null | undefined) {
  if (!at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(at)) {
    return null;
  }
  const value = Date.parse(at);
  if (!Number.isFinite(value)) {
    return null;
  }
  const iso = new Date(value).toISOString();
  if (iso.slice(0, 19) !== at.slice(0, 19)) {
    return null;
  }
  const clock = `${priceClock.format(value)} UTC`;
  return { iso, clock, label: `${priceDate.format(value)}, ${clock}` };
}

export interface PriceSample {
  value: number;
  x: number;
  y: number;
  at: string | null;
}

/** Keep timestamp/price pairs through filtering; only a coherent series gets a time axis. */
export function priceSamples(
  trail: readonly number[],
  timestamps: readonly (string | null)[] | null,
): PriceSample[] {
  const aligned = timestamps?.length === trail.length;
  const marks = trail.flatMap((value, index) =>
    Number.isFinite(value)
      ? [{ value, at: aligned ? (priceTime(timestamps?.[index])?.iso ?? null) : null }]
      : [],
  );
  const times = marks.map(({ at }) => (at ? Date.parse(at) : Number.NaN));
  const ordered = times.every(
    (at, index) => Number.isFinite(at) && (index === 0 || at > times[index - 1]!),
  );
  const duration = (times.at(-1) ?? 0) - (times[0] ?? 0);

  return sparkSamples(marks.map(({ value }) => value)).map((point, index) => ({
    ...point,
    at: marks[index]!.at,
    x: ordered && duration > 0 ? ((times[index]! - times[0]!) / duration) * 100 : point.x,
  }));
}

export const PRICE_RANGES = [
  { value: "24H", label: "24H", hours: 24 },
  { value: "7D", label: "7D", hours: 168 },
  { value: "30D", label: "30D", hours: 720 },
] as const;
export type PriceRange = (typeof PRICE_RANGES)[number]["value"];

interface RangeTrail {
  trail: readonly number[] | null;
  timestamps: readonly (string | null)[] | null;
  /** A shorter listing/history is explicit; missing hourly points are never generated. */
  since: string | null;
}

/** Anchor the view to the supplied last observation, so stale data never becomes current. */
export function rangeTrail(
  history: readonly { price: number; at: string }[] | null | undefined,
  trail: readonly number[] | null,
  timestamps: readonly (string | null)[] | null,
  range: PriceRange,
): RangeTrail {
  const points = (history ?? [])
    .flatMap(({ price, at }) => {
      const time = priceTime(at);
      return Number.isFinite(price) && time ? [{ price, at: time.iso }] : [];
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Keep the last supplied value when the observed mark shares an hourly closing instant.
  const unique = points.filter((point, index) => point.at !== points[index + 1]?.at);
  const last = unique.at(-1);
  if (!last) {
    return range === "24H"
      ? { trail, timestamps, since: null }
      : { trail: null, timestamps: null, since: null };
  }

  const hours = PRICE_RANGES.find((option) => option.value === range)!.hours;
  const from = Date.parse(last.at) - hours * 3_600_000;
  const visible = unique.filter((point) => Date.parse(point.at) >= from);
  const first = visible[0]!;
  const shorter = Date.parse(first.at) > from + 3_600_000;
  return {
    trail: visible.map((point) => point.price),
    timestamps: visible.map((point) => point.at),
    since: shorter ? first.at : null,
  };
}

/** Pointer and touch inspect the nearest real point, including gaps between hourly candles. */
export function nearestPriceSample(samples: readonly PriceSample[], fraction: number): number {
  const x = Math.max(0, Math.min(1, fraction)) * 100;
  let nearest = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (Math.abs(samples[index]!.x - x) < Math.abs(samples[nearest]!.x - x)) {
      nearest = index;
    }
  }
  return nearest;
}

/** The same geometry is used by the drawing and its point inspector. */
export function sparkPoints(trail: readonly number[]): string {
  return sparkSamples(trail)
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

/** The sparkline in words, for the row's text alternative (the drawing itself is hidden). */
export function trailText(trail: readonly number[] | null, range: PriceRange = "24H"): string {
  const marks = (trail ?? []).filter((value) => Number.isFinite(value));
  if (marks.length < 2) {
    return `No ${range === "24H" ? "24 h" : range.toLowerCase()} trail read.`;
  }

  const first = marks[0]!;
  const last = marks[marks.length - 1]!;
  return `Last ${range === "24H" ? "24 h" : range.toLowerCase()}: from ${formatPrice(first)} to ${formatPrice(last)}, low ${formatPrice(
    Math.min(...marks),
  )}, high ${formatPrice(Math.max(...marks))}.`;
}

// ─── What it watches ───────────────────────────────────────────────────────────────────────────

/** A setup with no market listed: nothing to read. */
export const WATCH_NONE = "No market in its setup.";

/** The board not read yet; a preview reads nothing, so it says that instead of waiting. */
export const watchLoading = (preview: boolean): string =>
  preview ? "Nothing is read in a preview." : "Reading Perpl…";
