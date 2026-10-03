import { PilotError, type PerpSymbol } from "@pickler/core";
import type { PerpsCheckOutcome } from "../perps-runtime/outcome.js";
import type { PerpsPaperSide } from "./types.js";

/**
 * Storage port of the Perpl paper runtime (perpl-paper-runtime-v1 R1, R8, R14, R15): one row per
 * check, its timed steps, the proposals an approve-mode check leaves, and the per-agent lease a
 * running check holds. Outcomes are the runtime's `CHECK_OUTCOMES`; proposals live for its
 * `PROPOSAL_TTL_MS`. Infrastructure implements it; the runtime composes it.
 */
export const PERPS_CHECK_TRIGGERS = ["hourly", "manual", "exits", "owner", "system"] as const;
export type PerpsCheckTrigger = (typeof PERPS_CHECK_TRIGGERS)[number];
export type PerpsCheckStatus = "queued" | "running" | "finished";
/** A running check's lease lasts this long unless renewed. */
export const PERPS_CHECK_LEASE_MS = 60_000;
/** A queued check nobody claimed within this is expired (`CHECK_EXPIRED`). */
export const PERPS_CHECK_QUEUE_MS = 600_000;
export const PERPS_CHECK_PAGE = 50;
export const PERPS_CHECK_MAX_STEPS = 50;

export interface PerpsCheckStep {
  at: number;
  text: string;
  ms: number | null;
}
export interface PerpsCheckInputs {
  instruments: PerpSymbol[];
  web: boolean;
}
export interface PerpsCheck {
  id: string;
  productAgentId: string;
  tenantId: string;
  agentId: string;
  trigger: PerpsCheckTrigger;
  status: PerpsCheckStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  configVersion: number | null;
  inputs: PerpsCheckInputs | null;
  /** The validated `perps-check-v1` decision, stored as the runtime parsed it. */
  decision: unknown;
  outcome: PerpsCheckOutcome | null;
  outcomeText: string | null;
  steps: PerpsCheckStep[];
  /** Provider-reported cost in micro-USD; null while unknown. */
  costMicros: string | null;
  error: string | null;
}
export interface PerpsCheckLease {
  checkId: string;
  owner: string;
  expiresAt: number;
}
export interface PerpsCheckFinish {
  outcome: PerpsCheckOutcome;
  outcomeText: string;
  decision?: unknown;
  inputs?: PerpsCheckInputs | null;
  configVersion?: number | null;
  costMicros?: string | null;
  error?: string | null;
}
/** A finished row written at once: an exit, an owner action, a system note. */
export interface PerpsCheckRecord extends PerpsCheckFinish {
  productAgentId: string;
  trigger: PerpsCheckTrigger;
  steps?: { text: string; ms?: number | null }[];
}
export type PerpsProposalKind = "enter" | "size_up";
export type PerpsProposalStatus = "pending" | "approved" | "skipped" | "expired";
export interface PerpsProposal {
  id: string;
  checkId: string;
  productAgentId: string;
  tenantId: string;
  agentId: string;
  instrument: PerpSymbol;
  side: PerpsPaperSide;
  margin: string;
  leverage: number;
  kind: PerpsProposalKind;
  status: PerpsProposalStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  /** The position a size-up adds to. */
  positionId: string | null;
}
export interface PerpsProposalInput {
  instrument: PerpSymbol;
  side: PerpsPaperSide;
  margin: string;
  leverage: number;
  kind: PerpsProposalKind;
  positionId?: string | null;
}
/** A published, unpaused Perpl agent whose hourly check is due. */
export interface PerpsDueAgent {
  productAgentId: string;
  tenantId: string;
  agentId: string;
}
export interface PerpsCheckPage {
  items: PerpsCheck[];
  nextCursor: string | null;
}

export interface PerpsRuntimeRepository {
  /** Queues a check; `CHECK_RUNNING` while another is queued or running for the agent. */
  startCheck(input: {
    productAgentId: string;
    trigger: "hourly" | "manual";
    requestKey?: string | null;
  }): Promise<PerpsCheck>;
  /** Takes the agent's lease for a queued check; null when it is not claimable. */
  claimAgent(checkId: string): Promise<{ check: PerpsCheck; lease: PerpsCheckLease } | null>;
  renewAgent(lease: PerpsCheckLease): Promise<PerpsCheckLease>;
  /** Ends a claimed check as `failed` with `code` and frees the agent. */
  releaseAgent(lease: PerpsCheckLease, code?: string): Promise<PerpsCheck>;
  appendStep(lease: PerpsCheckLease, step: { text: string; ms?: number | null }): Promise<void>;
  finishCheck(lease: PerpsCheckLease, result: PerpsCheckFinish): Promise<PerpsCheck>;
  recordCheck(record: PerpsCheckRecord): Promise<PerpsCheck>;
  /** Pauses the agent and writes a `system` row in the same transaction (R11, R12). */
  pauseAgent(productAgentId: string, outcomeText: string): Promise<PerpsCheck>;
  getCheck(id: string): Promise<PerpsCheck | null>;
  listChecks(
    productAgentId: string,
    options?: { before?: string | null; outcomes?: readonly PerpsCheckOutcome[] },
  ): Promise<PerpsCheckPage>;
  dueAgents(limit?: number): Promise<PerpsDueAgent[]>;
  createProposal(lease: PerpsCheckLease, input: PerpsProposalInput): Promise<PerpsProposal>;
  getProposal(id: string): Promise<PerpsProposal | null>;
  listProposals(productAgentId: string): Promise<PerpsProposal[]>;
  /** `PROPOSAL_DECIDED` unless pending; `PROPOSAL_EXPIRED` (and expires it) past its time. */
  decideProposal(id: string, decision: "approved" | "skipped"): Promise<PerpsProposal>;
  expireProposals(): Promise<PerpsProposal[]>;
  checksToday(productAgentId: string): Promise<number>;
  manualChecksToday(productAgentId: string): Promise<number>;
  globalChecksToday(): Promise<number>;
  costToday(productAgentId: string): Promise<string>;
}

/** The minute of the hour an agent's hourly check runs at: its id spreads agents over the hour. */
export function perpsCheckMinute(productAgentId: string) {
  const hex = productAgentId.replaceAll("-", "").slice(0, 8);
  if (!/^[0-9a-f]{8}$/i.test(hex)) {
    throw new PilotError("INVALID_INPUT", "A product agent id is a UUID");
  }
  return Number.parseInt(hex, 16) % 60;
}
