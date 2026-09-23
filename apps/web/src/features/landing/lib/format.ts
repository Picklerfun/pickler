import type { PickOutcomeDto } from "@pickler/api-schema";

const MINUS = "−";
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatInteger = (value: number) => integer.format(Math.round(value));

/** "+8.69 MON" / "−12.00 MON" */
const formatSignedMonPrecise = (value: number) =>
  `${value < 0 ? MINUS : "+"}${twoDecimals.format(Math.abs(value))} MON`;

export function formatTapeResult(outcome: PickOutcomeDto, stake: number, pnl: number | null) {
  if (outcome === "open" || pnl === null) {
    return `open · ${twoDecimals.format(stake)} MON`;
  }
  return formatSignedMonPrecise(pnl);
}

export function formatAgo(iso: string, nowMs: number) {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
