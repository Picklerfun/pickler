import { PilotError } from "@pickler/core";
import { paperDecimal, paperUnits } from "../perps-paper/decimal.js";
import type { PerpsPaperMovement, PerpsPaperSide } from "../perps-paper/types.js";
import { BREAKOUT_MARKETS, breakoutWindowTimes, canonicalBreakoutJson } from "./policy.js";
import type { BreakoutFinancialRole } from "./types.js";

export const BREAKOUT_FIXED_POPULATIONS = {
  admissionDays: 28,
  candidateHourlyClocks: 672,
  candidateMarketHours: 7392,
  smaFiveMinuteClocks: 8064,
  smaMarketFiveMinuteCells: 88704,
  scheduledMinutes: 40320,
  staticMarketMinuteCells: 443520,
  graceMinutes: 240,
  graceMarketMinuteCells: 2640,
} as const;

const WEEK_MS = 7 * 86_400_000;
const MICRO_SCALE = 1_000_000_000_000n;
const invalid = (message: string): never => {
  throw new PilotError("INVALID_INPUT", message);
};
function nativeMicros(amount: string): bigint {
  const value = paperUnits(amount);
  if (value % MICRO_SCALE !== 0n) {
    return invalid("Native cash posting must have exact micro-AUSD precision");
  }
  return value / MICRO_SCALE;
}
const cash = (micros: bigint) => paperDecimal(micros * MICRO_SCALE);
const pct95 = (valid: number, total: number) => valid * 100 >= total * 95;

export type BreakoutAvailabilityPopulation =
  "C_SIGNAL" | "S_SIGNAL" | "C_INITIAL" | "S_INITIAL" | "L_INITIAL" | "MARKET_MINUTE";
export interface BreakoutAvailabilityCell {
  population: BreakoutAvailabilityPopulation;
  marketId: number;
  scheduledAt: number;
  valid: boolean;
  status: string;
}
export interface BreakoutClockCell {
  population: "C_CLAIM" | "S_CLAIM" | "MINUTE";
  scheduledAt: number;
  valid: boolean;
  status: string;
}

/** Rows that were never observed remain in all fixed denominators, including after policy stop. */
export function breakoutAvailability(
  T0: number,
  cells: readonly BreakoutAvailabilityCell[],
  clocks: readonly BreakoutClockCell[] = [],
) {
  const { TA } = breakoutWindowTimes(T0);
  const definitions = {
    C_SIGNAL: { step: 3_600_000, total: 7392, group: 168 },
    S_SIGNAL: { step: 300_000, total: 88704, group: 2016 },
    C_INITIAL: { step: 3_600_000, total: 7392, group: 168 },
    S_INITIAL: { step: 300_000, total: 88704, group: 2016 },
    L_INITIAL: { step: 3_600_000, total: 7392, group: 168 },
    MARKET_MINUTE: { step: 60_000, total: 443520, group: 10080 },
  } as const;
  const original = new Map<string, BreakoutAvailabilityCell>();
  const conflicts: string[] = [];
  for (const row of cells) {
    const definition = definitions[row.population];
    if (
      !definition ||
      !BREAKOUT_MARKETS.some((m) => m.marketId === row.marketId) ||
      row.scheduledAt < T0 ||
      row.scheduledAt >= TA ||
      (row.scheduledAt - T0) % definition.step !== 0
    ) {
      return invalid("Availability row outside the frozen population");
    }
    const key = `${row.population}:${row.marketId}:${row.scheduledAt}`;
    const old = original.get(key);
    if (old && canonicalBreakoutJson(old) !== canonicalBreakoutJson(row)) {
      conflicts.push(key);
      original.set(key, { ...old, valid: false, status: "CONFLICTING_ORIGINAL_CELL" });
    } else {
      original.set(key, old ?? row);
    }
  }
  const populations = Object.entries(definitions).map(([population, definition]) => {
    const rows = [...original.values()].filter((c) => c.population === population);
    const valid = rows.filter((r) => r.valid).length;
    const groups = BREAKOUT_MARKETS.flatMap((market) =>
      Array.from({ length: 4 }, (_, week) => {
        const group = rows.filter(
          (r) =>
            r.marketId === market.marketId && Math.floor((r.scheduledAt - T0) / WEEK_MS) === week,
        );
        const valid = group.filter((r) => r.valid).length;
        return {
          marketId: market.marketId,
          week: week + 1,
          valid,
          planned: definition.group,
          recorded: group.length,
          missing: definition.group - group.length,
          passes95: pct95(valid, definition.group),
        };
      }),
    );
    return {
      population,
      valid,
      planned: definition.total,
      recorded: rows.length,
      missing: definition.total - rows.length,
      passes95: pct95(valid, definition.total) && groups.every((g) => g.passes95),
      groups,
    };
  });
  const clockDefinitions = {
    C_CLAIM: { step: 3_600_000, total: 672 },
    S_CLAIM: { step: 300_000, total: 8064 },
    MINUTE: { step: 60_000, total: 40320 },
  } as const;
  const clockRows = new Map<string, BreakoutClockCell>();
  for (const row of clocks) {
    const d = clockDefinitions[row.population];
    if (
      !d ||
      row.scheduledAt < T0 ||
      row.scheduledAt >= TA ||
      (row.scheduledAt - T0) % d.step !== 0
    ) {
      return invalid("Clock row outside original frozen grid");
    }
    const key = `${row.population}:${row.scheduledAt}`;
    const old = clockRows.get(key);
    if (old && canonicalBreakoutJson(old) !== canonicalBreakoutJson(row)) {
      clockRows.set(key, { ...old, valid: false, status: "CONFLICTING_ORIGINAL_CLOCK" });
      conflicts.push(key);
    } else {
      clockRows.set(key, old ?? row);
    }
  }
  const clockCounts = Object.entries(clockDefinitions).map(([population, d]) => {
    const rows = [...clockRows.values()].filter((r) => r.population === population);
    const valid = rows.filter((r) => r.valid).length;
    return {
      population,
      planned: d.total,
      recorded: rows.length,
      valid,
      missing: d.total - rows.length,
      passes95: population === "MINUTE" ? pct95(valid, d.total) : null,
    };
  });
  return {
    populations,
    clocks: clockCounts,
    conflicts,
    passes95:
      conflicts.length === 0 &&
      populations.every((p) => p.passes95) &&
      clockCounts.filter((c) => c.population === "MINUTE").every((c) => c.passes95),
    interpretation:
      "Fixed availability populations; risk/capacity/policy stops do not remove cells. Claims are reported separately. Exposed supervision has its independent 100% veto.",
  };
}

export interface BreakoutActionObligation {
  protocolDigest: string;
  role: BreakoutFinancialRole;
  marketId: number;
  originalOperationId: string;
  action: "OPEN" | "FULL_CLOSE";
  actionObligationId: string;
  scheduledAt: number;
  evidenceStatus: "VALID" | "INVALID" | "UNPERFORMED" | "UNKNOWN";
  financialStatus: "CONFIRMED" | "REJECTED" | "ROLLED_BACK" | "UNKNOWN" | "UNATTEMPTED";
}
export function breakoutActionObligationKey(row: BreakoutActionObligation): string {
  return canonicalBreakoutJson([
    row.protocolDigest,
    row.role,
    row.marketId,
    row.originalOperationId,
    row.action,
    row.actionObligationId,
  ]);
}

/** The 95% floor is pooled across disjoint C/S/L obligations, never an invented per-arm floor. */
export function breakoutRequiredFinals(T0: number, rows: readonly BreakoutActionObligation[]) {
  const { TA, TV } = breakoutWindowTimes(T0);
  const original = new Map<string, BreakoutActionObligation>();
  const conflicts: string[] = [];
  for (const row of rows) {
    if (
      !/^[a-f0-9]{64}$/.test(row.protocolDigest) ||
      !["C", "S", "L"].includes(row.role) ||
      !BREAKOUT_MARKETS.some((m) => m.marketId === row.marketId) ||
      row.scheduledAt < T0 ||
      row.scheduledAt > TV ||
      !row.originalOperationId ||
      !row.actionObligationId
    ) {
      return invalid("Original account-specific final obligation required");
    }
    const key = breakoutActionObligationKey(row);
    const old = original.get(key);
    if (old && (old.scheduledAt !== row.scheduledAt || old.evidenceStatus !== row.evidenceStatus)) {
      original.set(key, { ...old, evidenceStatus: "INVALID" });
      conflicts.push(key);
    } else {
      original.set(key, old ?? row);
    }
  }
  const unique = [...original.values()];
  const count = (members: readonly BreakoutActionObligation[]) => {
    const total = members.length;
    const validQ = members.filter((r) => r.evidenceStatus === "VALID").length;
    return {
      total,
      validQ,
      failedQ: total - validQ,
      status:
        total === 0 ? "NOT_REQUIRED" : pct95(validQ, total) ? "PASS_POOLED_95" : "FAIL_POOLED_95",
    };
  };
  const groups = BREAKOUT_MARKETS.flatMap((market) =>
    Array.from({ length: 4 }, (_, week) => ({
      marketId: market.marketId,
      week: week + 1,
      ...count(
        unique.filter(
          (r) =>
            r.marketId === market.marketId &&
            r.scheduledAt < TA &&
            Math.floor((r.scheduledAt - T0) / WEEK_MS) === week,
        ),
      ),
    })),
  );
  const arms = (["C", "S", "L"] as const).map((role) => {
    const c = count(unique.filter((r) => r.role === role));
    return {
      role,
      total: c.total,
      validQ: c.validQ,
      failedQ: c.failedQ,
      status: c.total === 0 ? "NOT_REQUIRED" : "COUNTS_ONLY_NO_PER_ARM_FLOOR",
    };
  });
  const pooled = count(unique);
  return {
    pooled,
    arms,
    groups,
    grace: count(unique.filter((r) => r.scheduledAt >= TA)),
    conflicts,
    originalMembers: unique,
    passes95:
      conflicts.length === 0 &&
      pooled.status !== "FAIL_POOLED_95" &&
      groups.every((g) => g.status !== "FAIL_POOLED_95"),
    interpretation:
      "One original account/action obligation; coincident reasons and duplicate delivery count once. Grace remains in the overall pool and outside admission-week floors.",
  };
}

export function breakoutUniqueFinalSources(
  rows: readonly {
    sourceOperationId: string;
    marketId: number;
    frameIdentity: string | null;
    valid: boolean;
  }[],
) {
  const unique = new Map<string, { valid: boolean; frameIdentity: string | null }>();
  for (const row of rows) {
    const key = `${row.sourceOperationId}:${row.marketId}`;
    const old = unique.get(key);
    const valid =
      row.valid &&
      row.frameIdentity !== null &&
      (!old || (old.frameIdentity === row.frameIdentity && old.valid));
    unique.set(key, { valid, frameIdentity: old?.frameIdentity ?? row.frameIdentity });
  }
  return {
    unit: "UNIQUE_SOURCE_OPERATION_MARKET_FRAMES",
    total: unique.size,
    valid: [...unique.values()].filter((r) => r.valid).length,
    failed: [...unique.values()].filter((r) => !r.valid).length,
    floor: "NO_95_PERCENT_FLOOR_SEPARATE_FROM_Q",
  };
}

export function breakoutGraceAvailability(
  T0: number,
  rows: readonly {
    scheduledAt: number;
    marketId: number | null;
    status: "QUALIFIED" | "AUTHORITATIVELY_FLAT_NOT_REQUIRED" | "UNAVAILABLE";
    authoritativeFlatRecordId?: string;
  }[],
) {
  const { TA, TV } = breakoutWindowTimes(T0);
  const original = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (
      row.scheduledAt < TA ||
      row.scheduledAt >= TV ||
      (row.scheduledAt - TA) % 60_000 !== 0 ||
      (row.marketId !== null && !BREAKOUT_MARKETS.some((m) => m.marketId === row.marketId)) ||
      (row.status === "AUTHORITATIVELY_FLAT_NOT_REQUIRED" && !row.authoritativeFlatRecordId)
    ) {
      return invalid("Original grace minute or authoritative flat proof required");
    }
    const key = `${row.scheduledAt}:${row.marketId}`;
    const old = original.get(key);
    if (old && canonicalBreakoutJson(old) !== canonicalBreakoutJson(row)) {
      original.set(key, { ...old, status: "UNAVAILABLE" });
    } else {
      original.set(key, old ?? row);
    }
  }
  const count = (market: boolean, planned: number) => {
    const members = [...original.values()].filter((r) =>
      market ? r.marketId !== null : r.marketId === null,
    );
    return {
      planned,
      recorded: members.length,
      qualified: members.filter((r) => r.status === "QUALIFIED").length,
      notRequired: members.filter((r) => r.status === "AUTHORITATIVELY_FLAT_NOT_REQUIRED").length,
      unavailable: members.filter((r) => r.status === "UNAVAILABLE").length,
      missing: planned - members.length,
    };
  };
  return { cycles: count(false, 240), marketMinutes: count(true, 2640) };
}

export interface BreakoutFinancialPosition {
  id: string;
  episodeKey: string;
  marketId: number;
  side: PerpsPaperSide;
  openedAt: number;
  closedAt: number | null;
  /** Authoritative position/attempt links to the actual native postings, not display-price algebra. */
  movementKeys: readonly string[];
  openingActionObligationId?: string;
  closingActionObligationId?: string;
}
export interface BreakoutArmFinancialEvidence {
  role: BreakoutFinancialRole;
  positions: readonly BreakoutFinancialPosition[];
  movements: readonly PerpsPaperMovement[];
  nativeCashAtTF: string | null;
  unknownEffects: boolean;
  authoritativelyFlatByTV: boolean;
  heldFundingCompleteAtTF: boolean;
  provenanceComplete: boolean;
  ledgerReconciled: boolean;
  riskStatus: "NO_EMERGENCY_VERIFIED" | "EMERGENCY_VERIFIED" | "UNVERIFIABLE";
}

export function breakoutArmEconomics(T0: number, arm: BreakoutArmFinancialEvidence) {
  const { TA, TV, TF } = breakoutWindowTimes(T0);
  const uniqueMovements = new Set(arm.movements.map((m) => m.key));
  const uniquePositions = new Set(arm.positions.map((p) => p.id));
  const cashPostings = arm.movements.filter((m) => m.kind !== "initial");
  const complete =
    !arm.unknownEffects &&
    arm.authoritativelyFlatByTV &&
    arm.heldFundingCompleteAtTF &&
    arm.provenanceComplete &&
    arm.ledgerReconciled &&
    arm.nativeCashAtTF !== null &&
    uniqueMovements.size === arm.movements.length &&
    uniquePositions.size === arm.positions.length &&
    arm.positions.every(
      (p) => p.openedAt >= T0 && p.openedAt < TA && p.closedAt !== null && p.closedAt <= TV,
    ) &&
    cashPostings.every((m) => m.at >= T0 && m.at <= TF);
  const gross = cashPostings
    .filter((m) => m.kind === "realized-pnl")
    .reduce((s, m) => s + nativeMicros(m.delta), 0n);
  const fees = cashPostings
    .filter((m) => m.kind === "fee")
    .reduce((s, m) => s + nativeMicros(m.delta), 0n);
  const funding = cashPostings
    .filter((m) => m.kind === "funding")
    .reduce((s, m) => s + nativeMicros(m.delta), 0n);
  const posted = gross + fees + funding;
  const reconciledCash =
    arm.nativeCashAtTF !== null && nativeMicros(arm.nativeCashAtTF) - 1_000_000_000n === posted;
  const net = complete && reconciledCash ? posted : null;
  const postings = new Map(cashPostings.map((m) => [m.key, m]));
  const assigned = new Set<string>();
  let allocatable = true;
  const contributions = arm.positions.map((position) => {
    let contribution = 0n;
    for (const key of position.movementKeys) {
      const movement = postings.get(key);
      if (!movement || assigned.has(key)) {
        allocatable = false;
        continue;
      }
      assigned.add(key);
      contribution += nativeMicros(movement.delta);
    }
    return { ...position, contributionMicros: contribution };
  });
  const residual = posted - contributions.reduce((sum, p) => sum + p.contributionMicros, 0n);
  allocatable &&= assigned.size === postings.size && residual === 0n;
  const bySide = (["long", "short"] as const).map((side) => ({
    side,
    positions: contributions.filter((p) => p.side === side).length,
    netAUSD:
      net !== null && allocatable
        ? cash(
            contributions
              .filter((p) => p.side === side)
              .reduce((sum, p) => sum + p.contributionMicros, 0n),
          )
        : null,
  }));
  const partitions = {
    weeks: Array.from({ length: 4 }, (_, week) => ({
      group: week + 1,
      contributionMicros: contributions
        .filter((p) => Math.floor((p.openedAt - T0) / WEEK_MS) === week)
        .reduce((sum, p) => sum + p.contributionMicros, 0n),
    })),
    markets: BREAKOUT_MARKETS.map((market) => ({
      group: market.marketId,
      contributionMicros: contributions
        .filter((p) => p.marketId === market.marketId)
        .reduce((sum, p) => sum + p.contributionMicros, 0n),
    })),
  };
  const partitionResiduals = {
    weeks: posted - partitions.weeks.reduce((sum, g) => sum + g.contributionMicros, 0n),
    markets: posted - partitions.markets.reduce((sum, g) => sum + g.contributionMicros, 0n),
  };
  allocatable &&=
    partitionResiduals.weeks === 0n &&
    partitionResiduals.markets === 0n &&
    arm.positions.every((p) => BREAKOUT_MARKETS.some((m) => m.marketId === p.marketId));
  const serializedPartitions = {
    weeks: partitions.weeks.map((g) => ({
      ...g,
      contributionMicros: g.contributionMicros.toString(),
    })),
    markets: partitions.markets.map((g) => ({
      ...g,
      contributionMicros: g.contributionMicros.toString(),
    })),
  };
  return {
    role: arm.role,
    status: net === null ? "INCOMPLETE" : "COMPLETE",
    netAUSD: net === null ? null : cash(net),
    grossRealizedAUSD: cash(gross),
    signedFeeAUSD: cash(fees),
    recordedFundingAUSD: cash(funding),
    finalFundingAUSD: complete ? cash(funding) : null,
    postedSubtotalAUSD: cash(posted),
    cashAUSD: arm.nativeCashAtTF,
    residualAUSD: cash(residual),
    attributionStatus: allocatable
      ? "ALLOCATABLE_NATIVE_POSTINGS"
      : "UNAVAILABLE_UNALLOCATABLE_NATIVE_RESIDUAL",
    bySide,
    partitions: serializedPartitions,
    partitionResidualsAUSD: {
      weeks: cash(partitionResiduals.weeks),
      markets: cash(partitionResiduals.markets),
    },
    contributions: contributions.map((p) => ({
      ...p,
      contributionMicros: p.contributionMicros.toString(),
    })),
    riskStatus: arm.riskStatus,
  };
}

/** Exact observed-path paired subtraction, retaining every zero week and fixed market. */
export function breakoutConcentration(
  candidate: ReturnType<typeof breakoutArmEconomics>,
  sma: ReturnType<typeof breakoutArmEconomics>,
) {
  const available =
    candidate.netAUSD !== null &&
    sma.netAUSD !== null &&
    candidate.attributionStatus === "ALLOCATABLE_NATIVE_POSTINGS" &&
    sma.attributionStatus === "ALLOCATABLE_NATIVE_POSTINGS";
  if (!available) {
    return {
      status: "INCONCLUSIVE_ATTRIBUTION",
      groups: [],
      candidateResidualAUSD: candidate.residualAUSD,
      smaResidualAUSD: sma.residualAUSD,
    };
  }
  const netC = nativeMicros(candidate.netAUSD!);
  const netS = nativeMicros(sma.netAUSD!);
  const groups = (["weeks", "markets"] as const).flatMap((partition) =>
    candidate.partitions[partition].map((group) => {
      const reference = sma.partitions[partition].find((s) => s.group === group.group)!;
      const cWithout = netC - BigInt(group.contributionMicros);
      const differential = cWithout - (netS - BigInt(reference.contributionMicros));
      return {
        partition,
        group: group.group,
        candidateContributionAUSD: cash(BigInt(group.contributionMicros)),
        smaContributionAUSD: cash(BigInt(reference.contributionMicros)),
        C_without_g_AUSD: cash(cWithout),
        D_CS_without_g_AUSD: cash(differential),
        passes: cWithout > 0n && differential > 0n,
      };
    }),
  );
  return {
    status: groups.every((g) => g.passes) ? "PASS" : "DEFER_CONCENTRATION",
    groups,
    candidateResidualAUSD: candidate.residualAUSD,
    smaResidualAUSD: sma.residualAUSD,
  };
}

export function breakoutBreadth(T0: number, positions: readonly BreakoutFinancialPosition[]) {
  const { TA, TV } = breakoutWindowTimes(T0);
  const complete = positions.filter(
    (p) => p.openedAt >= T0 && p.openedAt < TA && p.closedAt !== null && p.closedAt <= TV,
  );
  const uniqueEpisodes = new Set(complete.map((p) => p.episodeKey));
  const counts = {
    closedEpisodePositions: uniqueEpisodes.size,
    entryHourClocks: new Set(complete.map((p) => Math.floor(p.openedAt / 3_600_000))).size,
    representedWeeks: new Set(complete.map((p) => Math.floor((p.openedAt - T0) / WEEK_MS))).size,
    markets: new Set(complete.map((p) => p.marketId)).size,
    longClosed: complete.filter((p) => p.side === "long").length,
    shortClosed: complete.filter((p) => p.side === "short").length,
  };
  return {
    ...counts,
    passes:
      uniqueEpisodes.size === complete.length &&
      counts.closedEpisodePositions >= 40 &&
      counts.entryHourClocks >= 20 &&
      counts.representedWeeks === 4 &&
      counts.markets >= 5 &&
      counts.longClosed >= 10 &&
      counts.shortClosed >= 10,
    interpretation: "Experimental descriptive breadth floors, not power or independent samples.",
  };
}

/** Independent outcome vector; a verified C emergency rejects risk fit even with unknown net. */
export function hourlyBreakoutScreenReport(input: {
  T0: number;
  financial: readonly BreakoutArmFinancialEvidence[];
  availability: ReturnType<typeof breakoutAvailability>;
  requiredFinals: ReturnType<typeof breakoutRequiredFinals>;
  technicalFailures: readonly string[];
  exposedSupervisionComplete: boolean;
  admittedProvenanceComplete: boolean;
  requiredExitsComplete: boolean;
  P_context: unknown;
}) {
  if (new Set(input.financial.map((a) => a.role)).size !== 3 || input.financial.length !== 3) {
    return invalid("Exactly the independent C/S/L complete financial populations are required");
  }
  const arms = input.financial.map((a) => breakoutArmEconomics(input.T0, a));
  const C = arms.find((a) => a.role === "C")!;
  const S = arms.find((a) => a.role === "S")!;
  const L = arms.find((a) => a.role === "L")!;
  const breadth = breakoutBreadth(input.T0, input.financial.find((a) => a.role === "C")!.positions);
  const actionMembershipComplete = input.financial.every((arm) =>
    arm.positions.every((position) =>
      (["OPEN", "FULL_CLOSE"] as const).every((action) =>
        input.requiredFinals.originalMembers.some(
          (q) =>
            q.role === arm.role &&
            q.marketId === position.marketId &&
            q.action === action &&
            q.financialStatus === "CONFIRMED" &&
            q.evidenceStatus === "VALID" &&
            q.actionObligationId ===
              (action === "OPEN"
                ? position.openingActionObligationId
                : position.closingActionObligationId),
        ),
      ),
    ),
  );
  const technical =
    input.technicalFailures.length === 0 &&
    input.exposedSupervisionComplete &&
    input.admittedProvenanceComplete &&
    input.requiredExitsComplete &&
    actionMembershipComplete;
  const financial = arms.every((a) => a.netAUSD !== null);
  const coverage = input.availability.passes95 && input.requiredFinals.passes95 && breadth.passes;
  const riskFit =
    C.riskStatus === "EMERGENCY_VERIFIED"
      ? "REJECT_C_RISK_FIT"
      : C.riskStatus === "UNVERIFIABLE"
        ? "RISK_STATUS_UNVERIFIABLE"
        : "NO_C_EMERGENCY_VERIFIED";
  const concentration = breakoutConcentration(C, S);
  const deltaCS =
    C.netAUSD !== null && S.netAUSD !== null
      ? nativeMicros(C.netAUSD) - nativeMicros(S.netAUSD)
      : null;
  const deltaCL =
    C.netAUSD !== null && L.netAUSD !== null
      ? nativeMicros(C.netAUSD) - nativeMicros(L.netAUSD)
      : null;
  const sidesPositive = C.bySide.every((s) => s.netAUSD !== null && nativeMicros(s.netAUSD) > 0n);
  const economics =
    technical && financial && coverage
      ? nativeMicros(C.netAUSD!) <= 0n || deltaCS! <= 0n || !sidesPositive
        ? "REJECT_THIS_BIDIRECTIONAL_FULL_CONTRACT_PRIORITY"
        : "CASH_SMA_AND_BOTH_SIDES_POSITIVE"
      : "ECONOMIC_INTERPRETATION_INCONCLUSIVE";
  const flags = [
    ...(!technical ? ["TECHNICAL_FAILURE"] : []),
    ...(!actionMembershipComplete ? ["ACTION_OBLIGATION_MEMBERSHIP_UNPROVED"] : []),
    ...(!financial ? ["INCONCLUSIVE_FINANCIAL_COMPLETENESS"] : []),
    ...(!coverage ? ["INCONCLUSIVE_DATA_OR_BREADTH"] : []),
    ...(riskFit === "REJECT_C_RISK_FIT" || riskFit === "RISK_STATUS_UNVERIFIABLE" ? [riskFit] : []),
    ...arms
      .filter((a) => a.role !== "C" && a.riskStatus === "EMERGENCY_VERIFIED")
      .map((a) => `REFERENCE_${a.role}_NATIVE_EMERGENCY`),
    ...arms
      .filter((a) => a.riskStatus === "UNVERIFIABLE")
      .map((a) => `${a.role}_RISK_STATUS_UNVERIFIABLE`),
    ...(economics === "REJECT_THIS_BIDIRECTIONAL_FULL_CONTRACT_PRIORITY" ? [economics] : []),
    ...(technical && financial && coverage && concentration.status !== "PASS"
      ? [concentration.status]
      : []),
  ];
  const positive =
    technical &&
    financial &&
    coverage &&
    arms.every((a) => a.riskStatus !== "UNVERIFIABLE") &&
    riskFit === "NO_C_EMERGENCY_VERIFIED" &&
    economics === "CASH_SMA_AND_BOTH_SIDES_POSITIVE" &&
    concentration.status === "PASS";
  if (positive) {
    flags.push("POSITIVE_CASH_AND_SMA_DESCRIPTIVE_SCREEN");
  }
  if (deltaCL !== null) {
    flags.push(
      deltaCL > 0n ? "L_OUTPERFORMED_RAW" : "L_NOT_OUTPERFORMED",
      "RELATIVE_VALUE_VS_L_UNRESOLVED",
    );
  }
  return {
    protocol: "perps-hourly-breakout-fixed-screen-v1",
    version: 10,
    cutoffs: breakoutWindowTimes(input.T0),
    populations: BREAKOUT_FIXED_POPULATIONS,
    arms,
    N: { initialAUSD: "1000", finalAUSD: "1000", netAUSD: "0", positions: 0 },
    P_context: input.P_context,
    D_CS_AUSD: deltaCS === null ? null : cash(deltaCS),
    D_CL_AUSD: deltaCL === null ? null : cash(deltaCL),
    technicalValidity: technical ? "VALID" : "TECHNICAL_FAILURE",
    financialCompleteness: financial ? "COMPLETE" : "INCONCLUSIVE_FINANCIAL_COMPLETENESS",
    coverageAndBreadth: coverage ? "PASS" : "INCONCLUSIVE_DATA_OR_BREADTH",
    candidateRiskFit: riskFit,
    economics,
    concentration,
    breadth,
    availability: input.availability,
    requiredFinals: input.requiredFinals,
    flags: [...new Set(flags)],
    positiveDescriptiveScreen: positive,
    interpretation:
      "One dependent fixed portfolio screen. No timing alpha, general expectancy, PTS financial comparison, automatic continuation, or investment priority over L follows.",
  };
}
