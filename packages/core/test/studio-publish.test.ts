import test from "node:test";
import assert from "node:assert/strict";
import { MIN_PUBLISH_AUSD_MICRO, publishBlockers } from "../src/features/studio/publish.js";

test("blockers name exactly what is missing", () => {
  assert.deepEqual(
    publishBlockers({ killed: false, walletLinked: true, ausdMicro: 10_000_000n }),
    [],
  );
  assert.deepEqual(publishBlockers({ killed: false, walletLinked: true, ausdMicro: 9_999_999n }), [
    "FUNDS",
  ]);
  assert.deepEqual(publishBlockers({ killed: false, walletLinked: false, ausdMicro: null }), [
    "WALLET",
  ]);
  assert.deepEqual(publishBlockers({ killed: true, walletLinked: false, ausdMicro: null }), [
    "KILLED",
    "WALLET",
  ]);
});

test("the minimum is the schedule's 10 AUSD", () => {
  assert.equal(MIN_PUBLISH_AUSD_MICRO, 10_000_000n);
});
