import { filterMarkets } from "../src/perpl/filter";

const mk = [{ symbol: "BTC", name: "Bitcoin" }, { symbol: "ETH", name: "Ethereum" }, { symbol: "MON", name: "Monad" }];

test("search matches symbol or name, case and accent insensitive, trimmed; empty query lists all", () => {
  expect(filterMarkets(mk, "").map((m) => m.symbol)).toEqual(["BTC", "ETH", "MON"]);
  expect(filterMarkets(mk, "  btc ").map((m) => m.symbol)).toEqual(["BTC"]);
  expect(filterMarkets(mk, "mon").map((m) => m.symbol)).toEqual(["MON"]);
  expect(filterMarkets(mk, "ether").map((m) => m.symbol)).toEqual(["ETH"]);
  expect(filterMarkets(mk, "Mönad").map((m) => m.symbol)).toEqual(["MON"]);
  expect(filterMarkets(mk, "xyz")).toEqual([]);
});
