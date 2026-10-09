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
const NOT_FOUND = "This agent was not found. Reload the studio.";
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

/* Spec D4: an agent without a linked wallet is not for sale, even with a price saved. */
function savedTag(agent: Agent): Pick<AdvicePriceView, "tag" | "tone"> {
  if (agent.advicePrice === null) {
    return { tag: "NOT FOR SALE", tone: "quiet" };
  }
  if (agent.wallet === null) {
    return { tag: "PRICED · NO WALLET", tone: "caution" };
  }
  return { tag: `FOR SALE · ${agent.advicePrice.amount} AUSD`, tone: "good" };
}

/** Two price texts name the same price: equal micro-AUSD when both parse, else equal trimmed text. */
function samePrice(text: string, saved: string): boolean {
  const typed = parsePriceText(text);
  const kept = parsePriceText(saved);
  if (typed.ok && kept.ok) {
    return toMicro(typed.priceAusd) === toMicro(kept.priceAusd);
  }
  return text.trim() === saved;
}

/**
 * Whether the form says something other than what is saved: the toggle moved, or, while on, a
 * different price ("1.50" and " 1.5" are the saved 1.5; hidden text while off counts for nothing).
 */
export function priceFormDirty(agent: Agent, form: PriceForm): boolean {
  const saved = savedPriceForm(agent);
  if (form.forSale !== saved.forSale) {
    return true;
  }
  return form.forSale && !samePrice(form.text, saved.text);
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
  const dirty = priceFormDirty(agent, form);

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

  const clearing = body !== null && body.priceAusd === null;
  const walletOk = wallet !== null || clearing;
  const canSave = canManage && walletOk && dirty && body !== null;

  return {
    ...savedTag(agent),
    note: NOTE,
    walletLine:
      wallet === null ? null : `Paid to this agent's wallet, ${shortAddress(wallet.address)}.`,
    disabledReason,
    inputError,
    dirty,
    canSave,
    body: walletOk ? body : null,
  };
}

/**
 * Which controls are shut. A view-only member has none open. Without a wallet the price cannot be
 * typed and the toggle cannot be turned on, but a priced agent can still be taken off sale.
 */
export function advicePriceLocks(
  agent: Agent,
  form: PriceForm,
  canManage: boolean,
): { toggle: boolean; input: boolean } {
  const noWallet = agent.wallet === null;
  const cannotTurnOn = noWallet && !form.forSale;
  return { toggle: !canManage || cannotTurnOn, input: !canManage || noWallet };
}

export function advicePriceError(code: string): string {
  if (code === "AGENT_WALLET_REQUIRED") {
    return NO_WALLET;
  }
  if (code === "INVALID_INPUT") {
    return PRICE_BOUNDS;
  }
  if (code === "RESEARCH_ACCESS_DENIED") {
    return VIEW_ONLY_REASON;
  }
  if (code === "NOT_FOUND") {
    return NOT_FOUND;
  }
  return NOT_SAVED;
}

/** A refused save: the preview studio's note, or the API's code in the card's words. */
export function advicePriceOutcome(
  code: string,
): { kind: "preview" } | { kind: "error"; text: string } {
  if (code === "PREVIEW") {
    return { kind: "preview" };
  }
  return { kind: "error", text: advicePriceError(code) };
}
