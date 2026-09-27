import { encodeFunctionData, parseAbi } from "viem";
import { z } from "zod";
import {
  PilotError,
  type PaperOrder,
  type PaperResolution,
  type PaperResolutionProvider,
} from "@pickler/core";
import { providerJson } from "../research/http.js";

// Official Polygon CTF, shared by standard and negative-risk markets.
// https://docs.polymarket.com/resources/contracts
const contract = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const abi = parseAbi([
  "function payoutDenominator(bytes32) view returns (uint256)",
  "function payoutNumerators(bytes32,uint256) view returns (uint256)",
  "function getOutcomeSlotCount(bytes32) view returns (uint256)",
]);
const uintHex = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/** Read-only public RPC. Never loads credentials or imports signing/trading adapters. */
export class PolymarketPaperResolution implements PaperResolutionProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async rpc(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
    const response = await providerJson(
      "https://polygon-bor-rpc.publicnode.com",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      },
      signal,
      this.fetcher,
    );
    const parsed = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.literal(1),
        result: z.unknown(),
        error: z.unknown().optional(),
      })
      .safeParse(response);
    if (!parsed.success || parsed.data.error || parsed.data.result === undefined) {
      throw new PilotError("PAPER_RESOLUTION_UNAVAILABLE", "Polygon resolution query failed");
    }
    return parsed.data.result;
  }
  async resolution(
    order: PaperOrder,
    signal: AbortSignal,
    beforeCall?: () => Promise<void>,
  ): Promise<PaperResolution | null> {
    const identity = order.fill?.conditions.resolution;
    if (
      !identity ||
      !/^0x[0-9a-f]{64}$/.test(identity.conditionId) ||
      !Number.isInteger(identity.outcomeIndex) ||
      !Number.isInteger(identity.outcomeCount) ||
      identity.outcomeCount < 2 ||
      identity.outcomeCount > 10 ||
      identity.outcomeIndex < 0 ||
      identity.outcomeIndex >= identity.outcomeCount ||
      order.fill?.market.outcomes[identity.outcomeIndex]?.id !== order.outcomeId
    ) {
      throw new PilotError(
        "PAPER_RESOLUTION_IDENTITY_MISSING",
        "A buy-time condition and outcome snapshot is required; historical positions are not guessed",
      );
    }
    const query = async (method: string, params: unknown[]) => {
      signal.throwIfAborted();
      await beforeCall?.();
      signal.throwIfAborted();
      return this.rpc(method, params, signal);
    };
    if ((await query("eth_chainId", [])) !== "0x89") {
      throw new PilotError("PAPER_RESOLUTION_UNAVAILABLE", "Expected Polygon mainnet");
    }
    const parsed = z
      .object({ number: z.string().regex(/^0x[0-9a-fA-F]+$/), hash: uintHex })
      .safeParse(await query("eth_getBlockByNumber", ["finalized", false]));
    if (!parsed.success) {
      throw new PilotError("PAPER_RESOLUTION_UNAVAILABLE", "Finalized block unavailable");
    }
    const block = parsed.data;
    const read = async (
      functionName: "payoutDenominator" | "payoutNumerators" | "getOutcomeSlotCount",
      index?: number,
    ) => {
      const condition = identity.conditionId as `0x${string}`;
      const data =
        functionName === "payoutNumerators"
          ? encodeFunctionData({ abi, functionName, args: [condition, BigInt(index!)] })
          : encodeFunctionData({ abi, functionName, args: [condition] });
      const value = uintHex.safeParse(
        await query("eth_call", [
          { to: contract, data },
          { blockHash: block.hash, requireCanonical: true },
        ]),
      );
      if (!value.success) {
        throw new PilotError("PAPER_RESOLUTION_UNAVAILABLE", "Invalid contract response");
      }
      return BigInt(value.data);
    };
    const denominator = await read("payoutDenominator");
    if (denominator === 0n) {
      return null;
    }
    if ((await read("getOutcomeSlotCount")) !== BigInt(identity.outcomeCount)) {
      throw new PilotError(
        "PAPER_RESOLUTION_UNAVAILABLE",
        "Outcome count does not match the buy-time snapshot",
      );
    }
    const numerator = await read("payoutNumerators", identity.outcomeIndex);
    if (numerator > denominator) {
      throw new PilotError("PAPER_RESOLUTION_UNAVAILABLE", "Invalid payout fraction");
    }
    return {
      marketId: order.marketId,
      outcomeId: order.outcomeId,
      conditionId: identity.conditionId,
      outcomeIndex: identity.outcomeIndex,
      numerator: String(numerator),
      denominator: String(denominator),
      observedAt: new Date().toISOString(),
      chainId: 137,
      contract,
      blockNumber: String(BigInt(block.number)),
      blockHash: block.hash,
    };
  }
}
