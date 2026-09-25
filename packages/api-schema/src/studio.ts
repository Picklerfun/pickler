import { z } from "zod";
import { VENUES } from "./agents.js";
import { ACCENTS } from "./landing.js";
import { agentConfigSchema, agentResponseSchema } from "./research.js";

// Mirrors `STYLES` in core, which this package may not import; a drift test in workers/api pins it.
export const STYLES = ["careful", "balanced", "bold"] as const;
export type StyleDto = (typeof STYLES)[number];

/** The public profile the studio authors at creation. Every field travels; nothing is filled in. */
export const agentProfileInputSchema = z
  .object({
    accent: z.enum(ACCENTS),
    blurb: z.string().trim().max(280),
    venue: z.enum(VENUES),
    vibe: z.string().trim().max(120),
    voice: z.string().trim().max(120),
    decides: z.string().trim().max(280),
    wrong: z.string().trim().max(280),
    xHandle: z
      .string()
      .regex(/^@[A-Za-z0-9_]{1,15}$/)
      .nullable(),
  })
  .strict();

/**
 * The wallet linked to the agent in the same transaction that creates it: "an agent is created
 * with its wallet, or not at all." Only `walletId` travels — the policy ids it links are read
 * server-side from what `confirmPolicies` already recorded, never from the client, so a request
 * cannot claim approval for rules nobody's passkey confirmed. `.strict()` rejects a `policyIds`
 * sent alongside it rather than silently ignoring it.
 */
export const agentWalletLinkSchema = z
  .object({
    walletId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/),
  })
  .strict();

export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    config: agentConfigSchema.refine((config) => Boolean(config.marketScope), {
      message: "Choose a category and subcategory",
    }),
    profile: agentProfileInputSchema,
    wallet: agentWalletLinkSchema,
  })
  .strict();
export const idempotencyKeySchema = z.string().min(1).max(200);

export const studioAccessSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
  canManage: z.boolean(),
});

// Mirrors `LockReason` in core's `features/studio/locks.ts`; a workers/api test pins it.
export const LOCK_REASONS = ["first_run", "unfunded", "unfunded_agent"] as const;
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
  wallet: studioAgentWalletSchema.nullable(),
  /** Schedule: one successful manual run with the current config, then at least 10 AUSD. */
  canSchedule: lockSchema,
  /** "+ New agent": every agent the person owns holds at least 10 AUSD. */
  canCreateAnother: lockSchema,
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
      id: z.enum(["polymarket", "exa", "balldontlie", "the-odds-api", "paper-trading"]),
      version: z.string(),
      tools: agentConfigSchema.shape.tools,
    }),
  ),
});

// The draft vocabulary mirrors `features/studio/draft.ts` in core; workers/api pins each list.
export const VENUES_ON_MAP = ["polymarket", "perpl"] as const;
export const SOON_VENUES = ["perpl"] as const;
export const BEAT_NAMES = ["Sports", "Crypto", "Politics", "Economics", "Culture", "Tech"] as const;
export type BeatName = (typeof BEAT_NAMES)[number];
export const SOON_BEATS = ["Crypto", "Politics", "Economics", "Culture", "Tech"] as const;
/** The subcategory labels each beat offers, in core's order. */
export const BEAT_SUBS: Record<BeatName, readonly string[]> = {
  Sports: ["NFL", "NBA", "Soccer", "Tennis"],
  Crypto: ["Bitcoin", "Ethereum", "New listings"],
  Politics: ["US elections", "Congress", "World"],
  Economics: ["Fed", "CPI", "Jobs"],
  Culture: ["Awards", "Box office", "Music"],
  Tech: ["AI", "Launches", "Space"],
};

/** What the model proposes from one line. Parts the runtime cannot run travel as `unsupported`. */
export const agentDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    venues: z.array(z.enum(VENUES_ON_MAP)).min(1),
    beat: z.enum(BEAT_NAMES),
    subcategories: z.array(z.string().max(40)).max(6),
    // A draft proposes a handful of sites; the config itself still allows 20.
    sites: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(6),
    skills: z.array(z.string().max(40)).max(8),
    edge: z.string().trim().min(1).max(400),
    style: z.enum(STYLES),
    accent: z.enum(ACCENTS),
  })
  .strict()
  .superRefine((draft, context) => {
    const offered = BEAT_SUBS[draft.beat];
    draft.subcategories.forEach((label, index) => {
      if (!offered.includes(label)) {
        context.addIssue({
          code: "custom",
          path: ["subcategories", index],
          message: `${label} is not a ${draft.beat} subcategory`,
        });
      }
    });
  });
export type AgentDraftDto = z.infer<typeof agentDraftSchema>;

export const draftRequestSchema = z
  .object({
    line: z.string().trim().min(3).max(280),
  })
  .strict();

export const draftResponseSchema = z.object({
  draft: agentDraftSchema,
  unsupported: z.array(z.string()),
});
