import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { Pool } from "pg";
import { migrateDatabase } from "../src/persistence/migrate-database.js";
import { PostgresResearchStore } from "../src/persistence/research-store.js";

/** Real PostgreSQL, isolated database per test; never touches existing schemas. */
export async function createTestStore(t: TestContext, leaseClock?: () => number) {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const database = `pickler_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } catch (cause) {
    await admin.end();
    throw new Error(
      "Start PostgreSQL with npm run db:up or set TEST_DATABASE_URL with CREATEDB permission",
      { cause },
    );
  }
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  const store = new PostgresResearchStore(url.toString(), leaseClock);
  const peers: PostgresResearchStore[] = [];
  const connectPeer = () => {
    const peer = new PostgresResearchStore(url.toString(), leaseClock);
    peers.push(peer);
    return peer;
  };
  t.after(async () => {
    await Promise.all(peers.map((peer) => peer.close()));
    await store.close();
    try {
      await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  });
  await migrateDatabase(store.pool);
  await store.init();
  return Object.assign(store, { connectPeer });
}
