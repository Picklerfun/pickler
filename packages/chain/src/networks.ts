// Public network and token metadata. Values verified on 2026-09-16 against
//   - Monad docs: https://docs.monad.xyz/developer-essentials/network-information and /testnets
//   - Agora docs: https://docs.agora.finance/developer/contract-deployments
//   - on-chain eth_call to each AUSD contract: decimals(), eip712Domain(), nonces(address),
//     authorizationState(address,bytes32), TRANSFER_WITH_AUTHORIZATION_TYPEHASH()
// Re-verify before mainnet launches that depend on them.

export interface Network {
  chainId: number;
  name: string;
  nativeCurrency: { symbol: string; decimals: number };
  /** Public, rate-limited endpoints. Production uses provider URLs from bindings. */
  publicRpcUrls: readonly string[];
  explorers: readonly string[];
  testnet: boolean;
}

export const MONAD_MAINNET = {
  chainId: 143,
  name: "Monad",
  nativeCurrency: { symbol: "MON", decimals: 18 },
  publicRpcUrls: [
    "https://rpc.monad.xyz",
    "https://rpc1.monad.xyz",
    "https://rpc2.monad.xyz",
    "https://rpc3.monad.xyz",
    "https://rpc-mainnet.monadinfra.com",
  ],
  explorers: ["https://monadscan.com", "https://monadvision.com"],
  testnet: false,
} as const satisfies Network;

export const MONAD_TESTNET = {
  chainId: 10143,
  name: "Monad Testnet",
  nativeCurrency: { symbol: "MON", decimals: 18 },
  publicRpcUrls: [
    "https://testnet-rpc.monad.xyz",
    "https://rpc.ankr.com/monad_testnet",
    "https://rpc-testnet.monadinfra.com",
  ],
  explorers: ["https://testnet.monadscan.com", "https://testnet.monadvision.com"],
  testnet: true,
} as const satisfies Network;

export const NETWORKS = [MONAD_MAINNET, MONAD_TESTNET] as const;
export type SupportedChainId = (typeof NETWORKS)[number]["chainId"];

export interface Erc20Token {
  chainId: SupportedChainId;
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** EIP-712 domain used by permit / transferWithAuthorization signatures. */
  eip712: { name: string; version: string };
  eip2612: boolean;
  eip3009: boolean;
}

/** Agora Dollar. Note the EIP-712 name is "Agora Dollar", not the "AUSD" symbol. */
export const AUSD = {
  143: {
    chainId: 143,
    address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    symbol: "AUSD",
    decimals: 6,
    eip712: { name: "Agora Dollar", version: "1" },
    eip2612: true,
    eip3009: true,
  },
  10143: {
    chainId: 10143,
    address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    symbol: "AUSD",
    decimals: 6,
    eip712: { name: "Agora Dollar", version: "1" },
    // Domain and decimals verified on testnet; permit/3009 probes were run on mainnet only.
    eip2612: true,
    eip3009: true,
  },
} as const satisfies Record<SupportedChainId, Erc20Token>;

export function networkByChainId(chainId: number): Network | null {
  return NETWORKS.find((network) => network.chainId === chainId) ?? null;
}

/** Throws for chains Pickler does not support, instead of falling back to another network (Relayer defaulted to Base/Sepolia). */
export function requireSupportedChain(chainId: number): SupportedChainId {
  const network = networkByChainId(chainId);
  if (!network) {
    throw new Error(`Unsupported chain id ${chainId}`);
  }
  return network.chainId as SupportedChainId;
}

/** Decimal token string → base units, exact. "1.5" AUSD → 1500000n. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match || (match[2]?.length ?? 0) > decimals) {
    throw new Error(`Invalid token amount ${amount} for ${decimals} decimals`);
  }
  return (
    BigInt(match[1]!) * 10n ** BigInt(decimals) +
    BigInt((match[2] ?? "").padEnd(decimals, "0") || "0")
  );
}
