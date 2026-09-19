import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBudgetLedger,
  InvalidAmountError,
  parseMicroUsd,
  ReservationConflictError,
  ReservationNotFoundError,
  usdToMicroUsd,
  type BudgetCategory,
  type CategoryState,
  type LedgerAgentStatus,
  type LedgerStore,
  type Reservation,
} from "../src/index.js";

function memoryStore(): LedgerStore {
  const categories = new Map<BudgetCategory, CategoryState>();
  const reservations = new Map<string, Reservation>();
  const processed = new Set<string>();
  let status: LedgerAgentStatus | null = null;
  return {
    getCategory: (c) => categories.get(c) ?? null,
    putCategory: (s) => void categories.set(s.category, s),
    getReservation: (id) => reservations.get(id) ?? null,
    putReservation: (r) => void reservations.set(r.id, r),
    heldReservations: () => [...reservations.values()].filter((r) => r.state === "held"),
    markProcessed: (key) => (processed.has(key) ? false : (processed.add(key), true)),
    getStatus: () => status,
    setStatus: (s) => void (status = s),
  };
}

function setup(start = "2026-09-16T12:00:00Z") {
  let now = new Date(start);
  const ledger = createBudgetLedger(memoryStore(), () => now);
  return {
    ledger,
    advance: (ms: number) => void (now = new Date(now.getTime() + ms)),
    setNow: (iso: string) => void (now = new Date(iso)),
  };
}

const reserve = (id: string, amount: string, category: BudgetCategory = "payments") => ({
  reservationId: id,
  category,
  amount,
  source: "test",
  ttlMs: 60_000,
});

test("amounts: integers only, exact USD conversion", () => {
  assert.equal(parseMicroUsd("1000000"), 1_000_000n);
  for (const bad of ["-5", "1.5", "", "1e6", " 1", "99999999999999999999"]) {
    assert.throws(() => parseMicroUsd(bad), InvalidAmountError, bad);
  }
  assert.equal(usdToMicroUsd(100), 100_000_000n);
  assert.equal(usdToMicroUsd("0.1234565"), 123_457n);
  assert.equal(usdToMicroUsd("0.1"), 100_000n);
  assert.equal(usdToMicroUsd(0.29), 290_000n);
  assert.throws(() => usdToMicroUsd(-1), InvalidAmountError);
});

test("unconfigured categories fail closed; the limit is inclusive", () => {
  const { ledger } = setup();
  ledger.hydrate([], "active");
  assert.deepEqual(ledger.reserve(reserve("r0", "1")).success, false);
  ledger.configure({ payments: "10" });
  assert.equal(ledger.reserve(reserve("r1", "6")).success, true);
  assert.equal(ledger.reserve(reserve("r2", "4")).success, true);
  const over = ledger.reserve(reserve("r3", "1"));
  assert.equal(over.success, false);
  assert.equal(!over.success && over.reason, "exceeded");
});

test("held reservations count against the limit, so interleaved spends cannot overshoot", () => {
  const { ledger } = setup();
  ledger.hydrate([{ category: "payments", limit: "100", spent: "0" }], "active");
  const results = Array.from({ length: 30 }, (_, i) => ledger.reserve(reserve(`r${i}`, "7")));
  const accepted = results.filter((r) => r.success).length;
  assert.equal(accepted, 14);
  const payments = ledger.snapshot().categories.find((c) => c.category === "payments")!;
  assert.equal(payments.reserved, 98n);
  assert.ok(payments.spent + payments.reserved <= payments.limit);
});

test("commit and release are idempotent; a refund cannot be applied twice", () => {
  const { ledger } = setup();
  ledger.hydrate([{ category: "payments", limit: "100", spent: "0" }], "active");
  ledger.reserve(reserve("a", "40"));
  assert.equal(ledger.commit("a").state, "committed");
  assert.equal(ledger.commit("a").state, "committed");
  let payments = ledger.snapshot().categories.find((c) => c.category === "payments")!;
  assert.deepEqual([payments.spent, payments.reserved], [40n, 0n]);

  ledger.release("a");
  ledger.release("a");
  payments = ledger.snapshot().categories.find((c) => c.category === "payments")!;
  assert.deepEqual([payments.spent, payments.reserved], [0n, 0n]);

  assert.throws(() => ledger.commit("a"), ReservationConflictError);
  assert.throws(() => ledger.commit("missing"), ReservationNotFoundError);
  assert.throws(() => ledger.reserve(reserve("a", "40")), ReservationConflictError);
});

test("retries with the same reservation id do not double-reserve; different terms conflict", () => {
  const { ledger } = setup();
  ledger.hydrate([{ category: "payments", limit: "100", spent: "0" }], "active");
  assert.equal(ledger.reserve(reserve("x", "30")).success, true);
  assert.equal(ledger.reserve(reserve("x", "30")).success, true);
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.reserved, 30n);
  assert.throws(() => ledger.reserve(reserve("x", "31")), ReservationConflictError);
  assert.throws(() => ledger.reserve({ ...reserve("y", "-5") }), InvalidAmountError);
  assert.throws(() => ledger.reserve({ ...reserve("z", "5"), ttlMs: 0 }), ReservationConflictError);
});

test("expired holds release themselves", () => {
  const { ledger, advance } = setup();
  ledger.hydrate([{ category: "payments", limit: "10", spent: "0" }], "active");
  ledger.reserve(reserve("slow", "10"));
  assert.equal(ledger.reserve(reserve("blocked", "1")).success, false);
  assert.equal(ledger.snapshot().nextExpiry?.toISOString(), "2026-09-16T12:01:00.000Z");
  advance(60_001);
  assert.equal(ledger.reserve(reserve("now-ok", "10")).success, true);
  assert.throws(() => ledger.commit("slow"), ReservationConflictError);
});

test("killed or paused agents cannot reserve; records are deduplicated and may exceed the limit", () => {
  const { ledger } = setup();
  ledger.hydrate([{ category: "tokens", limit: "5", spent: "0" }], "active");
  assert.deepEqual(ledger.record({ category: "tokens", amount: "4", eventId: "e1" }), {
    applied: true,
    overLimit: false,
  });
  assert.deepEqual(ledger.record({ category: "tokens", amount: "4", eventId: "e1" }), {
    applied: false,
    overLimit: false,
  });
  assert.deepEqual(ledger.record({ category: "tokens", amount: "4", eventId: "e2" }), {
    applied: true,
    overLimit: true,
  });
  const tokens = ledger.snapshot().categories.find((c) => c.category === "tokens")!;
  assert.equal(tokens.status, "exceeded");
  assert.equal(tokens.remaining, -3n);

  ledger.configure({ payments: "100" });
  ledger.setStatus("killed");
  const refused = ledger.reserve(reserve("k", "1"));
  assert.equal(!refused.success && refused.reason, "agent_not_active");
});

test("changing limits keeps spend unless a reset is requested", () => {
  const { ledger } = setup();
  ledger.hydrate([{ category: "payments", limit: "100", spent: "60" }], "active");
  ledger.configure({ payments: "200" });
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.spent, 60n);
  ledger.configure({ payments: "200" }, { resetSpent: true });
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.spent, 0n);
});

test("spend rolls over at the UTC month boundary; limits and holds carry over", () => {
  const { ledger, setNow } = setup("2026-09-30T23:59:00Z");
  ledger.hydrate([{ category: "payments", limit: "100", spent: "90" }], "active");
  ledger.reserve({ ...reserve("carry", "5"), ttlMs: 86_400_000 });
  setNow("2026-10-01T00:00:01Z");
  const payments = ledger.snapshot().categories.find((c) => c.category === "payments")!;
  assert.deepEqual([payments.limit, payments.spent, payments.reserved], [100n, 0n, 5n]);
  assert.equal(payments.periodStart.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(payments.periodEnd.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("hydration never overwrites live state and status thresholds match Relayer", () => {
  const { ledger } = setup();
  ledger.hydrate(
    [
      { category: "infra", limit: "1000", spent: "800" },
      { category: "bogus", limit: "1", spent: "0" },
    ],
    "active",
  );
  ledger.record({ category: "infra", amount: "50", eventId: "e" });
  ledger.hydrate([{ category: "infra", limit: "1", spent: "0" }], "killed");
  const infra = ledger.snapshot().categories.find((c) => c.category === "infra")!;
  assert.deepEqual(
    [infra.limit, infra.spent, infra.usagePct, infra.status],
    [1000n, 850n, 85, "warning"],
  );
  assert.equal(ledger.snapshot().status, "active");
});

test("refunds cannot reduce a later month's spend or a reset balance", () => {
  const { ledger, setNow } = setup("2026-09-30T23:59:00Z");
  ledger.configure({ payments: "100" });
  ledger.reserve(reserve("september", "80"));
  ledger.commit("september");
  setNow("2026-10-01T00:00:00Z");
  ledger.record({ category: "payments", amount: "80", eventId: "october" });
  ledger.release("september");
  ledger.release("september");
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.spent, 80n);
  assert.equal(ledger.reserve(reserve("overspend", "21")).success, false);
  ledger.reserve(reserve("before-reset", "10"));
  ledger.commit("before-reset");
  ledger.configure({ payments: "100" }, { resetSpent: true });
  ledger.record({ category: "payments", amount: "70", eventId: "after-reset" });
  ledger.release("before-reset");
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.spent, 70n);
});

test("a hold crossing months is refunded in the actual commit month", () => {
  const { ledger, setNow } = setup("2026-09-30T23:59:50Z");
  ledger.configure({ payments: "100" });
  ledger.reserve(reserve("carry", "80"));
  setNow("2026-10-01T00:00:00Z");
  assert.equal(ledger.commit("carry").committedPeriod, "2026-10");
  ledger.release("carry");
  assert.equal(ledger.snapshot().categories.find((c) => c.category === "payments")!.spent, 0n);
});
