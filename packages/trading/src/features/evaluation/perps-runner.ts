import {
  PERPS_STUDY_STRATEGIES as strategies,
  perpsRules,
  type PerpsStudyRepository,
  type PerpsStudyScope,
  type PerpsStudyLease,
  type PerpsEvidence,
  type PerpsStrategy,
  type PerpsProposal,
  type PerpsCallLane,
  type PerpsStudyRecord,
} from "../../evaluation.js";
import { PilotError } from "@pickler/core";
import {
  createPerpsPaperService,
  paperRisk,
  type PerpsPaperRepository,
  type PerpsPaperData,
  type PerpsPaperObservation,
  type PerpsPaperFrame,
  type PerpsPaperView,
} from "../../perps.js";
import type { PerpsModels, PerpsModelHooks } from "./model.js";
export interface StudyData {
  observe(record: PerpsStudyRecord, signal: AbortSignal): Promise<PerpsPaperObservation>;
  evidence(
    record: PerpsStudyRecord,
    observation: PerpsPaperObservation,
    signal: AbortSignal,
  ): Promise<PerpsEvidence>;
  execution(record: PerpsStudyRecord, signal: AbortSignal): Promise<PerpsPaperFrame[]>;
}
const safeCode = (error: unknown) =>
  error instanceof PilotError && /^[A-Z_]{1,80}$/.test(error.code)
    ? error.code
    : "STUDY_OPERATION_FAILED";
export function createPerpsStudyRunner(deps: {
  study: PerpsStudyRepository;
  paper: PerpsPaperRepository;
  data: StudyData;
  models: PerpsModels;
  now?: () => number;
}) {
  const { study, paper, data, models } = deps;
  const now = deps.now ?? Date.now;
  // Every execution receives a common captured frame. No hidden provider fetch is permitted.
  const unavailable: PerpsPaperData = {
    frame: async () => {
      throw new PilotError("MISSING_FRAME", "Common frame required");
    },
    observation: async () => {
      throw new PilotError("MISSING_FRAME", "Common observation required");
    },
  };
  const simulator = createPerpsPaperService(paper, unavailable, now);
  const accountScope = (record: PerpsStudyRecord, strategy: PerpsStrategy) => ({
    ...record.config,
    agentId: record.agentIds[strategy],
  });
  async function execute(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    record: PerpsStudyRecord,
    strategy: PerpsStrategy,
    key: string,
    proposal: PerpsProposal,
    frames: PerpsPaperFrame[],
    signal: AbortSignal,
  ) {
    if (proposal.action === "hold") {
      return;
    }
    await study.guard(scope, lease);
    const current = await study.view(scope);
    if (
      proposal.action.startsWith("open-") &&
      (current.record.decisionStopReason ||
        current.record.stopRequested ||
        now() >= current.record.endsAt!)
    ) {
      throw new PilotError("DECISIONS_STOPPED", "Opening window ended");
    }
    const target = accountScope(record, strategy);
    const view = await paper.view(target);
    const position = view.account.positions.find(
      (p) => p.symbol === proposal.symbol && p.closedAt === null,
    );
    const closing = proposal.action === "close";
    if (closing && !position) {
      return;
    }
    const frame = frames.find((f) => f.snapshot.market.symbol === proposal.symbol);
    if (!frame) {
      throw new PilotError("MISSING_FRAME", "Missing shared execution frame");
    }
    let error: string | null = null;
    try {
      await simulator.trade(
        target,
        key,
        closing ? "close" : "open",
        proposal.symbol,
        closing ? position!.side : proposal.action === "open-long" ? "long" : "short",
        signal,
        frame,
      );
    } catch (failure) {
      if (!(failure instanceof PilotError)) {
        throw failure;
      }
      error = safeCode(failure);
    }
    const after = await paper.view(target);
    const attempt = after.attempts.find((a) => a.key === key);
    await study.event(scope, lease, `${strategy}:${key}`, "execution", {
      strategy,
      proposal,
      status: attempt?.status ?? "not-admitted",
      reason: attempt?.reason ?? error,
    });
  }
  async function cycle(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    signal: AbortSignal,
  ): Promise<boolean> {
    await study.guard(scope, lease);
    let { record } = await study.view(scope);
    if (now() >= record.endsAt! || record.stopRequested) {
      for (const strategy of strategies) {
        await paper.closeAdmissions(accountScope(record, strategy));
      }
    }
    if (now() >= record.graceUntil!) {
      await study.complete(scope, lease);
      return false;
    }
    const minute = Math.floor((now() - record.startedAt!) / 60000);
    const key = `observe-${minute}`;
    const views = {} as Record<PerpsStrategy, PerpsPaperView>;
    let observation: PerpsPaperObservation;
    try {
      observation = await data.observe(record, signal);
      for (const strategy of strategies) {
        await study.guard(scope, lease);
        views[strategy] = await paper.observe(accountScope(record, strategy), key, observation);
      }
    } catch (error) {
      signal.throwIfAborted();
      await study.event(scope, lease, `${key}:failed`, "observation-failed", {
        code: safeCode(error),
      });
      return true;
    }
    const closing = now() >= record.endsAt! || record.stopRequested;
    const closedThisRound = new Set<string>();
    for (const strategy of strategies) {
      const risk = paperRisk(views[strategy].account, views[strategy].attempts, now());
      for (const position of views[strategy].account.positions.filter((p) => p.closedAt === null)) {
        if (closing || risk.closeSymbols.includes(position.symbol)) {
          closedThisRound.add(`${strategy}:${position.symbol}`);
          await execute(
            scope,
            lease,
            record,
            strategy,
            `${key}:risk:${position.symbol}`,
            {
              symbol: position.symbol,
              action: "close",
              reason: closing ? "SESSION_END" : "RISK_EXIT",
              sourceIds: [],
            },
            observation.frames,
            signal,
          );
        }
      }
      views[strategy] = await paper.view(accountScope(record, strategy));
    }
    await study.event(
      scope,
      lease,
      key,
      "observation",
      Object.fromEntries(
        strategies.map((s) => [
          s,
          {
            risk: paperRisk(views[s].account, views[s].attempts, now()),
            positions: views[s].account.positions.filter((p) => p.closedAt === null).length,
            fundingPending: views[s].account.fundingPending,
          },
        ]),
      ),
    );
    if (closing) {
      await study.stopDecisions(scope, lease, "SESSION_END");
      if (strategies.every((s) => views[s].account.positions.every((p) => p.closedAt !== null))) {
        await study.complete(scope, lease);
        return false;
      }
      return true;
    }
    record = (await study.view(scope)).record;
    if (record.decisionStopReason) {
      return true;
    }
    const slot = Math.floor((now() - record.startedAt!) / 900000);
    // Late or missed rounds are never reconstructed. Allow the first minute of the current slot.
    if (slot <= record.lastRoundSlot || (now() - record.startedAt!) % 900000 >= 60000) {
      return true;
    }
    let evidence: PerpsEvidence;
    try {
      evidence = await data.evidence(record, observation, signal);
    } catch (error) {
      signal.throwIfAborted();
      await study.event(scope, lease, `${key}:candles`, "evidence-failed", {
        code: safeCode(error),
      });
      return true;
    }
    const accounts = Object.fromEntries(strategies.map((s) => [s, views[s].account])) as Parameters<
      PerpsStudyRepository["reserve"]
    >[4];
    const rules = perpsRules({ evidence, account: accounts.rules });
    const round = await study.reserve(scope, lease, slot, evidence, accounts, rules);
    if (!round) {
      return true;
    }
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
    const proposals: Partial<Record<PerpsStrategy, PerpsProposal[]>> = { rules };
    async function call<T>(
      lane: PerpsCallLane,
      fn: (hooks: PerpsModelHooks) => Promise<T>,
    ): Promise<T> {
      let started = false;
      try {
        const result = await fn({
          before: async (request) => {
            await study.startCall(scope, lease, round!.key, lane, request);
            started = true;
          },
          usage: (input, output) => study.usage(scope, lease, round!.key, lane, input, output),
        });
        deadline.throwIfAborted();
        await study.finishCall(scope, lease, round!.key, lane, result, null);
        return result;
      } catch (error) {
        if (started) {
          await study.finishCall(scope, lease, round!.key, lane, null, safeCode(error));
        } else {
          await study.stopDecisions(scope, lease, safeCode(error));
        }
        throw error;
      }
    }
    const outcomes = await Promise.allSettled([
      (async () => {
        proposals.deepseek = await call("direct", (hooks) =>
          models.direct({ evidence, account: accounts.deepseek }, deadline, hooks),
        );
      })(),
      (async () => {
        const context = { evidence, account: accounts.jev };
        const result = await call("jev", (hooks) => models.readiness(context, deadline, hooks));
        proposals.jev = result.skip
          ? (["BTC", "ETH"] as const).map((symbol) => ({
              symbol,
              action: "hold",
              reason: "JEV_MATERIAL_INSUFFICIENCY",
              sourceIds: [],
            }))
          : await call("fallback", (hooks) => models.direct(context, deadline, hooks));
      })(),
    ]);
    await study.finishRound(scope, lease, round.key, proposals);
    if (outcomes.some((o) => o.status === "rejected")) {
      await study.finishExecution(scope, lease, round.key, false);
      return true;
    }
    try {
      await study.guard(scope, lease, true);
      const frames = await data.execution(record, signal);
      // New marks refresh admission after model latency; the earlier funding reconciliation is retained.
      for (const strategy of strategies) {
        await paper.observe(accountScope(record, strategy), `${round.key}:execution-marks`, {
          frames,
          funding: [],
          marksOnly: true,
        });
      }
      for (const strategy of strategies) {
        const current = await paper.view(accountScope(record, strategy));
        const risk = paperRisk(current.account, current.attempts, now());
        for (const position of current.account.positions.filter(
          (p) => p.closedAt === null && risk.closeSymbols.includes(p.symbol),
        )) {
          closedThisRound.add(`${strategy}:${position.symbol}`);
          await execute(
            scope,
            lease,
            record,
            strategy,
            `${round.key}:risk:${position.symbol}`,
            { symbol: position.symbol, action: "close", reason: "RISK_EXIT", sourceIds: [] },
            frames,
            signal,
          );
        }
        for (const proposal of proposals[strategy]!) {
          if (closedThisRound.has(`${strategy}:${proposal.symbol}`)) {
            continue;
          }
          await execute(
            scope,
            lease,
            record,
            strategy,
            `${round.key}:${proposal.symbol}`,
            proposal,
            frames,
            signal,
          );
        }
      }
      await study.finishExecution(scope, lease, round.key, true);
    } catch (error) {
      signal.throwIfAborted();
      await study.event(scope, lease, `${round.key}:execution-failed`, "execution-failed", {
        code: safeCode(error),
      });
      await study.finishExecution(scope, lease, round.key, false);
      await study.stopDecisions(scope, lease, "INCOMPLETE_EXECUTION");
    }
    return true;
  }
  return {
    cycle,
    async run(scope: PerpsStudyScope, signal: AbortSignal) {
      const lease = await study.claim(scope);
      const lost = new AbortController();
      let renewing = false;
      const heartbeat = setInterval(() => {
        if (renewing) {
          return;
        }
        renewing = true;
        void study
          .renew(scope, lease)
          .catch(() => lost.abort())
          .finally(() => {
            renewing = false;
          });
      }, 20000);
      const combined = AbortSignal.any([signal, lost.signal]);
      try {
        for (;;) {
          const start = now();
          if (!(await cycle(scope, lease, combined))) {
            break;
          }
          const wait = Math.max(0, 60000 - (now() - start));
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              reject(combined.reason);
            };
            const timer = setTimeout(() => {
              combined.removeEventListener("abort", abort);
              resolve();
            }, wait);
            combined.addEventListener("abort", abort, { once: true });
            if (combined.aborted) {
              abort();
            }
          });
        }
      } finally {
        clearInterval(heartbeat);
        await study.release(scope, lease);
      }
    },
  };
}
