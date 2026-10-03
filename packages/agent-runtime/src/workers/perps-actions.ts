import { PilotError, effectiveRisk, type AgentConfig, type PerpSymbol } from "@pickler/core";
import {
  PRODUCT_PAPER_SESSION,
  createPerpsPaperService,
  dayLossReached,
  exitLevels,
  feeReserveFor,
  leverageFor,
  microAusd,
  notionalFor,
  parseCheckDecision,
  productFreeEquity,
  realizedSince,
  utcDayStart,
  type PerpsCheck,
  type PerpsCheckFinish,
  type PerpsCheckOutcome,
  type PerpsPaperCloseReason,
  type PerpsPaperFrame,
  type PerpsPaperPosition,
  type PerpsPaperScope,
  type PerpsPaperView,
  type PerpsProposal,
} from "@pickler/trading/perps";
import type { PerpsLeaseHolder } from "../composition/perps-check.js";
import { executeWithLease } from "./lease.js";
import type { PerpsAdmission, PerpsBackground } from "./perps.js";

/** The owner approved a pending proposal (perpl-paper-runtime-v1 R8); skips are synchronous. */
export interface PerpsProposalMessage {
  kind: "perps-proposal";
  proposalId: string;
  decision: "approve";
}

/** The owner closes one paper position, or every one ("Stop · close all", R12). */
export interface PerpsCloseMessage {
  kind: "perps-close";
  /** null closes every open position of the agent. */
  positionId: string | null;
  productAgentId: string;
  reason: "owner" | "stop_all";
}

export type PerpsActionMessage = PerpsProposalMessage | PerpsCloseMessage;

/** What an owner action needs beside the runtime: a check row holding the agent's lease. */
export interface PerpsOwnerRepository {
  /** Queues an `owner` check; `CHECK_RUNNING` while another check is queued or running. */
  startOwnerCheck(input: {
    productAgentId: string;
    requestKey?: string | null;
  }): Promise<PerpsCheck>;
}

export type PerpsActionsBackground = Pick<
  PerpsBackground,
  "store" | "paper" | "agents" | "marks" | "exitFrame" | "close" | "clock"
> & { owner: PerpsOwnerRepository };

/** An owner action may run at most one minute. */
export const PERPS_ACTION_DEADLINE_MS = 60_000;

const DAY_LOSS_TEXT = "Paused itself · day-loss stop";

function safeCode(error: unknown, fallback: string) {
  return error instanceof PilotError && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : fallback;
}

function ausd(value: number) {
  return `${value.toFixed(2)} AUSD`;
}

function signedAusd(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)} AUSD`;
}

function decimal(value: number) {
  return value.toFixed(6);
}

function name(side: string, instrument: string) {
  return `${side.toUpperCase()} ${instrument}`;
}

function openPositions(view: PerpsPaperView) {
  return view.account.positions.filter((p) => p.closedAt === null);
}

function closePnl(view: PerpsPaperView, positionId: string) {
  return view.movements
    .filter((m) => m.key.startsWith(`close:${positionId}:`))
    .reduce((sum, m) => sum + Number(m.delta), 0);
}

/** What an approve would break, in R6's order for the parts that still apply; null when clear. */
export function proposalRefusal(input: {
  kind: PerpsProposal["kind"];
  instrument: PerpSymbol;
  margin: number;
  leverage: number;
  paused: boolean;
  config: Pick<AgentConfig, "maxLeverage" | "risk"> & {
    spend: { perCallAusd: number; perDayAusd: number };
  };
  open: PerpsPaperPosition[];
  /** The position a size-up adds to; null once it closed. */
  position: PerpsPaperPosition | null;
  newMarginToday: number;
  realizedToday: number;
  /** Free paper AUSD at marks; null without a mark for an open position. */
  freeEquity: number | null;
  takerFee: number;
}): { code: string; text: string } | null {
  const { instrument } = input;
  if (input.kind === "size_up" && !input.position) {
    return { code: "POSITION_CLOSED", text: `POSITION CLOSED · ${instrument}` };
  }
  if (input.paused) {
    return { code: "PAUSED", text: "PAUSED" };
  }
  if (input.kind === "enter") {
    const held = input.open.find((p) => p.symbol === instrument);
    if (held) {
      return { code: "ALREADY_OPEN", text: `ALREADY ${name(held.side, instrument)}` };
    }
  }
  if (input.leverage > leverageFor(input.config.maxLeverage)) {
    return { code: "CAP_LEVERAGE", text: "BLOCKED BY CAP · LEVERAGE" };
  }
  const already = input.position ? Number(input.position.margin ?? 0) : 0;
  if (microAusd(already + input.margin) > input.config.spend.perCallAusd) {
    return { code: "CAP_TRADE", text: "BLOCKED BY CAP · PER TRADE" };
  }
  const risk = effectiveRisk(input.config);
  if (input.kind === "enter" && input.open.length >= risk.maxOpenPositions) {
    return { code: "CAP_OPEN", text: `BLOCKED BY CAP · ${input.open.length} OPEN` };
  }
  if (microAusd(input.newMarginToday + input.margin) > input.config.spend.perDayAusd) {
    return { code: "CAP_DAY", text: "BLOCKED BY CAP · PER DAY" };
  }
  if (dayLossReached(input.realizedToday, risk)) {
    return { code: "DAY_LOSS", text: "DAY-LOSS STOP" };
  }
  if (input.freeEquity === null) {
    return { code: "NO_MARK", text: `NO MARK · ${instrument}` };
  }
  const reserve = feeReserveFor(notionalFor(input.margin, input.leverage), input.takerFee);
  if (input.freeEquity < microAusd(input.margin + reserve)) {
    return { code: "NO_FREE_AUSD", text: "NO FREE AUSD" };
  }
  return null;
}

type ActionResult = PerpsCheckFinish & { steps: string[] };

/**
 * Runs `act` as an `owner` check: queues the row (`CHECK_RUNNING` propagates, so the Queue retries
 * once the running check is done), claims the agent's lease, keeps it with a heartbeat and ends
 * the row with the action's outcome. A failure ends it `failed` with its code. Answers the check id,
 * or null when another delivery already holds or finished it.
 */
async function ownerCheck(
  runtime: PerpsActionsBackground,
  productAgentId: string,
  requestKey: string | null,
  heartbeatMs: number,
  act: (check: PerpsCheck, holder: PerpsLeaseHolder, signal: AbortSignal) => Promise<ActionResult>,
): Promise<string | null> {
  const queued = await runtime.owner.startOwnerCheck({ productAgentId, requestKey });
  const claimed = await runtime.store.claimAgent(queued.id);
  if (!claimed) {
    return null;
  }
  const holder: PerpsLeaseHolder = { lease: claimed.lease };
  await executeWithLease(
    {
      renew: async (held: PerpsLeaseHolder) => {
        held.lease = await runtime.store.renewAgent(held.lease);
      },
    },
    holder,
    async (held, signal) => {
      try {
        const { steps, ...result } = await act(claimed.check, held, signal);
        for (const text of steps) {
          await runtime.store.appendStep(held.lease, {
            text: text.length > 200 ? `${text.slice(0, 199)}…` : text,
          });
        }
        await runtime.store.finishCheck(held.lease, result);
      } catch (error) {
        console.error("A Perpl owner action failed; it ends failed with its code");
        await runtime.store
          .releaseAgent(held.lease, safeCode(error, "ACTION_FAILED"))
          .catch(() => {});
      }
    },
    AbortSignal.timeout(PERPS_ACTION_DEADLINE_MS),
    heartbeatMs,
  );
  return claimed.check.id;
}

/** Renews the lease right before a paper action; a lapsed lease never acts (`CHECK_INTERRUPTED`). */
async function fence(
  runtime: PerpsActionsBackground,
  holder: PerpsLeaseHolder,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  try {
    holder.lease = await runtime.store.renewAgent(holder.lease);
  } catch {
    throw new PilotError("CHECK_INTERRUPTED", "The action lost its lease");
  }
}

/**
 * R8: carries out the owner's approval of a proposal at a fresh frame, re-checked against the
 * caps as they are now. The approval (`decideProposal`) moves the proposal to `approving`; it is
 * settled `approved` once the open or size-up filled, or put back to `pending` (until it expires)
 * when the caps or the paper account refuse. The `owner` row says what happened: `entered`,
 * `blocked` with the cap, or `skipped` when it had expired. A proposal that is no longer pending
 * does nothing.
 */
async function approveProposal(
  runtime: PerpsActionsBackground,
  message: PerpsProposalMessage,
  admission: PerpsAdmission,
  heartbeatMs: number,
) {
  const now = runtime.clock ?? Date.now;
  const first = await runtime.store.getProposal(message.proposalId);
  if (!first || first.status !== "pending") {
    return null;
  }
  // No request key: a refused approval puts the proposal back to `pending`, and the owner may
  // approve it again. A duplicate delivery finds it `approving` or `approved` and does nothing.
  return ownerCheck(
    runtime,
    first.productAgentId,
    null,
    heartbeatMs,
    async (check, holder, signal) => {
      const label = `${first.kind === "size_up" ? "SIZE-UP" : "ENTRY"} ${name(first.side, first.instrument)}`;
      const agent = await runtime.agents.agent({
        tenantId: check.tenantId,
        agentId: check.agentId,
      });
      const finish = (
        outcome: PerpsCheckOutcome,
        outcomeText: string,
        steps: string[],
        error: string | null = null,
      ): ActionResult => ({ outcome, outcomeText, steps, error, configVersion: agent.version });

      if (!admission.enabled) {
        return finish("blocked", "RUNTIME OFF", ["The Perpl runtime is off"], "RUNTIME_DISABLED");
      }
      let proposal: PerpsProposal;
      try {
        proposal = await runtime.store.decideProposal(first.id, "approved");
      } catch (error) {
        const code = safeCode(error, "PROPOSAL_DECIDED");
        if (code === "PROPOSAL_EXPIRED") {
          return finish(
            "skipped",
            `EXPIRED · ${label}`,
            ["You approved it after 15 minutes"],
            code,
          );
        }
        if (code === "PROPOSAL_DECIDED") {
          return finish("skipped", `ALREADY DECIDED · ${label}`, ["It was already decided"], code);
        }
        throw error;
      }

      const settleRefused = async (code: string, text: string, steps: string[]) => {
        await runtime.store.settleProposal(proposal.id, false);
        return finish("blocked", text, steps, code);
      };
      try {
        const config = agent.config;
        if (!config.perpl || !config.spend) {
          return await settleRefused("PLUGIN_NOT_CONFIGURED", "NOT CONFIGURED", [
            "It has no Perpl config and caps",
          ]);
        }
        const network = config.perpl.network;
        const scope: PerpsPaperScope = {
          tenantId: check.tenantId,
          agentId: check.agentId,
          sessionId: PRODUCT_PAPER_SESSION,
          network,
        };
        const frame = await runtime.exitFrame(network, proposal.instrument, signal);
        const view = await runtime.paper.view(scope);
        const open = openPositions(view);
        const board = await runtime.marks(network, signal).catch(() => []);
        const marks: Partial<Record<PerpSymbol, string>> = {};
        for (const mark of board) {
          if (mark.network === network) {
            marks[mark.symbol] = mark.mark;
          }
        }
        marks[proposal.instrument] = frame.snapshot.ticker.mark;
        const free = productFreeEquity(view.account, view.attempts, marks);
        const dayStart = utcDayStart(now());
        const margin = Number(proposal.margin);
        const position =
          proposal.kind === "size_up"
            ? (open.find((p) => p.id === proposal.positionId) ?? null)
            : null;
        const refusal = proposalRefusal({
          kind: proposal.kind,
          instrument: proposal.instrument,
          margin,
          leverage: proposal.leverage,
          paused: agent.paused,
          config: { ...config, spend: config.spend },
          open,
          position,
          newMarginToday: Number(await runtime.paper.newMarginSince(scope, dayStart)),
          realizedToday: realizedSince(view.movements, dayStart),
          freeEquity: free === null ? null : Number(free),
          takerFee: Number(frame.book.market.fees.taker),
        });
        if (refusal) {
          return await settleRefused(refusal.code, refusal.text, [
            `You approved ${label} · ${ausd(margin)}`,
          ]);
        }

        if (proposal.kind === "size_up") {
          await fence(runtime, holder, signal);
          const added = await runtime.paper.sizeUp(
            scope,
            position!.id,
            { key: `check:${check.id}:size-up`, margin: decimal(margin) },
            frame,
          );
          await runtime.store.settleProposal(proposal.id, true);
          return finish("entered", `SIZED UP ${name(proposal.side, proposal.instrument)}`, [
            `You approved ${label} · ${ausd(margin)}`,
            `Added ${ausd(margin)} to ${name(proposal.side, proposal.instrument)} · margin ${ausd(Number(added.position.margin ?? 0))}`,
          ]);
        }

        // Exits from the check that proposed it (R10's defaults when it named none).
        const origin = await runtime.store.getCheck(proposal.checkId);
        const parsed = parseCheckDecision(origin?.decision ?? undefined);
        const called = parsed.ok ? parsed.decision : null;
        const key = `check:${check.id}:open`;
        await fence(runtime, holder, signal);
        const service = createPerpsPaperService(
          runtime.paper,
          {
            observation: async () => {
              throw new PilotError("INVALID_INPUT", "Owner actions observe nothing");
            },
            frame: async () => frame,
          },
          now,
        );
        const after = await service.trade(
          scope,
          key,
          "open",
          proposal.instrument,
          proposal.side,
          signal,
          frame,
          {
            notional: decimal(notionalFor(margin, proposal.leverage)),
            leverage: proposal.leverage,
            checkId: check.id,
            exits: (fill) =>
              exitLevels({
                side: proposal.side,
                entryPrice: fill.price,
                stopLossBps: called?.stopLossBps,
                takeProfitBps: called?.takeProfitBps,
                horizonHours: called?.horizonHours ?? 24,
                openedAt: now(),
                // The stop's loss stays within 90% of margin at this leverage (inside liquidation).
                leverage: proposal.leverage,
              }),
          },
        );
        const opened = after.account.positions.find((p) => p.id === key);
        if (!opened) {
          const reason = after.attempts.find((a) => a.key === key)?.reason ?? "REJECTED";
          return await settleRefused("PAPER_REJECTED", `BLOCKED · ${reason.split(",")[0]}`, [
            `You approved ${label} · ${ausd(margin)}`,
            `The paper account refused · ${reason}`,
          ]);
        }
        await runtime.store.settleProposal(proposal.id, true);
        return finish("entered", `ENTERED ${name(proposal.side, proposal.instrument)}`, [
          `You approved ${label} · ${ausd(margin)}`,
          `Opened ${name(proposal.side, proposal.instrument)} at ${opened.entryPrice} · ${ausd(Number(opened.margin))} × ${opened.leverage}`,
        ]);
      } catch (error) {
        // Nothing opened: the proposal waits again (until it expires) and the row ends failed.
        await runtime.store.settleProposal(proposal.id, false).catch(() => {});
        throw error;
      }
    },
  );
}

/**
 * R12: closes one paper position (`owner`) or every open one (`stop_all`; the API paused the agent
 * first) at fresh frames, as an `owner` row with each close's P&L. An owner close that crosses the
 * day-loss stop pauses the agent (R11). A position already closed changes nothing.
 */
async function closePositions(
  runtime: PerpsActionsBackground,
  message: PerpsCloseMessage,
  heartbeatMs: number,
) {
  return ownerCheck(
    runtime,
    message.productAgentId,
    null,
    heartbeatMs,
    async (check, holder, signal) => {
      const agent = await runtime.agents.agent({
        tenantId: check.tenantId,
        agentId: check.agentId,
      });
      const network = agent.config.perpl?.network;
      const finish = (
        outcome: PerpsCheckOutcome,
        outcomeText: string,
        steps: string[],
        error: string | null = null,
      ): ActionResult => ({ outcome, outcomeText, steps, error, configVersion: agent.version });
      if (!network) {
        return finish(
          "failed",
          "NOT CONFIGURED",
          ["It has no Perpl config"],
          "PLUGIN_NOT_CONFIGURED",
        );
      }
      const scope: PerpsPaperScope = {
        tenantId: check.tenantId,
        agentId: check.agentId,
        sessionId: PRODUCT_PAPER_SESSION,
        network,
      };
      let view: PerpsPaperView;
      try {
        view = await runtime.paper.view(scope);
      } catch (error) {
        if (!(error instanceof PilotError) || error.code !== "NOT_FOUND") {
          throw error;
        }
        return finish("system", "STOPPED · NOTHING OPEN", ["It has no paper account yet"]);
      }
      const targets = openPositions(view).filter(
        (p) => message.positionId === null || p.id === message.positionId,
      );
      if (!targets.length) {
        return message.positionId === null
          ? finish("system", "STOPPED · NOTHING OPEN", ["Nothing was open"])
          : finish(
              "skipped",
              "ALREADY CLOSED",
              ["The position was already closed"],
              "POSITION_CLOSED",
            );
      }

      const reason: PerpsPaperCloseReason = message.reason;
      const frames = new Map<PerpSymbol, PerpsPaperFrame>();
      const steps: string[] = [];
      let closed = 0;
      let failed = 0;
      for (const position of targets) {
        try {
          let frame = frames.get(position.symbol);
          if (!frame) {
            frame = await runtime.exitFrame(network, position.symbol, signal);
            frames.set(position.symbol, frame);
          }
          await fence(runtime, holder, signal);
          const result = await runtime.paper.closePosition(scope, position.id, reason, frame);
          if (!result.closed) {
            continue;
          }
          closed++;
          steps.push(
            `Closed ${name(position.side, position.symbol)} at ${result.position.exitPrice} · ${signedAusd(closePnl(result.view, position.id))}`,
          );
        } catch (error) {
          if (error instanceof PilotError && error.code === "CHECK_INTERRUPTED") {
            throw error;
          }
          failed++;
          steps.push(`Could not close ${name(position.side, position.symbol)} · try again`);
        }
      }

      if (closed && message.reason === "owner" && !agent.paused) {
        const after = await runtime.paper.view(scope);
        const realized = realizedSince(after.movements, utcDayStart((runtime.clock ?? Date.now)()));
        if (dayLossReached(realized, effectiveRisk(agent.config))) {
          await runtime.store.pauseAgent(check.productAgentId, DAY_LOSS_TEXT);
          steps.push(DAY_LOSS_TEXT);
        }
      }

      const error = failed ? "CLOSE_FAILED" : null;
      if (!closed) {
        return finish(
          failed ? "failed" : "skipped",
          failed ? "CLOSE FAILED" : "ALREADY CLOSED",
          steps,
          error ?? "POSITION_CLOSED",
        );
      }
      if (message.reason === "stop_all") {
        return finish("exited", `STOPPED · CLOSED ${closed}`, steps, error);
      }
      const only = targets[0]!;
      return finish("exited", `CLOSED BY YOU · ${name(only.side, only.symbol)}`, steps, error);
    },
  );
}

/**
 * One Queue delivery of an owner action. `CHECK_RUNNING` (a check holds the agent) is thrown so the
 * host retries it shortly; anything else ends in the `owner` row. Always closes the invocation's
 * pool. Answers the owner check's id, or null when there was nothing to do.
 */
export async function consumePerpsAction(
  runtime: PerpsActionsBackground,
  message: PerpsActionMessage,
  admission: PerpsAdmission,
  heartbeatMs = 15_000,
): Promise<string | null> {
  try {
    if (message.kind === "perps-proposal") {
      if (message.decision !== "approve") {
        return null;
      }
      return await approveProposal(runtime, message, admission, heartbeatMs);
    }
    if (message.reason !== "owner" && message.reason !== "stop_all") {
      return null;
    }
    return await closePositions(runtime, message, heartbeatMs);
  } finally {
    await runtime.close();
  }
}
