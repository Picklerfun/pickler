import { C } from "../ui/theme";
import type { Agent } from "./data";

export function money(n: number, d?: number): string {
  const digits = d === undefined ? 2 : d;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export type Quote = { price: number; gross: number; fee: number; network: number; tokens: number };

export function quoteFor(agent: Agent, amount: number): Quote {
  const price = parseFloat(agent.price);
  const gross = amount;
  const fee = gross * 0.01;
  const net = gross - fee - 0.15;
  return { price, gross, fee, network: 0.15, tokens: net / price };
}

export type SellQuote = { price: number; qty: number; gross: number; fee: number; network: number; net: number };

export function sellQuoteFor(agent: Agent, sellPct: number): SellQuote {
  const price = parseFloat(agent.price);
  const qty = 4820 * (sellPct / 100);
  const gross = qty * price;
  const fee = gross * 0.01;
  return { price, qty, gross, fee, network: 0.15, net: gross - fee - 0.15 };
}

export type Pill = { bg: string; fg: string; bd: string };

/** pill(active, activeBg) → { bg, fg, bd } exactamente como el wireframe. */
export function pill(active: boolean, activeBg?: string): Pill {
  return active
    ? { bg: activeBg ?? C.ink, fg: activeBg ? C.onLime : C.onInk, bd: activeBg ?? C.ink }
    : { bg: "transparent", fg: C.dim, bd: C.hair2 };
}
