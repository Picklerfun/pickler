import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, PilotError, type AgentRecord } from "@pickler/core";
import { preparePtsHistory } from "../src/plugins/perps-paper/public-study.js";
import { PTS_CATALOG, analyzePts } from "@pickler/trading/pts";
const NOW = Date.parse("2026-10-10T00:05:00Z"),
  address = "0x" + "1".repeat(40);
function metadata() {
  return {
    chain: { chain_id: 143, gas: { h: 100 } },
    instances: [{ id: 1, address, collateral_token_id: 1 }],
    tokens: [{ id: 1, address, symbol: "AUSD", decimals: 6 }],
    markets: PTS_CATALOG.map((m) => ({
      ver: 1,
      id: m.marketId,
      instance_id: 1,
      perpetual_id: m.marketId,
      symbol: m.symbol,
      name: m.symbol + " Perp",
      size_units: m.symbol,
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
function agent(): AgentRecord {
  return {
    id: "pts",
    tenantId: "controlled",
    version: 1,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
    config: {
      ...structuredClone(DEFAULT_CONFIG),
      tools: [
        "listPerpMarkets",
        "getPerpSnapshot",
        "getPerpOrderBook",
        "getPerpCandles",
        "getPerpFundingHistory",
      ],
      plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
      perpl: { version: 2, network: "mainnet", markets: PTS_CATALOG.map((m) => m.symbol) },
      perpsPaper: { version: 1, policy: "conservative-1x-v1" },
    },
  };
}
async function settle<T>(t: TestContext, p: Promise<T>): Promise<T> {
  let done = false;
  void p.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let i = 0; i < 6500 && !done; i++) {
    t.mock.timers.tick(100);
    await new Promise<void>((r) => setImmediate(r));
  }
  assert.ok(done, "bounded public preparation did not terminate");
  return p;
}
test("bounded original Perpl capture: eleven identities, separate native series, missing bars stay missing", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  const starts: number[] = [],
    bodies: string[] = [];
  const result = await settle(
    t,
    preparePtsHistory(
      { agent: async () => agent() },
      { tenantId: "controlled", agentId: "pts" },
      new AbortController().signal,
      {
        commit: "controlled",
        transport: async (url) => {
          starts.push(Date.now());
          const path = String(url);
          const resolution = Number(/\/candles\/(\d+)\//.exec(path)?.[1]);
          return Response.json(
            resolution ? { at: { t: Date.now(), b: 100 }, r: resolution, d: [] } : metadata(),
          );
        },
        capture: async (r) => {
          bodies.push(r.body);
        },
      },
    ),
  );
  assert.equal(result.fatalCode, null);
  assert.equal(result.catalog.length, 11);
  assert.equal(result.history.markets.length, 11);
  assert.ok(result.requests <= 96);
  assert.equal(bodies.length, result.requests);
  assert.ok(starts.slice(1).every((at, i) => at - starts[i]! >= 1000));
  for (const h of result.history.markets) {
    assert.deepEqual(
      h.series.map((s) => s.resolution),
      [86400, 14400, 3600],
    );
    assert.ok(h.series.every((s) => s.candles.length === 0 && s.missingOpenTimes.length > 0));
    assert.ok(analyzePts(h, result.history.to).coverage.every((c) => !c.eligible));
    for (const s of h.series) {
      assert.ok((s.to - s.from) / (s.resolution * 1000) <= 1024);
    }
  }
});
test("permission/schema/capture failures stop immediately and retain safe diagnostics, no retry", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  for (const mode of ["schema", "identity", "capture", "revoke"]) {
    let requests = 0;
    const r = await settle(
      t,
      preparePtsHistory(
        { agent: async () => agent() },
        { tenantId: "controlled", agentId: "pts" },
        new AbortController().signal,
        {
          commit: "controlled",
          guard: async () => {
            if (mode === "revoke") {
              throw new PilotError("LEASE_LOST", "controlled");
            }
          },
          transport: async () => {
            requests++;
            return Response.json(
              mode === "schema"
                ? {}
                : mode === "identity"
                  ? { ...metadata(), markets: [] }
                  : metadata(),
            );
          },
          capture: async () => {
            if (mode === "capture") {
              throw new PilotError("PTS_CAPTURE_LIMIT", "controlled");
            }
          },
        },
      ),
    );
    assert.ok(r.fatalCode);
    assert.equal(requests, mode === "revoke" ? 0 : 1);
    assert.equal(r.requests, requests);
    assert.ok(r.diagnostics.some((d) => d.code === r.fatalCode));
    assert.equal(r.history.markets.length, 0);
  }
});
test("Retry-After applies across sessions; transient omissions retain bounded request and original response counts", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  const starts: number[] = [];
  let seen = 0;
  const r = await settle(
    t,
    preparePtsHistory(
      { agent: async () => agent() },
      { tenantId: "controlled", agentId: "pts" },
      new AbortController().signal,
      {
        commit: "controlled",
        transport: async (url) => {
          starts.push(Date.now());
          if (String(url).includes("/candles/") && seen++ === 0) {
            return new Response("", { status: 429, headers: { "Retry-After": "3" } });
          }
          const resolution = Number(/\/candles\/(\d+)\//.exec(String(url))?.[1]);
          return Response.json(
            resolution ? { at: { t: Date.now(), b: 100 }, r: resolution, d: [] } : metadata(),
          );
        },
        capture: async () => {},
      },
    ),
  );
  assert.equal(r.fatalCode, null);
  assert.ok(r.diagnostics.some((d) => d.code === "PERPL_HTTP_429"));
  assert.ok(starts[2]! - starts[1]! >= 3000);
  assert.ok(r.requests <= 96);
});

test("controlled preparation clock exhaustion cancels remaining physical requests at the single deadline", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  let requests = 0;
  const r = await settle(
    t,
    preparePtsHistory(
      { agent: async () => agent() },
      { tenantId: "controlled", agentId: "pts" },
      new AbortController().signal,
      {
        commit: "controlled",
        now: () => (requests ? NOW + 600001 : NOW),
        transport: async () => {
          requests++;
          return Response.json(metadata());
        },
        capture: async () => {},
      },
    ),
  );
  assert.equal(r.fatalCode, "PTS_PREPARATION_TIMEOUT");
  assert.equal(r.exhausted, true);
  assert.equal(requests, 1);
  assert.equal(r.history.markets.length, 0);
});

test("intraday captures genuine native five/fifteen-minute pages within one bounded preparation", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  const starts: number[] = [];
  const urls: string[] = [];
  const r = await settle(
    t,
    preparePtsHistory(
      { agent: async () => agent() },
      { tenantId: "controlled", agentId: "pts" },
      new AbortController().signal,
      {
        commit: "controlled-intraday",
        candidateVersion: "0.1.0",
        transport: async (input) => {
          starts.push(Date.now());
          urls.push(String(input));
          const resolution = Number(/\/candles\/(\d+)\//.exec(String(input))?.[1]);
          return Response.json(
            resolution ? { at: { t: Date.now(), b: 100 }, r: resolution, d: [] } : metadata(),
          );
        },
        capture: async () => {},
      },
    ),
  );
  assert.equal(r.fatalCode, null);
  assert.equal(r.history.candidate, "pts-intraday@0.1.0");
  assert.equal(r.history.to - r.history.from, 7 * 86400000);
  assert.ok(r.requests <= 96);
  assert.ok(starts.slice(1).every((at, i) => at - starts[i]! >= 1000));
  assert.equal(r.history.markets.length, 11);
  for (const h of r.history.markets) {
    assert.deepEqual(
      h.series.map((s) => s.resolution),
      [86400, 14400, 3600, 900, 300],
    );
    const five = h.series.find((s) => s.resolution === 300)!;
    assert.ok((five.to - five.from) / 300000 > 2048);
    assert.equal(five.missingOpenTimes.length, (five.to - five.from) / 300000);
    assert.ok(analyzePts(h, r.history.to, "0.1.0").coverage.every((c) => !c.eligible));
  }
  const fiveRequests = urls.filter((u) => /\/candles\/300\//.test(u));
  assert.equal(fiveRequests.length, 33);
  for (const text of urls.filter((u) => u.includes("/candles/"))) {
    const parts = new URL(text).pathname.split("/");
    const i = parts.indexOf("candles");
    const resolution = Number(parts[i + 1]);
    const [from, to] = parts[i + 2]!.split("-").map(Number);
    assert.ok((to! - from!) / (resolution * 1000) <= 1024, text);
  }
});

test("fast candidate preparation requests only actual 4h/1h/15m/5m roles and shared 5m warmup", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  const urls: string[] = [];
  const result = await settle(
    t,
    preparePtsHistory(
      { agent: async () => agent() },
      { tenantId: "controlled", agentId: "pts" },
      new AbortController().signal,
      {
        commit: "controlled-fast",
        candidateVersion: "0.2.0-fast.1",
        transport: async (input) => {
          urls.push(String(input));
          const resolution = Number(/\/candles\/(\d+)\//.exec(String(input))?.[1]);
          return Response.json(
            resolution ? { at: { t: Date.now(), b: 100 }, r: resolution, d: [] } : metadata(),
          );
        },
        capture: async () => {},
      },
    ),
  );
  assert.equal(result.fatalCode, null);
  assert.equal(result.history.candidate, "pts-intraday@0.2.0-fast.1");
  assert.equal(result.history.to - result.history.from, 7 * 86400000);
  assert.ok(result.requests <= 96);
  assert.equal(
    urls.some((url) => url.includes("/candles/86400/")),
    false,
  );
  for (const history of result.history.markets) {
    assert.deepEqual(
      history.series.map((series) => series.resolution),
      [14400, 3600, 900, 300],
    );
    const five = history.series.find((series) => series.resolution === 300)!;
    assert.equal((five.to - five.from) / 300000, 2016 + 180);
    assert.ok(
      analyzePts(history, result.history.to, "0.2.0-fast.1").coverage.every(
        (coverage) => !coverage.eligible,
      ),
    );
  }
});
