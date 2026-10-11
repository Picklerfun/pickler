import { PilotError } from "@pickler/core";
import type { PerpsStudyScope } from "../perps-study/types.js";
import { COMPONENT_PAPER_POLICY } from "../perps-paper/types.js";
export const PTS_POLICY = {
  format: "pts-basic-policy-v1",
  version: "0.2.0",
  knowledge: "pts-course@1.0.0",
  experimental: true,
  calendar: "UTC-natural-month-Monday-week",
  minimum: { monthly: 24, weekly: 104, daily: 240, fourHourly: 180, hourly: 168 },
  pivotNeighbours: 2,
  atrDays: 14,
  formationDays: 30,
  correctionMin: "0.61",
  correctionMax: "0.78",
  boundaryTicks: 2,
  boundaryAtrFraction: "0.25",
  trigger: "0.38",
  latestFillExclusive: "0.495",
  triggerMinutes: 15,
  correctionHours: 72,
  stopTicks: 1,
  stopAtrFraction: "0.10",
  breakEven: "0.495",
  targets: ["0.61", "0.78", "1"],
  initialQuantityFractions: ["0.20", "0.20", "remainder"],
  maximumHoldingDays: 7,
  openingRiskPercent: 1,
  aggregateRiskPercent: 3,
  exitAllowanceBps: 50,
  maximumNotional: "100",
  maximumPositions: 5,
  leverage: 1,
  exposureTargetPercent: 40,
  exposureCeilingPercent: 50,
  dailyEmergencyPercent: 3,
  drawdownEmergencyPercent: 5,
} as const;
export interface PerpsPtsConfig extends PerpsStudyScope {
  version: 8;
  protocol: "perps-pts-sma-v1";
  hours: 336;
  budgetUsd: "5";
  markets: { symbol: string; marketId: number }[];
  acquisitionPolicy: typeof COMPONENT_PAPER_POLICY;
  candidate: "pts-trend-reversal@0.2.0";
  history: { file: string; sha256: string };
  /** Descriptive preparation status. Only an explicit future run can start admission. */
  preparedFor: "local-paper-only";
}
export const PTS_CATALOG = [
  { symbol: "BTC", marketId: 1 },
  { symbol: "MON", marketId: 10 },
  { symbol: "ETH", marketId: 20 },
  { symbol: "SOL", marketId: 31 },
  { symbol: "HYPE", marketId: 40 },
  { symbol: "ZEC", marketId: 50 },
  { symbol: "LIT", marketId: 60 },
  { symbol: "VVV", marketId: 70 },
  { symbol: "PUMP", marketId: 90 },
  { symbol: "NEAR", marketId: 100 },
  { symbol: "UNI", marketId: 110 },
] as const;
export function assertPtsConfig(c: PerpsPtsConfig) {
  if (
    c.version !== 8 ||
    c.protocol !== "perps-pts-sma-v1" ||
    c.hours !== 336 ||
    c.budgetUsd !== "5" ||
    c.acquisitionPolicy !== COMPONENT_PAPER_POLICY ||
    c.candidate !== "pts-trend-reversal@0.2.0" ||
    c.preparedFor !== "local-paper-only" ||
    c.network !== "mainnet" ||
    !c.tenantId ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(c.sessionId) ||
    !Array.isArray(c.markets) ||
    c.markets.length !== 11 ||
    PTS_CATALOG.some(
      (m) => !c.markets.some((v) => v.symbol === m.symbol && v.marketId === m.marketId),
    ) ||
    !c.history ||
    !/^[a-f0-9]{64}$/.test(c.history.sha256) ||
    !/^[a-zA-Z0-9_-]+\.json$/.test(c.history.file) ||
    Object.keys(c.history).some((k) => !["file", "sha256"].includes(k)) ||
    Object.keys(c).some(
      (k) =>
        ![
          "version",
          "protocol",
          "hours",
          "budgetUsd",
          "tenantId",
          "sessionId",
          "network",
          "markets",
          "acquisitionPolicy",
          "candidate",
          "history",
          "preparedFor",
        ].includes(k),
    )
  ) {
    throw new PilotError("INVALID_INPUT", "Frozen experimental PTS/SMA v8 configuration required");
  }
}
