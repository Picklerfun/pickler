import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PerplMarketData } from "../src/perpl/data.js";
import { assertPerplSelection } from "@pickler/core";
import { perplMarketCatalogSchema } from "@pickler/api-schema";
const now = 1800000000000;
const capture = JSON.parse(
  await readFile(
    new URL("../../perpl-context/test/fixtures/context.json", import.meta.url),
    "utf8",
  ),
);
const ctx = () => ({ guard: async () => {}, signal: new AbortController().signal });
async function catalog(
  change: (data: typeof capture) => void = () => {},
  network: "testnet" | "mainnet" = "testnet",
) {
  const data = structuredClone(capture);
  data.chain.chain_id = network === "testnet" ? 10143 : 143;
  change(data);
  const urls: string[] = [];
  const reader = new PerplMarketData({
    now: () => now,
    transport: async (url) => {
      urls.push(String(url));
      return Response.json(data);
    },
  });
  const result = await reader.catalog(network, ctx());
  assert.equal(urls.length, 1);
  assert.ok(
    urls[0]!.startsWith(
      network === "testnet" ? "https://testnet.perpl.xyz/" : "https://app.perpl.xyz/",
    ),
  );
  return perplMarketCatalogSchema.parse(result);
}
test("both networks expose the captured full catalogue, including additional compatible markets", async () => {
  for (const network of ["testnet", "mainnet"] as const) {
    const result = await catalog(undefined, network);
    assert.equal(result.network, network);
    assert.equal(result.observedAt, now);
    assert.deepEqual(
      result.markets.map((row) => row.symbol),
      ["BTC", "ETH", "SOL", "MON", "ZEC", "LIT", "PUMP"],
    );
    assert.ok(result.markets.every((row) => row.available));
    assert.doesNotThrow(() => assertPerplSelection(result, network, ["SOL", "MON"], now));
    assert.throws(() => assertPerplSelection(result, network, ["NEW"], now), {
      code: "MARKET_NOT_ALLOWED",
    });
    assert.throws(() => assertPerplSelection(result, network, ["SOL"], now + 30001), {
      code: "PERPL_CATALOG_UNAVAILABLE",
    });
  }
});
test("closed, absent, ambiguous and invalid identities are never admitted silently", async () => {
  const closed = await catalog((data) => {
    data.markets[2].config.is_open = false;
  });
  assert.equal(closed.markets[2]!.status, "closed");
  assert.equal(closed.markets[2]!.available, false);
  assert.throws(() => assertPerplSelection(closed, "testnet", ["SOL"], now), {
    code: "MARKET_NOT_ALLOWED",
  });
  const missing = await catalog((data) => {
    data.markets = data.markets.filter((row: { size_units: string }) => row.size_units !== "SOL");
  });
  assert.throws(() => assertPerplSelection(missing, "testnet", ["SOL"], now), {
    code: "MARKET_NOT_ALLOWED",
  });
  const duplicate = await catalog((data) => {
    const second = structuredClone(data.markets[2]);
    second.id = 999;
    second.perpetual_id = 999;
    data.markets.push(second);
  });
  assert.equal(duplicate.markets.filter((row) => row.symbol === "SOL").length, 2);
  assert.ok(duplicate.markets.filter((row) => row.symbol === "SOL").every((row) => !row.available));
  assert.throws(() => assertPerplSelection(duplicate, "testnet", ["SOL"], now), {
    code: "MARKET_NOT_ALLOWED",
  });
  const broken = await catalog((data) => {
    data.markets[2].config.size_decimals = 19;
  });
  assert.ok(broken.markets.some((row) => row.status === "invalid"));
  assert.ok(broken.markets.every((row) => !row.available));
});
test("wrong collateral, duplicate market ids and wrong network fail closed", async () => {
  const collateral = await catalog((data) => {
    data.tokens[0].decimals = 18;
  });
  assert.ok(collateral.markets.every((row) => !row.available));
  const duplicates = await catalog((data) => {
    data.markets[2].id = data.markets[0].id;
  });
  assert.ok(duplicates.markets.every((row) => !row.available));
  await assert.rejects(
    catalog((data) => {
      data.chain.chain_id = 143;
    }),
    { code: "PERPL_INVALID_RESPONSE" },
  );
});

test("delisted positions use recorded ids, and relistings never silently replace them", async () => {
  const data = structuredClone(capture);
  const initial = new PerplMarketData({
    now: () => now,
    transport: async () => Response.json(data),
  });
  const market = (await initial.list("testnet", ["SOL"], ctx())).markets.find(
    (row) => row.symbol === "SOL",
  )!;
  const urls: string[] = [];
  data.markets = data.markets.filter((row: { size_units: string }) => row.size_units !== "SOL");
  const reader = new PerplMarketData({
    now: () => now,
    positionMarkets: [market],
    transport: async (url) => {
      urls.push(String(url));
      if (String(url).endsWith("/context")) {
        return Response.json(data);
      }
      return Response.json({
        mt: 9,
        sn: 1,
        d: {
          [market.marketId]: {
            at: { t: now, b: 100 },
            orl: 10000,
            mrk: 10000,
            lst: 10000,
            bid: 9999,
            ask: 10001,
            oi: 1,
          },
        },
      });
    },
  });
  const snapshot = await reader.snapshot("testnet", "SOL", ctx());
  assert.equal(snapshot.market.marketId, market.marketId);
  assert.equal(snapshot.market.open, false);
  assert.equal(snapshot.funding, null);
  assert.ok(urls.some((url) => url.includes(`/${market.marketId}/ticker`)));
  const changed = structuredClone(capture);
  changed.markets.find((row: { size_units: string }) => row.size_units === "SOL").perpetual_id += 1;
  const replaced = new PerplMarketData({
    now: () => now,
    positionMarkets: [market],
    transport: async () => Response.json(changed),
  });
  await assert.rejects(replaced.snapshot("testnet", "SOL", ctx()), {
    code: "PERPL_MARKET_IDENTITY",
  });
});

test("identities with trailing whitespace and conflicting recorded ids remain unavailable", async () => {
  const malformed = await catalog((data) => {
    data.markets[2].size_units = "SOL\n";
    data.markets[2].symbol = "SOL\n";
  });
  assert.equal(malformed.markets[2]!.symbol, null);
  assert.equal(malformed.markets[2]!.available, false);
  const initial = new PerplMarketData({
    now: () => now,
    transport: async () => Response.json(capture),
  });
  const market = (await initial.list("testnet", ["SOL"], ctx())).markets[0]!;
  const reader = new PerplMarketData({
    now: () => now,
    positionMarkets: [market, { ...market, marketId: market.marketId + 1000 }],
    transport: async () => Response.json(capture),
  });
  await assert.rejects(reader.snapshot("testnet", "SOL", ctx()), { code: "PERPL_MARKET_IDENTITY" });
});
