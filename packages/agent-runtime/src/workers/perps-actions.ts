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
  type PerpsOwnerAction,
  type PerpsOwnerActionClaim,
  type PerpsOwnerActionRepository,
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

/**
 * The Queue wakeup for one owner action (perpl-paper-runtime-v1 R8, R12). It carries only the id
 * of the durable row the API wrote; the row, not the message, says what the owner asked for.
 */
export interface PerpsActionMessage {
  kind: "perps-action";
  actionId: string;
}

export type PerpsActionsBackground = Pick<
  PerpsBackground,
  "store" | "paper" | "agents" | "marks" | "exitFrame" | "close" | "clock"
> & { owner: PerpsOwnerActionRepository };

/** An owner action may run at most one minute once it holds the agent. */
export const PERPS_ACTION_DEADLINE_MS = 60_000;
/** How long a delivery waits for a running check to free the agent before leaving it pending. */
export const PERPS_ACTION_WAIT_MS = 45_000;
/** How often a waiting delivery asks for the agent again. */
export const PERPS_ACTION_POLL_MS = 5_000;

export interface PerpsActionOptions {
  heartbeatMs?: number;
  waitMs?: number;
  pollMs?: number;
  /** Injected by tests; the host waits with a timer. */
  sleep?: (ms: number) => Promise<void>;
}

const DAY_LOSS_TEXT = "Paused itself · day-loss stop";
const STOP_ALL_TEXT = "Paused · you stopped it";

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

type ActionResult = PerpsCheckFinish & {
  steps: string[];
  /** The action's status after this attempt; `pending` retries it later. Default `done`. */
  status?: "done" | "failed" | "pending";
};

interface ActionContext {
  check: PerpsCheck;
  holder: PerpsLeaseHolder;
  signal: AbortSignal;
  killed: boolean;
}

/**
 * Carries out a claimed action as an `owner` check: waits up to `waitMs` for the agent (a running
 * check holds it), polling every `pollMs`; still busy, the action goes back to `pending` with
 * `CHECK_RUNNING` and the minute Cron re-drives it. Holding the agent, it keeps the lease with a
 * heartbeat and ends check and action together with the outcome. A thrown failure ends the check
 * `failed` with its code, and the action `failed` (or `pending` again when `retryOnFailure`).
 * Answers the check id, or null when it never held the agent.
 */
async function ownerCheck(
  runtime: PerpsActionsBackground,
  action: PerpsOwnerAction,
  claim: PerpsOwnerActionClaim,
  options: Required<PerpsActionOptions>,
  retryOnFailure: boolean,
  act: (context: ActionContext) => Promise<ActionResult>,
): Promise<string | null> {
  const waitUntil = Date.now() + options.waitMs;
  let started: Awaited<ReturnType<PerpsOwnerActionRepository["startActionCheck"]>>;
  for (;;) {
    try {
      started = await runtime.owner.startActionCheck(claim);
      break;
    } catch (error) {
      const busy = error instanceof PilotError && error.code === "CHECK_RUNNING";
      if (!busy) {
        throw error;
      }
      if (Date.now() + options.pollMs > waitUntil) {
        await runtime.owner.releaseAction(claim, "CHECK_RUNNING");
        return null;
      }
      await options.sleep(options.pollMs);
    }
  }
  if (!started) {
    return null;
  }
  const { check, killed } = started;
  const holder: PerpsLeaseHolder = { lease: started.lease };
  await executeWithLease(
    {
      renew: async (held: PerpsLeaseHolder) => {
        held.lease = await runtime.store.renewAgent(held.lease);
      },
    },
    holder,
    async (held, signal) => {
      try {
        const { steps, status, ...result } = await act({ check, holder: held, signal, killed });
        for (const text of steps) {
          await runtime.store.appendStep(held.lease, {
            text: text.length > 200 ? `${text.slice(0, 199)}…` : text,
          });
        }
        await runtime.owner.finishAction(held.lease, action.id, result, status ?? "done");
      } catch (error) {
        console.error("A Perpl owner action failed; it ends with its code");
        const code = safeCode(error, "ACTION_FAILED");
        await runtime.owner
          .finishAction(
            held.lease,
            action.id,
            { outcome: "failed", outcomeText: "Failed", error: code },
            retryOnFailure && code !== "CHECK_INTERRUPTED" ? "pending" : "failed",
          )
          .catch(() => {});
      }
    },
    AbortSignal.timeout(PERPS_ACTION_DEADLINE_MS),
    options.heartbeatMs,
  );
  return check.id;
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
 * `blocked` with the cap, or `skipped` when it had expired or was already decided. The action, not
 * a message, is the owner's approval: a redelivery finds it claimed or done and does nothing, so a
 * refusal is never approved again without a new click. A killed agent is refused (`AGENT_KILLED`).
 */
async function approveProposal(
  runtime: PerpsActionsBackground,
  action: PerpsOwnerAction,
  claim: PerpsOwnerActionClaim,
  admission: PerpsAdmission,
  options: Required<PerpsActionOptions>,
) {
  const now = runtime.clock ?? Date.now;
  return ownerCheck(
    runtime,
    action,
    claim,
    options,
    false,
    async ({ check, holder, signal, killed }) => {
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
      const first = await runtime.store.getProposal(action.proposalId ?? "");
      if (!first || first.productAgentId !== action.productAgentId) {
        return finish("skipped", "NO SUCH PROPOSAL", ["The proposal was not found"], "NOT_FOUND");
      }
      const label = `${first.kind === "size_up" ? "SIZE-UP" : "ENTRY"} ${name(first.side, first.instrument)}`;

      if (killed) {
        return finish("blocked", `KILLED · ${label}`, ["The agent was killed"], "AGENT_KILLED");
      }
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
 * R12: closes one paper position (`close`) or every open one (`stop_all`) at fresh frames, as an
 * `owner` row with each close's P&L. A stop-all pauses the agent first if the API's pause has not
 * landed (`pauseAgent` is idempotent). An owner close that crosses the day-loss stop pauses the
 * agent (R11). A position already closed changes nothing; a close that could not reach Perpl puts
 * the action back to `pending`, so the minute Cron tries the rest again.
 */
async function closePositions(
  runtime: PerpsActionsBackground,
  action: PerpsOwnerAction,
  claim: PerpsOwnerActionClaim,
  options: Required<PerpsActionOptions>,
) {
  const stopAll = action.kind === "stop_all";
  return ownerCheck(runtime, action, claim, options, true, async ({ check, holder, signal }) => {
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
      status: ActionResult["status"] = "done",
    ): ActionResult => ({
      outcome,
      outcomeText,
      steps,
      error,
      configVersion: agent.version,
      status,
    });
    const steps: string[] = [];
    if (stopAll && !agent.paused) {
      if (await runtime.store.pauseAgent(check.productAgentId, STOP_ALL_TEXT)) {
        steps.push(STOP_ALL_TEXT);
      }
    }
    if (!network) {
      return finish(
        "failed",
        "NOT CONFIGURED",
        [...steps, "It has no Perpl config"],
        "PLUGIN_NOT_CONFIGURED",
        "failed",
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
      return finish("system", "STOPPED · NOTHING OPEN", [...steps, "It has no paper account yet"]);
    }
    const targets = openPositions(view).filter((p) => stopAll || p.id === action.positionId);
    if (!targets.length) {
      return stopAll
        ? finish("system", "STOPPED · NOTHING OPEN", [...steps, "Nothing was open"])
        : finish(
            "skipped",
            "ALREADY CLOSED",
            ["The position was already closed"],
            "POSITION_CLOSED",
          );
    }

    const reason: PerpsPaperCloseReason = stopAll ? "stop_all" : "owner";
    const frames = new Map<PerpSymbol, PerpsPaperFrame>();
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
          // Its exit (or another closer) got there first.
          steps.push(`${name(position.side, position.symbol)} was already closed`);
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
        steps.push(`Could not close ${name(position.side, position.symbol)} · trying again`);
      }
    }

    if (closed && !stopAll && !agent.paused) {
      const after = await runtime.paper.view(scope);
      const realized = realizedSince(after.movements, utcDayStart((runtime.clock ?? Date.now)()));
      if (dayLossReached(realized, effectiveRisk(agent.config))) {
        if (await runtime.store.pauseAgent(check.productAgentId, DAY_LOSS_TEXT)) {
          steps.push(DAY_LOSS_TEXT);
        }
      }
    }

    // A close that failed is tried again by a later attempt (the minute Cron re-drives it).
    const retry = failed ? "pending" : "done";
    const error = failed ? "CLOSE_FAILED" : null;
    if (!closed) {
      return failed
        ? finish("failed", "CLOSE FAILED", steps, "CLOSE_FAILED", retry)
        : finish("skipped", "ALREADY CLOSED", steps, "POSITION_CLOSED");
    }
    if (stopAll) {
      return finish("exited", `STOPPED · CLOSED ${closed}`, steps, error, retry);
    }
    const only = targets[0]!;
    return finish("exited", `CLOSED BY YOU · ${name(only.side, only.symbol)}`, steps, error, retry);
  });
}

/**
 * One wakeup of an owner action (`{ kind: "perps-action", actionId }`, from the API or the minute
 * Cron's re-drive): claims the durable row (a duplicate delivery claims nothing), waits for the
 * agent within `waitMs` and carries it out, or leaves it `pending` while a check holds the agent.
 * Never throws for a busy agent. Always closes the invocation's pool. Answers the owner check's id,
 * or null when this delivery did not carry it out.
 */
export async function consumePerpsAction(
  runtime: PerpsActionsBackground,
  actionId: string,
  admission: PerpsAdmission,
  options: PerpsActionOptions = {},
): Promise<string | null> {
  const resolved: Required<PerpsActionOptions> = {
    heartbeatMs: options.heartbeatMs ?? 15_000,
    waitMs: options.waitMs ?? PERPS_ACTION_WAIT_MS,
    pollMs: options.pollMs ?? PERPS_ACTION_POLL_MS,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  try {
    const claimed = await runtime.owner.claimAction(actionId);
    if (!claimed) {
      return null;
    }
    const { action, claim } = claimed;
    if (action.kind === "approve") {
      return await approveProposal(runtime, action, claim, admission, resolved);
    }
    return await closePositions(runtime, action, claim, resolved);
  } finally {
    await runtime.close();
  }
}
