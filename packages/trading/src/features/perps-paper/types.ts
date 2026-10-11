import type { Scope } from "@pickler/core";
import type { PerpNetwork, PerpSymbol } from "@pickler/core";
export interface PerpsPaperScope extends Scope {
  sessionId: string;
  network: PerpNetwork;
}
/**
 * The session of a studio agent's paper account (perpl-paper-runtime-v1 R9): one per agent and
 * network, not pinned to a config version, sized by the runtime's caps instead of the 1x policy.
 */
export const PRODUCT_PAPER_SESSION = "product";
export const isProductPaperSession = (scope: Pick<PerpsPaperScope, "sessionId">) =>
  scope.sessionId === PRODUCT_PAPER_SESSION;
export type PerpsPaperSide = "long" | "short";
/** Explicit local paper adoption; absence keeps historical five-second coherence. */
export const COMPONENT_PAPER_POLICY = "stream-universe-component-paper-20s-v1" as const;
export type PerpsPaperDataPolicy = typeof COMPONENT_PAPER_POLICY;
/** Why a product position closed: the runtime's `CLOSE_REASONS` (R10). */
export type PerpsPaperCloseReason = import("../perps-runtime/exits.js").PerpsCloseReason;
/** A product position's exits (R10), stored on the position when it opens. */
export interface PerpsPaperExits {
  stopPrice: string | null;
  takeProfitPrice: string | null;
  exitDueAt: number | null;
}
export interface PerpsPaperPosition {
  id: string;
  market?: import("@pickler/core").PerpMarketInfo;
  symbol: PerpSymbol;
  side: PerpsPaperSide;
  quantity: string;
  entryPrice: string;
  entryNotional: string;
  openedAt: number;
  entryBlock: number;
  mark: string | null;
  markAt: number | null;
  closedAt: number | null;
  exitPrice: string | null;
  exitBlock: number | null;
  /** Product positions only: absent on operator documents, which keep their historical shape. */
  leverage?: number;
  margin?: string;
  checkId?: string | null;
  configVersion?: number;
  stopPrice?: string | null;
  takeProfitPrice?: string | null;
  exitDueAt?: number | null;
  closeReason?: PerpsPaperCloseReason | null;
  /** Margin added to the position after it opened (size-ups, R8), each with its time. */
  sizeUps?: { at: number; margin: string }[];
  pts?: import("../pts/types.js").PtsPositionState;
}
export interface PerpsPaperAccount {
  scope: PerpsPaperScope;
  agentVersion: number;
  policy: "conservative-1x-v1";
  /** Immutable and assigned only from the trusted local study, never an intent. */
  marketDataPolicy?: PerpsPaperDataPolicy;
  /** Absent in historical documents; selected only by trusted study initialization. */
  riskManagement?: "legacy-1x-v1" | "buffered-selective-1x-v1";
  /** Trusted local study policy. Absence preserves historical entry behavior. */
  entryPolicy?: "unrestricted-hourly-v1" | "once-hourly-bar-v1";
  consumedEntryKeys?: string[];
  /** Trusted local v8 policy; never selected by an order intent. */
  positionPolicy?: "pts-basic-1x-0.2.0";
  consumedPtsSetups?: string[];
  createdAt: number;
  cash: string;
  peakEquity: string;
  day: string;
  dayEquity: string | null;
  dailyBlocked: boolean;
  blocked: boolean;
  fundingPending: boolean;
  fundingDisputed?: boolean;
  /** Product-only freshness; historical laboratory documents remain unchanged. */
  lastFundingAt?: number;
  admissionsClosed?: boolean;
  lastValuationAt?: number;
  positions: PerpsPaperPosition[];
}
export interface PerpsPaperIntent {
  kind: "open" | "close";
  symbol: PerpSymbol;
  side: PerpsPaperSide;
  notional: string;
  feeReserve: string;
  /** Final evidence reference only; cannot choose the account entry policy. */
  entryEvidence?: { roundKey: string; candleOpenTime: number; resolution: 3600 };
  /** Product opens only; operator sessions refuse anything but 1x. */
  leverage?: number;
  checkId?: string;
  pts?: import("../pts/types.js").PtsIntentEvidence;
}
export interface PerpsPaperAttempt {
  key: string;
  intent: PerpsPaperIntent;
  status: "pending" | "filled" | "rejected" | "failed" | "interrupted";
  reserved: string;
  createdAt: number;
  finishedAt: number | null;
  reason: string | null;
  evidence: unknown;
}
export interface PerpsPaperLease {
  key: string;
  owner: string;
  expiresAt: number;
}
export interface PerpsPaperMovement {
  key: string;
  kind: "initial" | "fee" | "realized-pnl" | "funding";
  delta: string;
  at: number;
  evidence: unknown;
}
export interface PerpsPaperView {
  account: PerpsPaperAccount;
  attempts: PerpsPaperAttempt[];
  movements: PerpsPaperMovement[];
}
export interface PerpsPaperRisk {
  allowed: boolean;
  reasons: string[];
  closeSymbols: PerpSymbol[];
  cash: string;
  equity: string | null;
  unrealized: string | null;
  margin: string;
  reserved: string;
  available: string | null;
  exposure: string | null;
}
export interface PerpsPaperFill {
  market?: import("@pickler/core").PerpMarketInfo;
  mark?: { price: string; timestamp: number };
  quantity: string;
  price: string;
  notional: string;
  fee: string;
  block: number;
  timestamp: number;
  evidence: unknown;
}
/** A rolled-back common valuation never authorizes maintenance or financial execution. */
export type PerpsCommonObservationResult =
  | {
      status: "complete";
      replayed: boolean;
      financialAt: number;
      receiptAt: number;
      accounts: { scope: PerpsPaperScope; before: PerpsPaperView; view: PerpsPaperView }[];
    }
  | {
      status: "data_unavailable";
      rolledBack: true;
      code: "STALE_MARKET_DATA";
      validation: import("./simulation.js").PerpsFrameValidationFailure["details"];
    };
export interface PerpsPaperRepository {
  closeAdmissions(scope: PerpsPaperScope): Promise<void>;
  observed(scope: PerpsPaperScope, key: string): Promise<boolean>;
  observe(
    scope: PerpsPaperScope,
    key: string,
    observation: import("./simulation.js").PerpsPaperObservation,
  ): Promise<PerpsPaperView>;
  /** Component-paper accounts share one observation, clock and rollback boundary. */
  observeCommon?(
    scopes: readonly PerpsPaperScope[],
    key: string,
    observation: import("./simulation.js").PerpsPaperObservation,
  ): Promise<PerpsCommonObservationResult>;
  /** `startingCash` is required for a product session and refused for an operator session. */
  initialize(
    scope: PerpsPaperScope,
    expectedVersion: number,
    startingCash?: string,
  ): Promise<PerpsPaperView>;
  view(scope: PerpsPaperScope): Promise<PerpsPaperView>;
  begin(
    scope: PerpsPaperScope,
    expectedVersion: number,
    key: string,
    intent: PerpsPaperIntent,
  ): Promise<{ attempt: PerpsPaperAttempt; lease: PerpsPaperLease | null }>;
  /** Explicit component-paper execution of an already shared frame in one fenced transaction. */
  executeFrame?(
    scope: PerpsPaperScope,
    key: string,
    intent: PerpsPaperIntent,
    frame: import("./simulation.js").PerpsPaperFrame,
    onSimulation?: (durationMs: number) => void,
  ): Promise<PerpsPaperView>;
  assertLease(scope: PerpsPaperScope, lease: PerpsPaperLease): Promise<void>;
  complete(
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    fill: PerpsPaperFill,
    exits?: PerpsPaperExits,
  ): Promise<PerpsPaperView>;
  fail(
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    code: string,
    evidence?: unknown,
  ): Promise<void>;
}
/** An open product position whose exit is due, as the exits job reads it (R10). */
export interface PerpsDuePosition {
  scope: PerpsPaperScope;
  productAgentId: string;
  position: PerpsPaperPosition;
  reason: "stop" | "take_profit" | "time";
}
/** A mark the exits job read from the market board. */
export interface PerpsPaperMark {
  network: PerpNetwork;
  symbol: PerpSymbol;
  mark: string;
}
/** Product paper accounts: closes outside an attempt lease, and the exits job's read. */
export interface PerpsProductPaperRepository extends PerpsPaperRepository {
  /** Closes one position at `frame`; a position already closed answers `closed: false`. */
  closePosition(
    scope: PerpsPaperScope,
    positionId: string,
    reason: PerpsPaperCloseReason,
    frame: import("./simulation.js").PerpsPaperFrame,
  ): Promise<{ closed: boolean; position: PerpsPaperPosition; view: PerpsPaperView }>;
  /** Open product positions past their time stop, or whose mark crossed stop or target. */
  openDuePositions(marks: readonly PerpsPaperMark[]): Promise<PerpsDuePosition[]>;
  /** Margin opened since `since` (positions opened then, plus size-ups then), in AUSD. */
  newMarginSince(scope: PerpsPaperScope, since: number): Promise<string>;
  /**
   * The account as `view` answers it, read without locks or writes: attempts whose lease lapsed
   * are shown `interrupted` but not rewritten. For reads (the studio's routes), never before an
   * action. `NOT_FOUND` without an account.
   */
  snapshot(scope: PerpsPaperScope): Promise<PerpsPaperView>;
  /**
   * R8's size-up: adds `margin` (AUSD) to an open position at its leverage, filled at `frame`.
   * `key` makes it idempotent (a repeat answers `added: false`); `POSITION_CLOSED` once closed,
   * `PAUSED` while paused, `INSUFFICIENT_AVAILABLE` without the margin plus the fee reserve free.
   */
  sizeUp(
    scope: PerpsPaperScope,
    positionId: string,
    input: { key: string; margin: string },
    frame: import("./simulation.js").PerpsPaperFrame,
  ): Promise<{ added: boolean; position: PerpsPaperPosition; view: PerpsPaperView }>;
  /** Account identities with open product positions, for unpaid reconciliation. */
  openProductAccounts?(): Promise<{ productAgentId: string; scope: PerpsPaperScope }[]>;
  /** Networks with an open product position, for the exits job's marks. */
  openNetworks(): Promise<PerpNetwork[]>;
}

/** Trusted execution owner, bound by composition rather than caller/model input. */
export interface PerpsProductPaperFence {
  scope: PerpsPaperScope;
  configVersion: number;
  lease: import("./checks.js").PerpsCheckLease;
  requireReservation: boolean;
  signal?: AbortSignal;
}
