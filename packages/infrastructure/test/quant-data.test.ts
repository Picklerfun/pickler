import test from "node:test";
import assert from "node:assert/strict";
import { QuantData } from "../src/polymarket/quant-data.js";
import { PilotError } from "@pickler/core";
import { type StudyMarket } from "@pickler/trading/strategies";
const start = 1790501400000,
  now = start + 70000;
function fixture(seconds: 30 | 60 = 60, disabled = false, contradiction = false) {
  const rules = `Chainlink Bitcoin Up if greater than or equal. https://data.chain.link/streams/btc-usd-twap-${contradiction ? 90 : seconds}s-streams`;
  const item: StudyMarket = {
    kind: "btc-5m",
    slug: `btc-updown-5m-${start / 1000}`,
    windowStart: start,
    windowEnd: start + 300000,
    market: {
      id: "1",
      question: "Bitcoin",
      rules,
      active: true,
      categoryIds: [],
      liquidity: 10,
      closesAt: new Date(start + 300000).toISOString(),
      outcomes: [
        { id: "up", label: "Up" },
        { id: "down", label: "Down" },
      ],
    },
  };
  const urls: string[] = [];
  const d = new QuantData(
    async (plugin) => {
      if (disabled && plugin === "coinbase") {
        throw new PilotError("PLUGIN_DISABLED", "disabled");
      }
    },
    async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("gamma-api")) {
        return Response.json({
          id: "1",
          description: rules,
          cryptoMarketConfig: {
            asset: "btc",
            duration: "5m",
            twapEnabled: true,
            twapLookbackSeconds: seconds,
          },
        });
      }
      if (url.includes("crypto-price")) {
        assert.equal(new URL(url).searchParams.get("twapLookbackSeconds"), String(seconds));
        return Response.json({ openPrice: 100, timestamp: now });
      }
      if (url.includes("candles")) {
        return Response.json(
          Array.from({ length: 61 }, (_, i) => [
            (start - (60 - i) * 60000) / 1000,
            99,
            101,
            100,
            100,
            10,
          ]),
        );
      }
      if (url.includes("ticker")) {
        return Response.json({
          price: "100",
          bid: "99.99",
          ask: "100.01",
          time: new Date(now).toISOString(),
        });
      }
      throw new Error("Unexpected fixture URL");
    },
    () => now,
  );
  d.study.markets = () =>
    ({
      book: async (outcomeId: string) => ({
        outcomeId,
        bids: [],
        asks: [],
        observedAt: new Date(now).toISOString(),
      }),
      conditions: async (marketId: string, outcomeId: string) => ({
        marketId,
        outcomeId,
        observedAt: new Date(now).toISOString(),
        minimumNotional: "1",
        tickSize: ".01",
        feeRate: ".07",
        feeExponent: 1,
        provenance: "fixture",
      }),
    }) as unknown as ReturnType<typeof d.study.markets>;
  return { d, item, urls };
}
test("explicit per-market TWAP metadata controls opening query for30/60", async () => {
  for (const seconds of [30, 60] as const) {
    const f = fixture(seconds);
    const r = await f.d.input(f.item, new AbortController().signal);
    assert.equal(r.rule.lookbackSeconds, seconds);
    assert.equal(r.candles.length, 61);
    assert.equal(r.ticker.price, 100);
  }
});
test("conflicting rules and disabled plugins reject without hidden calls", async () => {
  const f = fixture(60, false, true);
  await assert.rejects(f.d.input(f.item, new AbortController().signal));
  assert.equal(f.urls.length, 1);
  const g = fixture(60, true);
  await assert.rejects(g.d.input(g.item, new AbortController().signal));
  assert.ok(!g.urls.some((u) => u.includes("coinbase")));
});

test("conditions reuse only the current metadata snapshot and preserve its timestamp", async () => {
  const f = fixture();
  const snapshots: unknown[] = [];
  const original = f.d.study.markets.bind(f.d.study);
  f.d.study.markets = (kind) => {
    const adapter = original(kind);
    const conditions = adapter.conditions.bind(adapter);
    adapter.conditions = async (marketId, outcomeId, signal, snapshot) => {
      snapshots.push(snapshot);
      return conditions(marketId, outcomeId, signal);
    };
    return adapter;
  };
  await f.d.input(f.item, new AbortController().signal);
  assert.equal(f.urls.filter((u) => u.includes("gamma-api")).length, 1);
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.equal((snapshots[0] as { observedAt: string }).observedAt, new Date(now).toISOString());
});
