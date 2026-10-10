import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  type Abi,
  type Hex,
} from "viem";
import {
  PicklerLaunchFactoryAbi,
  PicklerGraduationAdapterV4V2Abi,
  PicklerLiquidityLockerV2Abi,
  IUniswapV4ReadAbi,
} from "@pickler/chain";
import { createTokenLaunchService } from "@pickler/core";
import { tokenFixture, controlledMaster } from "./token-fixture.js";
import {
  uniswapLaunchPolicy,
  launchKey,
  metadataBucket,
  deploymentCode,
} from "./launch-policy-fixture.js";
import { createPlatformTokenIssuer } from "../src/launch/grant-issuer.js";
import { createTokenMetadata } from "../src/launch/metadata.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import { runTokenIndexer } from "../src/launch/indexer.js";

const hash = (n: bigint) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;

test("V4 indexer reads canonical deployed-position metadata at the event block and exposes the locked venue", async (t) => {
  const f = await tokenFixture(t);
  const p = { ...uniswapLaunchPolicy(), allowedAgents: [f.scope.agentId] };
  const tokens = createTokenLaunchService({
    repository: f.repository,
    chainId: 10143,
    issuer: createPlatformTokenIssuer(
      p,
      launchKey,
      createTokenMetadata(metadataBucket(), p.metadataOrigin),
      async () => {},
    ),
  });
  await tokens.saveDraft(f.scope, { expectedVersion: 0, name: "Indexed", ticker: "INDX" });
  const grant = await tokens.authorize(f.scope, 1, "controlled_uniswap_index_001");
  const time = BigInt(
    Math.floor(
      new Date(
        (await f.store.pool.query("SELECT created_at FROM launch.grants")).rows[0].created_at,
      ).getTime() / 1000,
    ),
  );
  const token = ("0x" + "b".repeat(40)) as Hex;
  const curve = ("0x" + "d".repeat(40)) as Hex;
  const key = {
    currency0: p.preset.quoteAddress as Hex,
    currency1: token,
    fee: 10000,
    tickSpacing: 200,
    hooks: ("0x" + "0".repeat(40)) as Hex,
  };
  const poolId = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      Object.values(key) as [Hex, Hex, number, number, Hex],
    ),
  );
  const factoryData = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [
      controlledMaster as Hex,
      p.preset.quoteAddress as Hex,
      p.preset.configHash as Hex,
      grant.params.metadataHash as Hex,
    ],
  );
  const gradData = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bytes32" },
      ...Array.from({ length: 6 }, () => ({ type: "uint256" })),
    ],
    [
      7n,
      p.approvedVenueConfigHash as Hex,
      31999999998n,
      BigInt(p.preset.lpAllocation),
      31999999997n,
      BigInt(p.preset.lpAllocation) - 1n,
      1n,
      1n,
    ],
  );
  const log = (n: bigint, emitter: string, data: Hex, topics: Hex[]) => ({
    address: emitter,
    blockHash: hash(n),
    blockNumber: "0x" + n.toString(16),
    transactionHash: hash(n + 100n),
    logIndex: "0x0",
    data,
    topics,
    removed: false,
  });
  const logs = [
    log(
      10n,
      p.factory.address,
      factoryData,
      encodeEventTopics({
        abi: PicklerLaunchFactoryAbi,
        eventName: "LaunchCreated",
        args: { token, curve, agentKey: grant.params.agentKey as Hex },
      }) as Hex[],
    ),
    log(
      12n,
      p.adapter.address,
      gradData,
      encodeEventTopics({
        abi: PicklerGraduationAdapterV4V2Abi,
        eventName: "LaunchGraduatedV4V2",
        args: { token, curve, poolId },
      }) as Hex[],
    ),
  ];
  const erc = parseAbi([
    "function name() view returns(string)",
    "function symbol() view returns(string)",
    "function decimals() view returns(uint8)",
    "function totalSupply() view returns(uint256)",
  ]);
  const store = new PostgresLaunchIndexStore(f.store.pool.options.connectionString!);
  let calls = 0;
  const positionReads: string[] = [];
  const rpc = {
    async call(method: string, params: unknown[]) {
      const ordinal = ++calls;
      assert.ok(
        (await store.pool.query("SELECT requests FROM launch.indexer_admission")).rows[0]
          .requests >= ordinal,
      );
      if (method === "eth_chainId") {
        return "0x279f";
      }
      if (method === "eth_getCode") {
        return deploymentCode;
      }
      if (method === "eth_getStorageAt") {
        return "0x" + "0".repeat(24) + p.quote.implementation!.address.slice(2);
      }
      if (method === "eth_getBlockByNumber") {
        const n = params[0] === "latest" ? 20n : BigInt(String(params[0]));
        return {
          number: "0x" + n.toString(16),
          hash: hash(n),
          parentHash: hash(n - 1n),
          timestamp: "0x" + (time + n - 10n).toString(16),
        };
      }
      if (method === "eth_getLogs") {
        const q = params[0] as { fromBlock: string; toBlock: string; address: string[] };
        assert.ok(BigInt(q.toBlock) - BigInt(q.fromBlock) < 100n);
        return logs.filter(
          (l) =>
            q.address.includes(l.address) &&
            BigInt(l.blockNumber) >= BigInt(q.fromBlock) &&
            BigInt(l.blockNumber) <= BigInt(q.toBlock),
        );
      }
      if (method === "eth_call") {
        const q = params[0] as { to: string; data: Hex };
        let abi: Abi = erc;
        if (q.to === p.locker.address) {
          abi = PicklerLiquidityLockerV2Abi;
        }
        if (q.to === p.positionManager.address) {
          abi = IUniswapV4ReadAbi;
        }
        const decoded = decodeFunctionData({ abi, data: q.data });
        const values: Record<string, unknown> = {
          name: "Indexed",
          symbol: "INDX",
          decimals: 18,
          totalSupply: BigInt(p.preset.totalSupply),
          getLockedPosition: {
            tokenId: 7n,
            poolKey: key,
            liquidity: 10n,
            tokenRemainder: 1n,
            quoteRemainder: 1n,
            lockedAtBlock: 12n,
          },
          ownerOf: p.locker.address,
          getPositionLiquidity: 10n,
          getPoolAndPositionInfo: [key, 0n],
        };
        if (q.to === p.locker.address || q.to === p.positionManager.address) {
          assert.equal(params[1], "0xc");
          positionReads.push(decoded.functionName);
        }
        return encodeFunctionResult({
          abi,
          functionName: decoded.functionName,
          result: values[decoded.functionName],
        });
      }
      throw Error("Unexpected controlled RPC " + method);
    },
  };
  const input = {
    store,
    rpc,
    launchPolicy: JSON.stringify(p),
    indexerPolicy: JSON.stringify({
      version: 1,
      maxBlocks: 100,
      rpcRequestsPerPass: 400,
      rpcRequestsPerDay: 1000,
      leaseSeconds: 30,
      maxCurvesPerPass: 10,
    }),
  };
  try {
    assert.equal((await runTokenIndexer(input)).kind, "completed");
    const state = await tokens.state(f.scope);
    assert.equal(state.token?.address, token);
    assert.equal(state.venue?.status, "uniswap_v4");
    assert.equal(state.venue?.vault, p.locker.address);
    assert.equal(state.venue?.poolId, poolId);
    assert.equal(state.venue?.lpFeeBps, 100);
    assert.equal(state.venue?.liquidityLocked, true);
    assert.deepEqual(
      positionReads.sort(),
      ["getLockedPosition", "getPoolAndPositionInfo", "getPositionLiquidity", "ownerOf"].sort(),
    );
    await runTokenIndexer(input);
    assert.equal(positionReads.length, 4, "Replay repeated remote position reads");
    assert.equal(
      (await store.pool.query("SELECT count(*) FROM market.uniswap_graduations")).rows[0].count,
      "1",
    );
    assert.ok(
      (
        await store.pool.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='market.uniswap_graduations'::regclass",
        )
      ).rows[0].relrowsecurity,
    );
  } finally {
    await store.close();
  }
});
