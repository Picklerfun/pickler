import type { AgentConfig } from "./types.js";
export type TradingMode = "off" | "manual" | "automatic";
export type TradingConfig = { version: 1; mode: TradingMode };
export interface PerpsPaperConfig {
  version: 1;
  policy: "conservative-1x-v1";
}

/** Persisted product selection is configuration, not a new harness plugin. */
export const STUDIO_PERPS_STRATEGY_IDS = ["rules", "deepseek", "jev", "combined"] as const;
export interface StudioPerpsStrategySelection {
  id: (typeof STUDIO_PERPS_STRATEGY_IDS)[number];
  version: "2.0.0" | "2.1.0";
}
export function effectiveStudioStrategy(config: AgentConfig): StudioPerpsStrategySelection {
  return config.perpsStrategy ?? { id: "combined", version: "2.0.0" };
}
