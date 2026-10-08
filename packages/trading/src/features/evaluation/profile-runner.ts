import { PilotError } from "@pickler/core";
import { perpsSlotClock } from "../perps-study/policy.js";
import { profileProposals, profileFinal, profileSignal } from "../perps-study/profiles.js";
import {
  SMA_PROFILE_VARIANTS,
  type SmaProfileVariant,
  type PerpsStudyRepository,
  type PerpsStudyScope,
  type PerpsStudyLease,
  type PerpsStudyRecord,
  type PerpsEvidence,
  type PerpsProposal,
  type PerpsStudyMap,
} from "../perps-study/types.js";
import { startLeaseHeartbeat, type LeaseDiagnostic } from "./lease-heartbeat.js";
import {
  createPerpsPaperService,
  paperRisk,
  selectiveReduction,
  transientPerpsData,
  validatePaperFrame,
  type PerpsPaperRepository,
  type PerpsPaperFrame,
  type PerpsPaperView,
} from "../../perps.js";
import type { StudyData } from "./perps-runner.js";
export interface ProfileStudyData extends StudyData {
  finalEvidence(
    record: PerpsStudyRecord,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<PerpsEvidence>;
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
  now?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  leaseDiagnostic?: (e: LeaseDiagnostic) => void;
}) {
  const now = deps.now ?? Date.now;
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
  const target = (r: PerpsStudyRecord, v: SmaProfileVariant) => ({
    ...r.config,
    agentId: r.agentIds[v]!,
  });
  function valid(e: PerpsEvidence, r: PerpsStudyRecord) {
    if (r.config.version !== 6) {
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
      validatePaperFrame(frame, r.config.network, frame.snapshot.market.symbol, now());
    }
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
    if (r.config.version !== 6) {
      throw new PilotError("INVALID_INPUT", "Profile protocol required");
    }
    const config = r.config;
    if (
      Object.keys(r.agentIds).length !== 4 ||
      SMA_PROFILE_VARIANTS.some((v) => !r.agentIds[v] || r.agentVersions[v] !== 1)
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
      for (const v of SMA_PROFILE_VARIANTS) {
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
      observation = await data.observe(r, signal, guard);
      evidence = await data.evidence(r, observation, signal, guard);
      valid(evidence, r);
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
        .filter(
          (e) =>
            e.kind === "profile-execution" &&
            (e.data as { slot?: number }).slot === slot &&
            (e.data as { action?: string }).action === "close" &&
            (e.data as { status?: string }).status === "filled",
        )
        .map(
          (e) =>
            `${(e.data as { variant: string }).variant}:${(e.data as { symbol: string }).symbol}`,
        ),
    );
    const processedCloses = new Set<string>();
    async function trade(
      v: SmaProfileVariant,
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
        return;
      }
      if (isClose) {
        if (processedCloses.has(`${v}:${p.symbol}`)) {
          return;
        }
        processedCloses.add(`${v}:${p.symbol}`);
      }
      const before = paperRisk(current.account, current.attempts, now());
      let failure: string | null = null;
      try {
        await simulator.trade(
          target(r, v),
          attemptKey,
          isClose ? "close" : "open",
          p.symbol,
          isClose ? position!.side : p.action === "open-long" ? "long" : "short",
          signal,
          frame,
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
          ].includes(e.code)
        ) {
          throw e;
        }
        failure = e.code;
      }
      const after = await paper.view(target(r, v));
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
    async function maintain(v: SmaProfileVariant, captured: PerpsEvidence, phaseKey: string) {
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
    const views: PerpsStudyMap<PerpsPaperView> = {};
    for (const v of SMA_PROFILE_VARIANTS) {
      await guard();
      views[v] = await paper.observe(target(r, v), key, observation);
      await maintain(v, evidence, key);
      views[v] = await paper.view(target(r, v));
    }
    await study.event(scope, lease, key, "observation", {
      slot,
      variants: Object.fromEntries(
        SMA_PROFILE_VARIANTS.map((v) => [
          v,
          {
            risk: paperRisk(views[v]!.account, views[v]!.attempts, now()),
            positions: views[v]!.account.positions.filter((p) => p.closedAt === null).length,
          },
        ]),
      ),
    });
    if (closing) {
      await study.stopDecisions(scope, lease, r.decisionStopReason ?? "SESSION_END");
      if (
        SMA_PROFILE_VARIANTS.every(
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
    const accounts = Object.fromEntries(SMA_PROFILE_VARIANTS.map((v) => [v, views[v]!.account]));
    for (const v of SMA_PROFILE_VARIANTS) {
      const expected = v.endsWith("-selective") ? "buffered-selective-1x-v1" : "legacy-1x-v1";
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
      SMA_PROFILE_VARIANTS.map((v) => [
        v,
        profileProposals({ evidence, account: accounts[v]! }, config, v, block).map((p) =>
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
      const final = await data.finalEvidence(r, signal, guard);
      valid(final, r);
      await study.event(scope, lease, `${round.key}:final-evidence`, "execution-input", {
        evidence: final,
      });
      // Validate the entire common input before touching any portfolio.
      financialWrites = true;
      for (const v of SMA_PROFILE_VARIANTS) {
        await guard();
        await paper.observe(target(r, v), `${round.key}:final-marks`, {
          frames: final.frames,
          funding: [],
          marksOnly: true,
        });
      }
      for (const v of SMA_PROFILE_VARIANTS) {
        await maintain(v, final, `${round.key}:final`);
        const current = await paper.view(target(r, v));
        const missing = current.account.positions.some(
          (p) =>
            p.closedAt === null && !final.frames.some((f) => f.snapshot.market.symbol === p.symbol),
        );
        const finalProposals = profileFinal(
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
          const delay =
            Math.floor(now() / 60000) > cycleMinute
              ? 1
              : Math.max(1, 60000 - (now() % 60000) + 100);
          await sleep(delay, owned);
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
