import {
  assertConfiguredMarket,
  configuredMarketExclusion,
  protocolForMarket,
} from "../research/market-scope.js";
import {
  PilotError,
  assertMarket,
  type AgentRecord,
  type RunRecord,
  type Market,
  type MarketData,
  type OrderBook,
} from "../research/types.js";
import { pluginEnabled, requireTool } from "../research/plugins.js";
import { nflMarketEligible } from "../research/nfl.js";

export interface PaperConditions {
  marketId: string;
  outcomeId: string;
  observedAt: string;
  minimumNotional: string;
  tickSize: string;
  feeRate: string;
  feeExponent: 1;
  provenance: string;
}
export interface PaperMarketData extends MarketData {
  conditions(marketId: string, outcomeId: string, signal: AbortSignal): Promise<PaperConditions>;
}
export interface PaperFill {
  quantity: string;
  averagePrice: string;
  fees: string;
  totalCost: string;
  levels: { price: string; quantity: string; fee: string }[];
  book: OrderBook;
  conditions: PaperConditions;
  market: Market;
}
export interface PaperOrder {
  id: string;
  tenantId: string;
  agentId: string;
  runId: string;
  marketId: string;
  outcomeId: string;
  status: "pending" | "filled" | "not_filled" | "failed" | "interrupted";
  virtualBudget: "10";
  createdAt: number;
  finishedAt: number | null;
  reason: string | null;
  fill: PaperFill | null;
}
export interface PaperRepository {
  begin(
    tenantId: string,
    runId: string,
    key: string,
  ): Promise<{ order: PaperOrder; owned: boolean }>;
  get(tenantId: string, runId: string): Promise<PaperOrder>;
  guard(order: PaperOrder): Promise<{ run: RunRecord; agent: AgentRecord }>;
  finish(
    order: PaperOrder,
    status: "filled" | "not_filled" | "failed",
    fill: PaperFill | null,
    reason: string | null,
  ): Promise<PaperOrder>;
}
export function assertPaperAllowed(
  run: Pick<RunRecord, "status" | "decision" | "configVersion">,
  agent: Pick<AgentRecord, "paused" | "version" | "config">,
  now: number,
): void {
  if (!pluginEnabled(agent.config, "paper-trading")) {
    throw new PilotError("PLUGIN_DISABLED", "Paper trading is disabled");
  }
  requireTool(agent.config, "getMarketRules");
  requireTool(agent.config, "getOrderBook");
  if (agent.paused || agent.version !== run.configVersion) {
    throw new PilotError("CONFIG_CHANGED", "Paper authorization changed");
  }
  const decision = run.decision;
  if (
    decision &&
    "schemaVersion" in decision &&
    decision.schemaVersion === 4 &&
    decision.protocol !== "nfl-winner-v1"
  ) {
    throw new PilotError(
      "PAPER_UNSUPPORTED_PROTOCOL",
      "Paper trading currently supports NFL game winners only",
    );
  }
  if (
    run.status !== "completed" ||
    !decision ||
    decision.action !== "TRADE" ||
    !("policyEvaluation" in decision) ||
    decision.policyEvaluation.finalAction !== "TRADE" ||
    !decision.outcomeId ||
    !decision.limitPrice ||
    !decision.expiresAt ||
    !(Date.parse(decision.expiresAt) > now)
  ) {
    throw new PilotError(
      "PAPER_NOT_ELIGIBLE",
      "Requires a current completed policy-approved trade",
    );
  }
}
export function assertPaperFillCurrent(fill: PaperFill, run: RunRecord, now: number): void {
  if (run.config.marketScope) {
    assertConfiguredMarket(fill.market, run.config, now);
  } else {
    assertMarket(fill.market, run.config.categoryIds ?? [], now);
  }
  if (
    configuredMarketExclusion(fill.market, run.config, now) ||
    (run.config.marketScope && protocolForMarket(fill.market, run.config) !== "nfl-winner-v1") ||
    ((run.config.researchProtocol || run.config.marketScope) && !nflMarketEligible(fill.market))
  ) {
    throw new PilotError("PAPER_MARKET_INELIGIBLE", "Market eligibility expired before commit");
  }
  for (const timestamp of [fill.book.observedAt, fill.conditions.observedAt]) {
    if (
      !Number.isFinite(Date.parse(timestamp)) ||
      Date.parse(timestamp) > now ||
      now - Date.parse(timestamp) > 30000
    ) {
      throw new PilotError("PAPER_STALE_QUOTE", "Observation expired before commit");
    }
  }
}
const SCALE = 100000000n;
function fixed(value: string): bigint {
  if (!/^\d+(\.\d{1,8})?$/.test(value)) {
    throw new PilotError("PAPER_INVALID_CONDITIONS", "Expected a bounded nonnegative decimal");
  }
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole!) * SCALE + BigInt(fraction.padEnd(8, "0"));
  if (result > 100000000000000000000n) {
    throw new PilotError("PAPER_INVALID_CONDITIONS", "Decimal exceeds simulation bound");
  }
  return result;
}
function format(value: bigint): string {
  return `${value / SCALE}.${(value % SCALE).toString().padStart(8, "0")}`;
}
/** Deterministic full-budget fill. Integer arithmetic, rounded per-level fee estimates. */
export function simulatePaperBuy(
  market: Market,
  book: OrderBook,
  conditions: PaperConditions,
  limit: string,
  now: number,
): { fill: PaperFill | null; reason: string | null } {
  if (
    book.outcomeId !== conditions.outcomeId ||
    conditions.marketId !== market.id ||
    !market.outcomes.some((o) => o.id === book.outcomeId)
  ) {
    throw new PilotError("PAPER_INVALID_CONDITIONS", "Market/outcome mismatch");
  }
  for (const date of [book.observedAt, conditions.observedAt]) {
    if (
      !Number.isFinite(Date.parse(date)) ||
      Date.parse(date) > now ||
      now - Date.parse(date) > 30000
    ) {
      throw new PilotError(
        "PAPER_STALE_QUOTE",
        "Simulation requires observations within thirty seconds",
      );
    }
  }
  const tick = fixed(conditions.tickSize);
  const rate = fixed(conditions.feeRate);
  const cap = fixed(limit);
  const budget = 10n * SCALE;
  if (
    !tick ||
    tick >= SCALE ||
    cap <= 0n ||
    cap >= SCALE ||
    cap % tick !== 0n ||
    rate > SCALE ||
    conditions.feeExponent !== 1
  ) {
    throw new PilotError("PAPER_INVALID_CONDITIONS", "Unsupported tick, limit or fee curve");
  }
  if (fixed(conditions.minimumNotional) > budget) {
    return { fill: null, reason: "BELOW_MINIMUM_ORDER" };
  }
  let remaining = budget;
  let shares = 0n;
  let notional = 0n;
  let fees = 0n;
  const levels: PaperFill["levels"] = [];
  const asks = book.asks
    .map((l) => ({ price: fixed(l.price), size: fixed(l.size) }))
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  for (const level of asks) {
    if (level.price <= 0n || level.price >= SCALE || level.price % tick !== 0n) {
      throw new PilotError("PAPER_INVALID_CONDITIONS", "Invalid order book level");
    }
    if (level.price > cap) {
      break;
    }
    // Quantities use six decimal places; fees use five as documented by Polymarket.
    const fee = (q: bigint) => {
      const raw = (q * rate * level.price * (SCALE - level.price)) / SCALE ** 3n;
      return ((raw + 500n) / 1000n) * 1000n;
    };
    const cost = (q: bigint) => (q * level.price + SCALE - 1n) / SCALE + fee(q);
    let low = 0n;
    let high = level.size / 100n;
    while (low < high) {
      const middle = (low + high + 1n) / 2n;
      if (cost(middle * 100n) <= remaining) {
        low = middle;
      } else {
        high = middle - 1n;
      }
    }
    const quantity = low * 100n;
    if (!quantity) {
      continue;
    }
    const charge = fee(quantity);
    const paid = cost(quantity);
    remaining -= paid;
    shares += quantity;
    fees += charge;
    notional += paid - charge;
    levels.push({ price: format(level.price), quantity: format(quantity), fee: format(charge) });
    if (remaining <= 1000n) {
      break;
    }
  }
  if (remaining > 1000n || shares === 0n) {
    return { fill: null, reason: "INSUFFICIENT_DEPTH_AT_LIMIT" };
  }
  if (notional < fixed(conditions.minimumNotional)) {
    return { fill: null, reason: "BELOW_MINIMUM_ORDER" };
  }
  return {
    reason: null,
    fill: {
      quantity: format(shares),
      averagePrice: format((notional * SCALE) / shares),
      fees: format(fees),
      totalCost: format(budget - remaining),
      levels,
      book,
      conditions,
      market,
    },
  };
}
export function createPaperService(
  repository: PaperRepository,
  markets: PaperMarketData,
  now = Date.now,
) {
  return {
    get: (tenantId: string, runId: string) => repository.get(tenantId, runId),
    async create(tenantId: string, runId: string, key: string): Promise<PaperOrder> {
      const { order, owned } = await repository.begin(tenantId, runId, key);
      if (!owned) {
        return order;
      }
      const signal = AbortSignal.timeout(55000);
      try {
        const { run } = await repository.guard(order);
        const market = await markets.get(order.marketId, signal);
        if (run.config.marketScope) {
          assertConfiguredMarket(market, run.config, now());
          if (protocolForMarket(market, run.config) !== "nfl-winner-v1") {
            throw new PilotError(
              "PAPER_UNSUPPORTED_PROTOCOL",
              "Paper requires NFL winner protocol",
            );
          }
        } else {
          assertMarket(market, run.config.categoryIds ?? [], now());
        }
        if (
          configuredMarketExclusion(market, run.config, now()) ||
          (run.config.researchProtocol && !nflMarketEligible(market))
        ) {
          throw new PilotError("PAPER_MARKET_INELIGIBLE", "Market no longer eligible");
        }
        await repository.guard(order);
        signal.throwIfAborted();
        const conditions = await markets.conditions(order.marketId, order.outcomeId, signal);
        await repository.guard(order);
        signal.throwIfAborted();
        const book = await markets.book(order.outcomeId, signal);
        await repository.guard(order);
        signal.throwIfAborted();
        if (configuredMarketExclusion(market, run.config, now())) {
          throw new PilotError("PAPER_MARKET_INELIGIBLE", "Event eligibility expired");
        }
        const result = simulatePaperBuy(market, book, conditions, run.decision!.limitPrice!, now());
        return await repository.finish(
          order,
          result.fill ? "filled" : "not_filled",
          result.fill,
          result.reason,
        );
      } catch (error) {
        if (error instanceof PilotError && error.code === "LEASE_LOST") {
          throw error;
        }
        return repository.finish(
          order,
          "failed",
          null,
          error instanceof PilotError ? error.code : "PAPER_PROVIDER_FAILURE",
        );
      }
    },
  };
}
