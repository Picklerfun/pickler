/**
 * The one clock of an agent's studio, draft or live: "hh:mm", a calendar day's number and "OCT 1",
 * all in local time. The server renders in its own zone (UTC), so every view that prints one of
 * these marks it `suppressHydrationWarning`. Pure, pinned in
 * `apps/web/test/studio-draft-model.test.ts`.
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "hh:mm" in local time. */
export const clock = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

/** The local calendar day as a number, so two dates compare by day. */
export const dayNumber = (date: Date): number =>
  Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

/** The local day as "OCT 1". */
export const dayLabel = (date: Date): string => `${MONTHS[date.getMonth()]} ${date.getDate()}`;

/** "hh:mm" for a time today, else its day ("OCT 1"), against `now`. */
export const stamp = (date: Date, now: Date): string =>
  dayNumber(date) === dayNumber(now) ? clock(date) : dayLabel(date);
