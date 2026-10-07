import { z } from "zod";
import { perplConfigSchema } from "./perps.js";

/** The six voices a created agent posts in; mirrors core's `VOICE_KEYS` (pinned by a test). */
export const VOICE_KEYS = [
  "analyst",
  "contrarian",
  "trash_talker",
  "deadpan",
  "hype",
  "professor",
] as const;

export const toolNameSchema = z.enum([
  "listPerpMarkets",
  "getPerpSnapshot",
  "getPerpOrderBook",
  "getPerpCandles",
  "getPerpFundingHistory",
  "searchWeb",
  "readPage",
  "getMarketRules",
  "getOrderBook",
  "getSportsContext",
  "getExternalOdds",
]);
export const uncertaintyPolicySchema = z
  .object({
    blockHighUncertainty: z.boolean(),
    requireCompleteInformation: z.boolean(),
    minProbabilityMargin: z.number().min(0).max(1),
    maxProbabilityRangeWidth: z.number().min(0).max(1),
  })
  .strict();
export const discoveryPolicySchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["open-market", "pre-event"]),
    minLeadMinutes: z.number().int().min(15).max(1440),
    maxHorizonDays: z.number().int().min(1).max(8),
  })
  .strict();
export const marketScopeSchema = z
  .object({
    version: z.literal(1),
    category: z.literal("sports"),
    subcategories: z.union([
      z.literal("all"),
      z
        .array(z.enum(["soccer", "american-football", "basketball", "tennis"]))
        .min(1)
        .max(4)
        .refine((ids) => new Set(ids).size === ids.length),
    ]),
  })
  .strict();
/** Mirror of core's `SPORTSBOOKS`; `workers/api/test/accent-venue-mirror.test.ts` pins it. */
export const SPORTSBOOKS = [
  { label: "DraftKings", key: "draftkings" },
  { label: "FanDuel", key: "fanduel" },
  { label: "Pinnacle", key: "pinnacle" },
  { label: "BetMGM", key: "betmgm" },
  { label: "Caesars", key: "williamhill_us" },
] as const;
type BookKey = (typeof SPORTSBOOKS)[number]["key"];
const BOOK_KEYS = SPORTSBOOKS.map((book) => book.key) as [BookKey, ...BookKey[]];

export const skillSchema = z
  .object({ name: z.string().trim().min(1).max(40), prompt: z.string().trim().min(1).max(600) })
  .strict();
export const sourcesSchema = z
  .object({
    web: z
      .object({
        mode: z.enum(["anywhere", "prefer", "only"]),
        sites: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20),
      })
      .strict()
      .nullable(),
    books: z.array(z.enum(BOOK_KEYS)),
  })
  .strict()
  .superRefine((sources, ctx) => {
    if (sources.web && sources.web.mode !== "anywhere" && sources.web.sites.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prefer and only need at least one site",
        path: ["web", "sites"],
      });
    }
  });
export const marketCatalogSchema = z.object({
  version: z.literal(1),
  categories: z.array(
    z.object({
      id: z.literal("sports"),
      label: z.string(),
      subcategories: z.array(
        z.object({
          id: z.enum(["soccer", "american-football", "basketball", "tennis"]),
          label: z.string(),
        }),
      ),
    }),
  ),
});
/** Mirror of trading's `PAPER_BUDGET_AUSD`: the virtual bankroll one paper order spends. */
export const PAPER_BUDGET_AUSD = 10;
/**
 * Spend limits in AUSD, mirroring `SPEND_BOUNDS` in core. Paper orders enforce them, which
 * `spendEnforced` on the studio agent DTO states.
 */
export const spendLimitsSchema = z
  .object({
    perCallAusd: z.number().min(1).max(1_000),
    perDayAusd: z.number().min(1).max(10_000),
  })
  .strict()
  .refine((spend) => spend.perDayAusd >= spend.perCallAusd, {
    message: "A day's spend cannot be below one call's",
    path: ["perDayAusd"],
  });
export type SpendLimitsDto = z.infer<typeof spendLimitsSchema>;

/** Mirror of core's `BRIEF_LIMITS`; `workers/api/test/accent-venue-mirror.test.ts` pins it. */
export const BRIEF_LIMITS = {
  thesis: 600,
  line: 200,
  reads: 12,
  entersWhen: 8,
  exitsWhen: 8,
  never: 8,
} as const;
/** Mirror of core's `LEVERAGE_BOUNDS`. */
export const LEVERAGE_BOUNDS = { min: 1, max: 10 } as const;
/** Mirror of core's `RISK_BOUNDS`; `workers/api/test/accent-venue-mirror.test.ts` pins it. */
export const RISK_BOUNDS = {
  maxOpenPositions: { min: 1, max: 6 },
  dayLossStopAusd: { min: 5, max: 200, step: 5 },
} as const;

/** A stored `config.risk` (studio-live-v1 L12): open at once, and the day-loss stop in AUSD. */
export const studioPerpsStrategySchema = z
  .object({
    id: z.enum(["rules", "deepseek", "jev", "combined"]),
    version: z.enum(["2.0.0", "2.1.0"]),
  })
  .strict();

export const riskLimitsSchema = z
  .object({
    maxOpenPositions: z
      .number()
      .int()
      .min(RISK_BOUNDS.maxOpenPositions.min)
      .max(RISK_BOUNDS.maxOpenPositions.max),
    dayLossStopAusd: z
      .number()
      .int()
      .min(RISK_BOUNDS.dayLossStopAusd.min)
      .max(RISK_BOUNDS.dayLossStopAusd.max)
      .multipleOf(RISK_BOUNDS.dayLossStopAusd.step),
  })
  .strict();
export type RiskLimitsDto = z.infer<typeof riskLimitsSchema>;

/**
 * A stored `config.entry` (L13). `smallAusd` is held to one call's bounds only: the per-trade cap
 * can drop under it later (`PUT /limits`), and a stored config must still parse; core's
 * `effectiveEntry` clamps it for whoever reads it.
 */
export const entrySettingSchema = z
  .object({
    mode: z.enum(["approve", "auto"]),
    meanwhile: z.enum(["wait", "small"]),
    smallAusd: z.number().min(1).max(1_000),
  })
  .strict();
export type EntrySettingDto = z.infer<typeof entrySettingSchema>;

const briefLine = z.string().min(1).max(BRIEF_LIMITS.line);
/** A stored brief, which core has already normalized and checked (spec §2). */
export const agentBriefSchema = z
  .object({
    thesis: z.string().max(BRIEF_LIMITS.thesis),
    reads: z.array(briefLine).max(BRIEF_LIMITS.reads),
    entersWhen: z.array(briefLine).min(1).max(BRIEF_LIMITS.entersWhen),
    exitsWhen: z.array(briefLine).max(BRIEF_LIMITS.exitsWhen),
    never: z.array(briefLine).max(BRIEF_LIMITS.never),
  })
  .strict();
export type AgentBriefDto = z.infer<typeof agentBriefSchema>;

/** The model's answer to each brief rule (spec §3.2); core's `briefVerdict` checks it. */
export const briefEvaluationSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            rule: briefLine,
            fired: z.boolean(),
            why: z.string().min(1).max(600),
          })
          .strict(),
      )
      .min(1)
      .max(BRIEF_LIMITS.entersWhen),
    exitArmed: briefLine.nullable(),
    neverChecked: z
      .array(z.object({ rule: briefLine, respected: z.boolean() }).strict())
      .max(BRIEF_LIMITS.never),
  })
  .strict();

export const agentConfigSchema = z
  .object({
    limits: z
      .object({
        searches: z.number().int().min(2).max(3),
        pageReads: z.number().int().min(1).max(6),
        steps: z.number().int().min(3).max(12),
        durationMs: z.number().int().min(1).max(300000),
        outputTokens: z.number().int().min(1).max(32768),
        dailyRuns: z.number().int().min(1).max(6),
      })
      .strict(),
    profile: z.string().trim().min(1).max(4000),
    trading: z
      .object({ version: z.literal(1), mode: z.enum(["off", "manual", "automatic"]) })
      .strict()
      .optional(),
    marketScope: marketScopeSchema.optional(),
    categoryIds: z.array(z.string().regex(/^\d+$/)).max(10).optional(),
    perpl: perplConfigSchema.optional(),
    perpsPaper: z
      .object({ version: z.literal(1), policy: z.literal("conservative-1x-v1") })
      .strict()
      .optional(),
    tools: z.array(toolNameSchema).max(11),
    plugins: z
      .object({
        version: z.literal(1),
        enabled: z
          .array(
            z.enum([
              "polymarket",
              "exa",
              "balldontlie",
              "the-odds-api",
              "paper-trading",
              "polymarket-trading",
              "perpl",
              "perps-paper",
            ]),
          )
          .max(8),
      })
      .strict()
      .optional(),
    researchProtocol: z.literal("nfl-winner-v1").optional(),
    intervalHours: z.number().int().min(1).max(168),
    uncertaintyPolicy: uncertaintyPolicySchema.optional(),
    discoveryPolicy: discoveryPolicySchema.optional(),
    sources: sourcesSchema.optional(),
    skills: z.array(skillSchema).max(8).optional(),
    spend: spendLimitsSchema.optional(),
    brief: agentBriefSchema
      .extend({ entersWhen: z.array(briefLine).max(BRIEF_LIMITS.entersWhen) })
      .optional(),
    maxLeverage: z.number().int().min(LEVERAGE_BOUNDS.min).max(LEVERAGE_BOUNDS.max).optional(),
    /** How every post reads (studio-create-simplified-v1 D8); core's `VOICE_KEYS`. */
    voice: z.enum(VOICE_KEYS).optional(),
    /** Absent means core's `RISK_DEFAULTS` and `ENTRY_DEFAULTS`. */
    risk: riskLimitsSchema.optional(),
    entry: entrySettingSchema.optional(),
    perpsStrategy: studioPerpsStrategySchema.optional(),
  })
  .strict()
  .refine(
    (config) =>
      config.marketScope
        ? config.categoryIds === undefined &&
          config.researchProtocol === undefined &&
          config.discoveryPolicy === undefined
        : config.categoryIds !== undefined,
    { message: "Choose marketScope or legacy selection fields, never both" },
  )
  .refine(
    (config) =>
      !config.brief || config.perpsStrategy?.id === "rules" || config.brief.entersWhen.length > 0,
    { message: "AI brief requires an entry condition", path: ["brief", "entersWhen"] },
  );
export const configUpdateSchema = z
  .object({ expectedVersion: z.number().int().positive(), config: agentConfigSchema })
  .strict();
export const runRequestSchema = z
  .object({ marketId: z.string().regex(/^\d+$/).optional() })
  .strict();
export const scheduleSchema = z.object({ enabled: z.boolean() }).strict();
/**
 * `PUT /v1/studio/agents/:id/limits`. No version: saving limits writes only `config.spend` and
 * keeps the version, the schedule and readiness.
 */
export const limitsUpdateSchema = z
  .object({
    perCallAusd: z.number().min(1).max(1_000),
    perDayAusd: z.number().min(1).max(10_000),
  })
  .strict()
  .refine((limits) => limits.perDayAusd >= limits.perCallAusd, {
    message: "A day's spend cannot be below one call's",
    path: ["perDayAusd"],
  });
const price = z.string().regex(/^(0(\.\d{1,8})?|1(\.0{1,8})?)$/);
export const legacyDecisionSchema = z
  .object({
    action: z.enum(["TRADE", "ABSTAIN"]),
    marketId: z.string(),
    outcomeId: z.string().nullable(),
    thesis: z.string().min(1).max(4000),
    counterEvidence: z.string().min(1).max(4000),
    uncertainty: z.string().min(1).max(2000),
    sourceIds: z.array(z.string()).min(1).max(20),
    estimatedProbability: z.number().min(0).max(1).nullable(),
    observedPrice: price.nullable(),
    limitPrice: price.nullable(),
    expiresAt: z.string().datetime().nullable(),
    abstentionReason: z.string().max(2000).nullable(),
  })
  .strict();
export const modelAssessmentSchema = legacyDecisionSchema
  .omit({ estimatedProbability: true })
  .extend({
    probability: z
      .object({
        lower: z.number().min(0).max(1),
        estimate: z.number().min(0).max(1),
        upper: z.number().min(0).max(1),
      })
      .strict()
      .nullable(),
    uncertaintyLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
    missingInformation: z.array(z.string().min(1).max(1000)).max(20),
  })
  .strict();
/**
 * A stored assessment may carry the brief's answers. `modelAssessmentSchema` itself does not, because
 * it is serialized into the decision prompts and changing it would change every prompt.
 */
const storedAssessmentSchema = modelAssessmentSchema
  .extend({ brief: briefEvaluationSchema.optional() })
  .strict();
export const decisionV2Schema = legacyDecisionSchema
  .extend({
    schemaVersion: z.literal(2),
    modelAssessment: storedAssessmentSchema,
    policyEvaluation: z
      .object({
        version: z.literal("1.0.0"),
        config: uncertaintyPolicySchema,
        finalAction: z.enum(["TRADE", "ABSTAIN"]),
        reasonCodes: z.array(
          z.enum([
            "MODEL_ABSTAINED",
            "HIGH_UNCERTAINTY",
            "MISSING_INFORMATION",
            "MISSING_PROBABILITY",
            "WIDE_PROBABILITY_RANGE",
            "INSUFFICIENT_CONSERVATIVE_MARGIN",
            "PRICE_EXCEEDS_LIMIT",
            "BRIEF_ENTRY_NOT_MET",
            "BRIEF_NEVER_BROKEN",
          ]),
        ),
        evaluatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();
export const researchReportSchema = z
  .object({
    protocol: z.literal("nfl-winner-v1"),
    forecast: z
      .object({
        outcomeId: z.string().nullable(),
        probability: modelAssessmentSchema.shape.probability,
        inabilityReason: z.string().min(1).max(2000).nullable(),
      })
      .strict(),
    sections: z
      .array(
        z
          .object({
            section: z.enum([
              "identity",
              "schedule",
              "rules",
              "teamContext",
              "injuries",
              "supporting",
              "contradicting",
              "quotes",
              "limitations",
            ]),
            status: z.enum(["supported", "conflicting", "missing", "not_applicable"]),
            explanation: z.string().min(1).max(2000),
            sourceIds: z.array(z.string()).max(20),
          })
          .strict(),
      )
      .length(9),
  })
  .strict();
export const nflAssessmentSchema = modelAssessmentSchema
  .extend({ report: researchReportSchema })
  .strict();
const storedNflAssessmentSchema = nflAssessmentSchema
  .extend({ brief: briefEvaluationSchema.optional() })
  .strict();
export const decisionV3Schema = decisionV2Schema
  .extend({
    schemaVersion: z.literal(3),
    modelAssessment: storedNflAssessmentSchema,
    forecast: researchReportSchema.shape.forecast,
    coverage: researchReportSchema.shape.sections,
  })
  .strict();
export const generalReportSchema = researchReportSchema
  .extend({
    protocol: z.literal("general-market-v1"),
    sections: z
      .array(
        researchReportSchema.shape.sections.element.extend({
          section: z.enum([
            "identity",
            "timing",
            "rules",
            "context",
            "supporting",
            "contradicting",
            "quotes",
            "limitations",
          ]),
        }),
      )
      .length(8),
  })
  .strict();
export const generalAssessmentSchema = modelAssessmentSchema
  .extend({ report: generalReportSchema })
  .strict();
const storedGeneralAssessmentSchema = generalAssessmentSchema
  .extend({ brief: briefEvaluationSchema.optional() })
  .strict();
export const decisionV4Schema = z.union([
  decisionV3Schema
    .extend({ schemaVersion: z.literal(4), protocol: z.literal("nfl-winner-v1") })
    .strict(),
  decisionV3Schema
    .extend({
      schemaVersion: z.literal(4),
      protocol: z.literal("general-market-v1"),
      modelAssessment: storedGeneralAssessmentSchema,
      coverage: generalReportSchema.shape.sections,
    })
    .strict(),
]);
export const decisionSchema = z.union([
  decisionV4Schema,
  decisionV3Schema,
  decisionV2Schema,
  legacyDecisionSchema,
]);
export type ResearchDecisionDto = z.infer<typeof decisionSchema>;
export const agentResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  version: z.number().int(),
  config: agentConfigSchema,
  paused: z.boolean(),
  scheduleEnabled: z.boolean(),
  nextDueAt: z.number().nullable(),
});
export const runResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  agentId: z.string(),
  trigger: z.enum(["manual", "schedule"]),
  marketId: z.string().nullable(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  configVersion: z.number(),
  config: agentConfigSchema,
  decision: decisionSchema.nullable(),
  error: z.string().nullable(),
});
export const eventResponseSchema = z.object({
  id: z.number(),
  type: z.string(),
  data: z.unknown(),
  createdAt: z.number(),
});
export const pauseSchema = z.object({ paused: z.boolean() }).strict();
