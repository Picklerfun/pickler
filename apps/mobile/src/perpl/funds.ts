import { formatAusd, parseAusd } from "../config/chain";

export type FundsMode = "add" | "withdraw";
export type FundsCheck = { ok: true; amount: bigint } | { ok: false; error: string };

/** Validación previa a Review. No toca la red. */
export function validateFunds(mode: FundsMode, text: string, wallet: bigint, free: bigint, minDeposit: bigint, minWithdraw: bigint): FundsCheck {
  const units = parseAusd(text);
  if (units === undefined || units === 0n) return { ok: false, error: "Enter an amount above zero." };
  if (mode === "add") {
    if (units < minDeposit) return { ok: false, error: `Minimum deposit is ${formatAusd(minDeposit)} AUSD.` };
    if (units > wallet) return { ok: false, error: `That is more than the ${formatAusd(wallet)} AUSD in your wallet.` };
  } else {
    if (units < minWithdraw) return { ok: false, error: `Minimum withdrawal is ${formatAusd(minWithdraw)} AUSD.` };
    if (units > free) return { ok: false, error: `That is more than the ${formatAusd(free)} AUSD free in trading.` };
  }
  return { ok: true, amount: units };
}
