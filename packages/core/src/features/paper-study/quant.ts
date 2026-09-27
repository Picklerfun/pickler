import { PilotError, type OrderBook } from "../research/types.js";
import { simulatePaperBuy, type PaperConditions, type PaperFill } from "../paper/orders.js";
import { assertStudyMarket, type StudyMarket } from "./study.js";

export const QUANT_PROTOCOL = "btc-quant-jev-v1" as const;
export type QuantPlugin = "polymarket" | "coinbase" | "jev";
export interface QuantInput {
  item: StudyMarket;
  rule: { version: 1; lookbackSeconds: number; provenance: string; tie: "up" };
  opening: { price: number; observedAt: number; url: string };
  ticker: { price: number; bid: number; ask: number; observedAt: number; url: string };
  candles: { time: number; close: number }[];
  books: OrderBook[];
  conditions: PaperConditions[];
  observedAt: number;
}
export interface QuantProbability {
  outcomeId: string;
  label: "Up" | "Down";
  lower: number;
  estimate: number;
  upper: number;
}
export interface QuantForecast {
  protocol: typeof QUANT_PROTOCOL;
  observedAt: number;
  formula: "normal-arithmetic-terminal-average-v1";
  sigmaPerSecond: number;
  trend60Minutes: number;
  horizonSeconds: number;
  lookbackSeconds: number;
  basisFraction: number;
  probabilities: QuantProbability[];
  limitations: string[];
}
export interface QuantProposal {
  outcomeId: string;
  limitPrice: string;
  conservativeEdge: number;
  effectiveCost: number;
  fill: PaperFill;
}
export interface QuantReview {
  status: "started" | "completed" | "failed";
  inputTokens: number | null;
  outputTokens: number | null;
  veto?: boolean;
  answers?: unknown;
  diagnostics?: unknown;
  reason?: string;
  durationMs?: number;
}
const fail = (code: string): never => {
  throw new PilotError(code, code);
};
/** CDF approximation; error below 1e-7, not a calibration claim. */
export function normalCdf(x: number): number {
  const a = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * a);
  const tail =
    (Math.exp((-a * a) / 2) / Math.sqrt(2 * Math.PI)) *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}
export function quantForecast(input: QuantInput, now: number): QuantForecast {
  assertStudyMarket(input.item, now);
  if (input.item.kind === "sports") {
    return fail("QUANT_BTC_ONLY");
  }
  const { ticker, candles, opening, rule } = input;
  if (
    !Number.isFinite(now) ||
    ticker.observedAt > now ||
    now - ticker.observedAt > 10000 ||
    ![ticker.price, ticker.bid, ticker.ask, opening.price].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    ticker.ask < ticker.bid
  ) {
    return fail("QUANT_STALE_TICKER");
  }
  const horizonSeconds = (input.item.windowEnd - now) / 1000;
  if (
    rule.version !== 1 ||
    ![30, 60].includes(rule.lookbackSeconds) ||
    rule.tie !== "up" ||
    horizonSeconds < rule.lookbackSeconds
  ) {
    return fail("QUANT_RESOLUTION_RULES");
  }
  // Sixty returns require sixty-one consecutive complete candle closes.
  if (
    candles.length !== 61 ||
    candles.some(
      (c, i) =>
        !Number.isFinite(c.close) ||
        c.close <= 0 ||
        !Number.isInteger(c.time) ||
        c.time % 60000 !== 0 ||
        (i > 0 && c.time - candles[i - 1]!.time !== 60000),
    ) ||
    candles[60]!.time + 60000 > now ||
    now - (candles[60]!.time + 60000) > 90000
  ) {
    return fail("QUANT_CANDLE_GAP");
  }
  const returns = candles.slice(1).map((c, i) => Math.log(c.close / candles[i]!.close));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const sigmaPerSecond = Math.sqrt(variance / 60);
  if (!Number.isFinite(sigmaPerSecond) || sigmaPerSecond <= 1e-12) {
    return fail("QUANT_DEGENERATE_VOLATILITY");
  }
  const basisFraction = Math.max(0.0005, (ticker.ask - ticker.bid) / ticker.price);
  const probability = (scale: number, basis: number) => {
    const spot = ticker.price * (1 + basis);
    const sd =
      spot * sigmaPerSecond * scale * Math.sqrt(horizonSeconds - (2 * rule.lookbackSeconds) / 3);
    return normalCdf((spot - opening.price) / sd);
  };
  const estimate = probability(1, 0);
  const values = [0.75, 1, 1.25].flatMap((scale) =>
    [-basisFraction, 0, basisFraction].map((b) => probability(scale, b)),
  );
  const lower = Math.min(...values),
    upper = Math.max(...values);
  const up = input.item.market.outcomes.find((o) => o.label.toLowerCase() === "up");
  const down = input.item.market.outcomes.find((o) => o.label.toLowerCase() === "down");
  if (!up || !down) {
    return fail("QUANT_OUTCOME_IDENTITY");
  }
  return {
    protocol: QUANT_PROTOCOL,
    observedAt: now,
    formula: "normal-arithmetic-terminal-average-v1",
    sigmaPerSecond,
    trend60Minutes: Math.exp(returns.reduce((a, b) => a + b, 0)) - 1,
    horizonSeconds,
    lookbackSeconds: rule.lookbackSeconds,
    basisFraction,
    probabilities: [
      { outcomeId: up.id, label: "Up", lower, estimate, upper },
      {
        outcomeId: down.id,
        label: "Down",
        lower: 1 - upper,
        estimate: 1 - estimate,
        upper: 1 - lower,
      },
    ],
    limitations: [
      "Experimental uncalibrated arithmetic-price approximation with zero drift.",
      "Coinbase is predictive reference data, not the official resolution feed.",
      "Sensitivity bounds use assumed basis and volatility shocks, not calibrated confidence intervals.",
    ],
  };
}
/** The simulator includes fees/depth; pick the best affordable full-budget outcome. */
export function quantProposal(
  input: QuantInput,
  forecast: QuantForecast,
  now: number,
): { proposal: QuantProposal | null; reasons: string[] } {
  const candidates: QuantProposal[] = [],
    reasons: string[] = [];
  for (const probability of forecast.probabilities) {
    const book = input.books.find((b) => b.outcomeId === probability.outcomeId);
    const conditions = input.conditions.find((c) => c.outcomeId === probability.outcomeId);
    if (!book || !conditions) {
      return fail("QUANT_MARKET_CONDITIONS_MISSING");
    }
    const tick = Number(conditions.tickSize),
      rate = Number(conditions.feeRate);
    if (!(tick > 0 && tick < 1 && rate >= 0 && rate <= 1)) {
      return fail("PAPER_INVALID_CONDITIONS");
    }
    // p + fee per share must stay strictly below the conservative probability less 3pp.
    let low = 0,
      high = Math.floor((1 - 1e-10) / tick);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2),
        price = mid * tick;
      if (price + rate * price * (1 - price) < probability.lower - 0.03 - 1e-8) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    if (!low) {
      reasons.push(`${probability.label}:INSUFFICIENT_EDGE`);
      continue;
    }
    const limitPrice = (low * tick).toFixed(8);
    const simulated = simulatePaperBuy(input.item.market, book, conditions, limitPrice, now);
    if (!simulated.fill) {
      reasons.push(`${probability.label}:${simulated.reason}`);
      continue;
    }
    const effectiveCost = Number(simulated.fill.totalCost) / Number(simulated.fill.quantity);
    const conservativeEdge = probability.lower - effectiveCost;
    if (conservativeEdge <= 0.03 + 1e-10) {
      reasons.push(`${probability.label}:INSUFFICIENT_EDGE`);
      continue;
    }
    candidates.push({
      outcomeId: probability.outcomeId,
      limitPrice,
      conservativeEdge,
      effectiveCost,
      fill: simulated.fill,
    });
  }
  candidates.sort(
    (a, b) => b.conservativeEdge - a.conservativeEdge || a.outcomeId.localeCompare(b.outcomeId),
  );
  return { proposal: candidates[0] ?? null, reasons };
}
