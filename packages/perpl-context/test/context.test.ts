import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContext, parseServerTime } from "../src/index.js";
import capture from "./fixtures/context.json" with { type: "json" };
import expected from "./expected-context.json" with { type: "json" };

/** The parsed value as JSON holds it: amounts are bigint in memory and decimal strings on disk. */
function plain(value: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}

function clone(): typeof capture {
  return JSON.parse(JSON.stringify(capture));
}

// `expected-context.json` is what the mobile app's parser gave for this capture before the parser
// moved here (docs/specs/perps-board-live-v1.md §3). The app sizes orders and reads the venue's
// minimums from these fields. A change that breaks this is wrong; the file is not regenerated.
test("the parser gives what the app's parser gave for the recorded capture", () => {
  const parsed = plain(parseContext(capture)) as unknown as {
    markets: Record<string, unknown>[];
    instance: unknown;
    geoBlock: unknown;
    serverTime: unknown;
  };

  assert.equal(parsed.markets.length, expected.markets.length);
  for (const [index, market] of expected.markets.entries()) {
    for (const [field, value] of Object.entries(market)) {
      assert.deepEqual(parsed.markets[index]![field], value, `${market.symbol}.${field}`);
    }
  }
  assert.deepEqual(parsed.instance, expected.instance);
  assert.deepEqual(parsed.geoBlock, expected.geoBlock);
  assert.equal(parsed.serverTime, expected.serverTime);
});

test("what the board needs is read where the venue publishes it", () => {
  const context = parseContext(capture);
  const btc = context.markets.find((market) => market.symbol === "BTC")!;

  assert.equal(context.chainId, 10143);
  assert.equal(btc.sizeUnits, "BTC");
  assert.equal(btc.openInterest, 1796600);
  assert.equal(btc.fundingRate, 30);
  assert.equal(btc.fundingIntervalSec, 2580);
});

test("a market that lacks the board's fields still parses, with them null", () => {
  const body = clone() as unknown as {
    chain?: unknown;
    markets: {
      size_units?: unknown;
      funding?: unknown;
      funding_interval_sec?: unknown;
      state: { oi?: unknown };
    }[];
  };
  delete body.chain;
  const first = body.markets[0]!;
  delete first.size_units;
  delete first.funding;
  delete first.state.oi;
  first.funding_interval_sec = "soon";

  const context = parseContext(body);
  const btc = context.markets.find((market) => market.symbol === "BTC")!;

  assert.equal(context.chainId, null);
  assert.equal(btc.sizeUnits, null);
  assert.equal(btc.openInterest, null);
  assert.equal(btc.fundingRate, null);
  assert.equal(btc.fundingIntervalSec, null);
  // What the app trades on is untouched by their absence.
  assert.equal(btc.mark, 762555);
  assert.equal(btc.maxLeverage, 15);
});

test("a field the app trades on is still required", () => {
  const body = clone() as unknown as { markets: { state: { mrk?: unknown } }[] };
  delete body.markets[0]!.state.mrk;

  assert.throws(() => parseContext(body), /state\.mrk is not a number/);
});

test("closed markets are dropped and the rest are ordered by id", () => {
  const body = clone();
  body.markets[3]!.config.is_open = false;
  body.markets.reverse();

  assert.deepEqual(
    parseContext(body).markets.map((market) => market.id),
    [16, 32, 48, 256, 272, 320],
  );
});

test("the server's clock is the Date header plus the time the response spent in a cache", () => {
  assert.equal(parseServerTime(null), null);
  assert.equal(parseServerTime("not a date"), null);
  assert.equal(parseServerTime("Thu, 01 Oct 2026 12:00:00 GMT"), Date.UTC(2026, 9, 1, 12, 0, 0));
  assert.equal(
    parseServerTime("Thu, 01 Oct 2026 12:00:00 GMT", "7"),
    Date.UTC(2026, 9, 1, 12, 0, 7),
  );
  assert.equal(
    parseServerTime("Thu, 01 Oct 2026 12:00:00 GMT", "soon"),
    Date.UTC(2026, 9, 1, 12, 0, 0),
  );
});
