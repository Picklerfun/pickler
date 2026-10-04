import { PilotError, type PerpSymbol } from "@pickler/core";
import { perpsRules } from "../perps-strategies/policy.js";
import {
  perpsMultiframeRules,
  traceMultiframeProposal,
  validateMultiframeEvidence,
  multiframeFeatures,
} from "../perps-strategies/multiframe.js";
import { auditPerpsDecisions, type AuditDiagnostic } from "./audit.js";
import { perpsAccountedUsd } from "./policy.js";
import type { PerpsStudyView, PerpsStudyMap, PerpsDecisionContext } from "./types.js";
import type { PerpsPaperView } from "../perps-paper/types.js";

function paired(context: PerpsDecisionContext, symbol: PerpSymbol) {
  validateMultiframeEvidence(context.evidence);
  const hourlyContext = {
    ...context,
    evidence: {
      ...context.evidence,
      candles: context.evidence.candles.filter((s) => s.resolution === 3600),
    },
  };
  const previous = perpsRules(hourlyContext).find((p) => p.symbol === symbol)!;
  const current = perpsMultiframeRules(context).find((p) => p.symbol === symbol)!;
  return {
    representation: "PAIRED_PROPOSALS_SAME_RECORDED_RULES_ACCOUNT_NOT_EXECUTIONS",
    previousVersion: "1.0.0",
    currentVersion: "1.1.0",
    previous,
    current,
    trace: traceMultiframeProposal(context, previous),
  };
}

/** Literal-code interpretation, not an attribution of unobservable model reasoning. */
function inspectReason(
  reason: string | undefined,
  context: PerpsDecisionContext | null,
  symbol: PerpSymbol,
) {
  if (!reason || !context) {
    return { status: "NOT_VERIFIABLE", literal: reason ?? null, checks: [] };
  }
  const f = multiframeFeatures(context, symbol);
  const prefix =
    reason.match(
      /^(NO_SIGNAL|CONFLICTING_SIGNAL|COST_HURDLE|INSUFFICIENT_DEPTH|DATA_GAP|POSITION_INTACT)\b/,
    )?.[1] ?? null;
  const checks: { condition: string; status: string; reference: string; value: unknown }[] = [];
  if (prefix === "NO_SIGNAL") {
    const candidate = {
      symbol,
      action: f.trend === "short" ? ("open-short" as const) : ("open-long" as const),
      reason: "diagnostic only",
      sourceIds: [],
    };
    const trace = traceMultiframeProposal(context, candidate);
    checks.push({
      condition: "A frozen entry requirement is not satisfied",
      status: trace.firstBlock !== null ? "CONDITION_PRESENT" : "NOT_VERIFIABLE",
      reference: `${symbol}:entry checks`,
      value: trace.firstBlock,
    });
  }
  if (prefix === "COST_HURDLE") {
    const known = f.activityHurdleBps !== null;
    const blocked =
      known &&
      (Math.abs(f.momentum5Bps) <= f.activityHurdleBps! ||
        Math.abs(f.momentum15Bps) <= f.activityHurdleBps!);
    checks.push({
      condition: "Recent movement fails the frozen activity hurdle",
      status: !known
        ? "CONDITION_ABSENT"
        : blocked
          ? "CONDITION_PRESENT"
          : "CLAIM_NOT_SUPPORTED_BY_RECORDED_VALUES",
      reference: `${symbol}:features.activityHurdleBps`,
      value: f,
    });
  }
  if (prefix === "CONFLICTING_SIGNAL") {
    const sign = f.trend === "long" ? 1 : f.trend === "short" ? -1 : 0;
    checks.push({
      condition: "Trend and short momentum are not aligned",
      status:
        sign === 0 || f.momentum5Bps * sign <= 0 || f.momentum15Bps * sign <= 0
          ? "CONDITION_PRESENT"
          : "CLAIM_NOT_SUPPORTED_BY_RECORDED_VALUES",
      reference: `${symbol}:features`,
      value: f,
    });
  }
  if (prefix === "POSITION_INTACT") {
    const position = context.account.positions.find(
      (p) => p.symbol === symbol && p.closedAt === null,
    );
    checks.push({
      condition: "Open position exists",
      status: position ? "CONDITION_PRESENT" : "CONDITION_ABSENT",
      reference: "recorded account.positions",
      value: position?.side ?? null,
    });
  }
  // Only named, machine-readable quantities support a numerical claim check. Free text stays literal.
  for (const key of ["momentum5Bps", "momentum15Bps", "activityHurdleBps"] as const) {
    const match = reason.match(new RegExp(`\\b${key}\\s*[:=]?\\s*([+-]?\\d+(?:\\.\\d+)?)`));
    if (match) {
      const value = f[key];
      checks.push({
        condition: key,
        status:
          value === null
            ? "CONDITION_ABSENT"
            : Math.abs(Number(match[1]) - value) <= 0.01
              ? "CONDITION_PRESENT"
              : "NUMERICAL_MISMATCH",
        reference: `${symbol}:features.${key}`,
        value,
      });
    }
  }
  return {
    status: checks.length ? "CHECKED_EXPLICIT_CLAIMS_ONLY" : "NOT_VERIFIABLE",
    literal: reason,
    prefix,
    checks,
  };
}

export function auditPerpsFilters(
  study: PerpsStudyView,
  diagnostics: AuditDiagnostic[],
  hash: (value: unknown) => string,
  accounts?: PerpsStudyMap<PerpsPaperView>,
) {
  if (
    study.record.config.version !== 2 ||
    study.record.config.protocol !== "perps-multiframe-v3" ||
    study.record.config.strategyVersion !== "1.1.0"
  ) {
    throw new PilotError("INVALID_INPUT", "Filter audit requires frozen multiframe 1.1.0");
  }
  const base = auditPerpsDecisions(study, diagnostics, hash, accounts);
  const rows = base.rows.map((row) => {
    const round = study.rounds.find((r) => r.slot === row.slot);
    let comparison: ReturnType<typeof paired> | null = null;
    let evidenceState = "NOT_VERIFIABLE";
    let context: PerpsDecisionContext | null = null;
    try {
      if (round?.evidence && round.accounts?.rules) {
        comparison = paired(
          { evidence: round.evidence, account: round.accounts.rules },
          row.symbol,
        );
        evidenceState = "VALID";
      }
      const account = round?.accounts?.[row.strategy];
      if (account && round?.evidence) {
        validateMultiframeEvidence(round.evidence);
        context = { evidence: round.evidence, account };
      }
    } catch (error) {
      comparison = null;
      context = null;
      evidenceState = error instanceof PilotError ? error.code : "NOT_VERIFIABLE";
    }
    const literal =
      row.strategy === "rules"
        ? null
        : (row.originalProposal?.reason ?? row.recordedProposal?.reason);
    const finalGate = study.events.find(
      (e) => e.key === `${round?.key}:${row.strategy}:${row.symbol}:final-gate`,
    );
    return {
      ...row,
      multiframeEvidence: evidenceState,
      pairedSma: comparison,
      modelReasonCheck: inspectReason(literal ?? undefined, context, row.symbol),
      finalPolicyGate: finalGate
        ? { key: finalGate.key, at: finalGate.at, data: finalGate.data }
        : null,
      explanation:
        row.executionStatus === "incomplete" ? "INCOMPLETE_NOT_COMPARABLE" : row.diagnosis,
    };
  });
  const validCommonSlots = base.completeSlots.filter((slot) =>
    (["BTC", "ETH"] as const).every((symbol) =>
      rows.some(
        (r) =>
          r.slot === slot &&
          r.symbol === symbol &&
          r.strategy === "rules" &&
          r.initialValidity === "VALID" &&
          r.finalValidity === "VALID" &&
          r.pairedSma !== null,
      ),
    ),
  );
  const comparable = rows.filter(
    (r) => r.strategy === "rules" && validCommonSlots.includes(r.slot) && r.pairedSma,
  );
  const openings = comparable.filter((r) => r.pairedSma!.previous.action.startsWith("open-"));
  const discarded = openings.filter((r) => !r.pairedSma!.current.action.startsWith("open-"));
  const counts = (items: string[]) =>
    Object.fromEntries(
      [...new Set(items)].sort().map((code) => [code, items.filter((v) => v === code).length]),
    );
  const calls = study.rounds.flatMap((r) =>
    Object.values(r.calls).map((c) => ({ slot: r.slot, roundKey: r.key, ...c })),
  );
  const failures = calls
    .filter((c) => c.error !== null)
    .map((c) => ({
      slot: c.slot,
      roundKey: c.roundKey,
      lane: c.lane,
      model: c.model,
      requestHash: c.requestHash ?? null,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      durationMs: c.startedAt !== null && c.finishedAt !== null ? c.finishedAt - c.startedAt : null,
      code: c.error,
      costUsd: c.costUsd,
      reservationUsd: c.reservationUsd,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      consumption: c.costUsd === null ? "UNKNOWN_RESERVATION_RETAINED" : "VERIFIED_ESTIMATE",
      diagnosis:
        c.error === "MODEL_TIMEOUT"
          ? "DEADLINE_EXHAUSTED_PHASE_AND_CAUSE_NOT_VERIFIABLE"
          : "RECORDED_ERROR_ROOT_CAUSE_NOT_VERIFIABLE",
    }));
  return {
    ...base,
    version: 2 as const,
    protocol: "perps-decision-audit-v2",
    rows,
    comparableModelHolds: rows.filter(
      (r) =>
        r.strategy !== "rules" &&
        validCommonSlots.includes(r.slot) &&
        r.conversion === "MATCH" &&
        r.recordedProposal?.action === "hold",
    ).length,
    pairedSummary: {
      commonCompleteSlots: [...new Set(comparable.map((r) => r.slot))],
      observations: comparable.length,
      previousOpenings: openings.length,
      retainedOpenings: openings.filter(
        (r) => r.pairedSma!.previous.action === r.pairedSma!.current.action,
      ).length,
      discardedOpenings: discarded.length,
      firstBlocks: counts(discarded.map((r) => r.pairedSma!.trace.firstBlock ?? "NOT_VERIFIABLE")),
      overlappingFailedConditions: counts(
        discarded.flatMap((r) => r.pairedSma!.trace.coincidentBlocks),
      ),
      overlappingCountsAreNotIndependentCauses: true,
      accountBasis: "Same original rules account per slot; no hypothetical position carry-forward",
      economicInterpretation: "Proposal comparison only; no counterfactual executions or P&L",
    },
    technical: {
      status: study.record.status,
      stopReason: study.record.decisionStopReason,
      failures,
      stopEvents: study.events.filter((e) =>
        ["decision-stop", "closing", "interrupted", "completed"].includes(e.kind),
      ),
      diagnostics: study.events.filter((e) => e.kind === "model-diagnostic"),
      accountedOrReservedUsd: perpsAccountedUsd(study.rounds),
      callTimeline: calls.map((c) => ({
        slot: c.slot,
        lane: c.lane,
        status: c.status,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
        error: c.error,
      })),
      requestsCannotBeReconstructedFromHashes: true,
    },
    limitations: [
      ...base.limitations,
      "The v1.1 context projection uses close/time pairs, not the full OHLC evidence retained in PostgreSQL.",
      "Model reason checks examine only explicit claims; they do not infer ignored evidence or internal reasoning.",
      "Failed and omitted slots are excluded from paired comparisons. Unknown consumption keeps the full reservation.",
      "The activity hurdle is an uncalibrated past-movement filter, not an expected return.",
    ],
  };
}
