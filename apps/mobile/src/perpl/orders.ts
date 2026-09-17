import { AUSD_DECIMALS } from "../config/chain";
import { LEVERAGES } from "./config";
import type { Market } from "./context";

export type Side = "long" | "short";
/** 1 OpenLong · 2 OpenShort · 3 CloseLong · 4 CloseShort */
export type OrderType = 1 | 2 | 3 | 4;
export type OrderIntent = { mkt: number; acc: number; t: OrderType; s: number; ms: number; lv: number; ttl: number };
export type OrderRequest = { mt: 22; sn: number; rq: number; mkt: number; acc: number; t: OrderType; p: 0; s: number; fl: 4; ms: number; lv: number; lb: number };
export type PositionLike = { mkt: number; sd: 1 | 2; s: number; ep: number; lv: number };

const AUSD_UNIT = 10n ** BigInt(AUSD_DECIMALS);
const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** floor(ausd × lv × 10^(pd+sd) / (mark × 10^6)) en unidades escaladas del activo. */
export function sizeFromAusd(ausd: bigint, lv: number, mark: number, pd: number, sd: number): number {
  if (mark <= 0) return 0;
  return Number((ausd * BigInt(lv) * pow10(pd + sd)) / (BigInt(mark) * AUSD_UNIT));
}

export function notionalAusd(size: number, mark: number, pd: number, sd: number): bigint {
  return (BigInt(size) * BigInt(mark) * AUSD_UNIT) / pow10(pd + sd);
}

/** El exchange redondea la fee hacia arriba (fixture: 766.2 → 767). */
export function takerFee(notional: bigint, takerFeeMicros: number): bigint {
  const raw = notional * BigInt(takerFeeMicros);
  return (raw + 999_999n) / 1_000_000n;
}

/**
 * Estimación. Mantenimiento = (maintenanceBps / 10000) / maxLeverage del nominal (ruling 2).
 * long: entry × (1 − 1/lv + mm) · short: entry × (1 + 1/lv − mm), en enteros escalados.
 */
export function liquidationPrice(entry: number, lv: number, side: Side, maintenanceBps: number, maxLeverage: number): number {
  const den = 10_000 * maxLeverage * lv;
  const num = side === "long"
    ? den - 10_000 * maxLeverage + maintenanceBps * lv
    : den + 10_000 * maxLeverage - maintenanceBps * lv;
  return Math.max(0, Math.round((entry * num) / den));
}

/** PnL no realizado en AUSD: (mark − entry) × size, con signo según el lado. */
export function positionPnl(p: PositionLike, mark: number, pd: number, sd: number): bigint {
  const diff = BigInt(mark - p.ep) * BigInt(p.s) * AUSD_UNIT / pow10(pd + sd);
  return p.sd === 1 ? diff : -diff;
}

export function change24h(mark: number, prev: number): number {
  return prev > 0 ? (mark - prev) / prev : 0;
}

export function leveragesFor(market: { maxLeverage: number }): number[] {
  const allowed = LEVERAGES.filter((lv) => lv <= market.maxLeverage);
  return allowed.length > 0 ? allowed : [1];
}

export function openIntent(market: Market, acc: number, side: Side, size: number, lv: number): OrderIntent {
  return { mkt: market.id, acc, t: side === "long" ? 1 : 2, s: size, ms: market.maxSlippageBps, lv: lv * 100, ttl: market.ttlBlocks };
}

export function closeIntent(market: Market, acc: number, position: PositionLike): OrderIntent {
  return { mkt: market.id, acc, t: position.sd === 1 ? 3 : 4, s: position.s, ms: market.maxSlippageBps, lv: position.lv, ttl: market.ttlBlocks };
}

/** Orden de mercado IOC. `rq` y `lb` los decide el socket (rq = max(lfr, último) + 1; lb = head + ttl). */
export function orderFrame(intent: OrderIntent, seq: { sn: number; rq: number; head: number }): OrderRequest {
  return { mt: 22, sn: seq.sn, rq: seq.rq, mkt: intent.mkt, acc: intent.acc, t: intent.t, p: 0, s: intent.s, fl: 4, ms: intent.ms, lv: intent.lv, lb: seq.head + intent.ttl };
}

export type OrderStatusKind = "sent" | "filled" | "open" | "failed";

const FAILED_COPY: Record<number, string> = {
  32: "Order id too low — try again",
  34: "One-click trading is off. Enable trading again",
  37: "Not enough collateral for this size",
  39: "Below the market minimum",
  40: "Price out of range",
  42: "Size out of range",
  44: "Couldn't settle — try a smaller size",
};

export function describeOrderStatus(st: number, sr?: number, fr?: number): { kind: OrderStatusKind; text: string } {
  if (st === 4) return { kind: "filled", text: "Filled" };
  if (st === 2 || st === 3) return { kind: "open", text: "Placed" };
  if (st === 5) return { kind: "failed", text: "Canceled — nothing filled" };
  if (st === 6) return { kind: "failed", text: "Expired before it could fill" };
  if (st === 7) {
    if (fr === 8 || sr === 37) return { kind: "failed", text: FAILED_COPY[37] };
    return { kind: "failed", text: (sr !== undefined && FAILED_COPY[sr]) || `Failed (sr ${sr ?? 0})` };
  }
  return { kind: "sent", text: "Sent" };
}

function scaled(value: number, decimals: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(value).toString().padStart(decimals + 1, "0");
  if (decimals === 0) return sign + digits;
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
export const formatPrice = (price: number, pd: number): string => scaled(price, pd);
export const formatSize = (size: number, sd: number): string => scaled(size, sd);
