import type { PerpsStudyView, PerpsStudyMap, SmaReentryVariant } from "./types.js";
import { SMA_REENTRY_VARIANTS } from "./types.js";
import type { PerpsPaperView } from "../perps-paper/types.js";

type Valuation = {
  positions: { id: string; symbol: string; markAt: number | null }[];
  risk: { equity: string | null };
  observedAt: number;
  evidence: { symbol: string; tickerAt: number | null; bookAt: number | null }[];
};
/** Coverage uses pre-maintenance positions; closing a position cannot erase a missing mark. */
export function reentryCoverage(study: PerpsStudyView, accounts: PerpsStudyMap<PerpsPaperView>) {
  const complete = study.rounds.filter(
    (r) => r.status === "completed" && r.executionStatus === "complete",
  );
  const final = (key: string) =>
    (
      study.events.find((e) => e.key === `${key}:final-evidence`)?.data as
        | {
            evidence?: {
              frames: { snapshot: { market: { symbol: string } } }[];
              excluded?: { symbol: string }[];
            };
          }
        | undefined
    )?.evidence;
  const common = complete.reduce((total, round) => {
    const last = final(round.key);
    if (!last) {
      return total;
    }
    const excluded = new Set(
      [...(round.evidence.excluded ?? []), ...(last.excluded ?? [])].map((e) => e.symbol),
    );
    return (
      total +
      round.evidence.frames.filter(
        (f) =>
          !excluded.has(f.snapshot.market.symbol) &&
          last.frames.some((x) => x.snapshot.market.symbol === f.snapshot.market.symbol),
      ).length
    );
  }, 0);
  const start = study.record.startedAt ?? Infinity;
  const end = study.record.endsAt ?? -Infinity;
  const observations = study.events.filter(
    (e) => e.kind === "observation" && e.at >= start && e.at < end,
  );
  const unique = new Map(observations.map((e) => [Number(/^observe-(\d+)/.exec(e.key)?.[1]), e]));
  let valued = 0,
    exposed = 0,
    valuedExposed = 0,
    maximumUnvaluedExposureMs = 0;
  const lastValued = new Map<string, number>();
  const valuedMinutes = new Set<number>();
  for (const e of [...unique.values()].sort((a, b) => a.at - b.at)) {
    const before = (e.data as { beforeMaintenance?: Partial<Record<SmaReentryVariant, Valuation>> })
      .beforeMaintenance;
    let allValued = !!before;
    let hasExposure = false;
    for (const v of SMA_REENTRY_VARIANTS) {
      const state = before?.[v];
      const active = state?.positions ?? [];
      hasExposure ||= active.length > 0;
      allValued &&= !!state && state.risk.equity !== null;
      for (const position of active) {
        const id = `${v}:${position.id}`;
        const frame = state?.evidence?.find((f) => f.symbol === position.symbol);
        const fresh =
          !!state &&
          !!frame &&
          [frame.tickerAt, frame.bookAt].every(
            (at) => at !== null && state.observedAt - at <= 30000 && at - state.observedAt <= 5000,
          );
        allValued &&= fresh;
        const valuationAt = fresh && state?.risk.equity !== null ? state?.observedAt : undefined;
        const previous = lastValued.get(id);
        if (previous !== undefined) {
          maximumUnvaluedExposureMs = Math.max(
            maximumUnvaluedExposureMs,
            (valuationAt ?? e.at) - previous,
          );
        } else {
          const stored = accounts[v]?.account.positions.find((p) => p.id === position.id);
          if (stored) {
            maximumUnvaluedExposureMs = Math.max(
              maximumUnvaluedExposureMs,
              (valuationAt ?? e.at) - stored.openedAt,
            );
          }
        }
        if (valuationAt !== undefined) {
          lastValued.set(id, valuationAt);
        }
      }
    }
    if (allValued) {
      valued++;
      valuedMinutes.add(Math.floor(e.at / 60000));
    }
    if (hasExposure) {
      exposed++;
      if (allValued) {
        valuedExposed++;
      }
    }
  }
  for (const v of SMA_REENTRY_VARIANTS) {
    for (const p of accounts[v]?.account.positions ?? []) {
      const last = lastValued.get(`${v}:${p.id}`) ?? p.openedAt;
      maximumUnvaluedExposureMs = Math.max(
        maximumUnvaluedExposureMs,
        Math.max(0, Math.min(p.closedAt ?? end, end) - last),
      );
    }
  }
  // Include missing minutes while positions existed, including gaps with no event at all.
  const heldMinutes = new Set<number>();
  for (const v of SMA_REENTRY_VARIANTS) {
    for (const p of accounts[v]?.account.positions ?? []) {
      for (let minute = Math.floor(start / 60000); minute * 60000 < end; minute++) {
        if (p.openedAt < minute * 60000 && (p.closedAt ?? end) >= minute * 60000) {
          heldMinutes.add(minute);
        }
      }
    }
  }
  const coveragePercent = heldMinutes.size
    ? (100 * [...heldMinutes].filter((m) => valuedMinutes.has(m)).length) / heldMinutes.size
    : null;
  const detected = study.events.filter((e) => e.kind === "exit-detected");
  const exits = detected.map((e) => {
    const d = e.data as { variant: string; positionId: string; symbol: string; reason: string };
    const execution = study.events.find((x) => x.key === e.key.replace(/:exit-detected$/, ""));
    return { ...d, detectedAt: e.at, execution: execution?.data ?? null, verified: !!execution };
  });
  const ownershipFailures = study.events.filter((e) =>
    /LEASE_LOST|OWNERSHIP|PROCESS_INTERRUPTED/.test(JSON.stringify(e.data)),
  );
  const blockedReentries = study.events
    .filter((e) => e.kind === "final-gate")
    .reduce((n, e) => {
      const proposals = (e.data as { final?: { reason: string }[] }).final ?? [];
      return n + proposals.filter((p) => p.reason === "HOURLY_ENTRY_ALREADY_CONSUMED").length;
    }, 0);
  const passed =
    complete.length >= 69 &&
    common >= 753 &&
    valued >= 342 &&
    (coveragePercent === null || coveragePercent >= 95) &&
    maximumUnvaluedExposureMs <= 120000 &&
    ownershipFailures.length === 0 &&
    exits.every((e) => e.verified);
  return {
    version: 1,
    completeRounds: complete.length,
    requiredRounds: 69,
    commonAssetSlots: common,
    requiredAssetSlots: 753,
    recordedObservations: unique.size,
    valuedObservations: valued,
    requiredObservations: 342,
    exposedObservations: exposed,
    valuedExposedObservations: valuedExposed,
    heldMinutes: heldMinutes.size,
    valuedHeldMinutePercent: coveragePercent,
    maximumUnvaluedExposureMs,
    ownershipFailures: ownershipFailures.length,
    exits,
    operationallyValid: passed,
    blockedReentries,
    economicInterpretation: !passed
      ? "LIMITED_OPERATIONAL_COVERAGE"
      : blockedReentries === 0
        ? "INCONCLUSIVE_NO_BLOCKED_REENTRIES"
        : "EXPLORATORY",
    latencyAttribution:
      "Both portfolios use the improved executor; their P&L cannot measure latency effects.",
  };
}
