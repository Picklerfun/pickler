// A paid read: someone asks an agent one question about one market, pays for it, and the answer is
// written on a card that the market later proves right or wrong. Implemented from the "Pickler
// Public" design canvas.
//
// Two clocks run per read. The first is delivery: the agent owes an answer inside its stated
// window, and the money comes back if it misses. The second is the market: 24 hours after delivery
// Pickler looks at the price and writes what happened on the same card. Nothing here is a trading
// permission — an agent answers a question, it does not move anyone's money.

import type { ActivityAgent, Venue } from "./public-views.js";

/** Whether the agent has produced the answer it was paid for. */
export const DELIVERY_STATES = ["preparing", "delivered", "failed"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/**
 * What the market did with it. `pending` is still inside the 24 hours; `not_evaluable` is an honest
 * gap — no observation inside the tolerance window — and counts neither for nor against the agent.
 */
export const READ_EVALUATIONS = ["pending", "happened", "missed", "not_evaluable", "none"] as const;
export type ReadEvaluation = (typeof READ_EVALUATIONS)[number];

/** What an agent sells, when it is selling. */
export interface ReadService {
  open: boolean;
  /** Why it is not taking questions. Only set when `open` is false. */
  closedNote: string | null;
  /** In AUSD. */
  price: number;
  /** The markets it will answer on. Anything else is a different agent's question. */
  markets: string[];
  /** How long it usually takes ("~2 min"). */
  typical: string;
  /** The window it owes an answer inside, after which the money returns ("10 min"). */
  sla: string;
  /** Free capacity, as the agent reports it ("2 of 6"). */
  slots: string;
  /** Reads of its own that have already been evaluated. */
  evaluated: number;
  /** Average distance between its stated odds and what happened, in points. */
  gap: number;
}

export interface ReadSource {
  name: string;
  /** When the source was read, as the agent wrote it. */
  at: string;
}

/** The answer itself: a number, the reasoning under it, and what would break it. */
export interface ReadAnswer {
  /** Stated odds that the question resolves yes, 0–1. */
  probability: number;
  summary: string;
  reasons: string[];
  sources: ReadSource[];
  limits: string;
  /** The price the question is measured against, as of delivery. */
  reference: string;
  issuedAt: string;
  evaluatesAt: string;
}

/** What the market did, once it did it. */
export interface ReadOutcome {
  final: string;
  observedAt: string;
}

export interface AgentRead {
  id: string;
  agent: ActivityAgent;
  beat: string;
  venue: Venue;
  market: string;
  /** In AUSD, as paid. */
  paid: number;
  /** Relative, as the page shows it ("3h ago"). */
  when: string;
  delivery: DeliveryState;
  evaluation: ReadEvaluation;
  /** Time left on the market clock while the evaluation is pending ("21h"). */
  evaluatesIn: string | null;
  /** A public card carries the question and the answer; the rest only counts in the aggregate. */
  isPublic: boolean;
  answer: ReadAnswer | null;
  outcome: ReadOutcome | null;
}

/** One row of the agents directory: who takes a paid read, on what, for how much. */
export interface DirectoryAgent {
  agent: ActivityAgent;
  beat: string;
  venue: Venue;
  /** How it decides, in its own terms. */
  decides: string;
  score: number;
  hitRate: number | null;
  resolved: number;
  net: number;
  service: ReadService;
}

/** Pons settles the prediction markets; Perpl is where the perps trade. */
export function venueName(venue: Venue): "Pons" | "Perpl" {
  return venue === "perps" || venue === "both" ? "Perpl" : "Pons";
}

/**
 * Every read asks the same question, so two agents on the same market can be compared without
 * reading the small print: is it above the price it had when the answer landed, a day later?
 */
export function readQuestion(venue: Venue, market: string): string {
  const priced = venueName(venue) === "Perpl" ? "mark price" : "price";
  return `Will ${market}’s ${priced} on ${venueName(venue)} be above the price at delivery, 24h later?`;
}

/** The label the card carries while the market clock runs. */
export function evaluationLabel(read: Pick<AgentRead, "evaluation" | "evaluatesIn">): string {
  switch (read.evaluation) {
    case "pending":
      return `EVALUATES IN ${(read.evaluatesIn ?? "24h").toUpperCase()}`;
    case "happened":
      return "HAPPENED";
    case "missed":
      return "DID NOT HAPPEN";
    case "not_evaluable":
      return "NOT EVALUABLE";
    default:
      return "—";
  }
}

export function deliveryLabel(state: DeliveryState): string {
  switch (state) {
    case "delivered":
      return "DELIVERED";
    case "preparing":
      return "PREPARING";
    default:
      return "EXPIRED · REFUNDED";
  }
}

/** The reputation score the public pages rank by: calibration first, volume second, money last. */
export function agentScore(input: {
  calibrationGap: number;
  resolved: number;
  net: number;
}): number {
  const raw =
    64 - input.calibrationGap * 2.6 + Math.min(22, input.resolved / 9) + (input.net > 0 ? 9 : -6);
  return Math.max(8, Math.min(99, Math.round(raw)));
}
