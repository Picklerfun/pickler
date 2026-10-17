import { PilotError } from "@pickler/core";
import type {
  PerplLiveAuthority,
  PerplLiveMarket,
  PerplLiveSettings,
  PerplLiveDocument,
  PerplLiveSession,
  PerplLivePosition,
} from "./contracts.js";

export function liveAmount(value: string): bigint {
  if (!/^[1-9]\d{0,23}$/.test(value)) {
    throw new PilotError("INVALID_INPUT", "A positive atomic AUSD amount is required");
  }
  return BigInt(value);
}
export function assertLiveAuthority(authority: PerplLiveAuthority, increasing: boolean) {
  if (increasing && authority.network !== "testnet") {
    throw new PilotError("PERPL_TESTNET_ONLY", "Perpl execution requires Monad testnet");
  }
  if (increasing && (!authority.enabled || authority.killed || authority.paused)) {
    throw new PilotError("PERPL_ENTRIES_PAUSED", "New entries are paused");
  }
}
export function assertLiveSettings(settings: PerplLiveSettings, authority: PerplLiveAuthority) {
  assertLiveAuthority(authority, true);
  if (!authority.markets.includes(settings.symbol)) {
    throw new PilotError("PERPL_MARKET_NOT_ALLOWED", "Select a market authorized for this agent");
  }
  const margin = liveAmount(settings.marginMicros);
  if (margin > BigInt(authority.perCallMicros)) {
    throw new PilotError("PERPL_MARGIN_LIMIT", "Margin exceeds the per-trade limit");
  }
  if (
    settings.leverage !== 1 ||
    !Number.isInteger(settings.cycles) ||
    settings.cycles < 1 ||
    settings.cycles > 3 ||
    !Number.isInteger(settings.holdSeconds) ||
    settings.holdSeconds < 30 ||
    settings.holdSeconds > 3600
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "Use 1x leverage, 1–3 cycles and a 30–3600 second holding period",
    );
  }
  if (margin * BigInt(settings.cycles) > BigInt(authority.perDayMicros)) {
    throw new PilotError("PERPL_DAY_LIMIT", "Cycles exceed the daily margin limit");
  }
}
/** Real venue sizing, in scaled base-asset units; paper fill prices are never reused. */
export function liveOrderSize(
  marginMicros: string,
  leverage: number,
  market: PerplLiveMarket,
): number {
  if (
    !Number.isSafeInteger(market.mark) ||
    market.mark <= 0 ||
    !Number.isInteger(market.priceDecimals) ||
    !Number.isInteger(market.sizeDecimals) ||
    market.priceDecimals < 0 ||
    market.sizeDecimals < 0 ||
    market.priceDecimals + market.sizeDecimals > 30 ||
    leverage > market.maxLeverage ||
    !Number.isSafeInteger(market.maxSlippageBps) ||
    market.maxSlippageBps < 0 ||
    market.maxSlippageBps > 10000 ||
    !Number.isSafeInteger(market.ttlBlocks) ||
    market.ttlBlocks < 1 ||
    !Number.isSafeInteger(market.takerFeeMicros) ||
    market.takerFeeMicros < 0
  ) {
    throw new PilotError("PERPL_INVALID_MARKET", "Market execution metadata is unavailable");
  }
  // The requested margin is a ceiling even at the worst authorized opening price.
  const size =
    (liveAmount(marginMicros) *
      BigInt(leverage) *
      10n ** BigInt(market.priceDecimals + market.sizeDecimals) *
      10000n) /
    (BigInt(market.mark) * 1_000_000n * BigInt(10000 + market.maxSlippageBps));
  if (size < 1n || size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PilotError("PERPL_INVALID_SIZE", "Order size is outside exact integer bounds");
  }
  return Number(size);
}

/** Verified net fills alone authorize a session position, including partial reductions. */
export function isPerplSessionPosition(
  document: PerplLiveDocument,
  session: PerplLiveSession,
  position: PerplLivePosition,
) {
  const facts = document.facts?.session;
  if (facts?.id === session.id) {
    return (
      !position.closed &&
      Number.isSafeInteger(facts.remaining) &&
      facts.remaining > 0 &&
      position.size === facts.remaining &&
      position.leverage === facts.openingLeverage &&
      facts.filledRequestIds.includes(position.requestId)
    );
  }
  const ownOrders = document.orders.filter((order) => order.sessionId === session.id);
  const opening = [...ownOrders]
    .reverse()
    .find((order) => order.request.t <= 2 && order.evidence?.filledSize);
  const remaining = ownOrders.reduce((size, order) => {
    const filled = order.evidence?.filledSize ?? 0;
    return order.request.t <= 2 ? size + filled : size - filled;
  }, 0);
  return (
    !position.closed &&
    !!opening &&
    Number.isSafeInteger(remaining) &&
    remaining > 0 &&
    position.size === remaining &&
    position.leverage === opening.request.lv &&
    ownOrders.some(
      (order) => order.request.rq === position.requestId && !!order.evidence?.filledSize,
    )
  );
}
