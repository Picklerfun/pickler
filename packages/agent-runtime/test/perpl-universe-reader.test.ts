import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  PERP_TOOLS,
  PERPL_LAB_SYMBOLS,
  PilotError,
  type AgentRecord,
  type PerpSymbol,
} from "@pickler/core";
import { type PerplDataOptions, type PerplTickerReadDiagnostic } from "@pickler/infrastructure";
import { createUniversePerplReader } from "../src/plugins/perps-paper/universe.js";

const NOW = 1_800_000_000_000;
const ids = [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110];
const markets = PERPL_LAB_SYMBOLS.map((symbol, i) => ({ symbol, marketId: ids[i]! }));
const scope = { tenantId: "test", agentId: "agent" };
function agent(symbols: PerpSymbol[] = [...PERPL_LAB_SYMBOLS]): AgentRecord {
  return {
    id: scope.agentId,
    tenantId: scope.tenantId,
    version: 1,
    config: {
      ...structuredClone(DEFAULT_CONFIG),
      tools: [...PERP_TOOLS],
      plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
      perpl: { version: 2, network: "mainnet", markets: symbols },
    },
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  };
}
function metadata() {
  const address = "0x" + "1".repeat(40);
  return {
    chain: { chain_id: 143 },
    instances: [{ id: 1, address, collateral_token_id: 1 }],
    tokens: [{ id: 1, address, symbol: "AUSD", decimals: 6 }],
    markets: markets.map(({ symbol, marketId }) => ({
      ver: 1,
      id: marketId,
      instance_id: 1,
      perpetual_id: marketId,
      symbol,
      name: `${symbol} Perp`,
      size_units: symbol,
      funding_interval_sec: 3600,
      funding_interval_blocks: 3600,
      config: {
        at: { t: NOW, b: 1 },
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
function ticker() {
  return {
    mt: 9,
    sn: 1,
    d: Object.fromEntries(
      ids.map((id) => [
        String(id),
        {
          at: { t: NOW, b: 1 },
          orl: 100000,
          mrk: 100000,
          lst: 100000,
          bid: 99990,
          ask: 100010,
          oi: 1000,
        },
      ]),
    ),
  };
}
function transport(urls: string[], starts: number[] = []): typeof fetch {
  return async (url, init) => {
    urls.push(String(url));
    starts.push(Date.now());
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    if (String(url).endsWith("/context")) {
      return Response.json(metadata());
    }
    if (String(url).endsWith("/ticker")) {
      return Response.json(ticker());
    }
    assert.match(String(url), /\/book\?levels=20$/);
    return Response.json({
      mt: 15,
      sn: 1,
      at: { t: NOW, b: 1 },
      bid: [{ p: 99990, s: 1000, o: 1 }],
      ask: [{ p: 100010, s: 1000, o: 1 }],
    });
  };
}
function clocks(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Controlled deadline", "TimeoutError")), ms);
    return controller.signal;
  });
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
  for (let i = 0; i < 240 && !done; i++) {
    t.mock.timers.tick(100);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(done, true, "Controlled acquisition exceeded its twenty-second deadline");
  return promise;
}

test("explicit v2 acquires eleven coherent pairs through one shared fresh ticker batch and no models", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const starts: number[] = [];
  const reads: PerplTickerReadDiagnostic[] = [];
  const current = agent();
  const reader = createUniversePerplReader(
    { agent: async () => current },
    {
      acquisitionPolicy: "rest-universe-coherent-20s-v2",
      transport: transport(urls, starts),
      onTickerRead: (value) => reads.push(value),
    },
  );
  t.after(() => reader.close());

  const result = await settle(t, reader.read(scope, markets, new AbortController().signal));

  assert.equal(result.frames.length, 11);
  assert.deepEqual(result.excluded, []);
  assert.equal(urls.length, 13);
  assert.equal(urls.filter((url) => url.endsWith("/ticker")).length, 1);
  assert.equal(reads.length, 1);
  assert.equal(reads[0]!.source, "network");
  assert.deepEqual(reads[0]!.requestedSymbols, [...PERPL_LAB_SYMBOLS]);
  assert.ok(starts.slice(1).every((at, i) => at - starts[i]! >= 1000));
  assert.ok(Date.now() - NOW < 20000);
});

test("the unchanged legacy and v2 readers receive identical eleven-market values with fewer batch requests", async (t) => {
  clocks(t);
  const current = agent();
  const results: {
    policy: string;
    requests: number;
    tickerRequests: number;
    durationMs: number;
  }[] = [];
  const sourceDates: number[][] = [];
  for (const acquisitionPolicy of [
    "rest-universe-20s-v1",
    "rest-universe-coherent-20s-v2",
  ] as const) {
    t.mock.timers.setTime(NOW);
    const urls: string[] = [];
    const reader = createUniversePerplReader(
      { agent: async () => current },
      {
        acquisitionPolicy,
        transport: transport(urls),
      },
    );
    t.after(() => reader.close());

    const result = await settle(t, reader.read(scope, markets, new AbortController().signal));

    assert.equal(result.frames.length, 11);
    assert.deepEqual(result.excluded, []);
    sourceDates.push(
      result.frames.map((frame) => frame.snapshot.ticker.provenance.providerTimestamp!),
    );
    results.push({
      policy: acquisitionPolicy,
      requests: urls.length,
      tickerRequests: urls.filter((url) => url.endsWith("/ticker")).length,
      durationMs: Date.now() - NOW,
    });
    await reader.close();
  }

  assert.deepEqual(sourceDates[0], sourceDates[1]);
  assert.equal(results[0]!.requests, 16);
  assert.equal(results[0]!.tickerRequests, 4);
  assert.equal(results[1]!.requests, 13);
  assert.equal(results[1]!.tickerRequests, 1);
  assert.ok(results[1]!.durationMs < results[0]!.durationMs);
});

test("absent acquisition policy keeps legacy per-symbol cache behavior and identical explicit-v1 results", async (t) => {
  clocks(t);
  const first = agent(["BTC", "ETH"]);
  const urls: string[] = [];
  const reads: PerplTickerReadDiagnostic[] = [];
  const reader = createUniversePerplReader(
    { agent: async () => first },
    {
      transport: transport(urls),
      onTickerRead: (event) => reads.push(event),
    },
  );
  t.after(() => reader.close());
  const selection = markets.filter((market) => first.config.perpl!.markets.includes(market.symbol));

  const result = await settle(t, reader.read(scope, selection, new AbortController().signal));

  assert.equal(result.frames.length, 2);
  assert.deepEqual(
    reads.map((event) => event.batch),
    [false, false],
  );
  assert.deepEqual(
    reads.map((event) => event.source),
    ["network", "cache"],
  );
  assert.equal(urls.filter((url) => url.endsWith("/ticker")).length, 1);

  t.mock.timers.setTime(NOW);
  const explicit = createUniversePerplReader(
    { agent: async () => first },
    {
      acquisitionPolicy: "rest-universe-20s-v1",
      transport: transport([]),
    },
  );
  t.after(() => explicit.close());
  const historical = await settle(t, explicit.read(scope, selection, new AbortController().signal));

  assert.deepEqual(historical, result);
});

test("unknown policy and a requested symbol outside the pinned configuration cannot start ticker transport", async (t) => {
  clocks(t);
  const current = agent(["BTC"]);
  const urls: string[] = [];
  assert.throws(
    () =>
      createUniversePerplReader(
        { agent: async () => current },
        {
          acquisitionPolicy: "unknown" as "rest-universe-20s-v1",
          transport: transport(urls),
        },
      ),
    { code: "INVALID_INPUT" },
  );
  const reader = createUniversePerplReader(
    { agent: async () => current },
    {
      acquisitionPolicy: "rest-universe-coherent-20s-v2",
      transport: transport(urls),
    },
  );
  t.after(() => reader.close());

  await assert.rejects(settle(t, reader.read(scope, markets, new AbortController().signal)), {
    code: "PERPL_MARKET_IDENTITY",
  });

  assert.equal(urls.filter((url) => url.endsWith("/ticker")).length, 0);
});

test("getPerpSnapshot permission revoked during a bulk response prevents delivery and any subsequent request", async (t) => {
  clocks(t);
  const current = agent();
  const urls: string[] = [];
  const reads: PerplTickerReadDiagnostic[] = [];
  const reader = createUniversePerplReader(
    { agent: async () => current },
    {
      acquisitionPolicy: "rest-universe-coherent-20s-v2",
      transport: transport(urls),
      onTickerRead: (event) => reads.push(event),
      onResponse: async (response) => {
        if (response.url.endsWith("/ticker")) {
          current.config.tools = current.config.tools.filter((tool) => tool !== "getPerpSnapshot");
        }
      },
    },
  );
  t.after(() => reader.close());

  await assert.rejects(settle(t, reader.read(scope, markets, new AbortController().signal)), {
    code: "TOOL_DISABLED",
  });
  const previous = urls.length;
  await assert.rejects(reader.read(scope, markets, new AbortController().signal), {
    code: "TOOL_DISABLED",
  });

  assert.equal(reads.length, 0);
  assert.equal(urls.length, previous);
});

test("ownership lost during a bulk response remains LEASE_LOST and does not return a partial set", async (t) => {
  clocks(t);
  const current = agent();
  const urls: string[] = [];
  const reads: PerplTickerReadDiagnostic[] = [];
  let owned = true;
  const guard = async () => {
    if (!owned) {
      throw new PilotError("LEASE_LOST", "Controlled lease loss");
    }
  };
  const reader = createUniversePerplReader(
    { agent: async () => current },
    {
      acquisitionPolicy: "rest-universe-coherent-20s-v2",
      transport: transport(urls),
      onTickerRead: (event) => reads.push(event),
      onResponse: async (response) => {
        if (response.url.endsWith("/ticker")) {
          owned = false;
        }
      },
    },
  );
  t.after(() => reader.close());

  await assert.rejects(
    settle(t, reader.read(scope, markets, new AbortController().signal, guard)),
    { code: "LEASE_LOST" },
  );
  const previous = urls.length;
  await assert.rejects(reader.read(scope, markets, new AbortController().signal, guard), {
    code: "LEASE_LOST",
  });

  assert.equal(reads.length, 0);
  assert.equal(urls.length, previous);
});

test("parent cancellation and reader closure during a bulk response never become deadline omissions", async (t) => {
  clocks(t);
  const current = agent();
  const controller = new AbortController();
  const urls: string[] = [];
  const reader = createUniversePerplReader(
    { agent: async () => current },
    {
      acquisitionPolicy: "rest-universe-coherent-20s-v2",
      transport: transport(urls),
      onResponse: async (response) => {
        if (response.url.endsWith("/ticker")) {
          controller.abort(new PilotError("LEASE_LOST", "Controlled parent cancellation"));
        }
      },
    },
  );
  t.after(() => reader.close());

  await assert.rejects(settle(t, reader.read(scope, markets, controller.signal)), {
    code: "LEASE_LOST",
  });
  await reader.close();
  const previous = urls.length;
  await assert.rejects(reader.read(scope, markets, new AbortController().signal), {
    code: "DATA_READER_CLOSED",
  });

  assert.equal(urls.length, previous);
});

test("the v2 twenty-second budget starts before metadata, cancels queued books, and rechecks live ownership", async (t) => {
  clocks(t);
  const current = agent();
  const urls: string[] = [];
  const starts: number[] = [];
  let liveGuards = 0;
  const options: PerplDataOptions = {
    transport: transport(urls, starts),
    onResponse: async (response) => {
      if (response.url.endsWith("/context")) {
        t.mock.timers.tick(19000);
      }
    },
  };
  const reader = createUniversePerplReader(
    { agent: async () => current },
    {
      ...options,
      acquisitionPolicy: "rest-universe-coherent-20s-v2",
    },
  );
  t.after(() => reader.close());

  const result = await settle(
    t,
    reader.read(scope, markets, new AbortController().signal, async () => {
      liveGuards++;
    }),
  );

  assert.equal(result.frames.length, 0);
  assert.equal(result.excluded.length, 11);
  assert.ok(urls.length <= 2);
  assert.ok(starts.every((at) => at < NOW + 20000));
  assert.ok(Date.now() - NOW <= 20100);
  assert.ok(liveGuards > 0);
});
