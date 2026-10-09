import assert from "node:assert/strict";
import test from "node:test";
import { createAdviceService, type AdviceRepository } from "@pickler/core";
import { paidAdviceFrom } from "../src/container";

const KEY = `0x${"7a".repeat(32)}`;
const RPC = "https://rpc.example.test/secret-token";
const repository = {} as AdviceRepository;
const deps = {
  advice: createAdviceService(repository, { enabled: false, policy: null }),
  repository,
  pool: {} as Parameters<typeof paidAdviceFrom>[1]["pool"],
};

function compose(env: Parameters<typeof paidAdviceFrom>[0]) {
  const logged: string[] = [];
  const paid = paidAdviceFrom(env, deps, (message) => logged.push(message));
  return { paid, logged };
}

test("paid advice is composed only with the flag, the relayer key and the RPC", () => {
  const on = compose({
    ADVICE_X402_ENABLED: "true",
    X402_RELAYER_PRIVATE_KEY: KEY,
    MONAD_RPC_URL: RPC,
  });

  assert.equal(typeof on.paid?.request, "function");
  assert.deepEqual(on.logged, []);

  for (const flag of [undefined, "false", "TRUE", "1"]) {
    const off = compose({
      ...(flag === undefined ? {} : { ADVICE_X402_ENABLED: flag }),
      X402_RELAYER_PRIVATE_KEY: KEY,
      MONAD_RPC_URL: RPC,
    });

    assert.equal(off.paid, undefined, `flag ${String(flag)} keeps advice free`);
    assert.deepEqual(off.logged, [], "a flag that is off is not a misconfiguration");
  }
});

test("the flag without its relayer or RPC turns paid advice off and logs no value", () => {
  for (const env of [
    { ADVICE_X402_ENABLED: "true", MONAD_RPC_URL: RPC },
    { ADVICE_X402_ENABLED: "true", X402_RELAYER_PRIVATE_KEY: KEY },
    { ADVICE_X402_ENABLED: "true", X402_RELAYER_PRIVATE_KEY: "not-a-key", MONAD_RPC_URL: RPC },
    {
      ADVICE_X402_ENABLED: "true",
      X402_RELAYER_PRIVATE_KEY: `0x${"00".repeat(32)}`,
      MONAD_RPC_URL: RPC,
    },
  ]) {
    const { paid, logged } = compose(env);

    assert.equal(paid, undefined);
    assert.equal(logged.length, 1);
    assert.match(logged[0]!, /paid advice is off/);
    for (const value of [KEY, "not-a-key", "00".repeat(32), RPC, "secret-token"]) {
      assert.equal(logged[0]!.includes(value), false, "no value is ever logged");
    }
  }
});
