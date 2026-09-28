import type { Scope } from "../research/types.js";
import type { PerpNetwork, PerpSymbol } from "../perps/types.js";
export interface PerpsPaperConfig {
  version: 1;
  policy: "conservative-1x-v1";
}
export interface PerpsPaperScope extends Scope {
  sessionId: string;
  network: PerpNetwork;
}
export type PerpsPaperSide = "long" | "short";
export interface PerpsPaperPosition {
  id: string;
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
}
export interface PerpsPaperAccount {
  scope: PerpsPaperScope;
  agentVersion: number;
  policy: "conservative-1x-v1";
  createdAt: number;
  cash: string;
  peakEquity: string;
  day: string;
  dayEquity: string | null;
  dailyBlocked: boolean;
  blocked: boolean;
  fundingPending: boolean;
  fundingDisputed?: boolean;
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
  mark?: { price: string; timestamp: number };
  quantity: string;
  price: string;
  notional: string;
  fee: string;
  block: number;
  timestamp: number;
  evidence: unknown;
}
export interface PerpsPaperRepository {
  closeAdmissions(scope: PerpsPaperScope): Promise<void>;
  observed(scope: PerpsPaperScope, key: string): Promise<boolean>;
  observe(
    scope: PerpsPaperScope,
    key: string,
    observation: import("./simulation.js").PerpsPaperObservation,
  ): Promise<PerpsPaperView>;
  initialize(scope: PerpsPaperScope, expectedVersion: number): Promise<PerpsPaperView>;
  view(scope: PerpsPaperScope): Promise<PerpsPaperView>;
  begin(
    scope: PerpsPaperScope,
    expectedVersion: number,
    key: string,
    intent: PerpsPaperIntent,
  ): Promise<{ attempt: PerpsPaperAttempt; lease: PerpsPaperLease | null }>;
  assertLease(scope: PerpsPaperScope, lease: PerpsPaperLease): Promise<void>;
  complete(
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    fill: PerpsPaperFill,
  ): Promise<PerpsPaperView>;
  fail(
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    code: string,
    evidence?: unknown,
  ): Promise<void>;
}
