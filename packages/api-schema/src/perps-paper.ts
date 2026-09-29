import { z } from "zod";
const decimal = z.string().regex(/^-?(0|[1-9]\d{0,35})(\.\d{1,18})?$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const symbol = z.enum(["BTC", "ETH"]);
export const perpsPaperScopeSchema = z
  .object({
    tenantId: z.string().min(1),
    agentId: z.string().min(1),
    sessionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
    network: z.enum(["mainnet", "testnet"]),
  })
  .strict();
export const perpsPaperIntentSchema = z
  .object({
    kind: z.enum(["open", "close"]),
    symbol,
    side: z.enum(["long", "short"]),
    notional: decimal,
    feeReserve: decimal,
  })
  .strict();
export const perpsPaperPositionSchema = z
  .object({
    id: z.string(),
    symbol,
    side: z.enum(["long", "short"]),
    quantity: decimal,
    entryPrice: decimal,
    entryNotional: decimal,
    openedAt: time,
    entryBlock: time,
    mark: decimal.nullable(),
    markAt: time.nullable(),
    closedAt: time.nullable(),
    exitPrice: decimal.nullable(),
    exitBlock: time.nullable(),
  })
  .strict();
export const perpsPaperAccountSchema = z
  .object({
    scope: perpsPaperScopeSchema,
    agentVersion: time.positive(),
    policy: z.literal("conservative-1x-v1"),
    createdAt: time,
    cash: decimal,
    peakEquity: decimal,
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dayEquity: decimal.nullable(),
    dailyBlocked: z.boolean(),
    blocked: z.boolean(),
    fundingPending: z.boolean(),
    fundingDisputed: z.boolean().optional(),
    admissionsClosed: z.boolean().optional(),
    lastValuationAt: time.optional(),
    positions: z.array(perpsPaperPositionSchema),
  })
  .strict();
export const perpsPaperAttemptSchema = z
  .object({
    key: z.string(),
    intent: perpsPaperIntentSchema,
    status: z.enum(["pending", "filled", "rejected", "failed", "interrupted"]),
    reserved: decimal,
    createdAt: time,
    finishedAt: time.nullable(),
    reason: z.string().nullable(),
    evidence: z.unknown(),
  })
  .strict();
export const perpsPaperMovementSchema = z
  .object({
    key: z.string(),
    kind: z.enum(["initial", "fee", "realized-pnl", "funding"]),
    delta: decimal,
    at: time,
    evidence: z.unknown(),
  })
  .strict();
export const perpsPaperViewSchema = z
  .object({
    account: perpsPaperAccountSchema,
    attempts: z.array(perpsPaperAttemptSchema),
    movements: z.array(perpsPaperMovementSchema),
  })
  .strict();
export const perpsPaperRiskSchema = z
  .object({
    allowed: z.boolean(),
    reasons: z.array(z.string()),
    closeSymbols: z.array(symbol),
    cash: decimal,
    equity: decimal.nullable(),
    unrealized: decimal.nullable(),
    margin: decimal,
    reserved: decimal,
    available: decimal.nullable(),
    exposure: decimal.nullable(),
  })
  .strict();
