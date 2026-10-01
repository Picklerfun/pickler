import { test } from "node:test";
import assert from "node:assert/strict";

import { nextRange, planAdvance, type IndexedBlock, type IndexerCursor } from "../src/index.js";

function block(number: bigint, hash: string, parentHash: string): IndexedBlock {
  return { number, hash, parentHash };
}

const cursor: IndexerCursor = {
  chain: "eip155:10143",
  contract: "0xfactory",
  stream: "launches",
  lastBlock: 100n,
  lastBlockHash: "0x100",
};

test("an empty range is nothing to do", () => {
  assert.deepEqual(planAdvance(cursor, []), { kind: "idle" });
});

test("bootstrapping applies the range as given", () => {
  const plan = planAdvance(null, [block(5n, "0x5", "0x4"), block(6n, "0x6", "0x5")]);

  assert.equal(plan.kind, "apply");
  assert.equal(plan.kind === "apply" && plan.blocks.length, 2);
});

test("a block whose parent is the one we hold is applied", () => {
  const plan = planAdvance(cursor, [block(101n, "0x101", "0x100")]);

  assert.equal(plan.kind, "apply");
  assert.equal(plan.kind === "apply" && plan.blocks[0]?.number, 101n);
});

/// Ranges overlap after a restart; re-reading what we already applied is normal and must not
/// double count.
test("blocks at or below the cursor are dropped rather than reapplied", () => {
  const plan = planAdvance(cursor, [
    block(99n, "0x99", "0x98"),
    block(100n, "0x100", "0x99"),
    block(101n, "0x101", "0x100"),
  ]);

  assert.equal(plan.kind, "apply");
  assert.equal(plan.kind === "apply" && plan.blocks.length, 1);
  assert.equal(plan.kind === "apply" && plan.blocks[0]?.number, 101n);
});

/// The case the whole function exists for: the next block descends from something other than
/// what we recorded, so what we recorded is no longer on the chain.
test("a next block with a different parent is a reorg, not a continuation", () => {
  const plan = planAdvance(cursor, [block(101n, "0x101b", "0x100b")]);

  assert.equal(plan.kind, "reorg");
  assert.equal(plan.kind === "reorg" && plan.rollbackToBlock, 99n);
  assert.equal(plan.kind === "reorg" && plan.detectedAt, 101n);
});

/// A shallower reorg: the very block we are sitting on was replaced.
test("re-reading our own block with a different hash is a reorg", () => {
  const plan = planAdvance(cursor, [block(100n, "0x100b", "0x99")]);

  assert.equal(plan.kind, "reorg");
  assert.equal(plan.kind === "reorg" && plan.rollbackToBlock, 99n);
});

test("re-reading our own block unchanged is nothing to do", () => {
  assert.deepEqual(planAdvance(cursor, [block(100n, "0x100", "0x99")]), { kind: "idle" });
});

/// Applying a range that starts past the cursor would leave a hole no later pass looks for.
test("a range that skips blocks is refused", () => {
  const plan = planAdvance(cursor, [block(105n, "0x105", "0x104")]);

  assert.equal(plan.kind, "gap");
  assert.equal(plan.kind === "gap" && plan.expectedBlock, 101n);
  assert.equal(plan.kind === "gap" && plan.receivedBlock, 105n);
});

test("blocks arriving out of order are sequenced before being judged", () => {
  const plan = planAdvance(cursor, [block(102n, "0x102", "0x101"), block(101n, "0x101", "0x100")]);

  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.kind === "apply" && plan.blocks.map((b) => b.number), [101n, 102n]);
});

// --- ranges -------------------------------------------------------------------------

/// An indexer that starts at its own start-up time has silently decided the history before it
/// did not happen.
test("a fresh stream starts at the deployment block, not at the tip", () => {
  const range = nextRange({
    cursor: null,
    deploymentBlock: 5_000n,
    latestBlock: 9_000n,
    maxBlocks: 1_000n,
  });

  assert.deepEqual(range, { fromBlock: 5_000n, toBlock: 5_999n });
});

test("a range is bounded so one pass cannot ask for everything", () => {
  const range = nextRange({
    cursor: { ...cursor, lastBlock: 100n },
    deploymentBlock: 0n,
    latestBlock: 1_000_000n,
    maxBlocks: 500n,
  });

  assert.deepEqual(range, { fromBlock: 101n, toBlock: 600n });
});

test("a range stops at the tip rather than asking past it", () => {
  const range = nextRange({
    cursor: { ...cursor, lastBlock: 100n },
    deploymentBlock: 0n,
    latestBlock: 120n,
    maxBlocks: 500n,
  });

  assert.deepEqual(range, { fromBlock: 101n, toBlock: 120n });
});

test("staying behind the tip leaves the unconfirmed blocks alone", () => {
  const range = nextRange({
    cursor: { ...cursor, lastBlock: 100n },
    deploymentBlock: 0n,
    latestBlock: 120n,
    maxBlocks: 500n,
    confirmations: 10n,
  });

  assert.deepEqual(range, { fromBlock: 101n, toBlock: 110n });
});

test("there is no range when the safe tip is behind the cursor", () => {
  const range = nextRange({
    cursor: { ...cursor, lastBlock: 115n },
    deploymentBlock: 0n,
    latestBlock: 120n,
    maxBlocks: 500n,
    confirmations: 10n,
  });

  assert.equal(range, null);
});

for (const anchor of [null, cursor]) {
  const start = anchor === null ? 5n : 101n;
  const parent = anchor === null ? "0x4" : cursor.lastBlockHash;
  const label = anchor === null ? "bootstrap" : "continuation";

  test(`${label} refuses an internal gap without applying its valid prefix`, () => {
    assert.deepEqual(
      planAdvance(anchor, [block(start, "first", parent), block(start + 2n, "third", "missing")]),
      { kind: "gap", expectedBlock: start + 1n, receivedBlock: start + 2n },
    );
  });

  test(`${label} refuses mixed ancestry without requesting a persisted rollback`, () => {
    assert.throws(
      () =>
        planAdvance(anchor, [block(start, "first", parent), block(start + 1n, "second", "fork")]),
      /inconsistent block ancestry/,
    );
  });

  for (const duplicateHash of ["first", "conflicting"]) {
    test(`${label} refuses duplicate heights (${duplicateHash})`, () => {
      assert.throws(
        () =>
          planAdvance(anchor, [block(start, "first", parent), block(start, duplicateHash, parent)]),
        /duplicate block height/,
      );
    });
  }
}

test("a replaced overlapping anchor is detected even when new blocks follow", () => {
  assert.deepEqual(
    planAdvance(cursor, [block(100n, "replacement", "0x99"), block(101n, "child", "replacement")]),
    { kind: "reorg", rollbackToBlock: 99n, detectedAt: 100n },
  );
});

test("normalizing a valid range does not mutate the caller's snapshot", () => {
  const blocks = Object.freeze([block(102n, "second", "first"), block(101n, "first", "0x100")]);
  const plan = planAdvance(cursor, blocks);

  assert.equal(plan.kind, "apply");
  assert.deepEqual(
    blocks.map((entry) => entry.number),
    [102n, 101n],
  );
});
