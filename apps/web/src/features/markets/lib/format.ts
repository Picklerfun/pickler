const MINUS = "−";

/**
 * A price carries the decimals its size needs: a mark in the tens of thousands does not want three
 * of them, and MON at 4.41 is unreadable without them. One function so the board, the surface and
 * the ticket never disagree about the same number.
 */
export function formatPrice(value: number): string {
  const decimals = value >= 1000 ? 1 : value >= 10 ? 2 : 3;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** 250 → "250.00". The unit is written by the label beside it. */
export const formatAmount = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatAusd = (value: number) => `${formatAmount(value)} AUSD`;

/** 4_100_000 → "4.1M AUSD", 820_000 → "820K AUSD" */
export function formatCompactAusd(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M AUSD`;
  }
  return `${Math.round(value / 1_000)}K AUSD`;
}

/** 0.018 → "+1.8%" */
export const formatChange = (ratio: number) =>
  `${ratio < 0 ? MINUS : "+"}${(Math.abs(ratio) * 100).toFixed(1)}%`;

/** 0.000091 → "+0.0091%" */
export const formatFunding = (ratio: number) =>
  `${ratio < 0 ? MINUS : "+"}${(Math.abs(ratio) * 100).toFixed(4)}%`;

/** A level on the surface: 1 → "+1.0%", -1.5 → "−1.5%" */
export const formatLevel = (level: number) =>
  `${level < 0 ? MINUS : "+"}${Math.abs(level).toFixed(1)}%`;

/** "1 AGENT", "3 AGENTS" — a board that says "1 AGENTS READING" reads like a placeholder. */
export const plural = (count: number, one: string, many = `${one}S`) =>
  `${count} ${count === 1 ? one : many}`;

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hour12: false,
});

const sameUtcDay = (a: Date, b: Date) =>
  a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** "13:41 UTC", or "09:41 UTC (tomorrow)" once the column crosses midnight. */
export function formatClose(at: Date, from: Date): string {
  const time = `${clock.format(at)} UTC`;
  return sameUtcDay(at, from) ? time : `${time} (tomorrow)`;
}

/** The short form under a column header: "13:41", "09:41 +1D". */
export function formatColumnTime(at: Date, from: Date): string {
  return sameUtcDay(at, from) ? clock.format(at) : `${clock.format(at)} +1D`;
}
