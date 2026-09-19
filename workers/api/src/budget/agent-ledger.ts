// One Durable Object per agent: the authority for budget spend and reservations.
// Replaces Relayer's Redis hash `relayer:budget:<agentId>` + budget-check.lua (commit bb6bb1226e92).
// Hydrates once, read-only, from budget.budgets and agents.agents.status. It does not write back
// to Postgres yet: budget.budgets and budget.ledger_entries become its write-behind projection.

import {
  createBudgetLedger,
  type BudgetCategory,
  type BudgetLedger,
  type CategorySnapshot,
  type LedgerAgentStatus,
  type ReserveInput,
  type ReserveResult,
} from "@pickler/core";
import {
  createSupabaseAdmin,
  createSupabaseAgentRegistry,
  createSupabaseBudgetSource,
} from "@pickler/infrastructure";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { createSqlLedgerStore, migrateLedger } from "./sql-ledger-store";

export interface LedgerSnapshot {
  status: LedgerAgentStatus;
  categories: CategorySnapshot[];
}

export class AgentLedger extends DurableObject<Env> {
  private readonly ledger: BudgetLedger;
  private hydrating: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // SQLite storage is synchronous; migrating here guarantees tables exist before any method runs.
    migrateLedger(ctx.storage.sql);
    this.ledger = createBudgetLedger(createSqlLedgerStore(ctx.storage.sql), () => new Date());
  }

  /** Every mutation runs inside one SQLite transaction; a thrown error rolls it back. */
  private atomically<T>(operation: () => T): T {
    return this.ctx.storage.transactionSync(operation);
  }

  private async ensureHydrated(agentId: string): Promise<void> {
    if (this.ledger.isHydrated()) {
      return;
    }
    this.hydrating ??= (async () => {
      const db = createSupabaseAdmin({
        url: this.env.SUPABASE_URL,
        secretKey: this.env.SUPABASE_SECRET_KEY,
      });
      const [rows, agent] = await Promise.all([
        createSupabaseBudgetSource(db).loadBudgets(agentId),
        createSupabaseAgentRegistry(db).findById(agentId),
      ]);
      if (!agent) {
        throw new Error("Agent not found for ledger hydration");
      }
      // Hydration never overwrites state, so a concurrent second hydration is harmless.
      this.atomically(() => this.ledger.hydrate(rows, agent.status));
    })().finally(() => {
      this.hydrating = null;
    });
    await this.hydrating;
  }

  private async scheduleExpiry(): Promise<void> {
    const next = this.ledger.snapshot().nextExpiry;
    if (!next) {
      return;
    }
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next.getTime()) {
      await this.ctx.storage.setAlarm(next.getTime() + 1);
    }
  }

  async snapshot(agentId: string): Promise<LedgerSnapshot> {
    await this.ensureHydrated(agentId);
    const { status, categories } = this.atomically(() => this.ledger.snapshot());
    return { status, categories };
  }

  async reserve(agentId: string, input: ReserveInput): Promise<ReserveResult> {
    await this.ensureHydrated(agentId);
    const result = this.atomically(() => this.ledger.reserve(input));
    await this.scheduleExpiry();
    return result;
  }

  async commit(agentId: string, reservationId: string): Promise<void> {
    await this.ensureHydrated(agentId);
    this.atomically(() => this.ledger.commit(reservationId));
  }

  async release(agentId: string, reservationId: string): Promise<void> {
    await this.ensureHydrated(agentId);
    this.atomically(() => this.ledger.release(reservationId));
  }

  async record(
    agentId: string,
    input: { category: BudgetCategory; amount: string; eventId: string },
  ): Promise<{ applied: boolean; overLimit: boolean }> {
    await this.ensureHydrated(agentId);
    return this.atomically(() => this.ledger.record(input));
  }

  async configure(
    agentId: string,
    limits: Partial<Record<BudgetCategory, string>>,
    options: { resetSpent?: boolean } = {},
  ): Promise<void> {
    await this.ensureHydrated(agentId);
    this.atomically(() => this.ledger.configure(limits, options));
  }

  async setStatus(agentId: string, status: LedgerAgentStatus): Promise<void> {
    await this.ensureHydrated(agentId);
    this.atomically(() => this.ledger.setStatus(status));
  }

  override async alarm(): Promise<void> {
    this.atomically(() => this.ledger.expireReservations());
    await this.scheduleExpiry();
  }
}
