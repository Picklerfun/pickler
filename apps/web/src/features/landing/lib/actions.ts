import type { AgentActionDto } from "@pickler/api-schema";

/**
 * The tape's words for what the agents really did (docs/specs/marketplace-real-only-v1.md N8).
 * Pure, so a test can pin them without a browser.
 */

export const OUTCOME_LABEL: Record<AgentActionDto["outcome"], string> = {
  entered: "ENTERED · ON PAPER",
  exited: "EXITED · ON PAPER",
  held: "HELD",
  blocked: "BLOCKED BY A CAP",
  proposed: "WAITING ON ITS OWNER",
};

/** One tape entry: who, the call in three words, and what came of it, with its tone. */
export function tapeEntry(action: AgentActionDto): {
  who: string;
  call: string;
  outcome: string;
  tone: "win" | "caution" | "loss" | "neutral";
} {
  const market = action.instrument ? `${action.instrument}-PERP` : "";
  const window = action.horizonHours ? ` · ${action.horizonHours}H` : "";
  const verb =
    action.call === "open-long"
      ? "LONG"
      : action.call === "open-short"
        ? "SHORT"
        : action.call === "close"
          ? "CLOSE"
          : "HOLD";
  const tone =
    action.outcome === "entered" || action.outcome === "exited"
      ? "win"
      : action.outcome === "held" || action.outcome === "proposed"
        ? "caution"
        : action.outcome === "blocked"
          ? "loss"
          : "neutral";
  return {
    who: action.agent.ticker ?? `@${action.agent.handle}`,
    call: `${verb} ${market}${window}`.trim(),
    outcome: action.outcomeText ?? OUTCOME_LABEL[action.outcome],
    tone,
  };
}
