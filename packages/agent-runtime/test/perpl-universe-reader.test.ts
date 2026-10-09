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
import type { PerplSocket } from "@pickler/infrastructure";
import { writeFile } from "node:fs/promises";
import { createUniversePerplReader } from "../src/plugins/perps-paper/universe.js";
import { createPriorityPerplStudyData } from "../src/plugins/perps-paper/priority-study.js";
import type { PerpsStudyRecord } from "@pickler/trading/evaluation";

const NOW = 1_800_000_000_000;
const ids = [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110];
const markets = PERPL_LAB_SYMBOLS.map((symbol, i) => ({ symbol, marketId: ids[i]! }));
const scope = { tenantId: "test", agentId: "agent" };
class UniverseSocket implements PerplSocket {
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  missing: number | undefined;
  rejected = false;
  publicationAt: number | undefined;
  constructor() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open");
    });
  }
  addEventListener(type: string, callback: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  emit(type: string, value?: unknown) {
    for (const callback of this.listeners.get(type) ?? []) {
      callback({ data: value === undefined ? undefined : JSON.stringify(value) });
    }
  }
  send(value: string) {
    this.sent.push(value);
    const subs = JSON.parse(value).subs as { stream: string }[];
    const publicationAt = this.publicationAt ?? NOW;
    assert.equal(subs.length, 13);
    queueMicrotask(() => {
      this.emit("message", {
        mt: 6,
        subs: subs.map((s, i) => ({
          ...s,
          sid: i + 1,
          status: { code: this.rejected && i === 12 ? 404 : 0 },
        })),
      });
      if (this.rejected) {
        return;
      }
      const prices = ticker();
      for (const value of Object.values(prices.d)) {
        value.at.t = publicationAt;
      }
      this.emit("message", { ...prices, sid: 2 });
      for (let i = 0; i < 11; i++) {
        if (i !== this.missing) {
          this.emit("message", {
            mt: 15,
            sid: i + 3,
            at: { t: publicationAt, b: 1 },
            bid: [{ p: 99990, s: 1000, o: 1 }],
            ask: [{ p: 100010, s: 1000, o: 1 }],
          });
        }
      }
    });
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}
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
async function settle<T>(t: TestContext, promise: Promise<T>, maximumMs = 24000): Promise<T> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let i = 0; i < maximumMs / 100 && !done; i++) {
    t.mock.timers.tick(100);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(done, true, "Controlled operation exceeded its bounded clock window");
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

test("stream universe freezes thirteen subscriptions and reuses one guarded generation without REST prices", async (t) => {
  clocks(t);
  const current = agent();
  const urls: string[] = [];
  const sockets: UniverseSocket[] = [];
  const reader = createUniversePerplReader(
    { agent: async () => current },
    {
      acquisitionPolicy: "stream-universe-20s-v1",
      transport: transport(urls),
      socket: () => {
        const socket = new UniverseSocket();
        sockets.push(socket);
        return socket;
      },
    },
  );
  t.after(() => reader.close());
  const parent = new AbortController();
  const initial = await settle(t, reader.read(scope, markets, parent.signal));
  const latest = await settle(t, reader.latest(scope, markets, parent.signal));
  const final = await settle(t, reader.read(scope, markets, parent.signal));

  assert.equal(initial.frames.length, 11);
  assert.equal(final.frames.length, 11);
  assert.deepEqual(
    latest.frames.map((f) => f.snapshot.ticker.mark),
    initial.frames.map((f) => f.snapshot.ticker.mark),
  );
  assert.deepEqual(
    urls.map((url) => new URL(url).pathname),
    ["/api/v1/pub/context"],
  );
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0]!.sent.length, 1);
  initial.frames[0]!.snapshot.market.marketId = 999;
  const unchanged = await reader.latest(scope, markets, parent.signal);
  assert.equal(unchanged.frames[0]!.snapshot.market.marketId, 1);
  await reader.close();
  assert.equal(sockets[0]!.readyState, 3);
  await assert.rejects(reader.latest(scope, markets, parent.signal), {
    code: "DATA_READER_CLOSED",
  });
});

test("one unavailable stream market exhausts the original twenty seconds and is not repaired through REST", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const socket = new UniverseSocket();
  socket.missing = 10;
  const reader = createUniversePerplReader(
    { agent: async () => agent() },
    {
      acquisitionPolicy: "stream-universe-20s-v1",
      transport: transport(urls),
      socket: () => {
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
    },
  );
  t.after(() => reader.close());

  const result = await settle(t, reader.read(scope, markets, new AbortController().signal));

  assert.equal(result.frames.length, 0);
  assert.equal(result.excluded.length, 11);
  assert.ok(Date.now() - NOW >= 20000 && Date.now() - NOW <= 20100);
  assert.equal(urls.length, 1);
  assert.equal(socket.sent.length, 2);
  assert.equal(socket.sent[1], socket.sent[0]);
});

test("an incoherent warm stream requests provider snapshots without replacing dates or using REST", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const events: import("@pickler/infrastructure").PerplStreamEvent[] = [];
  const socket = new UniverseSocket();
  const reader = createUniversePerplReader(
    { agent: async () => agent() },
    {
      acquisitionPolicy: "stream-universe-20s-v1",
      transport: transport(urls),
      onStream: (event) => events.push(event),
      socket: () => {
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
    },
  );
  t.after(() => reader.close());
  const parent = new AbortController().signal;
  await settle(t, reader.read(scope, markets, parent));
  t.mock.timers.tick(15000);
  socket.emit("message", {
    mt: 16,
    sid: 3,
    at: { t: Date.now(), b: 1 },
    bid: [],
    ask: [],
  });
  socket.publicationAt = Date.now();

  const refreshed = await settle(t, reader.read(scope, markets, parent));

  assert.equal(refreshed.frames.length, 11);
  assert.equal(socket.sent.length, 2);
  assert.equal(events.filter((event) => event.kind === "snapshot-request").length, 1);
  assert.ok(refreshed.frames.every((f) => f.snapshot.ticker.provenance.providerTimestamp! > NOW));
  assert.ok(refreshed.frames.every((f) => f.book.provenance.providerTimestamp! > NOW));
  assert.deepEqual(
    urls.map((url) => new URL(url).pathname),
    ["/api/v1/pub/context"],
  );
});

test("partial subscription rejection remains fatal rather than an availability omission", async (t) => {
  clocks(t);
  const socket = new UniverseSocket();
  socket.rejected = true;
  const reader = createUniversePerplReader(
    { agent: async () => agent() },
    {
      acquisitionPolicy: "stream-universe-20s-v1",
      transport: transport([]),
      socket: () => {
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
    },
  );
  t.after(() => reader.close());

  await assert.rejects(settle(t, reader.read(scope, markets, new AbortController().signal)), {
    code: "PERPL_STREAM_SUBSCRIPTION",
  });
  assert.equal(socket.readyState, 3);
});

test("stream buffer revocation, changed configuration, lease loss and cancellation forbid reuse", async (t) => {
  clocks(t);
  for (const reason of ["PLUGIN_DISABLED", "CONFIG_CHANGED", "LEASE_LOST", "CANCELLED"] as const) {
    t.mock.timers.setTime(NOW);
    const current = agent();
    let owned = true;
    const parent = new AbortController();
    const sockets: UniverseSocket[] = [];
    const guard = async () => {
      if (!owned) {
        throw new PilotError("LEASE_LOST", "Controlled");
      }
    };
    const reader = createUniversePerplReader(
      { agent: async () => current },
      {
        acquisitionPolicy: "stream-universe-20s-v1",
        transport: transport([]),
        socket: () => {
          const s = new UniverseSocket();
          sockets.push(s);
          return s;
        },
      },
    );
    t.after(() => reader.close());
    await settle(t, reader.read(scope, markets, parent.signal, guard));
    if (reason === "PLUGIN_DISABLED") {
      current.config.plugins.enabled = [];
    }
    if (reason === "CONFIG_CHANGED") {
      current.version++;
    }
    if (reason === "LEASE_LOST") {
      owned = false;
    }
    if (reason === "CANCELLED") {
      parent.abort(new PilotError(reason, "Controlled"));
    }

    await assert.rejects(reader.latest(scope, markets, parent.signal, guard), { code: reason });
    await reader.close();
    assert.ok(sockets.every((s) => s.readyState === 3));
  }
});

test("stream cold boot includes delayed metadata and never opens a socket after the deadline", async (t) => {
  clocks(t);
  let sockets = 0;
  const reader = createUniversePerplReader(
    { agent: async () => agent() },
    {
      acquisitionPolicy: "stream-universe-20s-v1",
      transport: transport([]),
      onResponse: async () => {
        t.mock.timers.tick(20000);
      },
      socket: () => {
        sockets++;
        return new UniverseSocket();
      },
    },
  );
  t.after(() => reader.close());

  const result = await settle(t, reader.read(scope, markets, new AbortController().signal));
  assert.equal(result.frames.length, 0);
  assert.equal(sockets, 0);
});

test("blocked ownership or suspension cannot extend the stream deadline or start a late socket", async (t) => {
  clocks(t);
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sockets = 0;
  const urls: string[] = [];
  const reader = createUniversePerplReader(
    {
      agent: async () => {
        await blocked;
        return agent();
      },
    },
    {
      acquisitionPolicy: "stream-universe-20s-v1",
      transport: transport(urls),
      socket: () => {
        sockets++;
        return new UniverseSocket();
      },
    },
  );
  t.after(() => reader.close());
  const result = await settle(t, reader.read(scope, markets, new AbortController().signal));
  assert.equal(result.frames.length, 0);
  assert.ok(Date.now() - NOW <= 20100);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sockets, 0);
  assert.deepEqual(urls, []);
});

test("priority observation, initial evidence and shared final evidence use the same stream instance", async (t) => {
  clocks(t);
  const urls: string[] = [];
  let sockets = 0;
  const current = agent();
  const data = createPriorityPerplStudyData(
    { agent: async () => current },
    {
      acquisitionPolicy: "stream-universe-20s-v1",
      transport: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith("/context")) {
          return Response.json(metadata());
        }
        const resolution = Number(/\/candles\/(\d+)\//.exec(String(url))?.[1]);
        assert.ok([300, 900, 3600].includes(resolution));
        const end = Math.floor(Date.now() / (resolution * 1000)) * resolution * 1000;
        return Response.json({
          at: { t: Date.now(), b: 1 },
          r: resolution,
          d: Array.from({ length: 60 }, (_, i) => ({
            t: end - (60 - i) * resolution * 1000,
            o: 100000,
            c: 100000,
            h: 100000,
            l: 100000,
            v: "1000",
            n: 1,
          })),
        });
      },
      socket: () => {
        sockets++;
        const socket = new UniverseSocket();
        socket.publicationAt = Date.now();
        return socket;
      },
    },
  );
  t.after(() => data.close());
  const record = {
    config: {
      version: 7,
      protocol: "perps-sma-reentry-latency-v1",
      tenantId: scope.tenantId,
      sessionId: "controlled",
      network: "mainnet",
      hours: 6,
      budgetUsd: "5",
      markets,
      acquisitionPolicy: "stream-universe-20s-v1",
    },
    agentIds: { "sma-reference": scope.agentId },
  } as unknown as PerpsStudyRecord;
  const parent = new AbortController();
  const initial = await settle(
    t,
    data.prepareEvidence!(record, parent.signal, async () => {}),
    70000,
  );
  const observation = await settle(
    t,
    data.observe(record, parent.signal, async () => {}),
  );
  const final = await settle(
    t,
    data.finalEvidence!(record, parent.signal, async () => {}),
  );
  assert.equal(initial.frames.length, 11);
  assert.equal(initial.candles.length, 33);
  assert.equal(observation.frames.length, 11);
  assert.equal(final.frames.length, 11);
  assert.equal(sockets, 1);
  assert.equal(urls.filter((url) => /\/(ticker|book)(\?|$)/.test(url)).length, 0);
});

test("thirty controlled cold and warm measurements compare identical REST/stream financial inputs", async (t) => {
  clocks(t);
  const measurements: unknown[] = [];
  for (const scenario of ["cold", "warm"] as const) {
    for (const policy of ["rest-universe-coherent-20s-v2", "stream-universe-20s-v1"] as const) {
      for (let repetition = 0; repetition < 30; repetition++) {
        t.mock.timers.setTime(NOW);
        const reader = createUniversePerplReader(
          { agent: async () => agent() },
          {
            acquisitionPolicy: policy,
            transport: transport([]),
            socket: () => new UniverseSocket(),
          },
        );
        const parent = new AbortController();
        if (scenario === "warm") {
          await settle(t, reader.read(scope, markets, parent.signal));
        }
        const start = Date.now();
        const wall = performance.now();
        const result = await settle(t, reader.read(scope, markets, parent.signal));
        const wallMs = performance.now() - wall;
        assert.equal(result.frames.length, 11);
        assert.ok(
          result.frames.every(
            (f) =>
              f.snapshot.ticker.mark === "1000" &&
              f.book.bids[0]!.price === "999.9" &&
              f.book.asks[0]!.price === "1000.1",
          ),
        );
        measurements.push({
          scenario,
          policy,
          repetition,
          simulatedMs: Date.now() - start,
          measuredWallMs: wallMs,
          validMarkets: result.frames.length,
        });
        await reader.close();
      }
    }
  }
  if (process.env.PICKLER_CONTROLLED_TIMING_FILE) {
    await writeFile(
      process.env.PICKLER_CONTROLLED_TIMING_FILE,
      JSON.stringify(
        {
          version: 1,
          source: "CONTROLLED_FIXTURES_NO_PROVIDERS",
          measurements,
          limitation:
            "Mock-clock scheduling and measured fixture processing are separate; neither measures public network latency.",
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
  }
  assert.equal(measurements.length, 120);
});
