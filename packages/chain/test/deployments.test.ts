import { test } from "node:test";
import assert from "node:assert/strict";

import { UNISWAP_V4_MONAD_MAINNET, UNISWAP_V4_MONAD_TESTNET } from "../src/deployments.js";

const VENUES = [UNISWAP_V4_MONAD_MAINNET, UNISWAP_V4_MONAD_TESTNET];

test("every recorded contract carries a real code hash and size", () => {
  for (const venue of VENUES) {
    for (const [name, deployment] of Object.entries(venue.contracts)) {
      assert.match(
        deployment.codeHash,
        /^0x[0-9a-f]{64}$/,
        `${venue.chainId} ${name} has a malformed code hash`,
      );
      assert.notEqual(
        deployment.codeHash,
        `0x${"0".repeat(64)}`,
        `${venue.chainId} ${name} has a placeholder code hash`,
      );
      assert.ok(deployment.codeSize > 0, `${venue.chainId} ${name} records an empty contract`);
      assert.equal(deployment.chainId, venue.chainId, `${name} records the wrong chain`);
    }
  }
});

test("the testnet venue is marked unofficial", () => {
  // The whole risk of this dependency is forgetting that Uniswap did not deploy it.
  assert.equal(UNISWAP_V4_MONAD_TESTNET.official, false);
  assert.equal(UNISWAP_V4_MONAD_TESTNET.maintainer, "monad");
  assert.equal(UNISWAP_V4_MONAD_MAINNET.official, true);
});

test("the two PoolManagers are different builds", () => {
  // If these ever converge, the spike's testnet result starts transferring to mainnet and
  // the graduation adapter's assumptions should be revisited deliberately, not silently.
  assert.notEqual(
    UNISWAP_V4_MONAD_TESTNET.contracts.poolManager.codeHash,
    UNISWAP_V4_MONAD_MAINNET.contracts.poolManager.codeHash,
  );
  assert.notEqual(
    UNISWAP_V4_MONAD_TESTNET.contracts.poolManager.codeSize,
    UNISWAP_V4_MONAD_MAINNET.contracts.poolManager.codeSize,
  );
});

test("sharing an address across chains does not mean sharing code", () => {
  const testnetPermit2 = UNISWAP_V4_MONAD_TESTNET.contracts.permit2;
  const mainnetPermit2 = UNISWAP_V4_MONAD_MAINNET.contracts.permit2;

  assert.equal(testnetPermit2.address, mainnetPermit2.address);
  assert.notEqual(testnetPermit2.codeHash, mainnetPermit2.codeHash);
});
