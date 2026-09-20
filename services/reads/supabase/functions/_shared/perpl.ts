// Mercados y mark de Perpl desde GET /v1/pub/context (misma forma que apps/mobile/src/perpl/context.ts).
export type PerplMarket = { id: number; symbol: string; name: string; priceDecimals: number; mark: number; prev: number; isOpen: boolean };
export class PerplUnavailable extends Error {}

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

export function parseMarkets(body: unknown): Map<number, PerplMarket> {
  const c = rec(body, "context");
  if (!Array.isArray(c.markets)) throw new Error("Perpl context: no markets");
  const out = new Map<number, PerplMarket>();
  for (const raw of c.markets) {
    const m = rec(raw, "market");
    const cfg = rec(m.config, "market.config");
    const st = rec(m.state, "market.state");
    const market: PerplMarket = {
      id: num(m, "id", "market"), symbol: str(m, "symbol", "market"), name: str(m, "name", "market"),
      priceDecimals: num(cfg, "price_decimals", "config"), mark: num(st, "mrk", "state"), prev: num(st, "prv", "state"),
      isOpen: cfg.is_open === true,
    };
    if (market.isOpen) out.set(market.id, market);
  }
  return new Map([...out.entries()].sort((a, b) => a[0] - b[0]));
}

export const PERPL_REST_DEFAULT = "https://testnet.perpl.xyz/api";

export async function fetchMarkets(
  rest = Deno.env.get("PERPL_REST") ?? PERPL_REST_DEFAULT,
  timeoutMs = 10_000,
  doFetch: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Map<number, PerplMarket>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(`${rest}/v1/pub/context`, { signal: controller.signal });
    if (!res.ok) throw new PerplUnavailable(`Perpl responded ${res.status}`);
    return parseMarkets(await res.json());
  } catch (e) {
    if (e instanceof PerplUnavailable) throw e;
    throw new PerplUnavailable(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
