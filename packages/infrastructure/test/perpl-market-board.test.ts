import test from "node:test";
import assert from "node:assert/strict";
import { MarketDataUnavailableError } from "@pickler/core";
import capture from "@pickler/perpl-context/fixtures/context.json" with { type: "json" };
import { createPerplMarketBoard, PerplBoardMemory } from "../src/markets/perpl-market-board.js";
import { PerplRequestSchedule } from "../src/perpl/transport.js";
// Three days of BTC hourly candles, recorded from Perpl testnet on 2026-10-01.
import candles from "./fixtures/perpl-candles-btc-1h.json" with { type: "json" };

const HOUR = 3_600_000;
// Two hours after the last recorded candle opened, so every recorded candle has closed.
const NOW = 1_790_906_400_000 + 2 * HOUR;

interface Served {
  context?: unknown;
  candles?: unknown;
  /** The venue answers 503. */
  fail?: boolean;
  /** The venue answers 429 with this Retry-After. */
  wait?: string;
  /** The venue takes this long to answer, in real milliseconds. */
  delayMs?: number;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A board over recorded answers, a clock the test moves, and a record of what was asked. */
function harness(served: Served = {}) {
  const state = { now: NOW, served: { context: capture, candles, ...served } as Required<Served> };
  const asked: string[] = [];
  const memory = new PerplBoardMemory();

  const transport = (async (url: string | URL | Request) => {
    asked.push(String(url));
    if (state.served.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, state.served.delayMs));
    }
    if (state.served.wait) {
      return new Response("slow down", {
        status: 429,
        headers: { "retry-after": state.served.wait },
      });
    }
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
    memory,
    candleReads: () => asked.filter((url) => url.includes("/candles/")).length,
    /** The venue is paced at one request a second per kind; a test does not wait for that. */
    unpaced<T>(read: () => Promise<T>): Promise<T> {
      memory.contextSchedule = new PerplRequestSchedule();
      memory.historySchedule = new PerplRequestSchedule();
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
  const silent = copy(capture);
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

test("an asset the venue lists twice appears once, and a name the board cannot carry is left out", async () => {
  const odd = copy(capture);
  odd.markets[1]!.symbol = "BTC";
  odd.markets[2]!.symbol = "SOL/USD";
  const { board } = harness({ context: odd });

  const markets = await board.listMarkets();

  assert.deepEqual(
    markets.map((market) => market.symbol),
    ["BTC-PERP", "MON-PERP", "ZEC-PERP", "LIT-PERP", "PUMP-PERP"],
  );
  // The lower id stands: BTC's own mark, not the market that borrowed its name.
  assert.equal(markets[0]!.mark, 76255.5);
});

test("a market the venue publishes without a symbol is listed by the asset it is sized in", async () => {
  const unnamed = copy(capture);
  unnamed.markets[1]!.symbol = "";
  const { board } = harness({ context: unnamed });

  const markets = await board.listMarkets();

  assert.equal(markets[1]!.symbol, "ETH-PERP");
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
  assert.deepEqual(renewed[0]!.source, {
    venue: "perpl",
    network: "testnet",
    observedAt: new Date(NOW + 11_000).toISOString(),
    stale: false,
  });
});

test("everyone who asks at once shares one read", async () => {
  const { board, asked } = harness();

  const answers = await Promise.all([
    board.listMarkets(),
    board.listMarkets(),
    board.getMarket("NOPE-PERP"),
  ]);

  assert.equal(asked.length, 1);
  assert.equal(answers[0].length, 7);
  assert.equal(answers[2], null);
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

test("a failed read is not repeated for ten seconds, then the venue is asked again and believed", async () => {
  const { board, asked, state, unpaced } = harness();

  await board.listMarkets();
  state.served.fail = true;
  state.now += 60_000;
  await unpaced(() => board.listMarkets());
  assert.equal(asked.length, 2);

  state.now += 3_000;
  const resting = await board.listMarkets();
  assert.equal(asked.length, 2);
  assert.equal(resting[0]!.source.venue === "perpl" && resting[0]!.source.stale, true);

  state.served.fail = false;
  state.now += 8_000;
  const recovered = await unpaced(() => board.listMarkets());
  assert.equal(asked.length, 3);
  assert.equal(recovered[0]!.source.venue === "perpl" && recovered[0]!.source.stale, false);
});

test("with nothing held, a venue that does not answer is an error, and is not asked again at once", async () => {
  const { board, asked, state } = harness({ fail: true });

  await assert.rejects(board.listMarkets(), MarketDataUnavailableError);
  state.now += 3_000;
  await assert.rejects(board.listMarkets(), MarketDataUnavailableError);

  assert.equal(asked.length, 1);
});

test("an answer for another chain is refused", async () => {
  const mainnet = copy(capture);
  mainnet.chain.chain_id = 143;
  const { board } = harness({ context: mainnet });

  await assert.rejects(board.listMarkets(), MarketDataUnavailableError);
});

test("a venue that says to wait is not waited on: its last figures are served at once", async () => {
  const { board, asked, state, unpaced } = harness();

  await board.listMarkets();
  state.served.wait = "120";
  state.now += 60_000;
  await unpaced(() => board.listMarkets());
  const afterRefusal = asked.length;

  // Past the ten seconds after a failure, but inside the venue's own two minutes.
  state.now += 30_000;
  const started = Date.now();
  const held = await board.listMarkets();

  assert.equal(asked.length, afterRefusal);
  assert.ok(Date.now() - started < 500);
  assert.equal(held[0]!.source.venue === "perpl" && held[0]!.source.stale, true);
});

test("a slow venue does not hold up someone the board can already answer", async () => {
  const { board, state, unpaced } = harness();

  await board.listMarkets();
  state.served.delayMs = 4_000;
  state.now += 30_000;
  const started = Date.now();
  const held = await unpaced(() => board.listMarkets());

  assert.ok(Date.now() - started < 3_000);
  assert.equal(held[0]!.mark, 76255.5);
  // Slow is not silent: these are still the venue's latest figures.
  assert.equal(held[0]!.source.venue === "perpl" && held[0]!.source.stale, false);
});

test("one market carries a day of marks and the furthest it moved inside an hour", async () => {
  const { board, asked } = harness();

  const detail = await board.getMarket("BTC-PERP");

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
  assert.deepEqual(detail!.trailTimestamps, [
    ...candles.d.slice(-24).map((candle) => new Date(candle.t + HOUR).toISOString()),
    new Date(NOW).toISOString(),
  ]);
  // The hour that opened at 83,863.2 and reached 85,498.2.
  assert.equal(detail!.market.hourlyReach, 1.95);
  assert.deepEqual(detail!.calls, []);
});

test("candles out of order, out of range, still open or impossible change nothing", async () => {
  const messy = copy(candles);
  const last = messy.d[messy.d.length - 1]!;
  messy.d.push(
    // Still open at NOW + 1h, and wild.
    { ...last, t: NOW + HOUR, o: 100_000, h: 900_000, l: 100_000, c: 900_000 },
    // Before the thirty days that were asked for.
    { ...last, t: NOW - 800 * HOUR, o: 100_000, h: 900_000, l: 100_000, c: 900_000 },
    // A high below its own open is not a candle.
    { ...last, t: last.t - 100 * HOUR, o: 500_000, h: 400_000, l: 100_000, c: 450_000 },
  );
  messy.d.reverse();
  const clean = harness();
  const dirty = harness({ candles: messy });

  const expected = await clean.board.getMarket("BTC-PERP");
  const detail = await dirty.board.getMarket("BTC-PERP");

  assert.deepEqual(detail!.trail, expected!.trail);
  assert.deepEqual(detail!.trailTimestamps, expected!.trailTimestamps);
  assert.equal(detail!.market.hourlyReach, 1.95);
});

test("a market that has not moved has no measured reach, rather than a reach of zero", async () => {
  const flat = copy(candles);
  for (const candle of flat.d) {
    candle.h = candle.o;
    candle.l = candle.o;
    candle.c = candle.o;
  }
  const { board } = harness({ candles: flat });

  const detail = await board.getMarket("BTC-PERP");

  assert.equal(detail!.market.hourlyReach, null);
  assert.equal(detail!.trail.length, 25);
});

test("candles of another resolution are not this market's history", async () => {
  const daily = copy(candles);
  daily.r = 86_400;
  const { board } = harness({ candles: daily });

  const detail = await board.getMarket("BTC-PERP");

  assert.deepEqual(detail!.trail, []);
  assert.equal(detail!.market.hourlyReach, null);
});

test("a market's history is read once in five minutes, and by one request however many ask", async () => {
  const { board, candleReads, state, unpaced } = harness();

  await Promise.all([
    board.getMarket("BTC-PERP"),
    board.getMarket("BTC-PERP"),
    board.getMarket("BTC-PERP"),
  ]);
  assert.equal(candleReads(), 1);

  state.now += 4 * 60_000;
  await unpaced(() => board.getMarket("BTC-PERP"));
  assert.equal(candleReads(), 1);

  state.now += 2 * 60_000;
  await unpaced(() => board.getMarket("BTC-PERP"));
  assert.equal(candleReads(), 2);
});

test("without candles the market is still served, and the venue is not asked again for thirty seconds", async () => {
  const { board, candleReads, state, unpaced } = harness({ candles: { nothing: "here" } });

  const detail = await board.getMarket("BTC-PERP");

  assert.equal(detail!.market.mark, 76255.5);
  assert.deepEqual(detail!.trail, []);
  assert.equal(detail!.market.hourlyReach, null);
  assert.equal(candleReads(), 1);

  state.now += 20_000;
  await unpaced(() => board.getMarket("BTC-PERP"));
  assert.equal(candleReads(), 1);

  state.served.candles = candles;
  state.now += 15_000;
  const recovered = await unpaced(() => board.getMarket("BTC-PERP"));
  assert.equal(candleReads(), 2);
  assert.equal(recovered!.trail.length, 25);
});

test("a history that is slow to come is not waited for, and is there the next time", async () => {
  const { board, state, unpaced } = harness();

  await board.listMarkets();
  state.served.delayMs = 3_200;
  const started = Date.now();
  const first = await board.getMarket("BTC-PERP");

  assert.ok(Date.now() - started < 3_100);
  assert.deepEqual(first!.trail, []);

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  state.served.delayMs = 0;
  const second = await unpaced(() => board.getMarket("BTC-PERP"));
  assert.equal(second!.trail.length, 25);
});

test("market pages do not queue behind one another's history for the board itself", async () => {
  const { board, state, unpaced } = harness();

  await board.listMarkets();
  state.now += 11_000;
  // Three histories are paced a second apart; the board's own read has its own schedule.
  const details = Promise.all([
    board.getMarket("BTC-PERP"),
    board.getMarket("ETH-PERP"),
    board.getMarket("SOL-PERP"),
  ]);
  await details;
  state.now += 11_000;
  const started = Date.now();
  void board.getMarket("MON-PERP");
  void board.getMarket("ZEC-PERP");
  const listed = await unpaced(() => board.listMarkets());

  assert.ok(Date.now() - started < 500);
  assert.equal(listed.length, 7);
});

test("a symbol the venue does not list is null", async () => {
  const { board, asked } = harness();

  assert.equal(await board.getMarket("NOPE-PERP"), null);
  assert.equal(asked.length, 1);
});

test("cached hourly samples retain their times while only a fresh board mark advances", async () => {
  const { board, state, unpaced, candleReads } = harness();
  const first = await board.getMarket("BTC-PERP");

  state.now += 2 * 60_000;
  const second = await unpaced(() => board.getMarket("BTC-PERP"));

  assert.equal(candleReads(), 1);
  assert.deepEqual(second!.trailTimestamps!.slice(0, -1), first!.trailTimestamps!.slice(0, -1));
  assert.equal(second!.trailTimestamps!.at(-1), new Date(state.now).toISOString());

  state.served.fail = true;
  state.now += 2 * 60_000;
  const held = await unpaced(() => board.getMarket("BTC-PERP"));
  assert.deepEqual(held!.trailTimestamps, second!.trailTimestamps);
  assert.ok(held!.market.source.venue === "perpl" && held!.market.source.stale);
});

test("longer price history reuses the same candle request and does not change the 24h contract", async () => {
  const { board, asked, candleReads } = harness();

  const detail = await board.getMarket("BTC-PERP");

  assert.equal(asked.length, 2);
  assert.equal(candleReads(), 1);
  assert.deepEqual(detail!.priceHistory, [
    ...candles.d.map((candle) => ({
      price: candle.c / 10,
      at: new Date(candle.t + HOUR).toISOString(),
    })),
    { price: detail!.market.mark, at: new Date(NOW).toISOString() },
  ]);
  assert.equal(detail!.trail.length, 25);
  assert.ok(detail!.priceHistory!.length > detail!.trail.length);
  const original = detail!.priceHistory![0]!.price;
  detail!.priceHistory![0]!.price = -1;

  const cached = await board.getMarket("BTC-PERP");

  assert.equal(candleReads(), 1);
  assert.equal(cached!.priceHistory![0]!.price, original);
});

test("failed history exposes no generated long-range samples", async () => {
  const { board } = harness({ candles: { unavailable: true } });

  const detail = await board.getMarket("BTC-PERP");

  assert.deepEqual(detail!.priceHistory, []);
});
