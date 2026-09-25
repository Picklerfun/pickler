// The chain side of a deposit: an unsigned EIP-1559 ERC-20 `transfer` from the master wallet,
// read back for core's checks, and the signed one broadcast. viem serializes and parses; the RPC
// stays the plain JSON-RPC client in erc20.ts. Nothing here signs or holds a key.

import { keccak256, parseTransaction, serializeTransaction, type Hex } from "viem";
import { AUSD, networkByChainId, requireSupportedChain } from "@pickler/chain";
import { DepositNotSendableError, type DepositChain, type TransferInspection } from "@pickler/core";
import { createJsonRpc, transferCalldata, type Rpc, type TokenBalanceReader } from "./erc20.js";

/** A tip for RPCs that do not implement `eth_maxPriorityFeePerGas`. */
const FALLBACK_PRIORITY_FEE = 1_000_000_000n;

/** `transfer(address,uint256)`: selector, a left-padded address, an amount. */
const TRANSFER_CALLDATA = /^0xa9059cbb0{24}([0-9a-f]{40})([0-9a-f]{64})$/;

const QUANTITY = /^0x[0-9a-fA-F]+$/;
const TX_HASH = /^0x[0-9a-f]{64}$/;

function quantity(value: unknown, method: string): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    throw new Error(`${method} returned no quantity`);
  }
  return BigInt(value);
}

export interface TransferTxInput {
  rpc: Rpc;
  chainId: number;
  token: string;
  from: string;
  to: string;
  /** Base units. */
  amount: bigint;
}

export interface TransferTx {
  /** `0x02…`, the form Turnkey's TRANSACTION_TYPE_ETHEREUM signs. */
  unsignedTransaction: string;
  nonce: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gas: bigint;
}

async function priorityFee(rpc: Rpc): Promise<bigint> {
  let answer: unknown;
  try {
    answer = await rpc.call("eth_maxPriorityFeePerGas", []);
  } catch {
    return FALLBACK_PRIORITY_FEE;
  }
  return quantity(answer, "eth_maxPriorityFeePerGas");
}

/**
 * The unsigned transfer, from the pending nonce, twice the latest base fee plus the tip, and the
 * gas estimate padded by a fifth. A failed estimate is `DepositNotSendableError` with the RPC's
 * error as its cause and is never replaced by a guessed limit: it usually means the wallet cannot
 * pay, and the person must learn that before stamping.
 */
export async function buildTransferTx(input: TransferTxInput): Promise<TransferTx> {
  const { rpc } = input;
  const data = transferCalldata(input.to, input.amount) as Hex;

  const [nonceAnswer, tip, block] = await Promise.all([
    rpc.call("eth_getTransactionCount", [input.from, "pending"]),
    priorityFee(rpc),
    rpc.call("eth_getBlockByNumber", ["latest", false]),
  ]);
  const nonce = Number(quantity(nonceAnswer, "eth_getTransactionCount"));
  const baseFee = (block as { baseFeePerGas?: unknown } | null)?.baseFeePerGas;
  if (typeof baseFee !== "string" || !QUANTITY.test(baseFee)) {
    throw new Error("The latest block carries no base fee");
  }

  let estimate: bigint;
  try {
    estimate = quantity(
      await rpc.call("eth_estimateGas", [{ from: input.from, to: input.token, data }]),
      "eth_estimateGas",
    );
  } catch (cause) {
    throw new DepositNotSendableError({ cause });
  }

  const gas = (estimate * 12n + 9n) / 10n;
  const maxFeePerGas = BigInt(baseFee) * 2n + tip;
  const unsignedTransaction = serializeTransaction({
    type: "eip1559",
    chainId: input.chainId,
    nonce,
    to: input.token as Hex,
    value: 0n,
    data,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas: tip,
  });

  return { unsignedTransaction, nonce, maxFeePerGas, maxPriorityFeePerGas: tip, gas };
}

/**
 * What an unsigned transaction does, or null unless it is an unsigned EIP-1559 call carrying a
 * bare ERC-20 `transfer` and nothing else (no access list, no trailing bytes).
 */
export function inspectTransfer(unsignedTransaction: string): TransferInspection | null {
  let parsed: ReturnType<typeof parseTransaction>;
  try {
    parsed = parseTransaction(unsignedTransaction as Hex);
  } catch {
    return null;
  }
  if (parsed.type !== "eip1559" || parsed.r !== undefined || !parsed.to) {
    return null;
  }
  if (parsed.accessList && parsed.accessList.length > 0) {
    return null;
  }
  const match = TRANSFER_CALLDATA.exec((parsed.data ?? "0x").toLowerCase());
  if (!match || parsed.chainId === undefined || parsed.gas === undefined) {
    return null;
  }
  return {
    chainId: parsed.chainId,
    to: parsed.to,
    value: parsed.value ?? 0n,
    gas: parsed.gas,
    recipient: `0x${match[1]}`,
    amount: BigInt(`0x${match[2]}`),
  };
}

/**
 * Sends a signed transaction and answers its hash, computed here and required to equal the one
 * the node reports. Turnkey returns Ethereum signatures without a `0x` prefix today and has said
 * it will add one, so either form is accepted.
 */
export async function broadcastTransaction(rpc: Rpc, signedTransaction: string): Promise<string> {
  const raw = (
    signedTransaction.startsWith("0x") ? signedTransaction : `0x${signedTransaction}`
  ) as Hex;
  const expected = keccak256(raw);
  const answer = await rpc.call("eth_sendRawTransaction", [raw]);
  if (typeof answer !== "string" || !TX_HASH.test(answer.toLowerCase())) {
    throw new Error("eth_sendRawTransaction returned no transaction hash");
  }
  if (answer.toLowerCase() !== expected) {
    throw new Error("eth_sendRawTransaction answered a different transaction hash");
  }
  return expected;
}

export interface AusdDepositChainConfig {
  chainId: number;
  /** Absent means the network's first public endpoint. */
  rpcUrl?: string;
  fetch?: typeof fetch;
  /** The studio's AUSD reader, whose cached balance a deposit makes stale. */
  balances: Pick<TokenBalanceReader, "forget">;
}

/** AUSD deposits on a supported chain. An unsupported chain id throws at composition. */
export function createAusdDepositChain(config: AusdDepositChainConfig): DepositChain {
  const chainId = requireSupportedChain(config.chainId);
  // Non-null: requireSupportedChain established a known network, and each lists a public endpoint.
  const url = config.rpcUrl ?? networkByChainId(chainId)!.publicRpcUrls[0]!;
  const token = AUSD[chainId];
  const rpc = createJsonRpc(url, config.fetch);

  return {
    chainId,
    token: token.address,
    decimals: token.decimals,
    async prepareTransfer({ from, to, amount }) {
      const built = await buildTransferTx({ rpc, chainId, token: token.address, from, to, amount });
      return built.unsignedTransaction;
    },
    inspectTransfer,
    broadcast: (signedTransaction) => broadcastTransaction(rpc, signedTransaction),
    forgetBalance: (address) => config.balances.forget(address),
  };
}
