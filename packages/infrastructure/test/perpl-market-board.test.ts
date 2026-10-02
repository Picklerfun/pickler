import test from "node:test";
import assert from "node:assert/strict";
import { MarketDataUnavailableError } from "@pickler/core";
import capture from "@pickler/perpl-context/fixtures/context.json" with { type: "json" };
import { createPerplMarketBoard, PerplBoardMemory } from "../src/markets/perpl-market-board.js";
import candles from "./fixtures/perpl-candles-btc-1h.json" with { type: "json" };

const HOUR = 3_600_000;
// Two hours after the last recorded candle opened, so every recorded candle has closed.
const NOW = 1_790_906_400_000 + 2 * HOUR;

interface Served {
  context?: unknown;
  candles?: unknown;
  fail?: boolean;
}

/** A board over recorded answers, a clock the test moves, and a record of what was asked. */
function harness(served: Served = {}) {
  const state = { now: NOW, served: { context: capture, candles, ...served } };
  const asked: string[] = [];
  const memory = new PerplBoardMemory();

  const transport = (async (url: string | URL | Request) => {
    asked.push(String(url));
    if (state.served.fail) {
      return new Response("unavailable", { status: 503 });
    }
    const body = String(url).includes("/candles/") ? state.served.candles : state.served.context;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  const board = createPerplMarketBoard({
    network: "testnet",
    memory,
    transport,
    now: () => state.now,
  });

  return {
    board,
    asked,
    state,
    /** The venue's pacing is one request a second; a test does not wait for it. */
    unpaced<T>(read: () => Promise<T>): Promise<T> {
      memory.schedule.lastStart = -Infinity;
      return read();
    },
  };
}

test("the board lists every open market of the capture, with the venue's own figures", async () => {
  const { board, asked } = harness();

  const markets = await board.listMarkets();

  assert.deepEqual(
    markets.map((market) => market.symbol),
    ["BTC-PERP", "ETH-PERP", "SOL-PERP", "MON-PERP", "ZEC-PERP", "LIT-PERP", "PUMP-PERP"],
  );
  assert.deepEqual(asked, ["https://testnet.perpl.xyz/api/v1/pub/context"]);

  const btc = markets[0]!;
  assert.equal(btc.base, "BTC");
  assert.equal(btc.accent, "amber");
  assert.equal(btc.mark, 76255.5);
  assert.ok(Math.abs(btc.change24h - (762555 - 757456) / 757456) < 1e-12);
  assert.ok(Math.abs(btc.funding1h - (30 / 1e6) * (3600 / 2580)) < 1e-15);
  assert.ok(Math.abs(btc.openInterest - 17.966 * 76255.5) < 1e-6);
  assert.equal(btc.maxLeverage, 15);
  assert.equal(btc.limits.takerFee, 0.000345);
  assert.ok(Math.abs(btc.limits.maintenanceMargin - 0.25 / 15) < 1e-12);
  assert.equal(btc.limits.slippageCap, 0.1);
  assert.equal(btc.limits.minimumAccountOpen, 100);
});

test("the note says what the day and the funding did, and tells a zero from nothing published", async () => {
  const silent = JSON.parse(JSON.stringify(capture)) as typeof capture;
  delete (silent.markets[1] as { funding?: unknown }).funding;
  const { board } = harness({ context: silent });

  const markets = await board.listMarkets();
  const note = (symbol: string) => markets.find((market) => market.symbol === symbol)!.note;

  assert.equal(note("BTC-PERP"), "Up 0.7% in 24 hours. Funding is positive.");
  assert.equal(note("ETH-PERP").endsWith("No funding is published."), true);
  assert.equal(note("SOL-PERP").endsWith("Funding is flat."), true);
});

test("what nobody has measured is null, and the source is named", async () => {
  const { board } = harness();

  const [btc] = await board.listMarkets();

  assert.equal(btc!.agentsReading, null);
  assert.equal(btc!.openCalls, null);
  assert.equal(btc!.lastCall, null);
  assert.equal(btc!.hourlyReach, null);
  assert.deepEqual(btc!.source, {
    venue: "perpl",
    network: "testnet",
    observedAt: new Date(NOW).toISOString(),
    stale: false,
  });
});

test("a board younger than ten seconds is served from memory", async () => {
  const { board, asked, state, unpaced } = harness();

  await board.listMarkets();
  state.now += 9_000;
  await board.listMarkets();
  assert.equal(asked.length, 1);

  state.now += 2_000;
  const renewed = await unpaced(() => board.listMarkets());
  assert.equal(asked.length, 2);
  assert.equal(renewed[0]!.source.venue === "perpl" && renewed[0]!.source.stale, false);
});

test("when the venue stops answering, its last figures are served as stale for five minutes", async () => {
  const { board, state, unpaced } = harness();

  await board.listMarkets();
  state.served.fail = true;
  state.now += 60_000;
  const held = await unpaced(() => board.listMarkets());

  assert.deepEqual(held[0]!.source, {
    venue: "perpl",
    network: "testnet",
    observedAt: new Date(NOW).toISOString(),
    stale: true,
  });
  assert.equal(held[0]!.mark, 76255.5);

  state.now += 5 * 60_000;
  await assert.rejects(
    unpaced(() => board.listMarkets()),
    MarketDataUnavailableError,
  );
});

test("a failed read is not repeated on every request", async () => {
  const { board, asked, state, unpaced } = harness();

  await board.listMarkets();
  state.served.fail = true;
  state.now += 60_000;
  await unpaced(() => board.listMarkets());
  const afterFirstFailure = asked.length;
  state.now += 3_000;
  await board.listMarkets();

  assert.equal(asked.length, afterFirstFailure);
});

test("with nothing held, a venue that does not answer is an error and never an empty board", async () => {
  const { board } = harness({ fail: true });

  await assert.rejects(board.listMarkets(), MarketDataUnavailableError);
});

test("an answer for another chain is refused", async () => {
  const mainnet = JSON.parse(JSON.stringify(capture)) as typeof capture;
  mainnet.chain.chain_id = 143;
  const { board } = harness({ context: mainnet });

  await assert.rejects(board.listMarkets(), MarketDataUnavailableError);
});

test("a market the venue publishes without a symbol is listed by the asset it is sized in", async () => {
  const unnamed = JSON.parse(JSON.stringify(capture)) as typeof capture;
  unnamed.markets[1]!.symbol = "";
  const { board } = harness({ context: unnamed });

  const markets = await board.listMarkets();

  assert.equal(markets[1]!.symbol, "ETH-PERP");
});

test("one market carries a day of marks and the furthest it moved inside an hour", async () => {
  const { board, asked, unpaced } = harness();

  const detail = await unpaced(() => board.getMarket("BTC-PERP"));

  const to = Math.floor(NOW / HOUR) * HOUR;
  assert.equal(
    asked[1],
    `https://testnet.perpl.xyz/api/v1/market-data/16/candles/3600/${to - 720 * HOUR}-${to - HOUR}`,
  );
  assert.equal(detail!.market.symbol, "BTC-PERP");
  assert.equal(detail!.trail.length, 25);
  assert.equal(detail!.trail[0], 83696.8);
  assert.equal(detail!.trail[23], 85182.1);
  assert.equal(detail!.trail[24], detail!.market.mark);
  // The hour that opened at 83,863.2 and reached 85,498.2.
  assert.equal(detail!.market.hourlyReach, 1.95);
  assert.deepEqual(detail!.calls, []);
});

test("the candles are read once in five minutes, whatever the board does", async () => {
  const { board, asked, state, unpaced } = harness();

  await unpaced(() => board.getMarket("BTC-PERP"));
  state.now += 60_000;
  await unpaced(() => board.getMarket("BTC-PERP"));

  assert.equal(asked.filter((url) => url.includes("/candles/")).length, 1);
});

test("without candles the market is still served, with no trail and no reach", async () => {
  const { board, unpaced } = harness({ candles: { nothing: "here" } });

  const detail = await unpaced(() => board.getMarket("BTC-PERP"));

  assert.equal(detail!.market.mark, 76255.5);
  assert.deepEqual(detail!.trail, []);
  assert.equal(detail!.market.hourlyReach, null);
});

test("a symbol the venue does not list is null", async () => {
  const { board, asked } = harness();

  assert.equal(await board.getMarket("NOPE-PERP"), null);
  assert.equal(asked.length, 1);
});
