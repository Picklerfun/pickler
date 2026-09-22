/**
 * The rules that decide what an indexer does with a range it just read.
 *
 * Kept pure and kept here because this is where an indexer is usually wrong, and a rule that
 * only exists inside a worker's control flow cannot be tested against the cases that matter:
 * a gap, an overlap, a reorg, and a range that is simply empty.
 *
 * The invariant every rule serves: a block is only applied when its parent is the block we
 * already have. Anything else is either a gap we must not silently skip or a fork we must
 * roll back to before continuing.
 */

/** Where a stream got to, and on which branch. */
export interface IndexerCursor {
  /** CAIP-2, e.g. `eip155:10143`. */
  chain: string;
  /** The contract or log source this cursor belongs to. */
  contract: string;
  /** A name for what is being indexed from that source. */
  stream: string;
  lastBlock: bigint;
  lastBlockHash: string;
}

export interface IndexedBlock {
  number: bigint;
  hash: string;
  parentHash: string;
}

export type AdvancePlan =
  /** Apply these blocks, in order, then move the cursor to the last of them. */
  | { kind: "apply"; blocks: IndexedBlock[] }
  /** Nothing new. */
  | { kind: "idle" }
  /**
   * The chain no longer agrees with what we recorded. Everything strictly after
   * `rollbackToBlock` must be undone before anything else is applied.
   */
  | { kind: "reorg"; rollbackToBlock: bigint; detectedAt: bigint }
  /**
   * The range does not reach back to the cursor. Applying it would leave a hole that no
   * later pass would notice, so it is refused rather than partially applied.
   */
  | { kind: "gap"; expectedBlock: bigint; receivedBlock: bigint };

/**
 * Decides what to do with `blocks`, which must be contiguous and ascending as the node
 * returned them.
 *
 * @param cursor Where the stream got to, or null to bootstrap.
 */
export function planAdvance(
  cursor: IndexerCursor | null,
  blocks: readonly IndexedBlock[],
): AdvancePlan {
  if (blocks.length === 0) {
    return { kind: "idle" };
  }

  const ordered = [...blocks].sort((left, right) => (left.number < right.number ? -1 : 1));
  const first = ordered[0]!;

  if (cursor === null) {
    // Bootstrapping: there is nothing to disagree with, so the range is taken as given.
    return { kind: "apply", blocks: ordered };
  }

  // Everything at or below the cursor has been applied already. Re-reading it is normal —
  // ranges overlap after a restart — so the seen part is dropped rather than reapplied.
  const unseen = ordered.filter((block) => block.number > cursor.lastBlock);

  if (unseen.length === 0) {
    const reorged = ordered.find(
      (block) => block.number === cursor.lastBlock && block.hash !== cursor.lastBlockHash,
    );

    if (reorged) {
      return {
        kind: "reorg",
        rollbackToBlock: cursor.lastBlock - 1n,
        detectedAt: cursor.lastBlock,
      };
    }

    return { kind: "idle" };
  }

  const next = unseen[0]!;

  if (next.number > cursor.lastBlock + 1n) {
    return { kind: "gap", expectedBlock: cursor.lastBlock + 1n, receivedBlock: next.number };
  }

  if (next.parentHash !== cursor.lastBlockHash) {
    // The block that should follow ours descends from something else, so the block we
    // recorded is no longer on the canonical branch and has to go with it.
    return { kind: "reorg", rollbackToBlock: cursor.lastBlock - 1n, detectedAt: next.number };
  }

  return { kind: "apply", blocks: unseen };
}

/**
 * How far to read next, bounded so one pass cannot ask a node for an unbounded range.
 *
 * Starts at the deployment block rather than at whatever the chain height is now: an indexer
 * that begins at its own start-up time has silently decided that history before it did not
 * happen.
 */
export function nextRange(options: {
  cursor: IndexerCursor | null;
  deploymentBlock: bigint;
  latestBlock: bigint;
  maxBlocks: bigint;
  /** Blocks behind the tip to stay, under the finality policy measured for this chain. */
  confirmations?: bigint;
}): { fromBlock: bigint; toBlock: bigint } | null {
  const confirmations = options.confirmations ?? 0n;
  const safeTip = options.latestBlock - confirmations;

  const fromBlock =
    options.cursor === null ? options.deploymentBlock : options.cursor.lastBlock + 1n;

  if (safeTip < fromBlock) {
    return null;
  }

  const toBlock = fromBlock + options.maxBlocks - 1n;

  return { fromBlock, toBlock: toBlock < safeTip ? toBlock : safeTip };
}
