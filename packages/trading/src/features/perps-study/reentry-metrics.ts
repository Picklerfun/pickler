import type {
  PerpsStudyView,
  PerpsStudyMap,
  SmaReentryVariant,
  PerpsEvidence,
  PerpsProposal,
} from "./types.js";
import { SMA_REENTRY_VARIANTS } from "./types.js";
import type { PerpsPaperView } from "../perps-paper/types.js";
import { paperDecimal, paperUnits } from "../perps-paper/decimal.js";

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

/** Inspect actual reference fills matching a blocked key, never an unexecuted counterfactual. */
export function reentryEconomics(study: PerpsStudyView, accounts: PerpsStudyMap<PerpsPaperView>) {
  const reference = accounts["sma-reference"];
  const complete = study.rounds.filter(
    (round) => round.status === "completed" && round.executionStatus === "complete",
  );
  const rows = complete.flatMap((round) => {
    const final = (
      study.events.find((event) => event.key === `${round.key}:final-evidence`)?.data as
        { evidence?: PerpsEvidence } | undefined
    )?.evidence;
    if (!final) {
      return [];
    }
    const excluded = new Set(
      [...(round.evidence.excluded ?? []), ...(final.excluded ?? [])].map((entry) => entry.symbol),
    );
    const proposals = (
      study.events.find((event) => event.key === `${round.key}:sma-once-bar:final-gate`)?.data as
        { final?: (PerpsProposal & { entryKey?: string })[] } | undefined
    )?.final;
    return (proposals ?? [])
      .filter(
        (proposal) =>
          proposal.reason === "HOURLY_ENTRY_ALREADY_CONSUMED" &&
          !excluded.has(proposal.symbol) &&
          round.evidence.frames.some((f) => f.snapshot.market.symbol === proposal.symbol) &&
          final.frames.some((f) => f.snapshot.market.symbol === proposal.symbol),
      )
      .map((proposal) => {
        const key = proposal.entryKey;
        const openings = reference?.attempts.filter((attempt) => {
          const intent = attempt.intent;
          return (
            attempt.status === "filled" &&
            intent.kind === "open" &&
            intent.symbol === proposal.symbol &&
            intent.entryEvidence?.roundKey === round.key &&
            `${intent.symbol}:${intent.side}:3600:${intent.entryEvidence.candleOpenTime}` === key
          );
        });
        const opening = openings?.length === 1 ? openings[0] : undefined;
        const positions = reference?.account.positions.filter((p) => p.id === opening?.key);
        const position = positions?.length === 1 ? positions[0] : undefined;
        const closes = position
          ? reference?.attempts.filter(
              (attempt) =>
                attempt.status === "filled" &&
                attempt.intent.kind === "close" &&
                attempt.intent.symbol === position.symbol &&
                attempt.intent.side === position.side &&
                attempt.finishedAt === position.closedAt,
            )
          : undefined;
        const close = closes?.length === 1 ? closes[0] : undefined;
        const posting = (postingKey: string | undefined, kind: "fee" | "realized-pnl") => {
          const values = reference?.movements.filter(
            (movement) => movement.key === postingKey && movement.kind === kind,
          );
          return values?.length === 1 ? values[0] : undefined;
        };
        const entryFee = posting(opening ? `${opening.key}:fee` : undefined, "fee");
        const exitFee = posting(close ? `${close.key}:fee` : undefined, "fee");
        const gross = posting(close ? `${close.key}:pnl` : undefined, "realized-pnl");
        const funding = (reference?.movements ?? []).filter(
          (movement) =>
            movement.kind === "funding" &&
            (movement.evidence as { positionId?: string } | null)?.positionId === position?.id,
        );
        const fundingVerified =
          !!reference &&
          !reference.account.fundingPending &&
          !reference.account.fundingDisputed &&
          new Set(funding.map((movement) => movement.key)).size === funding.length;
        const verifiable = !!entryFee && !!exitFee && !!gross && fundingVerified;
        const feeCost =
          entryFee && exitFee ? -(paperUnits(entryFee.delta) + paperUnits(exitFee.delta)) : null;
        const fundingUnits = fundingVerified
          ? funding.reduce((sum, movement) => sum + paperUnits(movement.delta), 0n)
          : null;
        const net =
          verifiable && feeCost !== null && fundingUnits !== null
            ? paperUnits(gross.delta) - feeCost + fundingUnits
            : null;
        let outcome = "NOT_VERIFIABLE";
        if (key && reference && openings?.length === 0) {
          outcome = "NO_MATCHING_REFERENCE_OPEN";
        } else if (position?.closedAt === null) {
          outcome = "PENDING_REFERENCE_POSITION";
        } else if (net !== null) {
          if (net > 0n) {
            outcome = "REFERENCE_NET_WIN";
          } else if (net < 0n) {
            outcome = "REFERENCE_NET_LOSS";
          } else {
            outcome = "REFERENCE_NET_FLAT";
          }
        }
        return {
          slot: round.slot,
          symbol: proposal.symbol,
          entryKey: key ?? null,
          outcome,
          referenceOpeningKey: opening?.key ?? null,
          referencePositionId: position?.id ?? null,
          referenceClosingKey: close?.key ?? null,
          grossRealizedAUSD: gross?.delta ?? null,
          feeCostAUSD: feeCost !== null ? paperDecimal(feeCost) : null,
          fundingAUSD: fundingUnits !== null && position ? paperDecimal(fundingUnits) : null,
          netRealizedAUSD: net !== null ? paperDecimal(net) : null,
          fundingVerified,
        };
      });
  });
  return {
    version: 1,
    comparableBlockedKeys: rows.length,
    referenceWinningPositions: rows.filter((row) => row.outcome === "REFERENCE_NET_WIN").length,
    referenceLosingPositions: rows.filter((row) => row.outcome === "REFERENCE_NET_LOSS").length,
    referenceFlatPositions: rows.filter((row) => row.outcome === "REFERENCE_NET_FLAT").length,
    pendingPositions: rows.filter((row) => row.outcome === "PENDING_REFERENCE_POSITION").length,
    unverifiable: rows.filter((row) => row.outcome === "NOT_VERIFIABLE").length,
    rows,
    interpretation:
      "Matched confirmed reference positions and their ledger postings only. Portfolio fee differences are observed costs, not causal per-slot savings. No P&L is assigned to the unexecuted once-bar proposal.",
  };
}
