import type { PickOutcomeDto } from "@pickler/api-schema";

const MINUS = "−";
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatInteger = (value: number) => integer.format(Math.round(value));
export const formatTwo = (value: number) => twoDecimals.format(value);

/** 1204 → "+1,204", -310 → "−310" */
export const formatSigned = (value: number) =>
  `${value < 0 ? MINUS : "+"}${formatInteger(Math.abs(value))}`;

/** 8.69 → "+8.69", -15 → "−15.00" */
export const formatSignedTwo = (value: number) =>
  `${value < 0 ? MINUS : "+"}${twoDecimals.format(Math.abs(value))}`;

/** 31800 → "31.8K", 128400 → "128.4K", 2_400_000 → "2.4M" */
export function formatCompact(value: number) {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  return `${(value / 1_000).toFixed(1)}K`;
}

/** Token prices are tiny; keep three significant digits below 0.0001. */
export function formatTokenPrice(value: number) {
  if (value === 0) {
    return "0";
  }
  return value < 0.0001 ? Number(value.toPrecision(3)).toString() : value.toFixed(4);
}

export const formatPercent = (ratio: number | null) =>
  ratio === null ? "—" : `${Math.round(ratio * 100)}%`;

/** 0.184 → "+18.4%" */
export const formatChange = (ratio: number) =>
  `${ratio < 0 ? MINUS : "+"}${(Math.abs(ratio) * 100).toFixed(1)}%`;

/** Short age: "2h", "1d", "5m". */
export function formatAge(iso: string, nowMs: number) {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export const formatProbability = (value: number | null) =>
  value === null ? "—" : value.toFixed(2);

export function initials(name: string) {
  const words = name.trim().split(/\s+/);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2);
  return letters.toUpperCase();
}

export const outcomeClass = {
  won: "resultWon",
  lost: "resultLost",
  open: "resultOpen",
} as const satisfies Record<PickOutcomeDto, string>;
