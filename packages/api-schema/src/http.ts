import { z } from "zod";

/** JSON extension fields (provider activities, event payloads), not an opaque response DTO. */
export const jsonObjectSchema = z.record(z.string(), z.json());
export const emptyRequestSchema = z.object({});
export const okSchema = z.object({ ok: z.literal(true) });
export const txHashSchema = z.object({ txHash: z.string() });
export const errorDetailSchema = z.union([z.string(), z.record(z.string(), z.string().nullable())]);
export const envelopeErrorSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  statusCode: z.number(),
  timestamp: z.string(),
  path: z.string().optional(),
  traceId: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
  detail: errorDetailSchema.optional(),
});
export function envelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    message: z.string(),
    data,
    statusCode: z.number(),
    timestamp: z.string(),
    path: z.string().optional(),
    traceId: z.string().optional(),
  });
}
export const studioErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  detail: errorDetailSchema.optional(),
  field: z.string().optional(),
  reason: z.string().optional(),
  retryAt: z.number().optional(),
});
export const growthErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export const launchErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    requestId: z.string().optional(),
  }),
});
export const profileSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  handle: z.string(),
  created_at: z.string(),
});
export const profileRequestSchema = z.object({ display_name: z.string(), handle: z.string() });
export const handleAvailabilitySchema = z.object({
  handle: z.string(),
  available: z.boolean(),
  reason: z.string().nullable().optional(),
});
export const authMeSchema = z.object({
  user: z.object({ id: z.string(), email: z.string().nullable() }),
  workspace: z
    .object({ id: z.string(), name: z.string(), activeModules: z.array(z.string()) })
    .nullable(),
  role: z.string().nullable(),
});
export const nonceRequestSchema = z.object({
  address: z.string(),
  chain_id: z.number().int().positive(),
  joining: z.string().optional(),
});
export const nonceResponseSchema = z.object({ message: z.string(), nonce: z.string() });
export const signatureRequestSchema = z.object({
  raw: z.string(),
  signature: z.string(),
  kind: z.enum(["eoa", "mera"]).optional(),
});
export const sessionSchema = z.object({ accessToken: z.string(), refreshToken: z.string() });
export const walletSignInSchema = z.object({ userId: z.string(), session: sessionSchema });
export const walletLinkSchema = z.object({
  userId: z.string(),
  namespace: z.string(),
  address: z.string(),
  verifiedChain: z.string(),
  kind: z.enum(["external", "mera"]),
  verifiedAt: z.string(),
});
export const walletLinkResultSchema = z.object({ linked: z.literal(true) });
export const unsignedActivitySchema = z.object({
  url: z.string(),
  body: z.string(),
  timestampMs: z.string(),
  organizationId: z.string(),
});
export const attestationSchema = z.object({
  credentialId: z.string(),
  clientDataJson: z.string(),
  attestationObject: z.string(),
  transports: z.array(z.string()),
});
export const registerPasskeySchema = z.object({
  label: z.string(),
  challenge: z.string(),
  attestation: attestationSchema,
});
export const passkeyChallengeSchema = z.object({
  challenge: z.string(),
  rp: z.object({ id: z.string(), name: z.string() }),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ type: z.literal("public-key"), alg: z.number() })),
  timeout: z.number(),
  attestation: z.string(),
  authenticatorSelection: z.object({ residentKey: z.string(), userVerification: z.string() }),
  excludeCredentials: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("public-key"),
        transports: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export const custodyAccountSchema = z.object({
  sub_organization_id: z.string(),
  master_wallet_id: z.string(),
  address: z.string(),
});
export const passkeySchema = z.object({
  id: z.string(),
  credential_id: z.string(),
  label: z.string(),
  transports: z.array(z.string()),
  device_type: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
});
export const assetBalanceSchema = z.object({
  raw: z.string().nullable(),
  symbol: z.string(),
  decimals: z.number(),
});
export const walletBalanceSchema = z.object({
  address: z.string(),
  balances: z.object({ native: assetBalanceSchema, token: assetBalanceSchema }),
});
export const registeredAgentSchema = z.object({
  id: z.string(),
  integrator_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  turnkey_user_id: z.string().nullable(),
  wallet_id: z.string().nullable(),
  wallet_address: z.string().nullable(),
  chain_id: z.number().nullable(),
  threshold_usd: z.string(),
  killed_at: z.string().nullable(),
  turnkey_agent_user_id: z.string().nullable(),
  turnkey_policy_id: z.string().nullable(),
  active_policy_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});
export const agentStatusSchema = z.object({
  agentId: z.string(),
  killSwitch: z.boolean(),
  status: z.string(),
});
export const agentAnalyticsSchema = z.object({
  total_events: z.number(),
  total_spend: z.number(),
  events_by_type: z.record(z.string(), z.number()),
  top_recipients: z.array(
    z.object({ recipient: z.string(), count: z.number(), total: z.number() }),
  ),
  period: z.string(),
  period_start: z.string(),
});
export const auditPageSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      agent_id: z.string(),
      integrator_id: z.string(),
      event_type: z.string(),
      skill_id: z.string().nullable(),
      payload: jsonObjectSchema,
      created_at: z.string(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export const budgetResponseSchema = z.object({
  agent_id: z.string(),
  categories: z.array(
    z.object({
      category: z.string(),
      limit: z.string(),
      spent: z.string(),
      reserved: z.string(),
      remaining: z.string(),
      usage_pct: z.number(),
      period_start: z.string(),
      period_end: z.string(),
      status: z.string(),
    }),
  ),
});
