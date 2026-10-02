import {
  HORIZONS,
  LEVEL_STEPS,
  squareProblem,
  type MarketDetail,
  type PerpMarket,
} from "../domain/markets.js";
import type { MarketBoard } from "../ports/market-board.js";

const SYMBOL = /^[A-Z0-9]{2,10}-PERP$/;

/** "btc-perp" and " BTC-PERP " are the same market; anything else is not one. */
export function normalizeSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  return SYMBOL.test(symbol) ? symbol : null;
}

/**
 * The list leads with the markets agents actually read, then with the ones they have a call open
 * on. Size only breaks a tie: a deep market nobody covers has nothing to ask about. A count nobody
 * has measured ranks as none, so on a venue with no counts at all the order is simply by size.
 */
export const byCoverage = (a: PerpMarket, b: PerpMarket) =>
  (b.agentsReading ?? 0) - (a.agentsReading ?? 0) ||
  (b.openCalls ?? 0) - (a.openCalls ?? 0) ||
  b.openInterest - a.openInterest ||
  a.symbol.localeCompare(b.symbol);

export function createListMarkets(board: MarketBoard) {
  return async (): Promise<PerpMarket[]> => [...(await board.listMarkets())].sort(byCoverage);
}

export function createGetMarket(board: MarketBoard) {
  return async (rawSymbol: string): Promise<MarketDetail | null> => {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) {
      return null;
    }

    const detail = await board.getMarket(symbol);
    if (!detail) {
      return null;
    }

    // A dot nobody can click is worse than no dot: only squares the surface draws, and only ones
    // the market can actually reach in the time the column gives it.
    const calls = detail.calls.filter(
      (call) =>
        LEVEL_STEPS.some((level) => level === call.level) &&
        HORIZONS.includes(call.horizon) &&
        squareProblem(detail.market, call.level, call.horizon) === null,
    );
    return { ...detail, calls };
  };
}
