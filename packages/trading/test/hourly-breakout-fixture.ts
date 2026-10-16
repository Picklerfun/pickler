import { createHash } from "node:crypto";
import type { PerpCandles } from "@pickler/core";
import {
  BREAKOUT_MARKETS,
  BREAKOUT_PARAMETER_CONTRACT_SHA256,
  BREAKOUT_RESEARCH_PROTOCOL_SHA256,
  type BreakoutAccountState,
  type BreakoutClockBoundary,
  type BreakoutClockCertificate,
  type BreakoutInitialSet,
  type BreakoutRunAcceptance,
  type BreakoutScreenSnapshot,
  type BreakoutWindow,
  type PerpsHourlyBreakoutConfig,
} from "../src/evaluation.js";
import { initialPaperAccount, type PerpsPaperFrame } from "../src/perps.js";
import { adviceFixture } from "./advice-fixture.js";

export const breakoutT0 = Date.UTC(2027, 0, 4);
export const breakoutDigest = (value: string) => createHash("sha256").update(value).digest("hex");

export function breakoutConfig(): PerpsHourlyBreakoutConfig {
  return {
    version: 10,
    protocol: "perps-hourly-breakout-fixed-screen-v1",
    hours: 672,
    budgetUsd: "5",
    tenantId: "fixture",
    agentId: "existing-agent",
    sessionId: "controlled-breakout",
    network: "mainnet",
    enabled: false,
    financiallyExecutable: false,
    T0: null,
    operator: null,
    parameterContractSha256: BREAKOUT_PARAMETER_CONTRACT_SHA256,
    researchProtocolSha256: BREAKOUT_RESEARCH_PROTOCOL_SHA256,
    acquisitionPolicy: "stream-universe-component-paper-20s-v1",
    markets: [...BREAKOUT_MARKETS],
  };
}
export function breakoutAcceptance(): BreakoutRunAcceptance {
  return {
    protocolDigest: "a".repeat(64),
    T0: breakoutT0,
    authorizedAt: breakoutT0 - 60_000,
    operator: { identity: "CONTROLLED_OPERATOR_ONLY", acknowledgementSha256: "b".repeat(64) },
    technicalAcceptanceSha256: "c".repeat(64),
    sourceQualificationSha256: "d".repeat(64),
    financialAuthorizationSha256: "e".repeat(64),
    acceptedClockCertificateIds: ["controlled-clock"],
  };
}
export function breakoutFrame(marketId = 1, at = breakoutT0 + 1000): PerpsPaperFrame {
  const value = structuredClone(adviceFixture(at).evidence.frame);
  const symbol = BREAKOUT_MARKETS.find((m) => m.marketId === marketId)!.symbol;
  const market = {
    ...value.snapshot.market,
    symbol,
    marketId,
    perpetualId: marketId,
    instanceId: 1,
    exchangeAddress: "0x34b6552d57a35a1d042ccae1951bd1c370112a6f",
    collateral: {
      tokenId: 1,
      address: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
      symbol: "AUSD",
      decimals: 6,
    },
    provenance: {
      ...value.snapshot.market.provenance,
      network: "mainnet" as const,
      chainId: 143,
      receivedAt: at,
      providerTimestamp: at,
      block: 100,
    },
  };
  value.snapshot.market = market;
  value.book.market = structuredClone(market);
  value.snapshot.ticker = {
    ...value.snapshot.ticker,
    mark: "100",
    index: "100",
    last: "100",
    bid: "99.9",
    ask: "100.1",
    provenance: { ...market.provenance },
  };
  value.book.provenance = { ...market.provenance };
  value.book.bids = [{ price: "99.9", size: "1000", orders: 1 }];
  value.book.asks = [{ price: "100.1", size: "1000", orders: 1 }];
  value.streamEvidence = {
    policy: "stream-universe-component-paper-20s-v1",
    generation: 1,
    copiedAt: at,
    heartbeatSequence: 20,
    headBlock: 100,
    heartbeatReceivedAt: at,
  };
  value.hash = breakoutDigest(`controlled-frame:${marketId}:${at}`);
  return value;
}
export function breakoutWindow(marketId = 1, H = breakoutT0, D = H + 1000): BreakoutWindow {
  const market = breakoutFrame(marketId, D).snapshot.market;
  return {
    market,
    H,
    D,
    bars: Array.from({ length: 22 }, (_, i) => ({
      candle: {
        openTime: H - (22 - i) * 3_600_000,
        open: "99",
        high: i === 21 ? "102" : "100",
        low: "98",
        close: i === 21 ? "101" : "99",
        volumeCollateral: "1000",
        trades: 1,
        closed: true,
      },
      provenance: {
        firstReceiptAt: D,
        sourceRecordId: `controlled-original:${marketId}:${H}:${i}`,
        revisionId: "original-v1",
        requestId: `controlled-request:${marketId}:${H}`,
        responseSha256: "f".repeat(64),
        seriesTimestamp: D,
        seriesBlock: 100,
        from: H - 22 * 3_600_000,
        to: H,
        resolution: 3600 as const,
      },
    })),
  };
}
export function breakoutInitial(
  H = breakoutT0,
  marketIds: readonly number[] = [1, 20],
): BreakoutInitialSet {
  const D = H + 1000;
  const frames = marketIds.map((id) => breakoutFrame(id, D));
  const candles: PerpCandles[] = marketIds.flatMap((marketId) =>
    [3600, 900, 300].map((resolution) => {
      const frame = frames.find((f) => f.snapshot.market.marketId === marketId)!;
      return {
        market: frame.snapshot.market,
        resolution,
        from: H - 60 * resolution * 1000,
        to: H,
        missingOpenTimes: [],
        provenance: frame.snapshot.market.provenance,
        candles: Array.from({ length: 60 }, (_, i) => ({
          openTime: H - (60 - i) * resolution * 1000,
          open: "100",
          high: "101",
          low: "99",
          close: "100",
          volumeCollateral: "1000",
          trades: 1,
          closed: true,
        })),
      };
    }),
  );
  return {
    operationId: `controlled:${H}`,
    scheduledAt: H,
    D,
    financialAt: D,
    receiptAt: D,
    sourceDeadlineAt: H + 20_000,
    markets: marketIds.map((id) => ({
      marketId: id,
      symbol: BREAKOUT_MARKETS.find((m) => m.marketId === id)!.symbol,
      window: breakoutWindow(id, H, D),
      financialReady: true,
      frame: frames.find((f) => f.snapshot.market.marketId === id)!,
      unavailableReasons: [],
    })),
    observation: { frames, funding: [], marksOnly: true },
    smaEvidence: { observedAt: D, frames, candles, sourceIds: ["controlled-common"] },
  };
}
export function breakoutAccounts(at = breakoutT0 + 1000): BreakoutAccountState[] {
  return (["C", "S", "L"] as const).map((role) => {
    const scope = {
      tenantId: "fixture",
      agentId: `controlled-${role}`,
      sessionId: `controlled-${role}`,
      network: "mainnet" as const,
    };
    const account = initialPaperAccount(scope, 1, at);
    account.marketDataPolicy = "stream-universe-component-paper-20s-v1";
    account.riskManagement = "buffered-selective-1x-v1";
    return { role, scope, view: { account, attempts: [], movements: [] } };
  });
}
export function breakoutSnapshot(): BreakoutScreenSnapshot {
  return {
    accounts: breakoutAccounts(),
    discoveries: [],
    closeObligations: [],
    unknownBarriers: [],
    closedFences: [],
  };
}

export function breakoutCertificate(
  scope: "source-local" | "financial-valuation" = "financial-valuation",
): BreakoutClockCertificate {
  return {
    id: `controlled-${scope}`,
    scope,
    epochId: "controlled-epoch",
    compatibilityId: "controlled-mapping",
    validFromMs: 0,
    validUntilMs: Number.MAX_SAFE_INTEGER,
    accepted: true,
    measuredBounds: {
      quantizationMs: 0.01,
      resolutionMs: 0.01,
      mappingUncertaintyMs: 0.01,
      offsetBoundMs: 0.01,
      driftBoundMs: 0.01,
    },
    provenance: ["CONTROLLED_NUMERIC_CERTIFICATE_NOT_MEASURED_RUNTIME_ACCEPTANCE"],
  };
}
export function breakoutBoundary(
  at: number,
  kind: BreakoutClockBoundary["kind"] = "V",
  width = 0.1,
): BreakoutClockBoundary {
  const scope = kind === "J" ? "source-local" : "financial-valuation";
  return {
    id: `${kind}:${at}`,
    kind,
    operationId: `operation:${at}`,
    certificateId: `controlled-${scope}`,
    epochId: "controlled-epoch",
    financial: { lowerMs: at, upperMs: at + width },
    monotonic: { lowerMs: at, upperMs: at + width },
    accountRole: "C",
    marketId: 1,
    sourceIdentity: `controlled-source:${at}`,
    authoritativeRecordId: `controlled-record:${at}`,
    acceptedProof: true,
  };
}
