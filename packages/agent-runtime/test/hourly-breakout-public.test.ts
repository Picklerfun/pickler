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
import type { PerplSocket } from "@pickler/infrastructure/perpl-public";
import {
  createHourlyBreakoutPublicReader,
  type BreakoutCandleVersion,
} from "../src/plugins/perps-paper/hourly-breakout.js";
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
  tickerPublicationAt: number | undefined;
  heartbeat = false;
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
        value.at.t = this.tickerPublicationAt ?? publicationAt;
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
      if (this.heartbeat) {
        this.emit("message", { mt: 100, sn: 1, h: 1 });
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
  const exchange = "0x34b6552d57a35a1d042ccae1951bd1c370112a6f";
  const collateral = "0x00000000efe302beaa2b3e6e1b18d08d69a9012a";
  return {
    chain: { chain_id: 143 },
    instances: [{ id: 1, address: exchange, collateral_token_id: 1 }],
    tokens: [{ id: 1, address: collateral, symbol: "AUSD", decimals: 6 }],
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

function candlesTransport(full: boolean, urls: string[]): typeof fetch {
  return async (url) => {
    const path = String(url);
    urls.push(path);
    if (path.endsWith("/context")) {
      return Response.json(metadata());
    }
    const match = /\/candles\/(\d+)\/(\d+)-(\d+)/.exec(path);
    assert.ok(match, path);
    const resolution = Number(match[1]);
    const from = Number(match[2]);
    const to = Number(match[3]) + resolution * 1000;
    const count = full ? (to - from) / (resolution * 1000) : 60;
    return Response.json({
      at: { t: Date.now(), b: 1 },
      r: resolution,
      d: Array.from({ length: count }, (_, i) => ({
        t: to - (count - i) * resolution * 1000,
        o: 100000,
        c: 100000,
        h: 100000,
        l: 100000,
        v: "1000",
        n: 1,
      })),
    });
  };
}
function operation(seconds: number, signal = new AbortController().signal) {
  return {
    operationId: `controlled-${Date.now()}`,
    dueAt: Date.now(),
    deadlineAt: Date.now() + seconds * 1000,
    signal,
  };
}

test("breakout common sixty-bar coverage is independent of missing PTS-only warmup", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    transport: candlesTransport(false, urls),
  });
  t.after(() => data.close());
  const prepared = await settle(t, data.prepare(operation(60)), 65000);
  assert.equal(prepared.commonSymbols.length, 11);
  assert.equal(prepared.candles.length, 33);
  assert.ok(prepared.candles.every((c) => c.candles.length === 60 && !c.missingOpenTimes.length));
  assert.equal(prepared.ptsHistory.length, 0);
  assert.equal(urls.filter((v) => /\/candles\//.test(v)).length, 33);
  assert.ok(urls.every((v) => !/ticker|book|funding/.test(v)));
});

test("breakout caches actual first receipt and bounds history without another native request", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const versions: BreakoutCandleVersion[] = [];
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    transport: candlesTransport(true, urls),
    onCandleVersion: (v) => {
      versions.push(v);
    },
  });
  t.after(() => data.close());
  const first = await settle(t, data.prepare(operation(60)), 65000);
  const requests = urls.length;
  const receipt = versions[0]!.firstReceivedAt;
  const second = await settle(t, data.prepare(operation(60)), 65000);
  assert.equal(first.ptsHistory.length, 11);
  assert.equal(second.ptsHistory.length, 11);
  assert.equal(urls.length, requests);
  assert.equal(second.versions[0]!.firstReceivedAt, receipt);
  assert.equal(versions.length, 11 * (60 + 240 + 180));
});

test("original expired price window makes no public request", async () => {
  let called = false;
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    transport: async () => {
      called = true;
      throw new Error("FORBIDDEN");
    },
  });
  try {
    await assert.rejects(
      data.capture({ ...operation(20), deadlineAt: Date.now() }),
      (e: unknown) => e instanceof PilotError && e.code === "DATA_UNAVAILABLE",
    );
    assert.equal(called, false);
  } finally {
    await data.close();
  }
});

test("an individual price deadline does not expire the continuous socket lifetime", async (t) => {
  clocks(t);
  let socket: UniverseSocket | undefined;
  let connections = 0;
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    transport: async () => Response.json(metadata()),
    socket: () => {
      connections++;
      socket = new UniverseSocket();
      socket.missing = 0;
      socket.heartbeat = true;
      return socket;
    },
  });
  t.after(() => data.close());
  const parent = new AbortController();
  const first = await settle(t, data.capture(operation(0.5, parent.signal)), 1000);
  assert.equal(first.frames.length, 0);
  assert.equal(parent.signal.aborted, false);
  assert.equal(socket!.readyState, 1);
  socket!.emit("message", {
    mt: 15,
    sid: 3,
    at: { t: Date.now(), b: 1 },
    bid: [{ p: 99990, s: 1000, o: 1 }],
    ask: [{ p: 100010, s: 1000, o: 1 }],
  });
  socket!.emit("message", { mt: 100, sn: 2, h: 2 });
  const second = await settle(t, data.capture(operation(20, parent.signal)));
  assert.equal(second.frames.length, 11);
  assert.equal(connections, 1);
  await data.close();
  assert.equal(socket!.readyState, 3);
});

test("overlapping hourly copies preserve first receipt and retain volume-only revisions", async (t) => {
  clocks(t);
  const urls: string[] = [];
  const versions: BreakoutCandleVersion[] = [];
  const native = candlesTransport(true, urls);
  let revise = false;
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    async transport(url, init) {
      const response = await native(url, init);
      if (revise && /\/market-data\/1\/candles\/3600\//.test(String(url))) {
        const body = await response.json();
        const candle = body.d.find((c: { t: number }) => c.t === revisedAt);
        assert.ok(candle);
        candle.v = "1001";
        return Response.json(body);
      }
      return response;
    },
    onCandleVersion: (version) => {
      versions.push(version);
    },
  });
  t.after(() => data.close());
  const first = await settle(t, data.prepare(operation(60)), 65000);
  const hourly = first.versions.filter((v) => v.marketId === 1 && v.resolution === 3600);
  const changed = hourly.at(-2)!;
  const unchanged = hourly.at(-3)!;
  const revisedAt = changed.candle.openTime;
  revise = true;
  t.mock.timers.tick(3600000);
  const second = await settle(t, data.prepare(operation(60)), 65000);
  const changedAfter = second.versions.find(
    (v) =>
      v.marketId === 1 && v.resolution === 3600 && v.candle.openTime === changed.candle.openTime,
  )!;
  const unchangedAfter = second.versions.find(
    (v) =>
      v.marketId === 1 && v.resolution === 3600 && v.candle.openTime === unchanged.candle.openTime,
  )!;
  assert.equal(unchangedAfter.firstReceivedAt, unchanged.firstReceivedAt);
  assert.equal(unchangedAfter.contentHash, unchanged.contentHash);
  assert.equal(changedAfter.previousHash, changed.contentHash);
  assert.notEqual(changedAfter.responseSha256, changed.responseSha256);
  assert.ok(changedAfter.firstReceivedAt > changed.firstReceivedAt);
  assert.equal(changedAfter.candle.volumeCollateral, "0.001001");
  assert.equal(
    versions.filter(
      (v) => v.marketId === 1 && v.resolution === 3600 && v.candle.openTime === revisedAt,
    ).length,
    2,
  );
});

test("frozen mainnet identity is rejected before opening the public socket", async (t) => {
  clocks(t);
  let sockets = 0;
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    async transport() {
      const body = metadata();
      body.instances[0]!.address = "0x" + "2".repeat(40);
      return Response.json(body);
    },
    socket() {
      sockets++;
      return new UniverseSocket();
    },
  });
  t.after(() => data.close());
  await assert.rejects(
    settle(t, data.capture(operation(20))),
    (e: unknown) => e instanceof PilotError && e.code === "PERPL_MARKET_IDENTITY",
  );
  assert.equal(sockets, 0);
});

test("permission loss concurrent with a candle deadline remains a fatal permission error", async (t) => {
  clocks(t);
  let revoked = false;
  const urls: string[] = [];
  const transport = candlesTransport(true, urls);
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    async guard() {
      if (revoked) {
        throw new PilotError("PERMISSION_DENIED", "Controlled revocation");
      }
    },
    async transport(url, init) {
      const response = await transport(url, init);
      if (/\/candles\//.test(String(url))) {
        revoked = true;
        t.mock.timers.tick(60000);
      }
      return response;
    },
  });
  t.after(() => data.close());
  await assert.rejects(
    settle(t, data.prepare(operation(60)), 65000),
    (e: unknown) => e instanceof PilotError && e.code === "PERMISSION_DENIED",
  );
});

test("original expired candle-preparation window makes no public request", async () => {
  let calls = 0;
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    async transport() {
      calls++;
      throw new Error("Expired original preparation must never consult the public transport");
    },
  });
  try {
    await assert.rejects(
      data.prepare({ ...operation(60), deadlineAt: Date.now() - 1 }),
      (error: unknown) => error instanceof PilotError && error.code === "DATA_UNAVAILABLE",
    );
    assert.equal(calls, 0);
  } finally {
    await data.close();
  }
});

test("original expired funding window makes no public request", async () => {
  let calls = 0;
  const data = createHourlyBreakoutPublicReader({ agent: async () => agent() }, scope, markets, {
    guard: async () => {},
    async transport() {
      calls++;
      throw new Error("Expired original funding must never consult the public transport");
    },
  });
  try {
    await assert.rejects(
      data.reconcileRanges({ ...operation(20), deadlineAt: Date.now() - 1 }, [
        { key: "controlled-position", marketId: 1, symbol: "BTC", from: 1, to: 2 },
      ]),
      (error: unknown) => error instanceof PilotError && error.code === "DATA_UNAVAILABLE",
    );
    assert.equal(calls, 0);
  } finally {
    await data.close();
  }
});
