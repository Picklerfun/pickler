import type { Source, SportsData } from "@pickler/core";

const FRESH_MS = 120_000;

/** The Odds API source ids end in the bookmaker key, for example `event:draftkings`. */
function bookmakerKey(source: Source): string {
  const id = source.externalId ?? "";
  return id.slice(id.lastIndexOf(":") + 1);
}

function fresh(source: Source, now: number): boolean {
  if (!source.publishedAt) {
    return false;
  }
  return Math.abs(now - Date.parse(source.publishedAt)) <= FRESH_MS;
}

/**
 * Quotes only the sportsbooks the person chose. Books are `SPORTSBOOKS` keys, which are The Odds
 * API bookmaker keys, compared exactly. An empty list returns the adapter itself: every book.
 */
export function booksOnly(
  odds: SportsData,
  books: readonly string[],
  now: () => number = Date.now,
): SportsData {
  if (books.length === 0) {
    return odds;
  }

  const chosen = new Set(books);
  return {
    async context(market, signal, beforeRequest) {
      const context = await odds.context(market, signal, beforeRequest);
      if (context.status === "no_coverage") {
        return context;
      }

      const sources = context.sources.filter((source) => chosen.has(bookmakerKey(source)));
      if (sources.length === 0) {
        return { ...context, status: "no_coverage", sources };
      }

      const current = now();
      const status = sources.some((source) => fresh(source, current)) ? "available" : "stale";
      return { ...context, status, sources };
    },
  };
}
