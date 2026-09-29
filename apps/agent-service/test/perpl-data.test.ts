import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  DEFAULT_CONFIG,
  PERP_TOOLS,
  assertConfig,
  createPerpReadService,
  effectivePlugins,
  type AgentRecord,
  type PerpNetwork,
} from "@pickler/core";
import { PerplMarketData } from "@pickler/infrastructure";
import { createPerplSession } from "@pickler/agent-runtime/plugins/perpl";
import { agentConfigSchema, studioOptionsSchema } from "@pickler/api-schema";
import { PLUGINS } from "@pickler/core";
import { capturePerplData } from "../src/perpl/capture.js";

const now = 1_800_000_000_000;
const scope = { tenantId: "tenant", agentId: "agent" };
function agent(): AgentRecord {
  return {
    id: scope.agentId,
    tenantId: scope.tenantId,
    version: 1,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
    config: {
      ...structuredClone(DEFAULT_CONFIG),
      plugins: { version: 1, enabled: ["perpl"] },
      tools: [...PERP_TOOLS],
      perpl: { version: 1, network: "mainnet", markets: ["BTC", "ETH"] },
    },
  };
}
function context(network: PerpNetwork = "mainnet") {
  const main = network === "mainnet";
  return {
    chain: { chain_id: main ? 143 : 10143, gas: { h: 100 } },
    instances: [{ id: 1, address: "0x" + "1".repeat(40), collateral_token_id: 1 }],
    tokens: [{ id: 1, address: "0x" + "2".repeat(40), symbol: "AUSD", decimals: 6 }],
    markets: ["BTC", "ETH"].map((symbol, i) => ({
      ver: 7,
      id: main ? [1, 20][i] : [16, 32][i],
      instance_id: 1,
      perpetual_id: main ? [1, 20][i] : [16, 32][i],
      symbol: symbol === "BTC" ? "" : symbol,
      name: symbol,
      size_units: symbol,
      funding_interval_sec: 2580,
      funding_interval_blocks: 8571,
      config: {
        at: { t: now - 86400000, b: 10 },
        is_open: true,
        price_decimals: i + 1,
        size_decimals: 5 - i,
        initial_margin: 1500,
        maintenance_margin: 2500,
        maker_fee: -5,
        taker_fee: 345,
      },
      funding: { at: { t: now + 30000, b: 110 }, feb: 110, rate: -40 },
    })),
  };
}
function ticker(id = 1) {
  return {
    mt: 9,
    sn: 100,
    d: {
      [id]: {
        at: { t: now - 1000, b: 99 },
        mrk: 830001,
        orl: 830000,
        lst: 830005,
        bid: 829999,
        ask: 830003,
        oi: 123456,
      },
    },
  };
}
function book() {
  return {
    mt: 15,
    sn: 101,
    at: { t: now - 500, b: 101 },
    bid: [{ p: 829999, s: 100, o: 1 }],
    ask: [{ p: 830003, s: 250, o: 2 }],
  };
}
function provider(
  overrides: {
    context?: unknown;
    ticker?: unknown;
    book?: unknown;
    candles?: unknown;
    status?: number;
  } = {},
) {
  const urls: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.headers, undefined);
    if (overrides.status) {
      return new Response("private provider error", { status: overrides.status });
    }
    if (url.endsWith("/context")) {
      return Response.json(
        overrides.context ?? context(url.includes("testnet") ? "testnet" : "mainnet"),
      );
    }
    if (url.endsWith("/ticker")) {
      return Response.json(overrides.ticker ?? ticker(Number(url.split("/").at(-2))));
    }
    if (url.includes("/book?")) {
      return Response.json(overrides.book ?? book());
    }
    return Response.json(overrides.candles ?? { at: { t: now, b: 100 }, r: 3600, d: [] });
  };
  return { transport, urls };
}
const readContext = () => ({ signal: new AbortController().signal, guard: async () => {} });

test("Perpl registry/config is additive and does not enable tools in historical defaults", () => {
  const config = agent().config;
  assertConfig(config);
  agentConfigSchema.parse(config);
  assert.equal(
    DEFAULT_CONFIG.tools.some((tool) => PERP_TOOLS.includes(tool as (typeof PERP_TOOLS)[number])),
    false,
  );
  assert.equal(effectivePlugins(DEFAULT_CONFIG).enabled.includes("perpl"), false);
  studioOptionsSchema.parse({ defaults: DEFAULT_CONFIG, plugins: PLUGINS });
  assert.throws(() =>
    assertConfig({ ...config, perpl: { version: 1, network: "mainnet", markets: ["BTC", "BTC"] } }),
  );
});

test("normalization resolves network IDs, exact decimals, signed fees and funding without hourly conversion", async () => {
  const fixture = provider();
  const data = new PerplMarketData({ transport: fixture.transport, now: () => now });
  const main = await data.list("mainnet", ["BTC", "ETH"], readContext());
  const snap = await data.snapshot("mainnet", "BTC", readContext());
  const other = await data.list("testnet", ["BTC"], readContext());
  assert.deepEqual(
    main.markets.map((m) => m.marketId),
    [1, 20],
  );
  assert.equal(other.markets[0]!.marketId, 16);
  assert.equal(snap.ticker.mark, "83000.1");
  assert.equal(snap.ticker.openInterestBase, "1.23456");
  assert.equal(snap.market.fees.maker, "-0.000005");
  assert.equal(snap.funding!.rate, "-0.00004");
  assert.equal(snap.funding!.intervalSeconds, 2580);
  assert.equal(snap.funding!.applicationTimeEstimated, true);
  assert.equal(snap.ticker.freshness, "fresh");
  assert.equal(snap.market.provenance.block, 10);
  assert.equal(snap.ticker.provenance.block, 99);
  assert.equal(fixture.urls.filter((url) => url.endsWith("context")).length, 2);
});

test("identity conflicts, wrong network and unsafe provider integers fail without fallback", async () => {
  const ambiguous = context();
  ambiguous.markets.push({ ...ambiguous.markets[0]!, id: 99 });
  const badUnits = context();
  badUnits.markets[0]!.size_units = "ETH";
  const unsafe = context();
  unsafe.markets[0]!.id = Number.MAX_SAFE_INTEGER + 1;
  for (const raw of [ambiguous, badUnits, unsafe, { ...context(), chain: { chain_id: 10143 } }]) {
    const f = provider({ context: raw });
    await assert.rejects(
      new PerplMarketData({ transport: f.transport }).list("mainnet", ["BTC"], readContext()),
    );
    assert.equal(f.urls.length, 1);
  }
});

test("permission guards apply before cache reads and reject revocation or cross-tenant lookup", async () => {
  let record = agent();
  const f = provider();
  const data = new PerplMarketData({ transport: f.transport, now: () => now });
  const service = await createPerpReadService({ repository: { agent: async () => record }, data })(
    scope,
    new AbortController().signal,
  );
  await service.listPerpMarkets();
  record.config.plugins!.enabled = [];
  await assert.rejects(service.listPerpMarkets(), /disabled/);
  assert.equal(f.urls.length, 1);
  record = agent();
  record.config.tools = [];
  await assert.rejects(service.listPerpMarkets(), /disabled/);
  record = agent();
  record.version++;
  await assert.rejects(service.listPerpMarkets(), /changed/);
  record = agent();
  record.tenantId = "another";
  await assert.rejects(
    createPerpReadService({ repository: { agent: async () => record }, data })(
      scope,
      new AbortController().signal,
    ),
    /scope/,
  );
});

test("revocation during response discards data before raw capture hook", async () => {
  const record = agent();
  let captured = 0;
  const session = await createPerplSession(
    { agent: async () => record },
    scope,
    new AbortController().signal,
    {
      transport: async () => {
        record.version++;
        return Response.json(context());
      },
      onResponse: async () => {
        captured++;
      },
    },
  );
  await assert.rejects(session.service.listPerpMarkets(), /changed/);
  assert.equal(captured, 0);
});

test("Mastra read tools execute the guarded service with validated output", async () => {
  const record = agent();
  record.config.perpl!.markets = ["BTC"];
  const f = provider();
  const session = await createPerplSession(
    { agent: async () => record },
    scope,
    new AbortController().signal,
    { transport: f.transport, now: () => now },
  );
  const result = await session.tools.listPerpMarkets.execute!({}, {} as never);
  assert.ok(result && "markets" in result);
  assert.equal(result.markets.length, 1);
  const snap = await session.tools.getPerpSnapshot.execute!({ symbol: "BTC" }, {} as never);
  assert.ok(snap && "ticker" in snap);
  assert.equal(snap.ticker.mark, "83000.1");
  await assert.rejects(session.service.getPerpSnapshot({ symbol: "ETH" }), /not enabled/);
  assert.equal(f.urls.length, 2);
});

test("empty books remain empty and stale snapshots remain explicitly stale", async () => {
  const stale = ticker();
  stale.d[1]!.at.t = now - 31000;
  const f = provider({ ticker: stale, book: { ...book(), bid: [], ask: [] } });
  const data = new PerplMarketData({ transport: f.transport, now: () => now });
  const snap = await data.snapshot("mainnet", "BTC", readContext());
  const depth = await data.book("mainnet", "BTC", 20, readContext());
  assert.equal(snap.ticker.freshness, "stale");
  assert.deepEqual(depth.bids, []);
  assert.deepEqual(depth.asks, []);
  assert.equal(depth.depthLimited, true);
  assert.equal(depth.requestedLevels, 20);
});

test("future ticker, crossed book and excessive depth are rejected", async () => {
  const future = ticker();
  future.d[1]!.at.t = now + 5001;
  const f = provider({ ticker: future });
  await assert.rejects(
    new PerplMarketData({ transport: f.transport, now: () => now }).snapshot(
      "mainnet",
      "BTC",
      readContext(),
    ),
  );
  const crossed = book();
  crossed.bid[0]!.p = crossed.ask[0]!.p;
  const g = provider({ book: crossed });
  const data = new PerplMarketData({ transport: g.transport, now: () => now });
  await assert.rejects(data.book("mainnet", "BTC", 20, readContext()));
  await assert.rejects(data.book("mainnet", "BTC", 101, readContext()));
  assert.equal(g.urls.length, 2);
});

test("candle gaps and current open candle are retained with exact collateral volume", async () => {
  const from = Math.floor(now / 3600000) * 3600000 - 3600000;
  const f = provider({
    candles: {
      at: { t: now },
      r: 3600,
      d: [{ t: from + 3600000, o: 10, h: 15, l: 9, c: 12, v: "1234567890123456789", n: 2 }],
    },
  });
  const data = new PerplMarketData({ transport: f.transport, now: () => now + 1000 });
  const result = await data.candles(
    "mainnet",
    { symbol: "BTC", resolution: 3600, from, to: from + 7200000 },
    readContext(),
  );
  assert.deepEqual(result.missingOpenTimes, [from]);
  assert.equal(result.candles[0]!.closed, false);
  assert.equal(result.candles[0]!.volumeCollateral, "1234567890123.456789");
  assert.ok(f.urls[1]!.endsWith(`${from}-${from + 3600000}`));
  await assert.rejects(
    data.candles(
      "mainnet",
      { symbol: "BTC", resolution: 3600, from, to: from + 1025 * 3600000 },
      readContext(),
    ),
  );
  assert.equal(f.urls.length, 2);
});

test("HTTP failures and redirects are not retried and stop further transport", async () => {
  for (const status of [302, 429, 503]) {
    const f = provider({ status });
    const data = new PerplMarketData({ transport: f.transport });
    await assert.rejects(
      data.list("mainnet", ["BTC"], readContext()),
      (error: unknown) => (error as { code: string }).code === `PERPL_HTTP_${status}`,
    );
    await assert.rejects(data.list("mainnet", ["BTC"], readContext()));
    assert.equal(f.urls.length, 1);
  }
});

test("body size bounds apply to streaming responses without content-length", async () => {
  let calls = 0;
  const data = new PerplMarketData({
    transport: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
            c.close();
          },
        }),
      );
    },
  });
  await assert.rejects(data.list("mainnet", ["BTC"], readContext()), /2 MiB/);
  assert.equal(calls, 1);
});

test("cancellation interrupts blocked transport without a retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const data = new PerplMarketData({
    transport: async () => {
      calls++;
      controller.abort();
      return new Promise<Response>(() => {});
    },
  });
  await assert.rejects(
    data.list("mainnet", ["BTC"], { signal: controller.signal, guard: async () => {} }),
  );
  assert.equal(calls, 1);
});

test("capture preserves original hashes, partial failures and exclusive attempt directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "perpl-capture-"));
  const record = agent();
  record.config.perpl!.markets = ["BTC"];
  const f = provider({ book: { invalid: "do-not-log-me" } });
  try {
    const result = await capturePerplData({
      repository: { agent: async () => record },
      scope,
      root,
      attempt: "first",
      signal: new AbortController().signal,
      options: { transport: f.transport, now: () => now },
    });
    assert.equal(result.status, "incomplete");
    assert.equal(result.failure, "PERPL_INVALID_RESPONSE");
    const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"));
    assert.equal(
      manifest.files.filter((entry: { kind: string }) => entry.kind === "original").length,
      3,
    );
    for (const entry of manifest.files) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(result.directory, entry.name)))
          .digest("hex"),
        entry.sha256,
      );
    }
    assert.ok((await readdir(result.directory)).includes("BTC-snapshot.json"));
    assert.equal(JSON.stringify(result).includes("do-not-log-me"), false);
    await assert.rejects(
      capturePerplData({
        repository: { agent: async () => record },
        scope,
        root,
        attempt: "first",
        signal: new AbortController().signal,
      }),
    );
    assert.equal(f.urls.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context expires after 30 seconds and absent funding stays unknown", async () => {
  let clock = now;
  const raw = context();
  const f = provider({
    context: { ...raw, markets: raw.markets.map((m) => ({ ...m, funding: null })) },
  });
  const data = new PerplMarketData({ transport: f.transport, now: () => clock });
  await data.list("mainnet", ["BTC"], readContext());
  clock += 30_001;
  const snapshot = await data.snapshot("mainnet", "BTC", readContext());
  assert.equal(snapshot.funding, null);
  assert.equal(f.urls.length, 3);
});

test("concurrent reads serialize, enforce spacing and stop at twelve requests", async () => {
  const f = provider();
  const starts: number[] = [];
  let active = 0;
  const data = new PerplMarketData({
    now: () => now,
    transport: async (...args) => {
      assert.equal(active++, 0);
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await f.transport(...args);
      } finally {
        active--;
      }
    },
  });
  await data.list("mainnet", ["BTC"], readContext());
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => data.snapshot("mainnet", "BTC", readContext())),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 11);
  assert.equal(starts.length, 12);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i]! - starts[i - 1]! >= 990);
  }
});

test("ten-second timeout stops a blocked response without retry", async () => {
  let calls = 0;
  // Keep the event loop alive: AbortSignal.timeout itself uses an unreferenced timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const data = new PerplMarketData({
      transport: async () => {
        calls++;
        return new Promise<Response>(() => {});
      },
    });
    await assert.rejects(
      data.list("mainnet", ["BTC"], readContext()),
      (error: unknown) => (error as { code: string }).code === "PERPL_TIMEOUT",
    );
    await assert.rejects(data.list("mainnet", ["BTC"], readContext()));
    assert.equal(calls, 1);
  } finally {
    clearInterval(keepAlive);
  }
});

test("duplicate and out-of-range candles fail instead of silently correcting evidence", async () => {
  const from = Math.floor(now / 3600000) * 3600000 - 3600000;
  const candle = { t: from, o: 10, h: 12, l: 9, c: 11, v: "100", n: 1 };
  for (const d of [[candle, candle], [{ ...candle, t: from - 3600000 }]]) {
    const f = provider({ candles: { at: { t: now }, r: 3600, d } });
    await assert.rejects(
      new PerplMarketData({ transport: f.transport, now: () => now }).candles(
        "mainnet",
        { symbol: "BTC", resolution: 3600, from, to: from + 3600000 },
        readContext(),
      ),
    );
    assert.equal(f.urls.length, 2);
  }
});

test("two-market capture completes with seven public requests and immutable hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "perpl-complete-"));
  const f = provider();
  try {
    const result = await capturePerplData({
      repository: { agent: async () => agent() },
      scope,
      root,
      attempt: "complete",
      signal: new AbortController().signal,
      options: { transport: f.transport, now: () => now },
    });
    assert.equal(result.status, "complete");
    assert.equal(result.markets.length, 2);
    assert.equal(f.urls.length, 7);
    const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"));
    for (const entry of manifest.files) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(result.directory, entry.name)))
          .digest("hex"),
        entry.sha256,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coherent reader shares one snapshot for BTC/ETH and never constructs models", async () => {
  const { createCoherentPerplReader } = await import("@pickler/agent-runtime/plugins/perps-paper");
  const source = provider();
  const frames = await createCoherentPerplReader(
    { agent: async () => agent() },
    {
      transport: source.transport,
      now: () => now,
    },
  )(scope, ["BTC", "ETH"], new AbortController().signal);
  assert.deepEqual(
    frames.map((frame) => frame.snapshot.market.symbol),
    ["BTC", "ETH"],
  );
  assert.equal(source.urls.filter((url) => url.endsWith("/context")).length, 1);
  assert.equal(source.urls.length, 5);
});

test("429 shares Retry-After across sessions without exposing response content", async () => {
  const { PerplRequestSchedule } = await import("@pickler/infrastructure");
  const schedule = new PerplRequestSchedule();
  let calls = 0;
  const events: unknown[] = [];
  const options = {
    schedule,
    retryTransient: true,
    onDiagnostic: (event: unknown) => events.push(event),
    transport: (async () => {
      calls++;
      return new Response("secret-body", {
        status: 429,
        headers: { "Retry-After": "60", Authorization: "secret" },
      });
    }) as typeof fetch,
  };
  const first = new PerplMarketData(options);
  await assert.rejects(first.list("mainnet", ["BTC"], readContext()), { code: "PERPL_HTTP_429" });
  assert.ok(schedule.blockedUntil - Date.now() > 59000);
  const controller = new AbortController();
  const next = new PerplMarketData(options).list("mainnet", ["BTC"], {
    guard: async () => {},
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(next);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(events).includes("secret"), false);
});

test("429 without Retry-After applies the sixty-second fallback without a retry", async () => {
  const { PerplRequestSchedule } = await import("@pickler/infrastructure");
  const schedule = new PerplRequestSchedule();
  let calls = 0;
  await assert.rejects(
    new PerplMarketData({
      schedule,
      retryTransient: true,
      transport: (async () => {
        calls++;
        return new Response(null, { status: 429 });
      }) as typeof fetch,
    }).list("mainnet", ["BTC"], readContext()),
    { code: "PERPL_HTTP_429" },
  );
  assert.equal(calls, 1);
  assert.ok(schedule.blockedUntil - Date.now() > 59000);
});

test(
  "joint acquisition cancels blocked public requests at the total twenty-second deadline",
  { timeout: 25000 },
  async () => {
    const { createCoherentPerplReader } =
      await import("@pickler/agent-runtime/plugins/perps-paper");
    const signals: AbortSignal[] = [];
    const started = Date.now();
    const reader = createCoherentPerplReader(
      { agent: async () => agent() },
      {
        transport: (async (_url, init) => {
          signals.push(init!.signal!);
          return new Promise<Response>(() => {});
        }) as typeof fetch,
      },
    );
    await assert.rejects(reader(scope, ["BTC", "ETH"], new AbortController().signal), {
      code: "DATA_UNAVAILABLE",
    });
    assert.ok(Date.now() - started < 24000);
    assert.ok(signals.length >= 1 && signals.length <= 2);
    assert.ok(signals.every((signal) => signal.aborted));
  },
);
