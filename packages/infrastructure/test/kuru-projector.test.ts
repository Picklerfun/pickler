import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTokenLaunchService } from "@pickler/core";
import { tokenFixture, controlledMaster } from "./token-fixture.js";
import { launchPolicy, launchKey, metadataBucket } from "./launch-policy-fixture.js";
import { createTokenMetadata } from "../src/launch/metadata.js";
import { createPlatformTokenIssuer } from "../src/launch/grant-issuer.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import { PostgresLaunchProjector } from "../src/persistence/product/launch-projector.js";
import { PostgresKuruProjector, type KuruPositionSnapshot } from "../src/launch/kuru-projector.js";
const chain = "eip155:10143";
const address = (s: string) => "0x" + s.repeat(40);
const hash = (s: string) => "0x" + s.repeat(64);

test("canonical Kuru snapshots survive replay, orphaning and branch restoration without repeated RPC", async (t) => {
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
  const grant = await service.authorize(f.scope, 1, "controlled_kuru_launch_001");
  const index = new PostgresLaunchIndexStore(f.store.pool.options.connectionString!);
  const projector = new PostgresLaunchProjector(f.store.pool);
  const kuru = new PostgresKuruProjector(f.store.pool, policy);
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
      vault = address("b"),
      market = address("c");
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
      eventName: "LaunchGraduatedKuru",
      abiHash: hash("a").slice(2),
      topics: [],
      data: "0x",
      decoded: {
        token,
        curve,
        market,
        vault,
        accountId: "1",
        venueHash: policy.approvedVenueConfigHash,
        tokensReserved: "4199999999999999999999999",
        quoteReserved: "31999999997",
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
    const read = async (): Promise<KuruPositionSnapshot> => {
      reads++;
      return {
        owner: vault,
        market,
        baseToken: token,
        quoteToken: policy.preset.quoteAddress,
        accountId: "1",
        positions: [{ id: "7", owner: "1", low: 2, high: 3, shares: "10" }],
        tokenReserved: graduation.decoded.tokensReserved,
        quoteReserved: graduation.decoded.quoteReserved,
      };
    };
    await projector.project(chain, metadata);
    assert.equal((await service.state(f.scope)).token?.imageUri, grant.imageUri);
    await kuru.project(read);
    assert.equal(
      (await f.store.pool.query("SELECT status FROM market.tokens")).rows[0].status,
      "graduated",
    );
    await projector.project(chain, metadata);
    await kuru.project(read);
    assert.equal(reads, 1);
    assert.equal(
      (await f.store.pool.query("SELECT status FROM market.tokens")).rows[0].status,
      "graduated",
    );
    assert.equal((await service.state(f.scope)).venue?.market, market);
    await index.rollbackFrom(chain, policy.factory.address, "token-launch-v1", 10n);
    await projector.project(chain, metadata);
    await kuru.project(read);
    assert.equal((await service.state(f.scope)).venue?.status, "curve");
    assert.equal(
      (await f.store.pool.query("SELECT 1 FROM market.pools WHERE venue='kuru_passive'")).rowCount,
      0,
    );
    assert.equal((await f.store.pool.query("SELECT 1 FROM market.kuru_graduations")).rowCount, 1);
    await index.applyBatch(batch);
    await projector.project(chain, metadata);
    await kuru.project(read);
    assert.equal((await service.state(f.scope)).venue?.status, "kuru");
    assert.equal(reads, 1);
  } finally {
    await index.close();
  }
});
test("Kuru cleanup cannot mutate under a lost lease, even with no graduation rows", async (t) => {
  const f = await tokenFixture(t),
    owner = randomUUID();
  await f.store.pool.query(
    "INSERT INTO launch.indexer_admission(chain,owner,expires_at,day,requests) VALUES($1,$2,now()-interval '1 second','2026-10-09',0)",
    [chain, owner],
  );
  const kuru = new PostgresKuruProjector(f.store.pool, launchPolicy(), { chain, owner });
  let reads = 0;
  await assert.rejects(
    kuru.project(async () => {
      reads++;
      throw new Error("No RPC");
    }),
    /INDEX_LEASE_LOST/,
  );
  assert.equal(reads, 0);
});
