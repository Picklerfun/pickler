import type { Pool } from "pg";
import {
  createBudgetLedger,
  PilotError,
  type BudgetLedger,
  type CategoryState,
  type Reservation,
  type LedgerStore,
  type LedgerAgentStatus,
} from "@pickler/core";

const encode = (value: unknown) =>
  JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? { microUsd: v.toString() } : v));
function decode<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_key, v) =>
    v && typeof v === "object" && Object.keys(v).length === 1 && typeof v.microUsd === "string"
      ? BigInt(v.microUsd)
      : v,
  ) as T;
}

/** One short transaction per operation. No in-memory or Durable Object budget authority. */
export class PostgresBudgetLedger {
  constructor(private readonly pool: Pool) {}
  private async execute<T>(
    agentId: string,
    operation: (ledger: BudgetLedger) => T,
    keys: { reservationId?: string; eventId?: string } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const agent = await client.query("SELECT status FROM agents.agents WHERE id=$1 FOR UPDATE", [
        agentId,
      ]);
      if (!agent.rows[0]) {
        throw new PilotError("NOT_FOUND", "Agent not found");
      }
      const time = await client.query("SELECT clock_timestamp() AS now");
      const now = new Date(time.rows[0].now);
      const state = await client.query("SELECT state FROM pickler.budget_state WHERE agent_id=$1", [
        agentId,
      ]);
      const categories = new Map<string, CategoryState>(
        decode<CategoryState[]>(state.rows[0]?.state ?? []).map((c) => [c.category, c]),
      );
      if (!state.rows.length) {
        const managed = await client.query(
          "SELECT 1 FROM pickler.product_agents WHERE product_agent_id=$1",
          [agentId],
        );
        if (!managed.rows.length) {
          throw new PilotError(
            "BUDGET_IMPORT_REQUIRED",
            "Legacy budget authority requires a verified import",
          );
        }
        const historical = await client.query("SELECT 1 FROM budget.budgets WHERE agent_id=$1", [
          agentId,
        ]);
        if (historical.rows.length) {
          throw new PilotError(
            "BUDGET_IMPORT_REQUIRED",
            "Existing budget state requires reconciliation",
          );
        }
      }
      const held = await client.query(
        "SELECT payload FROM pickler.budget_reservations WHERE agent_id=$1 AND (state='held' OR id=$2)",
        [agentId, keys.reservationId ?? null],
      );
      const reservations = new Map<string, Reservation>();
      for (const row of held.rows) {
        const r = decode<Reservation>(row.payload);
        r.createdAt = new Date(r.createdAt);
        r.expiresAt = new Date(r.expiresAt);
        reservations.set(r.id, r);
      }
      const processed = keys.eventId
        ? await client.query(
            "SELECT key FROM pickler.budget_processed WHERE agent_id=$1 AND key=$2",
            [agentId, `record:${keys.eventId}`],
          )
        : { rows: [] };
      const seen = new Set<string>(processed.rows.map((r) => r.key));
      const newKeys = new Set<string>();
      const changed = new Set<string>();
      let status: LedgerAgentStatus = agent.rows[0].status;
      const store: LedgerStore = {
        getCategory: (c) => categories.get(c) ?? null,
        putCategory: (c) => {
          categories.set(c.category, c);
        },
        getReservation: (id) => reservations.get(id) ?? null,
        putReservation: (r) => {
          reservations.set(r.id, r);
          changed.add(r.id);
        },
        heldReservations: () => [...reservations.values()].filter((r) => r.state === "held"),
        markProcessed: (key) => {
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          newKeys.add(key);
          return true;
        },
        getStatus: () => status,
        setStatus: (next) => {
          status = next;
        },
      };
      const result = operation(createBudgetLedger(store, () => now));
      await client.query(
        `INSERT INTO pickler.budget_state (agent_id,state) VALUES ($1,$2::jsonb)
        ON CONFLICT (agent_id) DO UPDATE SET state=excluded.state,updated_at=clock_timestamp()`,
        [agentId, encode([...categories.values()])],
      );
      for (const id of changed) {
        const r = reservations.get(id)!;
        await client.query(
          `INSERT INTO pickler.budget_reservations (agent_id,id,state,expires_at,payload) VALUES ($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT (agent_id,id) DO UPDATE SET state=excluded.state,payload=excluded.payload`,
          [agentId, id, r.state, r.expiresAt.getTime(), encode(r)],
        );
      }
      for (const key of newKeys) {
        await client.query("INSERT INTO pickler.budget_processed (agent_id,key) VALUES ($1,$2)", [
          agentId,
          key,
        ]);
      }
      if (status !== agent.rows[0].status) {
        throw new PilotError("INVALID_INPUT", "Change lifecycle through agent authorization");
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  snapshot(agentId: string) {
    return this.execute(agentId, (ledger) => ledger.snapshot());
  }
  reserve(agentId: string, input: Parameters<BudgetLedger["reserve"]>[0]) {
    return this.execute(agentId, (l) => l.reserve(input), { reservationId: input.reservationId });
  }
  commit(agentId: string, id: string) {
    return this.execute(agentId, (l) => l.commit(id), { reservationId: id });
  }
  release(agentId: string, id: string) {
    return this.execute(agentId, (l) => l.release(id), { reservationId: id });
  }
  record(agentId: string, input: Parameters<BudgetLedger["record"]>[0]) {
    return this.execute(agentId, (l) => l.record(input), { eventId: input.eventId });
  }
  configure(agentId: string, limits: Parameters<BudgetLedger["configure"]>[0]) {
    return this.execute(agentId, (l) => l.configure(limits));
  }
}
