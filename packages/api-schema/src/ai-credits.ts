import { z } from "zod";
const units = z.string().regex(/^(0|[1-9]\d{0,29})$/);
const signedUnits = z.string().regex(/^(0|-?[1-9]\d{0,29})$/);
export const aiCreditBalanceSchema = z
  .object({
    balanceUnits: signedUnits,
    reservedUnits: units,
    availableUnits: units,
    unitsPerCredit: z.literal("1000000"),
    status: z.enum(["active", "blocked"]),
  })
  .strict();
export const aiCreditPurchaseSchema = z
  .object({
    id: z.uuid(),
    creditUnits: units,
    paymentAmount: units,
    paymentUnit: z.string().min(1),
    paymentScale: z.number().int().min(0).max(30),
    paymentMethod: z.string().min(1),
    status: z.enum(["pending", "confirmed", "failed", "expired", "review_required"]),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const aiCreditHistoryEntrySchema = z
  .object({
    id: z.uuid(),
    cursor: units,
    kind: z.enum(["purchase", "reserve", "settle", "release", "adjustment"]),
    balanceDeltaUnits: signedUnits,
    reservedDeltaUnits: signedUnits,
    createdAt: z.iso.datetime(),
    operationId: z.uuid().nullable(),
    purchaseId: z.uuid().nullable(),
  })
  .strict();
export const aiCreditHistorySchema = z
  .object({
    items: z.array(aiCreditHistoryEntrySchema),
    nextCursor: units.nullable(),
  })
  .strict();
export const aiCreditCallBreakdownSchema = z
  .object({
    agentId: z.uuid(),
    operationId: z.uuid(),
    provider: z.string().min(1),
    model: z.string().min(1),
    reservedUnits: units,
    chargedUnits: units.nullable(),
    status: z.enum(["reserved", "started", "settled", "released"]),
  })
  .strict();
export type AiCreditBalanceDto = z.infer<typeof aiCreditBalanceSchema>;
export type AiCreditPurchaseDto = z.infer<typeof aiCreditPurchaseSchema>;
export type AiCreditHistoryDto = z.infer<typeof aiCreditHistorySchema>;
export type AiCreditCallBreakdownDto = z.infer<typeof aiCreditCallBreakdownSchema>;
