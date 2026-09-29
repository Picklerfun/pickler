/**
 * The paper run's result card (§5, §3.5): ITS TRADE with our pick in our format — outcome, market
 * and size, the size capped by the per-trade cap within the paper budget (§3.3) — or STOOD DOWN ·
 * NO TRADE with the brief rule that stopped it. Read from the run and its own events, so it says
 * only what the runtime wrote. Pure, pinned in `apps/web/test/studio-brief-run.test.ts`.
 */
import type { PreviewRun, RunEvent } from "../api";
import { PAPER_BUDGET_AUSD } from "./model";

export interface RunResult {
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
  const why =
    stopped && typeof stopped.rule === "string"
      ? `${stopped.kind === "never" ? "NEVER" : "HELD BY"} · ${stopped.rule}`
      : (decision.abstentionReason ?? "It stood down");
  return { trade: false, eyebrow: "STOOD DOWN", title: "NO TRADE", meta: why.toUpperCase() };
}
