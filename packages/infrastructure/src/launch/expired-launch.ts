import {
  decodeEventLog,
  decodeFunctionData,
  keccak256,
  parseTransaction,
  toEventSelector,
  type Hex,
} from "viem";
import { PicklerLaunchFactoryAbi } from "@pickler/chain";
import type { TokenLaunchRecovery, TokenPreparedTransaction } from "@pickler/core";
import type { Rpc } from "../chain/erc20.js";
import type { TokenLaunchPolicy } from "./policy.js";

const HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x[0-9a-f]+$/i;
const LAUNCH_TOPIC = toEventSelector(
  "LaunchCreated(address,address,bytes32,address,address,bytes32,bytes32)",
);
type Header = { number: string; timestamp: string; hash: string };

/** Public factory logs only: private agent keys and signed grants never enter RPC parameters. */
export async function reconcileExpiredLaunch(input: {
  rpc: Rpc;
  policy: TokenLaunchPolicy;
  prepared: TokenPreparedTransaction;
  agentKey: string;
}): Promise<TokenLaunchRecovery | null> {
  const { rpc, policy, prepared } = input;
  const tx = parseTransaction(prepared.unsignedTransaction as Hex);
  if (
    tx.type !== "eip1559" ||
    tx.r ||
    prepared.chainId !== 10143 ||
    tx.chainId !== 10143 ||
    tx.to?.toLowerCase() !== policy.factory.address ||
    !tx.data ||
    prepared.destination.toLowerCase() !== policy.factory.address ||
    policy.factory.implementation
  ) {
    throw new Error("UNSUPPORTED_LAUNCH_RECOVERY");
  }
  const decoded = decodeFunctionData({ abi: PicklerLaunchFactoryAbi, data: tx.data });
  if (decoded.functionName !== "createLaunch") {
    throw new Error("UNSUPPORTED_LAUNCH_RECOVERY");
  }
  const [params, creatorAuthorization, , grantDeadline] = decoded.args;
  const deadline = BigInt(prepared.deadline);
  if (
    params.agentKey.toLowerCase() !== input.agentKey.toLowerCase() ||
    params.creator.toLowerCase() !== prepared.sender.toLowerCase() ||
    params.creatorFeeRecipient.toLowerCase() !== params.creator.toLowerCase() ||
    creatorAuthorization !== "0x" ||
    params.deadline !== deadline ||
    grantDeadline !== deadline ||
    deadline < 300n
  ) {
    throw new Error("INVALID_LAUNCH_RECOVERY");
  }
  // The immutable factory accepts a grant for at most five minutes and rejects it afterwards.
  const earliest = deadline - 300n;
  let calls = 0;
  async function call(method: string, args: unknown[]) {
    if (++calls > 100) {
      throw new Error("LAUNCH_RECOVERY_READ_LIMIT");
    }
    return rpc.call(method, args);
  }
  if (BigInt(String(await call("eth_chainId", []))) !== BigInt(policy.chainId)) {
    throw new Error("RECOVERY_CHAIN_MISMATCH");
  }
  const code = await call("eth_getCode", [policy.factory.address, "latest"]);
  if (
    typeof code !== "string" ||
    !QUANTITY.test(code) ||
    keccak256(code as Hex) !== policy.factory.codeHash
  ) {
    throw new Error("RECOVERY_FACTORY_CHANGED");
  }
  const headValue = await call("eth_blockNumber", []);
  if (typeof headValue !== "string" || !QUANTITY.test(headValue)) {
    throw new Error("INVALID_RECOVERY_HEAD");
  }
  const confirmed = BigInt(headValue) - BigInt(policy.confirmations);
  const deployment = BigInt(policy.factory.deploymentBlock);
  if (confirmed < deployment) {
    return null;
  }
  const headers = new Map<bigint, Header>();
  async function header(number: bigint, fresh = false): Promise<Header> {
    const cached = headers.get(number);
    if (cached && !fresh) {
      return cached;
    }
    const value = (await call("eth_getBlockByNumber", [
      "0x" + number.toString(16),
      false,
    ])) as Header | null;
    if (
      !value ||
      !HASH.test(value.hash) ||
      !QUANTITY.test(value.timestamp) ||
      !QUANTITY.test(value.number) ||
      BigInt(value.number) !== number
    ) {
      throw new Error("INVALID_RECOVERY_BLOCK");
    }
    headers.set(number, value);
    return value;
  }
  const anchor = await header(confirmed);
  if (BigInt(anchor.timestamp) <= deadline) {
    return null;
  }
  // Lower bounds include every block with equal timestamps at either grant boundary.
  async function firstAtOrAfter(time: bigint) {
    let low = deployment;
    let high = confirmed;
    while (low < high) {
      const middle = (low + high) / 2n;
      if (BigInt((await header(middle)).timestamp) < time) {
        low = middle + 1n;
      } else {
        high = middle;
      }
    }
    return low;
  }
  const first = await firstAtOrAfter(earliest);
  const end = await firstAtOrAfter(deadline + 1n);
  let found: { txHash: string; blockNumber: bigint; blockHash: string } | null = null;
  for (let from = first; from < end; from += 100n) {
    const to = from + 99n < end ? from + 99n : end - 1n;
    const logs = await call("eth_getLogs", [
      {
        address: policy.factory.address,
        topics: [LAUNCH_TOPIC],
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
      },
    ]);
    if (!Array.isArray(logs) || logs.length > 1000) {
      throw new Error("INVALID_RECOVERY_LOGS");
    }
    for (const log of logs) {
      if (
        !log ||
        log.removed === true ||
        log.address?.toLowerCase() !== policy.factory.address ||
        !HASH.test(log.transactionHash) ||
        !HASH.test(log.blockHash) ||
        !QUANTITY.test(log.blockNumber) ||
        BigInt(log.blockNumber) < from ||
        BigInt(log.blockNumber) > to
      ) {
        throw new Error("INVALID_RECOVERY_LOG");
      }
      const event = decodeEventLog({
        abi: PicklerLaunchFactoryAbi,
        eventName: "LaunchCreated",
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (event.args.agentKey.toLowerCase() !== input.agentKey.toLowerCase()) {
        continue;
      }
      if (
        found ||
        event.args.creator.toLowerCase() !== prepared.sender.toLowerCase() ||
        event.args.metadataHash !== params.metadataHash ||
        event.args.presetHash !== params.expectedConfigHash ||
        event.args.quoteToken.toLowerCase() !== policy.preset.quoteAddress
      ) {
        throw new Error("AMBIGUOUS_LAUNCH_RECOVERY");
      }
      found = {
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        blockHash: log.blockHash,
      };
    }
  }
  if (found && (await header(found.blockNumber, true)).hash !== found.blockHash) {
    throw new Error("RECOVERY_REORG");
  }
  if ((await header(confirmed, true)).hash !== anchor.hash) {
    throw new Error("RECOVERY_REORG");
  }
  if (found) {
    return { status: "found", txHash: found.txHash };
  }
  return { status: "expired", blockNumber: confirmed.toString(), blockHash: anchor.hash };
}
