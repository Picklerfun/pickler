import { z } from "zod";
export const toolNameSchema = z.enum([
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
    maxHorizonDays: z.number().int().min(1).max(7),
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
export const agentConfigSchema = z
  .object({
    limits: z
      .object({
        searches: z.number().int().min(2).max(3),
        pageReads: z.number().int().min(1).max(5),
        steps: z.number().int().min(3).max(12),
        durationMs: z.number().int().min(1).max(300000),
        outputTokens: z.number().int().min(1).max(32768),
        dailyRuns: z.number().int().min(1).max(6),
      })
      .strict(),
    profile: z.string().trim().min(1).max(4000),
    marketScope: marketScopeSchema.optional(),
    categoryIds: z.array(z.string().regex(/^\d+$/)).max(10).optional(),
    tools: z.array(toolNameSchema).max(6),
    plugins: z
      .object({
        version: z.literal(1),
        enabled: z
          .array(z.enum(["polymarket", "exa", "balldontlie", "the-odds-api", "paper-trading"]))
          .max(5),
      })
      .strict()
      .optional(),
    researchProtocol: z.literal("nfl-winner-v1").optional(),
    intervalHours: z.number().int().min(1).max(168),
    uncertaintyPolicy: uncertaintyPolicySchema.optional(),
    discoveryPolicy: discoveryPolicySchema.optional(),
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
  );
export const configUpdateSchema = z
  .object({ expectedVersion: z.number().int().positive(), config: agentConfigSchema })
  .strict();
export const runRequestSchema = z
  .object({ marketId: z.string().regex(/^\d+$/).optional() })
  .strict();
export const scheduleSchema = z.object({ enabled: z.boolean() }).strict();
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
export const decisionV2Schema = legacyDecisionSchema
  .extend({
    schemaVersion: z.literal(2),
    modelAssessment: modelAssessmentSchema,
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
export const decisionV3Schema = decisionV2Schema
  .extend({
    schemaVersion: z.literal(3),
    modelAssessment: nflAssessmentSchema,
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
export const decisionV4Schema = z.union([
  decisionV3Schema
    .extend({ schemaVersion: z.literal(4), protocol: z.literal("nfl-winner-v1") })
    .strict(),
  decisionV3Schema
    .extend({
      schemaVersion: z.literal(4),
      protocol: z.literal("general-market-v1"),
      modelAssessment: generalAssessmentSchema,
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
