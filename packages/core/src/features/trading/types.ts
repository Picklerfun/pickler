import type { AgentRecord, Market, Scope, RunRecord } from "../research/types.js";

export type TradingMode = "off" | "manual" | "automatic";
export type TradingConfig = { version: 1; mode: TradingMode };
export type TradingOrigin = "manual" | "agent";
export type LiveStatus =
  | "prepared"
  | "queued"
  | "submitting"
  | "unknown"
  | "settled"
  | "not_filled"
  | "failed"
  | "expired";
export interface TradingAccount extends Scope {
  wallet: string;
  signer: string;
  chainId: 137;
  budgetMicros: number;
  reservedMicros: number;
  spentMicros: number;
}
export interface BuyRequest {
  marketId: string;
  outcomeId: string;
  limitPrice: string;
  budget: string;
}
export interface LivePreview extends BuyRequest {
  market: Market;
  estimatedFee: string;
  estimatedShares: string;
  observedAt: number;
}
export interface LiveOrder extends Scope {
  id: string;
  runId: string | null;
  origin: TradingOrigin;
  status: LiveStatus;
  configVersion: number;
  preview: LivePreview;
  createdAt: number;
  expiresAt: number;
  orderHash: string | null;
  reason: string | null;
  fill: LiveFill | null;
}
export interface LiveFill {
  shares: string;
  costUpperBound: string;
  transactionHashes: string[];
}
export type Reconciliation =
  { status: "unknown" } | { status: "not_filled" } | { status: "settled"; fill: LiveFill };
export interface TradingProvider {
  identity(): { wallet: string; signer: string };
  check(signal: AbortSignal): Promise<{ balance: string; approved: boolean; blocked: boolean }>;
  preview(request: BuyRequest, signal: AbortSignal): Promise<LivePreview>;
  sign(preview: LivePreview, signal: AbortSignal): Promise<{ hash: string; payload: unknown }>;
  submit(payload: unknown, signal: AbortSignal): Promise<void>;
  reconcile(order: LiveOrder, signal: AbortSignal): Promise<Reconciliation>;
}
export interface TradingRepository {
  account(scope: Scope): Promise<TradingAccount>;
  bind(scope: Scope, identity: { wallet: string; signer: string }): Promise<TradingAccount>;
  agent(scope: Scope): Promise<AgentRecord>;
  run(tenantId: string, id: string): Promise<RunRecord>;
  prepare(scope: Scope, preview: LivePreview, key: string, runId?: string): Promise<LiveOrder>;
  enqueue(tenantId: string, id: string, key: string): Promise<LiveOrder>;
  get(tenantId: string, id: string): Promise<LiveOrder>;
  list(scope: Scope): Promise<LiveOrder[]>;
  claim(): Promise<LiveOrder | null>;
  guard(order: LiveOrder): Promise<void>;
  markSubmitting(order: LiveOrder, hash: string, preview?: LivePreview): Promise<void>;
  complete(order: LiveOrder, result: Reconciliation): Promise<void>;
  failUnsent(order: LiveOrder, reason: string): Promise<void>;
  pending(): Promise<LiveOrder[]>;
  automaticCandidates(): Promise<RunRecord[]>;
}
