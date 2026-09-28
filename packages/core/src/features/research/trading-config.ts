export type TradingMode = "off" | "manual" | "automatic";
export type TradingConfig = { version: 1; mode: TradingMode };
export interface PerpsPaperConfig {
  version: 1;
  policy: "conservative-1x-v1";
}
