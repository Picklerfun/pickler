import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  tokenTradePriceWad,
  tokenFdvWad,
  tokenCurveMarket,
  tokenReferenceEconomics,
  tokenPriceMovement,
} from "../src/index.js";

const terms = tokenReferenceEconomics({ address: `0x${"1".repeat(40)}`, decimals: 6 });
test("market snapshots match Solidity marginal prices through completion", () => {
  const vectors = JSON.parse(
    readFileSync(new URL("./fixtures/curve-reference-vectors.json", import.meta.url), "utf8"),
  );
  for (const point of vectors.prices) {
    const snapshot = tokenCurveMarket(terms, point.netSold);
    assert.equal(snapshot.priceWad, point.priceWad);
    assert.equal(snapshot.fdvWad, tokenFdvWad(point.priceWad, terms.totalSupply, 18));
  }
  assert.equal(tokenCurveMarket(terms, "0").progressBps, 0);
  assert.equal(tokenCurveMarket(terms, terms.saleAllocation).progressBps, 10000);
  assert.equal(tokenCurveMarket(terms, terms.saleAllocation).remainingTokens, "0");
  assert.throws(() => tokenCurveMarket(terms, "-1"));
  assert.throws(() => tokenCurveMarket(terms, (BigInt(terms.saleAllocation) + 1n).toString()));
});
test("buy and sell execution prices exclude fees and normalize 18/6 decimals", () => {
  const common = {
    tokenAmount: "2000000000000000000000",
    feeAmount: "10000",
    tokenDecimals: 18,
    quoteDecimals: 6,
  };
  assert.equal(
    tokenTradePriceWad({ ...common, side: "buy", quoteAmount: "1010000" }),
    "500000000000000",
  );
  assert.equal(
    tokenTradePriceWad({ ...common, side: "sell", quoteAmount: "990000" }),
    "500000000000000",
  );
  assert.equal(tokenFdvWad("500000000000000", terms.totalSupply, 18), "10500000000000000000000");
  assert.throws(() => tokenTradePriceWad({ ...common, side: "buy", quoteAmount: "1" }));
  assert.throws(() =>
    tokenTradePriceWad({ ...common, side: "buy", quoteAmount: "1010000", tokenAmount: "0" }),
  );
});

test("observed movement distinguishes rises, falls, flat prices and missing baselines", () => {
  const fromAt = "2026-01-01T11:00:00Z";
  const toAt = "2026-01-01T12:00:00Z";
  const observation = (at: string, priceWad: string) => ({ at, priceWad });
  const previous = observation(fromAt, "1000");

  for (const [price, direction, changeBps] of [
    ["1250", "up", "2500"],
    ["750", "down", "-2500"],
    ["1000", "flat", "0"],
  ]) {
    assert.deepEqual(tokenPriceMovement([previous, observation(toAt, price!)]), {
      direction,
      changeBps,
      fromAt,
      toAt,
    });
  }
  assert.equal(tokenPriceMovement([]), null);
  assert.equal(tokenPriceMovement([previous]), null);
  assert.equal(tokenPriceMovement([observation(fromAt, "0"), previous]), null);
  assert.equal(tokenPriceMovement([previous, observation(toAt, "0")]), null);
});

test("movement preserves integer precision, symmetric rounding and sub-basis-point direction", () => {
  const at = "2026-01-01T12:00:00Z";
  const move = (before: string, after: string) =>
    tokenPriceMovement([
      { at, priceWad: before },
      { at, priceWad: after },
    ]);
  const large = 10n ** 70n;

  assert.equal(move(large.toString(), (large + large / 8n).toString())?.changeBps, "1250");
  assert.equal(move("20000", "20001")?.changeBps, "1");
  assert.equal(move("20000", "19999")?.changeBps, "-1");
  assert.deepEqual(move("100000", "99999"), {
    direction: "down",
    changeBps: "0",
    fromAt: at,
    toAt: at,
  });
});
