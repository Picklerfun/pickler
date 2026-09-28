import { z } from "zod";
import { PilotError, type QuantInput, type QuantPlugin, type StudyMarket } from "@pickler/core";
import { PolymarketStudyData } from "./study-data.js";
import { providerJson } from "../research/http.js";
const candleSchema = z
  .array(
    z.tuple([
      z.number().int().nonnegative(),
      z.number().positive(),
      z.number().positive(),
      z.number().positive(),
      z.number().positive(),
      z.number().nonnegative(),
    ]),
  )
  .max(300);
export class QuantData {
  readonly study: PolymarketStudyData;
  constructor(
    private readonly guard: (plugin: QuantPlugin) => Promise<void>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {
    this.study = new PolymarketStudyData(
      "",
      async (_kind, plugin) => {
        if (plugin === "exa") {
          throw new PilotError("PLUGIN_DISABLED", "Exa is outside this protocol");
        }
        await guard(plugin);
      },
      fetcher,
      now,
    );
  }
  private async get(plugin: QuantPlugin, url: string, signal: AbortSignal) {
    await this.guard(plugin);
    return providerJson(url, {}, signal, this.fetcher);
  }
  async candles(start: number, end: number, signal: AbortSignal) {
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`;
    const parsed = candleSchema.safeParse(await this.get("coinbase", url, signal));
    if (
      !parsed.success ||
      new Set(parsed.data.map((c) => c[0])).size !== parsed.data.length ||
      parsed.data.some(
        (c) => c[0] % 60 || c[1] > c[2] || c[3] < c[1] || c[3] > c[2] || c[4] < c[1] || c[4] > c[2],
      )
    ) {
      throw new PilotError("QUANT_INVALID_CANDLES", "Invalid Coinbase candles");
    }
    return parsed.data
      .filter((c) => c[0] * 1000 >= start && (c[0] + 60) * 1000 <= end)
      .sort((a, b) => a[0] - b[0])
      .map((c) => ({ time: c[0] * 1000, close: c[4] }));
  }
  async input(item: StudyMarket, signal: AbortSignal): Promise<QuantInput> {
    const marketUrl = `https://gamma-api.polymarket.com/markets/${item.market.id}`;
    const metadata = await this.get("polymarket", marketUrl, signal);
    const metadataObservedAt = new Date(this.now()).toISOString();
    const raw = z
      .object({
        id: z.literal(item.market.id),
        description: z.string(),
        cryptoMarketConfig: z.object({
          asset: z.literal("btc"),
          duration: z.enum(["5m", "15m"]),
          twapEnabled: z.literal(true),
          twapLookbackSeconds: z.union([z.literal(30), z.literal(60)]),
        }),
      })
      .safeParse(metadata);
    if (
      !raw.success ||
      raw.data.description !== item.market.rules ||
      raw.data.cryptoMarketConfig.duration !== (item.kind === "btc-5m" ? "5m" : "15m")
    ) {
      throw new PilotError(
        "QUANT_RESOLUTION_RULES",
        "Missing or inconsistent explicit crypto metadata",
      );
    }
    const seconds = raw.data.cryptoMarketConfig.twapLookbackSeconds;
    if (
      !item.market.rules.includes(`btc-usd-twap-${seconds}s-streams`) ||
      !/greater than or equal/i.test(item.market.rules)
    ) {
      throw new PilotError(
        "QUANT_RESOLUTION_RULES",
        "Rules and final rolling TWAP metadata disagree",
      );
    }
    const params = new URLSearchParams({
      symbol: "BTC",
      eventStartTime: new Date(item.windowStart!).toISOString(),
      endDate: new Date(item.windowEnd).toISOString(),
      variant: item.kind === "btc-5m" ? "fiveminute" : "fifteen",
      twapEnabled: "true",
      twapLookbackSeconds: String(seconds),
    });
    const openingUrl = `https://polymarket.com/api/crypto/crypto-price?${params}`;
    const opening = z
      .object({ openPrice: z.number().positive(), timestamp: z.number().int().positive() })
      .safeParse(await this.get("polymarket", openingUrl, signal));
    if (
      !opening.success ||
      opening.data.timestamp < item.windowStart! ||
      opening.data.timestamp > this.now() + 5000
    ) {
      throw new PilotError("QUANT_OPENING_UNAVAILABLE", "Opening reference unavailable");
    }
    const markets = this.study.markets(item.kind);
    const books = [],
      conditions = [];
    for (const outcome of item.market.outcomes) {
      books.push(await markets.book(outcome.id, signal));
      await this.guard("polymarket");
      conditions.push(
        await markets.conditions(item.market.id, outcome.id, signal, {
          raw: metadata,
          observedAt: metadataObservedAt,
        }),
      );
    }
    const now = this.now();
    const candles = (await this.candles(now - 63 * 60000, now, signal)).slice(-61);
    // Ticker is last: age is checked again in core before admission/fill.
    const tickerUrl = "https://api.exchange.coinbase.com/products/BTC-USD/ticker";
    const ticker = z
      .object({
        price: z.coerce.number().positive(),
        bid: z.coerce.number().positive(),
        ask: z.coerce.number().positive(),
        time: z.string().datetime(),
      })
      .safeParse(await this.get("coinbase", tickerUrl, signal));
    if (!ticker.success) {
      throw new PilotError("QUANT_INVALID_TICKER", "Invalid Coinbase ticker");
    }
    return {
      item,
      rule: { version: 1, lookbackSeconds: seconds, provenance: marketUrl, tie: "up" },
      opening: {
        price: opening.data.openPrice,
        observedAt: opening.data.timestamp,
        url: openingUrl,
      },
      ticker: {
        price: ticker.data.price,
        bid: ticker.data.bid,
        ask: ticker.data.ask,
        observedAt: Date.parse(ticker.data.time),
        url: tickerUrl,
      },
      candles,
      books,
      conditions,
      observedAt: this.now(),
    };
  }
}
