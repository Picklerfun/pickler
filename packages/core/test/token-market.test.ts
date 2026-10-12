import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  tokenTradePriceWad,
  tokenFdvWad,
  tokenCurveMarket,
  tokenReferenceEconomics,
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
