/**
 * One decision, read four ways.
 *
 * The API has shipped four decision shapes and still returns any of them: a flat legacy body, v2
 * with a model assessment and a policy evaluation, v3 with a nine-section report, and v4 which adds
 * the protocol name. The Studio draws one screen, so the differences are resolved here and the
 * sections only ever see this view.
 *
 * Nothing is invented. A field the stored decision does not carry comes back empty, and the screen
 * says so rather than filling the gap.
 */
import type { Run } from "./api";

type Decision = NonNullable<Run["decision"]>;
type Probability = { lower: number; estimate: number; upper: number };
export type Tint = "lime" | "magenta" | "amber" | "violet" | "grey";

export type ReasonCode = {
  code: string;
  why: string;
  tint: Tint;
};
export type ReportSection = {
  key: string;
  status: "supported" | "conflicting" | "missing" | "not_applicable";
  explanation: string;
  sources: number;
  tint: Tint;
};
export type DecisionView = {
  runId: string;
  shortId: string;
  trigger: Run["trigger"];
  status: Run["status"];
  /** The market and outcome as the decision recorded them, not as the market is named today. */
  marketId: string;
  outcomeId: string;
  action: "TRADE" | "ABSTAIN" | "OVERRIDDEN";
  actionTint: Tint;
  overridden: boolean;
  modelAction: string;
  finalAction: string;
  probability: Probability | null;
  uncertaintyLevel: "LOW" | "MEDIUM" | "HIGH" | "";
  uncertaintyTint: Tint;
  inabilityReason: string;
  observedPrice: number | null;
  limitPrice: number | null;
  /** upper − lower. The width the policy compares against maxProbabilityRangeWidth. */
  width: number | null;
  /** lower − observed price. The conservative margin the policy compares against its floor. */
  margin: number | null;
  marginOk: boolean;
  missing: string[];
  thesis: string;
  counterEvidence: string;
  uncertainty: string;
  abstentionReason: string;
  evaluatedAt: string;
  policyVersion: string;
  codes: ReasonCode[];
  protocol: string;
  report: ReportSection[];
  supported: number;
  conflicting: number;
  missingSections: number;
  sources: string[];
};

const has = <K extends string>(value: object, key: K): value is Record<K, unknown> => key in value;

/**
 * Why a code fired, said in terms of the fields the operator can see. The two thresholds come from
 * the policy the run was evaluated against, so the sentence quotes the number that actually applied
 * rather than today's setting.
 */
function explain(code: string, policy: Record<string, unknown>): string {
  const number = (key: string) =>
    typeof policy[key] === "number" ? (policy[key] as number).toFixed(2) : "its limit";
  switch (code) {
    case "MODEL_ABSTAINED":
      return "The model chose not to trade on its own.";
    case "HIGH_UNCERTAINTY":
      return "uncertaintyLevel is HIGH and blockHighUncertainty is on.";
    case "MISSING_INFORMATION":
      return "missingInformation is not empty and requireCompleteInformation is on.";
    case "MISSING_PROBABILITY":
      return "The model returned no probability range.";
    case "WIDE_PROBABILITY_RANGE":
      return `upper − lower is wider than maxProbabilityRangeWidth (${number("maxProbabilityRangeWidth")}).`;
    case "INSUFFICIENT_CONSERVATIVE_MARGIN":
      return `lower − market price is under minProbabilityMargin (${number("minProbabilityMargin")}).`;
    case "PRICE_EXCEEDS_LIMIT":
      return "Observed price is above the limit price the model set.";
    default:
      return "The policy stopped the trade for a reason this build does not name yet.";
  }
}

const STATUS_TINT: Record<ReportSection["status"], Tint> = {
  supported: "lime",
  conflicting: "amber",
  missing: "magenta",
  not_applicable: "grey",
};

const price = (value: unknown): number | null =>
  typeof value === "string" && value ? Number(value) : typeof value === "number" ? value : null;

export function decisionView(run: Run, decision: Decision): DecisionView {
  const assessment =
    has(decision, "modelAssessment") && decision.modelAssessment
      ? (decision.modelAssessment as Record<string, unknown>)
      : null;
  const evaluation =
    has(decision, "policyEvaluation") && decision.policyEvaluation
      ? (decision.policyEvaluation as Record<string, unknown>)
      : null;
  const policy = (evaluation?.config as Record<string, unknown>) ?? {};
  const probability = (assessment?.probability as Probability | null | undefined) ?? null;
  const level = (assessment?.uncertaintyLevel as DecisionView["uncertaintyLevel"]) ?? "";
  const modelAction = (assessment?.action as string) ?? decision.action;
  const finalAction = (evaluation?.finalAction as string) ?? decision.action;
  const overridden = modelAction === "TRADE" && finalAction === "ABSTAIN";
  const observedPrice = price(decision.observedPrice);
  const limitPrice = price(decision.limitPrice);
  const width = probability ? probability.upper - probability.lower : null;
  const margin = probability && observedPrice !== null ? probability.lower - observedPrice : null;
  const floor =
    typeof policy.minProbabilityMargin === "number" ? (policy.minProbabilityMargin as number) : 0;
  const coverage = (has(decision, "coverage") ? decision.coverage : []) as {
    section: string;
    status: ReportSection["status"];
    explanation: string;
    sourceIds: string[];
  }[];
  const report: ReportSection[] = (coverage ?? []).map((section) => ({
    key: section.section,
    status: section.status,
    explanation: section.explanation,
    sources: section.sourceIds.length,
    tint: STATUS_TINT[section.status],
  }));
  const forecast = (has(decision, "forecast") ? decision.forecast : null) as {
    inabilityReason: string | null;
  } | null;
  const codes = ((evaluation?.reasonCodes as string[]) ?? []).map((code) => ({
    code,
    why: explain(code, policy),
    tint: (code === "MODEL_ABSTAINED" ? "grey" : "magenta") as Tint,
  }));
  return {
    runId: run.id,
    shortId: run.id.slice(0, 8),
    trigger: run.trigger,
    status: run.status,
    marketId: decision.marketId,
    outcomeId: decision.outcomeId ?? "no outcome recorded",
    action: overridden ? "OVERRIDDEN" : (finalAction as "TRADE" | "ABSTAIN"),
    actionTint: overridden ? "magenta" : finalAction === "TRADE" ? "lime" : "grey",
    overridden,
    modelAction,
    finalAction,
    probability,
    uncertaintyLevel: level,
    uncertaintyTint: level === "LOW" ? "lime" : level === "MEDIUM" ? "amber" : "magenta",
    inabilityReason: forecast?.inabilityReason ?? "",
    observedPrice,
    limitPrice,
    width,
    margin,
    marginOk: margin !== null && margin >= floor,
    missing: (assessment?.missingInformation as string[]) ?? [],
    thesis: decision.thesis,
    counterEvidence: decision.counterEvidence,
    uncertainty: decision.uncertainty,
    abstentionReason: decision.abstentionReason ?? "",
    evaluatedAt: (evaluation?.evaluatedAt as string) ?? "",
    policyVersion: (evaluation?.version as string) ?? "",
    codes,
    protocol: (has(decision, "protocol") ? (decision.protocol as string) : "") || "",
    report,
    supported: report.filter((section) => section.status === "supported").length,
    conflicting: report.filter((section) => section.status === "conflicting").length,
    missingSections: report.filter((section) => section.status === "missing").length,
    sources: decision.sourceIds,
  };
}

/** How a run reads in a list: the mark it carries and the colour that mark is drawn in. */
export function runMark(run: Run): { mark: string; tint: Tint } {
  if (run.status === "queued" || run.status === "running") {
    return { mark: run.status.toUpperCase(), tint: "violet" };
  }
  if (run.status === "failed") {
    return { mark: "FAILED", tint: "magenta" };
  }
  if (run.status === "cancelled") {
    return { mark: "CANCELLED", tint: "grey" };
  }
  if (!run.decision) {
    return { mark: "NO DECISION", tint: "grey" };
  }
  const view = decisionView(run, run.decision);
  return { mark: view.action, tint: view.actionTint };
}

/** What the run was about, in one line: the error if it failed, otherwise the market and range. */
export function runSummary(run: Run): string {
  if (run.error) {
    return run.error;
  }
  if (!run.decision) {
    return run.status === "completed" ? "Completed without a decision" : "Discovering markets…";
  }
  const view = decisionView(run, run.decision);
  const range = view.probability
    ? ` · ${view.probability.lower.toFixed(2)}–${view.probability.upper.toFixed(2)}`
    : "";
  return `Market ${view.marketId} · ${view.outcomeId}${range}`;
}

export const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
export const two = (value: number | null): string => (value === null ? "—" : value.toFixed(2));
export const signed = (value: number | null): string =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
export const clock = (value: number | null): string =>
  value === null
    ? "—"
    : new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export const duration = (run: Run): string => {
  if (run.status === "running") {
    return "live";
  }
  if (!run.startedAt || !run.finishedAt) {
    return "—";
  }
  const seconds = Math.round((run.finishedAt - run.startedAt) / 1000);
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
};
