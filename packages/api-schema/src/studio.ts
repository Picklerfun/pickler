import { z } from "zod";
import { ACCENTS } from "./landing.js";
import {
  agentConfigSchema,
  agentResponseSchema,
  decisionSchema,
  eventResponseSchema,
  spendLimitsSchema,
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

export const studioAgentSchema = agentResponseSchema.extend({
  productId: z.string().uuid().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  /** The profile's accent; "lime" for an agent without a profile row. */
  accent: z.enum(ACCENTS),
  /** A private draft from the brief (studio-brief-v1 §6): no wallet until Go Public. */
  draft: z.boolean(),
  wallet: studioAgentWalletSchema.nullable(),
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
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    voice: z.enum(["analyst", "contrarian", "trash_talker", "deadpan", "hype", "professor"]),
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
