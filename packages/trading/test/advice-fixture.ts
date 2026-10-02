import { DEFAULT_CONFIG, type AdviceJob, type PerpMarketInfo } from "@pickler/core";
import type { AdviceEvidence } from "@pickler/trading/perps";
export const adviceTime = 1790899200000 + 120000;
export function adviceFixture(now = adviceTime) {
  const provenance = {
    provider: "perpl" as const,
    pluginVersion: "1.1.0" as const,
    network: "testnet" as const,
    chainId: 10143,
    url: "https://perpl.test/data",
    receivedAt: now,
    providerTimestamp: now,
    block: 100,
  };
  const market: PerpMarketInfo = {
    symbol: "BTC",
    marketId: 1,
    perpetualId: 1,
    instanceId: 1,
    exchangeAddress: "0xexchange",
    collateral: { tokenId: 1, address: "0xcollateral", symbol: "AUSD", decimals: 6 },
    configVersion: 1,
    priceDecimals: 2,
    sizeDecimals: 4,
    open: true,
    fundingIntervalSeconds: 3600,
    fundingIntervalBlocks: 100,
    initialMarginRaw: 100,
    maintenanceMarginRaw: 50,
    fees: { basis: "public-base-tier", maker: "0", taker: "0.0002" },
    provenance,
  };
  const hour = Math.floor(now / 3600000) * 3600000;
  const evidence: AdviceEvidence = {
    frame: {
      snapshot: {
        market,
        ticker: {
          mark: "60000",
          index: "60000",
          last: "60000",
          bid: "59999",
          ask: "60001",
          openInterestBase: "20",
          freshness: "fresh",
          provenance,
        },
        funding: null,
      },
      book: {
        market,
        requestedLevels: 20,
        depthLimited: true,
        bids: [{ price: "59999", size: "10", orders: 1 }],
        asks: [{ price: "60001", size: "10", orders: 1 }],
        freshness: "fresh",
        provenance,
      },
      hash: "a".repeat(64),
    },
    candles: {
      market,
      resolution: 3600,
      from: hour - 60 * 3600000,
      to: hour,
      missingOpenTimes: [],
      candles: Array.from({ length: 60 }, (_, i) => ({
        openTime: hour - (60 - i) * 3600000,
        open: "60000",
        high: "60010",
        low: "59990",
        close: "60001",
        volumeCollateral: "1000",
        trades: 1,
        closed: true,
      })),
      provenance,
    },
    sources: [
      {
        id: "perpl-ticker",
        name: "Perpl ticker",
        url: provenance.url,
        observedAt: new Date(now).toISOString(),
      },
    ],
    web: [],
  };
  const job: AdviceJob = {
    id: "d08d112f-c1d1-4130-98cb-8c981883cd01",
    publicAgentId: "d08d112f-c1d1-4130-98cb-8c981883cd02",
    userId: "d08d112f-c1d1-4130-98cb-8c981883cd03",
    tenantId: "tenant",
    agentId: "agent",
    symbol: "BTC",
    status: "running",
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    configVersion: 1,
    config: {
      ...structuredClone(DEFAULT_CONFIG),
      tools: ["getPerpSnapshot", "getPerpOrderBook", "getPerpCandles"],
      plugins: { version: 1, enabled: ["perpl"] },
      perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
    },
    policy: {
      version: 1,
      jevModel: "jev-1.13.0",
      deepseekModel: "deepseek-chat",
      inputRates: { jev: "0.1", deepseek: "0.1" },
      outputRates: { jev: "0", deepseek: "0.2" },
      webSearchUsd: "0.01",
      requestLimitUsd: "0.1",
      dailyLimitUsd: "1",
      pricingVerifiedAt: new Date(now).toISOString(),
      pricingSources: ["https://example.test/controlled-pricing"],
    },
    result: null,
    error: null,
  };
  return { job, evidence };
}
