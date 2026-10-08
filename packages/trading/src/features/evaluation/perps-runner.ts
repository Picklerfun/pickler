import { universeProposals, universeFinal, reviewUniverse } from "../perps-study/universe.js";
import { perpsSlotClock } from "../perps-study/policy.js";
import { perpsRules } from "../perps-strategies/policy.js";
import {
  executeSmaReviewVariant,
  smaFinalProposals,
  type SmaReviewModels,
} from "../perps-study/sma-review.js";
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
} from "../perps-study/types.js";
import { executePerpsStrategy } from "../perps-strategies/registry.js";
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
function validateCommonFrames(
  frames: PerpsPaperFrame[],
  network: string,
  at: number,
  record?: PerpsStudyRecord,
) {
  if (record?.config.version === 5) {
    if (frames.length === 0) {
      throw new PilotError("DATA_UNAVAILABLE", "No valid universe frames");
    }
    const config = record.config;
    if (
      new Set(frames.map((f) => f.snapshot.market.symbol)).size !== frames.length ||
      frames.some(
        (f) =>
          !config.markets.some(
            (m) =>
              m.symbol === f.snapshot.market.symbol && m.marketId === f.snapshot.market.marketId,
          ),
      )
    ) {
      throw new PilotError("PERPL_MARKET_IDENTITY", "Universe frame identity mismatch");
    }
    for (const f of frames) {
      validatePaperFrame(f, network, f.snapshot.market.symbol, at);
    }
    return;
  }
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
  smaModels?: SmaReviewModels;
  afterCycle?: () => Promise<void>;
  now?: () => number;
  paperForLease?: (
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    signal: AbortSignal,
  ) => PerpsPaperRepository;
  leaseDiagnostic?: (event: LeaseDiagnostic) => void;
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
      if (!(failure instanceof PilotError)) {
        throw failure;
      }
      if (
        record.config.version === 5 &&
        [
          "LEASE_LOST",
          "PROCESS_INTERRUPTED",
          "PERSISTENCE_FAILED",
          "PERMISSION_DENIED",
          "CONFIG_CHANGED",
          "PLUGIN_DISABLED",
        ].includes(failure.code)
      ) {
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
    const stopped = record.config.version !== 1 && !!record.decisionStopReason;
    if (now() >= record.endsAt! || record.stopRequested || stopped) {
      for (const strategy of strategies) {
        await paper.closeAdmissions(accountScope(record, strategy));
      }
    }
    if (now() >= record.graceUntil!) {
      await study.complete(scope, lease);
      return false;
    }
    const slot = perpsSlotClock(record, now()).slot;
    if (record.config.version === 5) {
      const saved = await study.view(scope);
      for (let missed = 0; missed < Math.min(slot, 8); missed++) {
        if (
          !saved.events.some((e) => e.key === `slot-${missed}` || e.key === `slot-${missed}:missed`)
        ) {
          await study.event(scope, lease, `slot-${missed}:missed`, "slot-missed", {
            slot: missed,
            code: "WINDOW_MISSED",
          });
        }
      }
    }
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
      validateCommonFrames(observation.frames, record.config.network, now(), record);
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
    for (const strategy of strategies) {
      const risk = paperRisk(views[strategy]!.account, views[strategy]!.attempts, now());
      for (const position of views[strategy]!.account.positions.filter(
        (p) => p.closedAt === null,
      )) {
        if (
          (closing || risk.closeSymbols.includes(position.symbol)) &&
          observation.frames.some((f) => f.snapshot.market.symbol === position.symbol)
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
            risk: paperRisk(views[s]!.account, views[s]!.attempts, now()),
            positions: views[s]!.account.positions.filter((p) => p.closedAt === null).length,
            fundingPending: views[s]!.account.fundingPending,
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
    let evidence: PerpsEvidence;
    try {
      evidence = await data.evidence(record, observation, signal, () => ownedGuard());
      signal.throwIfAborted();
      validateCommonFrames(evidence.frames, record.config.network, now(), record);
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
    const blockInitialOpenings =
      record.config.version === 5 &&
      Object.values(accounts).some((a) =>
        a!.positions.some(
          (p) =>
            p.closedAt === null &&
            !evidence.frames.some((f) => f.snapshot.market.symbol === p.symbol),
        ),
      );
    const rules =
      record.config.version === 5
        ? universeProposals(
            { evidence, account: accounts.rules! },
            record.config,
            blockInitialOpenings,
          )
        : await executePerpsStrategy(
            { id: "rules", version: "1.0.0" },
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
    const proposals: Partial<Record<PerpsStudyStrategy, PerpsProposal[]>> = { rules };
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
          cost: async (usd) => {
            if (!study.providerCost) {
              throw new PilotError("USAGE_UNVERIFIED", "Provider cost persistence unavailable");
            }
            await study.providerCost(scope, lease, round!.key, lane, usd);
          },
        });
        assertActive();
        deadline.throwIfAborted();
        await study.finishCall(scope, lease, round!.key, lane, result, null);
        return result;
      } catch (error) {
        const failure =
          record.config.version === 5 && deadline.aborted && !signal.aborted
            ? new PilotError(
                "MODEL_TIMEOUT",
                "Global model phase deadline expired, including queue wait",
              )
            : error;
        if (started) {
          await study.finishCall(scope, lease, round!.key, lane, null, safeCode(failure));
        } else {
          await study.stopDecisions(scope, lease, safeCode(failure));
        }
        throw failure;
      }
    }
    // Preserve the historical launch order; account/report order is a separate protocol detail.
    const modelStrategies: PerpsStudyStrategy[] =
      record.config.version === 4 || record.config.version === 5
        ? ["sma-jev", "sma-exa-jev"]
        : record.config.version === 3
          ? []
          : ["deepseek", "jev"];
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
        if (record.config.version === 4 || record.config.version === 5) {
          if (!deps.smaModels || (strategy !== "sma-jev" && strategy !== "sma-exa-jev")) {
            throw new PilotError("MODELS_DISABLED", "SMA review models required");
          }
          const original =
            record.config.version === 5
              ? universeProposals(context, record.config, blockInitialOpenings)
              : perpsRules(context);
          await study.event(
            scope,
            lease,
            `${round.key}:${strategy}:original`,
            "strategy-proposal",
            { strategy, proposals: original, account },
          );
          proposals[strategy] =
            record.config.version === 5
              ? await reviewUniverse(
                  strategy,
                  context,
                  original,
                  deps.smaModels,
                  { run: call },
                  deadline,
                )
              : await executeSmaReviewVariant(
                  strategy,
                  context,
                  deps.smaModels,
                  { run: call },
                  deadline,
                );
          return;
        }
        if (!models) {
          throw new PilotError("MODELS_DISABLED", "Model composition unavailable");
        }
        const dependencies = { models, signal: deadline, calls: { run: call } };
        proposals[strategy] =
          record.config.version === 1 && strategy === "jev"
            ? await executeLegacyPerpsReadiness(context, dependencies)
            : await executePerpsStrategy({ id: strategy, version: "1.0.0" }, context, dependencies);
      }),
    );
    await study.finishRound(scope, lease, round.key, proposals);
    if (outcomes.some((o) => o.status === "rejected")) {
      await study.finishExecution(scope, lease, round.key, "incomplete");
      return true;
    }
    let executionStarted = false;
    try {
      await ownedGuard(record.config.version !== 3);
      const frames = await data.execution(record, signal, () => ownedGuard());
      signal.throwIfAborted();
      // Persist the common execution input even if validation rejects it before any fill.
      await study.event(scope, lease, `${round.key}:execution-input`, "execution-input", {
        observedAt: now(),
        frames,
      });
      validateCommonFrames(frames, record.config.network, now(), record);
      await ownedGuard(record.config.version !== 3);
      const finalClock = now();
      const finalEvidence =
        record.config.version === 5
          ? {
              ...evidence,
              frames,
              observedAt: finalClock,
              excluded: [
                ...(evidence.excluded ?? []),
                ...record.config.markets
                  .filter((m) => !frames.some((f) => f.snapshot.market.symbol === m.symbol))
                  .map((m) => ({
                    symbol: m.symbol,
                    code: "DATA_UNAVAILABLE",
                    phase: "execution-refresh",
                  })),
              ],
            }
          : { ...evidence, frames, observedAt: finalClock };
      const finalBlock =
        record.config.version === 5 &&
        Object.values(accounts).some((a) =>
          a!.positions.some(
            (p) =>
              p.closedAt === null && !frames.some((f) => f.snapshot.market.symbol === p.symbol),
          ),
        );
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
          (p) =>
            p.closedAt === null &&
            risk.closeSymbols.includes(p.symbol) &&
            frames.some((f) => f.snapshot.market.symbol === p.symbol),
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
        const finalProposals =
          record.config.version === 5
            ? universeFinal(
                proposals[strategy]!,
                { evidence: finalEvidence, account: current.account },
                record.config,
                finalBlock,
              )
            : record.config.version === 4
              ? smaFinalProposals(proposals[strategy]!, {
                  evidence: { ...evidence, frames, observedAt: now() },
                  account: current.account,
                })
              : proposals[strategy]!;
        if (record.config.version === 4 || record.config.version === 5) {
          await study.event(scope, lease, `${round.key}:${strategy}:final-gate`, "final-gate", {
            strategy,
            initial: proposals[strategy],
            final: finalProposals,
          });
        }
        const ordered =
          record.config.version === 5
            ? [
                ...finalProposals.filter((p) => p.action === "close"),
                ...finalProposals
                  .filter((p) => p.action.startsWith("open-"))
                  .sort(
                    (a, b) =>
                      (a as PerpsProposal & { rank?: number }).rank! -
                      (b as PerpsProposal & { rank?: number }).rank!,
                  ),
                ...finalProposals.filter((p) => p.action === "hold"),
              ]
            : finalProposals;
        for (const proposal of ordered) {
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
      const heartbeat = startLeaseHeartbeat({
        lease,
        renew: () => study.renew(scope, lease),
        now,
        ...(deps.leaseDiagnostic ? { diagnostic: deps.leaseDiagnostic } : {}),
      });
      assertActive = heartbeat.assertActive;
      lease.assertActive = assertActive;
      const combined = AbortSignal.any([signal, heartbeat.signal]);
      let interruption: string | undefined;
      try {
        for (;;) {
          const start = now();
          const continuing = await cycle(scope, lease, combined);
          await deps.afterCycle?.();
          if (!continuing) {
            break;
          }
          const latest = (await study.view(scope)).record;
          const wait =
            latest.config.version === 5
              ? Math.max(1, 60000 - (now() % 60000) + 100)
              : Math.max(0, 60000 - (now() - start));
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
      } catch (error) {
        interruption = safeCode(error);
        throw error;
      } finally {
        await heartbeat.stop();
        await study.release(scope, lease, interruption).catch(() => {
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
