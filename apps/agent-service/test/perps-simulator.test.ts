import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DEFAULT_CONFIG,
  PERP_TOOLS,
  initialPaperAccount,
  simulatePerpsFill,
  applyPaperFill,
  applyPaperObservation,
  paperRisk,
  paperUnits,
  createPerpsPaperService,
  type PerpsPaperFrame,
  type PerpsPaperPosition,
  type PerpFundingHistory,
  type PerpsPaperScope,
  type PerpsPaperIntent,
} from "@pickler/core";
import { PostgresPerpsPaperStore, PerplMarketData } from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
const now = 1800000000000;
const scope: PerpsPaperScope = {
  tenantId: "alpha",
  agentId: "pickle-alpha",
  sessionId: "simulation",
  network: "mainnet",
};
const intent: PerpsPaperIntent = {
  kind: "open",
  symbol: "BTC",
  side: "long",
  notional: "100",
  feeReserve: "1",
};
function frame(): PerpsPaperFrame {
  const provenance = {
    provider: "perpl" as const,
    pluginVersion: "1.0.0" as const,
    network: "mainnet" as const,
    chainId: 143,
    url: "https://app.perpl.xyz/api/v1/market-data/1/ticker",
    receivedAt: now,
    providerTimestamp: now,
    block: 100,
  };
  const market = {
    symbol: "BTC" as const,
    marketId: 1,
    perpetualId: 1,
    instanceId: 1,
    exchangeAddress: "0x" + "1".repeat(40),
    collateral: { tokenId: 1, address: "0x" + "2".repeat(40), symbol: "AUSD", decimals: 6 },
    configVersion: 1,
    priceDecimals: 1,
    sizeDecimals: 5,
    open: true,
    fundingIntervalSeconds: 2580,
    fundingIntervalBlocks: 8571,
    initialMarginRaw: 1000,
    maintenanceMarginRaw: 2000,
    fees: { basis: "public-base-tier" as const, maker: "0.000045", taker: "0.000345" },
    provenance,
  };
  const snapshot = {
    market,
    ticker: {
      mark: "100",
      index: "100",
      last: "100",
      bid: "99.9",
      ask: "100",
      openInterestBase: "10",
      freshness: "fresh" as const,
      provenance,
    },
    funding: null,
  };
  const book = {
    market,
    requestedLevels: 20,
    depthLimited: true as const,
    bids: [
      { price: "99.9", size: "0.4", orders: 1 },
      { price: "99.8", size: "10", orders: 1 },
    ],
    asks: [
      { price: "100", size: "0.4", orders: 1 },
      { price: "100.1", size: "10", orders: 1 },
    ],
    freshness: "fresh" as const,
    provenance,
  };
  return {
    snapshot,
    book,
    hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
  };
}
function position(side: "long" | "short" = "long"): PerpsPaperPosition {
  return {
    id: "buy",
    symbol: "BTC",
    side,
    quantity: "1",
    entryPrice: "100",
    entryNotional: "100",
    openedAt: now - 120000,
    entryBlock: 90,
    mark: "100",
    markAt: now,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  };
}
function funding(): PerpFundingHistory {
  return {
    market: frame().book.market,
    from: now - 180000,
    to: now,
    complete: true,
    pages: [frame().book.provenance],
    events: [
      {
        eventBlock: 95,
        appliesAt: now - 90000,
        rate: "0.0001",
        index: "100",
        estimated: false,
        provenance: frame().book.provenance,
      },
    ],
  };
}
test("full depth execution computes quantity, taker fee and side-specific book consumption", () => {
  for (const side of ["long", "short"] as const) {
    const a = initialPaperAccount(scope, 1, now);
    const i = { ...intent, side };
    const fill = simulatePerpsFill(a, i, frame(), now);
    assert.ok(paperUnits(fill.notional) <= paperUnits("100"));
    assert.ok(paperUnits(fill.fee) > 0n);
    assert.equal((fill.evidence as { consumed: unknown[] }).consumed.length, 2);
    const applied = applyPaperFill(
      a,
      {
        key: "buy",
        intent: i,
        status: "pending",
        reserved: "101",
        createdAt: now,
        finishedAt: null,
        reason: null,
        evidence: null,
      },
      fill,
      now,
    );
    assert.equal(applied.account.positions[0]!.mark, "100");
    assert.equal(applied.account.positions[0]!.side, side);
  }
});
test("insufficient depth, excessive slippage and stale/inconsistent frames never fill", () => {
  const a = initialPaperAccount(scope, 1, now);
  for (const mutate of [
    (f: PerpsPaperFrame) => {
      f.book.asks = [];
    },
    (f: PerpsPaperFrame) => {
      f.book.asks[1]!.price = "101";
    },
    (f: PerpsPaperFrame) => {
      f.book.provenance = { ...f.book.provenance, providerTimestamp: now - 30001 };
    },
    (f: PerpsPaperFrame) => {
      f.book.provenance = { ...f.book.provenance, providerTimestamp: now - 6000 };
    },
  ]) {
    const f = frame();
    mutate(f);
    assert.throws(() => simulatePerpsFill(a, intent, f, now));
  }
});
test("funding uses position block boundaries, signed cash postings and immutable event identity", () => {
  for (const side of ["long", "short"] as const) {
    const a = initialPaperAccount(scope, 1, now);
    a.positions = [position(side)];
    const observation = { frames: [frame()], funding: [funding()] };
    const first = applyPaperObservation(a, [], observation, "t1", now);
    assert.equal(first.movements[0]!.delta, side === "long" ? "-0.01" : "0.01");
    const repeat = applyPaperObservation(first.account, first.movements, observation, "t2", now);
    assert.equal(repeat.movements.length, 0);
    observation.funding[0]!.events[0]!.rate = "0.0002";
    const changed = applyPaperObservation(first.account, first.movements, observation, "t3", now);
    assert.equal(changed.account.fundingDisputed, true);
    assert.equal(changed.movements.length, 0);
  }
  const a = initialPaperAccount(scope, 1, now);
  a.positions = [{ ...position(), entryBlock: 95 }];
  assert.equal(
    applyPaperObservation(a, [], { frames: [frame()], funding: [funding()] }, "boundary", now)
      .movements.length,
    0,
  );
});
test("missing, future and estimated funding remain pending, never zero-cost reconciliation", () => {
  for (const mode of ["missing", "estimated", "future"]) {
    const a = initialPaperAccount(scope, 1, now);
    a.positions = [position()];
    const f = funding();
    if (mode === "estimated") {
      f.events[0]!.estimated = true;
    }
    if (mode === "future") {
      f.events[0]!.appliesAt = now + 1;
    }
    const result = applyPaperObservation(
      a,
      [],
      { frames: [frame()], funding: mode === "missing" ? [] : [f] },
      mode,
      now,
    );
    assert.equal(result.account.fundingPending, true);
    assert.equal(result.movements.length, 0);
  }
});
test("negative funding credits longs and closed positions remain eligible through their exit block", () => {
  const a = initialPaperAccount(scope, 1, now);
  a.positions = [{ ...position(), closedAt: now - 60000, exitBlock: 95, exitPrice: "100" }];
  const f = funding();
  f.events[0]!.rate = "-0.0001";
  assert.equal(
    applyPaperObservation(a, [], { frames: [frame()], funding: [f] }, "closed", now).movements[0]!
      .delta,
    "0.01",
  );
  a.positions[0]!.exitBlock = 94;
  assert.equal(
    applyPaperObservation(a, [], { frames: [frame()], funding: [f] }, "earlier", now).movements
      .length,
    0,
  );
});
async function database(t: TestContext) {
  const research = await createTestStore(t, () => now);
  await research.updateConfig(scope, 1, {
    ...DEFAULT_CONFIG,
    tools: [...PERP_TOOLS],
    perpl: { version: 1, network: "mainnet", markets: ["BTC"] },
    perpsPaper: { version: 1, policy: "conservative-1x-v1" },
    plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
  });
  const repo = new PostgresPerpsPaperStore(research.pool, () => now);
  await repo.initialize(scope, 2);
  return { research, repo };
}
test("database simulator replay opens/closes once and recovers identical results without provider repeats", async (t) => {
  const { repo } = await database(t);
  let reads = 0;
  const data = {
    frame: async () => {
      reads++;
      return frame();
    },
    observation: async () => {
      reads++;
      return { frames: [frame()], funding: [funding()] };
    },
  };
  const service = createPerpsPaperService(repo, data, () => now);
  const signal = new AbortController().signal;
  const first = await service.trade(scope, "buy", "open", "BTC", "long", signal);
  assert.equal(first.account.positions.length, 1);
  await service.trade(scope, "buy", "open", "BTC", "long", signal);
  assert.equal(reads, 1);
  await service.tick(scope, "tick", signal);
  const count = reads;
  await service.tick(scope, "tick", signal);
  assert.equal(reads, count);
  const closed = await service.trade(scope, "close", "close", "BTC", "long", signal);
  assert.equal(closed.account.positions[0]!.closedAt, now);
  assert.equal(paperRisk(closed.account, closed.attempts, now).margin, "0");
  assert.equal(
    closed.movements.reduce((sum, m) => sum + paperUnits(m.delta), 0n),
    paperUnits(closed.account.cash),
  );
});
test("failed simulation preserves a terminal attempt and its replay never refetches", async (t) => {
  const { repo } = await database(t);
  let reads = 0;
  const f = frame();
  f.book.asks = [];
  const service = createPerpsPaperService(
    repo,
    {
      frame: async () => {
        reads++;
        return f;
      },
      observation: async () => ({ frames: [], funding: [] }),
    },
    () => now,
  );
  await assert.rejects(
    service.trade(scope, "empty", "open", "BTC", "long", new AbortController().signal),
  );
  assert.equal((await repo.view(scope)).attempts[0]!.status, "failed");
  await service.trade(scope, "empty", "open", "BTC", "long", new AbortController().signal);
  assert.equal(reads, 1);
});

test("funding adapter bounds ranges and preserves future estimates and unknown empty history", async () => {
  const m = frame().book.market;
  const context = {
    chain: { chain_id: 143, gas: { h: 100 } },
    instances: [{ id: 1, address: m.exchangeAddress, collateral_token_id: 1 }],
    tokens: [{ id: 1, ...m.collateral }],
    markets: [
      {
        id: 1,
        ver: 1,
        instance_id: 1,
        perpetual_id: 1,
        symbol: "BTC",
        name: "BTC",
        size_units: "BTC",
        funding_interval_sec: 2580,
        funding_interval_blocks: 8571,
        config: {
          at: { t: now, b: 100 },
          is_open: true,
          price_decimals: 1,
          size_decimals: 5,
          initial_margin: 1000,
          maintenance_margin: 2000,
          maker_fee: 45,
          taker_fee: 345,
        },
      },
    ],
  };
  let calls = 0;
  const data = new PerplMarketData({
    now: () => now,
    transport: async (input) => {
      calls++;
      return Response.json(
        String(input).endsWith("context")
          ? context
          : {
              mt: 13,
              m: 1,
              at: { b: 100, t: now },
              d: [{ at: { b: 110, t: now + 30000 }, feb: 110, rate: -40, idx: 1000 }],
            },
      );
    },
  });
  const ctx = { signal: new AbortController().signal, guard: async () => {} };
  const result = await data.funding(
    "mainnet",
    { symbol: "BTC", from: now - 3600000, to: now },
    ctx,
  );
  assert.equal(result.events[0]!.estimated, true);
  assert.equal(result.events[0]!.rate, "-0.00004");
  assert.equal(result.events[0]!.index, "100");
  await assert.rejects(data.funding("mainnet", { symbol: "BTC", from: 0, to: now }, ctx));
  assert.equal(calls, 2);
  const empty = new PerplMarketData({
    now: () => now,
    transport: async (input) =>
      Response.json(String(input).endsWith("context") ? context : { mt: 13, m: 1, at: {}, d: [] }),
  });
  assert.equal(
    (await empty.funding("mainnet", { symbol: "BTC", from: now - 1000, to: now }, ctx)).complete,
    false,
  );
});
