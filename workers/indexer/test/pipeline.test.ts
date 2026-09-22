import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import {
  PicklerLaunchFactoryAbi,
  PicklerBondingCurveAbi,
  PicklerGraduationAdapterV4Abi,
} from "@pickler/chain";
import type { ChainLog, ChainReader } from "@pickler/core";
import {
  migrateDatabase,
  PostgresLaunchIndexStore,
  PostgresLaunchReadModel,
} from "@pickler/infrastructure";
import { runConfiguredPass } from "../src/index.js";

const factory = `0x${"11".repeat(20)}` as const;
const token = `0x${"22".repeat(20)}` as const;
const curve = `0x${"33".repeat(20)}` as const;
const quote = `0x${"44".repeat(20)}` as const;
const adapter = `0x${"55".repeat(20)}` as const;
const hash = `0x${"aa".repeat(32)}` as const;

test("scheduled pipeline indexes same-block curve trades, projects, retries and serves the catalogue", async (t) => {
  const base =
    process.env.TEST_DATABASE_URL ??
    "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
  const admin = new Pool({ connectionString: base });
  const name = `pickler_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create database "${name}"`);
  const url = new URL(base);
  url.pathname = name;
  const store = new PostgresLaunchIndexStore(url.toString());
  t.after(async () => {
    await store.close();
    await admin.query(`drop database "${name}"`);
    await admin.end();
  });
  await migrateDatabase(store.pool);
  const model = new PostgresLaunchReadModel(store.pool);
  const logs: ChainLog[] = [
    {
      chainId: 10143,
      blockNumber: 10n,
      blockHash: hash,
      transactionHash: hash,
      logIndex: 0,
      address: factory,
      removed: false,
      topics: encodeEventTopics({
        abi: PicklerLaunchFactoryAbi,
        eventName: "LaunchCreated",
        args: { token, curve, agentKey: hash },
      }) as `0x${string}`[],
      data: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
        [factory, quote, hash, hash],
      ),
    },
    {
      chainId: 10143,
      blockNumber: 10n,
      blockHash: hash,
      transactionHash: hash,
      logIndex: 1,
      address: curve,
      removed: false,
      topics: encodeEventTopics({
        abi: PicklerBondingCurveAbi,
        eventName: "CurveBought",
        args: { payer: factory, recipient: factory },
      }) as `0x${string}`[],
      data: encodeAbiParameters(
        Array.from({ length: 6 }, () => ({ type: "uint256" })),
        [100n, 99n, 500n, 1n, 99n, 500n],
      ),
    },
  ];
  logs.push(
    {
      ...logs[1]!,
      logIndex: 2,
      topics: encodeEventTopics({
        abi: PicklerBondingCurveAbi,
        eventName: "CurveGraduated",
        args: { adapter },
      }) as `0x${string}`[],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [99n, 500n]),
    },
    {
      ...logs[1]!,
      logIndex: 3,
      address: adapter,
      topics: encodeEventTopics({
        abi: PicklerGraduationAdapterV4Abi,
        eventName: "LaunchGraduated",
        args: { token, curve, poolId: hash },
      }) as `0x${string}`[],
      data: encodeAbiParameters(
        Array.from({ length: 5 }, () => ({ type: "uint256" })),
        [1n, 99n, 500n, 0n, 0n],
      ),
    },
  );
  let failMetadata = true;
  const reader: ChainReader & {
    readLaunchMetadata(): Promise<{
      name: string;
      symbol: string;
      decimals: number;
      totalSupply: bigint;
    }>;
  } = {
    chainId: 10143,
    async getLatestBlock() {
      return this.getBlock(10n);
    },
    async getBlock(number) {
      return { number, hash, parentHash: hash, timestamp: 1700000000n };
    },
    async getLogs(query) {
      return logs.filter((log) => query.addresses?.includes(log.address));
    },
    async call() {
      return "0x";
    },
    async readLaunchMetadata() {
      if (failMetadata) {
        throw new Error("metadata unavailable");
      }
      return { name: "Agent", symbol: "AGENT", decimals: 18, totalSupply: 1000n };
    },
  };
  const config = {
    chainId: 10143,
    chain: "eip155:10143",
    factory,
    deploymentBlock: 10n,
    confirmations: 0n,
    maxBlocks: 100n,
    rpcUrls: [],
  };
  await assert.rejects(runConfiguredPass(config, store, reader), /metadata unavailable/);
  assert.equal((await model.listLaunches({})).data.length, 0);
  failMetadata = false;
  await runConfiguredPass(config, store, reader);
  await runConfiguredPass(config, store, reader);
  const launches = await model.listLaunches({});
  assert.equal(launches.data.length, 1);
  assert.equal(launches.data[0]!.phase, "graduated");
  assert.ok((await model.getLaunch(launches.data[0]!.id))!.data.pool);
  const trades = await model.listTrades(launches.data[0]!.id);
  assert.equal(trades!.data.length, 1);
  assert.equal(trades!.data[0]!.tokenAmount, "500");
});
