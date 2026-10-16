import test from "node:test";
import assert from "node:assert/strict";
import {
  BREAKOUT_FIXED_POPULATIONS,
  BREAKOUT_MARKETS,
  breakoutAvailability,
  breakoutArmEconomics,
  breakoutBreadth,
  breakoutCommitTiming,
  breakoutConcentration,
  breakoutDueWork,
  breakoutExposureGaps,
  breakoutRequiredFinals,
  breakoutUniqueFinalSources,
  breakoutWindowTimes,
  compareBreakoutBoundaries,
  hourlyBreakoutScreenReport,
  type BreakoutActionObligation,
  type BreakoutArmFinancialEvidence,
  type BreakoutAvailabilityCell,
  type BreakoutClockCell,
} from "../src/evaluation.js";
import {
  breakoutBoundary,
  breakoutCertificate,
  breakoutDigest,
  breakoutT0,
} from "./hourly-breakout-fixture.js";

test("J source continuity cannot qualify V; accepted receipt delay exposes both frozen counterexamples", () => {
  const source = breakoutCertificate("source-local");
  const finance = breakoutCertificate();
  assert.equal(
    compareBreakoutBoundaries(breakoutBoundary(0, "J"), breakoutBoundary(89999, "J"), [source])
      .status,
    "COMPLIANT",
  );
  for (const [first, next] of [
    [5, 90007],
    [100, 90101],
  ]) {
    assert.equal(
      compareBreakoutBoundaries(breakoutBoundary(first!), breakoutBoundary(next!), [finance])
        .status,
      "PROVED_GAP_BREACH",
    );
  }
  const uncertain = breakoutBoundary(90000);
  uncertain.financial = { lowerMs: 90000, upperMs: 90003 };
  uncertain.monotonic = { ...uncertain.financial };
  const prior = breakoutBoundary(0, "V", 2);
  assert.equal(
    compareBreakoutBoundaries(prior, uncertain, [finance]).status,
    "GAP_COMPLIANCE_UNPROVED",
  );
  assert.equal(
    compareBreakoutBoundaries(breakoutBoundary(0), breakoutBoundary(60000), [source]).status,
    "GAP_COMPLIANCE_UNPROVED",
  );
  assert.equal(
    compareBreakoutBoundaries(breakoutBoundary(0), breakoutBoundary(60000), [
      { ...finance, accepted: false },
    ]).status,
    "GAP_COMPLIANCE_UNPROVED",
  );
  const epoch = breakoutBoundary(60000);
  epoch.epochId = "restarted-process";
  assert.equal(
    compareBreakoutBoundaries(breakoutBoundary(0), epoch, [finance]).status,
    "CLOCK_PROOF_FAILURE",
  );
  const regressed = breakoutBoundary(1000);
  regressed.monotonic = { lowerMs: 5, upperMs: 6 };
  assert.equal(
    compareBreakoutBoundaries(breakoutBoundary(100), regressed, [finance]).status,
    "CLOCK_PROOF_FAILURE",
  );
});

test("opening, original per-market V, trailing monitor and actual close acknowledgement all bound supervision", () => {
  const certificate = breakoutCertificate();
  const anchor = breakoutBoundary(100, "A_BEFORE_EFFECT");
  const V = breakoutBoundary(60000);
  const closed = breakoutBoundary(150001, "V_CLOSE");
  const exposure = {
    role: "C" as const,
    marketId: 1,
    positionOrAttemptId: "possibly-committed-original",
    openingAnchor: anchor,
    valuations: [V, V],
    closeAcknowledgement: null,
    stillPossiblyExposed: true,
    monitorBoundary: breakoutBoundary(150001, "K"),
  };
  const gap = breakoutExposureGaps(exposure, [certificate]);
  assert.equal(gap.intervals.length, 2);
  assert.equal(gap.accepted, false);
  assert.equal(gap.intervals[1]!.proof.status, "PROVED_GAP_BREACH");
  assert.equal(
    breakoutExposureGaps(
      { ...exposure, closeAcknowledgement: closed, stillPossiblyExposed: false },
      [certificate],
    ).accepted,
    false,
  );
  assert.equal(
    breakoutExposureGaps({ ...exposure, openingAnchor: null }, [certificate]).intervals[0]!.proof
      .status,
    "GAP_COMPLIANCE_UNPROVED",
  );
  assert.throws(() => breakoutExposureGaps({ ...exposure, marketId: 20 }, [certificate]));
  const duplicate = {
    ...V,
    id: "later-poll-receipt",
    financial: { lowerMs: 70000, upperMs: 70001 },
  };
  assert.throws(() =>
    breakoutExposureGaps({ ...exposure, valuations: [V, duplicate] }, [certificate]),
  );
});

test("late ACK alone distinguishes neither of the two possible commit histories", () => {
  const acknowledgement = {
    operationId: "original",
    authoritativeRecordId: "row",
    receivedAt: 300005,
  };
  assert.equal(
    breakoutCommitTiming("confirmed", acknowledgement, 300000),
    "LATE_ACK_WITH_COMMIT_TIME_UNRESOLVED",
  );
  assert.equal(
    breakoutCommitTiming(
      "confirmed",
      { ...acknowledgement, irreversibleCommitAt: { lowerMs: 300001, upperMs: 300002 } },
      300000,
    ),
    "PROVED_LATE_COMMIT",
  );
  assert.equal(
    breakoutCommitTiming(
      "confirmed",
      { ...acknowledgement, irreversibleCommitAt: { lowerMs: 299999, upperMs: 299999 } },
      300000,
    ),
    "LATE_ACK_WITH_COMMIT_TIME_UNRESOLVED",
  );
  assert.equal(breakoutCommitTiming("unknown", null, 300000), "UNKNOWN_OUTCOME");
  assert.equal(breakoutCommitTiming("rolled_back", acknowledgement, 300000), "PROVED_ROLLBACK");
});

test("virtual calendar covers exactly 28 days, 4h closing and 72h funding, with no missed-slot recovery", () => {
  const { TA, TV, TF } = breakoutWindowTimes(breakoutT0);
  let lastMinute: number | null = null;
  let lastDecisionSlot: number | null = null;
  let lastFundingMinute: number | null = null;
  let decisions = 0;
  let hourly = 0;
  let minutes = 0;
  let grace = 0;
  let funding = 0;
  assert.equal(
    breakoutDueWork(breakoutT0, breakoutT0 - 1, { lastMinute, lastDecisionSlot }).phase,
    "WAITING",
  );
  for (let at = breakoutT0; at < TF; at += 60_000) {
    const work = breakoutDueWork(breakoutT0, at, {
      lastMinute,
      lastDecisionSlot,
      lastFundingMinute,
      admissionsClosed: at > TA,
    });
    assert.deepEqual(work.missedMinutes, []);
    assert.deepEqual(work.missedDecisionSlots, []);
    if (work.minute) {
      lastMinute = work.minute.scheduledAt;
      if (work.minute.grace) {
        grace++;
      } else {
        minutes++;
      }
    }
    if (work.decision) {
      lastDecisionSlot = work.decision.slot;
      decisions++;
      hourly += work.decision.candidateHourly ? 1 : 0;
    }
    if (work.fundingMinute !== null) {
      lastFundingMinute = work.fundingMinute;
      funding++;
    }
  }
  assert.equal(minutes, 40320);
  assert.equal(grace, 240);
  assert.equal(decisions, 8064);
  assert.equal(hourly, 672);
  assert.equal(funding, 4320);
  assert.equal(
    breakoutDueWork(breakoutT0, TF, { lastMinute, lastDecisionSlot, lastFundingMinute }).phase,
    "TERMINAL",
  );
  assert.equal(
    breakoutDueWork(breakoutT0, TA, { lastMinute: TA - 60000, lastDecisionSlot: 8063 }).decision,
    null,
  );
  assert.equal(
    breakoutDueWork(breakoutT0, TV, { lastMinute: TV - 60000, lastDecisionSlot: 8063 }).minute,
    null,
  );
  const late = breakoutDueWork(breakoutT0, breakoutT0 + 30000, {
    lastMinute: null,
    lastDecisionSlot: null,
  });
  assert.equal(late.decision, null);
  assert.deepEqual(late.missedDecisionSlots, [0]);
  const interrupted = breakoutDueWork(breakoutT0, breakoutT0 + 11 * 60000, {
    lastMinute: breakoutT0,
    lastDecisionSlot: 0,
  });
  assert.deepEqual(interrupted.missedDecisionSlots, [1, 2]);
  assert.equal(interrupted.minute!.scheduledAt, breakoutT0 + 11 * 60000);
  assert.equal(interrupted.missedMinutes.length, 10);
});

test("final Q is pooled and deduplicated by account/action, with immutable schedule weeks and separate GRACE", () => {
  const rows: BreakoutActionObligation[] = Array.from({ length: 100 }, (_, i) => ({
    protocolDigest: "a".repeat(64),
    role: "C",
    marketId: 1,
    originalOperationId: `original:${i}`,
    action: "OPEN",
    actionObligationId: `allocation:${i}`,
    scheduledAt: breakoutT0,
    evidenceStatus: "VALID",
    financialStatus: "CONFIRMED",
  }));
  rows.push({
    ...rows[0]!,
    role: "S",
    evidenceStatus: "UNPERFORMED",
    financialStatus: "UNATTEMPTED",
  });
  rows.push({ ...rows[0]! });
  rows.push({
    ...rows[0]!,
    originalOperationId: "grace-close",
    action: "FULL_CLOSE",
    scheduledAt: breakoutWindowTimes(breakoutT0).TA,
  });
  const report = breakoutRequiredFinals(breakoutT0, rows);
  assert.equal(report.pooled.total, 102);
  assert.equal(report.pooled.validQ, 101);
  assert.equal(report.passes95, true);
  assert.equal(report.arms[1]!.status, "COUNTS_ONLY_NO_PER_ARM_FLOOR");
  assert.equal(report.arms[1]!.validQ, 0);
  assert.equal(report.arms[2]!.status, "NOT_REQUIRED");
  assert.equal(report.grace.total, 1);
  assert.equal(report.groups[0]!.total, 101);
  assert.equal(breakoutRequiredFinals(breakoutT0, []).pooled.status, "NOT_REQUIRED");
  assert.equal(
    breakoutUniqueFinalSources([
      { sourceOperationId: "shared", marketId: 1, frameIdentity: "frame", valid: true },
      { sourceOperationId: "shared", marketId: 1, frameIdentity: "frame", valid: true },
    ]).total,
    1,
  );
});

function financial(role: "C" | "S" | "L", perPositionNet = 2): BreakoutArmFinancialEvidence {
  const positions = Array.from({ length: 40 }, (_, i) => ({
    id: `${role}:${i}`,
    episodeKey: breakoutDigest(`episode:${i}`),
    marketId: BREAKOUT_MARKETS[i % 5]!.marketId,
    side: i % 2 ? ("short" as const) : ("long" as const),
    openedAt: breakoutT0 + Math.floor(i / 10) * 7 * 86400000 + ((i % 10) + 1) * 3600000,
    closedAt: breakoutT0 + Math.floor(i / 10) * 7 * 86400000 + ((i % 10) + 2) * 3600000,
    movementKeys: [`${role}:${i}:gross`, `${role}:${i}:entry-fee`, `${role}:${i}:exit-fee`],
    openingActionObligationId: `${role}:${i}:allocation`,
    closingActionObligationId: `${role}:${i}:close-intent`,
  }));
  const movements = positions.flatMap((p) => [
    {
      key: p.movementKeys[0]!,
      kind: "realized-pnl" as const,
      delta: `${perPositionNet}.2`,
      at: p.closedAt!,
      evidence: { positionId: p.id },
    },
    {
      key: p.movementKeys[1]!,
      kind: "fee" as const,
      delta: "-0.1",
      at: p.openedAt,
      evidence: { positionId: p.id },
    },
    {
      key: p.movementKeys[2]!,
      kind: "fee" as const,
      delta: "-0.1",
      at: p.closedAt!,
      evidence: { positionId: p.id },
    },
  ]);
  return {
    role,
    positions,
    movements,
    nativeCashAtTF: String(1000 + 40 * perPositionNet),
    unknownEffects: false,
    authoritativelyFlatByTV: true,
    heldFundingCompleteAtTF: true,
    provenanceComplete: true,
    ledgerReconciled: true,
    riskStatus: "NO_EMERGENCY_VERIFIED",
  };
}

test("complete native contributions use paired C/S subtraction and expose unallocatable residuals", () => {
  const C = breakoutArmEconomics(breakoutT0, financial("C", 2));
  const S = breakoutArmEconomics(breakoutT0, financial("S", 1));
  const concentration = breakoutConcentration(C, S);
  assert.equal(C.netAUSD, "80");
  assert.equal(S.netAUSD, "40");
  assert.equal(concentration.status, "PASS");
  assert.equal(concentration.groups[0]!.C_without_g_AUSD, "60");
  assert.equal(concentration.groups[0]!.D_CS_without_g_AUSD, "30");
  assert.equal(concentration.groups.length, 15);
  assert.equal(breakoutBreadth(breakoutT0, financial("C").positions).passes, true);
  const residual = financial("C");
  residual.positions[0]!.movementKeys = [];
  const incomplete = breakoutArmEconomics(breakoutT0, residual);
  assert.equal(incomplete.netAUSD, "80");
  assert.equal(incomplete.attributionStatus, "UNAVAILABLE_UNALLOCATABLE_NATIVE_RESIDUAL");
  assert.equal(breakoutConcentration(incomplete, S).status, "INCONCLUSIVE_ATTRIBUTION");
  const incompleteFunding = financial("C");
  incompleteFunding.heldFundingCompleteAtTF = false;
  assert.equal(breakoutArmEconomics(breakoutT0, incompleteFunding).netAUSD, null);
});

test("fixed empty availability never becomes 100%, and candidate-only emergency remains independently adverse", () => {
  const availability = breakoutAvailability(breakoutT0, []);
  assert.equal(availability.populations[0]!.planned, 7392);
  assert.equal(availability.populations[1]!.planned, 88704);
  assert.equal(availability.populations[5]!.planned, 443520);
  assert.equal(availability.passes95, false);
  const candidate = financial("C");
  candidate.heldFundingCompleteAtTF = false;
  candidate.riskStatus = "EMERGENCY_VERIFIED";
  const report = hourlyBreakoutScreenReport({
    T0: breakoutT0,
    financial: [candidate, financial("S"), financial("L")],
    availability,
    requiredFinals: breakoutRequiredFinals(breakoutT0, []),
    technicalFailures: [],
    exposedSupervisionComplete: true,
    admittedProvenanceComplete: true,
    requiredExitsComplete: true,
    P_context: { status: "UNAVAILABLE" },
  });
  assert.ok(report.flags.includes("REJECT_C_RISK_FIT"));
  assert.ok(report.flags.includes("INCONCLUSIVE_FINANCIAL_COMPLETENESS"));
  assert.equal(report.N.netAUSD, "0");
  assert.equal(report.positiveDescriptiveScreen, false);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("full 28-day fixed data grid can pass while missing PTS context and stronger L remain explicit", () => {
  const cells: BreakoutAvailabilityCell[] = [];
  const clocks: BreakoutClockCell[] = [];
  for (let minute = 0; minute < BREAKOUT_FIXED_POPULATIONS.scheduledMinutes; minute++) {
    const scheduledAt = breakoutT0 + minute * 60000;
    clocks.push({ population: "MINUTE", scheduledAt, valid: true, status: "QUALIFIED" });
    for (const market of BREAKOUT_MARKETS) {
      cells.push({
        population: "MARKET_MINUTE",
        marketId: market.marketId,
        scheduledAt,
        valid: true,
        status: "QUALIFIED",
      });
      if (minute % 5 === 0) {
        for (const population of ["S_SIGNAL", "S_INITIAL"] as const) {
          cells.push({
            population,
            marketId: market.marketId,
            scheduledAt,
            valid: true,
            status: "QUALIFIED",
          });
        }
      }
      if (minute % 60 === 0) {
        for (const population of ["C_SIGNAL", "C_INITIAL", "L_INITIAL"] as const) {
          cells.push({
            population,
            marketId: market.marketId,
            scheduledAt,
            valid: true,
            status: "QUALIFIED",
          });
        }
      }
    }
  }
  const availability = breakoutAvailability(breakoutT0, cells, clocks);
  assert.equal(availability.passes95, true);
  const sma = financial("S", 1);
  sma.riskStatus = "EMERGENCY_VERIFIED";
  const long = financial("L", 3);
  long.riskStatus = "EMERGENCY_VERIFIED";
  const financialArms = [financial("C", 2), sma, long];
  const required: BreakoutActionObligation[] = financialArms.flatMap((a) =>
    a.positions.flatMap((p) =>
      (["OPEN", "FULL_CLOSE"] as const).map((action) => ({
        protocolDigest: "a".repeat(64),
        role: a.role,
        marketId: p.marketId,
        originalOperationId: `${p.id}:${action}`,
        action,
        actionObligationId:
          action === "OPEN" ? p.openingActionObligationId! : p.closingActionObligationId!,
        scheduledAt: action === "OPEN" ? p.openedAt : p.closedAt!,
        evidenceStatus: "VALID",
        financialStatus: "CONFIRMED",
      })),
    ),
  );
  const report = hourlyBreakoutScreenReport({
    T0: breakoutT0,
    financial: financialArms,
    availability,
    requiredFinals: breakoutRequiredFinals(breakoutT0, required),
    technicalFailures: [],
    exposedSupervisionComplete: true,
    admittedProvenanceComplete: true,
    requiredExitsComplete: true,
    P_context: { status: "UNAVAILABLE" },
  });
  assert.equal(report.positiveDescriptiveScreen, true);
  assert.ok(report.flags.includes("L_NOT_OUTPERFORMED"));
  assert.ok(report.flags.includes("REFERENCE_S_NATIVE_EMERGENCY"));
  assert.ok(report.flags.includes("REFERENCE_L_NATIVE_EMERGENCY"));
  assert.equal(report.D_CS_AUSD, "40");
  assert.equal(report.D_CL_AUSD, "-40");
});
