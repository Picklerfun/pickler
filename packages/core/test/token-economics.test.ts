import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  deriveCurveReserves,
  curveMarginalPriceWad,
  quoteInForTokensOut,
  quoteOutForTokensIn,
  tokensOutForQuoteIn,
  splitCurveFee,
  curveGrossFromNet,
  tokenReferenceEconomics,
} from "../src/index.js";

interface ReferenceVectors {
  virtualTokenReserve: string;
  virtualQuoteReserve: string;
  saleAllocation: string;
  lpAllocation: string;
  targetReserve: string;
  buys: Array<{
    netSold: string;
    grossQuote: string;
    netQuote: string;
    fee: string;
    tokensOut: string;
  }>;
  sells: Array<{ netSold: string; tokensIn: string; grossQuote: string; netQuote: string }>;
  exact: Array<{ netSold: string; tokensOut: string; netQuote: string; grossQuote: string }>;
  prices: Array<{ netSold: string; priceWad: string }>;
}
const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/curve-reference-vectors.json", import.meta.url), "utf8"),
) as ReferenceVectors;
const config = deriveCurveReserves(
  BigInt(vectors.saleAllocation),
  BigInt(vectors.lpAllocation),
  BigInt(vectors.targetReserve),
);

test("reference derivation, prices and every fee-inclusive quote match Solidity exactly", () => {
  assert.equal(config.virtualTokenReserve.toString(), vectors.virtualTokenReserve);
  assert.equal(config.virtualQuoteReserve.toString(), vectors.virtualQuoteReserve);
  assert.equal(vectors.buys.length, 24);
  assert.equal(vectors.sells.length, 12);
  assert.equal(vectors.exact.length, 12);
  assert.equal(vectors.prices.length, 5);

  for (const v of vectors.buys) {
    const split = splitCurveFee(BigInt(v.grossQuote), 100);
    assert.equal(split.fee.toString(), v.fee);
    assert.equal(split.net.toString(), v.netQuote);
    assert.equal(tokensOutForQuoteIn(config, BigInt(v.netSold), split.net).toString(), v.tokensOut);
  }
  for (const v of vectors.sells) {
    const gross = quoteOutForTokensIn(config, BigInt(v.netSold), BigInt(v.tokensIn));
    assert.equal(gross.toString(), v.grossQuote);
    assert.equal(splitCurveFee(gross, 100).net.toString(), v.netQuote);
  }
  for (const v of vectors.exact) {
    const net = quoteInForTokensOut(config, BigInt(v.netSold), BigInt(v.tokensOut));
    assert.equal(net.toString(), v.netQuote);
    assert.equal(curveGrossFromNet(net, 100).toString(), v.grossQuote);
  }
  for (const v of vectors.prices) {
    assert.equal(curveMarginalPriceWad(config, BigInt(v.netSold), 6).toString(), v.priceWad);
  }
});

test("reference terms distinguish full-supply valuation, net reserve and virtual money", () => {
  const economics = tokenReferenceEconomics({
    address: "0x1111111111111111111111111111111111111111",
    decimals: 6,
  });
  assert.equal(economics.source, "reference");
  assert.equal(economics.version, 2);
  assert.equal(economics.netReserveAtCompletion, "31999999998");
  assert.equal(economics.initialPriceWad, vectors.prices[0]!.priceWad);
  assert.equal(economics.finalPriceWad, vectors.prices.at(-1)!.priceWad);
  const wad = 10n ** 18n;
  assert.ok(10_000n * wad - BigInt(economics.initialFdvWad) < 10n ** 12n);
  assert.ok(160_000n * wad - BigInt(economics.finalFdvWad) < 10n ** 14n);
  assert.equal(economics.virtualQuoteReserve, config.virtualQuoteReserve.toString());
  assert.notEqual(economics.virtualQuoteReserve, economics.netReserveAtCompletion);
  assert.equal(economics.launchFee, "0");
  assert.equal(economics.dexStatus, "pending");
});

test("unsupported metadata, precision, oversized output and invalid fees fail", () => {
  const address = "0x1111111111111111111111111111111111111111";
  assert.throws(() => tokenReferenceEconomics({ address, decimals: 18 }));
  assert.throws(() => tokenReferenceEconomics({ address: "0x" + "0".repeat(40), decimals: 6 }));
  assert.throws(() => curveMarginalPriceWad(config, 0n, 19));
  assert.throws(() => curveMarginalPriceWad(config, config.saleAllocation + 1n, 6));
  assert.throws(() => quoteInForTokensOut(config, 0n, config.saleAllocation + 1n));
  assert.throws(() => splitCurveFee(1n, 10_000));
  assert.throws(() => curveGrossFromNet(-1n, 100));
});
