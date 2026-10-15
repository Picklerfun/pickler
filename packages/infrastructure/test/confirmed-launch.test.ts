import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  serializeTransaction,
  type Hex,
} from "viem";
import { PicklerLaunchFactoryAbi } from "@pickler/chain";
import {
  createTokenLaunchService,
  createTokenOperationService,
  type TokenIntent,
  type TokenOperationDriver,
} from "@pickler/core";
import { createConfirmedLaunchPublisher } from "../src/launch/confirmed-launch.js";
import { createTokenOperationDriver } from "../src/launch/driver.js";
import { createActivityBuilders } from "../src/turnkey/turnkey-activities.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import { PostgresLaunchProjector } from "../src/persistence/product/launch-projector.js";
import { PostgresAgentDirectory } from "../src/persistence/agent-directory.js";
import { PostgresTokenLaunchStore } from "../src/studio/token-launch-store.js";
import { tokenFixture } from "./token-fixture.js";
import { launchPolicy, deploymentCode } from "./launch-policy-fixture.js";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const TOKEN = `0x${"2".repeat(40)}` as Hex;
const CURVE = `0x${"3".repeat(40)}` as Hex;
const TX = hash(100);
const BLOCK = hash(1000);
const signed = {
  url: "https://api.turnkey.com/public/v1/submit/sign_transaction",
  body: "controlled",
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "controlled" },
};
async function fixture(t: TestContext) {
  const f = await tokenFixture(t);
  await f.service.saveDraft(f.scope, { expectedVersion: 0, name: "Controlled", ticker: "CTRL" });
  const policy = {
    ...launchPolicy(),
    preset: { ...launchPolicy().preset, quoteAddress: f.signer.issuer.preset.quoteAddress },
  };
  const publish = createConfirmedLaunchPublisher(f.store.pool, policy);
  let intent: TokenIntent;
  let reads = 0;
  let signs = 0;
  let sends = 0;
  let reservations = 0;
  let exhausted = false;
  let fail = "";
  let mutate: (() => Promise<void>) | undefined;
  const time = () => BigInt(intent.deadline) - 100n;
  const header = () => ({
    number: "0x3e8",
    hash: BLOCK,
    parentHash: hash(999),
    timestamp: "0x" + time().toString(16),
  });
  function receipt() {
    const p = intent.authorization!.params;
    const topics = encodeEventTopics({
      abi: PicklerLaunchFactoryAbi,
      eventName: "LaunchCreated",
      args: { token: TOKEN, curve: CURVE, agentKey: p.agentKey as Hex },
    });
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
      [
        p.creator as Hex,
        policy.preset.quoteAddress as Hex,
        p.expectedConfigHash as Hex,
        p.metadataHash as Hex,
      ],
    );
    return {
      transactionHash: TX,
      blockHash: BLOCK,
      blockNumber: "0x3e8",
      status: "0x1",
      logs: [
        {
          address: policy.factory.address,
          transactionHash: TX,
          blockHash: BLOCK,
          blockNumber: "0x3e8",
          logIndex: "0x0",
          removed: false,
          topics,
          data,
        },
      ],
    };
  }
  const rpc = {
    async call(method: string, args: unknown[]): Promise<unknown> {
      reads++;
      if (fail === "transport") {
        throw new Error("Controlled transport failure");
      }
      switch (method) {
        case "eth_chainId":
          return fail === "chain" ? "0x8f" : "0x279f";
        case "eth_getCode":
          return fail === "factory" ? "0x6001" : deploymentCode;
        case "eth_getTransactionReceipt": {
          const r = receipt();
          if (fail === "reverted") {
            r.status = "0x0";
          }
          if (fail === "log") {
            r.logs[0]!.data = "0x00";
          }
          if (fail === "foreign_log") {
            r.logs[0]!.address = TOKEN;
          }
          if (fail === "duplicate") {
            r.logs.push(r.logs[0]!);
          }
          if (fail === "removed") {
            r.logs[0]!.removed = true;
          }
          return r;
        }
        case "eth_blockNumber":
          return fail === "depth" ? "0x3e9" : "0x3ea";
        case "eth_getBlockByNumber":
          return fail === "reorg" ? { ...header(), hash: hash(1001) } : header();
        case "eth_getTransactionByHash":
          return {
            hash: TX,
            from: fail === "sender" ? TOKEN : intent.prepared!.sender,
            to: policy.factory.address,
            input: fail === "calldata" ? "0x00" : inputData(),
            value: "0x0",
            blockHash: BLOCK,
            blockNumber: "0x3e8",
          };
        case "eth_call": {
          const data = (args[0] as { data: Hex }).data;
          for (const name of ["name", "symbol", "decimals", "totalSupply"] as const) {
            if (data !== encodeFunctionData({ abi: erc20Abi, functionName: name })) {
              continue;
            }
            if (mutate) {
              const work = mutate;
              mutate = undefined;
              await work();
            }
            const value =
              name === "name"
                ? fail === "metadata"
                  ? "Altered"
                  : intent.authorization!.params.name
                : name === "symbol"
                  ? intent.authorization!.params.symbol
                  : name === "decimals"
                    ? 18
                    : 21000000000000000000000000n;
            return encodeFunctionResult({ abi: erc20Abi, functionName: name, result: value });
          }
          throw new Error("Unexpected metadata query");
        }
        default:
          throw new Error("Unexpected RPC: " + method);
      }
    },
  };
  const publishingDriver = createTokenOperationDriver({
    policy,
    rpc,
    activities: createActivityBuilders(),
    organization: async () => {
      throw new Error("No organization request");
    },
    forwarder: {
      forward: async () => {
        throw new Error("No provider signing");
      },
    },
    reader: {
      getActivity: async () => {
        throw new Error("No provider activity");
      },
    } as Parameters<typeof createTokenOperationDriver>[0]["reader"],
    reserveRpc: async (id, limit) => {
      assert.equal(id, intent.id);
      assert.equal(limit, policy.rpcRequestsPerOperation);
      if (exhausted) {
        throw new Error("TOKEN_RPC_BUDGET_EXHAUSTED");
      }
      reservations++;
    },
    publishLaunch: publish,
  });
  function inputData() {
    const g = intent.authorization!;
    return encodeFunctionData({
      abi: PicklerLaunchFactoryAbi,
      functionName: "createLaunch",
      args: [
        {
          ...g.params,
          agentKey: g.params.agentKey as Hex,
          creator: g.params.creator as Hex,
          creatorFeeRecipient: g.params.creatorFeeRecipient as Hex,
          metadataHash: g.params.metadataHash as Hex,
          expectedConfigHash: g.params.expectedConfigHash as Hex,
          nonce: BigInt(g.params.nonce),
          deadline: BigInt(g.params.deadline),
        },
        "0x",
        BigInt(g.grantNonce),
        BigInt(g.grantDeadline),
        g.signature as Hex,
      ],
    });
  }
  const driver: TokenOperationDriver = {
    ready: true,
    async prepare(_scope, i) {
      intent = i;
      return {
        operationId: i.id,
        chainId: 10143,
        sender: i.context.masterAddress!,
        destination: policy.factory.address,
        unsignedTransaction: serializeTransaction({
          type: "eip1559",
          chainId: 10143,
          to: policy.factory.address as Hex,
          nonce: 0,
          value: 0n,
          data: inputData(),
          gas: 1000000n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
        }),
        transactionNonce: 0,
        gas: "1000000",
        maxFeePerGas: "1",
        maximumGasCost: "1000000",
        deadline: i.deadline,
        activity: { ...signed, organizationId: "controlled", timestampMs: "1" },
      };
    },
    async sign() {
      signs++;
      return { activityId: "controlled", status: "completed", rawTransaction: "0x02aa" };
    },
    async activity() {
      throw new Error("No activity reads");
    },
    async verify() {
      return TX;
    },
    async preflight() {},
    async broadcast() {
      sends++;
      return TX;
    },
    async receipt() {
      return { status: "finalized", blockHash: BLOCK };
    },
    publishLaunch: (s, i) => publishingDriver.publishLaunch!(s, i),
  };
  const ops = createTokenOperationService({
    repository: f.repository,
    tokens: f.service,
    chainId: 10143,
    driver,
  });
  const p = await ops.prepare(
    f.scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_launch_publication",
  );
  await ops.confirm(f.scope, p.operation.id, p.operation.version, signed);
  intent = (
    await f.store.pool.query<{ payload: TokenIntent }>(
      "SELECT payload FROM launch.operations WHERE id=$1",
      [p.operation.id],
    )
  ).rows[0]!.payload;
  const store = new PostgresLaunchIndexStore(f.store.pool);
  await store.applyBatch({
    chain: "eip155:10143",
    contract: policy.factory.address,
    stream: "token-launch-v1",
    confirmed: true,
    blocks: [{ number: 10n, hash: hash(10), parentHash: hash(9), blockTime: new Date() }],
    events: [],
  });
  const directory = new PostgresAgentDirectory(f.store.pool, 10143);
  return {
    ...f,
    ops,
    driver,
    rpc,
    publish,
    directory,
    store,
    policy,
    id: p.operation.id,
    counts: () => ({ reads, signs, sends }),
    reservations: () => reservations,
    exhaust: () => {
      exhausted = true;
    },
    failure: (reason: string) => {
      fail = reason;
    },
    duringRead: (work: () => Promise<void>) => {
      mutate = work;
    },
    async savedIntent() {
      return (
        await f.store.pool.query<{ payload: TokenIntent }>(
          "SELECT payload FROM launch.operations WHERE id=$1",
          [p.operation.id],
        )
      ).rows[0]!.payload;
    },
  };
}

test("an app receipt publishes profile and directory before historical catch-up; repeat/indexer replay is idempotent", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.directory.listDirectory())[0]?.launchedToken, null);

  const status = await f.ops.status(f.scope, f.id);

  assert.equal(status.status, "finalized");
  assert.equal((await f.service.state(f.scope)).confirmation, "confirmed");
  assert.equal((await f.directory.listDirectory())[0]?.launchedToken?.address, TOKEN);
  assert.equal((await f.directory.getPersona(f.handle))?.launchedToken?.address, TOKEN);
  assert.equal(
    (await f.store.readCursor("eip155:10143", f.policy.factory.address, "token-launch-v1"))
      ?.lastBlock,
    10n,
  );
  assert.deepEqual(f.counts(), { reads: 11, signs: 1, sends: 1 });
  assert.equal(f.reservations(), 11, "all publication RPC reads must be admitted before transport");
  await f.ops.status(f.scope, f.id);
  assert.equal(f.counts().reads, 11, "already published status must perform no provider reads");

  const event = (await f.store.pool.query("SELECT * FROM market.chain_events")).rows[0];
  await f.store.applyBatch({
    chain: "eip155:10143",
    contract: f.policy.factory.address,
    stream: "token-launch-v1",
    confirmed: true,
    blocks: [
      {
        number: 1000n,
        hash: BLOCK,
        parentHash: hash(999),
        blockTime: new Date(Number(BigInt((await f.savedIntent()).deadline) - 100n) * 1000),
      },
    ],
    events: [
      {
        blockHash: BLOCK,
        blockNumber: 1000n,
        txHash: TX,
        logIndex: 0,
        emitter: f.policy.factory.address,
        eventName: "LaunchCreated",
        abiHash: event.abi_hash,
        topics: event.topics,
        data: event.data,
        decoded: event.decoded,
      },
    ],
  });
  await new PostgresLaunchProjector(f.store.pool).project("eip155:10143", async () => ({
    name: "Controlled",
    symbol: "CTRL",
    decimals: 18,
    totalSupply: 21000000000000000000000000n,
  }));
  assert.equal((await f.store.pool.query("SELECT count(*) FROM market.tokens")).rows[0].count, "1");
  assert.equal((await f.store.pool.query("SELECT count(*) FROM market.pools")).rows[0].count, "1");
  assert.equal(
    (await f.store.pool.query("SELECT count(*) FROM market.chain_events")).rows[0].count,
    "1",
  );
});

test("earlier finalized app launches are recovered without another signature or submission", async (t) => {
  const f = await fixture(t);
  delete f.driver.publishLaunch;
  assert.equal((await f.ops.status(f.scope, f.id)).status, "finalized");
  assert.equal((await f.service.state(f.scope)).confirmation, "pending");
  f.driver.publishLaunch = (s, i) => f.publish(s, i, f.rpc);

  await f.ops.status(f.scope, f.id);

  assert.equal((await f.directory.listDirectory())[0]?.launchedToken?.address, TOKEN);
  assert.equal(f.counts().signs, 1);
  assert.equal(f.counts().sends, 1);
});

test("transport and invalid canonical evidence preserve the attempt and publish nothing", async (t) => {
  const f = await fixture(t);
  for (const reason of [
    "transport",
    "chain",
    "factory",
    "reverted",
    "depth",
    "reorg",
    "sender",
    "calldata",
    "log",
    "foreign_log",
    "duplicate",
    "removed",
    "metadata",
  ]) {
    f.failure(reason);
    await assert.rejects(f.ops.status(f.scope, f.id), (error) => error instanceof Error, reason);
    assert.equal((await f.savedIntent()).status, "confirming", reason);
    assert.equal((await f.directory.listDirectory())[0]?.launchedToken, null, reason);
    assert.equal(
      (await f.store.pool.query("SELECT count(*) FROM market.chain_events")).rows[0].count,
      "0",
      reason,
    );
  }
  assert.equal(f.counts().signs, 1);
  assert.equal(f.counts().sends, 1);
});

test("concurrent publication is idempotent and another owner cannot trigger it", async (t) => {
  const f = await fixture(t);
  const i = await f.savedIntent();
  await Promise.all([f.publish(f.scope, i, f.rpc), f.publish(f.scope, i, f.rpc)]);
  assert.equal((await f.store.pool.query("SELECT count(*) FROM market.tokens")).rows[0].count, "1");
  await assert.rejects(f.ops.status({ ...f.scope, userId: randomUUID() }, f.id));
});

test("owner or grant changes during RPC prevent publication; provider work holds no database locks", async (t) => {
  const f = await fixture(t);
  f.duringRead(async () => {
    await f.store.pool.query("DELETE FROM launch.grants WHERE agent_id=$1", [f.scope.agentId]);
  });
  await assert.rejects(f.ops.status(f.scope, f.id), /CONFIRMED_LAUNCH_NOT_REGISTERED/);
  assert.equal(
    (await f.store.pool.query("SELECT count(*) FROM market.chain_events")).rows[0].count,
    "0",
  );
});

test("historical catch-up hides a reorged sparse receipt without skipping or advancing other streams", async (t) => {
  const f = await fixture(t);
  await f.ops.status(f.scope, f.id);
  await f.store.applyBatch({
    chain: "eip155:10143",
    contract: f.policy.factory.address,
    stream: "token-launch-v1",
    confirmed: true,
    blocks: [{ number: 1000n, hash: hash(1001), parentHash: hash(999), blockTime: new Date() }],
    events: [],
  });
  assert.equal((await f.directory.listDirectory())[0]?.launchedToken, null);
  assert.equal(
    (await f.store.pool.query("SELECT orphaned FROM market.chain_events")).rows[0].orphaned,
    true,
  );
  await f.store.rollbackFrom("eip155:10143", f.policy.factory.address, "token-launch-v1", 10n);
  assert.equal(
    (await f.store.readCursor("eip155:10143", f.policy.factory.address, "token-launch-v1"))
      ?.lastBlock,
    10n,
  );
});

test("ownership loss during evidence reads is fenced before publication", async (t) => {
  const f = await fixture(t);
  f.duringRead(async () => {
    await f.store.pool.query("UPDATE identity.workspaces SET is_active=false WHERE id=$1", [
      f.scope.workspaceId,
    ]);
  });
  await assert.rejects(f.ops.status(f.scope, f.id), /TOKEN_OWNER_REQUIRED/);
  assert.equal(
    (await f.store.pool.query("SELECT count(*) FROM market.chain_events")).rows[0].count,
    "0",
  );
});

test("an altered recorded grant is rejected before any provider read", async (t) => {
  const f = await fixture(t);
  const changed = structuredClone(await f.savedIntent());
  changed.authorization!.params.name = "Altered";
  await assert.rejects(f.publish(f.scope, changed, f.rpc), /CONFIRMED_GRANT_MISMATCH/);
  assert.equal(f.counts().reads, 0);
  assert.equal(
    (await f.store.pool.query("SELECT count(*) FROM market.chain_events")).rows[0].count,
    "0",
  );
});

test("publication cannot exceed the existing operation RPC budget", async (t) => {
  const f = await fixture(t);
  f.exhaust();
  await assert.rejects(f.ops.status(f.scope, f.id), /RPC_BUDGET_EXHAUSTED/);
  assert.equal(f.counts().reads, 0);
  assert.equal((await f.savedIntent()).status, "confirming");
  assert.equal((await f.directory.listDirectory())[0]?.launchedToken, null);
});

test("published owner state preserves the fee cursor as a wire-safe number with the operational escrow configured", async (t) => {
  const f = await fixture(t);
  await f.ops.status(f.scope, f.id);
  await f.store.applyBatch({
    chain: "eip155:10143",
    contract: f.policy.escrow.address,
    stream: "token-launch-v1",
    confirmed: true,
    blocks: [{ number: 10n, hash: hash(10), parentHash: hash(9), blockTime: new Date() }],
    events: [],
  });
  const repository = new PostgresTokenLaunchStore(
    f.store.pool,
    f.policy.escrow.address,
    f.policy.preset.quoteAddress,
  );
  const service = createTokenLaunchService({ repository, chainId: 10143 });

  const state = await service.state(f.scope);

  assert.equal(state.confirmation, "confirmed");
  assert.equal(state.token?.address, TOKEN);
  assert.deepEqual(state.fees, { ausd: "0", agent: "0", block: 10, scope: "master_wallet" });
  assert.equal(f.counts().reads, 11, "owner state is database-only after publication");

  await f.store.pool.query(
    "UPDATE market.indexer_cursors SET last_block=$1 WHERE chain=$2 AND contract=$3",
    ["3000000000", "eip155:10143", f.policy.escrow.address],
  );
  assert.equal((await service.state(f.scope)).fees?.block, 3000000000);

  await f.store.pool.query(
    "UPDATE market.indexer_cursors SET last_block=$1 WHERE chain=$2 AND contract=$3",
    ["9007199254740992", "eip155:10143", f.policy.escrow.address],
  );
  await assert.rejects(service.state(f.scope), /INVALID_TOKEN_FEE_BLOCK/);
  assert.equal(f.counts().reads, 11, "unsafe database heights do not trigger provider work");
});
