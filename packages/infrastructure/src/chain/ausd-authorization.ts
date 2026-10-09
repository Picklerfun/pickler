import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddressEqual,
  parseEventLogs,
  parseSignature,
  verifyTypedData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { SettlementRejected, type AdvicePaymentGateway, type Authorization } from "@pickler/core";

const AUSD_ADDRESS = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const MONAD_TESTNET_ID = 10143;
const DEFAULT_RECEIPT_TIMEOUT_MS = 30_000;

const AUSD_ABI = [
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface TransferLog {
  address: string;
  args: { from?: string; to?: string; value?: bigint };
}

export interface TransferWithAuthorizationRequest {
  account: ReturnType<typeof privateKeyToAccount>;
  address: `0x${string}`;
  abi: typeof AUSD_ABI;
  functionName: "transferWithAuthorization";
  args: readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, Hex, number, Hex, Hex];
}

export interface PublicClientLike {
  readContract(request: {
    address: `0x${string}`;
    abi: typeof AUSD_ABI;
    functionName: "authorizationState" | "balanceOf";
    args: readonly unknown[];
  }): Promise<unknown>;
  simulateContract(request: TransferWithAuthorizationRequest): Promise<unknown>;
  waitForTransactionReceipt(request: { hash: Hex; timeout: number }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[];
  }>;
}

export interface WalletClientLike {
  writeContract(request: TransferWithAuthorizationRequest): Promise<Hex>;
}

export interface AusdAuthorizationGatewayInput {
  rpcUrl: string;
  relayerPrivateKey: `0x${string}`;
  asset?: string;
  chainId?: number;
  receiptTimeoutMs?: number;
  client?: PublicClientLike;
  wallet?: WalletClientLike;
}

export function authorizationTypedData(
  authorization: Authorization,
  options: { asset?: string; chainId?: number } = {},
) {
  return {
    domain: {
      name: "Agora Dollar",
      version: "1",
      chainId: options.chainId ?? MONAD_TESTNET_ID,
      verifyingContract: (options.asset ?? AUSD_ADDRESS) as `0x${string}`,
    },
    types: AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: authorization.from as `0x${string}`,
      to: authorization.to as `0x${string}`,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as Hex,
    },
  };
}

function sameAddress(left: string | undefined, right: string): boolean {
  if (left === undefined) {
    return false;
  }
  try {
    return isAddressEqual(left as `0x${string}`, right as `0x${string}`);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

/** True only for a Transfer(from, to, value) emitted by `asset` that matches the authorization. */
export function transferMatches(
  logs: readonly TransferLog[],
  authorization: Authorization,
  asset: string = AUSD_ADDRESS,
): boolean {
  const value = BigInt(authorization.value);
  return logs.some(
    (log) =>
      sameAddress(log.address, asset) &&
      sameAddress(log.args.from, authorization.from) &&
      sameAddress(log.args.to, authorization.to) &&
      log.args.value === value,
  );
}

export function createAusdAuthorizationGateway(
  input: AusdAuthorizationGatewayInput,
): AdvicePaymentGateway {
  const asset = (input.asset ?? AUSD_ADDRESS) as `0x${string}`;
  const chainId = input.chainId ?? MONAD_TESTNET_ID;
  const receiptTimeoutMs = input.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS;
  const account = privateKeyToAccount(input.relayerPrivateKey);
  const chain = defineChain({
    id: chainId,
    name: "Monad Testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [input.rpcUrl] } },
  });
  const client: PublicClientLike =
    input.client ??
    (createPublicClient({ chain, transport: http(input.rpcUrl) }) as unknown as PublicClientLike);
  const wallet: WalletClientLike =
    input.wallet ??
    (createWalletClient({
      account,
      chain,
      transport: http(input.rpcUrl),
    }) as unknown as WalletClientLike);

  return {
    async signatureValid(authorization, signature) {
      try {
        return await verifyTypedData({
          address: authorization.from as `0x${string}`,
          signature: signature as Hex,
          ...authorizationTypedData(authorization, { asset, chainId }),
        });
      } catch {
        return false;
      }
    },

    async nonceUsed(from, nonce) {
      // Latest block (viem default): a stale block tag could hide a consumed nonce.
      const used = await client.readContract({
        address: asset,
        abi: AUSD_ABI,
        functionName: "authorizationState",
        args: [from as `0x${string}`, nonce as Hex],
      });
      return used === true;
    },

    async balance(address) {
      const amount = await client.readContract({
        address: asset,
        abi: AUSD_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      return BigInt(amount as bigint);
    },

    async settle(authorization, signature) {
      const parsed = parseSignature(signature as Hex);
      const v = parsed.v === undefined ? 27 + (parsed.yParity ?? 0) : Number(parsed.v);
      const request: TransferWithAuthorizationRequest = {
        account,
        address: asset,
        abi: AUSD_ABI,
        functionName: "transferWithAuthorization",
        args: [
          authorization.from as `0x${string}`,
          authorization.to as `0x${string}`,
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce as Hex,
          v,
          parsed.r,
          parsed.s,
        ],
      };
      // Nothing is broadcast by a simulation, so a failure here provably never executed.
      try {
        await client.simulateContract(request);
      } catch {
        throw new SettlementRejected("Settlement simulation reverted");
      }
      // A failure of writeContract is ambiguous: the raw transaction may have reached the node.
      let hash: Hex;
      try {
        hash = await wallet.writeContract(request);
      } catch {
        throw new Error("Settlement broadcast outcome unknown");
      }
      let receipt: Awaited<ReturnType<PublicClientLike["waitForTransactionReceipt"]>>;
      try {
        receipt = await client.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs });
      } catch {
        throw new Error(`Settlement receipt unavailable for ${hash}`);
      }
      if (receipt.status === "reverted") {
        throw new SettlementRejected("Settlement transaction reverted");
      }
      const logs = parseEventLogs({
        abi: AUSD_ABI,
        eventName: "Transfer",
        logs: receipt.logs as never,
      }) as unknown as TransferLog[];
      if (!transferMatches(logs, authorization, asset)) {
        throw new Error(`Settlement ${hash} mined without the expected transfer`);
      }
      return { txHash: hash, blockNumber: receipt.blockNumber };
    },
  };
}
