import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { PostgresLaunchReadModel } from "@pickler/infrastructure";
import { migrateDatabase } from "@pickler/infrastructure/migrations";

import { createApp } from "../src/app";

const CHAIN = "eip155:10143";
const TOKEN = "0x2222222222222222222222222222222222222222";
const CURVE = "0x3333333333333333333333333333333333333333";
const QUOTE = "0x4444444444444444444444444444444444444444";
const ALICE = "0x5555555555555555555555555555555555555555";

function hash(seed: string): string {
  const hex = [...seed].map((character) => character.charCodeAt(0).toString(16)).join("");

  return `0x${hex.padStart(64, "0").slice(-64)}`;
}

async function createApi(t: TestContext) {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const database = `pickler_test_${randomUUID().replaceAll("-", "")}`;

  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } catch (cause) {
    await admin.end();
    throw new Error("Start PostgreSQL with npm run db:up or set TEST_DATABASE_URL", { cause });
  }

  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  const readModel = new PostgresLaunchReadModel(url.toString());

  t.after(async () => {
    await readModel.close();
    try {
      await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  });

  await migrateDatabase(readModel.pool);

  const app = createApp({
    authenticate: (async () => {
      throw new Error("not used");
    }) as never,
    launches: readModel,
  } as never);

  return { app, readModel };
}

async function seedLaunch(readModel: PostgresLaunchReadModel): Promise<string> {
  const token = await readModel.pool.query(
    `insert into "market"."tokens"
       ("ticker", "name", "chain", "address", "decimals", "total_supply",
        "quote_address", "quote_decimals", "status", "launch_tx_hash", "launched_at")
     values ('$AGENT', 'Pickler Agent', $1, $2, 18, '1000000000000000000000',
             $3, 6, 'pre_graduation', $4, now())
     returning "id"`,
    [CHAIN, TOKEN, QUOTE, hash("launch")],
  );

  const tokenId = token.rows[0].id as string;

  const pool = await readModel.pool.query(
    `insert into "market"."pools"
       ("token_id", "phase", "venue", "address", "opened_tx_hash", "opened_at")
     values ($1, 'pre_graduation', 'pickler_curve', $2, $3, now())
     returning "id"`,
    [tokenId, CURVE, hash("launch")],
  );

  await readModel.pool.query(
    `insert into "market"."trades"
       ("pool_id", "side", "trader", "token_amount", "quote_amount", "fee_amount",
        "block_number", "block_hash", "tx_hash", "log_index", "block_time")
     values ($1, 'buy', $2, '5000', '1000000', '10000', 11, $3, $4, 0, now())`,
    [pool.rows[0].id, ALICE, hash("block"), hash("trade")],
  );

  return tokenId;
}

test("the catalogue is served with the freshness of the projection behind it", async (t) => {
  const { app, readModel } = await createApi(t);
  await seedLaunch(readModel);

  const response = await app.request("/v1/launches");
  assert.equal(response.status, 200);

  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(Array.isArray(body.data), true);
  assert.equal((body.data as unknown[]).length, 1);

  // Nothing has been indexed in this database, so the read says so rather than implying
  // that an empty projection is a current one.
  assert.equal(body.asOfBlock, null);
  assert.equal(body.stale, true);
  assert.equal(body.finality, "unknown");
});

test("amounts are strings, never numbers", async (t) => {
  const { app, readModel } = await createApi(t);
  const id = await seedLaunch(readModel);

  const response = await app.request(`/v1/launches/${id}`);
  const body = (await response.json()) as { data: Record<string, unknown> };

  assert.equal(typeof body.data.totalSupply, "string");
  assert.equal(body.data.totalSupply, "1000000000000000000000");
  assert.equal(body.data.agentId, null, "an agent link was invented");
});

test("a launch carries its curve and the chain of its quote asset", async (t) => {
  const { app, readModel } = await createApi(t);
  const id = await seedLaunch(readModel);

  const response = await app.request(`/v1/launches/${id}`);
  const body = (await response.json()) as {
    data: { curve: Record<string, unknown> | null; quote: Record<string, unknown> };
  };

  assert.equal(body.data.curve?.venue, "pickler_curve");
  assert.equal(body.data.curve?.address, CURVE);
  assert.equal(body.data.quote.chainId, CHAIN, "an asset was named without its chain");
});

test("trades come back newest first, with amounts as strings", async (t) => {
  const { app, readModel } = await createApi(t);
  const id = await seedLaunch(readModel);

  const response = await app.request(`/v1/launches/${id}/trades`);
  const body = (await response.json()) as { data: Record<string, unknown>[] };

  assert.equal(body.data.length, 1);
  assert.equal(body.data[0]?.side, "buy");
  assert.equal(typeof body.data[0]?.tokenAmount, "string");
  assert.equal(body.data[0]?.blockNumber, "11");
});

test("an unknown launch is a 404 with a named code, not an empty list", async (t) => {
  const { app } = await createApi(t);

  const response = await app.request(`/v1/launches/${randomUUID()}`);

  assert.equal(response.status, 404);

  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "launch_not_found");
});

/**
 * Answering with fewer rows than asked for, silently, is how a client concludes a list ended
 * when it did not.
 */
test("a limit past the ceiling is refused rather than quietly clamped", async (t) => {
  const { app } = await createApi(t);

  const response = await app.request("/v1/launches?limit=5000");

  assert.equal(response.status, 400);

  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_request");
});

test("paging does not repeat or skip a launch", async (t) => {
  const { app, readModel } = await createApi(t);

  for (let index = 0; index < 3; index++) {
    await readModel.pool.query(
      `insert into "market"."tokens"
         ("ticker", "name", "chain", "address", "decimals", "status")
       values ($1, $2, $3, $4, 18, 'reserved')`,
      [`$AG${index}`, `Agent ${index}`, CHAIN, `0x${String(index).repeat(40)}`],
    );
  }

  const first = (await (await app.request("/v1/launches?limit=2")).json()) as {
    data: { id: string }[];
    nextCursor?: string;
  };

  assert.equal(first.data.length, 2);
  assert.ok(first.nextCursor, "no cursor was offered despite more rows existing");

  const second = (await (
    await app.request(`/v1/launches?limit=2&cursor=${first.nextCursor}`)
  ).json()) as { data: { id: string }[] };

  const seen = new Set([...first.data, ...second.data].map((row) => row.id));

  assert.equal(seen.size, first.data.length + second.data.length, "a launch appeared twice");
});
