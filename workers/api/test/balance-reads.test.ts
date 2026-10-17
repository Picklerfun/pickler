import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedBalanceReads } from "../src/balance-reads";

test("balance reads deduplicate addresses, cap transport at four and stay invocation-local", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const reader = {
    async read() {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return 10;
    },
    forget() {},
  };
  const request = boundedBalanceReads(reader);
  await Promise.all([
    ...Array.from({ length: 30 }, (_, i) => request.read(`wallet-${i}`)),
    request.read("WALLET-0"),
  ]);
  assert.equal(calls, 30);
  assert.equal(peak, 4);
  await boundedBalanceReads(reader).read("wallet-0");
  assert.equal(calls, 31);
  request.forget("wallet-0");
  await request.read("wallet-0");
  assert.equal(calls, 32);
});
