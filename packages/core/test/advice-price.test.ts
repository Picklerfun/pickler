import { test } from "node:test";
import assert from "node:assert/strict";
import { advicePrice, formatMicroAusd, parseAusdToMicro } from "../src/index.js";

test("micro-AUSD is written without trailing zeros", () => {
  assert.equal(formatMicroAusd(1500000n), "1.5");
  assert.equal(formatMicroAusd(1000000n), "1");
  assert.equal(formatMicroAusd(100000n), "0.1");
  assert.equal(formatMicroAusd(123456n), "0.123456");
});

test("an advice price is absent when the agent sets none", () => {
  assert.equal(advicePrice(null), null);
  assert.deepEqual(advicePrice(100000n), { amount: "0.1", asset: "AUSD", decimals: 6 });
});

test("a price is parsed to micro-AUSD inside 0.10–100", () => {
  assert.equal(parseAusdToMicro("1.5"), 1500000n);
  assert.equal(parseAusdToMicro("0.1"), 100000n);
  assert.equal(parseAusdToMicro("100"), 100000000n);
  for (const bad of ["0.09", "100.000001", "1.0000001", "-1", "abc", ""]) {
    assert.throws(() => parseAusdToMicro(bad), /INVALID_INPUT|price/i);
  }
});
