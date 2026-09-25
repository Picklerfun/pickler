/** Sportsbooks an agent may quote. `key` is The Odds API bookmaker key; configurations store keys. */
export const SPORTSBOOKS = [
  { label: "DraftKings", key: "draftkings" },
  { label: "FanDuel", key: "fanduel" },
  { label: "Pinnacle", key: "pinnacle" },
  { label: "BetMGM", key: "betmgm" },
  { label: "Caesars", key: "williamhill_us" },
] as const;
export type BookKey = (typeof SPORTSBOOKS)[number]["key"];
export const BOOK_KEYS: readonly BookKey[] = SPORTSBOOKS.map((book) => book.key);

export function isBookKey(value: unknown): value is BookKey {
  return typeof value === "string" && (BOOK_KEYS as readonly string[]).includes(value);
}
