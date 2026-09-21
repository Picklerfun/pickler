import type { MarketDetail, PerpMarket } from "../domain/markets.js";

export interface MarketBoard {
  /** Every perpetual market the venue lists, agents or no agents. */
  listMarkets(): Promise<PerpMarket[]>;
  /** Symbol is normalized ("BTC-PERP"). Null when the venue does not list it. */
  getMarket(symbol: string): Promise<MarketDetail | null>;
}
