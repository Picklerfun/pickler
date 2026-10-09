// Public wire format for GET /api/v1/landing. Timestamps are ISO 8601 strings;
// amounts are MON in display units.

/**
 * Which of the seven agent palette colours an agent wears. These tell agents apart and mean nothing
 * about an outcome.
 *
 * `cyan` renders **indigo**, the deep violet `#5B3CE0`. The palette the design uses has no cyan —
 * it is lime, a deep violet, amber, orange, magenta, blue and a light violet — and the deep violet
 * was the one slot with no accent name pointing at it. The name is a wart rather than a bug: agent
 * accents are stored data, so correcting the word costs a migration and buys nothing a reader of
 * this comment does not already have. The mapping lives in `apps/web/src/lib/accent.ts`.
 */
// Mirrors `ACCENTS` in core, which this package may not import; a drift test in workers/api pins it.
export const ACCENTS = ["lime", "cyan", "amber", "orange", "magenta", "violet", "blue"] as const;
export type AccentDto = (typeof ACCENTS)[number];
export type PickOutcomeDto = "open" | "won" | "lost";

export interface AgentRefDto {
  name: string;
  ticker: string;
  beat: string;
  accent: AccentDto;
  markSize: number;
}

export interface PickTrailStepDto {
  title: string;
  /** Null when the step describes the current state. */
  at: string | null;
  note: string;
  tone: "signal" | "agent" | "caution" | "win" | "loss";
  figure: { text: string; tone: "neutral" | "caution" | "win" | "loss" } | null;
}
