import { z } from "zod";
export const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const signed = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const amount = z.string().regex(/^\d+$/).max(100);
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
export const atSchema = z.object({ b: uint.optional(), t: uint.optional() });
export const fundingSchema = z.object({ at: atSchema, feb: uint, rate: signed });
const config = z.object({
  at: atSchema,
  is_open: z.boolean(),
  price_decimals: uint.max(18),
  size_decimals: uint.max(18),
  initial_margin: uint,
  maintenance_margin: uint,
  maker_fee: signed,
  taker_fee: signed,
});
export const contextSchema = z.object({
  chain: z.object({ chain_id: uint, gas: z.object({ h: uint }).optional() }),
  instances: z.array(z.object({ id: uint, address, collateral_token_id: uint })).max(100),
  tokens: z
    .array(z.object({ id: uint, address, symbol: z.string(), decimals: uint.max(18) }))
    .max(100),
  markets: z
    .array(
      z.object({
        ver: uint,
        id: uint,
        instance_id: uint,
        perpetual_id: uint,
        symbol: z.string(),
        name: z.string(),
        size_units: z.string(),
        funding_interval_sec: uint.positive(),
        funding_interval_blocks: uint.positive(),
        config,
        funding: fundingSchema.nullish(),
      }),
    )
    .max(1000),
});
export type WireContext = z.infer<typeof contextSchema>;
export type WireMarket = WireContext["markets"][number];
export const tickerSchema = z.object({
  mt: z.literal(9),
  sn: uint,
  d: z.record(
    z.string(),
    z.object({ at: atSchema, orl: uint, mrk: uint, lst: uint, bid: uint, ask: uint, oi: uint }),
  ),
});
const level = z.object({ p: uint.positive(), s: uint.positive(), o: uint.positive() });
export const bookSchema = z.object({
  mt: z.literal(15),
  sn: uint,
  at: atSchema,
  bid: z.array(level).max(100),
  ask: z.array(level).max(100),
});
export const candlesSchema = z.object({
  at: atSchema,
  r: uint.positive(),
  d: z
    .array(
      z.object({
        t: uint,
        o: uint,
        h: uint,
        l: uint,
        c: uint,
        v: amount,
        n: uint,
      }),
    )
    .max(1024),
});

export const fundingSeriesSchema = z.object({
  mt: uint,
  at: atSchema,
  m: uint,
  d: z.array(fundingSchema.extend({ idx: uint.positive() })).max(1025),
});
