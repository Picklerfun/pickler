/** Public deployment metadata only. Never store private keys in this package. */
export interface ContractDeployment {
  chainId: number;
  address: `0x${string}`;
  deploymentBlock: bigint;
}

export * from "./networks";

export * from "./deployments.js";

/** Generated from Foundry artifacts by scripts/generate-abi.mjs. Never hand-edited. */
export * from "./abi/index.js";
