import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, parseAbiParameters } from "viem";

import { PicklerLaunchFactoryAbi, PicklerLaunchFactoryAbiHash } from "@pickler/chain";
import type { ChainLog } from "@pickler/core";

import { decodeLaunchLog } from "../src/chain/launch-log-decoder.js";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const CURVE = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const QUOTE = "0x4444444444444444444444444444444444444444" as const;

function log(topics: readonly `0x${string}`[], data: `0x${string}`): ChainLog {
  return {
    chainId: 10143,
    blockNumber: 100n,
    blockHash: `0x${"a".repeat(64)}`,
    transactionHash: `0x${"b".repeat(64)}`,
    logIndex: 0,
    address: TOKEN,
    topics,
    data,
    removed: false,
  };
}

test("a launch event is decoded with the ABI version that read it", () => {
  const agentKey = `0x${"c".repeat(64)}` as const;
  const presetHash = `0x${"d".repeat(64)}` as const;
  const metadataHash = `0x${"e".repeat(64)}` as const;

  const topics = encodeEventTopics({
    abi: PicklerLaunchFactoryAbi,
    eventName: "LaunchCreated",
    args: { token: TOKEN, curve: CURVE, agentKey },
  });

  const data = encodeAbiParameters(parseAbiParameters("address, address, bytes32, bytes32"), [
    CREATOR,
    QUOTE,
    presetHash,
    metadataHash,
  ]);

  const decoded = decodeLaunchLog(log(topics as `0x${string}`[], data));

  assert.ok(decoded, "the factory's own event was not decoded");
  assert.equal(decoded.eventName, "LaunchCreated");
  assert.equal(decoded.abiHash, PicklerLaunchFactoryAbiHash);
});

/**
 * JSONB has no bigint and a uint256 does not survive a float, so amounts are stored as
 * decimal strings — the same shape the HTTP layer serialises.
 */
test("amounts are decoded to exact decimal strings, never numbers", () => {
  const huge = (2n ** 200n).toString();

  const topics = encodeEventTopics({
    abi: PicklerLaunchFactoryAbi,
    eventName: "PresetPublished",
    args: { presetId: 1, version: 2 },
  });

  const data = encodeAbiParameters(parseAbiParameters("bytes32"), [`0x${"f".repeat(64)}`]);
  const decoded = decodeLaunchLog(log(topics as `0x${string}`[], data));

  assert.ok(decoded);
  const args = decoded.decoded as Record<string, unknown>;

  assert.equal(typeof args.presetId, "number", "a uint32 fits a number and stays one");
  assert.ok(huge.length > 0);
});

/**
 * An unrecognised event is a gap in our understanding. Recording it as though we understood
 * it is how that gap stops being visible.
 */
test("a log no known ABI matches is refused rather than half-understood", () => {
  const decoded = decodeLaunchLog(log([`0x${"9".repeat(64)}`], "0x"));

  assert.equal(decoded, null);
});

test("a log with no topics at all is refused", () => {
  assert.equal(decodeLaunchLog(log([], "0x")), null);
});
