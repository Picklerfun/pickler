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
  /** Versioned Studio result or unchanged historical perps-check-v1 answer. */
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
   * Queues a check; `CHECK_RUNNING` while another is queued or running for the agent,
   * `AGENT_KILLED` for a killed agent. A repeated `requestKey` answers the check it already
   * started (the dispatcher uses `hourlyRequestKey`).
   */
  startCheck(input: {
    productAgentId: string;
    trigger: "hourly" | "manual";
    requestKey?: string | null;
  }): Promise<PerpsCheck>;
  /** Claims an unpaid supervision slot; returns null while another check owns the agent. */
  claimSupervision?(
    productAgentId: string,
  ): Promise<{ check: PerpsCheck; lease: PerpsCheckLease } | null>;
  /** Takes the agent's lease for a queued check; null when it is not claimable. */
  claimAgent(checkId: string): Promise<{ check: PerpsCheck; lease: PerpsCheckLease } | null>;
  /**
   * Extends the lease. The runtime renews it right before every paper action (open, close,
   * size-up) and abandons the check (`CHECK_INTERRUPTED`) when it fails, so a check whose lease was
   * recovered can never act; product financial writes also verify this lease within their own transactions.
   */
  renewAgent(lease: PerpsCheckLease): Promise<PerpsCheckLease>;
  /** Ends a claimed check as `failed` with `code` and frees the agent. */
  releaseAgent(lease: PerpsCheckLease, code?: string): Promise<PerpsCheck>;
  appendStep(lease: PerpsCheckLease, step: { text: string; ms?: number | null }): Promise<void>;
  finishCheck(lease: PerpsCheckLease, result: PerpsCheckFinish): Promise<PerpsCheck>;
  recordCheck(record: PerpsCheckRecord): Promise<PerpsCheck>;
  /**
   * Pauses the agent and writes a `system` row in the same transaction (R11, R12). Idempotent: an
   * agent already paused writes nothing and answers null, so racing closers pause it once.
   */
  pauseAgent(productAgentId: string, outcomeText: string): Promise<PerpsCheck | null>;
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
  costToday(productAgentId: string): Promise<string | null>;
}

/** The minute of the hour an agent's hourly check runs at: its id spreads agents over the hour. */
export function perpsCheckMinute(productAgentId: string) {
  const hex = productAgentId.replaceAll("-", "").slice(0, 8);
  if (!/^[0-9a-f]{8}$/i.test(hex)) {
    throw new PilotError("INVALID_INPUT", "A product agent id is a UUID");
  }
  return Number.parseInt(hex, 16) % 60;
}

/**
 * The owner's paper actions (perpl-paper-runtime-v1 R8, R12): "Close now", "Stop · close all" and
 * an approval. The API writes one durable row per request (idempotent by its request key); the
 * research worker claims it, waits for the agent's lease and carries it out as an `owner` check.
 * A Queue message only wakes the worker with the row's id, and the minute Cron re-drives rows left
 * pending, so no action depends on a delivery.
 */
export const PERPS_OWNER_ACTION_KINDS = ["close", "stop_all", "approve"] as const;
export type PerpsOwnerActionKind = (typeof PERPS_OWNER_ACTION_KINDS)[number];
/** `pending` → `running` (claimed) → `done` | `failed`; a busy agent puts it back to `pending`. */
export const PERPS_OWNER_ACTION_STATUSES = ["pending", "running", "done", "failed"] as const;
export type PerpsOwnerActionStatus = (typeof PERPS_OWNER_ACTION_STATUSES)[number];
/** A claim lasts this long: the wait for the agent plus the action's own minute, with room. */
export const PERPS_ACTION_LEASE_MS = 180_000;
/** The minute Cron re-drives pending actions untouched for this long. */
export const PERPS_ACTION_REDRIVE_MS = 30_000;
/** Claims an action may take before it ends `failed` (`TOO_MANY_ATTEMPTS`). */
export const PERPS_ACTION_MAX_ATTEMPTS = 30;

export interface PerpsOwnerAction {
  id: string;
  productAgentId: string;
  kind: PerpsOwnerActionKind;
  /** The position a `close` closes. */
  positionId: string | null;
  /** The proposal an `approve` approves. */
  proposalId: string | null;
  status: PerpsOwnerActionStatus;
  attempts: number;
  /** The last attempt's code (`CHECK_RUNNING` while a check held the agent). */
  lastError: string | null;
  /** The `owner` check of the latest attempt that held the agent. */
  checkId: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface PerpsOwnerActionClaim {
  actionId: string;
  owner: string;
  attempt: number;
  expiresAt: number;
}

export interface PerpsOwnerActionRepository {
  /**
   * Writes the owner's action; the same `requestKey` for the same agent answers the row it wrote
   * (`CONFLICT` when the key was used for another action). `AGENT_KILLED` for an approval of a
   * killed agent.
   */
  createAction(input: {
    productAgentId: string;
    kind: PerpsOwnerActionKind;
    positionId?: string | null;
    proposalId?: string | null;
    requestKey: string;
  }): Promise<PerpsOwnerAction>;
  getAction(id: string): Promise<PerpsOwnerAction | null>;
  /**
   * Claims a pending action (or a running one whose claim lapsed); null when another claim holds
   * it, or it ended. Past `PERPS_ACTION_MAX_ATTEMPTS` it ends `failed` instead.
   */
  claimAction(
    id: string,
  ): Promise<{ action: PerpsOwnerAction; claim: PerpsOwnerActionClaim } | null>;
  /**
   * In one transaction: re-checks the claim, recovers the agent's lapsed checks, and starts an
   * `owner` check already holding the agent's lease. `CHECK_RUNNING` while another check is queued
   * or running; null when the claim no longer holds the action. `killed` says whether the agent
   * was killed.
   */
  startActionCheck(
    claim: PerpsOwnerActionClaim,
  ): Promise<{ check: PerpsCheck; lease: PerpsCheckLease; killed: boolean } | null>;
  /** Puts a claimed action back to `pending` with the attempt's code (it is re-driven later). */
  releaseAction(claim: PerpsOwnerActionClaim, code: string): Promise<void>;
  /**
   * Finishes the action's check and sets the action's status in one transaction: `done`, `failed`,
   * or `pending` again to retry (a close that could not reach Perpl).
   */
  finishAction(
    lease: PerpsCheckLease,
    actionId: string,
    result: PerpsCheckFinish,
    status: "done" | "failed" | "pending",
  ): Promise<PerpsCheck>;
  /** Pending actions untouched for `PERPS_ACTION_REDRIVE_MS`, and running ones whose claim lapsed. */
  pendingActions(limit?: number): Promise<string[]>;
}
