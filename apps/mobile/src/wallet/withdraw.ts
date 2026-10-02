import { type Address, isAddress } from "viem";
import { formatAusd, parseAusd } from "../config/chain";

export type WithdrawInput = { to: string; amount: string; ausd: bigint };
export type WithdrawCheck = { ok: true; to: Address; amount: bigint } | { ok: false; error: string };

/** Validación previa a Review. No toca la red. */
export function validateWithdraw({ to, amount, ausd }: WithdrawInput): WithdrawCheck {
  const dest = to.trim();
  if (dest === "") return { ok: false, error: "Paste the destination address." };
  if (!isAddress(dest)) return { ok: false, error: "That is not a valid Monad address." };
  const units = parseAusd(amount);
  if (units === undefined || units === 0n) return { ok: false, error: "Enter an amount above zero." };
  if (units > ausd) return { ok: false, error: `That is more than the ${formatAusd(ausd)} AUSD available.` };
  return { ok: true, to: dest, amount: units };
}
