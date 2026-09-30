/**
 * The paper run's result card (§5, §3.5): ITS TRADE with our pick in our format — outcome, market
 * and size, the size capped by the per-trade cap within the paper budget (§3.3) — or STOOD DOWN ·
 * NO TRADE with the brief rule that stopped it. Read from the run and its own events, so it says
 * only what the runtime wrote. Pure, pinned in `apps/web/test/studio-brief-run.test.ts`.
 */
import type { PreviewRun, RunEvent } from "../api";
import { PAPER_BUDGET_AUSD } from "./model";

interface RunResult {
  trade: boolean;
  eyebrow: "ITS TRADE" | "STOOD DOWN";
  title: string;
  meta: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The newest event of one of these types, as an object. */
function latest(events: readonly RunEvent[], types: readonly string[]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const candidate = events[i]!;
    if (types.includes(candidate.type)) {
      return record(candidate.data);
    }
  }
  return null;
}

/* The policy's reason codes (core's `PolicyReason`), said the way a person would. */
const POLICY_REASON_TEXT: Record<string, string> = {
  MODEL_ABSTAINED: "It chose not to trade",
  HIGH_UNCERTAINTY: "Too uncertain to call",
  MISSING_INFORMATION: "It was missing information it needed",
  MISSING_PROBABILITY: "It had no probability to trade on",
  WIDE_PROBABILITY_RANGE: "Its range was too wide",
  INSUFFICIENT_CONSERVATIVE_MARGIN: "Not enough edge over the price",
  PRICE_EXCEEDS_LIMIT: "The price moved past its limit",
  BRIEF_ENTRY_NOT_MET: "An entry rule did not hold",
  BRIEF_NEVER_BROKEN: "It would have broken a never rule",
};

export const policyReasonText = (code: string): string =>
  POLICY_REASON_TEXT[code] ?? "Its rules stopped the trade";

const POLICY_PREFIX = "Policy rejected proposal: ";

/**
 * The codes that turned a TRADE into a stand-down: the policy evaluation's, or, on a decision that
 * has none, the ones core writes into the reason. A model that abstained on its own has its own
 * words as the reason (core keeps them), and those are shown instead, so this answers none.
 */
function policyCodes(decision: NonNullable<PreviewRun["decision"]>): string[] {
  const reason = decision.abstentionReason;
  if (reason && !reason.startsWith(POLICY_PREFIX)) {
    return [];
  }
  const evaluation = record((decision as Record<string, unknown>).policyEvaluation);
  if (evaluation && Array.isArray(evaluation.reasonCodes) && evaluation.reasonCodes.length) {
    return evaluation.reasonCodes.filter((code): code is string => typeof code === "string");
  }
  return (reason ?? "")
    .slice(POLICY_PREFIX.length)
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

/** `perTrade` is the cap the run was made with, not the form's current one. */
export function runResult(
  run: PreviewRun,
  events: readonly RunEvent[],
  perTrade: number,
): RunResult | null {
  const decision = run.decision;
  if (run.status !== "completed" || !decision) {
    return null;
  }
  const market = latest(events, ["final_market", "market"]);
  const brief = latest(events, ["brief_evaluation"]);
  if (decision.action === "TRADE") {
    const outcomes: unknown[] = market && Array.isArray(market.outcomes) ? market.outcomes : [];
    const label = outcomes.map(record).find((outcome) => outcome?.id === decision.outcomeId)?.label;
    const size = Math.min(perTrade, PAPER_BUDGET_AUSD);
    const exit =
      typeof brief?.exitArmed === "string" ? `EXIT · ${brief.exitArmed}` : "NO EXIT ARMED";
    const question = typeof market?.question === "string" ? market.question : null;
    return {
      trade: true,
      eyebrow: "ITS TRADE",
      title: `BUY ${typeof label === "string" ? label : "ITS PICK"} · ${size} AUSD`.toUpperCase(),
      meta: [question, exit].filter(Boolean).join(" · ").toUpperCase(),
    };
  }
  const stopped = record(brief?.stoppedBy);
  const codes = policyCodes(decision);
  const why =
    stopped && typeof stopped.rule === "string"
      ? `${stopped.kind === "never" ? "NEVER" : "HELD BY"} · ${stopped.rule}`
      : codes.length
        ? policyReasonText(codes[0]!)
        : (decision.abstentionReason ?? "It stood down");
  return { trade: false, eyebrow: "STOOD DOWN", title: "NO TRADE", meta: why.toUpperCase() };
}
