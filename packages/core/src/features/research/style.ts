import type { UncertaintyPolicy } from "./types.js";

/** Three ways to decide, as the studio asks. Balanced is stricter than the runtime default on purpose. */
export const STYLES = ["careful", "balanced", "bold"] as const;
export type Style = (typeof STYLES)[number];

const NUMBERS: Record<Style, { minProbabilityMargin: number; maxProbabilityRangeWidth: number }> = {
  careful: { minProbabilityMargin: 0.08, maxProbabilityRangeWidth: 0.15 },
  balanced: { minProbabilityMargin: 0.04, maxProbabilityRangeWidth: 0.2 },
  bold: { minProbabilityMargin: 0.02, maxProbabilityRangeWidth: 0.3 },
};

export function policyForStyle(style: Style): UncertaintyPolicy {
  return { blockHighUncertainty: true, requireCompleteInformation: true, ...NUMBERS[style] };
}

/** The closest style over the two numbers, so a hand-edited policy still reads as one. */
export function styleForPolicy(policy: UncertaintyPolicy): Style {
  let best: Style = "balanced";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const style of STYLES) {
    const numbers = NUMBERS[style];
    const marginDelta = policy.minProbabilityMargin - numbers.minProbabilityMargin;
    const widthDelta = policy.maxProbabilityRangeWidth - numbers.maxProbabilityRangeWidth;
    const distance = marginDelta * marginDelta + widthDelta * widthDelta;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = style;
    }
  }
  return best;
}
