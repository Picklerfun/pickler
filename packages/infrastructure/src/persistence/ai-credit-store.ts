import { createHash } from "node:crypto";
import {
  AiCreditError,
  creditUnits,
  priceCreditTokens,
  validateCreditPricing,
  type AiCreditAccount,
  type AiCreditCheckScope,
  type AiCreditLedgerEntry,
  type AiCreditOperation,
  type AiCreditPricing,
  type AiCreditPurchase,
  type AiCreditPurchaseInput,
  type AiCreditRate,
  type AiCreditRepository,
  type AiCreditVerifiedPayment,
} from "@pickler/core";
import type { Pool, PoolClient } from "pg";
import type { StudioCallPlan } from "@pickler/trading/perps";
import { assertPerpsHourlyReady } from "./perps-hourly-readiness.js";

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const fail = (code: string, message: string): never => {
  throw new AiCreditError(code, message);
};
const accountView = (r: Record<string, unknown>): AiCreditAccount => ({
  id: String(r.id),
  userId: String(r.user_id),
  balanceUnits: String(r.balance_units),
  reservedUnits: String(r.reserved_units),
  availableUnits: (BigInt(String(r.balance_units)) > BigInt(String(r.reserved_units))
    ? BigInt(String(r.balance_units)) - BigInt(String(r.reserved_units))
    : 0n
  ).toString(),
  status: r.status as AiCreditAccount["status"],
  version: Number(r.version),
});
const operationView = (r: Record<string, unknown>): AiCreditOperation => ({
  id: String(r.id),
  accountId: String(r.account_id),
  checkId: String(r.check_id),
  maximumUnits: String(r.maximum_units),
  chargedUnits: String(r.charged_units),
  status: r.status as AiCreditOperation["status"],
});
const purchaseView = (r: Record<string, unknown>): AiCreditPurchase => ({
  id: String(r.id),
  accountId: String(r.account_id),
  userId: String(r.user_id),
  requestKey: String(r.request_key),
  creditUnits: String(r.credit_units),
  paymentAmount: String(r.payment_amount),
  paymentUnit: String(r.payment_unit),
  paymentScale: Number(r.payment_scale),
  paymentMethod: String(r.payment_method),
  quoteVersion: String(r.quote_version),
  expiresAt: (r.expires_at as Date).toISOString(),
  status: r.status as AiCreditPurchase["status"],
});

/** Private foundation only. No checkout, public route, model transport or runtime activation. */
export class PostgresAiCreditStore implements AiCreditRepository {
  constructor(
    readonly pool: Pool,
    private readonly clock?: () => number,
  ) {}
  private async now(db: PoolClient): Promise<Date> {
    if (this.clock) {
      return new Date(this.clock());
    }
    return (await db.query("SELECT clock_timestamp() AS at")).rows[0].at;
  }
  private async transaction<T>(
    userId: string,
    action: (db: PoolClient, account: AiCreditAccount, at: Date) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO billing.ai_credit_accounts(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",
        [userId],
      );
      const row = await db.query(
        "SELECT * FROM billing.ai_credit_accounts WHERE user_id=$1 FOR UPDATE",
        [userId],
      );
      const result = await action(db, accountView(row.rows[0]), await this.now(db));
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  async account(userId: string): Promise<AiCreditAccount> {
    return this.transaction(userId, async (_db, account) => account);
  }
  async addPricing(pricing: AiCreditPricing): Promise<void> {
    validateCreditPricing(pricing);
    const inserted = await this.pool.query(
      `INSERT INTO billing.ai_credit_pricing_versions(id,version,reviewed_at,rates)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [pricing.id, pricing.version, pricing.reviewedAt, JSON.stringify(pricing.rates)],
    );
    if (!inserted.rowCount) {
      const prior = await this.pool.query(
        "SELECT * FROM billing.ai_credit_pricing_versions WHERE id=$1",
        [pricing.id],
      );
      const row = prior.rows[0];
      if (
        !row ||
        row.version !== pricing.version ||
        row.reviewed_at.toISOString() !== new Date(pricing.reviewedAt).toISOString() ||
        hash(row.rates) !== hash(pricing.rates)
      ) {
        fail("PRICING_CONFLICT", "Pricing versions cannot be replaced");
      }
    }
  }
  private async post(
    db: PoolClient,
    accountId: string,
    input: {
      key: string;
      kind: string;
      balance: bigint;
      reserved: bigint;
      reason: string;
      operationId?: string;
      purchaseId?: string;
    },
  ): Promise<void> {
    await db.query(
      `INSERT INTO billing.ai_credit_ledger(account_id,key,kind,balance_delta_units,reserved_delta_units,reason,operation_id,purchase_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        accountId,
        input.key,
        input.kind,
        input.balance.toString(),
        input.reserved.toString(),
        input.reason,
        input.operationId ?? null,
        input.purchaseId ?? null,
      ],
    );
    // Only the ledger INSERT trigger updates the projection, in this same transaction.
  }
  async createPurchase(input: AiCreditPurchaseInput): Promise<AiCreditPurchase> {
    if (
      creditUnits(input.creditUnits) === 0n ||
      creditUnits(input.paymentAmount) === 0n ||
      !Number.isInteger(input.paymentScale) ||
      input.paymentScale < 0 ||
      input.paymentScale > 30 ||
      ![input.requestKey, input.paymentUnit, input.paymentMethod, input.quoteVersion].every(
        (v) => v.trim() && v.length <= 256,
      ) ||
      !Number.isFinite(Date.parse(input.expiresAt))
    ) {
      fail("INVALID_PURCHASE", "Explicit quote amounts, units and expiry required");
    }
    const fingerprint = hash([
      input.creditUnits,
      input.paymentAmount,
      input.paymentUnit,
      input.paymentScale,
      input.paymentMethod,
      input.quoteVersion,
      new Date(input.expiresAt).toISOString(),
    ]);
    return this.transaction(input.userId, async (db, account, at) => {
      const prior = await db.query(
        "SELECT * FROM billing.ai_credit_purchases WHERE account_id=$1 AND request_key=$2",
        [account.id, input.requestKey],
      );
      if (prior.rowCount) {
        if (prior.rows[0].request_sha256 !== fingerprint) {
          fail("IDEMPOTENCY_CONFLICT", "Purchase key reused with different quote");
        }
        return purchaseView({ ...prior.rows[0], user_id: input.userId });
      }
      if (Date.parse(input.expiresAt) <= at.getTime()) {
        fail("QUOTE_EXPIRED", "Quote has expired");
      }
      const created = await db.query(
        `INSERT INTO billing.ai_credit_purchases(account_id,request_key,request_sha256,credit_units,payment_amount,payment_unit,payment_scale,payment_method,quote_version,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          account.id,
          input.requestKey,
          fingerprint,
          input.creditUnits,
          input.paymentAmount,
          input.paymentUnit,
          input.paymentScale,
          input.paymentMethod,
          input.quoteVersion,
          input.expiresAt,
        ],
      );
      return purchaseView({ ...created.rows[0], user_id: input.userId });
    });
  }
  async purchase(userId: string, id: string): Promise<AiCreditPurchase> {
    const result = await this.pool.query(
      `SELECT p.*,a.user_id FROM billing.ai_credit_purchases p
       JOIN billing.ai_credit_accounts a ON a.id=p.account_id WHERE p.id=$1 AND a.user_id=$2`,
      [id, userId],
    );
    if (!result.rowCount) {
      fail("NOT_FOUND", "Purchase unavailable");
    }
    const view = purchaseView(result.rows[0]);
    // This read reports expiry without writing or overriding settled/review states.
    if (view.status === "pending" && Date.parse(view.expiresAt) <= (this.clock?.() ?? Date.now())) {
      view.status = "expired";
    }
    return view;
  }
  /** Trusted verifier result only; no model/client supplied settlement proof. */
  async recordVerifiedPayment(payment: AiCreditVerifiedPayment): Promise<AiCreditPurchase> {
    creditUnits(payment.amount);
    if (
      ![
        payment.provider,
        payment.eventId,
        payment.paymentId,
        payment.unit,
        payment.recipient,
        payment.expectedRecipient,
      ].every((v) => v.trim() && v.length <= 512) ||
      !/^[a-f0-9]{64}$/.test(payment.evidenceSha256) ||
      !Number.isFinite(Date.parse(payment.settledAt)) ||
      !Number.isInteger(payment.scale) ||
      payment.scale < 0 ||
      payment.scale > 30
    ) {
      fail("INVALID_PAYMENT", "Verified bounded settlement identity required");
    }
    const owner = await this.pool.query(
      `SELECT a.user_id FROM billing.ai_credit_accounts a JOIN billing.ai_credit_purchases p ON p.account_id=a.id WHERE p.id=$1`,
      [payment.purchaseId],
    );
    if (!owner.rowCount) {
      fail("NOT_FOUND", "Purchase unavailable");
    }
    return this.transaction(owner.rows[0].user_id, async (db, account, at) => {
      const purchase = (
        await db.query(
          "SELECT * FROM billing.ai_credit_purchases WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [payment.purchaseId, account.id],
        )
      ).rows[0];
      const identity = hash([
        payment.purchaseId,
        payment.provider,
        payment.paymentId,
        payment.amount,
        payment.unit,
        payment.scale,
        payment.recipient,
        payment.expectedRecipient,
        payment.valid,
      ]);
      // Serializes duplicate event/payment identities across distinct payer accounts.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify([payment.provider, payment.paymentId]),
      ]);
      const previous = await db.query(
        `SELECT * FROM billing.ai_credit_payment_events WHERE provider=$1 AND (event_id=$2 OR payment_id=$3)`,
        [payment.provider, payment.eventId, payment.paymentId],
      );
      if (previous.rowCount) {
        if (previous.rows.some((r) => r.proof_sha256 !== identity)) {
          fail("PAYMENT_CONFLICT", "Payment already attributed or proof changed");
        }
        return purchaseView({ ...purchase, user_id: account.userId });
      }
      const valid =
        payment.valid &&
        payment.recipient === payment.expectedRecipient &&
        payment.amount === purchase.payment_amount &&
        payment.unit === purchase.payment_unit &&
        payment.scale === purchase.payment_scale &&
        Date.parse(payment.settledAt) <= at.getTime();
      await db.query(
        `INSERT INTO billing.ai_credit_payment_events(purchase_id,account_id,provider,event_id,payment_id,amount,unit,scale,recipient,expected_recipient,evidence_sha256,proof_sha256,verification,settled_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          payment.purchaseId,
          account.id,
          payment.provider,
          payment.eventId,
          payment.paymentId,
          payment.amount,
          payment.unit,
          payment.scale,
          payment.recipient,
          payment.expectedRecipient,
          payment.evidenceSha256,
          identity,
          valid ? "verified" : "rejected",
          payment.settledAt,
        ],
      );
      let status = purchase.status;
      if (status !== "confirmed") {
        if (!valid) {
          status = "failed";
        } else if (purchase.status !== "pending" || at >= purchase.expires_at) {
          status = "review_required";
        } else {
          status = "confirmed";
          await this.post(db, account.id, {
            key: `purchase:${purchase.id}`,
            kind: "purchase",
            balance: BigInt(purchase.credit_units),
            reserved: 0n,
            purchaseId: purchase.id,
            reason: "verified_payment",
          });
        }
        await db.query("UPDATE billing.ai_credit_purchases SET status=$2 WHERE id=$1", [
          purchase.id,
          status,
        ]);
      }
      return purchaseView({ ...purchase, status, user_id: account.userId });
    });
  }
  private async checkOwner(checkId: string): Promise<string> {
    const row = await this.pool.query(
      `SELECT w.owner_user_id FROM pickler.perps_checks c
       JOIN pickler.product_agents m ON m.product_agent_id=c.product_agent_id
       JOIN identity.workspaces w ON w.id=m.workspace_id WHERE c.id=$1`,
      [checkId],
    );
    if (!row.rowCount) {
      fail("NOT_FOUND", "Studio check unavailable");
    }
    return row.rows[0].owner_user_id;
  }
  private async guard(db: PoolClient, account: AiCreditAccount, scope: AiCreditCheckScope) {
    const runtime = await db.query(
      "SELECT version,paused FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenantId, scope.agentId],
    );
    const check = await db.query(
      `SELECT c.*,m.workspace_id,w.owner_user_id,p.killed_at FROM pickler.perps_checks c
       JOIN pickler.product_agents m ON m.product_agent_id=c.product_agent_id
       JOIN agents.agents p ON p.id=m.product_agent_id
       JOIN identity.workspaces w ON w.id=m.workspace_id
       WHERE c.id=$1 AND c.tenant_id=$2 AND c.agent_id=$3 AND m.tenant_id=$2
         AND m.runtime_agent_id=$3 FOR UPDATE OF c,w`,
      [scope.checkId, scope.tenantId, scope.agentId],
    );
    const row = check.rows[0];
    const at = await this.now(db);
    if (!row || row.owner_user_id !== account.userId) {
      fail("SCOPE_MISMATCH", "Billing owner and check must match");
    }
    if (
      runtime.rows[0]?.version !== scope.configVersion ||
      row.config_version !== scope.configVersion
    ) {
      fail("CONFIG_CHANGED", "Check configuration changed");
    }
    if (
      row.status !== "running" ||
      row.lease_owner !== scope.leaseOwner ||
      Number(row.lease_expires_at) <= at.getTime()
    ) {
      fail("LEASE_LOST", "Check execution ownership expired");
    }
    if (runtime.rows[0].paused || row.killed_at || !["manual", "hourly"].includes(row.trigger)) {
      fail("NOT_READY", "Paid checks require an available agent");
    }
    if (row.trigger === "hourly") {
      await assertPerpsHourlyReady(db, scope);
    }
    return row;
  }
  async reserveCheck(scope: AiCreditCheckScope, pricingId: string): Promise<AiCreditOperation> {
    const userId = await this.checkOwner(scope.checkId);
    return this.transaction(userId, async (db, account, at) => {
      const check = await this.guard(db, account, scope);
      const existing = await db.query(
        "SELECT * FROM billing.ai_credit_operations WHERE check_id=$1",
        [scope.checkId],
      );
      if (existing.rowCount) {
        if (
          existing.rows[0].pricing_id !== pricingId ||
          existing.rows[0].lease_owner !== scope.leaseOwner
        ) {
          fail("IDEMPOTENCY_CONFLICT", "Billing plan or owner changed");
        }
        if (existing.rows[0].status !== "active") {
          fail("OPERATION_FINISHED", "Finished billing cannot restart");
        }
        return operationView(existing.rows[0]);
      }
      const pricing = (
        await db.query("SELECT rates FROM billing.ai_credit_pricing_versions WHERE id=$1", [
          pricingId,
        ])
      ).rows[0];
      if (!pricing) {
        fail("PRICING_MISSING", "Reviewed credit pricing required");
      }
      const calls = await db.query(
        "SELECT key,plan,status FROM pickler.perps_check_calls WHERE check_id=$1 ORDER BY key",
        [scope.checkId],
      );
      const reservation = await db.query(
        "SELECT status,strategy FROM pickler.perps_check_reservations WHERE check_id=$1",
        [scope.checkId],
      );
      if (reservation.rows[0]?.status !== "active") {
        fail("RESERVATION_MISSING", "Existing provider call plan required");
      }
      if (calls.rows.some((r) => r.status !== "reserved")) {
        fail("CALL_ALREADY_STARTED", "Credit admission must precede model calls");
      }
      if (reservation.rows[0].strategy?.id === "rules" && calls.rowCount) {
        fail("INVALID_PLAN", "Rules cannot consume paid calls");
      }
      const allocations = calls.rows
        .filter((r) => (r.plan as StudioCallPlan).maximumMicros === undefined)
        .map((r) => {
          const plan = r.plan as StudioCallPlan;
          const rate = (pricing.rates as AiCreditRate[]).find(
            (x) => x.provider === plan.provider && x.model === plan.model,
          );
          if (!rate) {
            return fail("PRICING_MISSING", "Model credit tariff not reviewed");
          }
          return {
            key: r.key,
            rate,
            maximum: priceCreditTokens(rate, plan.maxInputTokens, plan.maxOutputTokens),
          };
        });
      const maximum = allocations.reduce((n, r) => n + BigInt(r.maximum), 0n);
      creditUnits(maximum.toString());
      if (
        maximum > 0n &&
        (account.status !== "active" || maximum > BigInt(account.availableUnits))
      ) {
        fail("INSUFFICIENT_CREDITS", "Insufficient shared AI credits");
      }
      const limit = (
        await db.query("SELECT * FROM billing.ai_credit_agent_limits WHERE product_agent_id=$1", [
          check.product_agent_id,
        ])
      ).rows[0];
      const day = at.toISOString().slice(0, 10);
      if (maximum > 0n && limit?.daily_units !== null && limit?.daily_units !== undefined) {
        const used = await db.query(
          `SELECT coalesce(sum(CASE WHEN status='active' THEN maximum_units ELSE charged_units END),0)::text AS units
           FROM billing.ai_credit_operations WHERE account_id=$1 AND product_agent_id=$2 AND admitted_day=$3`,
          [account.id, check.product_agent_id, day],
        );
        if (BigInt(used.rows[0].units) + maximum > BigInt(limit.daily_units)) {
          fail("DAILY_CREDIT_LIMIT", "Creator daily credit limit reached");
        }
      }
      const result = await db.query(
        `INSERT INTO billing.ai_credit_operations(account_id,check_id,product_agent_id,workspace_id,tenant_id,runtime_agent_id,config_version,lease_owner,pricing_id,maximum_units,admitted_day,limit_version,daily_limit_units)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          account.id,
          scope.checkId,
          check.product_agent_id,
          check.workspace_id,
          scope.tenantId,
          scope.agentId,
          scope.configVersion,
          scope.leaseOwner,
          pricingId,
          maximum.toString(),
          day,
          limit?.version ?? 0,
          limit?.daily_units ?? null,
        ],
      );
      const operation = operationView(result.rows[0]);
      for (const r of allocations) {
        await db.query(
          `INSERT INTO billing.ai_credit_call_allocations(operation_id,check_id,call_key,provider,model,rate,maximum_units)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            operation.id,
            scope.checkId,
            r.key,
            r.rate.provider,
            r.rate.model,
            JSON.stringify(r.rate),
            r.maximum,
          ],
        );
      }
      await this.post(db, account.id, {
        key: `reserve:${scope.checkId}`,
        kind: "reserve",
        balance: 0n,
        reserved: maximum,
        operationId: operation.id,
        reason: "studio_check",
      });
      await this.guard(db, account, scope);
      return operation;
    });
  }
  /** Invoke after the existing cost-store start and before model transport. Never starts/replays a model. */
  async recordCallStart(scope: AiCreditCheckScope, key: string): Promise<void> {
    const userId = await this.checkOwner(scope.checkId);
    await this.transaction(userId, async (db, account) => {
      await this.guard(db, account, scope);
      if (account.status !== "active") {
        fail("ACCOUNT_BLOCKED", "Credit account requires payment reconciliation");
      }
      const operation = (
        await db.query(
          "SELECT * FROM billing.ai_credit_operations WHERE check_id=$1 AND account_id=$2 FOR UPDATE",
          [scope.checkId, account.id],
        )
      ).rows[0];
      if (!operation || operation.status !== "active") {
        fail("RESERVATION_MISSING", "Active customer reservation required");
      }
      const source = (
        await db.query(
          "SELECT * FROM pickler.perps_check_calls WHERE check_id=$1 AND key=$2 FOR UPDATE",
          [scope.checkId, key],
        )
      ).rows[0];
      if (!source || source.status !== "started" || !source.request_sha256) {
        fail("CALL_NOT_STARTED", "Existing provider start and original hash required");
      }
      const changed = await db.query(
        `UPDATE billing.ai_credit_call_allocations SET status='started',request_sha256=$3,started_at=clock_timestamp()
         WHERE check_id=$1 AND call_key=$2 AND status='reserved'`,
        [scope.checkId, key, source.request_sha256],
      );
      if (!changed.rowCount) {
        fail("CALL_ALREADY_STARTED", "Customer call cannot restart");
      }
      await this.guard(db, account, scope);
    });
  }
  private async terminal(checkId: string, recover: boolean): Promise<AiCreditOperation> {
    const userId = await this.checkOwner(checkId);
    return this.transaction(userId, async (db, account, at) => {
      const hint = (
        await db.query(
          "SELECT * FROM billing.ai_credit_operations WHERE check_id=$1 AND account_id=$2",
          [checkId, account.id],
        )
      ).rows[0];
      if (!hint) {
        fail("NOT_FOUND", "Billing operation unavailable");
      }
      await db.query("SELECT 1 FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [
        hint.tenant_id,
        hint.runtime_agent_id,
      ]);
      const check = (
        await db.query("SELECT * FROM pickler.perps_checks WHERE id=$1 FOR UPDATE", [checkId])
      ).rows[0];
      const op = (
        await db.query("SELECT * FROM billing.ai_credit_operations WHERE check_id=$1 FOR UPDATE", [
          checkId,
        ])
      ).rows[0];
      if (op.status !== "active") {
        return operationView(op);
      }
      const interrupted =
        check.status === "running" && Number(check.lease_expires_at) <= at.getTime();
      if (check.status !== "finished" && !(recover && interrupted)) {
        fail("CHECK_PENDING", "Live check reservations cannot expire automatically");
      }
      const success =
        check.status === "finished" &&
        !["failed", "skipped", "system"].includes(check.outcome) &&
        check.decision?.protocol === "studio-perps-check-v2" &&
        check.decision?.incomplete === false;
      const calls = await db.query(
        `SELECT a.*,c.status AS provider_status,c.input_tokens,c.output_tokens,c.plan,c.request_sha256 AS provider_hash
         FROM billing.ai_credit_call_allocations a JOIN pickler.perps_check_calls c ON c.check_id=a.check_id AND c.key=a.call_key
         WHERE a.operation_id=$1 ORDER BY a.call_key FOR UPDATE OF a,c`,
        [op.id],
      );
      let charge = 0n;
      for (const row of calls.rows) {
        let units = "0";
        if (success && row.provider_status !== "skipped") {
          if (
            row.provider_status !== "completed" ||
            row.status !== "started" ||
            row.request_sha256 !== row.provider_hash ||
            row.input_tokens === null ||
            row.output_tokens === null
          ) {
            fail("USAGE_UNKNOWN", "Valid completion requires known original usage");
          }
          const plan = row.plan as StudioCallPlan;
          if (row.input_tokens > plan.maxInputTokens || row.output_tokens > plan.maxOutputTokens) {
            fail("INVALID_USAGE", "Usage exceeds provider plan");
          }
          units = priceCreditTokens(row.rate, row.input_tokens, row.output_tokens);
          if (BigInt(units) > BigInt(row.maximum_units)) {
            fail("INVALID_USAGE", "Charge exceeds customer allocation");
          }
        }
        charge += BigInt(units);
        await db.query(
          "UPDATE billing.ai_credit_call_allocations SET status=$2,charged_units=$3 WHERE id=$1",
          [row.id, success ? "settled" : "released", units],
        );
      }
      if (charge > BigInt(op.maximum_units)) {
        fail("INVALID_USAGE", "Charge exceeds operation reservation");
      }
      await this.post(db, account.id, {
        key: `finish:${checkId}`,
        kind: success ? "settle" : "release",
        balance: -charge,
        reserved: -BigInt(op.maximum_units),
        operationId: op.id,
        reason: success ? "valid_analysis" : "failed_or_interrupted_analysis",
      });
      const result = await db.query(
        "UPDATE billing.ai_credit_operations SET status=$2,charged_units=$3,finished_at=$4 WHERE id=$1 RETURNING *",
        [op.id, success ? "settled" : "released", charge.toString(), at],
      );
      return operationView(result.rows[0]);
    });
  }
  async settleCheck(checkId: string) {
    return this.terminal(checkId, false);
  }
  async recoverCheck(checkId: string) {
    return this.terminal(checkId, true);
  }
  async setAgentLimit(
    userId: string,
    productAgentId: string,
    dailyUnits: string | null,
    expectedVersion: number,
  ): Promise<number> {
    if (dailyUnits !== null) {
      creditUnits(dailyUnits);
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      fail("INVALID_VERSION", "Expected limit version required");
    }
    return this.transaction(userId, async (db, account) => {
      const owner = await db.query(
        `SELECT 1 FROM agents.agents a JOIN identity.workspaces w ON w.id=a.workspace_id
         WHERE a.id=$1 AND w.owner_user_id=$2 FOR UPDATE OF w`,
        [productAgentId, userId],
      );
      if (!owner.rowCount) {
        fail("NOT_FOUND", "Owned agent unavailable");
      }
      const prior = (
        await db.query(
          "SELECT version FROM billing.ai_credit_agent_limits WHERE product_agent_id=$1",
          [productAgentId],
        )
      ).rows[0];
      if ((prior?.version ?? 0) !== expectedVersion) {
        fail("VERSION_CONFLICT", "Credit limit changed");
      }
      await db.query(
        `INSERT INTO billing.ai_credit_agent_limits(product_agent_id,account_id,daily_units,version)
         VALUES($1,$2,$3,$4) ON CONFLICT(product_agent_id) DO UPDATE SET daily_units=$3,version=$4,updated_at=clock_timestamp()`,
        [productAgentId, account.id, dailyUnits, expectedVersion + 1],
      );
      return expectedVersion + 1;
    });
  }
  /** Trusted operator correction/reversal only. No public top-up or arbitrary balance API. */
  async adjust(input: {
    userId: string;
    key: string;
    balanceDeltaUnits: string;
    reason: string;
    purchaseId?: string;
  }): Promise<AiCreditAccount> {
    if (
      !/^-?[1-9]\d{0,29}$/.test(input.balanceDeltaUnits) ||
      !input.key.trim() ||
      !input.reason.trim()
    ) {
      fail("INVALID_ADJUSTMENT", "Signed nonzero units and audit reason required");
    }
    return this.transaction(input.userId, async (db, account) => {
      const previous = await db.query(
        "SELECT * FROM billing.ai_credit_ledger WHERE account_id=$1 AND key=$2",
        [account.id, `adjust:${input.key}`],
      );
      if (previous.rowCount) {
        const row = previous.rows[0];
        if (
          row.balance_delta_units !== input.balanceDeltaUnits ||
          row.reason !== input.reason ||
          row.purchase_id !== (input.purchaseId ?? null)
        ) {
          fail("IDEMPOTENCY_CONFLICT", "Adjustment key reused");
        }
      } else {
        await this.post(db, account.id, {
          key: `adjust:${input.key}`,
          kind: "adjustment",
          balance: BigInt(input.balanceDeltaUnits),
          reserved: 0n,
          reason: input.reason,
          ...(input.purchaseId ? { purchaseId: input.purchaseId } : {}),
        });
      }
      return accountView(
        (await db.query("SELECT * FROM billing.ai_credit_accounts WHERE id=$1", [account.id]))
          .rows[0],
      );
    });
  }
  async history(userId: string, before?: string, limit = 50): Promise<AiCreditLedgerEntry[]> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (before !== undefined && !/^[1-9]\d{0,29}$/.test(before))
    ) {
      fail("INVALID_CURSOR", "Bounded history page required");
    }
    const rows = await this.pool.query(
      `SELECT l.* FROM billing.ai_credit_ledger l JOIN billing.ai_credit_accounts a ON a.id=l.account_id
       WHERE a.user_id=$1 AND ($2::numeric IS NULL OR l.id<$2::numeric) ORDER BY l.id DESC LIMIT $3`,
      [userId, before ?? null, limit],
    );
    return rows.rows.map((r) => ({
      id: String(r.entry_id),
      cursor: String(r.id),
      kind: r.kind,
      balanceDeltaUnits: r.balance_delta_units,
      reservedDeltaUnits: r.reserved_delta_units,
      createdAt: r.created_at.toISOString(),
      operationId: r.operation_id,
      purchaseId: r.purchase_id,
    }));
  }
}
