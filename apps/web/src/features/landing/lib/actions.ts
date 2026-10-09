import type { AgentActionDto } from "@pickler/api-schema";
import type { Hue } from "./palette";

/**
 * The hero's bubbles, read from what the agents really did (docs/specs/marketplace-real-only-v1.md
 * N8): one action at a time, its call on the left and what came of it on the right. Pure, so a test
 * can pin the words and the cadence without a browser.
 */

export const ACTION_TICK_MS = 2400;
export const ACTIONS_REFRESH_MS = 30_000;

/** The call in a sentence: what the agent decided, with its odds and its window. */
export function callSentence(action: AgentActionDto): string {
  const market = action.instrument ? `${action.instrument}-PERP` : "the market";
  const window = action.horizonHours ? ` within ${action.horizonHours}H` : "";
  const odds =
    action.probability !== null ? `, ${action.probability.toFixed(2)} that it gets there` : "";
  switch (action.call) {
    case "open-long":
      return `Long ${market}${odds}${window}.`;
    case "open-short":
      return `Short ${market}${odds}${window}.`;
    case "close":
      return `Close ${market}.`;
    case "hold":
      return `Hold on ${market}.`;
    default:
      return `Looked at ${market}.`;
  }
}

export const OUTCOME_LABEL: Record<AgentActionDto["outcome"], string> = {
  entered: "ENTERED · ON PAPER",
  exited: "EXITED · ON PAPER",
  held: "HELD",
  blocked: "BLOCKED BY A CAP",
  proposed: "WAITING ON ITS OWNER",
};

export const OUTCOME_HUE: Record<AgentActionDto["outcome"], Hue> = {
  entered: "lime",
  exited: "lime",
  held: "amber",
  blocked: "magenta",
  proposed: "violet",
};

/** What came of it, in the runtime's words when it left any. */
export function outcomeSentence(action: AgentActionDto): string {
  if (action.outcomeText) {
    return action.outcomeText;
  }
  switch (action.outcome) {
    case "entered":
      return "The position is open, on paper.";
    case "exited":
      return "The position is closed, on paper.";
    case "held":
      return "Nothing entered: a rule held it.";
    case "blocked":
      return "Nothing entered: a cap held it.";
    case "proposed":
      return "Proposed to its owner, who decides.";
  }
}

/** "JUST NOW", "4 MIN AGO", "3 H AGO", "2 D AGO". */
export function ago(atIso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(atIso)) / 60_000));
  if (minutes < 1) {
    return "JUST NOW";
  }
  if (minutes < 60) {
    return `${minutes} MIN AGO`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} H AGO`;
  }
  return `${Math.round(hours / 24)} D AGO`;
}

/**
 * Which action is up and how far along it is. Three ticks per action: the call enters, the
 * outcome enters, both hold; then the next one. Null with nothing to show.
 */
export function exchangeAt(
  actions: readonly AgentActionDto[],
  tick: number,
): { index: number; action: AgentActionDto; answerOn: boolean } | null {
  if (actions.length === 0) {
    return null;
  }
  const index = Math.floor(tick / 3) % actions.length;
  return { index: Math.floor(tick / 3), action: actions[index]!, answerOn: tick % 3 >= 1 };
}

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
