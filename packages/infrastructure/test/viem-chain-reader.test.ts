import { test } from "node:test";
import assert from "node:assert/strict";
import { custom } from "viem";

import { ChainMismatchError, ChainUnavailableError } from "@pickler/core";

import { ViemChainReader } from "../src/chain/viem-chain-reader.js";

type Handler = (method: string, params: unknown[]) => unknown;

/** A transport whose every answer is scripted, so no test needs a node. */
function scripted(handler: Handler, calls: string[] = []) {
  return custom({
    async request({ method, params }) {
      calls.push(method);

      const result = handler(method, (params as unknown[]) ?? []);
      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
  });
}

const BLOCK = {
  number: "0x10",
  hash: "0xaaaa",
  parentHash: "0xbbbb",
  timestamp: "0x64",
};

function defaultHandler(method: string): unknown {
  if (method === "eth_chainId") {
    return "0x279f";
  }
  if (method === "eth_getBlockByNumber") {
    return BLOCK;
  }
  if (method === "eth_getLogs") {
    return [];
  }

  throw new Error(`unscripted method ${method}`);
}

test("a reader refuses a node that answers for another chain", async () => {
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted((method) => (method === "eth_chainId" ? "0x8f" : defaultHandler(method))),
  });

  await assert.rejects(
    () => reader.getLatestBlock(),
    (error: unknown) => {
      assert.ok(error instanceof ChainMismatchError, "expected a chain mismatch");
      assert.equal(error.expected, 10143);
      assert.equal(error.actual, 143);

      return true;
    },
  );
});

test("the chain is verified once, not on every read", async () => {
  const calls: string[] = [];
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted(defaultHandler, calls),
  });

  await reader.getLatestBlock();
  await reader.getLatestBlock();

  assert.equal(calls.filter((method) => method === "eth_chainId").length, 1);
});

test("a block carries the parent hash a reorg is detected with", async () => {
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted(defaultHandler),
  });

  const block = await reader.getBlock(16n);

  assert.equal(block.number, 16n);
  assert.equal(block.hash, "0xaaaa");
  assert.equal(block.parentHash, "0xbbbb");
  assert.equal(block.timestamp, 100n);
});

test("logs carry the identity that makes indexing idempotent", async () => {
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted((method) => {
      if (method === "eth_getLogs") {
        return [
          {
            address: "0xcafe",
            topics: ["0xdead"],
            data: "0x01",
            blockNumber: "0x10",
            blockHash: "0xaaaa",
            transactionHash: "0xfeed",
            logIndex: "0x2",
            removed: false,
          },
        ];
      }

      return defaultHandler(method);
    }),
  });

  const logs = await reader.getLogs({ fromBlock: 1n, toBlock: 16n });
  const log = logs[0];
  assert.ok(log, "expected one log");

  assert.equal(log.chainId, 10143);
  assert.equal(log.blockNumber, 16n);
  assert.equal(log.blockHash, "0xaaaa");
  assert.equal(log.transactionHash, "0xfeed");
  assert.equal(log.logIndex, 2);
  assert.equal(log.removed, false);
});

test("a log the node reports as removed keeps that flag", async () => {
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted((method) => {
      if (method === "eth_getLogs") {
        return [
          {
            address: "0xcafe",
            topics: [],
            data: "0x",
            blockNumber: "0x10",
            blockHash: "0xaaaa",
            transactionHash: "0xfeed",
            logIndex: "0x0",
            removed: true,
          },
        ];
      }

      return defaultHandler(method);
    }),
  });

  const logs = await reader.getLogs({ fromBlock: 1n, toBlock: 16n });
  const log = logs[0];
  assert.ok(log, "expected one log");

  assert.equal(log.removed, true);
});

/**
 * The failure that matters most: a caller seeing `[]` cannot tell an empty range from an
 * unreachable node, and an indexer that treats the second as the first skips history
 * permanently without ever reporting an error.
 */
test("an unreachable node raises rather than reading as an empty range", async () => {
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted((method) => {
      if (method === "eth_getLogs") {
        return new Error("connection reset");
      }

      return defaultHandler(method);
    }),
  });

  await assert.rejects(
    () => reader.getLogs({ fromBlock: 1n, toBlock: 16n }),
    (error: unknown) => {
      assert.ok(error instanceof ChainUnavailableError);
      assert.match(error.message, /getLogs failed on chain 10143/);

      return true;
    },
  );
});

test("a backwards range is refused before it reaches the node", async () => {
  const calls: string[] = [];
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted(defaultHandler, calls),
  });

  await assert.rejects(
    () => reader.getLogs({ fromBlock: 20n, toBlock: 10n }),
    (error: unknown) => error instanceof ChainUnavailableError,
  );

  assert.equal(calls.includes("eth_getLogs"), false, "a backwards range reached the node");
});

test("a pending log has no identity and is refused", async () => {
  const reader = new ViemChainReader({
    chainId: 10143,
    rpcUrls: [],
    transport: scripted((method) => {
      if (method === "eth_getLogs") {
        return [
          {
            address: "0xcafe",
            topics: [],
            data: "0x",
            blockNumber: null,
            blockHash: null,
            transactionHash: "0xfeed",
            logIndex: null,
          },
        ];
      }

      return defaultHandler(method);
    }),
  });

  await assert.rejects(
    () => reader.getLogs({ fromBlock: 1n, toBlock: 16n }),
    (error: unknown) => error instanceof ChainUnavailableError,
  );
});

test("a reader with no endpoint and no transport is refused at construction", () => {
  assert.throws(
    () => new ViemChainReader({ chainId: 10143, rpcUrls: [] }),
    (error: unknown) => error instanceof ChainUnavailableError,
  );
});
