import type { PerpNetwork } from "@pickler/core";
import type { PerpsPaperAccount } from "../perps-paper/types.js";
export const PERPS_STUDY_STRATEGIES = ["rules", "deepseek", "jev"] as const;
export type PerpsStrategy = (typeof PERPS_STUDY_STRATEGIES)[number];
export type PerpsStudyStrategy = PerpsStrategy | "combined";
export type PerpsStudyMap<T> = Record<"rules", T> &
  Partial<Record<Exclude<PerpsStudyStrategy, "rules">, T>>;
export const PERPS_FOUR_WAY_STRATEGIES = ["rules", "jev", "deepseek", "combined"] as const;
export function perpsStrategies(
  config: Pick<PerpsStudyConfig, "version">,
): readonly PerpsStudyStrategy[] {
  return config.version === 3
    ? ["rules"]
    : config.version === 2
      ? PERPS_FOUR_WAY_STRATEGIES
      : PERPS_STUDY_STRATEGIES;
}
export type {
  PerpsCallLane,
  PerpsEvidence,
  PerpsProposal,
  PerpsDecisionContext,
} from "../perps-strategies/types.js";
import type { PerpsCallLane, PerpsEvidence, PerpsProposal } from "../perps-strategies/types.js";
export interface PerpsStudyScope {
  tenantId: string;
  sessionId: string;
  network: PerpNetwork;
}
export interface PerpsPaidStudyConfig extends PerpsStudyScope {
  version: 1 | 2;
  protocol: "perps-comparison-v1" | "perps-four-way-v2";
  hours: 24 | 2;
  acknowledgedUnknownCalls?: {
    sessionId: string;
    roundKey: string;
    lane: PerpsCallLane;
    requestHash: string;
    reservationUsd: string;
  }[];
  budgetUsd: "5";
  deepseek: { model: string; baseUrl: string; inputPerMillion: string; outputPerMillion: string };
  jev: { model: "jev-1.13.0"; inputPerMillion: string; outputPerMillion: "0" };
  pricingVerifiedAt: string;
  pricingSources: string[];
}
export interface PerpsOriginalSmaConfig extends PerpsStudyScope {
  version: 3;
  protocol: "perps-original-sma-v1";
  hours: 24;
  budgetUsd: "5";
}
export type PerpsStudyConfig = PerpsPaidStudyConfig | PerpsOriginalSmaConfig;
export interface PerpsCall {
  requestHash?: string;
  inputBytes?: number;
  lane: PerpsCallLane;
  model: string;
  status: "reserved" | "started" | "completed" | "failed" | "skipped";
  reservationUsd: string;
  costUsd: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  result: unknown;
}
export interface PerpsRound {
  executionStatus: "pending" | "complete" | "skipped_data_unavailable" | "incomplete";
  executionReason?: "DATA_UNAVAILABLE";
  key: string;
  slot: number;
  status: "reserved" | "completed" | "failed" | "interrupted";
  createdAt: number;
  finishedAt: number | null;
  evidence: PerpsEvidence;
  accounts: PerpsStudyMap<PerpsPaperAccount>;
  proposals: Partial<Record<PerpsStudyStrategy, PerpsProposal[]>>;
  calls: Partial<Record<PerpsCallLane, PerpsCall>>;
}
export interface PerpsStudyRecord {
  config: PerpsStudyConfig;
  metadata: unknown;
  agentIds: PerpsStudyMap<string>;
  agentVersions: PerpsStudyMap<number>;
  createdAt: number;
  startedAt: number | null;
  endsAt: number | null;
  graceUntil: number | null;
  status: "initialized" | "running" | "monitoring" | "closing" | "completed" | "interrupted";
  decisionStopReason: string | null;
  stopRequested: boolean;
  lastObservationAt: number | null;
  lastRoundSlot: number;
  lastAttemptedSlot?: number;
  dataPolicy?: import("../perps-paper/acquisition.js").PerpsDataPolicy;
}
export interface PerpsStudyView {
  record: PerpsStudyRecord;
  rounds: PerpsRound[];
  events: { key: string; at: number; kind: string; data: unknown }[];
}
export interface PerpsStudyLease {
  /** Process-local fence; never persisted or sent to providers. */
  assertActive?: () => void;
  owner: string;
  expiresAt: number;
}
export interface PerpsStudyRepository {
  initialize(config: PerpsStudyConfig, metadata: unknown): Promise<PerpsStudyView>;
  view(scope: PerpsStudyScope): Promise<PerpsStudyView>;
  claim(scope: PerpsStudyScope): Promise<PerpsStudyLease>;
  claimSlot(scope: PerpsStudyScope, lease: PerpsStudyLease, slot: number): Promise<boolean>;
  renew(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<void>;
  release(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<void>;
  guard(scope: PerpsStudyScope, lease: PerpsStudyLease, paid?: boolean): Promise<void>;
  stop(scope: PerpsStudyScope): Promise<void>;
  event(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    kind: string,
    data: unknown,
  ): Promise<void>;
  reserve(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    slot: number,
    evidence: PerpsEvidence,
    accounts: PerpsStudyMap<PerpsPaperAccount>,
    rules: PerpsProposal[],
  ): Promise<PerpsRound | null>;
  startCall(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    lane: PerpsCallLane,
    request?: { sha256: string; bytes: number },
  ): Promise<void>;
  usage(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    lane: PerpsCallLane,
    input: number,
    output: number,
  ): Promise<void>;
  finishCall(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    lane: PerpsCallLane,
    result: unknown,
    error: string | null,
  ): Promise<void>;
  finishRound(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    proposals: Partial<Record<PerpsStudyStrategy, PerpsProposal[]>>,
  ): Promise<void>;
  stopDecisions(scope: PerpsStudyScope, lease: PerpsStudyLease, reason: string): Promise<void>;
  finishExecution(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    result: "complete" | "skipped_data_unavailable" | "incomplete",
  ): Promise<void>;
  complete(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<void>;
}
