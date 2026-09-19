import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUSD,
  MONAD_MAINNET,
  MONAD_TESTNET,
  requireSupportedChain,
  toBaseUnits,
} from "../src/index.js";

test("AUSD amounts convert exactly with 6 decimals", () => {
  assert.equal(toBaseUnits("1", AUSD[143].decimals), 1_000_000n);
  assert.equal(toBaseUnits("12.5", AUSD[143].decimals), 12_500_000n);
  assert.equal(toBaseUnits("0.000001", AUSD[143].decimals), 1n);
  // Relayer's builder assumed 18 decimals, which would have produced 10^12 times this amount.
  assert.notEqual(toBaseUnits("1", AUSD[143].decimals), 10n ** 18n);
  for (const bad of ["0.0000001", "-1", "1e3", "", "1.2.3"]) {
    assert.throws(() => toBaseUnits(bad, 6), Error, bad);
  }
});

test("only Monad networks are supported; no silent fallback", () => {
  assert.equal(requireSupportedChain(143), MONAD_MAINNET.chainId);
  assert.equal(requireSupportedChain(10143), MONAD_TESTNET.chainId);
  for (const other of [1, 8453, 11155111]) {
    assert.throws(() => requireSupportedChain(other), /Unsupported chain/);
  }
  assert.equal(AUSD[143].eip712.name, "Agora Dollar");
});
