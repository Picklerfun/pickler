import { z } from "zod";
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const hex32 = z.string().regex(/^0x[\da-fA-F]{64}$/);
const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .max(120);
const iso = z.string().datetime();
const id = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PERPL_DASHBOARD_CHAIN = 10143;
export const PERPL_DASHBOARD_ORIGIN = "https://pickler.fun";
export const PERPL_READ_KEY_LABEL = "Pickler dashboard";
export const PERPL_READ_KEY_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
  ],
  PerplRegisterApiKey: [
    { name: "signer", type: "address" },
    { name: "statement", type: "string" },
    { name: "publicKey", type: "string" },
    { name: "scope", type: "string" },
    { name: "label", type: "string" },
    { name: "expiresAt", type: "string" },
    { name: "ipCidrs", type: "string" },
    { name: "origin", type: "string" },
    { name: "builderId", type: "string" },
    { name: "maxBuilderFeePer100K", type: "string" },
    { name: "time", type: "uint64" },
  ],
} as const;
const field = z.strictObject({ name: z.string().max(40), type: z.string().max(20) });
export const perplReadTypedDataSchema = z.strictObject({
  types: z
    .strictObject({
      EIP712Domain: z.array(field).length(5),
      PerplRegisterApiKey: z.array(field).length(11),
    })
    .refine(
      (types) => JSON.stringify(types) === JSON.stringify(PERPL_READ_KEY_TYPES),
      "Unexpected signing types",
    ),
  primaryType: z.literal("PerplRegisterApiKey"),
  domain: z.strictObject({
    name: z.literal("perpl.xyz"),
    version: z.literal("1"),
    chainId: z.union([z.literal(10143), z.literal("0x279f"), z.literal("10143")]),
    verifyingContract: z.literal("0x0000000000000000000000000000000000000000"),
    salt: hex32,
  }),
  message: z.strictObject({
    signer: address,
    statement: z.literal(
      "I authorize the creation of Perpl API key with the specified scope and parameters",
    ),
    publicKey: z.string().regex(/^[\w-]{43}$/),
    scope: z.literal("1"),
    label: z.literal(PERPL_READ_KEY_LABEL),
    expiresAt: z.string().regex(/^\d{13}$/),
    ipCidrs: z.literal(""),
    origin: z.literal(PERPL_DASHBOARD_ORIGIN),
    builderId: z.literal("0"),
    maxBuilderFeePer100K: z.literal("0"),
    time: z.union([z.string().regex(/^(?:0x[\da-fA-F]+|\d+)$/), id]),
  }),
});
export const perplReadKeyInputSchema = z.strictObject({
  wallet: address,
  publicKey: hex32,
  expiresAt: id,
});
export const perplReadKeyPayloadSchema = z.strictObject({
  typedData: perplReadTypedDataSchema,
  mac: hex32,
});
export const perplReadKeyEnrollSchema = z.strictObject({
  wallet: address,
  typedData: perplReadTypedDataSchema,
  mac: hex32,
  signature: z.string().regex(/^0x[\da-fA-F]{130}$/),
  popSignature: z.string().regex(/^0x[\da-fA-F]{128}$/),
});
export const perplReadKeyResultSchema = z.strictObject({
  apiKey: z.string().min(1).max(4096),
  wallet: address,
  scope: z.literal(1),
  expiresAt: id,
});
export function checkPerplReadPayload(
  payload: z.infer<typeof perplReadKeyPayloadSchema>,
  expected: z.infer<typeof perplReadKeyInputSchema>,
  publicKeyBase64: string,
  now = Date.now(),
) {
  const parsed = perplReadKeyPayloadSchema.parse(payload);
  const m = parsed.typedData.message;
  if (
    m.signer.toLowerCase() !== expected.wallet.toLowerCase() ||
    m.publicKey !== publicKeyBase64 ||
    Number(m.expiresAt) !== expected.expiresAt ||
    expected.expiresAt <= now ||
    expected.expiresAt > now + 3_600_000 ||
    Math.abs(Number(BigInt(m.time)) - now) > 30_000
  ) {
    throw new Error("Read-only authorization terms changed. Start again.");
  }
  return parsed;
}
const proof = z.strictObject({
  apiKey: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n]+$/),
  timestamp: z.string().regex(/^\d{13}$/),
  nonce: z.string().regex(/^[\w-]{22}$/),
  signature: z.string().regex(/^[\w-]{86}$/),
});
export const perplPortfolioInputSchema = z.strictObject({
  wallet: address,
  walletProof: proof,
  positionsProof: proof,
});
export const perplDashboardMarketsSchema = z.strictObject({
  chainId: z.literal(10143),
  observedAt: iso,
  serverTimeMs: id,
  stale: z.boolean(),
  totalOpenInterestAusd: decimal.nullable(),
  markets: z
    .array(
      z.strictObject({
        id,
        symbol: z.string().max(30),
        price: decimal,
        change24hBps: decimal.nullable(),
        openInterestAusd: decimal.nullable(),
        fundingBps: decimal.nullable(),
        fundingIntervalSec: id.nullable(),
        maxLeverage: z.number().positive().max(1000),
      }),
    )
    .max(100),
});
export const perplPublicWalletSchema = z.strictObject({ wallet: address });
export const perplPortfolioSchema = z.strictObject({
  wallet: address,
  source: z.literal("onchain").optional(),
  chainId: z.literal(10143),
  observedAt: iso,
  marketObservedAt: iso,
  block: id,
  stale: z.boolean(),
  accountCount: id,
  frozen: z.boolean(),
  availableAusd: decimal,
  lockedOrdersAusd: decimal,
  collateralAusd: decimal,
  equityEstimateAusd: decimal.nullable(),
  pricePnlAusd: decimal.nullable(),
  grossExposureAusd: decimal.nullable(),
  netExposureAusd: decimal.nullable(),
  realizedPnlAusd: decimal.nullable(),
  feesAusd: decimal.nullable(),
  volumeAusd: decimal.nullable(),
  positions: z
    .array(
      z.strictObject({
        id,
        accountId: id,
        marketId: id,
        side: z.enum(["long", "short"]),
        symbol: z.string().max(30),
        leverage: z.number().positive().nullable(),
        quantity: decimal.nullable(),
        entryPrice: decimal.nullable(),
        markPrice: decimal.nullable(),
        collateralAusd: decimal,
        notionalAusd: decimal.nullable(),
        pricePnlAusd: decimal.nullable(),
        collateralExhaustionPrice: decimal.nullable(),
        priceBufferBps: decimal.nullable(),
      }),
    )
    .max(500),
});
export type PerplReadKeyInputDto = z.infer<typeof perplReadKeyInputSchema>;
export type PerplReadKeyPayloadDto = z.infer<typeof perplReadKeyPayloadSchema>;
export type PerplReadKeyEnrollDto = z.infer<typeof perplReadKeyEnrollSchema>;
export type PerplReadKeyResultDto = z.infer<typeof perplReadKeyResultSchema>;
export type PerplPortfolioInputDto = z.infer<typeof perplPortfolioInputSchema>;
export type PerplDashboardMarketsDto = z.infer<typeof perplDashboardMarketsSchema>;
export type PerplPortfolioDto = z.infer<typeof perplPortfolioSchema>;
