import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byCoverage,
  createGetMarket,
  createListMarkets,
  levelPrice,
  levelSide,
  MarketDataUnavailableError,
  normalizeSymbol,
  squareProblem,
  type MarketBoard,
  type MarketDetail,
  type PerpMarket,
} from "../src/index.js";

const market = (overrides: Partial<PerpMarket> = {}): PerpMarket => ({
  symbol: "BTC-PERP",
  base: "BTC",
  accent: "amber",
  mark: 1000,
  change24h: 0.01,
  funding1h: 0.0001,
  openInterest: 1_000_000,
  maxLeverage: 10,
  agentsReading: 3,
  openCalls: 1,
  lastCall: null,
  note: "",
  hourlyReach: 1.5,
  limits: { takerFee: 0.0005, maintenanceMargin: 0.05, slippageCap: 0.005, minimumAccountOpen: 10 },
  source: { venue: "sample" },
  ...overrides,
});

function board(overrides: Partial<MarketBoard> = {}): MarketBoard & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    listMarkets: async () => [
      market({ symbol: "A-PERP", agentsReading: 1, openCalls: 0, openInterest: 9_000_000 }),
      market({ symbol: "B-PERP", agentsReading: 4, openCalls: 0, openInterest: 10 }),
      market({ symbol: "C-PERP", agentsReading: 4, openCalls: 2, openInterest: 10 }),
    ],
    getMarket: async (symbol) => {
      asked.push(symbol);
      return null;
    },
    ...overrides,
  };
}

test("a level above the mark is a long and below it a short", () => {
  assert.equal(levelSide(0.5), "long");
  assert.equal(levelSide(-0.5), "short");
  assert.equal(levelPrice(1000, 2.5), 1025);
  assert.equal(levelPrice(1000, -2), 980);
});

test("an hour cannot reach further than the market has moved in one", () => {
  const btc = market({ hourlyReach: 1.5 });

  assert.equal(squareProblem(btc, 2.5, "1H"), "out-of-reach");
  assert.equal(squareProblem(btc, 1.5, "1H"), null);
  // Longer columns have the time for it.
  assert.equal(squareProblem(btc, 2.5, "4H"), null);
});

test("the board leads with coverage, not with size", async () => {
  const markets = await createListMarkets(board())();

  assert.deepEqual(
    markets.map((m) => m.symbol),
    ["C-PERP", "B-PERP", "A-PERP"],
  );
  assert.equal(byCoverage(markets[0]!, markets[1]!) < 0, true);
});

test("a symbol is normalized before the board is asked, and nonsense never reaches it", async () => {
  const markets = board();
  const getMarket = createGetMarket(markets);

  assert.equal(await getMarket(" btc-perp "), null);
  assert.deepEqual(markets.asked, ["BTC-PERP"]);

  assert.equal(await getMarket("BTC"), null);
  assert.equal(await getMarket("../secrets"), null);
  assert.equal(normalizeSymbol("eth-perp"), "ETH-PERP");
  assert.equal(normalizeSymbol("ETH"), null);
  // The board was only asked the one well-formed symbol.
  assert.deepEqual(markets.asked, ["BTC-PERP"]);
});

test("a call on a square the surface cannot take is dropped", async () => {
  const detail: MarketDetail = {
    market: market({ hourlyReach: 1.5 }),
    calls: [
      { level: 1, horizon: "4H", agents: 2 },
      // Out of reach in an hour: a dot here would be a square nobody can click.
      { level: 2.5, horizon: "1H", agents: 1 },
      // Not a level the surface draws.
      { level: 0.75, horizon: "24H", agents: 1 },
    ],
    trail: [990, 1000],
  };
  const getMarket = createGetMarket(board({ getMarket: async () => detail }));

  const found = await getMarket("BTC-PERP");

  assert.deepEqual(found?.calls, [{ level: 1, horizon: "4H", agents: 2 }]);
});

test("a count nobody has measured sorts as none, and never above a market agents do read", () => {
  const listed = [
    market({ symbol: "UNKNOWN-PERP", agentsReading: null, openCalls: null, openInterest: 50 }),
    market({ symbol: "READ-PERP", agentsReading: 1, openCalls: 0, openInterest: 1 }),
    market({ symbol: "DEEP-PERP", agentsReading: null, openCalls: null, openInterest: 900 }),
  ].sort(byCoverage);

  assert.deepEqual(
    listed.map((item) => item.symbol),
    ["READ-PERP", "DEEP-PERP", "UNKNOWN-PERP"],
  );
});

test("a square is refused only on evidence: an unknown reach refuses nothing", () => {
  assert.equal(squareProblem({ hourlyReach: null }, 2.5, "1H"), null);
  assert.equal(squareProblem({ hourlyReach: 1.5 }, 2.5, "1H"), "out-of-reach");
});

test("a venue that cannot be read is an error with a code, never an empty board", () => {
  const error = new MarketDataUnavailableError("perpl testnet", { cause: new Error("timeout") });

  assert.equal(error.code, "MARKET_DATA_UNAVAILABLE");
  assert.equal(error.name, "MarketDataUnavailableError");
  assert.match(error.message, /perpl testnet/);
});
