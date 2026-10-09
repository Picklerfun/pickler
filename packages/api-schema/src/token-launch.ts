import { z } from "zod";
import { ACCENTS } from "./landing.js";
/** Fixed supply for new agent-token launches, in 18-decimal units. */
export const AGENT_TOKEN_TOTAL_SUPPLY = "21000000000000000000000000";
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const agentTokenSchema = z.object({
  name: z.string(),
  ticker: z.string(),
  address,
  chainId: z.union([z.literal(143), z.literal(10143)]),
  imageUri: z.string().nullable(),
  avatar: z.object({ accent: z.enum(ACCENTS), pattern: z.number().int().min(0).max(5) }),
});
export type AgentTokenDto = z.infer<typeof agentTokenSchema>;
export const tokenDraftSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  name: z.string(),
  ticker: z.string(),
  status: z.enum(["draft", "prepared"]),
});
export const tokenDraftInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(40),
    ticker: z.string().regex(/^\$?[A-Za-z][A-Za-z0-9]{1,5}$/),
  })
  .strict();
export const tokenAuthorizeInputSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const tokenPresetSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  configHash: hash,
  quoteAddress: address,
  totalSupply: integer,
  saleAllocation: integer,
  lpAllocation: integer,
  buyFeeBps: z.number().int().min(0).max(10000),
  sellFeeBps: z.number().int().min(0).max(10000),
  launchFee: integer,
  protocolShareBps: z.number().int().min(0).max(10000),
  lpCreatorShareBps: z.number().int().min(0).max(10000),
});
/** Reference terms; never proof of a published preset or executable quote. */
export const tokenReferenceEconomicsSchema = z.object({
  version: z.literal(2),
  source: z.literal("reference"),
  quoteSymbol: z.literal("AUSD"),
  quoteAddress: address,
  quoteDecimals: z.literal(6),
  tokenDecimals: z.literal(18),
  totalSupply: integer,
  saleAllocation: integer,
  lpAllocation: integer,
  salePercent: z.number().min(0).max(100),
  lpPercent: z.number().min(0).max(100),
  virtualTokenReserve: integer,
  virtualQuoteReserve: integer,
  initialPriceWad: integer,
  finalPriceWad: integer,
  initialFdvWad: integer,
  finalFdvWad: integer,
  netReserveAtCompletion: integer,
  buyFeeBps: z.number().int().min(0).max(500),
  sellFeeBps: z.number().int().min(0).max(500),
  protocolShareBps: z.number().int().min(0).max(10000),
  launchFee: integer,
  dexStatus: z.literal("pending"),
});
export const tokenStateSchema = z.object({
  chainId: z.union([z.literal(143), z.literal(10143)]).nullable(),
  available: z.boolean(),
  masterAddress: address.nullable().optional(),
  confirmation: z.enum(["absent", "pending", "confirmed"]),
  blockers: z.array(
    z.enum([
      "GO_PUBLIC_FIRST",
      "CREATOR_ACCESS_REQUIRED",
      "MASTER_WALLET_REQUIRED",
      "AGENT_UNAVAILABLE",
      "TOKEN_ALREADY_LAUNCHED",
      "TOKEN_CONFIRMATION_PENDING",
      "LAUNCH_UNAVAILABLE",
    ]),
  ),
  draft: tokenDraftSchema.nullable(),
  token: agentTokenSchema.nullable(),
  preset: tokenPresetSchema.nullable(),
  economics: tokenReferenceEconomicsSchema.nullable().optional(),
});
export const tokenAuthorizationSchema = z.object({
  chainId: z.union([z.literal(143), z.literal(10143)]),
  factory: address,
  params: z.object({
    agentKey: hash,
    creator: address,
    creatorFeeRecipient: address,
    name: z.string(),
    symbol: z.string(),
    metadataURI: z.string(),
    metadataHash: hash,
    presetId: z.number().int(),
    presetVersion: z.number().int(),
    expectedConfigHash: hash,
    nonce: integer,
    deadline: integer,
  }),
  grantNonce: integer,
  grantDeadline: integer,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  draftVersion: z.number().int().positive(),
});
export type TokenStateDto = z.infer<typeof tokenStateSchema>;
export type TokenDraftDto = z.infer<typeof tokenDraftSchema>;
