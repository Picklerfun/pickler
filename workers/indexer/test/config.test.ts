import { test } from "node:test";
import assert from "node:assert/strict";

import { IndexerNotConfiguredError, readIndexerConfig } from "../src/config.js";
import type { Env } from "../src/index.js";

const complete: Env = {
  APP_ENV: "staging",
  DATABASE_URL: "postgresql://localhost/pickler",
  CHAIN_ID: "10143",
  RPC_URLS: "https://testnet-rpc.monad.xyz, https://rpc-testnet.monadinfra.com",
  LAUNCH_FACTORY_ADDRESS: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
  LAUNCH_FACTORY_DEPLOYMENT_BLOCK: "62279958",
  CONFIRMATIONS: "5",
  MAX_BLOCKS_PER_PASS: "50",
};

test("a complete configuration is read, with the address normalised", () => {
  const config = readIndexerConfig(complete);

  assert.equal(config.chain, "eip155:10143");
  assert.equal(config.factory, "0xabcdef0123456789abcdef0123456789abcdef01");
  assert.equal(config.deploymentBlock, 62279958n);
  assert.equal(config.confirmations, 5n);
  assert.deepEqual(config.rpcUrls, [
    "https://testnet-rpc.monad.xyz",
    "https://rpc-testnet.monadinfra.com",
  ]);
});

/**
 * Nothing here is defaulted on purpose. A factory address or a deployment block guessed
 * wrong produces an index that looks populated and is not, which is harder to notice than an
 * indexer that plainly did not start.
 */
for (const missing of [
  "LAUNCH_FACTORY_ADDRESS",
  "LAUNCH_FACTORY_DEPLOYMENT_BLOCK",
  "CHAIN_ID",
  "RPC_URLS",
] as const) {
  test(`without ${missing} the indexer refuses to run`, () => {
    const env = { ...complete, [missing]: undefined };

    assert.throws(
      () => readIndexerConfig(env),
      (error: unknown) => error instanceof IndexerNotConfiguredError,
    );
  });
}

test("an address that is not an address is refused, not coerced", () => {
  assert.throws(
    () => readIndexerConfig({ ...complete, LAUNCH_FACTORY_ADDRESS: "not-an-address" }),
    (error: unknown) => error instanceof IndexerNotConfiguredError,
  );
});
