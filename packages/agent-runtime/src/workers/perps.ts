import {
  PilotError,
  effectiveRisk,
  type AgentRecord,
  type PerpNetwork,
  type PerpFundingHistory,
  type PerpSymbol,
  type Scope,
} from "@pickler/core";
import {
  dayLossReached,
  hourlyRequestKey,
  realizedSince,
  utcDayStart,
  type PerpsCheck,
  type PerpsDuePosition,
  type PerpsOwnerActionRepository,
  type PerpsPaperFrame,
  type PerpsPaperScope,
  type PerpsProductPaperRepository,
  type PerpsRuntimeRepository,
} from "@pickler/trading/perps";
import type { PerpsLeaseHolder, PerpsMarks } from "../composition/perps-check.js";
import { executeWithLease } from "./lease.js";
import type { PerpsActionMessage } from "./perps-actions.js";

/** The Queue message a manual or hourly check sends (perpl-paper-runtime-v1 §4). */
export interface PerpsCheckMessage {
  kind: "perps-check";
  checkId: string;
}

/** What the research worker composes per invocation; `close` ends its pool. */
export interface PerpsBackground {
  store: PerpsRuntimeRepository;
  paper: PerpsProductPaperRepository;
  bindPaper?(
    scope: PerpsPaperScope,
    version: number,
    holder: PerpsLeaseHolder,
    signal: AbortSignal,
  ): PerpsProductPaperRepository;
  agents: { agent(scope: Scope): Promise<AgentRecord> };
  marks: PerpsMarks;
  /** A fresh book and snapshot for the exits job, outside any agent's read session. */
  exitFrame(
    network: PerpNetwork,
    symbol: PerpSymbol,
    signal: AbortSignal,
    market?: import("@pickler/core").PerpMarketInfo,
  ): Promise<PerpsPaperFrame>;
  funding?(
    network: PerpNetwork,
    symbol: PerpSymbol,
    from: number,
    to: number,
    signal: AbortSignal,
    market?: import("@pickler/core").PerpMarketInfo,
  ): Promise<PerpFundingHistory>;
  check(check: PerpsCheck, holder: PerpsLeaseHolder, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
  clock?: () => number;
}

/** `PERPL_RUNTIME_ENABLED` and `PERPL_RUNTIME_DAILY_CHECKS` (R3). */
export interface PerpsAdmission {
  enabled: boolean;
  dailyChecks: number;
}

/** Reads the two host variables; anything but "true" is off, a bad ceiling is the default 500. */
export function perpsAdmission(env: {
  PERPL_RUNTIME_ENABLED?: string | undefined;
  PERPL_RUNTIME_DAILY_CHECKS?: string | undefined;
}): PerpsAdmission {
  const ceiling = Number(env.PERPL_RUNTIME_DAILY_CHECKS ?? "500");
  return {
    enabled: env.PERPL_RUNTIME_ENABLED === "true",
    dailyChecks: Number.isSafeInteger(ceiling) && ceiling >= 0 ? ceiling : 500,
  };
}

/** A check may run at most three minutes. */
export const PERPS_CHECK_DEADLINE_MS = 180_000;

function safeCode(error: unknown, fallback: string) {
  return error instanceof PilotError && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : fallback;
}

/**
 * One Queue delivery of `{ kind: "perps-check", checkId }`. Claims the check's agent lease (a
 * duplicate delivery finds nothing to claim), refuses it while the runtime is off
 * (`RUNTIME_DISABLED`) or past the global daily ceiling (`RUNTIME_CEILING`), then runs it with a
 * 15 s heartbeat on the 60 s lease. A failure ends the check `failed` with its code. Always closes
 * the invocation's pool. Answers whether a check was claimed.
 */
export async function consumePerpsCheck(
  runtime: PerpsBackground,
  checkId: string,
  admission: PerpsAdmission,
  heartbeatMs = 15_000,
): Promise<boolean> {
  try {
    const claimed = await runtime.store.claimAgent(checkId);
    if (!claimed) {
      return false;
    }
    if (!admission.enabled) {
      await runtime.store.releaseAgent(claimed.lease, "RUNTIME_DISABLED");
      return true;
    }
    if ((await runtime.store.globalChecksToday()) > admission.dailyChecks) {
      await runtime.store.releaseAgent(claimed.lease, "RUNTIME_CEILING");
      return true;
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
          await runtime.check(claimed.check, held, signal);
        } catch (error) {
          console.error("Perpl check failed; it ends failed with its code");
          await runtime.store
            .releaseAgent(held.lease, safeCode(error, "CHECK_FAILED"))
            .catch(() => {});
        }
      },
      AbortSignal.timeout(PERPS_CHECK_DEADLINE_MS),
      heartbeatMs,
    );
    return true;
  } finally {
    await runtime.close();
  }
}

/**
 * The hourly dispatcher (R2): while the runtime is on and under the ceiling, queues one `hourly`
 * check for each due agent (`dueAgents`: published, Perpl, unpaused, slot open, no live check) and
 * sends its Queue message. Each check is keyed `hourly:<slot>`, so overlapping Cron runs start
 * exactly one check per agent and slot (a replay that already ran is not sent again). An agent
 * that cannot start (e.g. `CHECK_RUNNING`) is skipped. Answers the ids queued.
 */
export async function dispatchDueChecks(
  runtime: Pick<PerpsBackground, "store">,
  admission: PerpsAdmission,
  send: (message: PerpsCheckMessage) => Promise<void>,
): Promise<string[]> {
  if (!admission.enabled) {
    return [];
  }
  const remaining = admission.dailyChecks - (await runtime.store.globalChecksToday());
  if (remaining <= 0) {
    return [];
  }
  const due = await runtime.store.dueAgents(Math.min(50, remaining));
  const queued: string[] = [];
  for (const agent of due) {
    let check: PerpsCheck;
    try {
      check = await runtime.store.startCheck({
        productAgentId: agent.productAgentId,
        trigger: "hourly",
        requestKey: hourlyRequestKey(agent.slot),
      });
    } catch (error) {
      if (!(error instanceof PilotError)) {
        throw error;
      }
      continue;
    }
    if (check.status !== "queued") {
      continue;
    }
    try {
      await send({ kind: "perps-check", checkId: check.id });
      queued.push(check.id);
    } catch {
      console.error("Perpl check notification failed; the queued check expires");
    }
  }
  return queued;
}

/** Public-only valuation/funding continues while paid decisions are disabled or blocked. */
export async function reconcilePerpsPositions(runtime: PerpsBackground, signal: AbortSignal) {
  if (!runtime.paper.openProductAccounts || !runtime.funding || !runtime.bindPaper) {
    return;
  }
  for (const item of await runtime.paper.openProductAccounts()) {
    let holder: PerpsLeaseHolder | null = null;
    try {
      signal.throwIfAborted();
      const claim = await runtime.store.claimSupervision?.(item.productAgentId);
      if (!claim) {
        continue;
      }
      holder = { lease: claim.lease };
      const agent = await runtime.agents.agent(item.scope);
      const paper = runtime.bindPaper(item.scope, agent.version, holder, signal);
      const view = await paper.view(item.scope);
      const frames: PerpsPaperFrame[] = [];
      const funding: PerpFundingHistory[] = [];
      for (const symbol of new Set(view.account.positions.map((p) => p.symbol))) {
        signal.throwIfAborted();
        holder.lease = await runtime.store.renewAgent(holder.lease);
        const from = Math.min(
          ...view.account.positions.filter((p) => p.symbol === symbol).map((p) => p.openedAt),
        );
        funding.push(
          await runtime.funding(
            item.scope.network,
            symbol,
            from,
            (runtime.clock ?? Date.now)(),
            signal,
            view.account.positions.find((position) => position.symbol === symbol)?.market,
          ),
        );
        frames.push(
          await runtime.exitFrame(
            item.scope.network,
            symbol,
            signal,
            view.account.positions.find((position) => position.symbol === symbol)?.market,
          ),
        );
      }
      holder.lease = await runtime.store.renewAgent(holder.lease);
      const observed = await paper.observe(item.scope, `supervision:${claim.check.id}`, {
        frames,
        funding,
      });
      await runtime.store.finishCheck(holder.lease, {
        outcome: "system",
        outcomeText: observed.account.fundingPending
          ? "FUNDING PENDING"
          : "VALUATION AND FUNDING UPDATED",
        configVersion: agent.version,
        costMicros: "0",
      });
      holder = null;
    } catch {
      if (holder) {
        await runtime.store.releaseAgent(holder.lease, "RECONCILIATION_FAILED").catch(() => {});
      }
      console.error("Perpl funding reconciliation remains pending; public exits continue");
    }
  }
}

const EXIT_LABEL = { stop: "STOP", take_profit: "TARGET", time: "TIME" } as const;

/** R11 after a close: realized P&L today at or below −dayLossStop pauses the agent once. */
async function dayLossPause(
  runtime: PerpsBackground,
  productAgentId: string,
  due: PerpsDuePosition,
) {
  const agent = await runtime.agents.agent({
    tenantId: due.scope.tenantId,
    agentId: due.scope.agentId,
  });
  if (agent.paused) {
    return false;
  }
  const view = await runtime.paper.view(due.scope);
  const realized = realizedSince(view.movements, utcDayStart((runtime.clock ?? Date.now)()));
  if (!dayLossReached(realized, effectiveRisk(agent.config))) {
    return false;
  }
  // Idempotent: two overlapping exits runs closing two positions pause it once.
  return (await runtime.store.pauseAgent(productAgentId, "Paused itself · day-loss stop")) !== null;
}

/**
 * The exits job (R10), every minute: marks from the market board for the networks holding product
 * positions, the positions whose stop, target or time stop is due, each closed at a fresh frame
 * with its reason and logged as an `exited` row; then the day-loss stop (R11). A close that already
 * happened changes nothing (closes are idempotent from `open`); one failing position does not stop
 * the rest. Answers how many closed.
 */
export async function runExits(runtime: PerpsBackground, signal: AbortSignal): Promise<number> {
  await reconcilePerpsPositions(runtime, signal);
  const networks = await runtime.paper.openNetworks();
  if (!networks.length) {
    return 0;
  }
  const marks = (
    await Promise.all(networks.map((network) => runtime.marks(network, signal).catch(() => [])))
  ).flat();
  const due = await runtime.paper.openDuePositions(marks);
  const frames = new Map<string, Promise<PerpsPaperFrame>>();
  let closed = 0;
  for (const item of due) {
    const { position, scope } = item;
    let holder: PerpsLeaseHolder | null = null;
    try {
      const claim = await runtime.store.claimSupervision?.(item.productAgentId);
      if (!claim) {
        continue;
      }
      holder = { lease: claim.lease };
      const agent = await runtime.agents.agent(scope);
      if (!runtime.bindPaper) {
        throw new PilotError("INVALID_INPUT", "Financial supervision requires a transaction fence");
      }
      const paper = runtime.bindPaper(scope, agent.version, holder, signal);
      const key = `${scope.network}:${position.symbol}`;
      let frame = frames.get(key);
      if (!frame) {
        frame = runtime.exitFrame(scope.network, position.symbol, signal, position.market);
        frames.set(key, frame);
      }
      holder.lease = await runtime.store.renewAgent(holder.lease);
      const result = await paper.closePosition(scope, position.id, item.reason, await frame);
      if (!result.closed) {
        await runtime.store.finishCheck(holder.lease, {
          outcome: "held",
          outcomeText: "ALREADY CLOSED",
        });
        holder = null;
        continue;
      }
      closed++;
      const pnl = result.view.movements
        .filter((m) => m.key.startsWith(`close:${position.id}:`))
        .reduce((sum, m) => sum + Number(m.delta), 0);
      const name = `${position.side.toUpperCase()} ${position.symbol}`;
      await runtime.store.appendStep(holder.lease, {
        text: `Closed ${name} at ${result.position.exitPrice} · ${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)} AUSD`,
      });
      await runtime.store.finishCheck(holder.lease, {
        outcome: "exited",
        outcomeText: `${EXIT_LABEL[item.reason]} · ${name}`,
        configVersion: position.configVersion ?? null,
      });
      holder = null;
      await dayLossPause(runtime, item.productAgentId, item);
    } catch {
      if (holder) {
        await runtime.store.releaseAgent(holder.lease, "EXIT_FAILED").catch(() => {});
      }
      console.error("A Perpl paper exit failed; the next minute retries it");
    }
  }
  return closed;
}

/**
 * Proposal expiry (R8): every pending proposal past its 15 minutes becomes `expired`, logged as a
 * `skipped` row. Answers how many expired.
 */
export async function expirePerpsProposals(runtime: Pick<PerpsBackground, "store">) {
  const expired = await runtime.store.expireProposals();
  for (const proposal of expired) {
    const kind = proposal.kind === "size_up" ? "SIZE-UP" : "ENTRY";
    await runtime.store.recordCheck({
      productAgentId: proposal.productAgentId,
      trigger: "system",
      outcome: "skipped",
      outcomeText: `EXPIRED · ${kind} ${proposal.side.toUpperCase()} ${proposal.instrument}`,
      steps: [{ text: "Nobody answered within 15 minutes" }],
    });
  }
  return expired.length;
}

/**
 * The research Cron's runtime work, every minute (R3, R10): the stuck-check sweep
 * (`recoverChecks`), the hourly dispatcher (only while `PERPL_RUNTIME_ENABLED` is on: off, no
 * model is asked and nothing opens), the exits job, proposal expiry, and the re-drive of owner
 * actions left pending (`owner.pendingActions`, one wakeup each). Everything but dispatch runs
 * whether or not the runtime is on: exits, closes and recovery never wait for it. None of them
 * calls the model.
 */
export async function superviseChecks(
  runtime: PerpsBackground & { owner?: Pick<PerpsOwnerActionRepository, "pendingActions"> },
  admission: PerpsAdmission,
  send: (message: PerpsCheckMessage | PerpsActionMessage) => Promise<void>,
) {
  try {
    const signal = AbortSignal.timeout(50_000);
    const owner = runtime.owner;
    for (const job of [
      () => runtime.store.recoverChecks(),
      () => dispatchDueChecks(runtime, admission, send),
      () => runExits(runtime, signal),
      () => expirePerpsProposals(runtime),
      async () => {
        for (const actionId of owner ? await owner.pendingActions() : []) {
          await send({ kind: "perps-action", actionId });
        }
      },
    ]) {
      try {
        await job();
      } catch {
        console.error("A Perpl runtime job failed; the next minute runs it again");
      }
    }
  } finally {
    await runtime.close();
  }
}
