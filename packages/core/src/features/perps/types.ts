export const PERPL_PLUGIN_VERSION = "1.1.0" as const;
export const PERP_TOOLS = [
  "listPerpMarkets",
  "getPerpSnapshot",
  "getPerpOrderBook",
  "getPerpCandles",
  "getPerpFundingHistory",
] as const;
export type PerpTool = (typeof PERP_TOOLS)[number];
export type PerpNetwork = "mainnet" | "testnet";
export type PerpSymbol = string;
export type PerplConfig =
  | { version: 1; network: PerpNetwork; markets: ("BTC" | "ETH")[] }
  | { version: 2; network: PerpNetwork; markets: PerpSymbol[] };
export interface PerpProvenance {
  provider: "perpl";
  pluginVersion: "1.0.0" | "1.1.0";
  network: PerpNetwork;
  chainId: number;
  url: string;
  receivedAt: number;
  providerTimestamp: number | null;
  block: number | null;
}
export interface PerpMarketInfo {
  symbol: PerpSymbol;
  marketId: number;
  perpetualId: number;
  instanceId: number;
  exchangeAddress: string;
  collateral: { tokenId: number; address: string; symbol: string; decimals: number };
  configVersion: number;
  priceDecimals: number;
  sizeDecimals: number;
  open: boolean;
  fundingIntervalSeconds: number;
  fundingIntervalBlocks: number;
  // Provider fractions are retained verbatim. This read plugin does not calculate leverage.
  initialMarginRaw: number;
  maintenanceMarginRaw: number;
  fees: { basis: "public-base-tier"; maker: string; taker: string };
  provenance: PerpProvenance;
}
export interface PerpMarkets {
  markets: PerpMarketInfo[];
}
export interface PerpSnapshot {
  market: PerpMarketInfo;
  ticker: {
    mark: string;
    index: string;
    last: string;
    bid: string;
    ask: string;
    openInterestBase: string;
    freshness: "fresh" | "stale" | "unknown";
    provenance: PerpProvenance;
  };
  funding: {
    rate: string;
    intervalSeconds: number;
    intervalBlocks: number;
    appliesAt: number | null;
    eventBlock: number;
    applicationTimeEstimated: boolean | null;
    provenance: PerpProvenance;
  } | null;
}
export interface PerpOrderBook {
  market: PerpMarketInfo;
  requestedLevels: number;
  depthLimited: true;
  bids: { price: string; size: string; orders: number }[];
  asks: { price: string; size: string; orders: number }[];
  freshness: "fresh" | "stale" | "unknown";
  provenance: PerpProvenance;
}
export const PERP_RESOLUTIONS = [
  60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400,
] as const;
export interface PerpCandleRequest {
  symbol: PerpSymbol;
  resolution: number;
  from: number;
  to: number;
}
export interface PerpCandles {
  market: PerpMarketInfo;
  resolution: number;
  from: number;
  to: number;
  missingOpenTimes: number[];
  candles: {
    openTime: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volumeCollateral: string;
    trades: number;
    closed: boolean;
  }[];
  provenance: PerpProvenance;
}
export interface PerpReadContext {
  signal: AbortSignal;
  /** Must run before and after every provider request, including cached reads. */
  guard(): Promise<void>;
}
export interface PerpFundingRequest {
  symbol: PerpSymbol;
  from: number;
  to: number;
}
export interface PerpFundingEvent {
  eventBlock: number;
  appliesAt: number | null;
  rate: string;
  index: string;
  estimated: boolean;
  provenance: PerpProvenance;
}
export interface PerpFundingHistory {
  market: PerpMarketInfo;
  from: number;
  to: number;
  complete: boolean;
  events: PerpFundingEvent[];
  pages: PerpProvenance[];
}
export interface PerpMarketData {
  funding(
    network: PerpNetwork,
    request: PerpFundingRequest,
    context: PerpReadContext,
  ): Promise<PerpFundingHistory>;
  list(network: PerpNetwork, symbols: PerpSymbol[], context: PerpReadContext): Promise<PerpMarkets>;
  snapshot(
    network: PerpNetwork,
    symbol: PerpSymbol,
    context: PerpReadContext,
  ): Promise<PerpSnapshot>;
  book(
    network: PerpNetwork,
    symbol: PerpSymbol,
    levels: number,
    context: PerpReadContext,
  ): Promise<PerpOrderBook>;
  candles(
    network: PerpNetwork,
    request: PerpCandleRequest,
    context: PerpReadContext,
  ): Promise<PerpCandles>;
}
export interface PerpReadTools {
  getPerpFundingHistory(input: PerpFundingRequest): Promise<PerpFundingHistory>;
  listPerpMarkets(): Promise<PerpMarkets>;
  getPerpSnapshot(input: { symbol: PerpSymbol }): Promise<PerpSnapshot>;
  getPerpOrderBook(input: { symbol: PerpSymbol; levels?: number }): Promise<PerpOrderBook>;
  getPerpCandles(input: PerpCandleRequest): Promise<PerpCandles>;
}

/** Public catalogue identity only; execution metadata is resolved by the server. */
export interface PerplMarketCatalog {
  network: PerpNetwork;
  observedAt: number;
  markets: {
    marketId: number | null;
    symbol: string | null;
    name: string;
    collateral: { symbol: string; decimals: number } | null;
    status: "open" | "closed" | "invalid";
    available: boolean;
    reasons: string[];
  }[];
}
