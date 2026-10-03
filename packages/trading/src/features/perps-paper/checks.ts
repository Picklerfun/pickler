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
/**
 * `approving` while the owner's approval is being carried out: `decideProposal(id, "approved")`
 * moves a pending proposal there, and `settleProposal` makes it `approved` only once the open (or
 * size-up) succeeded, or puts it back to `pending` when the open was refused.
 */
export type PerpsProposalStatus = "pending" | "approving" | "approved" | "skipped" | "expired";
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
  /** When its current hourly slot opened (ms); the dispatcher keys the check `hourly:<slot>`. */
  slot: number;
}
/** The request key of an agent's hourly check for one slot: exactly one check per slot. */
export function hourlyRequestKey(slot: number) {
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new PilotError("INVALID_INPUT", "Invalid hourly slot");
  }
  return `hourly:${slot}`;
}
export interface PerpsCheckPage {
  items: PerpsCheck[];
  nextCursor: string | null;
}

export interface PerpsRuntimeRepository {
  /**
   * Queues a check; `CHECK_RUNNING` while another is queued or running for the agent. A repeated
   * `requestKey` answers the check it already started (the dispatcher uses `hourlyRequestKey`).
   */
  startCheck(input: {
    productAgentId: string;
    trigger: "hourly" | "manual";
    requestKey?: string | null;
  }): Promise<PerpsCheck>;
  /** Takes the agent's lease for a queued check; null when it is not claimable. */
  claimAgent(checkId: string): Promise<{ check: PerpsCheck; lease: PerpsCheckLease } | null>;
  /**
   * Extends the lease. The runtime renews it right before every paper action (open, close,
   * size-up) and abandons the check (`CHECK_INTERRUPTED`) when it fails, so a check whose lease was
   * recovered can never act; the paper store does not see the check lease itself.
   */
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
  /**
   * `PROPOSAL_DECIDED` unless pending; `PROPOSAL_EXPIRED` (and expires it) past its time. A skip is
   * final; an approval answers the proposal `approving`, and the host then acts and settles it.
   */
  decideProposal(id: string, decision: "approved" | "skipped"): Promise<PerpsProposal>;
  /**
   * Ends an approval: `approved` when the paper action succeeded, back to `pending` (until it
   * expires) when it was refused. `PROPOSAL_DECIDED` unless `approving`.
   */
  settleProposal(id: string, opened: boolean): Promise<PerpsProposal>;
  /** Expires pending proposals past their time, and approvals stuck five minutes past it. */
  expireProposals(): Promise<PerpsProposal[]>;
  /**
   * The Cron's sweep across agents: running checks whose lease lapsed end `CHECK_INTERRUPTED`,
   * queued checks nobody claimed end `CHECK_EXPIRED` (as `startCheck`/`claimAgent` do for one
   * agent). Answers how many ended.
   */
  recoverChecks(): Promise<number>;
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
