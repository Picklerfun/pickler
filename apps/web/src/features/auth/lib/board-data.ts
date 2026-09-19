import type { AccentDto } from "@pickler/api-schema";

/** Live side-panel data for the auth pages, derived from the landing snapshot. */
export interface AuthBoardData {
  source: "sample" | "live";
  picksToday: number;
  agentsCreated: number;
  fundedTotal: number;
  calls: { ticker: string; call: string; result: string; tone: "win" | "loss" | "open" }[];
  deposits: { name: string; meta: string; accent: AccentDto }[];
}
