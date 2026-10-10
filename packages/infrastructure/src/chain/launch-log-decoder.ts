import { decodeEventLog, type Abi } from "viem";

import {
  PicklerGraduationAdapterV4V2Abi,
  PicklerGraduationAdapterV4V2AbiHash,
  PicklerLiquidityLockerV2Abi,
  PicklerLiquidityLockerV2AbiHash,
  PicklerGraduationAdapterKuruAbi,
  PicklerGraduationAdapterKuruAbiHash,
  PicklerKuruLiquidityLockerAbi,
  PicklerKuruLiquidityLockerAbiHash,
  PicklerFeeEscrowV2Abi,
  PicklerFeeEscrowV2AbiHash,
  PicklerBondingCurveAbi,
  PicklerBondingCurveAbiHash,
  PicklerFeeEscrowAbi,
  PicklerFeeEscrowAbiHash,
  PicklerGraduationAdapterV4Abi,
  PicklerGraduationAdapterV4AbiHash,
  PicklerLaunchFactoryAbi,
  PicklerLaunchFactoryAbiHash,
  PicklerLiquidityLockerAbi,
  PicklerLiquidityLockerAbiHash,
} from "@pickler/chain";
import type { ChainLog } from "@pickler/core";

import type { LogDecoder } from "./launch-indexer.js";

/**
 * Decodes Pickler's own logs using the ABIs generated from the compiler.
 *
 * Each decoded event records which ABI version read it. A contract that changes later gets a
 * new hash, and a log stored under the old one stays interpretable instead of silently being
 * re-read with a layout it was never written under.
 *
 * A log that no known ABI matches returns null rather than being stored half-understood. An
 * unrecognised event is a gap in our understanding, and recording it as though we understood
 * it is how that gap stops being visible.
 */
const SOURCES: readonly { abi: Abi; abiHash: string }[] = [
  {
    abi: PicklerGraduationAdapterV4V2Abi as unknown as Abi,
    abiHash: PicklerGraduationAdapterV4V2AbiHash,
  },
  { abi: PicklerLiquidityLockerV2Abi as unknown as Abi, abiHash: PicklerLiquidityLockerV2AbiHash },
  {
    abi: PicklerGraduationAdapterKuruAbi as unknown as Abi,
    abiHash: PicklerGraduationAdapterKuruAbiHash,
  },
  {
    abi: PicklerKuruLiquidityLockerAbi as unknown as Abi,
    abiHash: PicklerKuruLiquidityLockerAbiHash,
  },
  { abi: PicklerFeeEscrowV2Abi as unknown as Abi, abiHash: PicklerFeeEscrowV2AbiHash },
  { abi: PicklerLaunchFactoryAbi as unknown as Abi, abiHash: PicklerLaunchFactoryAbiHash },
  { abi: PicklerBondingCurveAbi as unknown as Abi, abiHash: PicklerBondingCurveAbiHash },
  {
    abi: PicklerGraduationAdapterV4Abi as unknown as Abi,
    abiHash: PicklerGraduationAdapterV4AbiHash,
  },
  { abi: PicklerLiquidityLockerAbi as unknown as Abi, abiHash: PicklerLiquidityLockerAbiHash },
  { abi: PicklerFeeEscrowAbi as unknown as Abi, abiHash: PicklerFeeEscrowAbiHash },
];

export const decodeLaunchLog: LogDecoder = (log: ChainLog) => {
  for (const source of SOURCES) {
    try {
      const decoded = decodeEventLog({
        abi: source.abi,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        data: log.data,
      });

      if (!decoded.eventName) {
        continue;
      }

      return {
        eventName: decoded.eventName,
        abiHash: source.abiHash,
        decoded: toJson(decoded.args),
      };
    } catch {
      // Not this ABI. Trying the next one is cheaper than maintaining a topic-to-ABI map
      // that could drift from the generated artifacts.
      continue;
    }
  }

  return null;
};

/**
 * JSONB has no bigint, and a uint256 does not survive a float. Amounts become decimal
 * strings, which is also how the HTTP layer serialises them.
 */
function toJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(toJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  }

  return value;
}
