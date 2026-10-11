import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  PERPL_LAB_SYMBOLS,
  PilotError,
  type PerpReadContext,
  type PerpSymbol,
} from "@pickler/core";
import { PerplMarketData } from "../src/perpl/data.js";
import {
  PerplRequestSchedule,
  type PerplTickerReadDiagnostic,
  type PerplRequestDiagnostic,
} from "../src/perpl/transport.js";

const NOW = 1_800_000_000_000;
const marketIds = [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110];
const address = "0x" + "1".repeat(40);
function metadata() {
  return {
    chain: { chain_id: 143, gas: { h: 100 } },
    instances: [{ id: 1, address, collateral_token_id: 1 }],
    tokens: [{ id: 1, address, symbol: "AUSD", decimals: 6 }],
    markets: PERPL_LAB_SYMBOLS.map((symbol, i) => ({
      ver: 1,
      id: marketIds[i],
      instance_id: 1,
      perpetual_id: marketIds[i],
      symbol,
      name: `${symbol} Perp`,
      size_units: symbol,
      funding_interval_sec: 3600,
      funding_interval_blocks: 3600,
      config: {
        at: { t: NOW, b: 100 },
        is_open: true,
        price_decimals: 2,
        size_decimals: 3,
        initial_margin: 100000,
        maintenance_margin: 50000,
        maker_fee: 0,
        taker_fee: 500,
      },
    })),
  };
}
function ticker(revision: number) {
  return {
    mt: 9,
    sn: revision,
    d: Object.fromEntries(
      marketIds.map((id, i) => [
        String(id),
        {
          at: { t: NOW - i * 1000, b: 100 - i },
          orl: 100000 + revision,
          mrk: 100000 + revision,
          lst: 100000 + revision,
          bid: 99990,
          ask: 100010,
          oi: 1000,
        },
      ]),
    ),
  };
}
function context(guard: () => Promise<void> = async () => {}): PerpReadContext {
  return { signal: new AbortController().signal, guard };
}
async function settle<T>(t: TestContext, promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let i = 0; i < 700 && !done; i++) {
    t.mock.timers.tick(100);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(done, true, "Controlled transport did not terminate");
  return promise;
}
function clocks(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
}

test("legacy universe reuse is labelled cache and forced batch refresh performs HTTP inside its TTL", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const reads: PerplTickerReadDiagnostic[] = [];
  let revision = 0;
  const data = new PerplMarketData({
    universe: true,
    onTickerRead: (event) => reads.push(event),
    transport: async (url) => {
      urls.push(String(url));
      return Response.json(String(url).endsWith("/context") ? metadata() : ticker(++revision));
    },
  });
  const ctx = context();

  const first = await settle(t, data.snapshot("mainnet", "BTC", ctx));
  const reused = await settle(t, data.snapshot("mainnet", "BTC", ctx));
  const updated = await settle(t, data.snapshotBatch("mainnet", ["BTC", "ETH"], ctx));

  assert.deepEqual(reused, first);
  assert.notEqual(updated[0]!.ticker.mark, first.ticker.mark);
  assert.ok(updated[0]!.ticker.provenance.receivedAt - first.ticker.provenance.receivedAt < 3000);
  assert.equal(urls.filter((url) => url.endsWith("/ticker")).length, 2);
  assert.deepEqual(
    reads.map((event) => event.source),
    ["network", "cache", "network"],
  );
  assert.deepEqual(
    reads.map((event) => event.batch),
    [false, false, true],
  );
  assert.equal(reads[1]!.receivedAt, reads[0]!.receivedAt);
  assert.deepEqual(reads[2]!.requestedSymbols, ["BTC", "ETH"]);
});

test("one fresh bulk request supplies all eleven symbols with original per-market dates and blocks", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const reads: PerplTickerReadDiagnostic[] = [];
  const data = new PerplMarketData({
    universe: true,
    sessionLimit: 24,
    onTickerRead: (event) => reads.push(event),
    transport: async (url) => {
      urls.push(String(url));
      return Response.json(String(url).endsWith("/context") ? metadata() : ticker(1));
    },
  });

  const snapshots = await settle(t, data.snapshotBatch("mainnet", PERPL_LAB_SYMBOLS, context()));

  assert.equal(snapshots.length, 11);
  assert.equal(urls.length, 2);
  assert.equal(urls.filter((url) => url.endsWith("/ticker")).length, 1);
  assert.equal(new Set(snapshots.map((value) => value.ticker.provenance.receivedAt)).size, 1);
  for (let i = 0; i < snapshots.length; i++) {
    assert.equal(snapshots[i]!.ticker.provenance.providerTimestamp, NOW - i * 1000);
    assert.equal(snapshots[i]!.ticker.provenance.block, 100 - i);
    assert.equal(snapshots[i]!.market.marketId, marketIds[i]);
  }
  assert.deepEqual(reads[0]!.requestedSymbols, [...PERPL_LAB_SYMBOLS]);
  assert.equal(reads[0]!.symbols.length, 11);
  assert.equal(JSON.stringify(reads).includes("body"), false);
  assert.equal(JSON.stringify(reads).includes("headers"), false);
});

test("a missing member in a fresh response stays missing rather than reusing the old ticker", async (t) => {
  clocks(t);
  let revision = 0;
  const reads: PerplTickerReadDiagnostic[] = [];
  const data = new PerplMarketData({
    universe: true,
    onTickerRead: (event) => reads.push(event),
    transport: async (url) => {
      if (String(url).endsWith("/context")) {
        return Response.json(metadata());
      }
      const response = ticker(++revision);
      if (revision > 1) {
        delete response.d["20"];
      }
      return Response.json(response);
    },
  });

  await settle(t, data.snapshot("mainnet", "ETH", context()));
  const snapshots = await settle(t, data.snapshotBatch("mainnet", ["BTC", "ETH"], context()));

  assert.deepEqual(
    snapshots.map((value) => value.market.symbol),
    ["BTC"],
  );
  assert.deepEqual(reads.at(-1)!.requestedSymbols, ["BTC", "ETH"]);
  assert.deepEqual(
    reads.at(-1)!.symbols.map((value) => value.symbol),
    ["BTC"],
  );
});

test("the batch adapter is explicit universe-only and rejects invalid selection before ticker HTTP", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const transport: typeof fetch = async (url) => {
    urls.push(String(url));
    return Response.json(metadata());
  };
  const publicData = new PerplMarketData({ transport });
  const privateData = new PerplMarketData({ universe: true, transport });

  await assert.rejects(publicData.snapshotBatch("mainnet", ["BTC"], context()), {
    code: "INVALID_INPUT",
  });
  await assert.rejects(privateData.snapshotBatch("mainnet", [], context()), {
    code: "INVALID_INPUT",
  });
  await assert.rejects(privateData.snapshotBatch("mainnet", ["BTC", "BTC"], context()), {
    code: "INVALID_INPUT",
  });
  await assert.rejects(
    settle(t, privateData.snapshotBatch("mainnet", ["AUSD" as PerpSymbol], context())),
    { code: "MARKET_NOT_ALLOWED" },
  );

  assert.equal(urls.filter((url) => url.endsWith("/ticker")).length, 0);
});

test("revocation after response or on cached reuse prevents a result and a successful read diagnostic", async (t) => {
  clocks(t);
  let denied = false;
  const reads: PerplTickerReadDiagnostic[] = [];
  const guard = async () => {
    if (denied) {
      throw new PilotError("LEASE_LOST", "Controlled ownership loss");
    }
  };
  const data = new PerplMarketData({
    universe: true,
    onTickerRead: (event) => reads.push(event),
    transport: async (url) =>
      Response.json(String(url).endsWith("/context") ? metadata() : ticker(1)),
    onResponse: async (response) => {
      if (response.url.endsWith("/ticker")) {
        denied = true;
      }
    },
  });

  await assert.rejects(settle(t, data.snapshotBatch("mainnet", ["BTC"], context(guard))), {
    code: "LEASE_LOST",
  });
  await assert.rejects(data.snapshot("mainnet", "BTC", context(guard)), { code: "LEASE_LOST" });

  assert.equal(reads.length, 0);
});

test("cancellation after body receipt prevents batch delivery without substituting a previous result", async (t) => {
  clocks(t);
  const controller = new AbortController();
  const reads: PerplTickerReadDiagnostic[] = [];
  const data = new PerplMarketData({
    universe: true,
    onTickerRead: (event) => reads.push(event),
    transport: async (url) =>
      Response.json(String(url).endsWith("/context") ? metadata() : ticker(1)),
    onResponse: async (response) => {
      if (response.url.endsWith("/ticker")) {
        controller.abort(new PilotError("LEASE_LOST", "Controlled cancellation"));
      }
    },
  });

  await assert.rejects(
    settle(t, data.snapshotBatch("mainnet", ["BTC"], { ...context(), signal: controller.signal })),
    { code: "LEASE_LOST" },
  );

  assert.equal(reads.length, 0);
});

test("malformed schema and ambiguous identities reject the batch without fabricated diagnostics", async (t) => {
  clocks(t);
  const reads: PerplTickerReadDiagnostic[] = [];
  const data = new PerplMarketData({
    universe: true,
    onTickerRead: (event) => reads.push(event),
    transport: async (url) =>
      Response.json(String(url).endsWith("/context") ? metadata() : { error: "private body" }),
  });

  await assert.rejects(settle(t, data.snapshotBatch("mainnet", ["BTC"], context())), {
    code: "PERPL_INVALID_RESPONSE",
  });

  const wrong = metadata();
  wrong.markets.push({ ...wrong.markets[0]! });
  const ambiguous = new PerplMarketData({
    universe: true,
    transport: async () => Response.json(wrong),
  });
  await assert.rejects(settle(t, ambiguous.snapshotBatch("mainnet", ["BTC"], context())), {
    code: "PERPL_INVALID_RESPONSE",
  });
  assert.equal(reads.length, 0);
});

test("concurrent batch reads still use the shared one-second serial schedule and request cap", async (t) => {
  clocks(t);
  const starts: number[] = [];
  const events: PerplRequestDiagnostic[] = [];
  let active = 0;
  let maximum = 0;
  const data = new PerplMarketData({
    universe: true,
    sessionLimit: 3,
    schedule: new PerplRequestSchedule(),
    onDiagnostic: (event) => events.push(event),
    transport: async (url) => {
      starts.push(Date.now());
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return Response.json(String(url).endsWith("/context") ? metadata() : ticker(1));
    },
  });
  await settle(t, data.list("mainnet", ["BTC", "ETH"], context()));

  await settle(
    t,
    Promise.all([
      data.snapshotBatch("mainnet", ["BTC"], context()),
      data.snapshotBatch("mainnet", ["ETH"], context()),
    ]),
  );
  await assert.rejects(settle(t, data.snapshotBatch("mainnet", ["BTC"], context())), {
    code: "PERPL_SESSION_LIMIT",
  });

  assert.equal(maximum, 1);
  assert.equal(starts.length, 3);
  assert.ok(starts.slice(1).every((at, i) => at - starts[i]! >= 1000));
  assert.equal(events.at(-1)!.startedAt, null);
  assert.equal(events.at(-1)!.code, "PERPL_SESSION_LIMIT");
});

test("a real HTTP 429 cooldown is shared by the next forced batch rather than bypassed through cache", async (t) => {
  clocks(t);
  let tickerCalls = 0;
  const starts: number[] = [];
  const data = new PerplMarketData({
    universe: true,
    retryTransient: true,
    transport: async (url) => {
      if (String(url).endsWith("/context")) {
        return Response.json(metadata());
      }
      starts.push(Date.now());
      if (++tickerCalls === 1) {
        return new Response("filtered", { status: 429, headers: { "retry-after": "2" } });
      }
      return Response.json(ticker(2));
    },
  });

  await assert.rejects(settle(t, data.snapshotBatch("mainnet", ["BTC"], context())), {
    code: "PERPL_HTTP_429",
  });
  const snapshots = await settle(t, data.snapshotBatch("mainnet", ["BTC"], context()));

  assert.equal(tickerCalls, 2);
  assert.ok(starts[1]! - starts[0]! >= 2000);
  assert.equal(snapshots.length, 1);
});

test("a diagnostic callback failure propagates and cannot trigger a cached or provider fallback", async (t) => {
  clocks(t);
  let calls = 0;
  const data = new PerplMarketData({
    universe: true,
    onTickerRead: () => {
      throw new Error("Controlled diagnostic failure");
    },
    transport: async (url) => {
      calls++;
      return Response.json(String(url).endsWith("/context") ? metadata() : ticker(1));
    },
  });

  await assert.rejects(
    settle(t, data.snapshotBatch("mainnet", ["BTC"], context())),
    /Controlled diagnostic failure/,
  );

  assert.equal(calls, 2);
});
