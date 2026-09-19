import { z } from "zod";
import {
  PilotError,
  type Market,
  type Source,
  type SportsContext,
  type SportsData,
} from "@pickler/core";
import { providerJson } from "../research/http.js";
import type { PublicDataCache } from "./cache.js";

const team = z.object({
  id: z.number().int(),
  name: z.string(),
  full_name: z.string(),
  abbreviation: z.string(),
});
const game = z.object({
  id: z.number().int(),
  date: z.string().datetime({ offset: true }),
  home_team: team,
  visitor_team: team,
  status_state: z.string(),
  home_team_score: z.number().nullable(),
  visitor_team_score: z.number().nullable(),
});
const games = z.object({
  data: z.array(game).max(100),
  meta: z.object({ next_cursor: z.number().nullable().optional() }).optional(),
});
const odds = z.array(
  z.object({
    id: z.string(),
    sport_key: z.literal("americanfootball_nfl"),
    commence_time: z.string().datetime({ offset: true }),
    home_team: z.string(),
    away_team: z.string(),
    bookmakers: z.array(
      z.object({
        key: z.string(),
        last_update: z.string().datetime({ offset: true }),
        markets: z.array(
          z.object({
            key: z.literal("h2h"),
            outcomes: z.array(z.object({ name: z.string(), price: z.number().finite().gt(1) })),
          }),
        ),
      }),
    ),
  }),
);
const words = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
function mentions(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => words(text).includes(words(alias)));
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid structured sports response");
  }
  return result.data;
}
function source(
  provider: string,
  id: string,
  url: string,
  data: unknown,
  retrievedAt: string,
  publishedAt: string | null = null,
): Source {
  const content = JSON.stringify(data);
  return {
    id: `${provider}:${id}:${retrievedAt}`,
    externalId: id,
    provider,
    pluginVersion: "1.0.0",
    url,
    title: `Structured NFL data (${provider})`,
    content: content.slice(0, 6000),
    truncated: content.length > 6000,
    retrievedAt,
    publishedAt,
  };
}

abstract class CachedSports {
  constructor(
    protected readonly key: string,
    protected readonly cache: PublicDataCache,
    protected readonly fetcher: typeof fetch = fetch,
  ) {}
  protected async request(
    provider: string,
    path: string,
    ttl: number,
    signal: AbortSignal,
    guard: (network?: boolean) => Promise<void>,
  ) {
    await guard();
    const cached = await this.cache.get(`${provider}:v1:${path}`);
    if (cached) {
      return cached;
    }
    await this.cache.reserve(provider, this.key, signal);
    // Permission rechecked after coordination and immediately before network I/O.
    await guard(true);
    const url =
      provider === "balldontlie"
        ? `https://api.balldontlie.io/nfl/v1/${path}`
        : `https://api.the-odds-api.com/v4/${path}&apiKey=${encodeURIComponent(this.key)}`;
    let usage: Record<string, number> = {};
    const value = await providerJson(
      url,
      provider === "balldontlie" ? { headers: { Authorization: this.key } } : {},
      signal,
      this.fetcher,
      (reported) => {
        usage = reported;
      },
    );
    const result = { value, usage, retrievedAt: new Date().toISOString() };
    await guard();
    await this.cache.put(`${provider}:v1:${path}`, value, result.retrievedAt, ttl);
    return result;
  }
}
export class BallDontLieSports extends CachedSports implements SportsData {
  async check(signal: AbortSignal): Promise<void> {
    await this.request("balldontlie", "teams", 86400000, signal, async () => {});
  }
  async context(
    market: Market,
    signal: AbortSignal,
    guard: (network?: boolean) => Promise<void>,
  ): Promise<SportsContext> {
    if (!market.startsAt) {
      return { status: "no_coverage", sources: [] };
    }
    const roster = await this.request("balldontlie", "teams", 86400000, signal, guard);
    const teams = parse(z.object({ data: z.array(team) }), roster.value).data.filter((t) =>
      mentions(market.question, [t.full_name, t.name, t.abbreviation]),
    );
    if (teams.length !== 2) {
      throw new PilotError("SPORTS_EVENT_AMBIGUOUS", "Cannot uniquely identify both NFL teams");
    }
    const params = new URLSearchParams({ per_page: "100" });
    for (const t of teams) {
      params.append("team_ids[]", String(t.id));
    }
    // Cover recent results and the selected future game without relying on provider sort order.
    const start = Date.parse(market.startsAt);
    for (let d = -28; d <= 1; d++) {
      params.append("dates[]", new Date(start + d * 86400000).toISOString().slice(0, 10));
    }
    const rows: z.infer<typeof game>[] = [];
    let retrievedAt = roster.retrievedAt;
    for (let page = 0; page < 5; page++) {
      const result = await this.request("balldontlie", `games?${params}`, 300000, signal, guard);
      retrievedAt = result.retrievedAt;
      const parsed = parse(games, result.value);
      rows.push(...parsed.data);
      if (!parsed.meta?.next_cursor) {
        break;
      }
      if (page === 4) {
        throw new PilotError(
          "SPORTS_DISCOVERY_LIMIT",
          "Cannot verify unique event within page budget",
        );
      }
      params.set("cursor", String(parsed.meta.next_cursor));
    }
    const matching = rows.filter(
      (g) =>
        teams.some((t) => t.id === g.home_team.id) &&
        teams.some((t) => t.id === g.visitor_team.id) &&
        Math.abs(Date.parse(g.date) - start) <= 900000,
    );
    if (matching.length !== 1 || matching[0]!.status_state !== "scheduled") {
      throw new PilotError(
        "SPORTS_EVENT_MISMATCH",
        "Game identity, status or schedule does not match",
      );
    }
    const selected = matching[0]!;
    const recent = rows
      .filter((g) => g.status_state === "final" && Date.parse(g.date) < start)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 10);
    return {
      status: "available",
      sources: [
        source(
          "balldontlie",
          String(selected.id),
          `https://api.balldontlie.io/nfl/v1/games/${selected.id}`,
          {
            league: "NFL",
            game: selected,
            recentResults: recent,
            limitations: ["Injuries, roster and advanced statistics not included in free access."],
          },
          retrievedAt,
        ),
      ],
    };
  }
}
export class OddsApiSports extends CachedSports implements SportsData {
  async check(signal: AbortSignal): Promise<void> {
    await this.request("the-odds-api", "sports/?all=false", 120000, signal, async () => {});
  }
  async context(
    market: Market,
    signal: AbortSignal,
    guard: (network?: boolean) => Promise<void>,
  ): Promise<SportsContext> {
    const result = await this.request(
      "the-odds-api",
      "sports/americanfootball_nfl/odds?regions=us&markets=h2h&oddsFormat=decimal",
      120000,
      signal,
      guard,
    );
    const matching = parse(odds, result.value).filter(
      (g) =>
        mentions(market.question, [g.home_team, g.home_team.split(" ").at(-1)!]) &&
        mentions(market.question, [g.away_team, g.away_team.split(" ").at(-1)!]) &&
        Math.abs(Date.parse(g.commence_time) - Date.parse(market.startsAt ?? "")) <= 900000,
    );
    if (!matching.length) {
      return {
        status: "no_coverage",
        sources: [],
        usage: "usage" in result ? result.usage : { cacheHit: true },
      };
    }
    if (matching.length !== 1) {
      throw new PilotError("SPORTS_EVENT_AMBIGUOUS", "Multiple matching odds events");
    }
    const g = matching[0]!;
    return {
      usage: "usage" in result ? result.usage : { cacheHit: true },
      status: g.bookmakers.some((b) => Math.abs(Date.now() - Date.parse(b.last_update)) <= 120000)
        ? "available"
        : "stale",
      sources: g.bookmakers.map((b) =>
        source(
          "the-odds-api",
          `${g.id}:${b.key}`,
          "https://the-odds-api.com/",
          {
            eventId: g.id,
            home: g.home_team,
            away: g.away_team,
            startsAt: g.commence_time,
            bookmaker: b,
            limitations: [
              "Reference odds include bookmaker margin. Overtime, ties and cancellations require independent rule comparison; equivalence is not certified.",
            ],
          },
          result.retrievedAt,
          b.last_update,
        ),
      ),
    };
  }
}
