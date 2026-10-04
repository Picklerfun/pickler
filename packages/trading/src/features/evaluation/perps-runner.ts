import { startLeaseHeartbeat, type LeaseDiagnostic } from "./lease-heartbeat.js";
import {
  perpsStrategies,
  type PerpsStudyStrategy,
  type PerpsStudyMap,
  type PerpsStudyRepository,
  type PerpsStudyScope,
  type PerpsStudyLease,
  type PerpsEvidence,
  type PerpsProposal,
  type PerpsCallLane,
  type PerpsStudyRecord,
  type SmaVariant,
} from "../perps-study/types.js";
import {
  smaAblationProposal,
  finalSmaProposal,
  commonSmaExit,
} from "../perps-strategies/sma-ablation.js";
import { executePerpsStrategy } from "../perps-strategies/registry.js";
import {
  validateMultiframeEvidence,
  gateMultiframeProposal,
} from "../perps-strategies/multiframe.js";
import { executeLegacyPerpsReadiness } from "../perps-study/legacy-strategy.js";
import { PilotError } from "@pickler/core";
import {
  createPerpsPaperService,
  validatePaperFrame,
  transientPerpsData,
  paperRisk,
  type PerpsPaperRepository,
  type PerpsPaperData,
  type PerpsPaperObservation,
  type PerpsPaperFrame,
  type PerpsPaperView,
} from "../../perps.js";
import type { PerpsModels, PerpsModelHooks } from "./model.js";
export interface StudyData {
  observe(
    record: PerpsStudyRecord,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ): Promise<PerpsPaperObservation>;
  evidence(
    record: PerpsStudyRecord,
    observation: PerpsPaperObservation,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ): Promise<PerpsEvidence>;
  execution(
    record: PerpsStudyRecord,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ): Promise<PerpsPaperFrame[]>;
}
function validateCommonFrames(frames: PerpsPaperFrame[], network: string, at: number) {
  if (
    frames.length !== 2 ||
    !frames.some((frame) => frame.snapshot.market.symbol === "BTC") ||
    !frames.some((frame) => frame.snapshot.market.symbol === "ETH")
  ) {
    throw new PilotError("INVALID_MARKET_DATA", "BTC and ETH common frames required");
  }
  for (const frame of frames) {
    validatePaperFrame(frame, network, frame.snapshot.market.symbol, at);
  }
}
const safeCode = (error: unknown) =>
  error instanceof PilotError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "STUDY_OPERATION_FAILED";
export function createPerpsStudyRunner(deps: {
  study: PerpsStudyRepository;
  paper: PerpsPaperRepository;
  data: StudyData;
  models?: PerpsModels;
  now?: () => number;
  paperForLease?: (
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    signal: AbortSignal,
  ) => PerpsPaperRepository;
  leaseDiagnostic?: (event: LeaseDiagnostic) => void;
  onCycle?: () => Promise<void>;
}) {
  const { study, data, models } = deps;
  let paper = deps.paper;
  let assertActive = () => {};
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
  let simulator = createPerpsPaperService(paper, unavailable, now);
  const accountScope = (record: PerpsStudyRecord, strategy: PerpsStudyStrategy) => ({
    ...record.config,
    agentId: record.agentIds[strategy]!,
  });
  async function execute(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    record: PerpsStudyRecord,
    strategy: PerpsStudyStrategy,
    key: string,
    proposal: PerpsProposal,
    frames: PerpsPaperFrame[],
    signal: AbortSignal,
  ) {
    assertActive();
    signal.throwIfAborted();
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
      if (record.config.version === 3) {
        throw failure;
      }
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
    const ownedGuard = async (paid = false) => {
      assertActive();
      signal.throwIfAborted();
      await study.guard(scope, lease, paid);
      assertActive();
      signal.throwIfAborted();
    };
    paper = deps.paperForLease?.(scope, lease, signal) ?? deps.paper;
    simulator = createPerpsPaperService(paper, unavailable, now);
    await ownedGuard();
    let { record } = await study.view(scope);
    const strategies = perpsStrategies(record.config);
    const ablation = record.config.version === 3;
    const stopped = record.config.version >= 2 && !!record.decisionStopReason;
    if (now() >= record.endsAt! || record.stopRequested || stopped) {
      for (const strategy of strategies) {
        await paper.closeAdmissions(accountScope(record, strategy));
      }
    }
    if (now() >= record.graceUntil!) {
      await study.complete(scope, lease);
      return false;
    }
    const slot = Math.floor((now() - record.startedAt!) / 900000);
    const attempted = !record.decisionStopReason && (await study.claimSlot(scope, lease, slot));
    const skip = async (phase: "before-model" | "execution-refresh", error: unknown) => {
      await study.event(scope, lease, `slot-${slot}:data-unavailable`, "data-unavailable", {
        slot,
        phase,
        code: "DATA_UNAVAILABLE",
        cause: safeCode(error),
      });
    };
    const minute = Math.floor((now() - record.startedAt!) / 60000);
    const key = `observe-${minute}`;
    const views = {} as PerpsStudyMap<PerpsPaperView>;
    let observation: PerpsPaperObservation;
    let observationWritesStarted = false;
    try {
      observation = await data.observe(record, signal, () => ownedGuard());
      validateCommonFrames(observation.frames, record.config.network, now());
      observationWritesStarted = true;
      for (const strategy of strategies) {
        await ownedGuard();
        views[strategy] = await paper.observe(accountScope(record, strategy), key, observation);
      }
    } catch (error) {
      signal.throwIfAborted();
      if (observationWritesStarted) {
        throw error;
      }
      if (attempted && transientPerpsData(error)) {
        await skip("before-model", error);
      }
      if (!transientPerpsData(error)) {
        throw error;
      }
      await study.event(scope, lease, `${key}:failed`, "observation-failed", {
        code: safeCode(error),
      });
      return true;
    }
    const closing = now() >= record.endsAt! || record.stopRequested || stopped;
    const closedThisRound = new Set<string>();
    let sharedEvidence: PerpsEvidence | undefined;
    if (ablation && !closing) {
      try {
        sharedEvidence = await data.evidence(record, observation, signal, () => ownedGuard());
        validateCommonFrames(sharedEvidence.frames, record.config.network, now());
        validateMultiframeEvidence(sharedEvidence);
      } catch (error) {
        signal.throwIfAborted();
        if (!transientPerpsData(error)) {
          throw error;
        }
        if (attempted) {
          await skip("before-model", error);
        }
        await study.event(scope, lease, `${key}:candles`, "evidence-failed", {
          code: safeCode(error),
        });
        // Missing candles must not prevent a deterministic risk/horizon exit on valid frames.
      }
    }
    for (const strategy of strategies) {
      const risk = paperRisk(views[strategy]!.account, views[strategy]!.attempts, now());
      for (const position of views[strategy]!.account.positions.filter(
        (p) => p.closedAt === null,
      )) {
        if (
          closing ||
          risk.closeSymbols.includes(position.symbol) ||
          ((record.config.strategyVersion === "1.1.0" || ablation) &&
            now() - position.openedAt >= 30 * 60000) ||
          (sharedEvidence &&
            commonSmaExit(
              { evidence: sharedEvidence, account: views[strategy]!.account },
              position.symbol,
            )?.action === "close")
        ) {
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
              reason:
                ablation && risk.closeSymbols.includes(position.symbol)
                  ? "RISK_EXIT"
                  : closing
                    ? "SESSION_END"
                    : now() - position.openedAt >= 30 * 60000 &&
                        (record.config.strategyVersion === "1.1.0" || ablation)
                      ? "HORIZON_EXIT"
                      : risk.closeSymbols.includes(position.symbol)
                        ? "RISK_EXIT"
                        : "THESIS_EXIT",
              sourceIds: [],
            },
            sharedEvidence?.frames ?? observation.frames,
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
            risk: paperRisk(views[s]!.account, views[s]!.attempts, now()),
            positions: views[s]!.account.positions.filter((p) => p.closedAt === null).length,
            fundingPending: views[s]!.account.fundingPending,
            fundingDisputed: views[s]!.account.fundingDisputed ?? false,
          },
        ]),
      ),
    );
    if (closing) {
      await study.stopDecisions(scope, lease, "SESSION_END");
      if (
        strategies.every(
          (s) =>
            views[s]!.account.positions.every((p) => p.closedAt !== null) &&
            !views[s]!.account.fundingPending &&
            !views[s]!.account.fundingDisputed,
        )
      ) {
        await study.complete(scope, lease);
        return false;
      }
      return true;
    }
    record = (await study.view(scope)).record;
    if (record.decisionStopReason) {
      return true;
    }
    // Late or missed rounds are never reconstructed. Allow the first minute of the current slot.
    if (!attempted) {
      return true;
    }
    if (ablation && !sharedEvidence) {
      return true;
    }
    let evidence: PerpsEvidence;
    try {
      evidence =
        sharedEvidence ?? (await data.evidence(record, observation, signal, () => ownedGuard()));
      signal.throwIfAborted();
      validateCommonFrames(evidence.frames, record.config.network, now());
      if (record.config.strategyVersion === "1.1.0" || ablation) {
        validateMultiframeEvidence(evidence);
      }
    } catch (error) {
      signal.throwIfAborted();
      if (transientPerpsData(error)) {
        await skip("before-model", error);
      } else {
        throw error;
      }
      await study.event(scope, lease, `${key}:candles`, "evidence-failed", {
        code: safeCode(error),
      });
      return true;
    }
    const accounts = Object.fromEntries(
      strategies.map((s) => [s, views[s]!.account]),
    ) as Parameters<PerpsStudyRepository["reserve"]>[4];
    const rules = ablation
      ? []
      : await executePerpsStrategy(
          { id: "rules", version: record.config.strategyVersion ?? "1.0.0" },
          { evidence, account: accounts.rules! },
          {
            models: {},
            signal,
            calls: {
              run: async () => {
                throw new PilotError("MODEL_CONFIG_MISMATCH", "Rules cannot call models");
              },
            },
          },
        );
    const round = await study.reserve(scope, lease, slot, evidence, accounts, rules);
    if (!round) {
      return true;
    }
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
    const proposals: Partial<Record<PerpsStudyStrategy, PerpsProposal[]>> = ablation
      ? {}
      : { rules };
    if (ablation) {
      for (const strategy of strategies) {
        const choices = smaAblationProposal(
          { evidence, account: accounts[strategy]! },
          strategy as SmaVariant,
        );
        proposals[strategy] = choices.map((c) => c.proposal);
        await study.event(scope, lease, `${round.key}:${strategy}:initial`, "sma-initial", {
          slot,
          strategy,
          choices,
        });
      }
    }
    async function call<T>(
      lane: PerpsCallLane,
      fn: (hooks: PerpsModelHooks) => Promise<T>,
    ): Promise<T> {
      let started = false;
      try {
        const result = await fn({
          before: async (request) => {
            await ownedGuard(true);
            await study.startCall(scope, lease, round!.key, lane, request);
            started = true;
          },
          diagnostic: (value) =>
            study.event(
              scope,
              lease,
              `${round!.key}:${lane}:diagnostic`,
              "model-diagnostic",
              value,
            ),
          usage: (input, output) => study.usage(scope, lease, round!.key, lane, input, output),
        });
        assertActive();
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
    // Preserve the historical launch order; account/report order is a separate protocol detail.
    const modelStrategies: PerpsStudyStrategy[] = ablation ? [] : ["deepseek", "jev"];
    if (record.config.version === 2) {
      modelStrategies.push("combined");
    }
    const outcomes = await Promise.allSettled(
      modelStrategies.map(async (strategy) => {
        const account = accounts[strategy];
        if (!account) {
          throw new PilotError("MODEL_CONFIG_MISMATCH", "Strategy account unavailable");
        }
        const context = { evidence, account };
        if (!models) {
          throw new PilotError(
            "MODEL_CONFIG_MISMATCH",
            "Models required by this historical protocol",
          );
        }
        const dependencies = { models, signal: deadline, calls: { run: call } };
        proposals[strategy] =
          record.config.version === 1 && strategy === "jev"
            ? await executeLegacyPerpsReadiness(context, dependencies)
            : await executePerpsStrategy(
                { id: strategy, version: record.config.strategyVersion ?? "1.0.0" },
                context,
                dependencies,
              );
      }),
    );
    await study.finishRound(scope, lease, round.key, proposals);
    if (outcomes.some((o) => o.status === "rejected")) {
      await study.finishExecution(scope, lease, round.key, "incomplete");
      return true;
    }
    let executionStarted = false;
    try {
      await ownedGuard(true);
      const frames = await data.execution(record, signal, () => ownedGuard());
      signal.throwIfAborted();
      // Persist the common execution input even if validation rejects it before any fill.
      await study.event(scope, lease, `${round.key}:execution-input`, "execution-input", {
        observedAt: now(),
        frames,
      });
      const finalAt = now();
      validateCommonFrames(frames, record.config.network, finalAt);
      await ownedGuard(true);
      if (record.config.strategyVersion === "1.1.0" || ablation) {
        validateMultiframeEvidence({ ...evidence, observedAt: finalAt, frames });
      }
      executionStarted = true;
      // New marks refresh admission after model latency; the earlier funding reconciliation is retained.
      for (const strategy of strategies) {
        signal.throwIfAborted();
        await ownedGuard();
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
        for (const originalProposal of proposals[strategy]!) {
          const proposal = ablation
            ? finalSmaProposal(
                {
                  evidence: { ...evidence, observedAt: finalAt, frames },
                  account: current.account,
                },
                strategy as SmaVariant,
                originalProposal,
              )
            : record.config.strategyVersion === "1.1.0"
              ? gateMultiframeProposal(
                  {
                    evidence: { ...evidence, observedAt: finalAt, frames },
                    account: current.account,
                  },
                  originalProposal,
                )
              : originalProposal;
          if (proposal !== originalProposal || ablation) {
            await study.event(
              scope,
              lease,
              `${round.key}:${strategy}:${proposal.symbol}:final-gate`,
              "final-policy-gate",
              {
                originalProposal,
                proposal,
                strategyVersion: record.config.strategyVersion,
                finalRisk: risk,
                closedThisRound: closedThisRound.has(`${strategy}:${proposal.symbol}`),
                ...(ablation
                  ? {
                      trace: smaAblationProposal(
                        {
                          evidence: { ...evidence, observedAt: finalAt, frames },
                          account: current.account,
                        },
                        strategy as SmaVariant,
                      ).find((c) => c.proposal.symbol === proposal.symbol)?.trace,
                    }
                  : {}),
              },
            );
          }
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
      await study.finishExecution(scope, lease, round.key, "complete");
    } catch (error) {
      signal.throwIfAborted();
      if (
        ablation &&
        (!(error instanceof PilotError) ||
          ["LEASE_LOST", "PERSISTENCE_FAILED", "EVENT_PERSISTENCE_FAILED"].includes(error.code))
      ) {
        throw error;
      }
      if (!executionStarted && transientPerpsData(error)) {
        await skip("execution-refresh", error);
        await study.finishExecution(scope, lease, round.key, "skipped_data_unavailable");
        return true;
      }
      await study.event(scope, lease, `${round.key}:execution-failed`, "execution-failed", {
        code: safeCode(error),
      });
      await study.finishExecution(scope, lease, round.key, "incomplete");
      await study.stopDecisions(scope, lease, "INCOMPLETE_EXECUTION");
    }
    return true;
  }
  return {
    cycle,
    async run(scope: PerpsStudyScope, signal: AbortSignal) {
      const lease = await study.claim(scope);
      const ablation = (await study.view(scope)).record.config.version === 3;
      const heartbeat = startLeaseHeartbeat({
        lease,
        renew: () => study.renew(scope, lease),
        now,
        ...(deps.leaseDiagnostic ? { diagnostic: deps.leaseDiagnostic } : {}),
      });
      assertActive = heartbeat.assertActive;
      lease.assertActive = assertActive;
      const combined = AbortSignal.any([signal, heartbeat.signal]);
      try {
        for (;;) {
          const start = now();
          const { record } = await study.view(scope);
          if (
            record.config.version === 3 &&
            record.startedAt !== null &&
            now() < record.startedAt
          ) {
            await wait(Math.min(60000, record.startedAt - now()), combined);
            continue;
          }
          if (!(await cycle(scope, lease, combined))) {
            await deps.onCycle?.();
            break;
          }
          await deps.onCycle?.();
          const delay = Math.max(0, 60000 - (now() - start));
          await wait(delay, combined);
        }
      } catch (error) {
        if (
          ablation &&
          error instanceof PilotError &&
          [
            "CONFIG_CHANGED",
            "CONFIG_CHANGED_DURING_READ",
            "PAUSED",
            "PLUGIN_DISABLED",
            "TOOL_DISABLED",
            "PERMISSION_DENIED",
          ].includes(error.code) &&
          !combined.aborted
        ) {
          heartbeat.assertActive();
          await study.stopDecisions(scope, lease, error.code);
          await study.complete(scope, lease);
        }
        throw error;
      } finally {
        await heartbeat.stop();
        await study.release(scope, lease).catch(() => {
          deps.leaseDiagnostic?.({
            kind: "release-failed",
            at: now(),
            durationMs: 0,
            timerDelayMs: 0,
            lastSuccessAt: null,
            expiresAt: lease.expiresAt,
            code: "LEASE_RELEASE_FAILED",
          });
        });
      }
    },
  };
}

function wait(delay: number, combined: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(combined.reason);
    };
    const timer = setTimeout(() => {
      combined.removeEventListener("abort", abort);
      resolve();
    }, delay);
    combined.addEventListener("abort", abort, { once: true });
    if (combined.aborted) {
      abort();
    }
  });
}
