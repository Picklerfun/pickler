import { z } from "zod";
import { AUSD } from "@pickler/chain";
const address = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/)
  .refine((v) => !/^0x0+$/.test(v));
const hash = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .refine((v) => !/^0x0+$/.test(v));
const units = z.string().regex(/^[1-9][0-9]*$/);
const deployment = z
  .object({
    address,
    codeHash: hash,
    deploymentBlock: z.number().int().nonnegative(),
    source: z.string().url(),
    implementation: z.object({ address, codeHash: hash, slot: hash }).nullable(),
    upgradeReview: z.string().min(1),
  })
  .strict();
/** Operator-reviewed configuration. Every field is explicit; no legacy defaults or commercial guesses. */
export const tokenLaunchPolicySchema = z
  .object({
    version: z.literal(1),
    chainId: z.literal(10143),
    allowedAgents: z.array(z.string().uuid()).min(1).max(10),
    venue: z.literal("kuru_passive"),
    approvedVenueConfigHash: hash,
    evidence: z
      .object({
        reproducibleSources: z.literal(true),
        implementationVerified: z.literal(true),
        testnetDeployment: z.literal(true),
        tokenAdmission: z.literal(true),
        atomicUnits: z.literal(true),
        passiveBands: z.literal(true),
        feeOnlyClaim: z.literal(true),
        administrationReviewed: z.literal(true),
        economicsApproved: z.literal(true),
      })
      .strict(),
    factory: deployment,
    deployer: deployment,
    adapter: deployment,
    escrow: deployment,
    locker: deployment,
    router: deployment,
    accountCore: deployment,
    authority: address,
    treasury: address,
    preset: z
      .object({
        id: z.number().int().positive(),
        version: z.number().int().positive(),
        configHash: hash,
        quoteAddress: z.literal(AUSD[10143].address.toLowerCase()),
        totalSupply: z.literal("21000000000000000000000000"),
        saleAllocation: z.literal("16800000000000000000000000"),
        lpAllocation: z.literal("4200000000000000000000000"),
        buyFeeBps: z.literal(100),
        sellFeeBps: z.literal(100),
        launchFee: z.literal("0"),
        protocolShareBps: z.literal(5000),
        lpCreatorShareBps: z.literal(5000),
      })
      .strict(),
    metadataOrigin: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === "https:" &&
          u.pathname === "/" &&
          !u.search &&
          !u.hash &&
          !u.username &&
          !u.password
        );
      }),
    maxGas: units,
    maxFeePerGas: units,
    maxGasCost: units,
    rpcRequestsPerOperation: z.number().int().min(250).max(2000),
    confirmations: z.number().int().min(1).max(100),
  })
  .strict();
export type TokenLaunchPolicy = z.infer<typeof tokenLaunchPolicySchema>;
export function parseTokenLaunchPolicy(json: string): TokenLaunchPolicy {
  return tokenLaunchPolicySchema.parse(JSON.parse(json));
}
