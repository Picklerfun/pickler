import { z } from "zod";
import {
  PilotError,
  assertStudyMarket,
  type StudyKind,
  type StudyMarket,
  type StudyEvidence,
  type StudyPlugin,
  type Source,
} from "@pickler/core";
import { PolymarketData } from "./market-data.js";
import { providerJson } from "../research/http.js";
import { ExaResearch } from "../research/exa.js";

/** Operator laboratory adapter. All integrations remain independently revocable plugins. */
export class PolymarketStudyData {
  constructor(
    private readonly exaKey: string,
    private readonly guard: (kind: StudyKind, plugin: StudyPlugin) => Promise<void>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {}
  private async request(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(input, init);
    } catch (error) {
      if (init?.signal?.aborted) {
        throw error;
      }
      throw new PilotError("PROVIDER_CONNECTION_FAILED", "Public data transport failed");
    }
  }
  markets(kind: StudyKind): PolymarketData {
    return new PolymarketData(async (input, init) => {
      await this.guard(kind, "polymarket");
      return this.request(input, init);
    });
  }
  async discover(kind: StudyKind, signal: AbortSignal): Promise<StudyMarket[]> {
    const now = this.now();
    if (kind === "sports") {
      const markets = await this.markets(kind).listScope(
        { version: 1, category: "sports", subcategories: ["soccer", "american-football"] },
        signal,
      );
      return markets
        .map((market): StudyMarket => ({
          kind,
          market,
          windowStart: null,
          windowEnd: Date.parse(market.closesAt ?? ""),
          slug: market.id,
        }))
        .filter((item) => {
          try {
            assertStudyMarket(item, now);
            return true;
          } catch {
            return false;
          }
        })
        .sort((a, b) => Date.parse(a.market.startsAt!) - Date.parse(b.market.startsAt!))
        .slice(0, 20);
    }
    const minutes = kind === "btc-5m" ? 5 : 15;
    const start = Math.floor(now / (minutes * 60000)) * minutes * 60000;
    const slug = `btc-updown-${minutes}m-${start / 1000}`;
    await this.guard(kind, "polymarket");
    const raw = await providerJson(
      `https://gamma-api.polymarket.com/markets?slug=${slug}`,
      {},
      signal,
      this.request.bind(this),
    );
    const rows = z
      .array(
        z.object({ id: z.string().regex(/^\d+$/), slug: z.literal(slug), endDate: z.string() }),
      )
      .max(1)
      .safeParse(raw);
    if (!rows.success) {
      throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid BTC market lookup");
    }
    if (!rows.data[0]) {
      return [];
    }
    const market = await this.markets(kind).get(rows.data[0].id, signal);
    const item: StudyMarket = {
      kind,
      market,
      slug,
      windowStart: start,
      windowEnd: start + minutes * 60000,
    };
    assertStudyMarket(item, now);
    return [item];
  }
  async refresh(item: StudyMarket, signal: AbortSignal): Promise<StudyMarket> {
    return { ...item, market: await this.markets(item.kind).get(item.market.id, signal) };
  }
  async evidence(
    item: StudyMarket,
    signal: AbortSignal,
    onUsage: (usd: number | null) => Promise<void>,
  ): Promise<StudyEvidence> {
    const markets = this.markets(item.kind);
    const books = [];
    const limitations: string[] = [];
    for (const outcome of item.market.outcomes) {
      const book = await markets.book(outcome.id, signal);
      if (book.asks.length > 20 || book.bids.length > 20) {
        limitations.push(
          `Order book ${outcome.id} truncated to its best 20 levels per side for model context; virtual execution refreshes the full book.`,
        );
      }
      books.push({ ...book, asks: book.asks.slice(0, 20), bids: book.bids.slice(0, 20) });
    }
    const now = this.now();
    const sources: Source[] = [
      {
        id: `market:${item.market.id}`,
        title: item.market.question,
        url: `https://gamma-api.polymarket.com/markets/${item.market.id}`,
        content: item.market.rules,
        provider: "polymarket",
        pluginVersion: "1.0.0",
        retrievedAt: new Date(now).toISOString(),
        publishedAt: null,
        truncated: false,
      },
    ];
    if (item.kind !== "sports") {
      await this.guard(item.kind, "coinbase");
      const start = new Date(now - 3600000).toISOString();
      const end = new Date(now).toISOString();
      const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      const parsed = z
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
        .max(300)
        .safeParse(await providerJson(url, {}, signal, this.request.bind(this)));
      if (!parsed.success) {
        throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid BTC candles");
      }
      if (
        new Set(parsed.data.map((row) => row[0])).size !== parsed.data.length ||
        parsed.data.some(
          (row) =>
            row[0] % 60 !== 0 ||
            row[1] > row[2] ||
            row[3] < row[1] ||
            row[3] > row[2] ||
            row[4] < row[1] ||
            row[4] > row[2],
        )
      ) {
        throw new PilotError("INVALID_PROVIDER_RESPONSE", "Inconsistent reference candles");
      }
      const candles = parsed.data
        .filter((row) => (row[0] + 60) * 1000 <= now && row[0] * 1000 >= now - 3600000)
        .sort((a, b) => a[0] - b[0]);
      if (candles.length < 10 || now - (candles.at(-1)![0] + 60) * 1000 > 120000) {
        throw new PilotError("STUDY_STALE_PRICE", "Reference price history is incomplete or stale");
      }
      sources.push({
        id: "btc-reference",
        url,
        title: "Coinbase BTC-USD completed one-minute candles (reference only)",
        provider: "coinbase",
        pluginVersion: "1.0.0",
        retrievedAt: new Date(now).toISOString(),
        publishedAt: new Date((candles.at(-1)![0] + 60) * 1000).toISOString(),
        truncated: false,
        content: JSON.stringify({
          columns: ["openTimeSeconds", "low", "high", "open", "close", "volume"],
          candles,
        }),
      });
      limitations.push(
        "Coinbase prices are a reference, not the market's Chainlink resolution feed. Exact Chainlink opening price is unavailable; do not treat a Coinbase candle as the official price to beat.",
      );
    } else {
      const search = new ExaResearch(this.exaKey, async (input, init) => {
        await this.guard(item.kind, "exa");
        return this.request(input, init);
      });
      let reported: number | null = 0;
      for (const suffix of [
        "latest team news injuries form evidence for each side",
        "upset risks injuries opposing evidence official match preview",
      ]) {
        const result = await search.search(
          `${item.market.question.slice(0, 500)} ${suffix}`,
          signal,
        );
        const cost = z.object({ total: z.number().nonnegative() }).safeParse(result.usage);
        reported = reported === null || !cost.success ? null : reported + cost.data.total;
        await onUsage(reported);
        for (const source of result.sources.slice(0, 2)) {
          if (sources.some((old) => old.url === source.url || old.content === source.content)) {
            continue;
          }
          sources.push({
            ...source,
            content: source.content.slice(0, 2500),
            truncated: source.truncated || source.content.length > 2500,
          });
        }
      }
      if (sources.length < 2) {
        throw new PilotError("STUDY_NO_EVIDENCE", "No external sports evidence");
      }
      limitations.push(
        "Web research only; injury, roster and external odds plugins are not part of this laboratory protocol.",
      );
    }
    return { sources, books, limitations };
  }
}
