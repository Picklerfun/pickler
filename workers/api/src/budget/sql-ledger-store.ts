// LedgerStore over Durable Object SQLite (ctx.storage.sql). Amounts are stored as decimal TEXT
// so bigint values survive exactly; SQLite INTEGER would come back as a JS number.

import type {
  BudgetCategory,
  CategoryState,
  LedgerAgentStatus,
  LedgerStore,
  Reservation,
  ReservationState,
} from "@pickler/core";

/**
 * The subset of Cloudflare's SqlStorage used here (also satisfied by node:sqlite in tests).
 * Writes always consume the cursor so they run regardless of cursor laziness.
 */
export interface SqlExec {
  exec(
    query: string,
    ...bindings: (string | number | null)[]
  ): { toArray(): Record<string, unknown>[] };
}

export const LEDGER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS budget (
    category TEXT PRIMARY KEY,
    limit_amount TEXT NOT NULL,
    spent_amount TEXT NOT NULL,
    reserved_amount TEXT NOT NULL,
    period_key TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reservation (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    amount TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('held', 'committed', 'released')),
    source TEXT NOT NULL,
    source_ref TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS reservation_held ON reservation (state, expires_at)`,
  `CREATE TABLE IF NOT EXISTS processed (key TEXT PRIMARY KEY, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS control (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];

export function migrateLedger(sql: SqlExec): void {
  for (const statement of LEDGER_SCHEMA) {
    sql.exec(statement).toArray();
  }
  // Additive upgrade: existing reservations have unknown charge periods and cannot credit spend.
  const columns = (table: string) => sql.exec(`PRAGMA table_info(${table})`).toArray();
  if (!columns("budget").some((row) => row.name === "spend_generation")) {
    sql.exec("ALTER TABLE budget ADD COLUMN spend_generation INTEGER NOT NULL DEFAULT 0").toArray();
  }
  if (!columns("reservation").some((row) => row.name === "committed_period")) {
    sql.exec("ALTER TABLE reservation ADD COLUMN committed_period TEXT").toArray();
  }
  if (!columns("reservation").some((row) => row.name === "committed_generation")) {
    sql.exec("ALTER TABLE reservation ADD COLUMN committed_generation INTEGER").toArray();
  }
}

const toReservation = (row: Record<string, unknown>): Reservation => ({
  id: String(row.id),
  category: row.category as BudgetCategory,
  amount: BigInt(String(row.amount)),
  state: row.state as ReservationState,
  source: String(row.source),
  sourceRef: row.source_ref === null ? null : String(row.source_ref),
  createdAt: new Date(String(row.created_at)),
  expiresAt: new Date(String(row.expires_at)),
  committedPeriod: row.committed_period == null ? null : String(row.committed_period),
  committedGeneration: row.committed_generation == null ? null : Number(row.committed_generation),
});

export function createSqlLedgerStore(sql: SqlExec): LedgerStore {
  return {
    getCategory(category) {
      const [row] = sql.exec("SELECT * FROM budget WHERE category = ?", category).toArray();
      return row
        ? {
            category,
            limit: BigInt(String(row.limit_amount)),
            spent: BigInt(String(row.spent_amount)),
            reserved: BigInt(String(row.reserved_amount)),
            periodKey: String(row.period_key),
            spendGeneration: Number(row.spend_generation),
          }
        : null;
    },
    putCategory(state: CategoryState) {
      sql
        .exec(
          `INSERT INTO budget (category, limit_amount, spent_amount, reserved_amount, period_key, spend_generation) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (category) DO UPDATE SET limit_amount = excluded.limit_amount, spent_amount = excluded.spent_amount,
           reserved_amount = excluded.reserved_amount, period_key = excluded.period_key, spend_generation = excluded.spend_generation`,
          state.category,
          state.limit.toString(),
          state.spent.toString(),
          state.reserved.toString(),
          state.periodKey,
          state.spendGeneration ?? 0,
        )
        .toArray();
    },
    getReservation(id) {
      const [row] = sql.exec("SELECT * FROM reservation WHERE id = ?", id).toArray();
      return row ? toReservation(row) : null;
    },
    putReservation(r) {
      sql
        .exec(
          `INSERT INTO reservation (id, category, amount, state, source, source_ref, created_at, expires_at, committed_period, committed_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET state = excluded.state, committed_period = excluded.committed_period, committed_generation = excluded.committed_generation`,
          r.id,
          r.category,
          r.amount.toString(),
          r.state,
          r.source,
          r.sourceRef,
          r.createdAt.toISOString(),
          r.expiresAt.toISOString(),
          r.committedPeriod ?? null,
          r.committedGeneration ?? null,
        )
        .toArray();
    },
    heldReservations() {
      return sql
        .exec("SELECT * FROM reservation WHERE state = 'held' ORDER BY expires_at")
        .toArray()
        .map(toReservation);
    },
    markProcessed(key, at) {
      const existing = sql.exec("SELECT key FROM processed WHERE key = ?", key).toArray();
      if (existing.length > 0) {
        return false;
      }
      sql.exec("INSERT INTO processed (key, at) VALUES (?, ?)", key, at.toISOString()).toArray();
      return true;
    },
    getStatus() {
      const [row] = sql.exec("SELECT v FROM control WHERE k = 'status'").toArray();
      return row ? (String(row.v) as LedgerAgentStatus) : null;
    },
    setStatus(status) {
      sql
        .exec(
          "INSERT INTO control (k, v) VALUES ('status', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
          status,
        )
        .toArray();
    },
  };
}
