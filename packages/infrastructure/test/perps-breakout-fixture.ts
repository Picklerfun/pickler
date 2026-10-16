import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import type { PerpFundingHistory, PerpMarketInfo, PerpSymbol } from "@pickler/core";
import {
  BREAKOUT_MARKETS,
  BREAKOUT_STATIC_MARKET_IDENTITY,
  BREAKOUT_PARAMETER_CONTRACT_SHA256,
  BREAKOUT_RESEARCH_PROTOCOL_SHA256,
  planBreakoutDiscoveries,
  type BreakoutClockBoundary,
  type BreakoutFinancialReceiptContext,
  type BreakoutFinancialRole,
  type BreakoutFinalSet,
  type BreakoutReservedHead,
  type BreakoutRunAcceptance,
  type BreakoutWindow,
  type PerpsHourlyBreakoutConfig,
} from "@pickler/trading/evaluation";
import {
  COMPONENT_PAPER_POLICY,
  type PerpsPaperAccount,
  type PerpsPaperFrame,
  type PerpsPaperPosition,
} from "@pickler/trading/perps";
import { PostgresPerpsHourlyBreakoutStore } from "../src/persistence/perps-breakout-store.js";
import { createTestStore } from "./database.js";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const T0 = Date.UTC(2026, 9, 16);

export function controlledFrame(
  at: number,
  symbol: PerpSymbol = "BTC",
  mark = "100",
  block = 100,
): PerpsPaperFrame {
  const id = BREAKOUT_MARKETS.find((m) => m.symbol === symbol)!.marketId;
  const provenance = {
    provider: "perpl" as const,
    pluginVersion: "1.1.0" as const,
    network: "mainnet" as const,
    chainId: 143,
    url: "https://example.invalid/controlled-public-evidence",
    receivedAt: at,
    providerTimestamp: at,
    block,
  };
  const market: PerpMarketInfo = {
    symbol,
    marketId: id,
    perpetualId: id,
    instanceId: 1,
    exchangeAddress: BREAKOUT_STATIC_MARKET_IDENTITY.exchangeAddress,
    collateral: {
      tokenId: 1,
      address: BREAKOUT_STATIC_MARKET_IDENTITY.collateral.address,
      symbol: "AUSD",
      decimals: 6,
    },
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
  const price = Number(mark);
  const snapshot = {
    market,
    ticker: {
      mark,
      index: mark,
      last: mark,
      bid: (price - 0.01).toFixed(2),
      ask: (price + 0.01).toFixed(2),
      openInterestBase: "20",
      freshness: "fresh" as const,
      provenance,
    },
    funding: null,
  };
  const book = {
    market,
    requestedLevels: 20,
    depthLimited: true as const,
    bids: [{ price: (price - 0.01).toFixed(2), size: "100", orders: 1 }],
    asks: [{ price: (price + 0.01).toFixed(2), size: "100", orders: 1 }],
    freshness: "fresh" as const,
    provenance,
  };
  const streamEvidence = {
    policy: COMPONENT_PAPER_POLICY,
    generation: 1,
    copiedAt: at,
    heartbeatSequence: 1,
    headBlock: block,
    heartbeatReceivedAt: at,
  };
  return {
    snapshot,
    book,
    streamEvidence,
    hash: digest(JSON.stringify({ snapshot, book, streamEvidence })),
  };
}

export function controlledWindow(frame: PerpsPaperFrame, H = T0, D = H + 1000): BreakoutWindow {
  return {
    market: frame.snapshot.market,
    H,
    D,
    bars: Array.from({ length: 22 }, (_, i) => ({
      candle: {
        openTime: H - (22 - i) * 3600000,
        open: "100",
        high: i === 21 ? "103" : "101",
        low: "99",
        close: i === 21 ? "102" : "100",
        volumeCollateral: "1000",
        trades: 1,
        closed: true,
        ancillary: `original-${i}`,
      },
      provenance: {
        firstReceiptAt: D,
        sourceRecordId: `original-${frame.snapshot.market.marketId}-${i}`,
        revisionId: "1",
        requestId: "original-request",
        responseSha256: "a".repeat(64),
        seriesTimestamp: H,
        seriesBlock: 100,
        from: H - 22 * 3600000,
        to: H,
        resolution: 3600,
      },
    })),
  };
}

export async function breakoutFixture(t: TestContext, poolTransform?: (pool: Pool) => Pool) {
  let now = T0 - 60000;
  let beforeEffect: (() => void) | undefined;
  let afterCommit: (() => void) | undefined;
  const database = await createTestStore(t, () => now);
  const config: PerpsHourlyBreakoutConfig = {
    version: 10,
    protocol: "perps-hourly-breakout-fixed-screen-v1",
    tenantId: "alpha",
    agentId: "pickle-alpha",
    sessionId: "controlled-hourly-breakout",
    network: "mainnet",
    hours: 672,
    budgetUsd: "5",
    enabled: false,
    financiallyExecutable: false,
    T0: null,
    operator: null,
    parameterContractSha256: BREAKOUT_PARAMETER_CONTRACT_SHA256,
    researchProtocolSha256: BREAKOUT_RESEARCH_PROTOCOL_SHA256,
    acquisitionPolicy: COMPONENT_PAPER_POLICY,
    markets: BREAKOUT_MARKETS.map((m) => ({ ...m })),
  };
  const acceptance: BreakoutRunAcceptance = {
    protocolDigest: BREAKOUT_RESEARCH_PROTOCOL_SHA256,
    T0,
    authorizedAt: T0 - 120000,
    operator: { identity: "controlled-liability-owner", acknowledgementSha256: "b".repeat(64) },
    technicalAcceptanceSha256: "c".repeat(64),
    sourceQualificationSha256: "d".repeat(64),
    acceptedClockCertificateIds: ["controlled-exact-clock"],
    financialAuthorizationSha256: "e".repeat(64),
  };
  const boundary = (
    context: BreakoutFinancialReceiptContext,
    before: boolean,
  ): BreakoutClockBoundary => ({
    id: `${before ? "A" : "V"}:${context.operationId}:${context.role}`,
    kind: before ? "A_BEFORE_EFFECT" : context.action === "FULL_CLOSE" ? "V_CLOSE" : "V",
    operationId: context.operationId,
    certificateId: "controlled-exact-clock",
    epochId: "controlled-epoch",
    financial: { lowerMs: now, upperMs: now },
    monotonic: { lowerMs: now - T0, upperMs: now - T0 },
    accountRole: context.role,
    marketIds: [...context.marketIds],
    sourceIdentity: context.sourceIdentity,
    authoritativeRecordId: context.authoritativeRecordId,
    acceptedRecords: context.marketIds.map((marketId) => ({
      marketId,
      recordId: context.authoritativeRecordId,
      sourceIdentity: context.sourceIdentity,
    })),
    acceptedProof: true,
  });
  const options = {
    clock: () => now,
    receiptClock: () => now,
    financialReceipts: {
      beforeEffect: (context: BreakoutFinancialReceiptContext) => {
        const value = boundary(context, true);
        beforeEffect?.();
        return value;
      },
      afterCommit: (context: BreakoutFinancialReceiptContext) => {
        afterCommit?.();
        return boundary(context, false);
      },
    },
  };
  const store = new PostgresPerpsHourlyBreakoutStore(
    poolTransform?.(database.pool) ?? database.pool,
    options,
  );
  const initial = await store.initialize(
    config,
    { fixture: "controlled-only-no-provider" },
    acceptance,
  );
  now = T0 + 1000;
  const lease = await store.claim(config);
  return {
    database,
    store,
    config,
    acceptance,
    initial,
    lease,
    options,
    now: () => now,
    setNow: (at: number) => {
      now = at;
    },
    advance: (ms: number) => {
      now += ms;
    },
    onBeforeEffect: (action?: () => void) => {
      beforeEffect = action;
    },
    onAfterCommit: (action?: () => void) => {
      afterCommit = action;
    },
  };
}

export async function discover(
  f: Awaited<ReturnType<typeof breakoutFixture>>,
  roles: readonly ("C" | "L")[] = ["C"],
  symbols: readonly PerpSymbol[] = ["BTC"],
) {
  const frames = symbols.map((symbol) => controlledFrame(f.now(), symbol));
  const windows = frames.map((frame) => controlledWindow(frame));
  const snapshot = await f.store.snapshot(f.config, f.lease);
  const discoveries = roles.flatMap((role) =>
    planBreakoutDiscoveries({
      role,
      initialOperationId: "controlled-original-initial",
      finalOperationId: "controlled-original-final",
      H: T0,
      D: f.now(),
      markets: frames.map((frame, i) => ({
        window: windows[i]!,
        marketId: frame.snapshot.market.marketId,
        symbol: frame.snapshot.market.symbol,
        financialReady: true,
        frame,
        unavailableReasons: [],
      })),
      snapshot,
      digest,
    }),
  );
  const committed = await f.store.commitDiscovery(f.config, f.lease, {
    operationId: "controlled-original-initial",
    H: T0,
    D: f.now(),
    discoveries,
    initialEvidence: { frames, windows },
  });
  assert.equal(committed.status, "confirmed");
  const smaEvidence = {
    observedAt: f.now(),
    frames,
    sourceIds: ["controlled-native-preparation"],
    candles: frames.flatMap((frame, marketIndex) =>
      [3600, 900, 300].map((resolution) => {
        const end = Math.floor(f.now() / (resolution * 1000)) * resolution * 1000;
        const candles = Array.from({ length: 60 }, (_, i) => ({
          openTime: end - (60 - i) * resolution * 1000,
          open: "100",
          high: "101",
          low: "99",
          close: "100",
          volumeCollateral: "1000",
          trades: 1,
          closed: true,
        }));
        if (resolution === 3600) {
          for (let i = 0; i < 22; i++) {
            Object.assign(candles[38 + i]!, windows[marketIndex]!.bars[i]!.candle);
          }
        }
        return {
          market: frame.snapshot.market,
          resolution,
          from: candles[0]!.openTime,
          to: end,
          candles,
          missingOpenTimes: [],
          provenance: frame.snapshot.market.provenance,
        };
      }),
    ),
  };
  const finalSet: BreakoutFinalSet = {
    smaEvidence,
    operationId: "controlled-original-final",
    H: T0,
    initialOperationId: "controlled-original-initial",
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    frames,
    windows,
    observation: { marksOnly: true, frames, funding: [] },
  };
  return { discoveries, finalSet };
}

export async function reserve(
  f: Awaited<ReturnType<typeof breakoutFixture>>,
  discovery: Awaited<ReturnType<typeof discover>>["discoveries"][number],
): Promise<BreakoutReservedHead> {
  const result = await f.store.reserveHead(f.config, f.lease, discovery);
  assert.equal(
    result.status,
    "confirmed",
    result.status === "rolled_back" ? result.code : "unknown",
  );
  if (result.status !== "confirmed") {
    throw new Error("Fixture reservation was not confirmed");
  }
  return result.value;
}

export async function roleAccount(
  f: Awaited<ReturnType<typeof breakoutFixture>>,
  role: BreakoutFinancialRole,
) {
  const state = (await f.store.snapshot(f.config, f.lease)).accounts.find(
    (account) => account.role === role,
  )!;
  const result = await f.database.pool.query<{ id: string; document: PerpsPaperAccount }>(
    "SELECT id,document FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND agent_id=$2 AND session_id=$3 AND network=$4",
    [state.scope.tenantId, state.scope.agentId, state.scope.sessionId, state.scope.network],
  );
  return result.rows[0]!;
}

export function closedPosition(
  id: string,
  market: PerpMarketInfo,
  at = T0 + 1000,
): PerpsPaperPosition {
  return {
    id,
    market,
    symbol: market.symbol,
    side: "long",
    quantity: "1",
    entryPrice: "100",
    entryNotional: "100",
    openedAt: at - 300000,
    entryBlock: 1,
    mark: "100",
    markAt: at - 60000,
    closedAt: at - 60000,
    exitPrice: "100",
    exitBlock: 20,
  };
}

export function controlledFunding(frame: PerpsPaperFrame, at = T0 + 1000): PerpFundingHistory {
  return {
    market: frame.snapshot.market,
    from: at - 300000,
    to: at,
    complete: true,
    pages: [frame.snapshot.market.provenance],
    events: [
      {
        eventBlock: 10,
        appliesAt: at - 120000,
        rate: "0.0001",
        index: "100",
        estimated: false,
        provenance: frame.snapshot.market.provenance,
      },
    ],
  };
}
