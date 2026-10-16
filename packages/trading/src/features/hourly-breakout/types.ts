import type { PerpCandles, PerpMarketInfo, PerpSymbol } from "@pickler/core";
import type { PerpsStudyScope, PerpsStudyLease } from "../perps-study/types.js";
import type {
  PerpsPaperAttempt,
  PerpsPaperIntent,
  PerpsPaperLease,
  PerpsPaperScope,
  PerpsPaperSide,
  PerpsPaperView,
} from "../perps-paper/types.js";
import type { PerpsPaperFrame, PerpsPaperObservation } from "../perps-paper/simulation.js";

export const HOURLY_BREAKOUT_VARIANTS = [
  "hourly-breakout",
  "sma-reference",
  "hourly-long",
] as const;
export type HourlyBreakoutVariant = (typeof HOURLY_BREAKOUT_VARIANTS)[number];
export const BREAKOUT_FINANCIAL_ROLES = ["C", "S", "L"] as const;
export type BreakoutFinancialRole = (typeof BREAKOUT_FINANCIAL_ROLES)[number];
export type BreakoutRawFlag = "LONG" | "SHORT" | "NONE";
export type BreakoutDigest = (canonicalUtf8: string) => string;

/** A prepared specification has no authority to allocate an account, schedule, or position. */
export interface PerpsHourlyBreakoutConfig extends PerpsStudyScope {
  agentId: string;
  version: 10;
  protocol: "perps-hourly-breakout-fixed-screen-v1";
  hours: 672;
  budgetUsd: "5";
  network: "mainnet";
  enabled: false;
  financiallyExecutable: false;
  T0: null;
  operator: null;
  parameterContractSha256: string;
  researchProtocolSha256: string;
  acquisitionPolicy: "stream-universe-component-paper-20s-v1";
  markets: { symbol: PerpSymbol; marketId: number }[];
}

/** Separate pre-T0 authorization. No constructor supplies defaults for these acknowledgements. */
export interface BreakoutRunAcceptance {
  protocolDigest: string;
  T0: number;
  authorizedAt: number;
  operator: { identity: string; acknowledgementSha256: string };
  technicalAcceptanceSha256: string;
  sourceQualificationSha256: string;
  acceptedClockCertificateIds: readonly string[];
  financialAuthorizationSha256: string;
}

export interface BreakoutClockInterval {
  lowerMs: number;
  upperMs: number;
}

export interface BreakoutClockCertificate {
  id: string;
  scope: "source-local" | "financial-valuation";
  epochId: string;
  compatibilityId: string;
  validFromMs: number;
  validUntilMs: number;
  accepted: boolean;
  measuredBounds: {
    quantizationMs: number;
    resolutionMs: number;
    mappingUncertaintyMs: number;
    offsetBoundMs: number;
    driftBoundMs: number;
  };
  provenance: readonly string[];
}

export type BreakoutBoundaryKind = "J" | "V" | "A_BEFORE_EFFECT" | "OPENED_AT" | "V_CLOSE" | "K";
export interface BreakoutClockBoundary {
  id: string;
  kind: BreakoutBoundaryKind;
  operationId: string;
  certificateId: string;
  epochId: string;
  financial: BreakoutClockInterval;
  monotonic: BreakoutClockInterval;
  accountRole?: BreakoutFinancialRole;
  marketId?: number;
  marketIds?: readonly number[];
  acceptedRecords?: readonly { marketId: number; recordId: string; sourceIdentity: string }[];
  sourceIdentity?: string;
  authoritativeRecordId?: string;
  acceptedProof?: boolean;
}

export interface BreakoutCandleProvenance {
  firstReceiptAt: number;
  sourceRecordId: string;
  revisionId: string;
  requestId: string;
  responseSha256: string;
  seriesTimestamp: number;
  seriesBlock: number;
  from: number;
  to: number;
  resolution: 3600;
}

export interface BreakoutOriginalCandle {
  /** Keep every original field, including ancillary fields and exact decimal text. */
  candle: PerpCandles["candles"][number] & Readonly<Record<string, unknown>>;
  provenance: BreakoutCandleProvenance;
}

export interface BreakoutWindow {
  market: PerpMarketInfo;
  H: number;
  D: number;
  bars: readonly BreakoutOriginalCandle[];
}

export interface BreakoutSignal {
  status: "VALID";
  H: number;
  raw: BreakoutRawFlag;
  previousRaw: BreakoutRawFlag;
  fresh: boolean;
  side: PerpsPaperSide | null;
  signalClose: string;
  upper20: string;
  lower20: string;
  upper10: string;
  lower10: string;
  decisionKey: string;
  episodeKey: string | null;
  allocationId: string | null;
  attemptId: string | null;
  windowDigest: string;
}

export interface BreakoutSignalUnavailable {
  status: "UNAVAILABLE";
  reason: string;
}

export interface BreakoutDiscovery {
  role: BreakoutFinancialRole;
  variant: HourlyBreakoutVariant;
  marketId: number;
  symbol: PerpSymbol;
  side: PerpsPaperSide;
  H: number;
  D: number;
  initialOperationId: string;
  finalOperationId: string;
  rank: number;
  decisionKey: string;
  episodeKey: string;
  windowDigest: string;
  allocationId: string;
  attemptId: string;
  /** Queued entitlement is not a native pending attempt and reserves exactly zero. */
  state: "QUEUED" | "INITIAL_BLOCKED";
  initialBlockReasons: readonly string[];
  reserved: "0";
}

export type BreakoutCloseReason =
  | "STOP_2_PERCENT"
  | "AGE_4_HOURS"
  | "CHANNEL_10"
  | "SMA_NEUTRAL_OR_OPPOSITE"
  | "DAILY_LOSS"
  | "PEAK_DRAWDOWN"
  | "SELECTIVE_EXPOSURE"
  | "BLOCKED"
  | "INSOLVENT"
  | "TERMINAL";

export interface BreakoutCloseObligation {
  id: string;
  role: BreakoutFinancialRole;
  marketId: number;
  symbol: PerpSymbol;
  positionId: string;
  side: PerpsPaperSide;
  quantity: string;
  originalOperationId: string;
  scheduledAt: number;
  detectedAt: number;
  reasons: readonly BreakoutCloseReason[];
  evidence: unknown;
  state: "DUE" | "BLOCKED_PENDING" | "BLOCKED_UNKNOWN" | "CONFIRMED";
}

export interface BreakoutAcknowledgement {
  operationId: string;
  authoritativeRecordId: string;
  receivedAt: number | null;
  receiptStatus?: "QUALIFIED" | "KNOWN_EFFECT_V_UNPROVED" | "ORIGINAL_RECEIPT_UNAVAILABLE";
  receipt?: BreakoutClockBoundary;
  /** Present only when independently authoritative, never inferred from precommit/ack. */
  irreversibleCommitAt?: BreakoutClockInterval;
  /** Exact accepted markets only; a BTC acknowledgement cannot advance ETH. */
  valuationReceipts?: readonly BreakoutClockBoundary[];
}

export type BreakoutDurableResult<T> =
  | { status: "confirmed"; value: T; acknowledgement: BreakoutAcknowledgement; replayed?: boolean }
  | { status: "rolled_back"; code: string; acknowledgement: BreakoutAcknowledgement }
  | {
      status: "unknown";
      code: string;
      operationId: string;
      affectedRoles: readonly BreakoutFinancialRole[];
    };

export interface BreakoutUnknownBarrier {
  operationId: string;
  affectedRoles: readonly BreakoutFinancialRole[];
  code: string;
  detectedAt: number;
}

export interface BreakoutAccountState {
  role: BreakoutFinancialRole;
  scope: PerpsPaperScope;
  view: PerpsPaperView;
}

export interface BreakoutScreenSnapshot {
  accounts: readonly BreakoutAccountState[];
  discoveries: readonly BreakoutDiscovery[];
  initialOperationIds?: readonly string[];
  closeObligations: readonly BreakoutCloseObligation[];
  unknownBarriers: readonly BreakoutUnknownBarrier[];
  closedFences: readonly {
    role: BreakoutFinancialRole;
    symbol: PerpSymbol;
    originatingAt: number;
    confirmedAt: number;
  }[];
}

export interface BreakoutFinalSet {
  operationId: string;
  sourceDeadlineAt: number;
  H: number;
  initialOperationId: string;
  financialAt: number;
  receiptAt: number;
  frames: readonly PerpsPaperFrame[];
  /** The same selected original bars and first receipts; newer source copies cannot replace them. */
  windows: readonly BreakoutWindow[];
  observation: PerpsPaperObservation;
  smaEvidence?: import("../perps-strategies/types.js").PerpsEvidence;
}

export interface BreakoutReservedHead {
  discovery: BreakoutDiscovery;
  attempt: PerpsPaperAttempt;
  lease: PerpsPaperLease;
}

/** New v10 port. It must not widen the historical PTS-only captured transaction. */
export interface BreakoutScreenRepository {
  guard(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<void>;
  hasDiscoveryOperation(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    operationId: string,
  ): Promise<boolean>;
  snapshot(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<BreakoutScreenSnapshot>;
  commitDiscovery(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: {
      operationId: string;
      H: number;
      D: number;
      discoveries: readonly BreakoutDiscovery[];
      initialEvidence: unknown;
    },
  ): Promise<BreakoutDurableResult<readonly BreakoutDiscovery[]>>;
  latchCloses(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    obligations: readonly BreakoutCloseObligation[],
  ): Promise<BreakoutDurableResult<readonly BreakoutCloseObligation[]>>;
  /** Retire only obsolete selective-only intents against current locked native state. */
  reconcileSelective(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: { operationId: string; observation: PerpsPaperObservation },
  ): Promise<BreakoutDurableResult<void>>;
  reserveHead(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    discovery: BreakoutDiscovery,
  ): Promise<BreakoutDurableResult<BreakoutReservedHead>>;
  executeHead(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: {
      head: BreakoutReservedHead;
      finalSet: BreakoutFinalSet;
      deadline: number;
      expectedWindowDigest: string;
    },
  ): Promise<BreakoutDurableResult<PerpsPaperView>>;
  rejectHead(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: {
      head: BreakoutReservedHead;
      code: string;
      /** Required authoritative proof for this exact original phase. */
      noEffectAcknowledgement: BreakoutAcknowledgement | null;
      knownUnexecuted?: true;
    },
  ): Promise<BreakoutDurableResult<PerpsPaperView>>;
  close(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: {
      obligation: BreakoutCloseObligation;
      finalSet: BreakoutFinalSet;
    },
  ): Promise<BreakoutDurableResult<PerpsPaperView>>;
  observe(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: {
      operationId: string;
      observation: PerpsPaperObservation;
      financialAt: number;
      receiptAt: number;
      sourceDeadlineAt: number;
      roles: readonly BreakoutFinancialRole[];
    },
  ): Promise<BreakoutDurableResult<readonly BreakoutAccountState[]>>;
  closeAdmissions(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    operationId: string,
  ): Promise<BreakoutDurableResult<void>>;
  recordBarrier(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    barrier: BreakoutUnknownBarrier,
  ): Promise<void>;
  event(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    kind: string,
    data: unknown,
  ): Promise<void>;
}

export interface BreakoutFinancialReceiptContext {
  operationId: string;
  sourceIdentity: string;
  action: "OPEN" | "FULL_CLOSE" | "OBSERVE";
  role: BreakoutFinancialRole;
  marketIds: readonly number[];
  authoritativeRecordId: string;
}

/** Synchronous hooks sample the original boundary inside the adapter; never replay samples. */
export interface BreakoutFinancialReceiptHooks {
  beforeEffect(context: BreakoutFinancialReceiptContext): BreakoutClockBoundary;
  afterCommit(context: BreakoutFinancialReceiptContext): BreakoutClockBoundary;
  getAcknowledgement?(operationId: string): BreakoutAcknowledgement | null;
}

export interface BreakoutScreenStore extends BreakoutScreenRepository {
  initialize(
    config: PerpsHourlyBreakoutConfig,
    metadata: unknown,
    acceptance: BreakoutRunAcceptance,
  ): Promise<BreakoutScreenSnapshot>;
  claim(scope: PerpsStudyScope): Promise<PerpsStudyLease>;
  claimSlot(scope: PerpsStudyScope, lease: PerpsStudyLease, slot: number): Promise<boolean>;
  renew(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<void>;
  release(scope: PerpsStudyScope, lease: PerpsStudyLease, interruption?: string): Promise<void>;
  guard(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<void>;
}

export interface BreakoutInitialMarket {
  window: BreakoutWindow | null;
  marketId: number;
  symbol: PerpSymbol;
  /** Shared native 60-bar 1h/15m/5m preparation plus original initial component frame. */
  financialReady: boolean;
  frame: PerpsPaperFrame | null;
  unavailableReasons: readonly string[];
}

export interface BreakoutInitialSet {
  operationId: string;
  scheduledAt: number;
  D: number;
  financialAt: number;
  receiptAt: number;
  sourceDeadlineAt: number;
  markets: readonly BreakoutInitialMarket[];
  observation: PerpsPaperObservation;
  smaEvidence: import("../perps-strategies/types.js").PerpsEvidence;
}

export interface BreakoutFinalEvidenceRequest {
  operationId: string;
  initial: BreakoutInitialSet;
  signal: AbortSignal;
}

export interface BreakoutCoordinatorDependencies {
  config: PerpsHourlyBreakoutConfig;
  acceptance: BreakoutRunAcceptance;
  repository: BreakoutScreenRepository;
  lease: PerpsStudyLease;
  clock(): number;
  receiptClock(): number;
  digest: BreakoutDigest;
  finalEvidence(request: BreakoutFinalEvidenceRequest): Promise<BreakoutFinalSet>;
}

export type BreakoutOpeningIntent = PerpsPaperIntent & {
  kind: "open";
  notional: "100";
  feeReserve: "1";
};
