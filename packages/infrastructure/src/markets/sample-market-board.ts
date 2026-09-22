import type { AgentSquare, MarketBoard, MarketDetail, PerpMarket } from "@pickler/core";

// Sample content from the "Pickler Market Web" design. Not live data: no venue is polled, no mark
// is streamed, and the calls listed here belong to the sample agents, not to anyone's position.

const MARKETS: PerpMarket[] = [
  {
    symbol: "BTC-PERP",
    base: "BTC",
    accent: "amber",
    mark: 63584.2,
    change24h: 0.018,
    funding1h: 0.000091,
    openInterest: 4_100_000,
    maxLeverage: 10,
    agentsReading: 7,
    openCalls: 3,
    lastCall: { agent: "FEDWATCH", when: "2h ago" },
    note: "Funding stretched long for 11 hours. Three agents lean up.",
    hourlyReach: 1.5,
  },
  {
    symbol: "ETH-PERP",
    base: "ETH",
    accent: "cyan",
    mark: 3128.6,
    change24h: -0.009,
    funding1h: -0.00002,
    openInterest: 1_900_000,
    maxLeverage: 10,
    agentsReading: 4,
    openCalls: 2,
    lastCall: { agent: "LIQUIDITY DESK", when: "40m ago" },
    note: "Book thin below 3,080. One agent closed a short here.",
    hourlyReach: 1.6,
  },
  {
    symbol: "SOL-PERP",
    base: "SOL",
    accent: "violet",
    mark: 148.22,
    change24h: 0.034,
    funding1h: 0.00014,
    openInterest: 820_000,
    maxLeverage: 10,
    agentsReading: 3,
    openCalls: 1,
    lastCall: { agent: "VOL TRACKER", when: "3h ago" },
    note: "Realised vol at a 30-day high. Wide squares fill faster.",
    hourlyReach: 2.2,
  },
  {
    symbol: "MON-PERP",
    base: "MON",
    accent: "lime",
    mark: 4.412,
    change24h: 0.062,
    funding1h: 0.00021,
    openInterest: 610_000,
    maxLeverage: 5,
    agentsReading: 2,
    openCalls: 2,
    lastCall: { agent: "TAPE READER", when: "1h ago" },
    note: "Home chain. Funding is the most expensive on the list.",
    hourlyReach: 2.6,
  },
  {
    symbol: "HYPE-PERP",
    base: "HYPE",
    accent: "magenta",
    mark: 27.9,
    change24h: -0.021,
    funding1h: -0.000065,
    openInterest: 340_000,
    maxLeverage: 5,
    agentsReading: 1,
    openCalls: 0,
    lastCall: null,
    note: "One agent reads it, none has a call open.",
    hourlyReach: 2,
  },
  {
    symbol: "ZEC-PERP",
    base: "ZEC",
    accent: "blue",
    mark: 412.6,
    change24h: 0.004,
    funding1h: 0.000012,
    openInterest: 120_000,
    maxLeverage: 3,
    agentsReading: 0,
    openCalls: 0,
    lastCall: null,
    note: "No agent covers it yet. Trade is open; Ask has no one to answer.",
    hourlyReach: 1.2,
  },
];

/** The squares the sample agents hold a public call on, by market. */
const CALLS: Record<string, AgentSquare[]> = {
  "BTC-PERP": [
    { level: 2.5, horizon: "24H", agents: 1 },
    { level: 1, horizon: "4H", agents: 1 },
    { level: -1, horizon: "12H", agents: 1 },
  ],
  "ETH-PERP": [
    { level: 1.5, horizon: "24H", agents: 1 },
    { level: -1, horizon: "4H", agents: 1 },
  ],
  "SOL-PERP": [{ level: 2, horizon: "12H", agents: 1 }],
  "MON-PERP": [
    { level: 1, horizon: "24H", agents: 1 },
    { level: -0.5, horizon: "4H", agents: 1 },
  ],
  "HYPE-PERP": [],
  "ZEC-PERP": [],
};

// Where the mark sat between the open and now, in thirteen two-hour steps. The ends are pinned, so
// a trail always starts at the price the 24-hour change is measured from and finishes at the mark.
const TRAIL_SHAPE = [0, 0.18, 0.08, 0.34, 0.26, 0.52, 0.44, 0.63, 0.58, 0.74, 0.86, 0.8, 1];
const TRAIL_WOBBLE = [0, 0.4, -0.6, 0.3, -0.5, 0.2, -0.4, 0.5, -0.3, 0.25, -0.2, 0.15, 0];

function trailFor(market: PerpMarket): number[] {
  const open = market.mark / (1 + market.change24h);
  const swing = (market.mark * market.hourlyReach) / 100;

  return TRAIL_SHAPE.map(
    (progress, index) =>
      open + (market.mark - open) * progress + swing * 0.12 * (TRAIL_WOBBLE[index] ?? 0),
  );
}

/** Reads the sample market board. No network, no venue credentials, no chain. */
export function createSampleMarketBoard(): MarketBoard {
  return {
    listMarkets: async () => MARKETS.map((market) => ({ ...market })),
    getMarket: async (symbol: string): Promise<MarketDetail | null> => {
      const market = MARKETS.find((candidate) => candidate.symbol === symbol);
      if (!market) {
        return null;
      }

      return {
        market: { ...market },
        calls: CALLS[symbol] ?? [],
        trail: trailFor(market),
      };
    },
  };
}
