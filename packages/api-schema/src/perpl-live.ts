import { z } from "zod";
import { unsignedActivitySchema } from "./http.js";
import { signedActivitySchema } from "./studio.js";

const ausd = z.string().regex(/^-?\d+(?:\.\d{1,6})?$/);
/** Owner-supplied import only. These values never appear in response DTOs. */
export const perplLiveExistingKeySchema = z
  .object({
    useKeyWallet: z.boolean().optional(),
    apiKey: z
      .string()
      .regex(/^[\x21-\x7e]{1,2048}$/)
      .meta({ writeOnly: true }),
    privateKeyHex: z
      .string()
      .regex(/^(?:0x)?[a-f\d]{64}$/i)
      .meta({ writeOnly: true }),
  })
  .strict();
export type PerplLiveExistingKeyDto = z.infer<typeof perplLiveExistingKeySchema>;
export const perplLiveStartSchema = z
  .object({
    symbol: z.string().min(1).max(32),
    marginAusd: z.string().regex(/^\d{1,4}(?:\.\d{1,6})?$/),
    leverage: z.literal(1),
    cycles: z.number().int().min(1).max(3),
    holdSeconds: z.number().int().min(30).max(3600),
  })
  .strict();
export const perplLiveSetupRequestSchema = z
  .object({ collateralAusd: z.string().regex(/^\d{1,4}(?:\.\d{1,6})?$/) })
  .strict();
export const perplLiveConfirmSchema = z
  .object({ setupId: z.string().uuid(), signed: signedActivitySchema })
  .strict();
export const perplLiveControlSchema = z
  .object({ action: z.enum(["pause", "resume", "stop", "close"]) })
  .strict();
export const perplLiveSetupSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["approve", "create_account", "deposit", "forwarding", "enroll"]),
    status: z.enum([
      "preparing",
      "awaiting_signature",
      "signing",
      "unknown",
      "submitted",
      "confirmed",
      "failed",
    ]),
    collateralAusd: ausd,
    activity: unsignedActivitySchema.nullable(),
    txHash: z
      .string()
      .regex(/^0x[a-f\d]{64}$/i)
      .nullable(),
    error: z.string().nullable(),
  })
  .strict();
export const perplLiveSessionSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["active", "paused", "stopping", "stopped", "completed", "frozen"]),
    settings: perplLiveStartSchema,
    completedCycles: z.number().int().nonnegative(),
    openedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    error: z.string().nullable(),
  })
  .strict();
export const perplLivePositionSchema = z
  .object({
    managedBySession: z.boolean().optional(),
    id: z.string(),
    symbol: z.string(),
    side: z.enum(["long", "short"]),
    closed: z.boolean(),
    size: z.string().nullable(),
    entryPrice: z.string().nullable(),
    markPrice: z.string().nullable(),
    exitPrice: z.string().nullable(),
    collateralAusd: ausd,
    leverage: z.number(),
    unrealizedPnlAusd: ausd.nullable(),
    realizedPnlAusd: ausd.nullable(),
    fundingAusd: ausd.nullable(),
    feeAusd: ausd,
  })
  .strict();
export const perplLiveOrderSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    requestId: z.number().int().nonnegative(),
    orderId: z.number().int().nonnegative().nullable(),
    symbol: z.string(),
    action: z.enum(["open_long", "open_short", "close_long", "close_short"]),
    status: z.enum([
      "prepared",
      "dispatching",
      "unknown",
      "accepted",
      "filled",
      "partial",
      "rejected",
      "cancelled",
      "expired",
    ]),
    createdAt: z.string().datetime(),
    filledSize: z.string().nullable(),
    fillPrice: z.string().nullable(),
    feeAusd: ausd.nullable(),
    txHashes: z.array(z.string().regex(/^0x[a-f\d]{64}$/i)).max(10),
    error: z.string().nullable(),
  })
  .strict();
export const perplLiveStateSchema = z
  .object({
    available: z.boolean(),
    admissionsEnabled: z.boolean(),
    setupEnabled: z.boolean().optional(),
    connection: z.enum(["agent_wallet", "key_wallet"]).optional(),
    network: z.literal("testnet"),
    address: z.string().nullable(),
    accountId: z.number().int().positive().nullable(),
    setupRequired: z.boolean(),
    requirements: z
      .object({
        minimumAccountAusd: ausd,
        minimumDepositAusd: ausd,
        maximumCollateralAusd: ausd,
      })
      .strict()
      .nullable()
      .optional(),
    keyExpiresAt: z.string().datetime().nullable(),
    setup: z.array(perplLiveSetupSchema).max(100),
    session: perplLiveSessionSchema.nullable(),
    balanceAusd: ausd.nullable(),
    observedAt: z.string().datetime().nullable(),
    positions: z.array(perplLivePositionSchema).max(100),
    orders: z.array(perplLiveOrderSchema).max(100),
  })
  .strict();
export type PerplLiveStateDto = z.infer<typeof perplLiveStateSchema>;
export type PerplLiveStartDto = z.infer<typeof perplLiveStartSchema>;
export type PerplLiveSetupDto = z.infer<typeof perplLiveSetupSchema>;
