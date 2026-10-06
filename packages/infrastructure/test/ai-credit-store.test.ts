import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";
import { DEFAULT_BRIEF, STARTER_CAPS, prepareDraft, type AiCreditCheckScope } from "@pickler/core";
import { PostgresAiCreditStore } from "../src/persistence/ai-credit-store.js";
import { PostgresPerpsCheckCostStore } from "../src/persistence/perps-check-cost-store.js";
import { PostgresPerpsRuntimeStore } from "../src/persistence/perps-runtime-store.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";

const NOON = Date.UTC(2026, 9, 5, 12);
const rate = {
  provider: "controlled",
  model: "fixture",
  inputUnitsPerMillion: "1000000",
  outputUnitsPerMillion: "3000000",
};
const pricing = {
  id: randomUUID(),
  version: "controlled-only-v1",
  reviewedAt: new Date(NOON).toISOString(),
  rates: [rate],
};
const plan = {
  provider: "controlled",
  model: "fixture",
  promptVersion: "controlled-v2",
  promptSha256: "a".repeat(64),
  maxInputTokens: 1000,
  maxOutputTokens: 100,
  inputMicrosPerMillion: "1000000",
  outputMicrosPerMillion: "3000000",
};

async function setup(t: TestContext) {
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Credit acceptance requires loopback PostgreSQL",
    );
  }
  const db = await createTestStore(t);
  let time = NOON;
  const now = () => time;
  const credits = new PostgresAiCreditStore(db.pool, now);
  const costs = new PostgresPerpsCheckCostStore(db.pool, now);
  const runtime = new PostgresPerpsRuntimeStore(db.pool, now);
  const studio = new PostgresStudioDirectory(db.pool);
  await credits.addPricing(pricing);
  const owner = randomUUID();
  await db.pool.query("SELECT identity.create_profile($1,'Credit Owner','credit_owner')", [owner]);
  await studio.onboard(owner);
  const access = (await studio.access(owner, null))!;
  const { config } = prepareDraft({
    name: "Credit agent",
    handle: "credit_agent",
    voice: "analyst",
    avatar: { accent: "lime", pattern: 0 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId: "unused",
  });
  let count = 0;
  async function agent() {
    count += 1;
    const id = randomUUID();
    const runtimeId = `credit-agent-${count}`;
    const handle = `credit_agent_${count}`;
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO agents.agents(id,workspace_id,name,handle,status) VALUES($1,$2,'Credit agent',$3,'active')",
        [id, access.workspaceId, handle],
      );
      await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES($1,$2)", [
        handle,
        id,
      ]);
      await client.query(
        "INSERT INTO pickler.agents(tenant_id,id,version,config) VALUES($1,$2,1,$3)",
        [access.tenantId, runtimeId, config],
      );
      await client.query(
        "INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request) VALUES($1,$2,$3,$4,$5,'{}')",
        [id, access.workspaceId, access.tenantId, runtimeId, `create-${count}`],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    return { id, tenantId: access.tenantId, agentId: runtimeId };
  }
  async function check(
    a: Awaited<ReturnType<typeof agent>>,
    keys = ["direct"],
    strategy = "deepseek",
  ) {
    const row = await runtime.startCheck({ productAgentId: a.id, trigger: "manual" });
    const claimed = (await runtime.claimAgent(row.id))!;
    const providerScope = {
      checkId: row.id,
      tenantId: a.tenantId,
      agentId: a.agentId,
      configVersion: 1,
      lease: claimed.lease,
    };
    const scope: AiCreditCheckScope = {
      checkId: row.id,
      tenantId: a.tenantId,
      agentId: a.agentId,
      configVersion: 1,
      leaseOwner: claimed.lease.owner,
    };
    await costs.reserve(
      providerScope,
      { id: strategy as "deepseek", version: "2.0.0" },
      {
        version: 1,
        enabled: true,
        reviewedAt: pricing.reviewedAt,
        perOperationMicros: "10000",
        perDayMicros: "100000",
      },
      keys.map((key) => ({ ...plan, key })),
    );
    return { scope, providerScope, lease: claimed.lease };
  }
  async function purchase(units = "5000", userId = owner, key: string = randomUUID()) {
    return credits.createPurchase({
      userId,
      requestKey: key,
      creditUnits: units,
      paymentAmount: "100",
      paymentUnit: "controlled-fixture-asset",
      paymentScale: 6,
      paymentMethod: "controlled-verifier",
      quoteVersion: "fixture",
      expiresAt: new Date(now() + 60000).toISOString(),
    });
  }
  function payment(purchaseId: string, paymentId = randomUUID()) {
    return {
      purchaseId,
      provider: "controlled",
      eventId: paymentId,
      paymentId,
      amount: "100",
      unit: "controlled-fixture-asset",
      scale: 6,
      recipient: "fixture-treasury",
      expectedRecipient: "fixture-treasury",
      evidenceSha256: "b".repeat(64),
      settledAt: new Date(now()).toISOString(),
      valid: true,
    };
  }
  async function fund(units = "5000") {
    const p = await purchase(units);
    await credits.recordVerifiedPayment(payment(p.id));
    return p;
  }
  async function finish(c: Awaited<ReturnType<typeof check>>, success = true) {
    await costs.finish(c.providerScope);
    await runtime.finishCheck(c.lease, {
      outcome: success ? "held" : "failed",
      outcomeText: success ? "wait" : "failed",
      decision: { protocol: "studio-perps-check-v2", incomplete: !success },
    });
  }
  async function invariant() {
    const rows = await db.pool
      .query(`SELECT a.balance_units::text AS balance,a.reserved_units::text AS reserved,
      coalesce(sum(l.balance_delta_units),0)::text AS ledger_balance,coalesce(sum(l.reserved_delta_units),0)::text AS ledger_reserved
      FROM billing.ai_credit_accounts a LEFT JOIN billing.ai_credit_ledger l ON l.account_id=a.id
      GROUP BY a.id`);
    for (const r of rows.rows) {
      assert.equal(r.balance, r.ledger_balance);
      assert.equal(r.reserved, r.ledger_reserved);
    }
  }
  return {
    db,
    now,
    advance: (ms: number) => {
      time += ms;
    },
    credits,
    costs,
    runtime,
    owner,
    agent,
    check,
    purchase,
    payment,
    fund,
    finish,
    invariant,
  };
}

test("purchased credits: immutable quotes, verified purchases and isolated owner history", async (t) => {
  const f = await setup(t);
  assert.equal((await f.credits.account(f.owner)).availableUnits, "0");
  const p = await f.purchase("5000", f.owner, "same-key");
  assert.equal((await f.purchase("5000", f.owner, "same-key")).id, p.id);
  await assert.rejects(f.purchase("6000", f.owner, "same-key"), { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "0");
  const proof = f.payment(p.id);
  await Promise.all([
    f.credits.recordVerifiedPayment(proof),
    f.credits.recordVerifiedPayment(proof),
  ]);
  await f.credits.recordVerifiedPayment({ ...proof, eventId: "second-notification" });
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "5000");
  assert.equal((await f.credits.history(f.owner)).length, 1);
  const other = randomUUID();
  assert.deepEqual(await f.credits.history(other), []);
  await assert.rejects(f.credits.purchase(other, p.id), { code: "NOT_FOUND" });
  const otherPurchase = await f.purchase("5000", other);
  await assert.rejects(
    f.credits.recordVerifiedPayment({ ...proof, purchaseId: otherPurchase.id }),
    { code: "PAYMENT_CONFLICT" },
  );
  await assert.rejects(f.db.pool.query("UPDATE billing.ai_credit_ledger SET reason='rewritten'"), {
    code: "23514",
  });
  await assert.rejects(f.db.pool.query("UPDATE billing.ai_credit_accounts SET balance_units=999"), {
    code: "23514",
  });
  await assert.rejects(
    f.db.pool.query("UPDATE billing.ai_credit_purchases SET credit_units=999 WHERE id=$1", [p.id]),
    { code: "23514" },
  );
  await assert.rejects(f.db.pool.query("DELETE FROM billing.ai_credit_payment_events"), {
    code: "23514",
  });
  await f.credits.addPricing(pricing);
  await assert.rejects(
    f.credits.addPricing({ ...pricing, rates: [{ ...rate, outputUnitsPerMillion: "99" }] }),
    { code: "PRICING_CONFLICT" },
  );
  await assert.rejects(
    f.db.pool.query("UPDATE billing.ai_credit_pricing_versions SET rates='[]'"),
    { code: "23514" },
  );
  await f.invariant();
});

test("payment verification rejects fabricated units/recipient and preserves late settlement", async (t) => {
  const f = await setup(t);
  for (const change of [
    { amount: "99" },
    { unit: "fake" },
    { scale: 18 },
    { recipient: "attacker" },
    { valid: false },
  ]) {
    const p = await f.purchase();
    assert.equal(
      (await f.credits.recordVerifiedPayment({ ...f.payment(p.id), ...change })).status,
      "failed",
    );
  }
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "0");
  const p = await f.purchase();
  const proof = f.payment(p.id);
  f.advance(60001);
  assert.equal((await f.credits.recordVerifiedPayment(proof)).status, "review_required");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "0");
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT verification FROM billing.ai_credit_payment_events WHERE purchase_id=$1",
        [p.id],
      )
    ).rows[0].verification,
    "verified",
  );
  await f.invariant();
});

test("different agents reserve one shared balance concurrently without overspending", async (t) => {
  const f = await setup(t);
  await f.fund("2000");
  const a = await f.check(await f.agent());
  const b = await f.check(await f.agent());
  const peer = new PostgresAiCreditStore(f.db.pool, f.now);
  const result = await Promise.allSettled([
    f.credits.reserveCheck(a.scope, pricing.id),
    peer.reserveCheck(b.scope, pricing.id),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = result.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "INSUFFICIENT_CREDITS");
  assert.equal((await f.credits.account(f.owner)).reservedUnits, "1300");
  assert.equal((await f.credits.account(f.owner)).availableUnits, "700");
  await f.invariant();
});

test("valid wait charges actual usage once and unused combined calls release their maximum", async (t) => {
  const f = await setup(t);
  await f.fund();
  const c = await f.check(await f.agent(), ["direct", "review"], "combined");
  const op = await f.credits.reserveCheck(c.scope, pricing.id);
  assert.equal(op.maximumUnits, "2600");
  assert.equal((await f.credits.reserveCheck(c.scope, pricing.id)).id, op.id);
  await f.costs.start(c.providerScope, "direct", { sha256: "c".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  await assert.rejects(f.credits.recordCallStart(c.scope, "direct"), {
    code: "CALL_ALREADY_STARTED",
  });
  await f.costs.complete(c.providerScope, "direct", { input: 10, output: 2 });
  await f.finish(c);
  const settled = await f.credits.settleCheck(c.scope.checkId);
  assert.equal(settled.chargedUnits, "16");
  assert.equal((await f.credits.settleCheck(c.scope.checkId)).chargedUnits, "16");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "4984");
  assert.equal((await f.credits.account(f.owner)).reservedUnits, "0");
  assert.equal((await f.credits.history(f.owner)).length, 3);
  const page = await f.credits.history(f.owner, undefined, 1);
  assert.match(page[0]!.id, /^[0-9a-f-]{36}$/);
  assert.match(page[0]!.cursor, /^[1-9]\d*$/);
  assert.equal((await f.credits.history(f.owner, page[0]!.cursor, 1)).length, 1);
  await f.invariant();
});

test("unknown and failed model usage costs the platform, not the user; late reconciliation never charges", async (t) => {
  const f = await setup(t);
  await f.fund();
  const c = await f.check(await f.agent());
  await f.credits.reserveCheck(c.scope, pricing.id);
  await f.costs.start(c.providerScope, "direct", { sha256: "d".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  await f.costs.unknown(c.providerScope, "direct");
  await assert.rejects(f.credits.settleCheck(c.scope.checkId), { code: "CHECK_PENDING" });
  assert.equal((await f.credits.account(f.owner)).reservedUnits, "1300");
  await f.finish(c, false);
  assert.equal((await f.credits.settleCheck(c.scope.checkId)).status, "released");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "5000");
  assert.equal((await f.credits.account(f.owner)).reservedUnits, "0");
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT status FROM pickler.perps_check_reservations WHERE check_id=$1",
        [c.scope.checkId],
      )
    ).rows[0].status,
    "unknown",
  );
  await f.costs.reconcileCall({
    tenantId: c.scope.tenantId,
    agentId: c.scope.agentId,
    checkId: c.scope.checkId,
    key: "direct",
    requestSha256: "d".repeat(64),
    evidence: "controlled usage receipt",
    usage: { input: 10, output: 2 },
  });
  assert.equal((await f.credits.settleCheck(c.scope.checkId)).chargedUnits, "0");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "5000");
  await f.invariant();
});

test("partial and malformed result releases all credits while preserving known provider expense", async (t) => {
  const f = await setup(t);
  await f.fund();
  const c = await f.check(await f.agent());
  await f.credits.reserveCheck(c.scope, pricing.id);
  await f.costs.start(c.providerScope, "direct", { sha256: "d".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  await f.costs.complete(c.providerScope, "direct", { input: 10, output: 2 });
  await f.finish(c, false);
  assert.equal((await f.credits.settleCheck(c.scope.checkId)).chargedUnits, "0");
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT cost_micros::text AS cost FROM pickler.perps_check_calls WHERE check_id=$1",
        [c.scope.checkId],
      )
    ).rows[0].cost,
    "16",
  );
  await f.invariant();
});

test("lost lease recovery is idempotent, retains provider starts and cannot replay transport", async (t) => {
  const f = await setup(t);
  await f.fund();
  const c = await f.check(await f.agent());
  await f.credits.reserveCheck(c.scope, pricing.id);
  await f.costs.start(c.providerScope, "direct", { sha256: "e".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  f.advance(61000);
  await assert.rejects(f.credits.recordCallStart(c.scope, "direct"), { code: "LEASE_LOST" });
  await assert.rejects(f.credits.reserveCheck(c.scope, pricing.id), { code: "LEASE_LOST" });
  const restarted = new PostgresAiCreditStore(f.db.pool, f.now);
  assert.equal((await restarted.recoverCheck(c.scope.checkId)).status, "released");
  assert.equal((await restarted.recoverCheck(c.scope.checkId)).status, "released");
  assert.equal((await f.credits.account(f.owner)).reservedUnits, "0");
  assert.equal(
    (
      await f.db.pool.query("SELECT status FROM pickler.perps_check_calls WHERE check_id=$1", [
        c.scope.checkId,
      ])
    ).rows[0].status,
    "started",
  );
  await f.invariant();
});

test("configuration, scope, pause and ownership checks precede paid admission", async (t) => {
  const f = await setup(t);
  await f.fund();
  const a = await f.agent();
  const c = await f.check(a);
  await assert.rejects(f.credits.reserveCheck({ ...c.scope, agentId: "other-agent" }, pricing.id), {
    code: "SCOPE_MISMATCH",
  });
  await assert.rejects(f.credits.reserveCheck({ ...c.scope, configVersion: 2 }, pricing.id), {
    code: "CONFIG_CHANGED",
  });
  await assert.rejects(f.credits.setAgentLimit(randomUUID(), a.id, "100", 0), {
    code: "NOT_FOUND",
  });
  await f.db.pool.query("UPDATE pickler.agents SET paused=true WHERE tenant_id=$1 AND id=$2", [
    a.tenantId,
    a.agentId,
  ]);
  await assert.rejects(f.credits.reserveCheck(c.scope, pricing.id), { code: "NOT_READY" });
  assert.equal((await f.credits.account(f.owner)).reservedUnits, "0");
  await f.invariant();
});

test("daily UTC owner limits include concurrent reservations and preserve config versions", async (t) => {
  const f = await setup(t);
  await f.fund();
  const a = await f.agent();
  assert.equal(await f.credits.setAgentLimit(f.owner, a.id, "1300", 0), 1);
  await assert.rejects(f.credits.setAgentLimit(f.owner, a.id, "2000", 0), {
    code: "VERSION_CONFLICT",
  });
  const c = await f.check(a);
  await f.credits.reserveCheck(c.scope, pricing.id);
  const r = (
    await f.db.pool.query(
      "SELECT limit_version,daily_limit_units::text AS cap FROM billing.ai_credit_operations WHERE check_id=$1",
      [c.scope.checkId],
    )
  ).rows[0];
  assert.equal(r.limit_version, 1);
  assert.equal(r.cap, "1300");
  await f.credits.setAgentLimit(f.owner, a.id, "0", 1);
  await f.finish(c, false);
  await f.credits.settleCheck(c.scope.checkId);
  const next = await f.check(a);
  await assert.rejects(f.credits.reserveCheck(next.scope, pricing.id), {
    code: "DAILY_CREDIT_LIMIT",
  });
  assert.equal(await f.credits.setAgentLimit(f.owner, a.id, null, 2), 3);
  await f.credits.reserveCheck(next.scope, pricing.id);
  await f.invariant();
});

test("rules with no balance reserve zero and never debit AUSD or create positions", async (t) => {
  const f = await setup(t);
  const c = await f.check(await f.agent(), [], "rules");
  assert.equal((await f.credits.reserveCheck(c.scope, pricing.id)).maximumUnits, "0");
  await f.finish(c);
  assert.equal((await f.credits.settleCheck(c.scope.checkId)).chargedUnits, "0");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "0");
  for (const table of [
    "perps_paper_accounts",
    "perps_paper_positions",
    "perps_paper_movements",
    "advice_calls",
  ]) {
    assert.equal(
      (await f.db.pool.query(`SELECT count(*)::int AS n FROM pickler.${table}`)).rows[0].n,
      0,
    );
  }
  await f.invariant();
});

test("payment reversal records a deficit without resetting history; ordinary calls are blocked", async (t) => {
  const f = await setup(t);
  const p = await f.fund("2000");
  const c = await f.check(await f.agent());
  await f.credits.reserveCheck(c.scope, pricing.id);
  await f.costs.start(c.providerScope, "direct", { sha256: "f".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  await f.costs.complete(c.providerScope, "direct", { input: 10, output: 2 });
  await f.finish(c);
  await f.credits.settleCheck(c.scope.checkId);
  const adjustment = {
    userId: f.owner,
    key: "reversal",
    balanceDeltaUnits: "-2000",
    reason: "verified payment reversal",
    purchaseId: p.id,
  };
  const account = await f.credits.adjust(adjustment);
  assert.equal(account.balanceUnits, "-16");
  assert.equal(account.status, "blocked");
  assert.equal((await f.credits.adjust(adjustment)).balanceUnits, "-16");
  const next = await f.check(await f.agent());
  await assert.rejects(f.credits.reserveCheck(next.scope, pricing.id), {
    code: "INSUFFICIENT_CREDITS",
  });
  assert.equal((await f.credits.history(f.owner)).length, 4);
  const rulesAgent = await f.agent();
  await f.credits.setAgentLimit(f.owner, rulesAgent.id, "0", 0);
  const rules = await f.check(rulesAgent, [], "rules");
  assert.equal((await f.credits.reserveCheck(rules.scope, pricing.id)).maximumUnits, "0");
  await f.finish(rules);
  assert.equal((await f.credits.settleCheck(rules.scope.checkId)).chargedUnits, "0");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "-16");
  await f.invariant();
});

test("a valid-looking incomplete result is free and all billing tables remain private", async (t) => {
  const f = await setup(t);
  await f.fund();
  const c = await f.check(await f.agent());
  await f.credits.reserveCheck(c.scope, pricing.id);
  await f.costs.start(c.providerScope, "direct", { sha256: "a".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  await f.costs.complete(c.providerScope, "direct", { input: 10, output: 2 });
  await f.costs.finish(c.providerScope);
  await f.runtime.finishCheck(c.lease, {
    outcome: "held",
    outcomeText: "partial wait",
    decision: { protocol: "studio-perps-check-v2", incomplete: true },
  });
  assert.equal((await f.credits.settleCheck(c.scope.checkId)).status, "released");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "5000");
  const tables = await f.db.pool.query(
    "SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='billing' AND c.relkind='r'",
  );
  assert.equal(tables.rowCount, 8);
  assert.ok(tables.rows.every((row) => row.relrowsecurity));
  assert.equal(
    (await f.db.pool.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='billing'"))
      .rows[0].n,
    0,
  );
  await f.invariant();
});

test("reserving without funds never starts a call, and pricing snapshots remain frozen", async (t) => {
  const f = await setup(t);
  const c = await f.check(await f.agent());
  await assert.rejects(f.credits.reserveCheck(c.scope, pricing.id), {
    code: "INSUFFICIENT_CREDITS",
  });
  assert.equal(
    (
      await f.db.pool.query("SELECT status FROM pickler.perps_check_calls WHERE check_id=$1", [
        c.scope.checkId,
      ])
    ).rows[0].status,
    "reserved",
  );
  assert.equal(
    (await f.db.pool.query("SELECT count(*)::int AS n FROM billing.ai_credit_operations")).rows[0]
      .n,
    0,
  );
  await f.fund();
  await f.credits.reserveCheck(c.scope, pricing.id);
  const futurePricing = {
    ...pricing,
    id: randomUUID(),
    version: "controlled-only-v2",
    rates: [{ ...rate, inputUnitsPerMillion: "99000000" }],
  };
  await f.credits.addPricing(futurePricing);
  await assert.rejects(f.credits.reserveCheck(c.scope, futurePricing.id), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  await f.costs.start(c.providerScope, "direct", { sha256: "a".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  await f.costs.complete(c.providerScope, "direct", { input: 10, output: 2 });
  await f.finish(c);
  assert.equal((await f.credits.settleCheck(c.scope.checkId)).chargedUnits, "16");
  await f.invariant();
});

test("day boundaries reset only spending windows, never purchased balance or pending reserves", async (t) => {
  const f = await setup(t);
  await f.fund();
  const a = await f.agent();
  await f.credits.setAgentLimit(f.owner, a.id, "1300", 0);
  const c = await f.check(a);
  await f.credits.reserveCheck(c.scope, pricing.id);
  await f.costs.start(c.providerScope, "direct", { sha256: "a".repeat(64), bytes: 100 });
  await f.credits.recordCallStart(c.scope, "direct");
  await f.costs.complete(c.providerScope, "direct", { input: 1000, output: 100 });
  await f.finish(c);
  await f.credits.settleCheck(c.scope.checkId);
  const sameDay = await f.check(a);
  await assert.rejects(f.credits.reserveCheck(sameDay.scope, pricing.id), {
    code: "DAILY_CREDIT_LIMIT",
  });
  await f.finish(sameDay, false);
  f.advance(24 * 3600000);
  const tomorrow = await f.check(a);
  await f.credits.reserveCheck(tomorrow.scope, pricing.id);
  const balance = await f.credits.account(f.owner);
  assert.equal(balance.balanceUnits, "3700");
  assert.equal(balance.reservedUnits, "1300");
  assert.equal(balance.availableUnits, "2400");
  await assert.rejects(f.credits.recoverCheck(tomorrow.scope.checkId), { code: "CHECK_PENDING" });
  await f.invariant();
});

test("billing migrations preserve prior AUSD documents, checks and provider reservations", async (t) => {
  const f = await setup(t);
  const a = await f.agent();
  const c = await f.check(a);
  await f.db.pool.query(
    "INSERT INTO pickler.perps_paper_accounts(id,tenant_id,agent_id,session_id,network,document) VALUES($1,$2,$3,'historical','testnet',$4)",
    [randomUUID(), a.tenantId, a.agentId, { balance: "123.456789", historical: true }],
  );
  const read = async () => {
    const rows = [];
    for (const table of [
      "perps_paper_accounts",
      "perps_checks",
      "perps_check_calls",
      "perps_check_reservations",
    ]) {
      rows.push(
        (
          await f.db.pool.query(
            `SELECT to_jsonb(t) AS document FROM pickler.${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
      );
    }
    return rows;
  };
  const before = await read();
  // This is a test-owned disposable database, never an operator rollback recipe.
  await f.db.pool.query("DROP SCHEMA billing CASCADE");
  // Only remove the fixed billing history; later unrelated tables stay applied.
  const billingMigrations = readMigrationFiles({ migrationsFolder }).slice(29, 32);
  await f.db.pool.query(
    "DELETE FROM pickler_migrations.__drizzle_migrations WHERE hash=ANY($1::text[])",
    [billingMigrations.map((m) => m.hash)],
  );
  await Promise.all([migrateDatabase(f.db.pool), migrateDatabase(f.db.pool)]);
  assert.deepEqual(await read(), before);
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "0");
  assert.equal(
    (
      await f.db.pool.query("SELECT status FROM pickler.perps_check_calls WHERE check_id=$1", [
        c.scope.checkId,
      ])
    ).rows[0].status,
    "reserved",
  );
});

test("revocation after reservation prevents call attribution and failed recovery releases credits", async (t) => {
  const f = await setup(t);
  await f.fund();
  const a = await f.agent();
  const c = await f.check(a);
  await f.credits.reserveCheck(c.scope, pricing.id);
  await f.db.pool.query(
    "UPDATE pickler.agents SET version=version+1 WHERE tenant_id=$1 AND id=$2",
    [a.tenantId, a.agentId],
  );
  await assert.rejects(f.credits.recordCallStart(c.scope, "direct"), { code: "CONFIG_CHANGED" });
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT status FROM billing.ai_credit_call_allocations WHERE check_id=$1",
        [c.scope.checkId],
      )
    ).rows[0].status,
    "reserved",
  );
  f.advance(61000);
  await f.credits.recoverCheck(c.scope.checkId);
  assert.equal((await f.credits.account(f.owner)).reservedUnits, "0");
  assert.equal((await f.credits.account(f.owner)).balanceUnits, "5000");
  await f.invariant();
});
