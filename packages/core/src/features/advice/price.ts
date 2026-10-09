import { PilotError } from "../research/types.js";

export interface AdvicePrice {
  amount: string;
  asset: "AUSD";
  decimals: 6;
}

export function formatMicroAusd(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function advicePrice(micro: bigint | null): AdvicePrice | null {
  return micro === null ? null : { amount: formatMicroAusd(micro), asset: "AUSD", decimals: 6 };
}

export const ADVICE_PRICE_MIN_MICRO = 100_000n;
export const ADVICE_PRICE_MAX_MICRO = 100_000_000n;

export function parseAusdToMicro(value: string): bigint {
  const match = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw new PilotError("INVALID_INPUT", "The price must be AUSD with at most 6 decimals");
  }
  const micro = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micro < ADVICE_PRICE_MIN_MICRO || micro > ADVICE_PRICE_MAX_MICRO) {
    throw new PilotError("INVALID_INPUT", "The price must be between 0.10 and 100 AUSD");
  }
  return micro;
}
