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
 * Validates the whole range before proposing any writes. Input order is normalized;
 * duplicate heights and inconsistent ancestry are invalid responses, not evidence that
 * already persisted history should be rolled back.
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

  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;

    if (current.number === previous.number) {
      throw new Error("Invalid indexer range: duplicate block height");
    }

    if (current.number !== previous.number + 1n) {
      return {
        kind: "gap",
        expectedBlock: previous.number + 1n,
        receivedBlock: current.number,
      };
    }

    if (current.parentHash !== previous.hash) {
      throw new Error("Invalid indexer range: inconsistent block ancestry");
    }
  }

  if (cursor === null) {
    // No persisted anchor exists, but every link inside the range was checked.
    return { kind: "apply", blocks: ordered };
  }

  const anchor = ordered.find((block) => block.number === cursor.lastBlock);

  if (anchor && anchor.hash !== cursor.lastBlockHash) {
    return {
      kind: "reorg",
      rollbackToBlock: cursor.lastBlock - 1n,
      detectedAt: cursor.lastBlock,
    };
  }

  // Overlap is validated above, but already persisted blocks are never reapplied.
  const unseen = ordered.filter((block) => block.number > cursor.lastBlock);

  if (unseen.length === 0) {
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
