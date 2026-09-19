import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createBudgetLedger } from "@pickler/core";
import {
  createSqlLedgerStore,
  migrateLedger,
  type SqlExec,
} from "../src/budget/sql-ledger-store.js";

/** Adapts node:sqlite to the SqlStorage.exec(...).toArray() shape Durable Objects expose. */
function sqlite(): SqlExec & { transaction<T>(fn: () => T): T } {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      const isRead = /^\s*(SELECT|PRAGMA)/i.test(query);
      return {
        toArray: () =>
          isRead
            ? (statement.all(...bindings) as Record<string, unknown>[])
            : (statement.run(...bindings), []),
      };
    },
    transaction(fn) {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("the SQLite store round-trips bigint amounts, reservations, dedupe keys and status", () => {
  const sql = sqlite();
  migrateLedger(sql);
  migrateLedger(sql); // idempotent
  const store = createSqlLedgerStore(sql);
  const now = new Date("2026-09-16T12:00:00Z");
  const huge = 9_000_000_000_000_000_001n; // beyond Number.MAX_SAFE_INTEGER

  store.putCategory({
    category: "payments",
    limit: huge,
    spent: 5n,
    reserved: 7n,
    periodKey: "2026-09",
    spendGeneration: 0,
  });
  assert.deepEqual(store.getCategory("payments"), {
    category: "payments",
    limit: huge,
    spent: 5n,
    reserved: 7n,
    periodKey: "2026-09",
    spendGeneration: 0,
  });
  assert.equal(store.getCategory("tokens"), null);

  store.putReservation({
    id: "r1",
    category: "payments",
    amount: 7n,
    state: "held",
    source: "x402",
    sourceRef: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 1000),
  });
  store.putReservation({
    id: "r1",
    category: "payments",
    amount: 7n,
    state: "committed",
    source: "x402",
    sourceRef: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 1000),
  });
  assert.equal(store.getReservation("r1")?.state, "committed");
  assert.equal(store.heldReservations().length, 0);

  assert.equal(store.markProcessed("record:e1", now), true);
  assert.equal(store.markProcessed("record:e1", now), false);
  assert.equal(store.getStatus(), null);
  store.setStatus("paused");
  store.setStatus("killed");
  assert.equal(store.getStatus(), "killed");
});

test("the ledger on SQLite rolls back a failed operation", () => {
  const sql = sqlite();
  migrateLedger(sql);
  const ledger = createBudgetLedger(
    createSqlLedgerStore(sql),
    () => new Date("2026-09-16T12:00:00Z"),
  );
  sql.transaction(() =>
    ledger.hydrate([{ category: "payments", limit: "100", spent: "0" }], "active"),
  );
  sql.transaction(() =>
    ledger.reserve({
      reservationId: "a",
      category: "payments",
      amount: "60",
      source: "t",
      ttlMs: 60_000,
    }),
  );
  assert.throws(() =>
    sql.transaction(() =>
      ledger.reserve({
        reservationId: "a",
        category: "payments",
        amount: "61",
        source: "t",
        ttlMs: 60_000,
      }),
    ),
  );
  const payments = ledger.snapshot().categories.find((c) => c.category === "payments")!;
  assert.deepEqual([payments.reserved, payments.spent], [60n, 0n]);
  assert.equal(
    sql.transaction(() =>
      ledger.reserve({
        reservationId: "b",
        category: "payments",
        amount: "41",
        source: "t",
        ttlMs: 60_000,
      }),
    ).success,
    false,
  );
});

test("SQLite upgrades retain legacy charges and persist commit attribution across restarts", () => {
  const sql = sqlite();
  sql
    .exec(
      `CREATE TABLE reservation (id TEXT PRIMARY KEY, category TEXT NOT NULL, amount TEXT NOT NULL,
    state TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    )
    .toArray();
  sql
    .exec(
      `INSERT INTO reservation VALUES ('legacy', 'payments', '40', 'committed', 'test', NULL,
    '2026-09-01T00:00:00Z', '2026-09-01T00:01:00Z')`,
    )
    .toArray();
  migrateLedger(sql);
  let now = new Date("2026-09-30T23:59:50Z");
  let ledger = createBudgetLedger(createSqlLedgerStore(sql), () => now);
  ledger.hydrate([{ category: "payments", limit: "100", spent: "40" }], "active");
  ledger.release("legacy");
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.spent, 40n);
  ledger.reserve({
    reservationId: "carry",
    category: "payments",
    amount: "40",
    source: "test",
    ttlMs: 60_000,
  });
  now = new Date("2026-10-01T00:00:00Z");
  ledger.commit("carry");
  ledger = createBudgetLedger(createSqlLedgerStore(sql), () => now);
  assert.equal(ledger.commit("carry").committedPeriod, "2026-10");
  ledger.release("carry");
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.spent, 0n);
});
