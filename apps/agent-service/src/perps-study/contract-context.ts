import { createHash } from "node:crypto";
import { initialPaperAccount, type PerpsPaperFrame } from "@pickler/trading/perps";
import { type PerpSymbol } from "@pickler/core";
import {
  type PerpsStudyConfig,
  type PerpsEvidence,
  type PerpsDecisionContext,
} from "@pickler/trading/evaluation";
const studyConfig: PerpsStudyConfig = {
  version: 1,
  protocol: "perps-comparison-v1",
  tenantId: "alpha",
  sessionId: "perps-test",
  network: "mainnet",
  hours: 24,
  budgetUsd: "5",
  deepseek: {
    model: "controlled-deepseek",
    baseUrl: "https://example.invalid/v1",
    inputPerMillion: "0.30",
    outputPerMillion: "1.20",
  },
  jev: { model: "jev-1.13.0", inputPerMillion: "0.042", outputPerMillion: "0" },
  pricingVerifiedAt: "2026-09-28T00:00:00Z",
  pricingSources: ["https://example.invalid/deepseek", "https://example.invalid/jev"],
};
function studyFrame(now: number, symbol: PerpSymbol = "BTC"): PerpsPaperFrame {
  const provenance = {
    provider: "perpl" as const,
    pluginVersion: "1.1.0" as const,
    network: "mainnet" as const,
    chainId: 143,
    url: "https://example.invalid/ticker",
    receivedAt: now,
    providerTimestamp: now,
    block: Math.floor(now / 1000),
  };
  const market = {
    symbol,
    marketId: symbol === "BTC" ? 1 : 2,
    perpetualId: symbol === "BTC" ? 1 : 2,
    instanceId: 1,
    exchangeAddress: "0x" + "1".repeat(40),
    collateral: { tokenId: 1, address: "0x" + "2".repeat(40), symbol: "AUSD", decimals: 6 },
    configVersion: 1,
    priceDecimals: 1,
    sizeDecimals: 5,
    open: true,
    fundingIntervalSeconds: 3600,
    fundingIntervalBlocks: 3600,
    initialMarginRaw: 1000,
    maintenanceMarginRaw: 2000,
    fees: { basis: "public-base-tier" as const, maker: "0.000045", taker: "0.000345" },
    provenance,
  };
  const snapshot = {
    market,
    ticker: {
      mark: "100",
      index: "100",
      last: "100",
      bid: "99.9",
      ask: "100.1",
      openInterestBase: "10",
      freshness: "fresh" as const,
      provenance,
    },
    funding: null,
  };
  const book = {
    market,
    requestedLevels: 20,
    depthLimited: true as const,
    bids: [{ price: "99.9", size: "100", orders: 1 }],
    asks: [{ price: "100.1", size: "100", orders: 1 }],
    freshness: "fresh" as const,
    provenance,
  };
  return {
    snapshot,
    book,
    hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
  };
}
function studyEvidence(now: number): PerpsEvidence {
  const hour = Math.floor(now / 3600000) * 3600000;
  const frames = (["BTC", "ETH"] as const).map((s) => studyFrame(now, s));
  return {
    observedAt: now,
    frames,
    sourceIds: ["BTC:market", "BTC:book", "BTC:candles", "ETH:market", "ETH:book", "ETH:candles"],
    candles: frames.map((f) => ({
      market: f.snapshot.market,
      resolution: 3600,
      from: hour - 60 * 3600000,
      to: hour,
      missingOpenTimes: [],
      provenance: f.book.provenance,
      candles: Array.from({ length: 60 }, (_, i) => ({
        openTime: hour - (60 - i) * 3600000,
        open: "100",
        high: "110",
        low: "90",
        close: "100",
        volumeCollateral: "10000",
        trades: 10,
        closed: true,
      })),
    })),
  };
}
export function contractContext(now = 1800000000000): PerpsDecisionContext {
  return {
    evidence: studyEvidence(now),
    account: initialPaperAccount({ ...studyConfig, agentId: "controlled" }, 1, now),
  };
}
