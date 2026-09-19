import { test } from "node:test";
import assert from "node:assert/strict";
import { BallDontLieSports, OddsApiSports } from "../src/sports/providers.js";
import { PostgresPublicDataCache } from "../src/sports/cache.js";
import { createTestStore } from "./database.js";
import type { Market } from "@pickler/core";
const market: Market = {
  id: "1",
  question: "NFL Detroit Lions vs. Buffalo Bills",
  rules: "Full game",
  startsAt: "2026-09-18T00:15:00Z",
  categoryIds: [],
  active: true,
  closesAt: null,
  liquidity: 0,
  outcomes: [],
};
const home = { id: 1, full_name: "Detroit Lions", name: "Lions", abbreviation: "DET" };
const away = { id: 2, full_name: "Buffalo Bills", name: "Bills", abbreviation: "BUF" };
const game = {
  id: 3,
  date: market.startsAt,
  home_team: home,
  visitor_team: away,
  status_state: "scheduled",
  home_team_score: null,
  visitor_team_score: null,
};
test("structured sports caches retain time and cannot bypass a revoked guard", async (t) => {
  const store = await createTestStore(t);
  const cache = new PostgresPublicDataCache(store.pool);
  let network = 0;
  let budget = 0;
  const adapter = new BallDontLieSports("fixture", cache, async (input) => {
    network++;
    return Response.json(
      String(input).endsWith("teams")
        ? { data: [home, away] }
        : { data: [game], meta: { next_cursor: null } },
    );
  });
  const guard = async (request?: boolean) => {
    if (request) {
      budget++;
    }
  };
  const first = await adapter.context(market, AbortSignal.timeout(5000), guard);
  const second = await adapter.context(market, AbortSignal.timeout(5000), guard);
  assert.equal(first.status, "available");
  assert.equal(network, 2);
  assert.equal(budget, 2);
  assert.equal(first.sources[0]!.retrievedAt, second.sources[0]!.retrievedAt);
  await assert.rejects(
    adapter.context(market, AbortSignal.timeout(5000), async () => {
      throw new Error("disabled");
    }),
    /disabled/,
  );
  assert.equal(network, 2);
});
test("shared PostgreSQL free quota serializes independent executors", async (t) => {
  const store = await createTestStore(t);
  const peer = store.connectPeer();
  const caches = [new PostgresPublicDataCache(store.pool), new PostgresPublicDataCache(peer.pool)];
  const result = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      caches[i % 2]!.reserve("balldontlie", "shared", AbortSignal.timeout(10000)),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 5);
});
test("mismatched game time and duplicate identity fail explicitly", async (t) => {
  const store = await createTestStore(t);
  const cache = new PostgresPublicDataCache(store.pool);
  const adapter = new BallDontLieSports("fixture", cache, async (input) =>
    Response.json(
      String(input).endsWith("teams")
        ? { data: [home, away] }
        : { data: [{ ...game, date: "2026-09-18T01:15:00Z" }] },
    ),
  );
  await assert.rejects(
    adapter.context(market, AbortSignal.timeout(5000), async () => {}),
    { code: "SPORTS_EVENT_MISMATCH" },
  );
});
test("odds expose data age and never include the API key in evidence", async (t) => {
  const store = await createTestStore(t);
  const cache = new PostgresPublicDataCache(store.pool);
  const adapter = new OddsApiSports("secret-test-key", cache, async () =>
    Response.json([
      {
        id: "odds1",
        sport_key: "americanfootball_nfl",
        commence_time: market.startsAt,
        home_team: home.full_name,
        away_team: away.full_name,
        bookmakers: [
          {
            key: "fixture",
            last_update: "2020-01-01T00:00:00Z",
            markets: [
              {
                key: "h2h",
                outcomes: [
                  { name: home.full_name, price: 2.1 },
                  { name: away.full_name, price: 1.8 },
                ],
              },
            ],
          },
        ],
      },
    ]),
  );
  const result = await adapter.context(market, AbortSignal.timeout(5000), async () => {});
  assert.equal(result.status, "stale");
  assert.equal(JSON.stringify(result).includes("secret-test-key"), false);
});
