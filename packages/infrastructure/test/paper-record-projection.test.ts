import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { recordStats } from "@pickler/trading/perps";
import { createTestStore } from "./database.js";
import {
  recordMovement,
  recordEpoch,
  recordClosedPosition,
  advanceRecordProjection,
  readRecordProjection,
} from "../src/persistence/paper-record-projection.js";

const AT = Date.UTC(2026, 9, 15, 12, 30);
async function transaction<T>(pool: Pool, action: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await action(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
async function account(pool: Pool) {
  await pool.query(`INSERT INTO pickler.perps_paper_accounts(id,tenant_id,agent_id,session_id,network,document)
    VALUES('record','alpha','pickle-alpha','record','testnet','{}')`);
}

test("record checkpoints preserve grouped drawdown, exact totals, closes and epoch visibility", async (t) => {
  const store = await createTestStore(t);
  await account(store.pool);
  const facts: Array<{
    key: string;
    kind: "initial" | "fee" | "realized-pnl" | "funding";
    delta: string;
    at: number;
  }> = [
    { key: "initial", kind: "initial", delta: "100", at: AT },
    { key: "fee", kind: "fee", delta: "-5", at: AT + 1000 },
    { key: "gain", kind: "realized-pnl", delta: "25", at: AT + 1000 },
    { key: "loss", kind: "realized-pnl", delta: "-30", at: AT + 3600000 },
  ];
  for (const fact of facts) {
    await transaction(store.pool, (db) => recordMovement(db, "record", fact));
  }
  await transaction(store.pool, (db) => recordEpoch(db, "record", "epoch", AT + 3600001, "-2"));
  await transaction(store.pool, (db) => recordEpoch(db, "record", "epoch", AT + 3600001, "-2"));
  await transaction(store.pool, (db) => recordClosedPosition(db, "record", "closed", "-1"));
  await transaction(store.pool, (db) => recordClosedPosition(db, "record", "closed", "1"));
  const expected = recordStats({
    movements: [...facts, { kind: "funding", delta: "-2", at: AT + 3600001 }],
    closed: [{ closedAt: AT + 3600000, pnl: 1 }],
    openPnl: -1,
    checks: 0,
    entries: 0,
    now: AT + 7200000,
  });
  const actual = await readRecordProjection(store.pool, "record", AT + 7200000, "-1");
  for (const field of [
    "cashAusd",
    "realizedAusd",
    "feesAndFundingAusd",
    "maxDrawdownAusd",
    "maxDrawdownPct",
    "closedCount",
    "wins",
    "hitRate",
    "equityAusd",
  ] as const) {
    assert.equal(actual[field], expected[field], field);
  }
  assert.equal(actual.projection.complete, true);
  assert.equal(actual.series.at(-1)!.equity, expected.series.at(-1)!.equity);
  assert.ok(actual.series.every((p) => p.at % 3600000 === 0 || p.at === AT + 7200000));
});

test("a fixed rebuild watermark survives new arrivals and equal timestamps across pages", async (t) => {
  const store = await createTestStore(t);
  await account(store.pool);
  await transaction(store.pool, (db) =>
    recordMovement(db, "record", { key: "initial", kind: "initial", delta: "100", at: AT }),
  );
  // An earlier fact invalidates the checkpoint; its whole timestamp group spans multiple pages.
  for (let i = 0; i < 125; i++) {
    await transaction(store.pool, (db) =>
      recordMovement(db, "record", {
        key: `late-${String(i).padStart(3, "0")}`,
        kind: "funding",
        delta: i < 50 ? "-1" : i < 100 ? "1" : "0",
        at: AT - 1000,
      }),
    );
  }
  assert.equal(
    (await readRecordProjection(store.pool, "record", AT, "0")).projection.complete,
    false,
  );
  assert.equal(await transaction(store.pool, (db) => advanceRecordProjection(db, "record")), false);
  const phase = (
    await store.pool.query(
      "SELECT document->'rebuild' AS phase FROM pickler.paper_record_state WHERE account_id='record'",
    )
  ).rows[0].phase;
  await transaction(store.pool, (db) =>
    recordMovement(db, "record", { key: "arrived", kind: "fee", delta: "-1", at: AT + 1 }),
  );
  await transaction(store.pool, (db) => advanceRecordProjection(db, "record"));
  const after = (
    await store.pool.query(
      "SELECT document->'rebuild' AS phase FROM pickler.paper_record_state WHERE account_id='record'",
    )
  ).rows[0].phase;
  assert.equal(after, null);
  assert.equal(typeof phase.max, "string");
  await transaction(store.pool, (db) => advanceRecordProjection(db, "record"));
  const result = await readRecordProjection(store.pool, "record", AT + 1000, "0");
  assert.equal(result.projection.complete, true);
  assert.equal(result.cashAusd, 99);
  assert.equal(result.maxDrawdownAusd, 1);
});

test("100000 historical facts never enter the point read and rebuild work is capped at 100", async (t) => {
  const store = await createTestStore(t);
  await account(store.pool);
  await transaction(store.pool, (db) =>
    recordMovement(db, "record", { key: "initial", kind: "initial", delta: "100", at: AT }),
  );
  await store.pool.query(
    `INSERT INTO pickler.paper_record_facts(account_id,key,at,kind,delta)
    SELECT 'record','fact-' || lpad(i::text,6,'0'),$1::bigint+i,'funding','0' FROM generate_series(1,100000) i`,
    [AT],
  );
  let passes = 0;
  while (!(await transaction(store.pool, (db) => advanceRecordProjection(db, "record")))) {
    passes++;
    assert.ok(passes <= 1000);
  }
  assert.equal(passes, 999);
  const calls: string[] = [];
  const client = await store.pool.connect();
  const original = client.query.bind(client);
  client.query = ((...args: unknown[]) => {
    calls.push(String(args[0]));
    return Reflect.apply(original, client, args);
  }) as typeof client.query;
  try {
    const result = await readRecordProjection(client, "record", AT + 3600000, "0");
    assert.equal(result.cashAusd, 100);
    assert.equal(result.projection.complete, true);
    assert.ok(result.series.length <= 721);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0]!, /paper_record_facts|perps_paper_movements/);
  } finally {
    client.query = original as typeof client.query;
    client.release();
  }
});

test("a failed financial transaction cannot publish its checkpoint or consume idempotency", async (t) => {
  const store = await createTestStore(t);
  await account(store.pool);
  await assert.rejects(
    transaction(store.pool, async (db) => {
      await recordMovement(db, "record", { key: "initial", kind: "initial", delta: "100", at: AT });
      throw new Error("controlled rollback");
    }),
    /controlled rollback/,
  );
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM pickler.paper_record_facts")).rows[0].n,
    0,
  );
  await transaction(store.pool, (db) =>
    recordMovement(db, "record", { key: "initial", kind: "initial", delta: "100", at: AT }),
  );
  assert.equal((await readRecordProjection(store.pool, "record", AT, "0")).cashAusd, 100);
});
