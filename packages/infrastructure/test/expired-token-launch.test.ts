import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  serializeTransaction,
  type Hex,
} from "viem";
import { PicklerLaunchFactoryAbi } from "@pickler/chain";
import type { TokenPreparedTransaction } from "@pickler/core";
import { reconcileExpiredLaunch } from "../src/launch/expired-launch.js";
import { launchPolicy, deploymentCode } from "./launch-policy-fixture.js";
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const sender = "0x" + "1".repeat(40);
const key = hash(77);
function fixture() {
  const policy = launchPolicy();
  policy.factory.deploymentBlock = 1;
  const params = {
    agentKey: key as Hex,
    creator: sender as Hex,
    creatorFeeRecipient: sender as Hex,
    name: "Controlled",
    symbol: "CTRL",
    metadataURI: "https://example.test/token.json",
    metadataHash: hash(88) as Hex,
    presetId: policy.preset.id,
    presetVersion: policy.preset.version,
    expectedConfigHash: policy.preset.configHash as Hex,
    nonce: 1n,
    deadline: 1000n,
  };
  const data = encodeFunctionData({
    abi: PicklerLaunchFactoryAbi,
    functionName: "createLaunch",
    args: [params, "0x", 1n, 1000n, "0x1234"],
  });
  const unsignedTransaction = serializeTransaction({
    type: "eip1559",
    chainId: 10143,
    to: policy.factory.address as Hex,
    data,
    nonce: 0,
    gas: 1n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 0n,
  });
  const prepared = {
    unsignedTransaction,
    chainId: 10143,
    sender,
    destination: policy.factory.address,
    deadline: "1000",
  } as TokenPreparedTransaction;
  const requests: { method: string; args: unknown[] }[] = [];
  let logs: Record<string, unknown>[] = [];
  let now = 500;
  let reorg = false;
  let broken = false;
  let wrongChain = false;
  let wrongCode = false;
  let anchorReads = 0;
  const rpc = {
    async call(method: string, args: unknown[]) {
      requests.push({ method, args });
      if (broken) {
        throw new Error("Controlled failure");
      }
      if (method === "eth_chainId") {
        return wrongChain ? "0x8f" : "0x279f";
      }
      if (method === "eth_getCode") {
        return wrongCode ? "0x00" : deploymentCode;
      }
      if (method === "eth_blockNumber") {
        return "0x" + (now + policy.confirmations).toString(16);
      }
      if (method === "eth_getBlockByNumber") {
        const number = Number(BigInt(args[0] as string));
        if (number === now) {
          anchorReads++;
        }
        return {
          number: args[0],
          timestamp: "0x" + (600 + number).toString(16),
          hash: hash(number === now && reorg && anchorReads > 1 ? 999 : number),
        };
      }
      if (method === "eth_getLogs") {
        const filter = args[0] as { fromBlock: string; toBlock: string; topics: string[] };
        assert.equal(filter.topics.length, 1);
        assert.ok(BigInt(filter.toBlock) - BigInt(filter.fromBlock) < 100n);
        return logs.filter(
          (log) =>
            BigInt(log.blockNumber as string) >= BigInt(filter.fromBlock) &&
            BigInt(log.blockNumber as string) <= BigInt(filter.toBlock),
        );
      }
      throw new Error("Unexpected request");
    },
  };
  function event(block = 400, agentKey = key, creator = sender) {
    return {
      address: policy.factory.address,
      transactionHash: hash(91),
      blockHash: hash(block),
      blockNumber: "0x" + block.toString(16),
      removed: false,
      topics: encodeEventTopics({
        abi: PicklerLaunchFactoryAbi,
        eventName: "LaunchCreated",
        args: {
          token: ("0x" + "2".repeat(40)) as Hex,
          curve: ("0x" + "3".repeat(40)) as Hex,
          agentKey: agentKey as Hex,
        },
      }),
      data: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
        [
          creator as Hex,
          policy.preset.quoteAddress as Hex,
          params.expectedConfigHash,
          params.metadataHash,
        ],
      ),
    };
  }
  return {
    prepared,
    policy,
    params,
    requests,
    rpc,
    event,
    run: () => reconcileExpiredLaunch({ rpc, policy, prepared, agentKey: key }),
    logs: (items: typeof logs) => {
      logs = items;
    },
    now: (n: number) => {
      now = n;
    },
    reorg: () => {
      reorg = true;
    },
    broken: () => {
      broken = true;
    },
    wrongChain: () => {
      wrongChain = true;
    },
    wrongCode: () => {
      wrongCode = true;
    },
  };
}
test("expired launch absence is proved by bounded public events and a stable confirmed block", async () => {
  const f = fixture();
  f.logs([f.event(200, hash(78))]);
  assert.deepEqual(await f.run(), { status: "expired", blockNumber: "500", blockHash: hash(500) });
  assert.ok(f.requests.length <= 100);
  const external = JSON.stringify(f.requests);
  assert.ok(!external.includes(key));
  assert.ok(!external.includes(f.prepared.unsignedTransaction));
  assert.ok(!external.includes("0x1234"));
  assert.ok(
    f.requests.every(
      (r) => !["eth_call", "eth_sendRawTransaction", "eth_estimateGas"].includes(r.method),
    ),
  );
});
test("an event at the inclusive expiry boundary recovers its exact transaction", async () => {
  const f = fixture();
  f.logs([f.event()]);
  assert.deepEqual(await f.run(), { status: "found", txHash: hash(91) });
});
test("unconfirmed expiry, provider failure, changed chain/code and reorg never prove absence", async () => {
  const pending = fixture();
  pending.now(400);
  assert.equal(await pending.run(), null);
  assert.ok(!pending.requests.some((r) => r.method === "eth_getLogs"));
  for (const failure of ["broken", "wrongChain", "wrongCode", "reorg"] as const) {
    const f = fixture();
    f[failure]();
    await assert.rejects(f.run());
  }
});
test("wrong identity, grant, metadata, creator, duplicate or malformed event cannot release the attempt", async () => {
  for (const kind of [
    "key",
    "deadline",
    "creator",
    "duplicate",
    "malformed",
    "metadata",
    "preset",
    "quote",
  ]) {
    const f = fixture();
    if (kind === "key") {
      f.params.agentKey = hash(99) as Hex;
    }
    if (kind === "deadline") {
      f.params.deadline = 1001n;
    }
    if (["key", "deadline"].includes(kind)) {
      f.prepared.unsignedTransaction = serializeTransaction({
        type: "eip1559",
        chainId: 10143,
        to: f.policy.factory.address as Hex,
        data: encodeFunctionData({
          abi: PicklerLaunchFactoryAbi,
          functionName: "createLaunch",
          args: [f.params, "0x", 1n, 1000n, "0x1234"],
        }),
        nonce: 0,
        gas: 1n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 0n,
      });
    } else if (kind === "creator") {
      f.logs([f.event(400, key, "0x" + "4".repeat(40))]);
    } else if (kind === "duplicate") {
      f.logs([f.event(200), f.event(400)]);
    } else if (["metadata", "preset", "quote"].includes(kind)) {
      const log = f.event();
      log.data = encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
        [
          sender as Hex,
          (kind === "quote" ? "0x" + "9".repeat(40) : f.policy.preset.quoteAddress) as Hex,
          (kind === "preset" ? hash(99) : f.params.expectedConfigHash) as Hex,
          (kind === "metadata" ? hash(99) : f.params.metadataHash) as Hex,
        ],
      );
      f.logs([log]);
    } else {
      const log = f.event();
      log.removed = true;
      f.logs([log]);
    }
    await assert.rejects(f.run());
  }
});
