import { z } from "zod";

/**
 * The Perpl paper runtime's studio DTOs (docs/specs/perpl-paper-runtime-v1.md §4). Prices and
 * stored paper amounts are decimal strings; the record's computed figures are AUSD numbers rounded
 * to the micro. Times are ISO UTC. Nothing here carries a tenant, a runtime agent id, a lease or a
 * prompt.
 */
const decimal = z.string().regex(/^-?(0|[1-9]\d{0,35})(\.\d{1,18})?$/);
const iso = z.string().datetime();
const instrument = z.enum(["BTC", "ETH"]);
const side = z.enum(["long", "short"]);

/** Mirrors trading's `CHECK_OUTCOMES`. */
export const PERPS_CHECK_OUTCOMES = [
  "entered",
  "exited",
  "held",
  "blocked",
  "proposed",
  "skipped",
  "failed",
  "system",
] as const;
/** Mirrors trading's `PERPS_CHECK_TRIGGERS`. */
export const PERPS_CHECK_TRIGGERS = ["hourly", "manual", "exits", "owner", "system"] as const;
/** Mirrors trading's `CLOSE_REASONS`. */
export const PERPS_CLOSE_REASONS = [
  "stop",
  "take_profit",
  "time",
  "brief",
  "owner",
  "stop_all",
  "day_loss",
] as const;
/** Manual checks an agent may run a UTC day (R2). */
export const PERPS_MANUAL_CHECKS_PER_DAY = 6;

export const perpsCheckOutcomeSchema = z.enum(PERPS_CHECK_OUTCOMES);

/** `POST /agents/:id/perps/checks` answers 202 with the queued check. */
export const perpsCheckStartedSchema = z.object({ checkId: z.string().uuid() }).strict();

/** Mirrors trading's `PERPS_OWNER_ACTION_KINDS`. */
export const PERPS_OWNER_ACTION_KINDS = ["close", "stop_all", "approve"] as const;
/** Mirrors trading's `PERPS_OWNER_ACTION_STATUSES`. */
export const PERPS_OWNER_ACTION_STATUSES = ["pending", "running", "done", "failed"] as const;

/**
 * An approve, a close or a stop answers 202 with the durable action the research worker carries
 * out; poll `GET /perps/actions/{actionId}`.
 */
export const perpsActionStartedSchema = z.object({ actionId: z.string().uuid() }).strict();

/**
 * `GET /perps/actions/:id`. `pending` waits for the worker (or for a running check to free the
 * agent), `running` is being carried out, `done` was carried out (its `owner` check, `checkId`,
 * says what happened: entered, blocked with a cap, closed…), `failed` could not be carried out
 * (`lastError`). `checkId` is the latest attempt's check, null before one held the agent.
 */
export const perpsActionSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(PERPS_OWNER_ACTION_KINDS),
    status: z.enum(PERPS_OWNER_ACTION_STATUSES),
    positionId: z.string().nullable(),
    proposalId: z.string().uuid().nullable(),
    attempts: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    checkId: z.string().uuid().nullable(),
    createdAt: iso,
    updatedAt: iso,
  })
  .strict();

const lineSchema = z
  .object({
    index: z.number().int().positive(),
    met: z.boolean(),
    why: z.string(),
    instrument: instrument.optional(),
  })
  .strict();

/** One check in the Decisions feed. Model fields are null where the check asked no model. */
export const perpsCheckSummarySchema = z
  .object({
    id: z.string().uuid(),
    at: iso,
    trigger: z.enum(PERPS_CHECK_TRIGGERS),
    status: z.enum(["queued", "running", "finished"]),
    outcome: perpsCheckOutcomeSchema.nullable(),
    outcomeText: z.string().nullable(),
    instrument: instrument.nullable(),
    action: z.enum(["open-long", "open-short", "close", "hold"]).nullable(),
    probability: z.number().min(0).max(1).nullable(),
    horizonHours: z.number().int().positive().nullable(),
    entries: z.array(lineSchema),
    exits: z.array(lineSchema),
    never: z.array(z.object({ index: z.number().int().positive(), broken: z.boolean() }).strict()),
    rationale: z.string().nullable(),
    inputs: z
      .object({ instruments: z.array(instrument), web: z.boolean() })
      .strict()
      .nullable(),
    configVersion: z.number().int().positive().nullable(),
    /** Known model and web cost in micro-USD; null while unknown. */
    costMicros: z
      .string()
      .regex(/^\d{1,30}$/)
      .nullable(),
    error: z.string().nullable(),
  })
  .strict();

/** One check with its timed steps, for "What it did" while it runs. */
export const perpsCheckDetailSchema = perpsCheckSummarySchema
  .extend({
    startedAt: iso.nullable(),
    finishedAt: iso.nullable(),
    steps: z.array(
      z
        .object({ at: iso, text: z.string(), ms: z.number().int().nonnegative().nullable() })
        .strict(),
    ),
  })
  .strict();

export const perpsChecksResponseSchema = z
  .object({ checks: z.array(perpsCheckSummarySchema), nextCursor: z.string().nullable() })
  .strict();

/** An open paper position, marked to the market board (null mark and P&L while unknown). */
export const perpsOpenPositionSchema = z
  .object({
    id: z.string(),
    instrument,
    side,
    quantity: decimal,
    entryPrice: decimal,
    notional: decimal,
    margin: decimal,
    leverage: z.number().int().positive(),
    openedAt: iso,
    mark: decimal.nullable(),
    unrealizedPnl: decimal.nullable(),
    stopPrice: decimal.nullable(),
    takeProfitPrice: decimal.nullable(),
    exitDueAt: iso.nullable(),
    /** Where the loss equals the margin: entry × (1 ∓ 1 / leverage); no maintenance margin or fees; null when it is zero (a long at 1×). */
    liquidationEstimate: decimal.nullable(),
    checkId: z.string().uuid().nullable(),
    configVersion: z.number().int().positive().nullable(),
  })
  .strict();

/** A closed paper position; `realizedPnl` is net of its fees. */
export const perpsClosedPositionSchema = z
  .object({
    id: z.string(),
    instrument,
    side,
    entryPrice: decimal,
    exitPrice: decimal.nullable(),
    margin: decimal,
    leverage: z.number().int().positive(),
    openedAt: iso,
    closedAt: iso,
    closeReason: z.enum(PERPS_CLOSE_REASONS).nullable(),
    realizedPnl: decimal,
  })
  .strict();

export const perpsPositionsResponseSchema = z
  .object({
    network: z.enum(["mainnet", "testnet"]),
    /** False before the first check opened the agent's paper account. */
    account: z.boolean(),
    open: z.array(perpsOpenPositionSchema),
    /** Newest first, at most 50. */
    closed: z.array(perpsClosedPositionSchema),
  })
  .strict();

/** A pending approve-mode proposal (R8). */
export const perpsProposalSchema = z
  .object({
    id: z.string().uuid(),
    checkId: z.string().uuid(),
    kind: z.enum(["enter", "size_up"]),
    instrument,
    side,
    margin: decimal,
    leverage: z.number().int().positive(),
    notional: decimal,
    createdAt: iso,
    expiresAt: iso,
    positionId: z.string().nullable(),
  })
  .strict();

export const perpsProposalsResponseSchema = z
  .object({ proposals: z.array(perpsProposalSchema) })
  .strict();

/** `POST /perps/proposals/:id/skip`: the proposal as decided. */
export const perpsProposalDecidedSchema = z
  .object({ id: z.string().uuid(), status: z.enum(["approved", "skipped", "expired"]) })
  .strict();

/** R13's record plus today's figures for the meters and Health. */
export const perpsRecordSchema = z
  .object({
    runtimeEnabled: z.boolean(),
    network: z.enum(["mainnet", "testnet"]),
    account: z.boolean(),
    realizedAusd: z.number(),
    openPnlAusd: z.number().nullable(),
    feesAndFundingAusd: z.number(),
    cashAusd: z.number(),
    equityAusd: z.number().nullable(),
    closedCount: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    hitRate: z.number().min(0).max(1).nullable(),
    maxDrawdownAusd: z.number().nonnegative(),
    maxDrawdownPct: z.number().nonnegative().nullable(),
    /** Hourly and manual checks, all time. */
    checks: z.number().int().nonnegative(),
    /** Checks that entered, all time. */
    entries: z.number().int().nonnegative(),
    series: z.array(z.object({ at: iso, equity: z.number() }).strict()),
    today: z
      .object({
        newMarginAusd: z.number().nonnegative(),
        realizedAusd: z.number(),
        openCount: z.number().int().nonnegative(),
        /** The highest leverage among open positions; 0 with none. */
        leverageInUse: z.number().int().nonnegative(),
        checks: z.number().int().nonnegative(),
        manualChecks: z.number().int().nonnegative(),
        manualLimit: z.number().int().positive(),
        costMicros: z.string().regex(/^\d{1,30}$/),
      })
      .strict(),
  })
  .strict();

export type PerpsCheckSummaryDto = z.infer<typeof perpsCheckSummarySchema>;
export type PerpsCheckDetailDto = z.infer<typeof perpsCheckDetailSchema>;
export type PerpsPositionsResponseDto = z.infer<typeof perpsPositionsResponseSchema>;
export type PerpsProposalDto = z.infer<typeof perpsProposalSchema>;
export type PerpsRecordDto = z.infer<typeof perpsRecordSchema>;
export type PerpsActionStartedDto = z.infer<typeof perpsActionStartedSchema>;
export type PerpsActionDto = z.infer<typeof perpsActionSchema>;
