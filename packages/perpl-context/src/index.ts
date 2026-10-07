// The venue as Perpl publishes it at GET /v1/pub/context: what the mobile app sizes its orders
// from and what the web's market board lists. One parser, so the two cannot disagree.

export type Market = {
  id: number;
  symbol: string;
  name: string;
  priceDecimals: number;
  sizeDecimals: number;
  ttlBlocks: number;
  maxSlippageBps: number;
  maintenanceBps: number;
  /** initial_margin / 100: the exchange clamps leverage to this maximum. */
  maxLeverage: number;
  takerFeeMicros: number;
  isOpen: boolean;
  /** Mark price and the price 24 hours ago, scaled by priceDecimals. */
  mark: number;
  prev: number;
  /** The asset a size is counted in ("BTC"). Null when the venue does not say. */
  sizeUnits: string | null;
  /** Open interest in the base asset, scaled by sizeDecimals. Null when absent. */
  openInterest: number | null;
  /** Funding per interval, in millionths of the notional, signed. Null when none is published. */
  fundingRate: number | null;
  fundingIntervalSec: number | null;
};
export type Instance = {
  exchange: `0x${string}`;
  minAccountOpen: bigint;
  minDeposit: bigint;
  minWithdraw: bigint;
};
export type Context = {
  markets: Market[];
  instance: Instance;
  geoBlock: string[];
  serverTime: number | null;
  /** The chain the venue says it is on. Null when the payload does not carry it. */
  chainId: number | null;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown, what: string): Rec => {
  if (v === null || typeof v !== "object") {
    throw new Error(`Perpl context: ${what} is not an object`);
  }
  return v as Rec;
};
const num = (r: Rec, k: string, what: string): number => {
  const v = r[k];
  if (typeof v !== "number") {
    throw new Error(`Perpl context: ${what}.${k} is not a number`);
  }
  return v;
};
const str = (r: Rec, k: string, what: string): string => {
  const v = r[k];
  if (typeof v !== "string") {
    throw new Error(`Perpl context: ${what}.${k} is not a string`);
  }
  return v;
};
const amount = (r: Rec, k: string, what: string): bigint => {
  const v = r[k];
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new Error(`Perpl context: ${what}.${k} is not an amount`);
  }
  return BigInt(v);
};

// The fields below were added for the market board. They never throw: the app trades on the
// fields above and must not stop listing a market because a figure it does not use is missing.
const optionalRec = (v: unknown): Rec | null =>
  v !== null && typeof v === "object" ? (v as Rec) : null;
const optionalNum = (r: Rec | null, k: string): number | null => {
  const v = r?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const optionalStr = (r: Rec | null, k: string): string | null => {
  const v = r?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};

function parseMarket(v: unknown): Market {
  const m = rec(v, "market");
  const cfg = rec(m.config, "market.config");
  const st = rec(m.state, "market.state");
  return {
    id: num(m, "id", "market"),
    symbol: str(m, "symbol", "market"),
    name: str(m, "name", "market"),
    priceDecimals: num(cfg, "price_decimals", "config"),
    sizeDecimals: num(cfg, "size_decimals", "config"),
    ttlBlocks: num(m, "order_ttl_blocks", "market"),
    maxSlippageBps: num(m, "order_max_market_slippage_bps", "market"),
    maintenanceBps: num(cfg, "maintenance_margin", "config"),
    maxLeverage: num(cfg, "initial_margin", "config") / 100,
    takerFeeMicros: num(cfg, "taker_fee", "config"),
    isOpen: cfg.is_open === true,
    mark: num(st, "mrk", "state"),
    prev: num(st, "prv", "state"),
    sizeUnits: optionalStr(m, "size_units"),
    openInterest: optionalNum(st, "oi"),
    fundingRate: optionalNum(optionalRec(m.funding), "rate"),
    fundingIntervalSec: optionalNum(m, "funding_interval_sec"),
  };
}

/** Throws when the payload does not have the verified shape. Open markets, ordered by id. */
export function parseContext(body: unknown): Context {
  const c = rec(body, "context");
  if (!Array.isArray(c.instances) || c.instances.length === 0) {
    throw new Error("Perpl context: no instances");
  }
  if (!Array.isArray(c.markets)) {
    throw new Error("Perpl context: no markets");
  }
  const inst = rec(c.instances[0], "instance");
  const instance: Instance = {
    exchange: str(inst, "address", "instance") as `0x${string}`,
    minAccountOpen: amount(inst, "min_account_open_amount", "instance"),
    minDeposit: amount(inst, "min_deposit_amount", "instance"),
    minWithdraw: amount(inst, "min_withdraw_amount", "instance"),
  };
  const markets = c.markets
    .map(parseMarket)
    .filter((m) => m.isOpen)
    .sort((a, b) => a.id - b.id);
  const geoBlock = Array.isArray(c.geo_block)
    ? c.geo_block.filter((g): g is string => typeof g === "string")
    : [];
  return {
    markets,
    instance,
    geoBlock,
    serverTime: null,
    chainId: optionalNum(optionalRec(c.chain), "chain_id"),
  };
}

/**
 * The `Date` header (RFC 1123) as milliseconds since the epoch; null when it is missing or does
 * not parse (a CDN may drop it). `age`, the seconds the response spent in a cache, is added: a
 * Cloudflare hit carries a Date up to 10 s old.
 */
export function parseServerTime(
  dateHeader: string | null,
  ageHeader: string | null = null,
): number | null {
  if (!dateHeader) {
    return null;
  }
  const ms = Date.parse(dateHeader);
  if (Number.isNaN(ms)) {
    return null;
  }
  const age = Number(ageHeader ?? 0);
  return ms + (Number.isFinite(age) && age > 0 ? age * 1000 : 0);
}

/** Unambiguous identity for server execution; board/mobile parsing remains lenient. */
export function parsePerplMarketIdentity(market: {
  symbol?: unknown;
  name?: unknown;
  size_units?: unknown;
}): string | null {
  const unit = market.size_units;
  if (typeof unit !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,31}(?![\s\S])/.test(unit)) {
    return null;
  }
  return market.symbol === unit ||
    market.symbol === `${unit}-PERP` ||
    (market.symbol === "" && (market.name === unit || market.name === `${unit} Perp`))
    ? unit
    : null;
}
