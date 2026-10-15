import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { randomUUID } from "node:crypto";
import { createTokenLaunchService } from "@pickler/core";
import { tokenFixture, controlledMaster } from "./token-fixture.js";
import {
  uniswapLaunchPolicy as launchPolicy,
  launchKey,
  metadataBucket,
} from "./launch-policy-fixture.js";
import { createTokenMetadata } from "../src/launch/metadata.js";
import { createPlatformTokenIssuer } from "../src/launch/grant-issuer.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import { PostgresLaunchProjector } from "../src/persistence/product/launch-projector.js";
import {
  PostgresUniswapProjector,
  validateUniswapSnapshot,
  type UniswapPositionSnapshot,
} from "../src/launch/uniswap-projector.js";
const chain = "eip155:10143";
const address = (s: string) => "0x" + s.repeat(40);
const hash = (s: string) => "0x" + s.repeat(64);

test("canonical Uniswap snapshots survive replay, orphaning and branch restoration without repeated RPC", async (t) => {
  const f = await tokenFixture(t);
  const policy = { ...launchPolicy(), allowedAgents: [f.scope.agentId] };
  const issuer = createPlatformTokenIssuer(
    policy,
    launchKey,
    createTokenMetadata(metadataBucket(), policy.metadataOrigin),
    async () => {},
  );
  const service = createTokenLaunchService({ repository: f.repository, chainId: 10143, issuer });
  await service.saveDraft(f.scope, { expectedVersion: 0, name: "Frozen", ticker: "FRZN" });
  const grant = await service.authorize(f.scope, 1, "controlled_v4_launch_001");
  const index = new PostgresLaunchIndexStore(f.store.pool.options.connectionString!);
  const projector = new PostgresLaunchProjector(f.store.pool);
  const uniswap = new PostgresUniswapProjector(f.store.pool, policy);
  try {
    const time = (
      await f.store.pool.query("SELECT date_trunc('second',created_at) AS time FROM launch.grants")
    ).rows[0].time as Date;
    const block = (n: bigint, s: string, parent: string) => ({
      number: n,
      hash: hash(s),
      parentHash: hash(parent),
      blockTime: time,
    });
    const token = address("a"),
      curve = address("9"),
      market = policy.poolManager.address;
    const poolId = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
        [policy.preset.quoteAddress as Hex, token as Hex, 10000, 200, address("0") as Hex],
      ),
    );
    const launch = {
      blockHash: hash("d"),
      blockNumber: 10n,
      txHash: hash("1"),
      logIndex: 0,
      emitter: policy.factory.address,
      eventName: "LaunchCreated",
      abiHash: hash("a").slice(2),
      topics: [],
      data: "0x",
      decoded: {
        token,
        curve,
        agentKey: grant.params.agentKey,
        creator: controlledMaster,
        quoteToken: policy.preset.quoteAddress,
        presetHash: policy.preset.configHash,
        metadataHash: grant.params.metadataHash,
      },
    };
    const graduation = {
      blockHash: hash("e"),
      blockNumber: 11n,
      txHash: hash("2"),
      logIndex: 0,
      emitter: policy.adapter.address,
      eventName: "LaunchGraduatedV4V2",
      abiHash: hash("a").slice(2),
      topics: [],
      data: "0x",
      decoded: {
        token,
        curve,
        poolId,
        tokenId: "7",
        venueHash: policy.approvedVenueConfigHash,
        tokenUsed: "4199999999999999999999999",
        quoteUsed: "31999999997",
        tokenRemainder: "1",
        quoteRemainder: "1",
        tokensReleased: policy.preset.lpAllocation,
        quoteReleased: "31999999998",
      },
    };
    const batch = {
      chain,
      contract: policy.factory.address,
      stream: "token-launch-v1",
      confirmed: true,
      blocks: [block(10n, "d", "0"), block(11n, "e", "d")],
      events: [launch, graduation],
    };
    await index.applyBatch(batch);
    const metadata = async () => ({
      name: "Frozen",
      symbol: "FRZN",
      decimals: 18,
      totalSupply: BigInt(policy.preset.totalSupply),
    });
    let reads = 0;
    const read = async (): Promise<UniswapPositionSnapshot> => {
      reads++;
      return {
        owner: policy.locker.address,
        poolId,
        positionId: "7",
        liquidity: "10",
        lockedLiquidity: "10",
        poolKey: {
          currency0: policy.preset.quoteAddress,
          currency1: token,
          fee: 10000,
          tickSpacing: 200,
          hooks: address("0"),
        },
        tokenRemainder: "1",
        quoteRemainder: "1",
      };
    };
    await projector.project(chain, metadata);
    assert.equal((await service.state(f.scope)).token?.imageUri, grant.imageUri);
    await uniswap.project(read);
    assert.equal(
      (await f.store.pool.query("SELECT status FROM market.tokens")).rows[0].status,
      "graduated",
    );
    await projector.project(chain, metadata);
    await uniswap.project(read);
    assert.equal(reads, 1);
    assert.equal(
      (await f.store.pool.query("SELECT status FROM market.tokens")).rows[0].status,
      "graduated",
    );
    assert.equal((await service.state(f.scope)).venue?.market, market);
    await index.rollbackFrom(chain, policy.factory.address, "token-launch-v1", 10n);
    await projector.project(chain, metadata);
    await uniswap.project(read);
    assert.equal((await service.state(f.scope)).venue?.status, "curve");
    assert.equal(
      (await f.store.pool.query("SELECT 1 FROM market.pools WHERE venue='uniswap_v4'")).rowCount,
      0,
    );
    assert.equal(
      (await f.store.pool.query("SELECT 1 FROM market.uniswap_graduations")).rowCount,
      1,
    );
    await index.applyBatch(batch);
    await projector.project(chain, metadata);
    await uniswap.project(read);
    assert.equal((await service.state(f.scope)).venue?.status, "uniswap_v4");
    assert.equal(reads, 1);
  } finally {
    await index.close();
  }
});
test("Uniswap cleanup cannot mutate under a lost lease, even with no graduation rows", async (t) => {
  const f = await tokenFixture(t),
    owner = randomUUID();
  await f.store.pool.query(
    "INSERT INTO launch.indexer_admission(chain,owner,expires_at,day,requests) VALUES($1,$2,now()-interval '1 second','2026-10-09',0)",
    [chain, owner],
  );
  const uniswap = new PostgresUniswapProjector(f.store.pool, launchPolicy(), { chain, owner });
  let reads = 0;
  await assert.rejects(
    uniswap.project(async () => {
      reads++;
      throw new Error("No RPC");
    }),
    /INDEX_LEASE_LOST/,
  );
  assert.equal(reads, 0);
});

test("projection refuses foreign custody, changed liquidity, pool identity and fabricated backing", () => {
  const policy = launchPolicy();
  const token = address("b");
  const poolKey = {
    currency0: policy.preset.quoteAddress,
    currency1: token,
    fee: 10000,
    tickSpacing: 200,
    hooks: address("0"),
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
      [poolKey.currency0 as Hex, poolKey.currency1 as Hex, 10000, 200, poolKey.hooks as Hex],
    ),
  );
  const event = {
    token,
    poolId,
    tokenId: "7",
    tokenUsed: "9",
    quoteUsed: "19",
    tokensReleased: "10",
    quoteReleased: "20",
    tokenRemainder: "1",
    quoteRemainder: "1",
  };
  const snapshot: UniswapPositionSnapshot = {
    owner: policy.locker.address,
    poolId,
    positionId: "7",
    liquidity: "100",
    lockedLiquidity: "100",
    tokenRemainder: "1",
    quoteRemainder: "1",
    poolKey,
  };
  validateUniswapSnapshot(event, snapshot, policy);

  for (const changed of [
    { ...snapshot, owner: token },
    { ...snapshot, positionId: "8" },
    { ...snapshot, liquidity: "99" },
    { ...snapshot, liquidity: "0", lockedLiquidity: "0" },
    { ...snapshot, quoteRemainder: "2" },
    { ...snapshot, poolKey: { ...poolKey, hooks: token } },
    { ...snapshot, poolKey: { ...poolKey, currency1: address("c") } },
    { ...snapshot, poolKey: { ...poolKey, fee: 3000 } },
  ]) {
    assert.throws(() => validateUniswapSnapshot(event, changed, policy));
  }
  for (const changed of [
    { ...event, quoteReleased: "21" },
    { ...event, tokensReleased: "11" },
    { ...event, quoteUsed: "0" },
    { ...event, quoteRemainder: "-1" },
  ]) {
    assert.throws(() => validateUniswapSnapshot(changed, snapshot, policy));
  }
});
