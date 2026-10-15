import Constants from "expo-constants";
import { isAddress } from "viem";
import { API_URL } from "./api";

const extra = Constants.expoConfig?.extra ?? {};
const raw = typeof extra.adviceSplitter === "string" ? extra.adviceSplitter.trim() : "";

/**
 * The deployed PicklerAdviceSplitter (`ADVICE_SPLITTER_ADDRESS`): the only `payTo` an advice payment is signed to,
 * whatever a 402 says. null when unset or not a valid 20-byte address (a mixed-case one must carry its checksum).
 */
export const ADVICE_SPLITTER: `0x${string}` | null =
  /^0x[0-9a-fA-F]{40}$/.test(raw) && isAddress(raw) ? (raw as `0x${string}`) : null;

/** Studio agents are offered only with the product API and the pinned splitter both configured. */
export function studioAgentsEnabled(): boolean {
  return API_URL !== null && ADVICE_SPLITTER !== null;
}
