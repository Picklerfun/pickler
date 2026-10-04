export const CHECK_OUTCOMES = [
  "entered",
  "exited",
  "held",
  "blocked",
  "proposed",
  "skipped",
  "failed",
  "system",
] as const;
export type PerpsCheckOutcome = (typeof CHECK_OUTCOMES)[number];
