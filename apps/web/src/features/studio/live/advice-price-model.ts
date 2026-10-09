import type { AdvicePriceUpdateDto } from "@pickler/api-schema";
import type { Agent } from "../api";
import { shortAddress } from "../new-agent/model";
import { VIEW_ONLY_REASON } from "./build-model";

/** The price card's inputs: the toggle and the text of the price field. */
export type PriceForm = { forSale: boolean; text: string };

export type AdvicePriceView = {
  tag: string;
  tone: "good" | "quiet" | "caution";
  note: string;
  walletLine: string | null;
  disabledReason: string | null;
  inputError: string | null;
  dirty: boolean;
  canSave: boolean;
  body: AdvicePriceUpdateDto | null;
};

/* Mirrors the API's rule (core owns it; the web never imports core): validation here only improves
   feedback, the server decides. */
const PRICE = /^\d{1,3}(\.\d{1,6})?$/;
const MIN_MICRO = 100_000n;
const MAX_MICRO = 100_000_000n;

export const PRICE_BOUNDS = "Between 0.10 and 100 AUSD, up to 6 decimals.";
export const NO_WALLET = "This agent needs its own wallet before it can sell analyses.";
const COMMA = "Use a dot for decimals.";
const NOT_SAVED = "The price was not saved. Try again.";
const NOTE =
  "Buyers pay this once per fresh analysis. A failed analysis is not refunded automatically.";

function toMicro(text: string): bigint {
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function parsePriceText(
  text: string,
): { ok: true; priceAusd: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed.includes(",")) {
    return { ok: false, reason: COMMA };
  }
  if (!PRICE.test(trimmed)) {
    return { ok: false, reason: PRICE_BOUNDS };
  }
  const micro = toMicro(trimmed);
  const inBounds = micro >= MIN_MICRO && micro <= MAX_MICRO;
  if (!inBounds) {
    return { ok: false, reason: PRICE_BOUNDS };
  }
  return { ok: true, priceAusd: trimmed };
}

export function savedPriceForm(agent: Agent): PriceForm {
  return { forSale: agent.advicePrice !== null, text: agent.advicePrice?.amount ?? "" };
}

function savedTag(agent: Agent): Pick<AdvicePriceView, "tag" | "tone"> {
  if (agent.advicePrice === null) {
    return { tag: "NOT FOR SALE", tone: "quiet" };
  }
  return { tag: `FOR SALE · ${agent.advicePrice.amount} AUSD`, tone: "good" };
}

export function advicePriceView(
  agent: Agent,
  form: PriceForm,
  canManage: boolean,
): AdvicePriceView {
  const saved = savedPriceForm(agent);
  const wallet = agent.wallet;
  const turnedOff = saved.forSale && !form.forSale;
  const turnedOn = form.forSale;
  const dirty = form.forSale !== saved.forSale || (turnedOn && form.text.trim() !== saved.text);

  const parsed = turnedOn ? parsePriceText(form.text) : null;
  const typed = turnedOn && form.text.trim() !== "";
  const inputError = parsed !== null && !parsed.ok && typed ? parsed.reason : null;

  let body: AdvicePriceUpdateDto | null = null;
  if (dirty && turnedOff) {
    body = { priceAusd: null };
  }
  if (dirty && parsed !== null && parsed.ok) {
    body = { priceAusd: parsed.priceAusd };
  }

  let disabledReason: string | null = null;
  if (wallet === null) {
    disabledReason = NO_WALLET;
  }
  if (!canManage) {
    disabledReason = VIEW_ONLY_REASON;
  }

  const canSave = canManage && wallet !== null && dirty && body !== null;

  return {
    ...savedTag(agent),
    note: NOTE,
    walletLine:
      wallet === null ? null : `Paid to this agent's wallet, ${shortAddress(wallet.address)}.`,
    disabledReason,
    inputError,
    dirty,
    canSave,
    body: wallet === null ? null : body,
  };
}

export function advicePriceError(code: string): string {
  if (code === "AGENT_WALLET_REQUIRED") {
    return NO_WALLET;
  }
  if (code === "INVALID_INPUT") {
    return PRICE_BOUNDS;
  }
  if (code === "FORBIDDEN") {
    return VIEW_ONLY_REASON;
  }
  return NOT_SAVED;
}
