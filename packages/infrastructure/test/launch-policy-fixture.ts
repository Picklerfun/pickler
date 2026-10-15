import { privateKeyToAccount } from "viem/accounts";
import { keccak256, type Hex } from "viem";
import { AUSD } from "@pickler/chain";
import { type KuruTokenLaunchPolicy, tokenLaunchPolicySchema } from "../src/launch/policy.js";
export const launchKey = ("0x" + "0".repeat(63) + "1") as Hex;
export const masterKey = ("0x" + "0".repeat(63) + "2") as Hex;
export const launcherMaster = privateKeyToAccount(masterKey);
export const deploymentCode = "0x6000" as Hex;
export function launchPolicy() {
  const deployment = (n: number) => ({
    address: "0x" + String(n).repeat(40),
    codeHash: keccak256(deploymentCode),
    deploymentBlock: 10,
    source: "https://example.test/controlled-source",
    implementation: null,
    upgradeReview: "Controlled immutable deployment",
  });
  return tokenLaunchPolicySchema.parse({
    version: 1,
    chainId: 10143,
    allowedAgents: ["11111111-1111-4111-8111-111111111111"],
    venue: "kuru_passive",
    approvedVenueConfigHash: "0x" + "a".repeat(64),
    evidence: {
      reproducibleSources: true,
      implementationVerified: true,
      testnetDeployment: true,
      tokenAdmission: true,
      atomicUnits: true,
      passiveBands: true,
      feeOnlyClaim: true,
      administrationReviewed: true,
      economicsApproved: true,
    },
    factory: deployment(1),
    deployer: deployment(2),
    adapter: deployment(3),
    escrow: deployment(4),
    locker: deployment(5),
    router: deployment(6),
    accountCore: deployment(7),
    authority: privateKeyToAccount(launchKey).address.toLowerCase(),
    treasury: deployment(8).address,
    preset: {
      id: 1,
      version: 3,
      configHash: "0x" + "b".repeat(64),
      quoteAddress: AUSD[10143].address.toLowerCase(),
      totalSupply: "21000000000000000000000000",
      saleAllocation: "16800000000000000000000000",
      lpAllocation: "4200000000000000000000000",
      buyFeeBps: 100,
      sellFeeBps: 100,
      protocolShareBps: 5000,
      lpCreatorShareBps: 5000,
      launchFee: "0",
    },
    metadataOrigin: "https://app.pickler.fun",
    maxGas: "2000000",
    maxFeePerGas: "100000000000",
    maxGasCost: "200000000000000000",
    rpcRequestsPerOperation: 500,
    confirmations: 2,
  }) as KuruTokenLaunchPolicy;
}
export function uniswapLaunchPolicy() {
  const p = launchPolicy();
  const { router, accountCore, evidence, ...common } = p;
  const contract = (address: string) => ({ ...router, address });
  const { passiveBands, ...proof } = evidence;
  void passiveBands;
  return tokenLaunchPolicySchema.parse({
    ...common,
    version: 2,
    venue: "uniswap_v4",
    evidence: proof,
    preset: { ...p.preset, version: 4 },
    poolManager: router,
    positionManager: accountCore,
    stateView: contract("0x" + "9".repeat(40)),
    permit2: contract("0x" + "a".repeat(40)),
    quote: {
      ...contract(p.preset.quoteAddress),
      implementation: {
        address: "0x" + "c".repeat(40),
        codeHash: keccak256(deploymentCode),
        slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      },
    },
    liquidity: { feeTier: 10000, tickSpacing: 200, sqrtPriceToleranceBps: 5, range: "full_range" },
  }) as Extract<ReturnType<typeof tokenLaunchPolicySchema.parse>, { version: 2 }>;
}
export function metadataBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    async put(k: string, v: string) {
      if (!objects.has(k)) {
        objects.set(k, v);
      }
    },
    async get(k: string) {
      const value = objects.get(k);
      return value === undefined
        ? null
        : {
            size: value.length,
            async text() {
              return value;
            },
          };
    },
  };
}
