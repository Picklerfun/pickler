import { classifyPolymarket, scopeTags } from "./classification.js";
import { z } from "zod";
import {
  PilotError,
  publicSourceUrl,
  type Market,
  type MarketScope,
  type MarketData,
  type Category,
  type OrderBook,
  type PaperConditions,
  type PaperMarketData,
} from "@pickler/core";
import { providerJson } from "../research/http.js";
const tag = z.object({ id: z.string().regex(/^\d+$/), label: z.string().min(1) });
const wireMarket = z.object({
  id: z.string().regex(/^\d+$/),
  question: z.string().min(1),
  description: z.string().min(1),
  active: z.boolean(),
  closed: z.boolean(),
  enableOrderBook: z.boolean().optional(),
  acceptingOrders: z.boolean().optional(),
  endDate: z.string().nullish(),
  gameStartTime: z.string().nullish(),
  sportsMarketType: z.string().nullish(),
  resolutionSource: z.string().nullish(),
  liquidityNum: z.number().nonnegative().nullish(),
  outcomes: z.string(),
  clobTokenIds: z.string(),
  tags: z.array(tag).optional(),
});
const price = z.string().regex(/^(0(\.\d{1,8})?|1(\.0{1,8})?)$/);
const level = z.object({ price, size: z.string().regex(/^\d+(\.\d+)?$/) });
const bookSchema = z.object({
  asset_id: z.string(),
  timestamp: z.string().regex(/^\d+$/),
  bids: z.array(level),
  asks: z.array(level),
});
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid Polymarket response");
  }
  return result.data;
}

/** Gamma supplies PostgreSQL timestamps such as 2026-09-18 00:15:00+00. */
function parseGameStart(value: string | null | undefined): string | null {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)
  ) {
    return null;
  }
  let normalized = value.replace(" ", "T");
  if (/[+-]\d{2}$/.test(normalized)) {
    normalized += ":00";
  }
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (!z.iso.datetime({ offset: true }).safeParse(normalized).success) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function mapMarket(
  m: z.infer<typeof wireMarket>,
  categories: string[],
  verifiedTags = categories,
): Market {
  let labels: string[], ids: string[];
  try {
    labels = parse(z.array(z.string().min(1)).min(2).max(10), JSON.parse(m.outcomes));
    ids = parse(z.array(z.string().regex(/^\d+$/)).min(2).max(10), JSON.parse(m.clobTokenIds));
  } catch {
    throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid outcome metadata");
  }
  if (ids.length !== labels.length || new Set(ids).size !== ids.length) {
    throw new PilotError("INVALID_PROVIDER_RESPONSE", "Outcome metadata mismatch");
  }
  if (m.endDate && !Number.isFinite(Date.parse(m.endDate))) {
    throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid closing date");
  }
  // Preserve complete resolution rules; fail rather than silently truncate them.
  if (m.description.length > 16000) {
    throw new PilotError("RULES_TOO_LARGE", "Resolution rules exceed pilot context limit");
  }
  const classification = classifyPolymarket(verifiedTags, m);
  return {
    id: m.id,
    ...(classification ? { classification } : {}),
    question: m.question.slice(0, 1000),
    rules: m.description,
    categoryIds: categories,
    active: m.active && !m.closed && m.enableOrderBook !== false && m.acceptingOrders !== false,
    closesAt: m.endDate ?? null,
    startsAt: parseGameStart(m.gameStartTime),
    timingSource: m.gameStartTime ? "polymarket.gameStartTime" : null,
    sportsMarketType: m.sportsMarketType ?? null,
    resolutionUrls: [
      ...new Set(
        (`${m.description} ${m.resolutionSource ?? ""}`.match(/https?:\/\/[^\s<>"'\])]+/g) ?? [])
          .map((url) => publicSourceUrl(url.replace(/[.,;]+$/, "")))
          .filter((url): url is string => url !== null),
      ),
    ].slice(0, 20),
    liquidity: m.liquidityNum ?? 0,
    outcomes: ids.map((id, i) => ({ id, label: labels[i]! })),
  };
}

export class PolymarketData implements MarketData, PaperMarketData {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private getJson(path: string, signal: AbortSignal) {
    return providerJson(`https://gamma-api.polymarket.com${path}`, {}, signal, this.fetcher);
  }

  async categories(signal: AbortSignal): Promise<Category[]> {
    // Explicit bounded catalog page; clients can also configure known tag IDs.
    return parse(z.array(tag), await this.getJson("/tags?limit=100&offset=0", signal)).map((t) => ({
      id: t.id,
      label: t.label,
    }));
  }

  async listScope(
    scope: MarketScope,
    signal: AbortSignal,
    report?: (data: unknown) => Promise<void>,
  ): Promise<Market[]> {
    return this.scan(scopeTags(scope), signal, report);
  }
  async list(
    categoryIds: string[],
    signal: AbortSignal,
    report?: (data: unknown) => Promise<void>,
  ): Promise<Market[]> {
    if (categoryIds.length > 10) {
      throw new PilotError("INVALID_INPUT", "Too many legacy categories");
    }
    return this.scan(categoryIds, signal, report);
  }
  private async scan(
    categoryIds: string[],
    signal: AbortSignal,
    report?: (data: unknown) => Promise<void>,
  ): Promise<Market[]> {
    if (
      !categoryIds.length ||
      categoryIds.length > 20 ||
      categoryIds.some((id) => !/^\d+$/.test(id))
    ) {
      throw new PilotError("CATEGORIES_REQUIRED", "Select categories");
    }
    const candidates = new Map<string, Market>();
    const offsets = new Map(categoryIds.map((id) => [id, 0]));
    const exhausted = new Set<string>();
    let pages = 0;
    let cursor = 0;
    while (pages < 5 && exhausted.size < categoryIds.length) {
      const id = categoryIds[cursor++ % categoryIds.length]!;
      if (exhausted.has(id)) {
        continue;
      }
      const offset = offsets.get(id)!;
      const rows = parse(
        z.array(wireMarket).max(20),
        await this.getJson(
          `/markets?tag_id=${id}&closed=false&active=true&limit=20&offset=${offset}&order=liquidityNum&ascending=false&include_tag=true`,
          signal,
        ),
      );
      pages++;
      offsets.set(id, offset + 20);
      if (rows.length < 20) {
        exhausted.add(id);
      }
      for (const row of rows) {
        // The filter is provider provenance; independently revalidate tags on the selected market.
        const old = candidates.get(row.id);
        candidates.set(
          row.id,
          mapMarket(
            row,
            [...new Set([...(old?.categoryIds ?? []), ...(row.tags?.map((t) => t.id) ?? []), id])],
            row.tags?.map((t) => t.id) ?? [],
          ),
        );
      }
    }
    await report?.({
      pages,
      rawCandidates: candidates.size,
      pageLimit: 5,
      exhaustedBudget: pages === 5,
      unvisitedCategories: categoryIds.filter((id) => offsets.get(id) === 0),
    });
    return [...candidates.values()].sort((a, b) => b.liquidity - a.liquidity);
  }

  async get(id: string, signal: AbortSignal): Promise<Market> {
    if (!/^\d+$/.test(id)) {
      throw new PilotError("INVALID_INPUT", "Invalid market ID");
    }
    const row = parse(wireMarket, await this.getJson(`/markets/${id}`, signal));
    if (row.id !== id) {
      throw new PilotError("INVALID_PROVIDER_RESPONSE", "Market ID mismatch");
    }
    const tags = parse(z.array(tag), await this.getJson(`/markets/${id}/tags`, signal));
    return mapMarket(
      row,
      tags.map((t) => t.id),
    );
  }

  async conditions(
    marketId: string,
    outcomeId: string,
    signal: AbortSignal,
  ): Promise<PaperConditions> {
    if (!/^\d+$/.test(marketId) || !/^\d+$/.test(outcomeId)) {
      throw new PilotError("INVALID_INPUT", "Invalid market or outcome");
    }
    const schema = wireMarket.extend({
      feesEnabled: z.boolean(),
      feeSchedule: z
        .object({
          rate: z.number().finite().min(0).max(1),
          exponent: z.literal(1),
          takerOnly: z.boolean(),
        })
        .nullish(),
      orderPriceMinTickSize: z.number().finite().positive().lt(1),
      orderMinSize: z.number().finite().nonnegative(),
    });
    const row = parse(schema, await this.getJson(`/markets/${marketId}`, signal));
    const market = mapMarket(row, []);
    if (
      row.id !== marketId ||
      !market.active ||
      !market.outcomes.some((o) => o.id === outcomeId) ||
      (row.feesEnabled && !row.feeSchedule)
    ) {
      throw new PilotError(
        "PAPER_INVALID_CONDITIONS",
        "Missing or inconsistent trading conditions",
      );
    }
    return {
      marketId,
      outcomeId,
      observedAt: new Date().toISOString(),
      minimumNotional: String(row.orderMinSize),
      tickSize: String(row.orderPriceMinTickSize),
      feeRate: row.feesEnabled ? String(row.feeSchedule!.rate) : "0",
      feeExponent: 1,
      provenance: `https://gamma-api.polymarket.com/markets/${marketId}`,
    };
  }

  async book(outcomeId: string, signal: AbortSignal): Promise<OrderBook> {
    if (!/^\d+$/.test(outcomeId)) {
      throw new PilotError("INVALID_INPUT", "Invalid outcome ID");
    }
    const result = parse(
      bookSchema,
      await providerJson(
        `https://clob.polymarket.com/book?token_id=${outcomeId}`,
        {},
        signal,
        this.fetcher,
      ),
    );
    if (result.asset_id !== outcomeId || !Number.isFinite(Number(result.timestamp))) {
      throw new PilotError("INVALID_PROVIDER_RESPONSE", "Order book mismatch");
    }
    const timestamp = Number(result.timestamp);
    if (Math.abs(Date.now() - timestamp) > 120_000) {
      throw new PilotError("STALE_QUOTE", "Order book timestamp is stale");
    }
    return {
      outcomeId,
      observedAt: new Date(timestamp).toISOString(),
      bids: result.bids
        .filter((l) => Number(l.size) > 0)
        .sort((a, b) => Number(b.price) - Number(a.price))
        .slice(0, 20),
      asks: result.asks
        .filter((l) => Number(l.size) > 0)
        .sort((a, b) => Number(a.price) - Number(b.price))
        .slice(0, 20),
    };
  }
}
