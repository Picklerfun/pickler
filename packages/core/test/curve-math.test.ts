import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { remainingTokens, tokensOutForQuoteIn, type CurveConfig } from "../src/index.js";

interface CurveVectors {
  virtualTokenReserve: string;
  virtualQuoteReserve: string;
  saleAllocation: string;
  buys: Array<{ netSold: string; quoteNetIn: string; tokensOut: string }>;
}

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/curve-vectors.json", import.meta.url), "utf8"),
) as CurveVectors;

const config: CurveConfig = {
  virtualTokenReserve: BigInt(vectors.virtualTokenReserve),
  virtualQuoteReserve: BigInt(vectors.virtualQuoteReserve),
  saleAllocation: BigInt(vectors.saleAllocation),
};

test("the preview reproduces every on-chain buy vector exactly", () => {
  assert.ok(vectors.buys.length > 0, "fixture is empty; regenerate it from CurveVectors.t.sol");

  for (const vector of vectors.buys) {
    const tokensOut = tokensOutForQuoteIn(
      config,
      BigInt(vector.netSold),
      BigInt(vector.quoteNetIn),
    );

    assert.equal(
      tokensOut.toString(),
      vector.tokensOut,
      `netSold ${vector.netSold} with quoteNetIn ${vector.quoteNetIn} diverged from the chain`,
    );
  }
});

test("a quote amount too small to move the curve buys nothing", () => {
  const coarse: CurveConfig = {
    virtualTokenReserve: 1000n,
    virtualQuoteReserve: 1000n,
    saleAllocation: 500n,
  };

  assert.equal(tokensOutForQuoteIn(coarse, 0n, 1n), 0n);
});

test("remaining inventory shrinks by what has been sold", () => {
  assert.equal(remainingTokens(config, 0n), config.saleAllocation);
  assert.equal(remainingTokens(config, 100n), config.saleAllocation - 100n);
});
