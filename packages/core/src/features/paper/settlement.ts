import { PilotError, type AgentRecord, type Scope } from "../research/types.js";
import { pluginEnabled, requireTool } from "../research/plugins.js";
import type { PaperOrder } from "./orders.js";

export interface PaperResolution {
  marketId: string;
  outcomeId: string;
  conditionId: string;
  outcomeIndex: number;
  numerator: string;
  denominator: string;
  observedAt: string;
  chainId: 137;
  contract: string;
  blockNumber: string;
  blockHash: string;
}
export interface PaperSettlement {
  version: 1;
  settledAt: number;
  payout: string;
  realizedPnl: string;
  resolution: PaperResolution;
}
export interface PaperSummary {
  filled: number;
  open: number;
  settled: number;
  totalCost: string;
  openCost: string;
  payouts: string;
  realizedPnl: string;
  netCashFlow: string;
}
export interface PaperResolutionProvider {
  resolution(
    order: PaperOrder,
    signal: AbortSignal,
    beforeCall?: () => Promise<void>,
  ): Promise<PaperResolution | null>;
}
export interface PaperSettlementRepository {
  get(tenantId: string, runId: string): Promise<PaperOrder>;
  authorizeSettlement(order: PaperOrder): Promise<number>;
  settle(
    order: PaperOrder,
    resolution: PaperResolution,
    expectedVersion: number,
  ): Promise<PaperOrder>;
  summary(scope: Scope): Promise<PaperSummary>;
}

/** Historical positions remain visible; disabled integrations cannot fetch or settle anew. */
export function assertPaperSettlementAccess(agent: AgentRecord): void {
  if (!pluginEnabled(agent.config, "paper-trading")) {
    throw new PilotError("PLUGIN_DISABLED", "Paper trading is disabled");
  }
  requireTool(agent.config, "getMarketRules");
}
const scale = 100000000n;
function units(value: string): bigint {
  if (!/^\d+(\.\d{1,8})?$/.test(value) || value.length > 30) {
    throw new PilotError("PAPER_INVALID_SETTLEMENT", "Invalid decimal amount");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * scale + BigInt(fraction.padEnd(8, "0"));
}
function decimal(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${magnitude / scale}.${String(magnitude % scale).padStart(8, "0")}`;
}
export function settlePaperOrder(
  order: PaperOrder,
  resolution: PaperResolution,
  now: number,
): PaperSettlement {
  const identity = order.fill?.conditions.resolution;
  if (
    order.status !== "filled" ||
    !order.fill ||
    !identity ||
    resolution.marketId !== order.marketId ||
    resolution.outcomeId !== order.outcomeId ||
    resolution.conditionId !== identity.conditionId ||
    resolution.outcomeIndex !== identity.outcomeIndex ||
    resolution.chainId !== 137 ||
    !/^0x[0-9a-fA-F]{40}$/.test(resolution.contract) ||
    !/^0x[0-9a-fA-F]{64}$/.test(resolution.blockHash) ||
    !/^\d{1,20}$/.test(resolution.blockNumber) ||
    !/^\d{1,78}$/.test(resolution.numerator) ||
    !/^\d{1,78}$/.test(resolution.denominator) ||
    !Number.isFinite(Date.parse(resolution.observedAt)) ||
    Date.parse(resolution.observedAt) > now ||
    Date.parse(resolution.observedAt) < order.finishedAt!
  ) {
    throw new PilotError(
      "PAPER_INVALID_SETTLEMENT",
      "Resolution does not match the immutable paper position",
    );
  }
  const numerator = BigInt(resolution.numerator);
  const denominator = BigInt(resolution.denominator);
  if (denominator <= 0n || numerator > denominator) {
    throw new PilotError("PAPER_INVALID_SETTLEMENT", "Invalid finalized payout fraction");
  }
  // Conservative truncation to collateral precision (six decimals), including split payouts.
  const payout = ((units(order.fill.quantity) * numerator) / denominator / 100n) * 100n;
  return {
    version: 1,
    settledAt: now,
    payout: decimal(payout),
    realizedPnl: decimal(payout - units(order.fill.totalCost)),
    resolution,
  };
}
export function summarizePaperOrders(orders: PaperOrder[]): PaperSummary {
  let total = 0n,
    openCost = 0n,
    settledCost = 0n,
    payouts = 0n;
  let filled = 0,
    settled = 0;
  for (const order of orders) {
    if (order.status !== "filled" || !order.fill) {
      continue;
    }
    filled++;
    const cost = units(order.fill.totalCost);
    total += cost;
    if (order.settlement) {
      settled++;
      settledCost += cost;
      payouts += units(order.settlement.payout);
    } else {
      openCost += cost;
    }
  }
  return {
    filled,
    open: filled - settled,
    settled,
    totalCost: decimal(total),
    openCost: decimal(openCost),
    payouts: decimal(payouts),
    realizedPnl: decimal(payouts - settledCost),
    netCashFlow: decimal(payouts - total),
  };
}
export function createPaperSettlementService(
  repository: PaperSettlementRepository,
  provider: PaperResolutionProvider,
) {
  return {
    summary: (scope: Scope) => repository.summary(scope),
    async settle(tenantId: string, runId: string): Promise<PaperOrder> {
      const order = await repository.get(tenantId, runId);
      if (order.settlement) {
        return order;
      }
      if (order.status !== "filled" || !order.fill) {
        throw new PilotError("PAPER_NOT_FILLED", "Only filled paper positions can be settled");
      }
      const version = await repository.authorizeSettlement(order);
      const signal = AbortSignal.timeout(55000);
      const beforeCall = async () => {
        signal.throwIfAborted();
        if ((await repository.authorizeSettlement(order)) !== version) {
          throw new PilotError("CONFIG_CHANGED", "Paper configuration changed during resolution");
        }
      };
      const resolution = await provider.resolution(order, signal, beforeCall);
      signal.throwIfAborted();
      const currentVersion = await repository.authorizeSettlement(order);
      if (version !== currentVersion) {
        throw new PilotError("CONFIG_CHANGED", "Paper configuration changed during resolution");
      }
      return resolution
        ? repository.settle(order, resolution, version)
        : repository.get(tenantId, runId);
    },
  };
}

/** Immutable public identity, also usable for forecasts without a purchase. */
export interface PaperResolutionIdentity {
  marketId: string;
  outcomeId: string;
  conditionId: string;
  outcomeIndex: number;
  outcomeCount: number;
}
