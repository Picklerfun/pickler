import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
import {
  decodeFunctionData,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Hex,
} from "viem";
import type { Eip1193Provider } from "./provider";

export class WalletSubmissionUnknown extends Error {
  constructor(public readonly hash: string | null) {
    super(
      "The wallet may have submitted this transaction. Check its activity before trying again.",
    );
  }
}
/** Validate exactly the server-prepared bounded action before a wallet can sign. */
export async function validatePublicTokenTransaction(
  prepared: PublicTokenTradePreparedDto,
  wallet: string,
  token: string,
  now = Date.now(),
) {
  const { PicklerBondingCurveAbi, AUSD } = await import("@pickler/chain");
  const { transaction: tx, quote } = prepared;
  if (
    tx.chainId !== 10143 ||
    prepared.token.toLowerCase() !== token.toLowerCase() ||
    prepared.quoteToken.toLowerCase() !== AUSD[10143].address.toLowerCase() ||
    tx.from.toLowerCase() !== wallet.toLowerCase() ||
    tx.value !== "0x0" ||
    !Number.isSafeInteger(tx.nonce) ||
    tx.nonce < 0 ||
    Date.parse(prepared.expiresAt) <= now ||
    Date.parse(prepared.expiresAt) > now + 300_000 ||
    BigInt(tx.gas) <= 0n ||
    BigInt(tx.maxFeePerGas) < BigInt(tx.maxPriorityFeePerGas)
  ) {
    throw new Error("The prepared transaction no longer matches this wallet and token.");
  }
  const asset = quote.side === "buy" ? prepared.quoteToken : prepared.token;
  const expectedTarget = quote.approval ? asset : prepared.curve;
  if (tx.to.toLowerCase() !== expectedTarget.toLowerCase()) {
    throw new Error("Unexpected transaction target.");
  }
  if (quote.approval) {
    const expected =
      "0x095ea7b3" +
      prepared.curve.slice(2).toLowerCase().padStart(64, "0") +
      BigInt(quote.amount).toString(16).padStart(64, "0");
    if (tx.data.toLowerCase() !== expected) {
      throw new Error("Unexpected approval amount or spender.");
    }
  } else {
    const call = decodeFunctionData({ abi: PicklerBondingCurveAbi, data: tx.data as Hex });
    const args = call.args as readonly unknown[];
    if (
      call.functionName !== (quote.side === "buy" ? "buyExactInput" : "sellExactInput") ||
      args[0] !== BigInt(quote.amount) ||
      args[1] !== BigInt(quote.minimumOutput) ||
      String(args[2]).toLowerCase() !== wallet.toLowerCase() ||
      args[3] !== BigInt(Date.parse(prepared.expiresAt) / 1000)
    ) {
      throw new Error("Unexpected swap parameters.");
    }
  }
}
export async function sendInjectedTokenTransaction(
  provider: Eip1193Provider,
  prepared: PublicTokenTradePreparedDto,
  wallet: string,
  token: string,
) {
  await validatePublicTokenTransaction(prepared, wallet, token);
  const accounts = await provider.request({ method: "eth_accounts" });
  const chain = await provider.request({ method: "eth_chainId" });
  if (
    !Array.isArray(accounts) ||
    String(accounts[0]).toLowerCase() !== wallet.toLowerCase() ||
    BigInt(String(chain)) !== 10143n
  ) {
    throw new Error("Wallet account or network changed. Review the trade again.");
  }
  const tx = prepared.transaction;
  const nonce = await provider.request({
    method: "eth_getTransactionCount",
    params: [wallet, "pending"],
  });
  if (BigInt(String(nonce)) !== BigInt(tx.nonce)) {
    throw new Error("Wallet activity changed. Review the trade again.");
  }
  await provider.request({
    method: "eth_call",
    params: [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value }, "latest"],
  });
  // A prompt may remain open. Its swap deadline is enforced by the curve; no retry follows an uncertain send.
  let hash: unknown;
  try {
    hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ ...tx, chainId: toHex(tx.chainId), nonce: toHex(tx.nonce), type: "0x2" }],
    });
  } catch (error) {
    if ((error as { code?: number }).code === 4001) {
      throw error;
    }
    throw new WalletSubmissionUnknown(null);
  }
  if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) {
    throw new WalletSubmissionUnknown(null);
  }
  return hash;
}
/** A passkey SDK cannot substitute any part of the prepared transaction. */
export async function verifySignedPublicTokenTransaction(
  raw: Hex,
  prepared: PublicTokenTradePreparedDto,
) {
  if (!raw.startsWith("0x02")) {
    throw new Error("Expected an EIP-1559 transaction.");
  }
  const serialized = raw as `0x02${string}`;
  const actual = parseTransaction(serialized);
  const expected = prepared.transaction;
  const sender = await recoverTransactionAddress({ serializedTransaction: serialized });
  if (
    actual.type !== "eip1559" ||
    actual.chainId !== expected.chainId ||
    actual.nonce !== expected.nonce ||
    actual.to?.toLowerCase() !== expected.to.toLowerCase() ||
    actual.data?.toLowerCase() !== expected.data.toLowerCase() ||
    (actual.value ?? 0n) !== 0n ||
    actual.gas !== BigInt(expected.gas) ||
    actual.maxFeePerGas !== BigInt(expected.maxFeePerGas) ||
    actual.maxPriorityFeePerGas !== BigInt(expected.maxPriorityFeePerGas) ||
    (actual.accessList?.length ?? 0) !== 0 ||
    sender.toLowerCase() !== expected.from.toLowerCase()
  ) {
    throw new Error("The signed transaction does not match the prepared trade.");
  }
}
/** One explicit wallet RPC read/send, never polling or retrying. */
export async function publicWalletRpc(method: string, params: unknown[]) {
  const { MONAD_TESTNET } = await import("@pickler/chain");
  const response = await fetch(MONAD_TESTNET.publicRpcUrls[1], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
  });
  const body = await response.json();
  if (!response.ok || body.error || !("result" in body)) {
    throw new Error("Wallet network request failed.");
  }
  return body.result as unknown;
}
export async function submitSignedPublicTokenTransaction(raw: Hex) {
  const hash = keccak256(raw);
  try {
    const result = await publicWalletRpc("eth_sendRawTransaction", [raw]);
    if (typeof result !== "string" || result.toLowerCase() !== hash.toLowerCase()) {
      throw new Error("Unexpected hash");
    }
  } catch {
    throw new WalletSubmissionUnknown(hash);
  }
  return hash;
}
export async function publicTokenReceipt(hash: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) {
    throw new Error("Invalid transaction hash.");
  }
  const receipt = (await publicWalletRpc("eth_getTransactionReceipt", [hash])) as {
    status?: string;
    transactionHash?: string;
    blockNumber?: string;
    blockHash?: string;
  } | null;
  if (!receipt) {
    return "pending" as const;
  }
  if (
    receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
    !receipt.blockNumber ||
    !receipt.blockHash ||
    !["0x0", "0x1"].includes(receipt.status ?? "")
  ) {
    throw new Error("Transaction receipt unavailable.");
  }
  const block = (await publicWalletRpc("eth_getBlockByNumber", [receipt.blockNumber, false])) as {
    hash?: string;
  } | null;
  const head = BigInt(String(await publicWalletRpc("eth_blockNumber", [])));
  if (
    block?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    head < BigInt(receipt.blockNumber) + 2n
  ) {
    return "pending" as const;
  }
  return receipt.status === "0x1" ? ("confirmed" as const) : ("reverted" as const);
}
