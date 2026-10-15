import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  parseSignature,
  verifyTypedData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { PicklerAdviceSplitterAbi } from "@pickler/chain";
import {
  SettlementRejected,
  SettlementUnknown,
  adviceShares,
  type AdvicePaymentGateway,
  type AdvicePaymentSettlement,
  type Authorization,
} from "@pickler/core";

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
  ReceiveWithAuthorization: [
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

interface AdviceSettledLog {
  address: string;
  args: {
    from?: string;
    payee?: string;
    nonce?: string;
    value?: bigint;
    creatorAmount?: bigint;
    protocolAmount?: bigint;
  };
}

/** The three AUSD movements one splitter settlement must show. */
export interface ExpectedSettlement {
  from: string;
  splitter: string;
  payee: string;
  treasury: string;
  value: bigint;
  creator: bigint;
  protocol: bigint;
}

/** `PicklerAdviceSplitter.settle(from, value, validAfter, validBefore, salt, payee, v, r, s)`. */
export interface SplitterSettleRequest {
  account: ReturnType<typeof privateKeyToAccount>;
  address: `0x${string}`;
  abi: typeof PicklerAdviceSplitterAbi;
  functionName: "settle";
  args: readonly [`0x${string}`, bigint, bigint, bigint, Hex, `0x${string}`, number, Hex, Hex];
}

export interface PublicClientLike {
  readContract(request: {
    address: `0x${string}`;
    abi: typeof AUSD_ABI | typeof PicklerAdviceSplitterAbi;
    functionName: "authorizationState" | "balanceOf" | "treasury" | "asset";
    args: readonly unknown[];
  }): Promise<unknown>;
  simulateContract(request: SplitterSettleRequest): Promise<unknown>;
  waitForTransactionReceipt(request: { hash: Hex; timeout: number }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[];
  }>;
}

export interface WalletClientLike {
  writeContract(request: SplitterSettleRequest): Promise<Hex>;
}

export interface AusdAuthorizationGatewayInput {
  rpcUrl: string;
  relayerPrivateKey: `0x${string}`;
  /** The `PicklerAdviceSplitter`: the authorization's `to` and the contract the relayer calls. */
  splitter: string;
  /**
   * The treasury the splitter pays, already verified against its `treasury()` by the host. The
   * third transfer of a settlement is matched against it, so nothing is read after a broadcast.
   */
  treasury: string;
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
    primaryType: "ReceiveWithAuthorization" as const,
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

/** `keccak256(abi.encode(payee, salt))`, as `PicklerAdviceSplitter.nonceFor` computes it. */
export function adviceNonce(payee: string, salt: string): Hex {
  // Address encoding ignores case; lowercasing spares viem's checksum check on mixed-case input.
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [payee.toLowerCase() as `0x${string}`, salt as Hex],
  );

  return keccak256(encoded);
}

/** True when `payee` and the authorization's salt derive its nonce; malformed input is false. */
function payeeDerivesNonce(payee: string, authorization: Authorization): boolean {
  try {
    return (
      adviceNonce(payee, authorization.salt).toLowerCase() === authorization.nonce.toLowerCase()
    );
  } catch {
    return false;
  }
}

function hasTransfer(
  logs: readonly TransferLog[],
  asset: string,
  from: string,
  to: string,
  value: bigint,
): boolean {
  return logs.some(
    (log) =>
      sameAddress(log.address, asset) &&
      sameAddress(log.args.from, from) &&
      sameAddress(log.args.to, to) &&
      log.args.value === value,
  );
}

/**
 * True only when `asset` emitted all three transfers of one settlement: the payer's `value` to the
 * splitter, the creator share to the payee and the rest to the treasury.
 */
export function settlementTransfersMatch(
  logs: readonly TransferLog[],
  expected: ExpectedSettlement,
  asset: string = AUSD_ADDRESS,
): boolean {
  const paid = hasTransfer(logs, asset, expected.from, expected.splitter, expected.value);
  const toPayee = hasTransfer(logs, asset, expected.splitter, expected.payee, expected.creator);
  const toTreasury = hasTransfer(
    logs,
    asset,
    expected.splitter,
    expected.treasury,
    expected.protocol,
  );

  return paid && toPayee && toTreasury;
}

/** True for the splitter's own AdviceSettled for this payer, payee, nonce and amounts. */
function adviceSettledMatches(
  logs: readonly AdviceSettledLog[],
  expected: ExpectedSettlement,
  nonce: string,
): boolean {
  return logs.some(
    (log) =>
      sameAddress(log.address, expected.splitter) &&
      sameAddress(log.args.from, expected.from) &&
      sameAddress(log.args.payee, expected.payee) &&
      log.args.nonce?.toLowerCase() === nonce.toLowerCase() &&
      log.args.value === expected.value &&
      log.args.creatorAmount === expected.creator &&
      log.args.protocolAmount === expected.protocol,
  );
}

export type AusdAuthorizationGateway = AdvicePaymentGateway & {
  /** The splitter's immutable `treasury()`, read once and cached; a failed read is retried. */
  splitterTreasury(): Promise<string>;
  /** The splitter's immutable `asset()`, read once and cached; a failed read is retried. */
  splitterAsset(): Promise<string>;
};

/** One read of an immutable splitter getter, cached once it succeeds and retried after a failure. */
function cachedRead(read: () => Promise<unknown>): () => Promise<string> {
  let cached: Promise<string> | null = null;

  return () => {
    if (cached === null) {
      cached = read().then(
        (value) => value as string,
        (error: unknown) => {
          cached = null;
          throw error;
        },
      );
    }
    return cached;
  };
}

export function createAusdAuthorizationGateway(
  input: AusdAuthorizationGatewayInput,
): AusdAuthorizationGateway {
  const asset = (input.asset ?? AUSD_ADDRESS) as `0x${string}`;
  const splitter = input.splitter as `0x${string}`;
  const treasury = input.treasury;
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

  const splitterTreasury = cachedRead(() =>
    client.readContract({
      address: splitter,
      abi: PicklerAdviceSplitterAbi,
      functionName: "treasury",
      args: [],
    }),
  );
  const splitterAsset = cachedRead(() =>
    client.readContract({
      address: splitter,
      abi: PicklerAdviceSplitterAbi,
      functionName: "asset",
      args: [],
    }),
  );

  const gateway: AusdAuthorizationGateway = {
    nonceFor(payee, salt) {
      return adviceNonce(payee, salt);
    },

    splitterTreasury,

    splitterAsset,

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

    async settle(authorization, signature, payee): Promise<AdvicePaymentSettlement> {
      // A revert is only a proven rejection while the nonce is unused: if it is consumed, the same
      // authorization already executed (e.g. front-run) and the funds moved. `hash` is the
      // reverted transaction's, or null when nothing was broadcast.
      const rejectIfUnused = async (message: string, hash: Hex | null): Promise<never> => {
        let consumed: boolean;
        try {
          consumed = await gateway.nonceUsed(authorization.from, authorization.nonce);
        } catch {
          throw new SettlementUnknown(
            "Settlement reverted but the authorization state is unknown",
            hash,
          );
        }
        if (consumed) {
          throw new SettlementUnknown(
            "Settlement reverted but the authorization was already used",
            hash,
          );
        }
        throw new SettlementRejected(message);
      };

      let request: SplitterSettleRequest;
      try {
        const parsed = parseSignature(signature as Hex);
        const v = parsed.v === undefined ? 27 + (parsed.yParity ?? 0) : Number(parsed.v);
        request = {
          account,
          address: splitter,
          abi: PicklerAdviceSplitterAbi,
          functionName: "settle",
          args: [
            authorization.from as `0x${string}`,
            BigInt(authorization.value),
            BigInt(authorization.validAfter),
            BigInt(authorization.validBefore),
            authorization.salt as Hex,
            payee as `0x${string}`,
            v,
            parsed.r,
            parsed.s,
          ],
        };
      } catch {
        // Nothing was sent, so an unparsable signature provably never executed.
        throw new SettlementRejected("Settlement signature could not be parsed");
      }

      // The splitter recomputes the nonce from `payee` and `salt`; a payee that does not derive
      // this authorization's nonce could never settle it, so nothing is sent.
      if (!payeeDerivesNonce(payee, authorization)) {
        throw new SettlementRejected("Settlement payee does not derive the authorization nonce");
      }

      // Nothing is broadcast by a simulation, so any failure here (revert or transport) is a
      // rejection, provided the nonce is still unused.
      try {
        await client.simulateContract(request);
      } catch {
        return rejectIfUnused("Settlement simulation reverted", null);
      }

      // A failure of writeContract is ambiguous: the raw transaction may have reached the node.
      let hash: Hex;
      try {
        hash = await wallet.writeContract(request);
      } catch {
        throw new SettlementUnknown("Settlement broadcast outcome unknown");
      }

      let receipt: Awaited<ReturnType<PublicClientLike["waitForTransactionReceipt"]>>;
      try {
        receipt = await client.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs });
      } catch {
        throw new SettlementUnknown(`Settlement receipt unavailable for ${hash}`, hash);
      }

      if (receipt.status === "reverted") {
        return rejectIfUnused("Settlement transaction reverted", hash);
      }

      // Each AUSD movement is checked against this payment, never the splitter's event alone.
      const value = BigInt(authorization.value);
      const shares = adviceShares(value);
      const expected: ExpectedSettlement = {
        from: authorization.from,
        splitter,
        payee,
        treasury,
        value,
        creator: shares.creator,
        protocol: shares.protocol,
      };
      const transfers = parseEventLogs({
        abi: AUSD_ABI,
        eventName: "Transfer",
        logs: receipt.logs as never,
      }) as unknown as TransferLog[];
      const settledEvents = parseEventLogs({
        abi: PicklerAdviceSplitterAbi,
        eventName: "AdviceSettled",
        logs: receipt.logs as never,
      }) as unknown as AdviceSettledLog[];
      const transfersMatch = settlementTransfersMatch(transfers, expected, asset);
      const eventMatches = adviceSettledMatches(settledEvents, expected, authorization.nonce);
      if (!transfersMatch || !eventMatches) {
        throw new SettlementUnknown(`Settlement ${hash} mined without the expected split`, hash);
      }

      return {
        txHash: hash,
        blockNumber: receipt.blockNumber,
        creatorAmount: shares.creator,
        protocolAmount: shares.protocol,
      };
    },
  };
  return gateway;
}
