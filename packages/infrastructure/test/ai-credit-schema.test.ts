import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiCreditBalanceSchema,
  aiCreditCallBreakdownSchema,
  aiCreditHistorySchema,
  aiCreditPurchaseSchema,
} from "@pickler/api-schema";

test("credit DTOs carry exact strings and reject provider/internal fields", () => {
  const balance = {
    balanceUnits: "1000000",
    reservedUnits: "1",
    availableUnits: "999999",
    unitsPerCredit: "1000000",
    status: "active",
  };
  assert.equal(aiCreditBalanceSchema.safeParse(balance).success, true);
  assert.equal(aiCreditBalanceSchema.safeParse({ ...balance, costMicros: "1" }).success, false);
  assert.equal(
    aiCreditBalanceSchema.safeParse({ ...balance, balanceUnits: 1000000 }).success,
    false,
  );
  assert.equal(
    aiCreditBalanceSchema.safeParse({
      ...balance,
      balanceUnits: "-3",
      availableUnits: "0",
      status: "blocked",
    }).success,
    true,
  );
  assert.equal(aiCreditHistorySchema.safeParse({ items: [], nextCursor: null }).success, true);
  const purchase = {
    id: "11111111-1111-4111-8111-111111111111",
    creditUnits: "100",
    paymentAmount: "100",
    paymentUnit: "controlled",
    paymentScale: 6,
    paymentMethod: "controlled",
    status: "pending",
    expiresAt: "2026-10-05T12:00:00Z",
  };
  assert.equal(aiCreditPurchaseSchema.safeParse(purchase).success, true);
  assert.equal(
    aiCreditPurchaseSchema.safeParse({ ...purchase, evidenceSha256: "secret" }).success,
    false,
  );
  assert.equal(
    aiCreditCallBreakdownSchema.safeParse({
      agentId: purchase.id,
      operationId: purchase.id,
      provider: "controlled",
      model: "test",
      reservedUnits: "100",
      chargedUnits: null,
      status: "started",
    }).success,
    true,
  );
});
