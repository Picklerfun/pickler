import test from "node:test";
import assert from "node:assert/strict";
import { PolymarketStudyData } from "../src/polymarket/study-data.js";
import { PilotError } from "@pickler/core";
const start = 1790501400000;
const now = start + 10000;
function data(stale = false, denied = false, missingOpening = false) {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/crypto/crypto-price?")) {
      const p = new URL(url).searchParams;
      assert.equal(p.get("symbol"), "BTC");
      assert.equal(p.get("twapEnabled"), "true");
      assert.equal(p.get("twapLookbackSeconds"), "60");
      assert.equal(Date.parse(p.get("eventStartTime")!), start);
      assert.equal(Date.parse(p.get("endDate")!), start + 300000);
      return Response.json({
        openPrice: missingOpening ? null : 90050,
        timestamp: now,
        closePrice: null,
        incomplete: true,
      });
    }
    if (url.includes("/candles?")) {
      return Response.json(
        Array.from({ length: 30 }, (_, i) => [
          Math.floor(now / 60000) * 60 - 60 * (i + 1) - (stale ? 600 : 0),
          90000,
          90100,
          90050,
          90060,
          12,
        ]),
      );
    }
    if (url.includes("/book?")) {
      return Response.json({
        asset_id: new URL(url).searchParams.get("token_id"),
        timestamp: String(Date.now()),
        bids: [],
        asks: [{ price: "0.5", size: "100" }],
      });
    }
    if (url.endsWith("/tags")) {
      return Response.json([]);
    }
    if (url.includes("?slug=")) {
      return Response.json([
        {
          id: "123",
          slug: `btc-updown-5m-${start / 1000}`,
          endDate: new Date(start + 300000).toISOString(),
        },
      ]);
    }
    return Response.json({
      id: "123",
      question: "Bitcoin Up or Down",
      description: "Chainlink: greater than or equal to opening means Up",
      active: true,
      closed: false,
      endDate: new Date(start + 300000).toISOString(),
      outcomes: '["Up","Down"]',
      clobTokenIds: '["11","22"]',
    });
  };
  return {
    urls,
    adapter: new PolymarketStudyData(
      "",
      async (_kind, plugin) => {
        if (denied && plugin === "coinbase") {
          throw new PilotError("PLUGIN_DISABLED", "Disabled");
        }
      },
      fetcher,
      () => now,
    ),
  };
}
test("discovers exact current BTC window and preserves reference-feed limitations", async () => {
  const f = data();
  const markets = await f.adapter.discover("btc-5m", AbortSignal.timeout(1000));
  assert.equal(markets.length, 1);
  const evidence = await f.adapter.evidence(markets[0]!, AbortSignal.timeout(1000), async () => {});
  assert.equal(
    evidence.sources.find((source) => source.id === "btc-reference")?.provider,
    "coinbase",
  );
  assert.match(evidence.limitations[0]!, /not the market's Chainlink/);
  assert.ok(f.urls.every((url) => !url.includes("exa")));
});
test("stale candles fail; disabled reference plugin makes no reference request", async () => {
  for (const denied of [false, true]) {
    const f = data(true, denied);
    const markets = await f.adapter.discover("btc-5m", AbortSignal.timeout(1000));
    await assert.rejects(
      f.adapter.evidence(markets[0]!, AbortSignal.timeout(1000), async () => {}),
      (error: unknown) =>
        error instanceof PilotError &&
        error.code === (denied ? "PLUGIN_DISABLED" : "STUDY_STALE_PRICE"),
    );
    if (denied) {
      assert.ok(f.urls.every((url) => !url.includes("coinbase")));
    }
  }
});

test("missing opening reference fails before Coinbase or paid research", async () => {
  const f = data(false, false, true);
  const [item] = await f.adapter.discover("btc-5m", AbortSignal.timeout(1000));
  await assert.rejects(
    f.adapter.evidence(item!, AbortSignal.timeout(1000), async () => {}),
    (e: unknown) => e instanceof PilotError && e.code === "STUDY_OPENING_UNAVAILABLE",
  );
  assert.ok(f.urls.every((url) => !url.includes("coinbase") && !url.includes("exa")));
});
