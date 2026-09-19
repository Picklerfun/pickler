/** Public deployment metadata only. Never store private keys in this package. */
export interface ContractDeployment {
  chainId: number;
  address: `0x${string}`;
  deploymentBlock: bigint;
}

export * from "./networks";
