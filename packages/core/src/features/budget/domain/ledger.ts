// Replaces Relayer apps/api/src/kits/agent/budget.service.ts and lua/budget-check.lua
// (commit bb6bb1226e92) with a reservation ledger designed for a Durable Object.
//
// Kept from Relayer:
// - micro-USD units, categories infra/tokens/payments, inclusive limit (spent + amount == limit passes)
// - fail-closed when a category has no positive limit
// - post-hoc `record` for telemetry spend may exceed the limit (flagged)
// - status DTO thresholds: exceeded when spent ≥ limit > 0, warning at ≥ 80%
// - calendar-month periods in UTC
//
// Changed (each covered by tests):
// - reserve → commit | release instead of deduct-then-refund; reservations are idempotent by id
//   and count against the limit while held, so concurrent spends cannot overshoot
// - amounts must be non-negative integers (Relayer let a negative amount credit budget)
// - configure keeps spend unless asked to reset (Relayer zeroed spend on every limit change)
// - a reservation or refund can only be released once (Relayer's refund could double-apply)
// - held reservations expire and release themselves
// - the monthly reset happens when the ledger is touched in a new period, so it no longer
//   depends on a cron sweeping every agent
// - reserve is refused unless the agent is active (kill and pause are atomic with spend)

import { parseMicroUsd, parsePositiveMicroUsd } from "./amounts.js";

export const BUDGET_CATEGORIES = ["infra", "tokens", "payments"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export type LedgerAgentStatus =
  "active" | "paused" | "suspended" | "draining" | "killed" | "pending_policies";

export interface CategoryState {
  category: BudgetCategory;
  limit: bigint;
  spent: bigint;
  reserved: bigint;
  /** "YYYY-MM" the spend belongs to. */
  periodKey: string;
  /** Incremented on an explicit spend reset; legacy rows start at zero. */
  spendGeneration?: number;
}

export type ReservationState = "held" | "committed" | "released";

export interface Reservation {
  id: string;
  category: BudgetCategory;
  amount: bigint;
  state: ReservationState;
  source: string;
  sourceRef: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** Actual charge period/generation, not the reservation creation month. */
  committedPeriod?: string | null;
  committedGeneration?: number | null;
}

/** Synchronous store, matching Durable Object SQLite. The caller wraps each operation in a transaction. */
export interface LedgerStore {
  getCategory(category: BudgetCategory): CategoryState | null;
  putCategory(state: CategoryState): void;
  getReservation(id: string): Reservation | null;
  putReservation(reservation: Reservation): void;
  heldReservations(): Reservation[];
  /** Returns false when the key was already present. */
  markProcessed(key: string, at: Date): boolean;
  getStatus(): LedgerAgentStatus | null;
  setStatus(status: LedgerAgentStatus): void;
}

export class BudgetCategoryError extends Error {
  constructor(value: unknown) {
    super(`Unknown budget category: ${String(value)}`);
    this.name = "BudgetCategoryError";
  }
}

export class ReservationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationConflictError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor(id: string) {
    super(`Reservation not found: ${id}`);
    this.name = "ReservationNotFoundError";
  }
}

export const periodKeyOf = (now: Date) =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

export function periodBounds(periodKey: string): { start: Date; end: Date } {
  const [year, month] = periodKey.split("-").map(Number) as [number, number];
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

export function parseCategory(value: string): BudgetCategory {
  if ((BUDGET_CATEGORIES as readonly string[]).includes(value)) {
    return value as BudgetCategory;
  }
  throw new BudgetCategoryError(value);
}

export type ReserveResult =
  | {
      success: true;
      reservationId: string;
      remaining: bigint;
      spent: bigint;
      reserved: bigint;
      limit: bigint;
    }
  | {
      success: false;
      reason: "not_configured" | "exceeded" | "agent_not_active";
      remaining: bigint;
      spent: bigint;
      reserved: bigint;
      limit: bigint;
    };

export interface ReserveInput {
  reservationId: string;
  category: BudgetCategory;
  amount: string | bigint;
  source: string;
  sourceRef?: string | null;
  ttlMs: number;
}

export interface CategorySnapshot {
  category: BudgetCategory;
  limit: bigint;
  spent: bigint;
  reserved: bigint;
  /** limit − spent − reserved; may be negative after post-hoc records. */
  remaining: bigint;
  /** Percentage of the limit spent, two decimals. */
  usagePct: number;
  status: "ok" | "warning" | "exceeded";
  periodStart: Date;
  periodEnd: Date;
}

export const MAX_RESERVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function usage(
  spent: bigint,
  limit: bigint,
): { usagePct: number; status: CategorySnapshot["status"] } {
  if (limit <= 0n) {
    return { usagePct: 0, status: "ok" };
  }
  // Basis points in bigint, then to a two-decimal percentage without float overflow.
  const pct = Number((spent * 10_000n) / limit) / 100;
  return { usagePct: pct, status: spent >= limit ? "exceeded" : pct >= 80 ? "warning" : "ok" };
}

export function createBudgetLedger(store: LedgerStore, clock: () => Date) {
  /** Loads a category, rolling it into the current period when the month changed. */
  function load(category: BudgetCategory): CategoryState {
    const current = periodKeyOf(clock());
    const state = store.getCategory(category) ?? {
      category,
      limit: 0n,
      spent: 0n,
      reserved: 0n,
      periodKey: current,
    };
    if (state.periodKey !== current) {
      const rolled = { ...state, spent: 0n, periodKey: current };
      store.putCategory(rolled);
      return rolled;
    }
    return state;
  }

  const status = () => store.getStatus() ?? "active";

  function expireHeld(now: Date) {
    let released = 0;
    for (const reservation of store.heldReservations()) {
      if (reservation.expiresAt.getTime() > now.getTime()) {
        continue;
      }
      const state = load(reservation.category);
      store.putCategory({
        ...state,
        reserved: state.reserved > reservation.amount ? state.reserved - reservation.amount : 0n,
      });
      store.putReservation({ ...reservation, state: "released" });
      released++;
    }
    return released;
  }

  return {
    reserve(input: ReserveInput): ReserveResult {
      const now = clock();
      expireHeld(now);
      const amount = parsePositiveMicroUsd(input.amount);
      if (input.ttlMs <= 0 || input.ttlMs > MAX_RESERVATION_TTL_MS) {
        throw new ReservationConflictError("Reservation TTL out of range");
      }

      const existing = store.getReservation(input.reservationId);
      const state = load(input.category);
      const view = {
        spent: state.spent,
        reserved: state.reserved,
        limit: state.limit,
        remaining: state.limit - state.spent - state.reserved,
      };
      if (existing) {
        if (existing.category !== input.category || existing.amount !== amount) {
          throw new ReservationConflictError(
            `Reservation ${input.reservationId} already exists with different terms`,
          );
        }
        if (existing.state === "released") {
          throw new ReservationConflictError(
            `Reservation ${input.reservationId} was already released`,
          );
        }
        return { success: true, reservationId: existing.id, ...view };
      }

      if (status() !== "active") {
        return { success: false, reason: "agent_not_active", ...view };
      }
      if (state.limit <= 0n) {
        return { success: false, reason: "not_configured", ...view };
      }
      if (state.spent + state.reserved + amount > state.limit) {
        return { success: false, reason: "exceeded", ...view };
      }

      const next = { ...state, reserved: state.reserved + amount };
      store.putCategory(next);
      store.putReservation({
        id: input.reservationId,
        category: input.category,
        amount,
        state: "held",
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + input.ttlMs),
      });
      return {
        success: true,
        reservationId: input.reservationId,
        spent: next.spent,
        reserved: next.reserved,
        limit: next.limit,
        remaining: next.limit - next.spent - next.reserved,
      };
    },

    commit(reservationId: string): Reservation {
      expireHeld(clock());
      const reservation = store.getReservation(reservationId);
      if (!reservation) {
        throw new ReservationNotFoundError(reservationId);
      }
      if (reservation.state === "committed") {
        return reservation;
      }
      if (reservation.state === "released") {
        throw new ReservationConflictError(`Reservation ${reservationId} was already released`);
      }
      const state = load(reservation.category);
      store.putCategory({
        ...state,
        reserved: state.reserved - reservation.amount,
        spent: state.spent + reservation.amount,
      });
      const committed = {
        ...reservation,
        state: "committed" as const,
        committedPeriod: state.periodKey,
        committedGeneration: state.spendGeneration ?? 0,
      };
      store.putReservation(committed);
      return committed;
    },

    /** Releases once; a refund affects active spend only when its recorded charge period matches.
     * Historical/legacy charges remain in the reservation history, never credit a newer balance.
     */
    release(reservationId: string): Reservation {
      const reservation = store.getReservation(reservationId);
      if (!reservation) {
        throw new ReservationNotFoundError(reservationId);
      }
      if (reservation.state === "released") {
        return reservation;
      }
      const state = load(reservation.category);
      if (reservation.state === "held") {
        store.putCategory({
          ...state,
          reserved: state.reserved > reservation.amount ? state.reserved - reservation.amount : 0n,
        });
      } else if (
        reservation.committedPeriod === state.periodKey &&
        reservation.committedGeneration === (state.spendGeneration ?? 0)
      ) {
        store.putCategory({
          ...state,
          spent: state.spent > reservation.amount ? state.spent - reservation.amount : 0n,
        });
      }
      const released = { ...reservation, state: "released" as const };
      store.putReservation(released);
      return released;
    },

    /** Post-hoc spend (LLM tokens, x402 telemetry). Deduplicated by eventId; may exceed the limit. */
    record(input: { category: BudgetCategory; amount: string | bigint; eventId: string }): {
      applied: boolean;
      overLimit: boolean;
    } {
      const amount = parsePositiveMicroUsd(input.amount);
      const state = load(input.category);
      if (!store.markProcessed(`record:${input.eventId}`, clock())) {
        return {
          applied: false,
          overLimit: state.limit > 0n && state.spent + state.reserved > state.limit,
        };
      }
      const next = { ...state, spent: state.spent + amount };
      store.putCategory(next);
      return { applied: true, overLimit: next.spent + next.reserved > next.limit };
    },

    configure(
      limits: Partial<Record<BudgetCategory, string | bigint>>,
      options: { resetSpent?: boolean } = {},
    ): void {
      for (const [category, value] of Object.entries(limits)) {
        if (value === undefined) {
          continue;
        }
        const state = load(parseCategory(category));
        store.putCategory({
          ...state,
          limit: parseMicroUsd(value),
          spent: options.resetSpent ? 0n : state.spent,
          spendGeneration: (state.spendGeneration ?? 0) + (options.resetSpent ? 1 : 0),
        });
      }
    },

    /** Seeds limits and spend from Postgres the first time the ledger is used. Never overwrites existing state. */
    hydrate(
      rows: { category: string; limit: string; spent: string }[],
      agentStatus: LedgerAgentStatus,
    ): void {
      if (store.getStatus() === null) {
        store.setStatus(agentStatus);
      }
      const current = periodKeyOf(clock());
      for (const row of rows) {
        if (!(BUDGET_CATEGORIES as readonly string[]).includes(row.category)) {
          continue;
        }
        const category = row.category as BudgetCategory;
        if (store.getCategory(category)) {
          continue;
        }
        store.putCategory({
          category,
          limit: parseMicroUsd(row.limit),
          spent: parseMicroUsd(row.spent),
          reserved: 0n,
          periodKey: current,
        });
      }
    },

    isHydrated: () => store.getStatus() !== null,

    setStatus(next: LedgerAgentStatus): void {
      store.setStatus(next);
    },

    expireReservations(): number {
      return expireHeld(clock());
    },

    snapshot(): {
      status: LedgerAgentStatus;
      categories: CategorySnapshot[];
      nextExpiry: Date | null;
    } {
      const now = clock();
      expireHeld(now);
      const categories = BUDGET_CATEGORIES.map((category) => {
        const state = load(category);
        const { start, end } = periodBounds(state.periodKey);
        return {
          category,
          limit: state.limit,
          spent: state.spent,
          reserved: state.reserved,
          remaining: state.limit - state.spent - state.reserved,
          ...usage(state.spent, state.limit),
          periodStart: start,
          periodEnd: end,
        };
      });
      const expiries = store.heldReservations().map((r) => r.expiresAt.getTime());
      return {
        status: status(),
        categories,
        nextExpiry: expiries.length ? new Date(Math.min(...expiries)) : null,
      };
    },
  };
}

export type BudgetLedger = ReturnType<typeof createBudgetLedger>;
