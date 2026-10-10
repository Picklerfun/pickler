import { perplSelectionSchema } from "./perps.js";
import { z } from "zod";
import { ACCENTS } from "./landing.js";
import {
  agentConfigSchema,
  agentResponseSchema,
  decisionSchema,
  eventResponseSchema,
  spendLimitsSchema,
  studioPerpsStrategySchema,
  VOICE_KEYS,
} from "./research.js";

export const idempotencyKeySchema = z.string().min(1).max(200);

export const studioAccessSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
  canManage: z.boolean(),
});

// Mirrors `LockReason` in core's `features/studio/locks.ts`; a workers/api test pins it.
export const LOCK_REASONS = ["first_run", "unfunded", "unfunded_agent", "draft_limit"] as const;
export type LockReasonDto = (typeof LOCK_REASONS)[number];

/** A lock the API has already decided; the screen shows `reason` and never re-derives it. */
export const lockSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(LOCK_REASONS).nullable(),
});
export type LockDto = z.infer<typeof lockSchema>;

/** The agent's own wallet and its AUSD balance on Monad; null for an agent without a wallet. */
export const studioAgentWalletSchema = z.object({
  walletId: z.string(),
  address: z.string(),
  balanceAusd: z.number(),
});

export const advicePriceResponseSchema = z.object({
  advicePrice: z
    .object({ amount: z.string(), asset: z.literal("AUSD"), decimals: z.literal(6) })
    .nullable(),
});

export const studioAgentSchema = agentResponseSchema.extend({
  productId: z.string().uuid().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  /** The profile's accent; "lime" for an agent without a profile row. */
  accent: z.enum(ACCENTS),
  /** The profile's avatar pattern, one of six (0–5); 0 for an agent without a profile row. */
  avatarPattern: z.number().int().min(0).max(5),
  /**
   * A private draft (studio-brief-v1 §6). The create screen makes every draft with its own wallet
   * (studio-create-simplified-v1); a draft from before has none.
   */
  draft: z.boolean(),
  wallet: studioAgentWalletSchema.nullable(),
  /** The AUSD price of one fresh advice analysis, or null when not for sale (x402 spec D2). */
  advicePrice: advicePriceResponseSchema.shape.advicePrice,
  /** Schedule: one successful manual run with the current config, then at least 10 AUSD. */
  canSchedule: lockSchema,
  /**
   * "+ New agent": every agent with a wallet holds at least 10 AUSD (`unfunded_agent`), and the
   * workspace holds fewer than three private drafts (`draft_limit`). A draft is not counted as
   * unfunded.
   */
  canCreateAnother: lockSchema,
  /** The config's spend limits, or null when the person has not set them. */
  spend: spendLimitsSchema.nullable(),
  /** Whether `spend` is enforced: true, on paper orders. */
  spendEnforced: z.boolean(),
  /** Go Public (studio-draft-dashboard-v1 D7): private until published; there is no unpublish. */
  visibility: z.enum(["private", "public"]),
  publishedAt: z.string().datetime().nullable(),
  /** The verified X handle (without "@"), or null. */
  xHandle: z.string().nullable(),
});
export type StudioAgentDto = z.infer<typeof studioAgentSchema>;
export const studioOptionsSchema = z.object({
  defaults: z.object({
    profile: agentConfigSchema.shape.profile,
    tools: agentConfigSchema.shape.tools,
    limits: agentConfigSchema.shape.limits,
    intervalHours: agentConfigSchema.shape.intervalHours,
    uncertaintyPolicy: agentConfigSchema.shape.uncertaintyPolicy,
    sources: agentConfigSchema.shape.sources,
    skills: agentConfigSchema.shape.skills,
  }),
  plugins: z.array(
    z.object({
      id: z.enum([
        "polymarket",
        "exa",
        "balldontlie",
        "the-odds-api",
        "paper-trading",
        "polymarket-trading",
        "perpl",
        "perps-paper",
        "perps-paper",
      ]),
      version: z.string(),
      tools: agentConfigSchema.shape.tools,
    }),
  ),
});

/**
 * What the brief screen sends. Lengths and line counts are core's to judge (`assertBrief`), so the
 * answer can name the section: 400 INVALID_BRIEF with `field` and `reason`. These bounds only keep
 * the body small.
 */
const briefInputSchema = z
  .object({
    thesis: z.string().max(4000),
    reads: z.array(z.string().max(1000)).max(50),
    entersWhen: z.array(z.string().max(1000)).max(50),
    exitsWhen: z.array(z.string().max(1000)).max(50),
    never: z.array(z.string().max(1000)).max(50),
  })
  .strict();

/** `POST /v1/studio/preview-runs` (spec §4). Caps and leverage are core's to judge too. */
export const previewRunRequestSchema = z
  .object({
    brief: briefInputSchema,
    spend: z.object({ perCallAusd: z.number(), perDayAusd: z.number() }).strict(),
    maxLeverage: z.number(),
  })
  .strict();
export type PreviewRunRequestDto = z.infer<typeof previewRunRequestSchema>;

/** `GET /v1/studio/preview-runs/:id`: the run and its trace, events in a run's own shape. */
export const previewRunResponseSchema = z.object({
  run: z.object({
    id: z.string(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    createdAt: z.number(),
    startedAt: z.number().nullable(),
    finishedAt: z.number().nullable(),
    expiresAt: z.number(),
    adopted: z.boolean(),
    decision: decisionSchema.nullable(),
    error: z.string().nullable(),
  }),
  events: z.array(eventResponseSchema),
});
export type PreviewRunDto = z.infer<typeof previewRunResponseSchema>;

/**
 * `POST /v1/studio/drafts` (studio-create-simplified-v1 §4.1). Shapes only; the rules are core's
 * (`prepareDraft`). Sites may arrive as typed ("CoinDesk.com", "https://coindesk.com/x"): the
 * route reduces them to bare hosts before core checks them.
 */
export const draftCreateSchema = z
  .object({
    markets: perplSelectionSchema,
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    voice: z.enum(VOICE_KEYS),
    avatar: z
      .object({
        accent: z.enum(["lime", "cyan", "amber", "orange", "magenta", "violet", "blue"]),
        pattern: z.number().int(),
      })
      .strict(),
    sources: z
      .object({
        web: z
          .object({
            mode: z.enum(["anywhere", "prefer", "only"]),
            sites: z.array(z.string().max(253)).max(20),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    brief: z
      .object({
        thesis: z.string().max(4000),
        entersWhen: z.array(z.string().max(1000)).max(50),
        exitsWhen: z.array(z.string().max(1000)).max(50),
        never: z.array(z.string().max(1000)).max(50),
      })
      .strict(),
    caps: z
      .object({ perTradeAusd: z.number(), perDayAusd: z.number(), maxLeverage: z.number() })
      .strict(),
    walletId: z.string().min(1).max(128),
  })
  .strict();
export type DraftCreateDto = z.infer<typeof draftCreateSchema>;

/** A request the browser had the passkey stamp, in the shape Turnkey's own stamper produces. */
export const signedActivitySchema = z
  .object({
    url: z.string().min(1).max(512),
    body: z.string().min(1).max(8192),
    stamp: z
      .object({
        stampHeaderName: z.string().min(1).max(64),
        stampHeaderValue: z.string().min(1).max(8192),
      })
      .strict(),
  })
  .strict();
export type SignedActivityDto = z.infer<typeof signedActivitySchema>;

const transferFields = {
  /** "master", or one of the person's agent wallet ids. */
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  token: z.enum(["AUSD", "MON"]),
  /**
   * A decimal amount of the token, as typed: "1.5". The route checks its form and converts it to
   * base units, so every malformed amount is the same 400 INVALID_TRANSFER.
   */
  amount: z.string().max(80),
};

/** `POST /v1/studio/wallets/transfers/prepare` (§4.2): a decimal amount of one token. */
export const transferRequestSchema = z.object(transferFields).strict();
export type TransferRequestDto = z.infer<typeof transferRequestSchema>;

/** `POST /v1/studio/wallets/transfers/confirm`: the same body plus the stamped activity. */
export const transferConfirmSchema = z
  .object({ ...transferFields, signed: signedActivitySchema })
  .strict();
export type TransferConfirmDto = z.infer<typeof transferConfirmSchema>;

const baseUnitBalances = {
  /** Base units as decimal strings; null where the chain did not answer. */
  ausdMicro: z.string().nullable(),
  monWei: z.string().nullable(),
};

/** `GET /v1/studio/wallets` (§4.2). */
export const walletsResponseSchema = z.object({
  /** Deployment-selected balance/transfer chain; absent in legacy responses, null if unavailable. */
  chainId: z
    .union([z.literal(143), z.literal(10143)])
    .nullable()
    .optional(),
  master: z.object({ address: z.string(), ...baseUnitBalances }),
  agents: z.array(
    z.object({
      walletId: z.string(),
      address: z.string(),
      ...baseUnitBalances,
      agentId: z.string().nullable(),
      agentName: z.string().nullable(),
      caps: z
        .object({ perTradeAusd: z.number(), perDayAusd: z.number(), maxLeverage: z.number() })
        .nullable(),
      policiesApproved: z.boolean(),
    }),
  ),
  readAt: z.number(),
});
export type WalletsDto = z.infer<typeof walletsResponseSchema>;

/**
 * `PUT /v1/studio/agents/:id/setup` (studio-draft-dashboard-v1 D10, studio-live-v1 §4): the
 * brief, sources, caps, voice and how it enters, each optional. The two risk caps are optional
 * inside `caps`, as the draft studio sends three. Shapes only; core's `reviseSetup` judges them,
 * as at creation.
 */
export const setupUpdateSchema = z
  .object({
    markets: perplSelectionSchema.optional(),
    expectedVersion: z.number().int().positive(),
    perpsStrategy: studioPerpsStrategySchema.optional(),
    brief: draftCreateSchema.shape.brief
      .extend({ entersWhen: z.array(z.string()).max(8) })
      .strict()
      .optional(),
    sources: draftCreateSchema.shape.sources.optional(),
    caps: draftCreateSchema.shape.caps
      .extend({
        maxOpenPositions: z.number().optional(),
        dayLossStopAusd: z.number().optional(),
      })
      .strict()
      .optional(),
    voice: z.enum(VOICE_KEYS).optional(),
    entry: z
      .object({
        mode: z.enum(["approve", "auto"]),
        meanwhile: z.enum(["wait", "small"]),
        smallAusd: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SetupUpdateDto = z.infer<typeof setupUpdateSchema>;

/** `PUT /v1/studio/agents/:id/identity` (D14): name and avatar; the handle is fixed. */
export const identityUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    avatar: z
      .object({
        accent: draftCreateSchema.shape.avatar.shape.accent,
        /** One of the canvas's six avatar patterns; the database checks the same bound. */
        pattern: z.number().int().min(0).max(5),
      })
      .strict()
      .optional(),
  })
  .strict();
export type IdentityUpdateDto = z.infer<typeof identityUpdateSchema>;

/** `GET /v1/studio/agents/:id/activity` (D18): newest first, at most 50. */
export const activityResponseSchema = z.object({
  events: z.array(
    z.object({
      kind: z.enum(["created", "wallet", "transfer"]),
      text: z.string(),
      at: z.string().datetime(),
    }),
  ),
});
export type ActivityDto = z.infer<typeof activityResponseSchema>;

/**
 * `GET /v1/studio/agents/:id/versions` (studio-live-v1 L10): the agent's recorded setup versions,
 * newest first, at most 20. `summary` is the server's line for what that save changed.
 */
export const versionsResponseSchema = z.object({
  versions: z.array(
    z.object({
      version: z.number().int().positive(),
      summary: z.string().min(1).max(200),
      at: z.string().datetime(),
    }),
  ),
});
export type VersionsDto = z.infer<typeof versionsResponseSchema>;

/** Owner-only OAuth connection; no provider credentials cross this contract. */
export const xConnectionStatusSchema = z.enum([
  "disconnected",
  "connected",
  "reconnect_required",
  "revocation_pending",
]);
export const xStateResponseSchema = z.object({
  status: xConnectionStatusSchema,
  account: z
    .object({
      handle: z.string(),
      displayName: z.string().max(100).nullable().optional(),
      profileImageUrl: z.string().url().max(2048).nullable().optional(),
      verifiedAt: z.string().datetime(),
    })
    .nullable(),
  available: z.boolean(),
  readsAvailable: z.boolean(),
});
export type XStateDto = z.infer<typeof xStateResponseSchema>;
export const xAuthorizeRequestSchema = z.object({ returnTo: z.string().min(1).max(512) }).strict();
export const xAuthorizeResponseSchema = z.object({ authorizationUrl: z.string().url() });
export const xDisconnectResponseSchema = z.object({
  disconnected: z.literal(true),
  status: z.enum(["disconnected", "revocation_pending"]),
});
export const xPostsResponseSchema = z.object({
  posts: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        createdAt: z.string().datetime(),
        url: z.string().url(),
      }),
    )
    .max(5),
  nextCursor: z.null(),
});
export type XPostsDto = z.infer<typeof xPostsResponseSchema>;

/** `POST /v1/studio/agents/:id/publish` (D8); idempotent on a public agent. */
export const publishResponseSchema = z.object({
  visibility: z.literal("public"),
  publishedAt: z.string().datetime(),
});
export type PublishDto = z.infer<typeof publishResponseSchema>;

/** Mirrors core's `PublishBlocker`: what a 409 PUBLISH_BLOCKED lists in `detail.blockers`. */
export const PUBLISH_BLOCKERS = ["KILLED", "WALLET", "FUNDS", "X_CONNECTION_REQUIRED"] as const;
export type PublishBlockerDto = (typeof PUBLISH_BLOCKERS)[number];

/** `GET /v1/studio/wallets/ledger` (D17): the person's transfers, newest first, at most 100. */
export const ledgerResponseSchema = z.object({
  entries: z.array(
    z.object({
      direction: z.enum(["to_agent", "to_master"]),
      token: z.enum(["AUSD", "MON"]),
      /** Token units as a decimal string: "10", "0.5". */
      amount: z.string(),
      agentName: z.string().nullable(),
      txHash: z.string(),
      at: z.string().datetime(),
    }),
  ),
});
export type LedgerDto = z.infer<typeof ledgerResponseSchema>;

export const studioAccessRequestSchema = z.object({
  status: z.enum(["not_requested", "pending", "enabled"]),
  requestedAt: z.string().datetime().nullable(),
  /** The application sent under the account's email: in review, invited, rejected, or none. */
  application: z.enum(["submitted", "invited", "rejected"]).nullable(),
});
export const studioAccessRequestStatusSchema = studioAccessRequestSchema.extend({
  canReviewRequests: z.boolean(),
});
export const studioAccessRequestsInboxSchema = z.object({
  requests: z.array(
    z.object({
      userId: z.string().uuid(),
      handle: z.string(),
      displayName: z.string(),
      requestedAt: z.string().datetime(),
    }),
  ),
});
export type StudioAccessRequestStatusDto = z.infer<typeof studioAccessRequestStatusSchema>;
export type StudioAccessRequestsInboxDto = z.infer<typeof studioAccessRequestsInboxSchema>;

/* ---------- Creator applications, reviewed by operators (docs/specs/landing-trade-v1.md §7) ---------- */

export const studioApplicationStatusSchema = z.enum(["submitted", "invited", "rejected"]);
export const studioApplicationDecisionSchema = z.enum(["invited", "rejected"]);

export const studioApplicationSchema = z.object({
  id: z.number().int().positive(),
  email: z.string(),
  agentName: z.string(),
  ticker: z.string(),
  xHandle: z.string(),
  category: z.string(),
  personality: z.string(),
  edge: z.string(),
  whyYou: z.string(),
  status: studioApplicationStatusSchema,
  submittedAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
  invitedAt: z.string().datetime().nullable(),
});
export const studioApplicationsSchema = z.object({
  applications: z.array(studioApplicationSchema),
});
/** PUT /v1/studio/applications/:id — an operator's decision, with an optional note. */
export const studioApplicationReviewRequestSchema = z
  .object({
    status: studioApplicationDecisionSchema,
    note: z.string().max(500).optional(),
  })
  .strict();
export type StudioApplicationDto = z.infer<typeof studioApplicationSchema>;
export type StudioApplicationsDto = z.infer<typeof studioApplicationsSchema>;
export type StudioApplicationReviewRequestDto = z.infer<
  typeof studioApplicationReviewRequestSchema
>;

/** `PUT /v1/studio/agents/:id/advice-price`: AUSD with up to 6 decimals (0.10–100), or null to clear. */
export const advicePriceUpdateSchema = z
  .object({ priceAusd: z.string().max(12).nullable() })
  .strict();
export type AdvicePriceUpdateDto = z.infer<typeof advicePriceUpdateSchema>;
export type AdvicePriceResponseDto = z.infer<typeof advicePriceResponseSchema>;
