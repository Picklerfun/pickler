import {
  PilotError,
  PERPL_PLUGIN_VERSION,
  PERPL_LAB_SYMBOLS,
  PERP_RESOLUTIONS,
  type PerpNetwork,
  type PerpSymbol,
  type PerpReadContext,
  type PerpMarketData,
  type PerpMarketInfo,
  type PerpProvenance,
  type PerpSnapshot,
  type PerpOrderBook,
  type PerpCandleRequest,
  type PerpCandles,
  type PerpFundingRequest,
  type PerpFundingHistory,
  type PerpFundingEvent,
} from "@pickler/core";
import { z } from "zod";
import {
  contextSchema,
  fundingSeriesSchema,
  tickerSchema,
  bookSchema,
  candlesSchema,
  type WireContext,
  type WireMarket,
} from "./wire.js";
import {
  PERPL_NETWORKS,
  PerplTransport,
  type PerplDataOptions,
  type PerplPublicResponse,
} from "./transport.js";

/** Exact fixed-point conversion; never round money using floating point. */
export function perplDecimal(value: number | string | bigint, decimals: number): string {
  const n = BigInt(value);
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(decimals + 1, "0");
  if (decimals === 0) {
    return `${negative ? "-" : ""}${digits}`;
  }
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
function parse<T>(response: PerplPublicResponse, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(response.body));
  } catch {
    throw new PilotError("PERPL_INVALID_RESPONSE", "Perpl response failed validation");
  }
}
function invalid(): never {
  throw new PilotError("PERPL_INVALID_RESPONSE", "Inconsistent Perpl market data");
}
export function perplStamp(
  network: PerpNetwork,
  response: PerplPublicResponse,
  at: { t?: number | undefined; b?: number | undefined },
): PerpProvenance {
  return {
    provider: "perpl",
    pluginVersion: PERPL_PLUGIN_VERSION,
    network,
    chainId: PERPL_NETWORKS[network].chainId,
    url: response.url,
    receivedAt: response.receivedAt,
    providerTimestamp: at.t ?? null,
    block: at.b ?? null,
  };
}
export function perplFreshness(
  provenance: PerpProvenance,
  now: number,
): "unknown" | "stale" | "fresh" {
  if (provenance.providerTimestamp === null) {
    return "unknown";
  }
  if (provenance.providerTimestamp > now + 5000) {
    invalid();
  }
  return now - provenance.providerTimestamp > 30_000 ? "stale" : "fresh";
}
interface ContextSnapshot {
  data: WireContext;
  response: PerplPublicResponse;
}
export class PerplMarketData implements PerpMarketData {
  private readonly transport: PerplTransport;
  private readonly universe: boolean;
  private bulkTicker:
    { response: PerplPublicResponse; parsed: z.infer<typeof tickerSchema> } | undefined;
  private bulkFunding:
    | {
        from: number;
        to: number;
        response: PerplPublicResponse;
        parsed: {
          at: { t?: number | undefined; b?: number | undefined };
          d: Record<string, z.infer<typeof fundingSeriesSchema>["d"]>;
        };
      }
    | undefined;
  private readonly contexts = new Map<PerpNetwork, ContextSnapshot>();
  constructor(private readonly options: PerplDataOptions = {}) {
    this.transport = new PerplTransport(options);
    this.universe = options.universe === true;
  }
  private parse<T>(response: PerplPublicResponse, schema: z.ZodType<T>): T {
    if (!this.options.onValidation) {
      return parse(response, schema);
    }
    const clock = this.options.monotonic ?? (() => performance.now());
    const started = clock();
    let code: string | null = null;
    try {
      return parse(response, schema);
    } catch (error) {
      code = "PERPL_INVALID_RESPONSE";
      throw error;
    } finally {
      const operation = response.url.includes("/candles/")
        ? "candles"
        : response.url.includes("/book?")
          ? "book"
          : response.url.endsWith("/ticker")
            ? "ticker"
            : response.url.includes("funding")
              ? "funding"
              : "metadata";
      this.options.onValidation({
        version: 1,
        operation: `schema-validation:${operation}`,
        durationMs: clock() - started,
        code,
      });
    }
  }
  private async context(network: PerpNetwork, ctx: PerpReadContext): Promise<ContextSnapshot> {
    if (!Object.hasOwn(PERPL_NETWORKS, network)) {
      throw new PilotError("INVALID_INPUT", "Unknown Perpl network");
    }
    await ctx.guard();
    ctx.signal.throwIfAborted();
    const cached = this.contexts.get(network);
    if (cached && this.transport.now() - cached.response.receivedAt < 30_000) {
      await ctx.guard();
      return cached;
    }
    const response = await this.transport.get(network, "/v1/pub/context", ctx);
    const data = this.parse(response, contextSchema);
    if (
      data.chain.chain_id !== PERPL_NETWORKS[network].chainId ||
      new Set(data.markets.map((m) => m.id)).size !== data.markets.length
    ) {
      invalid();
    }
    const result = { response, data };
    this.contexts.set(network, result);
    return result;
  }
  private market(
    network: PerpNetwork,
    symbol: PerpSymbol,
    context: ContextSnapshot,
  ): { wire: WireMarket; info: PerpMarketInfo } {
    if (
      !PERPL_LAB_SYMBOLS.includes(symbol) ||
      (!this.universe && symbol !== "BTC" && symbol !== "ETH")
    ) {
      throw new PilotError("MARKET_NOT_ALLOWED", "Only BTC and ETH are supported");
    }
    // Empty provider symbols are resolved only when both name and size unit confirm the asset.
    const candidates = context.data.markets.filter(
      (m) =>
        m.size_units === symbol &&
        (m.symbol === symbol ||
          m.symbol === `${symbol}-PERP` ||
          (m.symbol === "" && (m.name === symbol || m.name === `${symbol} Perp`))),
    );
    if (candidates.length !== 1) {
      throw new PilotError("PERPL_MARKET_IDENTITY", "Market identity is absent or ambiguous");
    }
    const wire = candidates[0]!;
    const instances = context.data.instances.filter((i) => i.id === wire.instance_id);
    if (instances.length !== 1) {
      invalid();
    }
    const instance = instances[0]!;
    const tokens = context.data.tokens.filter((t) => t.id === instance.collateral_token_id);
    if (tokens.length !== 1) {
      invalid();
    }
    const token = tokens[0]!;
    if (this.universe && (token.symbol !== "AUSD" || token.decimals !== 6)) {
      invalid();
    }
    return {
      wire,
      info: {
        symbol,
        marketId: wire.id,
        perpetualId: wire.perpetual_id,
        instanceId: wire.instance_id,
        exchangeAddress: instance.address,
        collateral: {
          tokenId: token.id,
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
        },
        configVersion: wire.ver,
        priceDecimals: wire.config.price_decimals,
        sizeDecimals: wire.config.size_decimals,
        open: wire.config.is_open,
        fundingIntervalSeconds: wire.funding_interval_sec,
        fundingIntervalBlocks: wire.funding_interval_blocks,
        initialMarginRaw: wire.config.initial_margin,
        maintenanceMarginRaw: wire.config.maintenance_margin,
        fees: {
          basis: "public-base-tier",
          maker: perplDecimal(wire.config.maker_fee, 6),
          taker: perplDecimal(wire.config.taker_fee, 6),
        },
        provenance: perplStamp(network, context.response, wire.config.at),
      },
    };
  }
  async funding(
    network: PerpNetwork,
    request: PerpFundingRequest,
    ctx: PerpReadContext,
  ): Promise<PerpFundingHistory> {
    const { symbol, from, to } = request;
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < from ||
      to > this.transport.now()
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid funding range");
    }
    const context = await this.context(network, ctx);
    const { info: market } = this.market(network, symbol, context);
    const span = market.fundingIntervalSeconds * 1000 * 1023;
    if (to - from > span * 4) {
      throw new PilotError("INVALID_INPUT", "Funding range exceeds four pages");
    }
    const events = new Map<number, PerpFundingEvent>();
    const pages: PerpProvenance[] = [];
    let complete = true;
    for (let start = from; start <= to;) {
      const end = Math.min(to, start + span);
      let response: PerplPublicResponse;
      let raw: z.infer<typeof fundingSeriesSchema>;
      if (this.universe) {
        await ctx.guard();
        const shortest = Math.min(...context.data.markets.map((m) => m.funding_interval_sec));
        if (to - from > shortest * 1000 * 127) {
          throw new PilotError("INVALID_INPUT", "Universe funding range exceeds 128 intervals");
        }
        if (!this.bulkFunding || this.bulkFunding.from !== from || this.bulkFunding.to !== to) {
          response = await this.transport.get(
            network,
            `/v1/market-data/funding/${from}-${to}`,
            ctx,
          );
          const parsed = parse(
            response,
            z.object({
              mt: z.number().int().nonnegative(),
              at: fundingSeriesSchema.shape.at,
              d: z.record(z.string(), fundingSeriesSchema.shape.d),
            }),
          );
          this.bulkFunding = { from, to, response, parsed };
        }
        response = this.bulkFunding.response;
        raw = {
          mt: 0,
          m: market.marketId,
          at: this.bulkFunding.parsed.at,
          d: this.bulkFunding.parsed.d[String(market.marketId)] ?? [],
        };
        await ctx.guard();
      } else {
        response = await this.transport.get(
          network,
          `/v1/market-data/${market.marketId}/funding/${start}-${end}`,
          ctx,
        );
        raw = this.parse(response, fundingSeriesSchema);
      }
      if (raw.m !== market.marketId) {
        invalid();
      }
      pages.push(perplStamp(network, response, raw.at));
      if (raw.d.length === 0) {
        complete = false;
      }
      for (const event of raw.d) {
        if (event.at.b !== undefined && event.at.b !== event.feb) {
          invalid();
        }
        const normalized: PerpFundingEvent = {
          eventBlock: event.feb,
          appliesAt: event.at.t ?? null,
          rate: perplDecimal(event.rate, 6),
          index: perplDecimal(event.idx, market.priceDecimals),
          estimated:
            !context.data.chain.gas ||
            event.feb > context.data.chain.gas.h ||
            event.at.t === undefined ||
            event.at.t > this.transport.now() - 60000,
          provenance: perplStamp(network, response, event.at),
        };
        const previous = events.get(event.feb);
        if (
          previous &&
          (previous.rate !== normalized.rate || previous.index !== normalized.index)
        ) {
          invalid();
        }
        events.set(event.feb, normalized);
      }
      if (end === to) {
        break;
      }
      start = end + 1;
    }
    return {
      market,
      from,
      to,
      complete,
      events: [...events.values()].sort((a, b) => a.eventBlock - b.eventBlock),
      pages,
    };
  }
  async list(network: PerpNetwork, symbols: PerpSymbol[], ctx: PerpReadContext) {
    const context = await this.context(network, ctx);
    return { markets: symbols.map((symbol) => this.market(network, symbol, context).info) };
  }
  async snapshot(
    network: PerpNetwork,
    symbol: PerpSymbol,
    ctx: PerpReadContext,
  ): Promise<PerpSnapshot> {
    const context = await this.context(network, ctx);
    const { wire, info: market } = this.market(network, symbol, context);
    let response: PerplPublicResponse;
    let parsed: z.infer<typeof tickerSchema>;
    if (this.universe) {
      await ctx.guard();
      if (!this.bulkTicker || this.transport.now() - this.bulkTicker.response.receivedAt >= 3000) {
        response = await this.transport.get(network, "/v1/market-data/ticker", ctx);
        parsed = this.parse(response, tickerSchema);
        this.bulkTicker = { response, parsed };
      }
      ({ response, parsed } = this.bulkTicker);
      await ctx.guard();
      if (!Object.hasOwn(parsed.d, market.marketId)) {
        throw new PilotError("DATA_UNAVAILABLE", "Market ticker absent");
      }
    } else {
      response = await this.transport.get(
        network,
        `/v1/market-data/${market.marketId}/ticker`,
        ctx,
      );
      parsed = this.parse(response, tickerSchema);
      if (Object.keys(parsed.d).length !== 1 || !Object.hasOwn(parsed.d, market.marketId)) {
        invalid();
      }
    }
    const state = parsed.d[String(market.marketId)]!;
    const funding = wire.funding;
    return {
      market,
      ticker: normalizePerplTicker(market, response, state, this.transport.now()),
      funding: funding
        ? {
            rate: perplDecimal(funding.rate, 6),
            intervalSeconds: market.fundingIntervalSeconds,
            intervalBlocks: market.fundingIntervalBlocks,
            appliesAt: funding.at.t ?? null,
            eventBlock: funding.feb,
            applicationTimeEstimated: context.data.chain.gas
              ? funding.feb > context.data.chain.gas.h
              : null,
            provenance: perplStamp(network, context.response, funding.at),
          }
        : null,
    };
  }
  async book(
    network: PerpNetwork,
    symbol: PerpSymbol,
    levels: number,
    ctx: PerpReadContext,
  ): Promise<PerpOrderBook> {
    if (!Number.isInteger(levels) || levels < 1 || levels > 100) {
      throw new PilotError("INVALID_INPUT", "Invalid book depth");
    }
    const { info: market } = this.market(network, symbol, await this.context(network, ctx));
    const response = await this.transport.get(
      network,
      `/v1/market-data/${market.marketId}/book?levels=${levels}`,
      ctx,
    );
    const book = this.parse(response, bookSchema);
    if (book.bid.length > levels || book.ask.length > levels) {
      invalid();
    }
    return normalizePerplBook(market, response, book, levels, this.transport.now());
  }

  async candles(
    network: PerpNetwork,
    request: PerpCandleRequest,
    ctx: PerpReadContext,
  ): Promise<PerpCandles> {
    const { symbol, resolution, from, to } = request;
    const interval = resolution * 1000;
    if (
      !(PERP_RESOLUTIONS as readonly number[]).includes(resolution) ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to <= from ||
      from % interval !== 0 ||
      to % interval !== 0 ||
      (to - from) / interval > 1024
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid candle range");
    }
    const { info: market } = this.market(network, symbol, await this.context(network, ctx));
    // The provider rounds the inclusive upper bound to a candle boundary.
    // Request the last desired open time to preserve our [from,to) contract.
    const response = await this.transport.get(
      network,
      `/v1/market-data/${market.marketId}/candles/${resolution}/${from}-${to - interval}`,
      ctx,
    );
    const series = this.parse(response, candlesSchema);
    if (series.r !== resolution) {
      invalid();
    }
    const seen = new Set<number>();
    const candles = series.d
      .map((c) => {
        if (
          c.t < from ||
          c.t >= to ||
          c.t % interval !== 0 ||
          seen.has(c.t) ||
          c.l > Math.min(c.o, c.c) ||
          c.h < Math.max(c.o, c.c) ||
          c.l > c.h ||
          c.t > this.transport.now() + 5000
        ) {
          invalid();
        }
        seen.add(c.t);
        return {
          openTime: c.t,
          open: perplDecimal(c.o, market.priceDecimals),
          high: perplDecimal(c.h, market.priceDecimals),
          low: perplDecimal(c.l, market.priceDecimals),
          close: perplDecimal(c.c, market.priceDecimals),
          volumeCollateral: perplDecimal(c.v, market.collateral.decimals),
          trades: c.n,
          closed: c.t + interval <= this.transport.now(),
        };
      })
      .sort((a, b) => a.openTime - b.openTime);
    const missingOpenTimes: number[] = [];
    for (let t = from; t < to; t += interval) {
      if (!seen.has(t)) {
        missingOpenTimes.push(t);
      }
    }
    return {
      market,
      resolution,
      from,
      to,
      candles,
      missingOpenTimes,
      provenance: perplStamp(network, response, series.at),
    };
  }
}

export function normalizePerplTicker(
  market: PerpMarketInfo,
  response: PerplPublicResponse,
  state: z.infer<typeof tickerSchema>["d"][string],
  now: number,
): PerpSnapshot["ticker"] {
  const provenance = perplStamp(market.provenance.network, response, state.at);
  const price = (value: number) => perplDecimal(value, market.priceDecimals);
  return {
    mark: price(state.mrk),
    index: price(state.orl),
    last: price(state.lst),
    bid: price(state.bid),
    ask: price(state.ask),
    openInterestBase: perplDecimal(state.oi, market.sizeDecimals),
    freshness: perplFreshness(provenance, now),
    provenance,
  };
}
export function normalizePerplBook(
  market: PerpMarketInfo,
  response: PerplPublicResponse,
  book: {
    at: { t?: number | undefined; b?: number | undefined };
    bid: { p: number; s: number; o: number }[];
    ask: { p: number; s: number; o: number }[];
  },
  levels: number,
  now: number,
): PerpOrderBook {
  for (const [side, direction] of [
    [book.bid, -1],
    [book.ask, 1],
  ] as const) {
    for (let i = 1; i < side.length; i++) {
      if ((side[i]!.p - side[i - 1]!.p) * direction <= 0) {
        invalid();
      }
    }
  }
  if (book.bid[0] && book.ask[0] && book.bid[0].p >= book.ask[0].p) {
    invalid();
  }
  const provenance = perplStamp(market.provenance.network, response, book.at);
  const convert = (level: { p: number; s: number; o: number }) => ({
    price: perplDecimal(level.p, market.priceDecimals),
    size: perplDecimal(level.s, market.sizeDecimals),
    orders: level.o,
  });
  return {
    market,
    requestedLevels: levels,
    depthLimited: true,
    bids: book.bid.slice(0, levels).map(convert),
    asks: book.ask.slice(0, levels).map(convert),
    freshness: perplFreshness(provenance, now),
    provenance,
  };
}
