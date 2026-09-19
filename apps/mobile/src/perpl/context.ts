import type { Address } from "viem";
import { CONTEXT_TIMEOUT_MS } from "./config";

export type Market = {
  id: number; symbol: string; name: string;
  priceDecimals: number; sizeDecimals: number; ttlBlocks: number;
  maxSlippageBps: number; maintenanceBps: number;
  /** initial_margin / 100: el exchange recorta el apalancamiento a este máximo (ruling 1). */
  maxLeverage: number;
  takerFeeMicros: number; isOpen: boolean;
  /** Precio de marca y precio de hace 24 h, escalados por priceDecimals. */
  mark: number; prev: number;
};
export type Instance = { exchange: Address; minAccountOpen: bigint; minDeposit: bigint; minWithdraw: bigint };
export type Context = { markets: Market[]; instance: Instance; geoBlock: string[]; serverTime: number | null };

type Rec = Record<string, unknown>;
const rec = (v: unknown, what: string): Rec => {
  if (v === null || typeof v !== "object") throw new Error(`Perpl context: ${what} is not an object`);
  return v as Rec;
};
const num = (r: Rec, k: string, what: string): number => {
  const v = r[k];
  if (typeof v !== "number") throw new Error(`Perpl context: ${what}.${k} is not a number`);
  return v;
};
const str = (r: Rec, k: string, what: string): string => {
  const v = r[k];
  if (typeof v !== "string") throw new Error(`Perpl context: ${what}.${k} is not a string`);
  return v;
};
const amount = (r: Rec, k: string, what: string): bigint => {
  const v = r[k];
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new Error(`Perpl context: ${what}.${k} is not an amount`);
  return BigInt(v);
};

function parseMarket(v: unknown): Market {
  const m = rec(v, "market");
  const cfg = rec(m.config, "market.config");
  const st = rec(m.state, "market.state");
  return {
    id: num(m, "id", "market"), symbol: str(m, "symbol", "market"), name: str(m, "name", "market"),
    priceDecimals: num(cfg, "price_decimals", "config"), sizeDecimals: num(cfg, "size_decimals", "config"),
    ttlBlocks: num(m, "order_ttl_blocks", "market"), maxSlippageBps: num(m, "order_max_market_slippage_bps", "market"),
    maintenanceBps: num(cfg, "maintenance_margin", "config"), maxLeverage: num(cfg, "initial_margin", "config") / 100,
    takerFeeMicros: num(cfg, "taker_fee", "config"), isOpen: cfg.is_open === true,
    mark: num(st, "mrk", "state"), prev: num(st, "prv", "state"),
  };
}

/** Lanza si el payload no tiene la forma verificada. Mercados abiertos, ordenados por id. */
export function parseContext(body: unknown): Context {
  const c = rec(body, "context");
  if (!Array.isArray(c.instances) || c.instances.length === 0) throw new Error("Perpl context: no instances");
  if (!Array.isArray(c.markets)) throw new Error("Perpl context: no markets");
  const inst = rec(c.instances[0], "instance");
  const instance: Instance = {
    exchange: str(inst, "address", "instance") as Address,
    minAccountOpen: amount(inst, "min_account_open_amount", "instance"),
    minDeposit: amount(inst, "min_deposit_amount", "instance"),
    minWithdraw: amount(inst, "min_withdraw_amount", "instance"),
  };
  const markets = c.markets.map(parseMarket).filter((m) => m.isOpen).sort((a, b) => a.id - b.id);
  const geoBlock = Array.isArray(c.geo_block) ? c.geo_block.filter((g): g is string => typeof g === "string") : [];
  return { markets, instance, geoBlock, serverTime: null };
}

/** Header `Date` (RFC 1123) → ms desde epoch; null si falta o no parsea (un CDN puede quitarlo). */
export function parseServerTime(header: string | null): number | null {
  if (!header) return null;
  const ms = Date.parse(header);
  return Number.isNaN(ms) ? null : ms;
}

export async function fetchContext(rest: string): Promise<Context> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);
  try {
    const res = await fetch(`${rest}/v1/pub/context`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Perpl responded ${res.status}`);
    const serverTime = parseServerTime(res.headers.get("date"));
    return { ...parseContext(await res.json()), serverTime };
  } finally {
    clearTimeout(timer);
  }
}
