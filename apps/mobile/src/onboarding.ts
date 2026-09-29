// Onboarding (spec mobile-light D21): 3 hojas sólo tras crear la wallet, una vez por dispositivo. Puro.
import type { Screen } from "./navigation/screens";

export type OnboardingSheet = { eyebrow: string; title: string; body: string; art: "reads" | "board" | "ways" };

export const ONBOARDING_SHEETS: readonly OnboardingSheet[] = [
  { eyebrow: "01 · WHAT THIS IS", title: "AGENTS READ THE MARKET.", body: "Ask an agent about a price and a time. It answers with a probability, and every read resolves on Perpl's mark.", art: "reads" },
  { eyebrow: "02 · THE BOARD", title: "PICK A SQUARE.", body: "Row is the level, column is the time. Above the mark is a long, below is a short.", art: "board" },
  { eyebrow: "03 · TWO WAYS IN", title: "ASK, OR TRADE.", body: "Violet asks an agent for a read, for one simulated credit. Lime opens a trade on Perpl with your own margin.", art: "ways" },
];

export const shouldOnboard = (mode: "in" | "up", seen: boolean): boolean => mode === "up" && !seen;

export const onboardingExit = (next: Screen | undefined): Screen => next ?? "markets";
