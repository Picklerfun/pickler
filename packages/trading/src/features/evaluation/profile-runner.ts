import { nextPriceCycleDelay } from "./sma-timing.js";
import { PilotError } from "@pickler/core";
import { perpsSlotClock } from "../perps-study/policy.js";
import { profileProposals, profileFinal, profileSignal } from "../perps-study/profiles.js";
import {
  SMA_PROFILE_VARIANTS,
  SMA_REENTRY_VARIANTS,
  type SmaReentryVariant,
  type SmaProfileVariant,
  type PerpsStudyRepository,
  type PerpsStudyScope,
  type PerpsStudyLease,
  type PerpsStudyRecord,
  type PerpsEvidence,
  type PerpsProposal,
  type PerpsStudyMap,
} from "../perps-study/types.js";
import { reentryGate, SMA_ENTRY_POLICIES } from "../perps-study/reentry.js";
import { startLeaseHeartbeat, type LeaseDiagnostic } from "./lease-heartbeat.js";
import {
  createPerpsPaperService,
  paperRisk,
  selectiveReduction,
  transientPerpsData,
  validatePaperFrameSet,
  COMPONENT_PAPER_POLICY,
  simulatePerpsFill,
  type PerpsPaperRepository,
  type PerpsPaperFrame,
  type PerpsPaperView,
  type PerpsPaperObservation,
  type PerpsCommonObservationResult,
} from "../../perps.js";
import type { StudyData } from "./perps-runner.js";
export interface ProfileStudyData extends StudyData {
  prepareEvidence?(
    record: PerpsStudyRecord,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<PerpsEvidence>;
  reconcile?(
    record: PerpsStudyRecord,
    accounts: PerpsStudyMap<PerpsPaperView>,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<import("../../perps.js").PerpsPaperObservation>;
  finalEvidence(
    record: PerpsStudyRecord,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<PerpsEvidence>;
}
class RolledBackObservationUnavailable extends PilotError {
  constructor(
    readonly result: Extract<PerpsCommonObservationResult, { status: "data_unavailable" }>,
  ) {
    super(result.code, "Common valuation expired and was completely rolled back");
  }
}
const code = (e: unknown) => (e instanceof PilotError ? e.code : "STUDY_OPERATION_FAILED");
export function createProfileStudyRunner(deps: {
  study: PerpsStudyRepository;
  paper: PerpsPaperRepository;
  data: ProfileStudyData;
  paperForLease?: (
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    signal: AbortSignal,
  ) => PerpsPaperRepository;
  afterCycle?: () => Promise<void>;
  afterObservation?: (value: unknown) => Promise<void>;
  timing?: (value: {
    version: 1;
    cycle: string;
    operation: string;
    at: number;
    durationMs: number;
    timerDelayMs?: number;
  }) => void;
  monotonic?: () => number;
  now?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  leaseDiagnostic?: (e: LeaseDiagnostic) => void;
}) {
  const now = deps.now ?? Date.now;
  const monotonic = deps.monotonic ?? (() => performance.now());
  async function measured<T>(cycle: string, operation: string, work: () => Promise<T>): Promise<T> {
    const start = monotonic();
    try {
      return await work();
    } finally {
      deps.timing?.({ version: 1, cycle, operation, at: now(), durationMs: monotonic() - start });
    }
  }
  const sleep =
    deps.sleep ??
    ((delay: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, delay);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
        }
      }));
  const { study, data } = deps;
  let paper = deps.paper;
  const target = (r: PerpsStudyRecord, v: SmaProfileVariant | SmaReentryVariant) => ({
    ...r.config,
    agentId: r.agentIds[v]!,
  });
  function valid(e: PerpsEvidence, r: PerpsStudyRecord) {
    if (r.config.version !== 6 && r.config.version !== 7) {
      throw new PilotError("INVALID_INPUT", "Profile protocol required");
    }
    if (!e.frames.length) {
      throw new PilotError("DATA_UNAVAILABLE", "No common valid assets");
    }
    if (new Set(e.frames.map((f) => f.snapshot.market.symbol)).size !== e.frames.length) {
      throw new PilotError("PERPL_MARKET_IDENTITY", "Duplicate market");
    }
    for (const frame of e.frames) {
      if (
        !r.config.markets.some(
          (m) =>
            m.symbol === frame.snapshot.market.symbol &&
            m.marketId === frame.snapshot.market.marketId,
        )
      ) {
        throw new PilotError("PERPL_MARKET_IDENTITY", "Catalog identity mismatch");
      }
    }
    const policy =
      r.config.version === 7 && r.config.acquisitionPolicy === COMPONENT_PAPER_POLICY
        ? COMPONENT_PAPER_POLICY
        : undefined;
    validatePaperFrameSet(e.frames, r.config.network, now(), policy);
  }
  async function cycle(scope: PerpsStudyScope, lease: PerpsStudyLease, signal: AbortSignal) {
    const guard = async () => {
      signal.throwIfAborted();
      lease.assertActive?.();
      await study.guard(scope, lease);
      signal.throwIfAborted();
    };
    await guard();
    const saved = await study.view(scope),
      r = saved.record;
    if (r.config.version !== 6 && r.config.version !== 7) {
      throw new PilotError("INVALID_INPUT", "Profile protocol required");
    }
    const config = r.config;
    const variants = config.version === 7 ? SMA_REENTRY_VARIANTS : SMA_PROFILE_VARIANTS;
    if (
      Object.keys(r.agentIds).length !== variants.length ||
      variants.some((v) => !r.agentIds[v] || r.agentVersions[v] !== 1)
    ) {
      throw new PilotError("CONFIG_CHANGED", "Four frozen independent variant identities required");
    }
    if (now() >= r.graceUntil!) {
      await study.complete(scope, lease);
      return false;
    }
    const slot = perpsSlotClock(r, now()).slot;
    const closing = now() >= r.endsAt! || r.stopRequested || !!r.decisionStopReason;
    if (closing) {
      for (const v of variants) {
        await paper.closeAdmissions(target(r, v));
      }
    }
    for (let missed = 0; missed < Math.min(72, slot); missed++) {
      if (
        !saved.events.some((e) => e.key === `slot-${missed}` || e.key === `slot-${missed}:missed`)
      ) {
        await study.event(scope, lease, `slot-${missed}:missed`, "slot-missed", {
          slot: missed,
          code: "WINDOW_MISSED",
        });
      }
    }
    const admitted = !closing && (await study.claimSlot(scope, lease, slot));
    const minute = Math.floor(now() / 60000),
      key = `observe-${minute}`;
    const lastMinute = Math.max(
      Math.floor(r.startedAt! / 60000) - 1,
      ...saved.events
        .filter((e) => ["observation", "observation-failed", "observation-missed"].includes(e.kind))
        .map((e) => Number(/^observe-(\d+)/.exec(e.key)?.[1] ?? -1)),
    );
    for (let missed = lastMinute + 1; missed < minute; missed++) {
      await study.event(scope, lease, `observe-${missed}:missed`, "observation-missed", {
        minute: missed,
        code: "OBSERVATION_WINDOW_MISSED",
        phase: "serialized-public-acquisition",
      });
    }
    const simulator = createPerpsPaperService(
      paper,
      {
        frame: async () => {
          throw new PilotError("MISSING_FRAME", "Shared captured frames required");
        },
        observation: async () => {
          throw new PilotError("MISSING_FRAME", "Shared observation required");
        },
      },
      now,
    );
    let observation, evidence: PerpsEvidence;
    try {
      observation = await measured(key, "prices", () => data.observe(r, signal, guard));
      evidence = await data.evidence(r, observation, signal, guard);
      await measured(key, "frame-validation", async () => valid(evidence, r));
    } catch (e) {
      signal.throwIfAborted();
      if (!transientPerpsData(e)) {
        throw e;
      }
      await study.event(scope, lease, `${key}:failed`, "observation-failed", {
        code: code(e),
        slot,
      });
      if (admitted) {
        await study.event(scope, lease, `slot-${slot}:data-unavailable`, "data-unavailable", {
          slot,
          phase: "initial-evidence",
          cause: code(e),
        });
      }
      return true;
    }
    const closed = new Set(
      saved.events
        .filter((e) => {
          const execution = e.data as { slot?: number; action?: string; status?: string };
          return (
            e.kind === "profile-execution" &&
            execution.action === "close" &&
            execution.status === "filled" &&
            (execution.slot === slot || perpsSlotClock(r, e.at).slot === slot)
          );
        })
        .map(
          (e) =>
            `${(e.data as { variant: string }).variant}:${(e.data as { symbol: string }).symbol}`,
        ),
    );
    const processedCloses = new Set<string>();
    async function trade(
      v: SmaProfileVariant | SmaReentryVariant,
      p: PerpsProposal,
      frames: PerpsPaperFrame[],
      attemptKey: string,
    ) {
      if (p.action === "hold") {
        return;
      }
      await guard();
      const current = await paper.view(target(r, v));
      const position = current.account.positions.find(
        (x) => x.symbol === p.symbol && x.closedAt === null,
      );
      const isClose = p.action === "close";
      if (isClose && !position) {
        return;
      }
      if (!isClose && (closing || now() >= r.endsAt! || closed.has(`${v}:${p.symbol}`))) {
        return;
      }
      const frame = frames.find((f) => f.snapshot.market.symbol === p.symbol);
      if (!frame) {
        if (isClose) {
          await study.event(scope, lease, `${v}:${attemptKey}:exit-detected`, "exit-detected", {
            variant: v,
            symbol: p.symbol,
            positionId: position!.id,
            slot,
            reason: p.reason,
            detectedAt: now(),
            firstExecutableObservedAt: null,
            impediment: "DATA_UNAVAILABLE",
            positionBefore: position,
          });
          await study.event(scope, lease, `${v}:${attemptKey}`, "exit-impediment", {
            variant: v,
            symbol: p.symbol,
            error: "DATA_UNAVAILABLE",
            status: "not-attempted",
          });
        }
        return;
      }
      if (isClose) {
        if (processedCloses.has(`${v}:${p.symbol}`)) {
          return;
        }
        processedCloses.add(`${v}:${p.symbol}`);
      }
      const before = paperRisk(current.account, current.attempts, now());
      const detectedAt = now();
      if (isClose) {
        const exitIntent = {
          kind: "close" as const,
          symbol: p.symbol,
          side: position!.side,
          notional: "0",
          feeReserve: "1",
        };
        const admission = paperRisk(current.account, current.attempts, now(), exitIntent);
        let executable = admission.allowed;
        let impediment: string | null = admission.allowed ? null : admission.reasons.join(":");
        try {
          simulatePerpsFill(
            current.account,
            {
              kind: "close",
              symbol: p.symbol,
              side: position!.side,
              notional: "0",
              feeReserve: "1",
            },
            frame,
            now(),
          );
        } catch (e) {
          executable = false;
          impediment = code(e);
        }
        await study.event(scope, lease, `${v}:${attemptKey}:exit-detected`, "exit-detected", {
          variant: v,
          symbol: p.symbol,
          positionId: position!.id,
          slot,
          reason: p.reason,
          detectedAt,
          firstExecutableObservedAt: executable
            ? (saved.events
                .filter((e) => e.kind === "exit-detected")
                .map(
                  (e) =>
                    e.data as {
                      variant?: string;
                      positionId?: string;
                      firstExecutableObservedAt?: number | null;
                    },
                )
                .find(
                  (e) =>
                    e.variant === v &&
                    e.positionId === position!.id &&
                    e.firstExecutableObservedAt != null,
                )?.firstExecutableObservedAt ?? detectedAt)
            : null,
          impediment,
          frameHash: frame.hash,
          positionBefore: position,
          riskBefore: before,
          detectedConditions: {
            ageMs: now() - position!.openedAt,
            mark: position!.mark,
            entryPrice: position!.entryPrice,
            requestedByRisk: before.closeSymbols.includes(p.symbol),
            riskReasons: before.reasons,
          },
          limitation: "Observed opportunity; market crossing time is not known",
        });
      }
      let failure: string | null = null;
      let completed: PerpsPaperView | undefined;
      try {
        completed = await measured(attemptKey, "simulation-and-transaction", () =>
          simulator.trade(
            target(r, v),
            attemptKey,
            isClose ? "close" : "open",
            p.symbol,
            isClose ? position!.side : p.action === "open-long" ? "long" : "short",
            signal,
            frame,
            {
              ...(config.version === 7 && !isClose
                ? {
                    entryEvidence: {
                      roundKey: attemptKey.split(":")[0]!,
                      resolution: 3600 as const,
                      candleOpenTime: evidence.candles
                        .find((c) => c.market.symbol === p.symbol && c.resolution === 3600)!
                        .candles.at(-1)!.openTime,
                    },
                  }
                : {}),
              onSimulation: (durationMs) =>
                deps.timing?.({
                  version: 1,
                  cycle: attemptKey,
                  operation: "simulation",
                  at: now(),
                  durationMs,
                }),
            },
          ),
        );
      } catch (e) {
        signal.throwIfAborted();
        if (
          !(e instanceof PilotError) ||
          ![
            "RISK_REJECTED",
            "INSUFFICIENT_DEPTH",
            "SLIPPAGE_LIMIT",
            "OPEN_NOTIONAL_LIMIT",
            "DATA_UNAVAILABLE",
            "HOURLY_ENTRY_ALREADY_CONSUMED",
          ].includes(e.code)
        ) {
          throw e;
        }
        failure = e.code;
      }
      const after =
        config.version === 7 && config.acquisitionPolicy === COMPONENT_PAPER_POLICY && completed
          ? completed
          : await paper.view(target(r, v));
      const attempt = after.attempts.find((a) => a.key === attemptKey);
      if (attempt?.status === "pending" || attempt?.status === "interrupted") {
        throw new PilotError("INCOMPLETE_EXECUTION", "Uncertain execution requires reconciliation");
      }
      if (attempt?.status === "filled" && isClose) {
        closed.add(`${v}:${p.symbol}`);
      }
      await study.event(scope, lease, `${v}:${attemptKey}`, "profile-execution", {
        variant: v,
        slot,
        decisionSlot: perpsSlotClock(r, now()).slot,
        symbol: p.symbol,
        action: p.action,
        reason: p.reason,
        status: attempt?.status ?? "not-admitted",
        error: failure,
        openSymbolsBefore: current.account.positions
          .filter((p) => p.closedAt === null)
          .map((p) => p.symbol),
        openSymbolsAfter: after.account.positions
          .filter((p) => p.closedAt === null)
          .map((p) => p.symbol),
        before,
        after: paperRisk(after.account, after.attempts, now()),
        attemptKey,
      });
    }
    async function maintain(
      v: SmaProfileVariant | SmaReentryVariant,
      captured: PerpsEvidence,
      phaseKey: string,
    ) {
      const currentView = await paper.view(target(r, v));
      const risk = paperRisk(currentView.account, currentView.attempts, now());
      const signals = profileSignal(
        { evidence: captured, account: currentView.account },
        v,
        config.markets.map((m) => m.symbol),
      );
      for (const position of currentView.account.positions.filter((p) => p.closedAt === null)) {
        const reason = closing
          ? "SESSION_END"
          : risk.closeSymbols.includes(position.symbol)
            ? "RISK_EXIT"
            : signals.find((p) => p.symbol === position.symbol)?.action === "close"
              ? "PROFILE_INVALIDATION"
              : null;
        if (reason) {
          await trade(
            v,
            { symbol: position.symbol, action: "close", reason, sourceIds: [] },
            captured.frames,
            `${phaseKey}:mandatory:${position.symbol}`,
          );
        }
      }
      // Mandatory individual exits precede subset planning. Recompute after every confirmed exit.
      const considered = new Set<string>();
      for (;;) {
        const current = await paper.view(target(r, v));
        const plan = selectiveReduction(
          current.account,
          captured.frames.filter((f) => !processedCloses.has(`${v}:${f.snapshot.market.symbol}`)),
          now(),
        );
        await study.event(
          scope,
          lease,
          `${phaseKey}:${v}:reduction-${considered.size}`,
          "selective-reduction",
          {
            variant: v,
            slot,
            observationKey: phaseKey,
            openSymbols: current.account.positions
              .filter((p) => p.closedAt === null)
              .map((p) => p.symbol),
            legacyCloseRequestsOnSamePortfolio: paperRisk(
              { ...current.account, riskManagement: "legacy-1x-v1" },
              current.attempts,
              now(),
            ).closeSymbols,
            plan,
          },
        );
        if (plan.status !== "planned") {
          break;
        }
        const symbol = plan.symbols.find((s) => !considered.has(s));
        if (!symbol) {
          break;
        }
        considered.add(symbol);
        await trade(
          v,
          { symbol, action: "close", reason: "SELECTIVE_EXPOSURE", sourceIds: [] },
          captured.frames,
          `${phaseKey}:selective:${symbol}`,
        );
      }
    }
    const useCommonObservation =
      config.version === 7 &&
      config.acquisitionPolicy === COMPONENT_PAPER_POLICY &&
      !!paper.observeCommon;
    async function commonObservation(value: PerpsPaperObservation, phaseKey: string) {
      await guard();
      const result = await measured(phaseKey, "valuation:common", () =>
        paper.observeCommon!(
          variants.map((v) => target(r, v)),
          phaseKey,
          value,
        ),
      );
      if (result.status === "data_unavailable") {
        await guard();
        await study.event(
          scope,
          lease,
          `${phaseKey}:valuation-unavailable`,
          "valuation-data-unavailable",
          {
            phase: phaseKey,
            cause: result.code,
            rolledBack: result.rolledBack,
            frameValidation: result.validation,
          },
        );
        throw new RolledBackObservationUnavailable(result);
      }
      return result;
    }
    const views: PerpsStudyMap<PerpsPaperView> = {};
    const beforeMaintenance: PerpsStudyMap<unknown> = {};
    if (useCommonObservation) {
      let result: Extract<PerpsCommonObservationResult, { status: "complete" }>;
      try {
        result = await commonObservation(observation, key);
      } catch (e) {
        if (!(e instanceof RolledBackObservationUnavailable)) {
          throw e;
        }
        await study.event(scope, lease, `${key}:failed`, "observation-failed", {
          slot,
          phase: "price-valuation",
          code: e.code,
          rolledBack: true,
          frameValidation: e.result.validation,
        });
        if (admitted) {
          await study.event(scope, lease, `slot-${slot}:data-unavailable`, "data-unavailable", {
            slot,
            phase: "initial-evidence",
            component: "common-valuation",
            cause: e.code,
            rolledBack: true,
          });
        }
        return true;
      }
      // Both pre-maintenance states and valuations are committed before either portfolio closes.
      for (const v of variants) {
        const item = result.accounts.find((a) => a.scope.agentId === r.agentIds[v])!;
        views[v] = item.view;
        beforeMaintenance[v] = {
          positions: item.before.account.positions.filter((p) => p.closedAt === null),
          risk: paperRisk(item.view.account, item.view.attempts, result.financialAt),
          evidence: observation.frames.map((f) => ({
            symbol: f.snapshot.market.symbol,
            hash: f.hash,
            tickerAt: f.snapshot.ticker.provenance.providerTimestamp,
            bookAt: f.book.provenance.providerTimestamp,
          })),
          observedAt: result.financialAt,
          receiptAt: result.receiptAt,
          commonValuationVersion: 1,
          replayed: result.replayed,
        };
      }
      for (const v of variants) {
        await maintain(v, evidence, key);
        views[v] = await paper.view(target(r, v));
      }
    } else {
      for (const v of variants) {
        await guard();
        const before = await paper.view(target(r, v));
        views[v] = await measured(key, `valuation:${v}`, () =>
          paper.observe(target(r, v), key, observation),
        );
        beforeMaintenance[v] = {
          positions: before.account.positions.filter((p) => p.closedAt === null),
          risk: paperRisk(views[v]!.account, views[v]!.attempts, now()),
          evidence: observation.frames.map((f) => ({
            symbol: f.snapshot.market.symbol,
            hash: f.hash,
            tickerAt: f.snapshot.ticker.provenance.providerTimestamp,
            bookAt: f.book.provenance.providerTimestamp,
          })),
          observedAt: now(),
        };
        await maintain(v, evidence, key);
        views[v] = await paper.view(target(r, v));
      }
    }
    await study.event(scope, lease, key, "observation", {
      slot,
      beforeMaintenance,
      variants: Object.fromEntries(
        variants.map((v) => [
          v,
          {
            risk: paperRisk(views[v]!.account, views[v]!.attempts, now()),
            positions: views[v]!.account.positions.filter((p) => p.closedAt === null).length,
          },
        ]),
      ),
    });
    await deps.afterObservation?.({ key, at: now(), slot, beforeMaintenance });
    // Price valuation and mandatory closes always precede slower funding/candle preparation.
    if (config.version === 7 && data.reconcile) {
      const funding = await measured(key, "funding", () =>
        data.reconcile!(r, views, signal, guard),
      );
      if (useCommonObservation) {
        const result = await commonObservation(funding, `${key}:funding`);
        for (const v of variants) {
          views[v] = result.accounts.find((a) => a.scope.agentId === r.agentIds[v])!.view;
        }
      } else {
        for (const v of variants) {
          views[v] = await paper.observe(target(r, v), `${key}:funding`, funding);
        }
      }
    }
    if (closing) {
      await study.stopDecisions(scope, lease, r.decisionStopReason ?? "SESSION_END");
      if (
        variants.every(
          (v) =>
            views[v]!.account.positions.every((p) => p.closedAt !== null) &&
            !views[v]!.account.fundingPending &&
            !views[v]!.account.fundingDisputed,
        )
      ) {
        await study.complete(scope, lease);
        return false;
      }
      return true;
    }
    if (!admitted) {
      return true;
    }
    if (config.version === 7 && data.prepareEvidence) {
      try {
        evidence = await measured(key, "initial-evidence", () =>
          data.prepareEvidence!(r, signal, guard),
        );
        await measured(key, "frame-validation", async () => valid(evidence, r));
        if (useCommonObservation) {
          const result = await commonObservation(
            { frames: evidence.frames, funding: [], marksOnly: true },
            `${key}:initial-marks`,
          );
          for (const v of variants) {
            views[v] = result.accounts.find((a) => a.scope.agentId === r.agentIds[v])!.view;
          }
        } else {
          for (const v of variants) {
            await paper.observe(target(r, v), `${key}:initial-marks`, {
              frames: evidence.frames,
              funding: [],
              marksOnly: true,
            });
            await maintain(v, evidence, `${key}:initial`);
            views[v] = await paper.view(target(r, v));
          }
        }
      } catch (e) {
        signal.throwIfAborted();
        if (!transientPerpsData(e)) {
          throw e;
        }
        await study.event(scope, lease, `slot-${slot}:data-unavailable`, "data-unavailable", {
          slot,
          phase: "initial-evidence",
          cause: code(e),
        });
        return true;
      }
    }
    if (useCommonObservation && data.prepareEvidence) {
      // Financial maintenance failures after a committed valuation are never converted to omissions.
      for (const v of variants) {
        await maintain(v, evidence, `${key}:initial`);
        views[v] = await paper.view(target(r, v));
      }
    }
    const accounts = Object.fromEntries(variants.map((v) => [v, views[v]!.account]));
    for (const v of variants) {
      const expected =
        config.version === 7 || v.endsWith("-selective")
          ? "buffered-selective-1x-v1"
          : "legacy-1x-v1";
      if (
        config.version === 7 &&
        accounts[v]!.entryPolicy !== SMA_ENTRY_POLICIES[v as SmaReentryVariant]
      ) {
        throw new PilotError("CONFIG_CHANGED", "Account entry policy differs from frozen variant");
      }
      if (accounts[v]!.riskManagement !== expected) {
        throw new PilotError("CONFIG_CHANGED", "Account risk policy differs from frozen variant");
      }
    }
    const block = Object.values(accounts).some((a) =>
      a.positions.some(
        (p) =>
          p.closedAt === null &&
          !evidence.frames.some((f) => f.snapshot.market.symbol === p.symbol),
      ),
    );
    const proposals = Object.fromEntries(
      variants.map((v) => [
        v,
        (config.version === 7
          ? reentryGate(
              profileProposals({ evidence, account: accounts[v]! }, config, v, block),
              accounts[v]!,
              evidence,
              v as SmaReentryVariant,
            )
          : profileProposals({ evidence, account: accounts[v]! }, config, v, block)
        ).map((p) =>
          closed.has(`${v}:${p.symbol}`) && p.action.startsWith("open-")
            ? { ...p, action: "hold" as const, reason: "CLOSED_THIS_SLOT" }
            : p,
        ),
      ]),
    );
    const round = await study.reserve(scope, lease, slot, evidence, accounts, []);
    if (!round) {
      return true;
    }
    await study.finishRound(scope, lease, round.key, proposals);
    let financialWrites = false;
    try {
      const final = await measured(round.key, "final-evidence", () =>
        data.finalEvidence(r, signal, guard),
      );
      await measured(round.key, "final-frame-validation", async () => valid(final, r));
      evidence = final;
      await study.event(scope, lease, `${round.key}:final-evidence`, "execution-input", {
        evidence: final,
      });
      // Validate the entire common input before touching any portfolio.
      if (useCommonObservation) {
        await commonObservation(
          { frames: final.frames, funding: [], marksOnly: true },
          `${round.key}:final-marks`,
        );
        financialWrites = true;
      } else {
        financialWrites = true;
        for (const v of variants) {
          await guard();
          await paper.observe(target(r, v), `${round.key}:final-marks`, {
            frames: final.frames,
            funding: [],
            marksOnly: true,
          });
        }
      }
      for (const v of variants) {
        await maintain(v, final, `${round.key}:final`);
        const current = await paper.view(target(r, v));
        const missing = current.account.positions.some(
          (p) =>
            p.closedAt === null && !final.frames.some((f) => f.snapshot.market.symbol === p.symbol),
        );
        const refreshed = profileFinal(
          proposals[v]!,
          { evidence: final, account: current.account },
          config,
          v,
          missing,
        ).map((p) =>
          closed.has(`${v}:${p.symbol}`) && p.action.startsWith("open-")
            ? { ...p, action: "hold" as const, reason: "CLOSED_THIS_SLOT" }
            : p,
        );
        const finalProposals =
          config.version === 7
            ? reentryGate(refreshed, current.account, final, v as SmaReentryVariant)
            : refreshed;
        await study.event(scope, lease, `${round.key}:${v}:final-gate`, "final-gate", {
          strategy: v,
          initial: proposals[v],
          final: finalProposals,
        });
        for (const p of [
          ...finalProposals.filter((p) => p.action === "close"),
          ...finalProposals
            .filter((p) => p.action.startsWith("open-"))
            .sort((a, b) => (a as { rank?: number }).rank! - (b as { rank?: number }).rank!),
        ]) {
          await trade(v, p, final.frames, `${round.key}:${p.symbol}`);
        }
      }
      await study.finishExecution(scope, lease, round.key, "complete");
    } catch (e) {
      signal.throwIfAborted();
      if (!financialWrites && transientPerpsData(e)) {
        await study.event(scope, lease, `slot-${slot}:data-unavailable`, "data-unavailable", {
          slot,
          phase: "final-refresh",
          cause: code(e),
        });
        await study.finishExecution(scope, lease, round.key, "skipped_data_unavailable");
      } else {
        throw e;
      }
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
        monotonic,
        ...(deps.leaseDiagnostic ? { diagnostic: deps.leaseDiagnostic } : {}),
      });
      lease.assertActive = heartbeat.assertActive;
      const owned = AbortSignal.any([signal, heartbeat.signal]);
      paper = deps.paperForLease?.(scope, lease, owned) ?? deps.paper;
      let interruption: string | undefined;
      try {
        for (;;) {
          const cycleMinute = Math.floor(now() / 60000);
          const continuing = await cycle(scope, lease, owned);
          await deps.afterCycle?.();
          if (!continuing) {
            break;
          }
          // A slow acquisition can finish inside the next minute's still-open slot. Start its
          // observation/admission now; PostgreSQL still rejects expired or already-claimed slots.
          const delay = nextPriceCycleDelay(now(), cycleMinute);
          const scheduled = now() + delay;
          const waiting = monotonic();
          await sleep(delay, owned);
          deps.timing?.({
            version: 1,
            cycle: `minute-${Math.floor(now() / 60000)}`,
            operation: "scheduler-wait",
            at: now(),
            durationMs: monotonic() - waiting,
            timerDelayMs: Math.max(0, now() - scheduled),
          });
        }
      } catch (e) {
        interruption = code(e);
        throw e;
      } finally {
        await heartbeat.stop();
        await study.release(scope, lease, interruption).catch(() =>
          deps.leaseDiagnostic?.({
            kind: "release-failed",
            at: now(),
            durationMs: 0,
            timerDelayMs: 0,
            lastSuccessAt: null,
            expiresAt: lease.expiresAt,
            code: "LEASE_RELEASE_FAILED",
          }),
        );
      }
    },
  };
}
