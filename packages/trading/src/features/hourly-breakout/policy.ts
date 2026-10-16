import { PilotError, type PerpMarketInfo, type PerpSymbol } from "@pickler/core";
import { paperUnits as u } from "../perps-paper/decimal.js";
import { applyPaperFill, paperRisk } from "../perps-paper/policy.js";
import { simulatePerpsFill, validatePaperFrameSet } from "../perps-paper/simulation.js";
import { selectiveReduction } from "../perps-paper/selective.js";
import { assertProfileOpening, profileProposals } from "../perps-study/profiles.js";
import type { PerpsDecisionContext } from "../perps-strategies/types.js";
import type {
  PerpsPaperAccount,
  PerpsPaperAttempt,
  PerpsPaperLease,
} from "../perps-paper/types.js";
import {
  BREAKOUT_NAMESPACE,
  BREAKOUT_PARAMETER_CONTRACT_SHA256,
  BREAKOUT_RESEARCH_PROTOCOL_SHA256,
} from "./namespace.js";
import type {
  BreakoutCloseObligation,
  BreakoutCloseReason,
  BreakoutDigest,
  BreakoutDiscovery,
  BreakoutFinalSet,
  BreakoutFinancialRole,
  BreakoutInitialMarket,
  BreakoutOpeningIntent,
  BreakoutRawFlag,
  BreakoutReservedHead,
  BreakoutRunAcceptance,
  BreakoutScreenSnapshot,
  BreakoutSignal,
  BreakoutSignalUnavailable,
  BreakoutWindow,
  PerpsHourlyBreakoutConfig,
} from "./types.js";

export const BREAKOUT_HOUR_MS = 3_600_000;
export const BREAKOUT_DECISION_MS = 300_000;
export const BREAKOUT_ADMISSION_MS = 28 * 86_400_000;
export const BREAKOUT_HOLDING_MS = 4 * BREAKOUT_HOUR_MS;
export const BREAKOUT_FUNDING_GRACE_MS = 72 * BREAKOUT_HOUR_MS;
export const BREAKOUT_MARKETS = BREAKOUT_NAMESPACE.cohort;
/** Original public catalogue identity, separate from the immutable reviewed parameter namespace. */
export const BREAKOUT_STATIC_MARKET_IDENTITY = {
  network: "mainnet",
  chainId: 143,
  instanceId: 1,
  exchangeAddress: "0x34b6552d57a35a1d042ccae1951bd1c370112a6f",
  collateral: {
    tokenId: 1,
    address: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
    symbol: "AUSD",
    decimals: 6,
  },
  sourceHistorySha256: "748dea855e7e6b3fe4df32f0b227683fc2ee57c1ca8516d0684f9b0beb05c88c",
} as const;

export function assertBreakoutMarketIdentity(market: PerpMarketInfo): void {
  const expected = BREAKOUT_STATIC_MARKET_IDENTITY;
  if (
    !BREAKOUT_MARKETS.some((m) => m.marketId === market.marketId && m.symbol === market.symbol) ||
    market.provenance.network !== expected.network ||
    market.provenance.chainId !== expected.chainId ||
    market.perpetualId !== market.marketId ||
    market.instanceId !== expected.instanceId ||
    market.exchangeAddress.toLowerCase() !== expected.exchangeAddress ||
    market.collateral.tokenId !== expected.collateral.tokenId ||
    market.collateral.address.toLowerCase() !== expected.collateral.address ||
    market.collateral.symbol !== expected.collateral.symbol ||
    market.collateral.decimals !== expected.collateral.decimals
  ) {
    throw new PilotError(
      "PERPL_MARKET_IDENTITY",
      "Frozen original mainnet market identity required",
    );
  }
}

const invalid = (reason: string): never => {
  throw new PilotError("INVALID_INPUT", reason);
};

/** Python ensure_ascii=True / recursive sorted keys / retained array order / no newline. */
export function canonicalBreakoutJson(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalid("Canonical JSON requires finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalBreakoutJson).join(",")}]`;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return invalid("Canonical JSON requires original JSON values");
  }
  const codePointOrder = (a: string, b: string) => {
    const x = Array.from(a, (c) => c.codePointAt(0)!);
    const y = Array.from(b, (c) => c.codePointAt(0)!);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] !== y[i]) {
        return x[i]! - y[i]!;
      }
    }
    return x.length - y.length;
  };
  return `{${Object.keys(value)
    .sort(codePointOrder)
    .map(
      (key) =>
        `${canonicalBreakoutJson(key)}:${canonicalBreakoutJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

export function breakoutHash(value: unknown, digest: BreakoutDigest): string {
  const result = digest(canonicalBreakoutJson(value));
  if (!/^[a-f0-9]{64}$/.test(result)) {
    return invalid("SHA-256 digest required");
  }
  return result;
}

export function assertHourlyBreakoutConfig(c: PerpsHourlyBreakoutConfig): void {
  const keys = [
    "version",
    "protocol",
    "hours",
    "budgetUsd",
    "tenantId",
    "agentId",
    "sessionId",
    "network",
    "enabled",
    "financiallyExecutable",
    "T0",
    "operator",
    "parameterContractSha256",
    "researchProtocolSha256",
    "acquisitionPolicy",
    "markets",
  ];
  if (
    c.version !== 10 ||
    c.protocol !== "perps-hourly-breakout-fixed-screen-v1" ||
    c.hours !== 672 ||
    c.budgetUsd !== "5" ||
    c.network !== "mainnet" ||
    !c.tenantId ||
    !c.agentId ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(c.sessionId) ||
    c.enabled !== false ||
    c.financiallyExecutable !== false ||
    c.T0 !== null ||
    c.operator !== null ||
    c.parameterContractSha256 !== BREAKOUT_PARAMETER_CONTRACT_SHA256 ||
    c.researchProtocolSha256 !== BREAKOUT_RESEARCH_PROTOCOL_SHA256 ||
    c.acquisitionPolicy !== "stream-universe-component-paper-20s-v1" ||
    !Array.isArray(c.markets) ||
    c.markets.length !== 11 ||
    c.markets.some((m) => Object.keys(m).some((key) => !["symbol", "marketId"].includes(key))) ||
    BREAKOUT_MARKETS.some(
      (m) => !c.markets.some((v) => v.symbol === m.symbol && v.marketId === m.marketId),
    ) ||
    Object.keys(c).some((key) => !keys.includes(key))
  ) {
    invalid("Frozen disabled v10 specification required");
  }
}

export function assertBreakoutAcceptance(acceptance: BreakoutRunAcceptance, at: number): void {
  const hashes = [
    acceptance.protocolDigest,
    acceptance.technicalAcceptanceSha256,
    acceptance.sourceQualificationSha256,
    acceptance.financialAuthorizationSha256,
    acceptance.operator?.acknowledgementSha256,
  ];
  if (
    hashes.some((h) => !h || !/^[a-f0-9]{64}$/.test(h)) ||
    !acceptance.operator?.identity ||
    !Number.isSafeInteger(acceptance.T0) ||
    acceptance.T0 % 86_400_000 !== 0 ||
    !Number.isSafeInteger(acceptance.authorizedAt) ||
    acceptance.authorizedAt >= acceptance.T0 ||
    at < acceptance.authorizedAt ||
    !acceptance.acceptedClockCertificateIds.length ||
    new Set(acceptance.acceptedClockCertificateIds).size !==
      acceptance.acceptedClockCertificateIds.length
  ) {
    invalid("Explicit future UTC-midnight authorization and technical acceptance required");
  }
}

export function breakoutWindowTimes(T0: number) {
  if (!Number.isSafeInteger(T0) || T0 < 0 || T0 % 86_400_000 !== 0) {
    return invalid("UTC midnight T0 required");
  }
  const TA = T0 + BREAKOUT_ADMISSION_MS;
  const TV = TA + BREAKOUT_HOLDING_MS;
  const TF = TV + BREAKOUT_FUNDING_GRACE_MS;
  if (!Number.isSafeInteger(TF)) {
    return invalid("Unsafe screen endpoint");
  }
  return { T0, TA, TV, TF };
}

export function breakoutAccountNamespace(
  acceptance: BreakoutRunAcceptance,
  role: BreakoutFinancialRole,
  digest: BreakoutDigest,
) {
  return breakoutHash([acceptance.protocolDigest, acceptance.T0, role], digest);
}

interface ExactDecimal {
  numerator: bigint;
  denominator: bigint;
}
function exactDecimal(value: unknown): ExactDecimal {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,255})(?:\.\d{1,255})?$/.test(value)) {
    return invalid("Positive plain exact decimal required");
  }
  const [whole, fraction = ""] = value.split(".");
  return { numerator: BigInt(`${whole}${fraction}`), denominator: 10n ** BigInt(fraction.length) };
}
function compareDecimal(a: string, b: string): number {
  const x = exactDecimal(a);
  const y = exactDecimal(b);
  const delta = x.numerator * y.denominator - y.numerator * x.denominator;
  return delta > 0n ? 1 : delta < 0n ? -1 : 0;
}
function extreme(values: readonly string[], high: boolean): string {
  return values.reduce((best, value) =>
    compareDecimal(value, best) * (high ? 1 : -1) > 0 ? value : best,
  );
}
function rawFlag(close: string, high: string, low: string): BreakoutRawFlag {
  if (compareDecimal(close, high) > 0) {
    return "LONG";
  }
  return compareDecimal(close, low) < 0 ? "SHORT" : "NONE";
}

export function breakoutStaticMarketIdentity(market: PerpMarketInfo) {
  return {
    network: market.provenance.network,
    chainId: market.provenance.chainId,
    symbol: market.symbol,
    marketId: market.marketId,
    perpetualId: market.perpetualId,
    instanceId: market.instanceId,
    exchangeAddress: market.exchangeAddress,
    collateral: market.collateral,
  };
}

/** Structural discovery is independent of account state and financial/book availability. */
export function hourlyBreakoutSignal(
  window: BreakoutWindow,
  digest: BreakoutDigest,
): BreakoutSignal | BreakoutSignalUnavailable {
  try {
    const { market, H, D, bars } = window;
    assertBreakoutMarketIdentity(market);
    if (
      !Number.isSafeInteger(H) ||
      H < 0 ||
      H % BREAKOUT_HOUR_MS !== 0 ||
      !Number.isSafeInteger(D) ||
      D < H ||
      D >= H + BREAKOUT_DECISION_MS ||
      market.provenance.network !== "mainnet" ||
      market.provenance.chainId !== 143 ||
      !BREAKOUT_MARKETS.some((m) => m.symbol === market.symbol && m.marketId === market.marketId) ||
      !Number.isSafeInteger(market.perpetualId) ||
      !Number.isSafeInteger(market.instanceId) ||
      !/^0x[a-fA-F0-9]{40}$/.test(market.exchangeAddress) ||
      !/^0x[a-fA-F0-9]{40}$/.test(market.collateral.address)
    ) {
      return { status: "UNAVAILABLE", reason: "INVALID_HOURLY_WINDOW_IDENTITY_OR_CLOCK" };
    }
    if (bars.length !== 22) {
      return { status: "UNAVAILABLE", reason: "EXACT_22_BARS_REQUIRED" };
    }
    for (let i = 0; i < bars.length; i++) {
      const { candle: c, provenance: p } = bars[i]!;
      const closeTime = H - (21 - i) * BREAKOUT_HOUR_MS;
      if (
        !c.closed ||
        c.openTime !== closeTime - BREAKOUT_HOUR_MS ||
        !Number.isSafeInteger(c.openTime) ||
        !Number.isSafeInteger(p.firstReceiptAt) ||
        p.firstReceiptAt < closeTime ||
        p.firstReceiptAt > D ||
        !p.sourceRecordId ||
        !p.revisionId ||
        !p.requestId ||
        !/^[a-f0-9]{64}$/.test(p.responseSha256) ||
        !Number.isSafeInteger(p.seriesTimestamp) ||
        !Number.isSafeInteger(p.seriesBlock) ||
        p.seriesBlock < 0 ||
        p.resolution !== 3600 ||
        !Number.isSafeInteger(p.from) ||
        !Number.isSafeInteger(p.to) ||
        p.from > c.openTime ||
        p.to < closeTime ||
        !Number.isSafeInteger(c.trades) ||
        c.trades < 0 ||
        exactDecimal(c.volumeCollateral).numerator < 0n ||
        [c.open, c.high, c.low, c.close].some((value) => exactDecimal(value).numerator <= 0n) ||
        compareDecimal(c.low, c.open) > 0 ||
        compareDecimal(c.low, c.close) > 0 ||
        compareDecimal(c.high, c.open) < 0 ||
        compareDecimal(c.high, c.close) < 0
      ) {
        return { status: "UNAVAILABLE", reason: "INVALID_OR_UNRECEIVED_ORIGINAL_BAR" };
      }
    }
    const candles = bars.map((b) => b.candle);
    const current = candles[21]!;
    const previous = candles[20]!;
    const upper20 = extreme(
      candles.slice(1, 21).map((c) => c.high),
      true,
    );
    const lower20 = extreme(
      candles.slice(1, 21).map((c) => c.low),
      false,
    );
    const raw = rawFlag(current.close, upper20, lower20);
    const previousRaw = rawFlag(
      previous.close,
      extreme(
        candles.slice(0, 20).map((c) => c.high),
        true,
      ),
      extreme(
        candles.slice(0, 20).map((c) => c.low),
        false,
      ),
    );
    const fresh = raw !== "NONE" && raw !== previousRaw;
    const side = raw === "NONE" ? null : raw === "LONG" ? "long" : "short";
    const decisionKey = breakoutHash(
      [BREAKOUT_PARAMETER_CONTRACT_SHA256, market.provenance.network, market.marketId, 3600, H],
      digest,
    );
    const episodeKey = fresh
      ? breakoutHash(
          [BREAKOUT_PARAMETER_CONTRACT_SHA256, market.provenance.network, market.marketId, side, H],
          digest,
        )
      : null;
    const allocationId =
      episodeKey === null ? null : breakoutHash([episodeKey, "allocation-v1"], digest);
    return {
      status: "VALID",
      H,
      raw,
      previousRaw,
      fresh,
      side,
      signalClose: current.close,
      upper20,
      lower20,
      upper10: extreme(
        candles.slice(11, 21).map((c) => c.high),
        true,
      ),
      lower10: extreme(
        candles.slice(11, 21).map((c) => c.low),
        false,
      ),
      decisionKey,
      episodeKey,
      allocationId,
      attemptId: allocationId === null ? null : `${allocationId}:open`,
      windowDigest: breakoutHash(
        {
          parameterContractSha256: BREAKOUT_PARAMETER_CONTRACT_SHA256,
          market,
          resolution: 3600,
          H,
          bars: bars.map((bar) => ({ ...bar, closeTime: bar.candle.openTime + BREAKOUT_HOUR_MS })),
        },
        digest,
      ),
    };
  } catch (error) {
    if (!(error instanceof PilotError)) {
      throw error;
    }
    return { status: "UNAVAILABLE", reason: "INVALID_EXACT_DECIMAL_OR_PROVENANCE" };
  }
}

export function breakoutOpeningIntent(
  discovery: Pick<BreakoutDiscovery, "symbol" | "side">,
): BreakoutOpeningIntent {
  return {
    kind: "open",
    symbol: discovery.symbol,
    side: discovery.side,
    notional: "100",
    feeReserve: "1",
  };
}

export function assertBreakoutAccount(account: PerpsPaperAccount): void {
  if (
    account.scope.sessionId === "product" ||
    account.policy !== "conservative-1x-v1" ||
    account.marketDataPolicy !== "stream-universe-component-paper-20s-v1" ||
    account.riskManagement !== "buffered-selective-1x-v1" ||
    account.positionPolicy !== undefined ||
    account.entryPolicy !== undefined
  ) {
    invalid("Native v10 operator account policy required");
  }
}

export function breakoutCloseFenced(
  snapshot: BreakoutScreenSnapshot,
  role: BreakoutFinancialRole,
  symbol: PerpSymbol,
  at: number,
): boolean {
  return (
    snapshot.closeObligations.some(
      (o) => o.role === role && o.symbol === symbol && o.state !== "CONFIRMED",
    ) ||
    snapshot.closedFences.some(
      (f) =>
        f.role === role &&
        f.symbol === symbol &&
        (Math.floor(f.originatingAt / BREAKOUT_DECISION_MS) ===
          Math.floor(at / BREAKOUT_DECISION_MS) ||
          Math.floor(f.confirmedAt / BREAKOUT_DECISION_MS) ===
            Math.floor(at / BREAKOUT_DECISION_MS) ||
          (role !== "S" &&
            (Math.floor(f.originatingAt / BREAKOUT_HOUR_MS) === Math.floor(at / BREAKOUT_HOUR_MS) ||
              Math.floor(f.confirmedAt / BREAKOUT_HOUR_MS) === Math.floor(at / BREAKOUT_HOUR_MS)))),
    )
  );
}

/** All known C events are consumed; only the fixed initial eligible set can enter the serial queue. */
export function planBreakoutDiscoveries(input: {
  role: "C" | "L";
  initialOperationId: string;
  finalOperationId: string;
  H: number;
  D: number;
  markets: readonly BreakoutInitialMarket[];
  snapshot: BreakoutScreenSnapshot;
  digest: BreakoutDigest;
}): BreakoutDiscovery[] {
  if (
    new Set(input.markets.map((m) => m.marketId)).size !== input.markets.length ||
    new Set(input.markets.map((m) => m.symbol)).size !== input.markets.length
  ) {
    return invalid("Duplicate market identity invalidates allocation");
  }
  const state = input.snapshot.accounts.find((a) => a.role === input.role);
  if (!state) {
    return invalid("Independent role account required");
  }
  assertBreakoutAccount(state.view.account);
  let projected = structuredClone(state.view.account);
  const rows: BreakoutDiscovery[] = [];
  for (const market of [...input.markets].sort((a, b) => a.marketId - b.marketId)) {
    if (
      !market.window ||
      market.window.H !== input.H ||
      market.window.D !== input.D ||
      market.window.market.marketId !== market.marketId ||
      market.window.market.symbol !== market.symbol
    ) {
      continue;
    }
    const signal = hourlyBreakoutSignal(market.window, input.digest);
    if (signal.status !== "VALID" || (input.role === "C" && !signal.fresh)) {
      continue;
    }
    if (
      input.role === "L" &&
      state.view.account.positions.some((p) => p.symbol === market.symbol && p.closedAt === null)
    ) {
      continue;
    }
    const role = input.role;
    const episodeKey =
      role === "C"
        ? signal.episodeKey!
        : breakoutHash(
            [BREAKOUT_PARAMETER_CONTRACT_SHA256, "L", market.marketId, input.H],
            input.digest,
          );
    const allocationId =
      role === "C"
        ? signal.allocationId!
        : breakoutHash([episodeKey, "allocation-v1"], input.digest);
    if (input.snapshot.discoveries.some((d) => d.role === role && d.episodeKey === episodeKey)) {
      continue;
    }
    const row: BreakoutDiscovery = {
      role,
      variant: role === "C" ? "hourly-breakout" : "hourly-long",
      marketId: market.marketId,
      symbol: market.symbol,
      side: role === "C" ? signal.side! : "long",
      H: input.H,
      D: input.D,
      initialOperationId: input.initialOperationId,
      finalOperationId: input.finalOperationId,
      rank: rows.length + 1,
      decisionKey: signal.decisionKey,
      episodeKey,
      windowDigest: signal.windowDigest,
      allocationId,
      attemptId: `${allocationId}:open`,
      state: "QUEUED",
      initialBlockReasons: [],
      reserved: "0",
    };
    const reasons: string[] = [];
    if (input.snapshot.unknownBarriers.length) {
      reasons.push("UNKNOWN_OUTCOME_ADMISSIONS_STOPPED");
    }
    if (!market.financialReady || !market.frame) {
      reasons.push(...market.unavailableReasons, "INITIAL_FINANCIAL_DATA_UNAVAILABLE");
    }
    if (breakoutCloseFenced(input.snapshot, role, market.symbol, input.D)) {
      reasons.push("CLOSE_FENCE");
    }
    const intent = breakoutOpeningIntent(row);
    const risk = paperRisk(projected, [...state.view.attempts], input.D, intent);
    reasons.push(...risk.reasons);
    if (!reasons.length && market.frame) {
      try {
        const fill = simulatePerpsFill(projected, intent, market.frame, input.D);
        const attempt: PerpsPaperAttempt = {
          key: row.attemptId,
          intent,
          status: "pending",
          reserved: "101",
          createdAt: input.D,
          finishedAt: null,
          reason: null,
          evidence: null,
        };
        const next = applyPaperFill(projected, attempt, fill, input.D).account;
        assertProfileOpening(next, input.D);
        projected = next;
      } catch (error) {
        if (!(error instanceof PilotError)) {
          throw error;
        }
        reasons.push(error.code);
      }
    }
    if (reasons.length) {
      row.state = "INITIAL_BLOCKED";
      row.initialBlockReasons = [...new Set(reasons)];
    }
    rows.push(row);
  }
  return rows;
}

/** Only a trusted exact owned completion may exclude its own pending attempt from native risk. */
export function breakoutCompletionAttempts(
  attempts: readonly PerpsPaperAttempt[],
  head: BreakoutReservedHead,
  authoritativeLease: PerpsPaperLease,
): PerpsPaperAttempt[] {
  const matches = attempts.filter((a) => a.key === head.attempt.key);
  if (
    matches.length !== 1 ||
    matches[0]!.status !== "pending" ||
    matches[0]!.reserved !== "101" ||
    canonicalBreakoutJson(matches[0]!.intent) !==
      canonicalBreakoutJson(breakoutOpeningIntent(head.discovery)) ||
    head.attempt.key !== head.discovery.attemptId ||
    head.lease.key !== authoritativeLease.key ||
    head.lease.owner !== authoritativeLease.owner ||
    head.lease.expiresAt !== authoritativeLease.expiresAt ||
    authoritativeLease.key !== head.discovery.attemptId
  ) {
    throw new PilotError("LEASE_LOST", "Exact original pending attempt and owner required");
  }
  return attempts.filter((a) => a.key !== head.attempt.key);
}

/** Adapter invokes this against locked current state again immediately before COMMIT. */
export function assertBreakoutHead(input: {
  account: PerpsPaperAccount;
  attempts: readonly PerpsPaperAttempt[];
  head: BreakoutReservedHead;
  authoritativeLease: PerpsPaperLease;
  finalSet: BreakoutFinalSet;
  financialAt: number;
  receiptAt: number;
  digest: BreakoutDigest;
  config?: PerpsHourlyBreakoutConfig;
  unknownBarrier?: boolean;
  closeFenced?: boolean;
}) {
  const { account, head, finalSet, financialAt, receiptAt } = input;
  assertBreakoutAccount(account);
  if (input.unknownBarrier || input.closeFenced) {
    throw new PilotError("RISK_REJECTED", "Unknown-outcome or close fence stops new admissions");
  }
  const openingSlot =
    head.discovery.role === "S"
      ? Math.floor(head.discovery.D / BREAKOUT_DECISION_MS) * BREAKOUT_DECISION_MS
      : head.discovery.H;
  if (
    head.discovery.state !== "QUEUED" ||
    financialAt < head.discovery.D ||
    financialAt >= openingSlot + BREAKOUT_DECISION_MS ||
    receiptAt < finalSet.receiptAt ||
    finalSet.initialOperationId !== head.discovery.initialOperationId ||
    finalSet.operationId !== head.discovery.finalOperationId ||
    finalSet.H !== head.discovery.H ||
    finalSet.financialAt < head.discovery.D ||
    head.lease.expiresAt <= financialAt
  ) {
    throw new PilotError(
      "BREAKOUT_FINAL_WINDOW_REJECTED",
      "Original unexpired final operation required",
    );
  }
  const window = finalSet.windows.find((w) => w.market.marketId === head.discovery.marketId);
  const signal = window ? hourlyBreakoutSignal(window, input.digest) : null;
  if (
    head.discovery.role !== "S" &&
    (!signal ||
      signal.status !== "VALID" ||
      signal.windowDigest !== head.discovery.windowDigest ||
      (head.discovery.role === "C" &&
        (!signal.fresh ||
          signal.episodeKey !== head.discovery.episodeKey ||
          signal.side !== head.discovery.side)))
  ) {
    throw new PilotError("FINAL_SIGNAL_INPUT_REJECTED", "Exact original 22-bar input required");
  }
  let smaCloseSymbols: PerpSymbol[] = [];
  if (head.discovery.role === "S") {
    if (!input.config || !finalSet.smaEvidence) {
      throw new PilotError("SMA_FINAL_GATE_CHANGED", "Original final native SMA evidence required");
    }
    const context = { account, evidence: finalSet.smaEvidence };
    const proposals = breakoutSmaProposals(context, input.config);
    const proposal = proposals.find((p) => p.symbol === head.discovery.symbol);
    if (proposal?.action !== `open-${head.discovery.side}`) {
      throw new PilotError("SMA_FINAL_GATE_CHANGED", "Original native SMA direction must persist");
    }
    smaCloseSymbols = proposals.filter((p) => p.action === "close").map((p) => p.symbol);
  }
  const pending = breakoutCompletionAttempts(input.attempts, head, input.authoritativeLease);
  if (
    !finalSet.smaEvidence ||
    breakoutPreparationExclusions(finalSet.smaEvidence).some(
      (e) => e.symbol === head.discovery.symbol,
    )
  ) {
    throw new PilotError("DATA_UNAVAILABLE", "Final native 60-bar 1h/15m/5m readiness required");
  }
  validatePaperFrameSet(
    [...finalSet.frames],
    account.scope.network,
    financialAt,
    account.marketDataPolicy,
    receiptAt,
  );
  const due = detectBreakoutCloses({
    role: head.discovery.role,
    account,
    attempts: input.attempts,
    frames: finalSet.frames,
    at: financialAt,
    operationId: finalSet.operationId,
    digest: input.digest,
    signals: finalSet.windows.map((w) => ({
      symbol: w.market.symbol,
      signal: hourlyBreakoutSignal(w, input.digest),
    })),
    smaCloseSymbols,
  });
  if (due.length) {
    throw new PilotError("EXIT_REQUIRED", "Required full reduction precedes opening");
  }
  const intent = breakoutOpeningIntent(head.discovery);
  const risk = paperRisk(account, pending, financialAt, intent);
  if (!risk.allowed) {
    throw new PilotError("RISK_REJECTED", risk.reasons.join(","));
  }
  const frame = finalSet.frames.find((f) => f.snapshot.market.marketId === head.discovery.marketId);
  if (frame) {
    assertBreakoutMarketIdentity(frame.snapshot.market);
    assertBreakoutMarketIdentity(frame.book.market);
  }
  const originalMarket =
    window?.market ??
    finalSet.smaEvidence?.candles.find((c) => c.market.marketId === head.discovery.marketId)
      ?.market;
  if (
    !frame ||
    !originalMarket ||
    canonicalBreakoutJson(breakoutStaticMarketIdentity(frame.snapshot.market)) !==
      canonicalBreakoutJson(breakoutStaticMarketIdentity(originalMarket))
  ) {
    throw new PilotError("PERPL_MARKET_IDENTITY", "Frozen market identity required");
  }
  const fill = simulatePerpsFill(account, intent, frame, financialAt, receiptAt);
  const result = applyPaperFill(account, head.attempt, fill, financialAt);
  assertProfileOpening(result.account, financialAt);
  return { intent, fill, result };
}

/** Retain every coincident reason. Pending/unknown attempts affect execution, never detection. */
export function detectBreakoutCloses(input: {
  role: BreakoutFinancialRole;
  account: PerpsPaperAccount;
  attempts: readonly PerpsPaperAttempt[];
  frames: BreakoutFinalSet["frames"];
  at: number;
  operationId: string;
  digest: BreakoutDigest;
  terminal?: boolean;
  unknown?: boolean;
  signals?: readonly { symbol: PerpSymbol; signal: BreakoutSignal | BreakoutSignalUnavailable }[];
  smaCloseSymbols?: readonly PerpSymbol[];
}): BreakoutCloseObligation[] {
  const { account, at, role } = input;
  const risk = paperRisk(account, [...input.attempts], at);
  const channelDue =
    role === "C" &&
    account.positions.some((p) => {
      const signal = input.signals?.find((s) => s.symbol === p.symbol)?.signal;
      return (
        p.closedAt === null &&
        signal?.status === "VALID" &&
        (p.side === "long"
          ? compareDecimal(signal.signalClose, signal.lower10) < 0
          : compareDecimal(signal.signalClose, signal.upper10) > 0)
      );
    });
  const compulsoryBeforeSelective =
    risk.closeSymbols.length > 0 ||
    input.terminal === true ||
    channelDue ||
    (role === "S" && !!input.smaCloseSymbols?.length);
  // Individual mandatory exits settle first. Only the resulting actual portfolio may choose
  // the native fewest-close subset; an earlier cheap subset must not add unnecessary closes.
  const selective = compulsoryBeforeSelective
    ? null
    : selectiveReduction(account, input.frames, at);
  return account.positions
    .filter((p) => p.closedAt === null)
    .flatMap((p) => {
      const reasons: BreakoutCloseReason[] = [];
      const freshMark =
        p.mark !== null && p.markAt !== null && at - p.markAt <= 30_000 && p.markAt <= at + 5000;
      if (
        freshMark &&
        (p.side === "long"
          ? u(p.mark!) * 100n <= u(p.entryPrice) * 98n
          : u(p.mark!) * 100n >= u(p.entryPrice) * 102n)
      ) {
        reasons.push("STOP_2_PERCENT");
      }
      if (at - p.openedAt >= BREAKOUT_HOLDING_MS) {
        reasons.push("AGE_4_HOURS");
      }
      if (risk.reasons.includes("DAILY_LOSS")) {
        reasons.push("DAILY_LOSS");
      }
      if (risk.equity !== null && u(risk.equity) * 100n <= u(account.peakEquity) * 95n) {
        reasons.push("PEAK_DRAWDOWN");
      }
      if (account.blocked) {
        reasons.push("BLOCKED");
      }
      if (risk.reasons.includes("INSOLVENT")) {
        reasons.push("INSOLVENT");
      }
      if (selective?.status === "planned" && selective.symbols.includes(p.symbol)) {
        reasons.push("SELECTIVE_EXPOSURE");
      }
      const signal = input.signals?.find((s) => s.symbol === p.symbol)?.signal;
      if (
        role === "C" &&
        signal?.status === "VALID" &&
        (p.side === "long"
          ? compareDecimal(signal.signalClose, signal.lower10) < 0
          : compareDecimal(signal.signalClose, signal.upper10) > 0)
      ) {
        reasons.push("CHANNEL_10");
      }
      if (role === "S" && input.smaCloseSymbols?.includes(p.symbol)) {
        reasons.push("SMA_NEUTRAL_OR_OPPOSITE");
      }
      if (input.terminal) {
        reasons.push("TERMINAL");
      }
      if (!reasons.length) {
        return [];
      }
      const marketId =
        p.market?.marketId ??
        input.frames.find((f) => f.snapshot.market.symbol === p.symbol)?.snapshot.market.marketId;
      if (marketId === undefined) {
        return invalid("Required close market identity unavailable");
      }
      return [
        {
          id: breakoutHash([account.scope, p.id, "FULL_CLOSE"], input.digest),
          role,
          marketId,
          symbol: p.symbol,
          positionId: p.id,
          side: p.side,
          quantity: p.quantity,
          originalOperationId: input.operationId,
          scheduledAt: at,
          detectedAt: at,
          reasons,
          evidence: {
            mark: p.mark,
            markAt: p.markAt,
            openedAt: p.openedAt,
            risk,
            signal: signal ?? null,
            selective,
          },
          state: input.unknown
            ? "BLOCKED_UNKNOWN"
            : input.attempts.some((a) => a.status === "pending")
              ? "BLOCKED_PENDING"
              : "DUE",
        },
      ];
    });
}

/** S retains native hourly SMA ranking and all initial native readiness exclusions. */
export function breakoutSmaProposals(
  context: PerpsDecisionContext,
  config: PerpsHourlyBreakoutConfig,
  blocked = false,
) {
  const extra = breakoutPreparationExclusions(context.evidence);
  const evidence = {
    ...context.evidence,
    excluded: [...(context.evidence.excluded ?? []), ...extra],
  };
  return profileProposals({ ...context, evidence }, config, "sma-reference", blocked);
}

/** Shared preparation remains separate from C's 22-bar structural population and P_context. */
export function breakoutPreparationExclusions(
  evidence: import("../perps-strategies/types.js").PerpsEvidence,
) {
  const excluded: { symbol: PerpSymbol; code: string; phase: string }[] = [];
  for (const market of BREAKOUT_MARKETS) {
    let valid = true;
    for (const resolution of [3600, 900, 300]) {
      const series = evidence.candles.find(
        (s) =>
          s.market.marketId === market.marketId &&
          s.market.symbol === market.symbol &&
          s.resolution === resolution,
      );
      if (series) {
        assertBreakoutMarketIdentity(series.market);
      }
      const end = Math.floor(evidence.observedAt / (resolution * 1000)) * resolution * 1000;
      const candles =
        series?.candles
          .filter((c) => c.closed && c.openTime + resolution * 1000 <= evidence.observedAt)
          .slice(-60) ?? [];
      if (
        candles.length !== 60 ||
        candles.some(
          (c, i) =>
            c.openTime !== end - (60 - i) * resolution * 1000 ||
            series!.missingOpenTimes.includes(c.openTime),
        )
      ) {
        valid = false;
        continue;
      }
      try {
        if (
          candles.some(
            (c) =>
              [c.open, c.high, c.low, c.close].some((v) => u(v) <= 0n) ||
              u(c.low) > u(c.open) ||
              u(c.low) > u(c.close) ||
              u(c.high) < u(c.open) ||
              u(c.high) < u(c.close),
          )
        ) {
          valid = false;
        }
      } catch (error) {
        if (!(error instanceof PilotError)) {
          throw error;
        }
        valid = false;
      }
    }
    if (!valid) {
      excluded.push({
        symbol: market.symbol,
        code: "NATIVE_PREPARATION_UNAVAILABLE",
        phase: "common-preparation",
      });
    }
  }
  return excluded;
}

/** Original S actions are selected once; later neutral/hold cannot be promoted to an opening. */
export function planBreakoutSmaDiscoveries(input: {
  config: PerpsHourlyBreakoutConfig;
  context: PerpsDecisionContext;
  snapshot: BreakoutScreenSnapshot;
  initialOperationId: string;
  finalOperationId: string;
  digest: BreakoutDigest;
}): BreakoutDiscovery[] {
  const state = input.snapshot.accounts.find((a) => a.role === "S");
  if (!state) {
    return invalid("Independent S account required");
  }
  const D = input.context.evidence.observedAt;
  const H = Math.floor(D / BREAKOUT_HOUR_MS) * BREAKOUT_HOUR_MS;
  const proposals = breakoutSmaProposals(
    input.context,
    input.config,
    input.snapshot.unknownBarriers.length > 0,
  );
  return proposals
    .filter((p) => p.action.startsWith("open-"))
    .map((proposal) => {
      const market = input.config.markets.find((m) => m.symbol === proposal.symbol)!;
      const decisionKey = breakoutHash(
        [
          BREAKOUT_PARAMETER_CONTRACT_SHA256,
          "S",
          market.marketId,
          Math.floor(D / BREAKOUT_DECISION_MS),
        ],
        input.digest,
      );
      const allocationId = breakoutHash([decisionKey, "allocation-v1"], input.digest);
      // Native initial selection already projects its required closes and ranked fills. Actual
      // reservations later use the complete authoritative current pending set again.
      const reasons: string[] = [];
      if (state.view.attempts.some((a) => a.status === "pending")) {
        reasons.push("ATTEMPT_PENDING");
      }
      if (breakoutCloseFenced(input.snapshot, "S", proposal.symbol, D)) {
        reasons.push("CLOSE_FENCE");
      }
      return {
        role: "S",
        variant: "sma-reference",
        marketId: market.marketId,
        symbol: market.symbol,
        side: proposal.action === "open-long" ? "long" : "short",
        H,
        D,
        initialOperationId: input.initialOperationId,
        finalOperationId: input.finalOperationId,
        rank: proposal.rank!,
        decisionKey,
        episodeKey: decisionKey,
        windowDigest: breakoutHash(
          {
            sourceIds: input.context.evidence.sourceIds,
            candles: input.context.evidence.candles.filter(
              (c) => c.market.symbol === market.symbol,
            ),
            observedAt: D,
          },
          input.digest,
        ),
        allocationId,
        attemptId: `${allocationId}:open`,
        state: reasons.length ? "INITIAL_BLOCKED" : "QUEUED",
        initialBlockReasons: [...new Set(reasons)],
        reserved: "0",
      };
    });
}

/** Classification only; back-inside prices never add an execution gate. */
export function breakoutEntryBoundary(
  signal: BreakoutSignal,
  fill: { notional: string; quantity: string } | null,
) {
  if (!fill || signal.side === null) {
    return "NO_CONFIRMED_FILL" as const;
  }
  const boundary = exactDecimal(signal.side === "long" ? signal.upper20 : signal.lower20);
  const notional = exactDecimal(fill.notional);
  const quantity = exactDecimal(fill.quantity);
  const delta =
    notional.numerator * quantity.denominator * boundary.denominator -
    boundary.numerator * notional.denominator * quantity.numerator;
  if (signal.side === "long") {
    return delta > 0n ? "ABOVE_U20" : delta === 0n ? "ON_U20" : "BACK_INSIDE_U20";
  }
  return delta < 0n ? "BELOW_L20" : delta === 0n ? "ON_L20" : "BACK_INSIDE_L20";
}
