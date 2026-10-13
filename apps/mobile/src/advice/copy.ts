// Words and small rules of the Studio agents screens (src/screens/advice.tsx, the section in src/screens/agents.tsx).
// Pure: no react-native, so they are tested on their own.
import { formatUnits } from "viem";
import type { AdviceAskState } from "../hooks/useAdviceAsk";
import type { AdviceJobError, PaymentError } from "./types";

/** micro-AUSD as the screen writes a price: at least two decimals, never a rounded one ("1.50", "1.234567"). */
export function adviceAmount(micro: bigint): string {
  const [whole, frac = ""] = formatUnits(micro, 6).split(".");
  return `${whole}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** The fee split as the confirmation says it (fee split spec §4: creator 65 %, Pickler 35 %). */
export const splitLine = (handle: string): string => `65% to @${handle} · 35% to Pickler`;

/** m:ss since `since`. */
export function elapsedLabel(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Why the server turned a payment down. Every one of these charged nothing. */
export const REFUSAL_COPY: Record<PaymentError, string> = {
  invalid_payment: "Pickler couldn't accept that payment.",
  invalid_signature: "The payment's signature didn't check out.",
  wrong_amount: "The amount didn't match the agent's price.",
  wrong_recipient: "The payment named another recipient.",
  expired: "The payment expired before it reached Pickler. Check this phone's clock and ask again.",
  nonce_used: "That payment was already used.",
  insufficient_funds: "This wallet doesn't hold enough AUSD.",
  payer_not_linked: "This wallet isn't linked to your Pickler account.",
  settlement_failed: "The payment couldn't be settled.",
};

export const JOB_ERROR_COPY: Record<AdviceJobError, string> = {
  ANALYSIS_FAILED: "The agent couldn't finish this analysis.",
  ANALYSIS_INTERRUPTED: "The analysis was interrupted.",
  ANALYSIS_EXPIRED: "The analysis ran out of time.",
};

/**
 * An Ask in this state has to be finished or left before another agent's can start: something is in flight, or a
 * payment went out and is not resolved. A confirmation, a refusal or a result does not hold anything.
 */
export function holdsFlow(state: AdviceAskState): boolean {
  switch (state.kind) {
    case "quoting":
    case "signing":
    case "paying":
    case "waiting":
    case "timeout":
    case "settlement_pending":
    case "busy":
      return true;
    case "offline":
      return state.paid;
    default:
      return false;
  }
}

/** An ISO time of an analysis in local time, as the wallet's movements write theirs: "OCT 12, 10:01". */
export function analysisTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).toUpperCase();
}

/**
 * The username gate stays off this Ask (src/identity/state.ts, appQuiet): from its confirmation, which may open the wallet
 * with Face ID, until it is resolved or left. Unlocking is what triggers the identity check.
 */
export const keepsGateOff = (state: AdviceAskState): boolean => state.kind === "confirming" || holdsFlow(state);
