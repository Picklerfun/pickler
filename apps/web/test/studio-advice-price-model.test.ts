// apps/web/test/studio-advice-price-model.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "../src/features/studio/api";
import {
  NO_WALLET,
  PRICE_BOUNDS,
  advicePriceError,
  advicePriceLocks,
  advicePriceOutcome,
  advicePriceView,
  parsePriceText,
  savedPriceForm,
} from "../src/features/studio/live/advice-price-model";
import { VIEW_ONLY_REASON } from "../src/features/studio/live/build-model";

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234abcd";

function agent(priced: boolean, withWallet = true): Agent {
  return {
    wallet: withWallet ? { walletId: "w", address: ADDRESS, balanceAusd: 1 } : null,
    advicePrice: priced ? { amount: "1.5", asset: "AUSD", decimals: 6 } : null,
  } as unknown as Agent;
}

test("parsePriceText trims spaces and accepts the bounds", () => {
  assert.deepEqual(parsePriceText("1.5"), { ok: true, priceAusd: "1.5" });
  assert.deepEqual(parsePriceText(" 2 "), { ok: true, priceAusd: "2" });
  assert.deepEqual(parsePriceText("0.10"), { ok: true, priceAusd: "0.10" });
  assert.deepEqual(parsePriceText("100"), { ok: true, priceAusd: "100" });
});

test("parsePriceText refuses out-of-range and malformed prices", () => {
  for (const text of ["0.09", "100.01", "1.1234567", "abc", ""]) {
    assert.deepEqual(parsePriceText(text), { ok: false, reason: PRICE_BOUNDS }, text);
  }
  assert.equal(PRICE_BOUNDS, "Between 0.10 and 100 AUSD, up to 6 decimals.");
});

test("parsePriceText asks for a dot when given a comma", () => {
  assert.deepEqual(parsePriceText("1,5"), { ok: false, reason: "Use a dot for decimals." });
});

test("savedPriceForm follows the saved price", () => {
  assert.deepEqual(savedPriceForm(agent(true)), { forSale: true, text: "1.5" });
  assert.deepEqual(savedPriceForm(agent(false)), { forSale: false, text: "" });
});

test("an agent without a wallet cannot sell, and never builds a body", () => {
  const view = advicePriceView(agent(false, false), { forSale: true, text: "2" }, true);

  assert.equal(view.disabledReason, "This agent needs its own wallet before it can sell analyses.");
  assert.equal(view.disabledReason, NO_WALLET);
  assert.equal(view.canSave, false);
  assert.equal(view.body, null);
  assert.equal(view.walletLine, null);
});

test("a view-only member cannot save", () => {
  const view = advicePriceView(agent(true), { forSale: false, text: "1.5" }, false);

  assert.equal(view.canSave, false);
  assert.equal(view.disabledReason, VIEW_ONLY_REASON);
});

test("the tag says what is saved, and an untouched form is clean", () => {
  const priced = advicePriceView(agent(true), savedPriceForm(agent(true)), true);
  const unpriced = advicePriceView(agent(false), savedPriceForm(agent(false)), true);

  assert.equal(priced.tag, "FOR SALE · 1.5 AUSD");
  assert.equal(priced.tone, "good");
  assert.equal(priced.dirty, false);
  assert.equal(priced.canSave, false);
  assert.equal(unpriced.tag, "NOT FOR SALE");
  assert.equal(unpriced.tone, "quiet");
});

test("turning the toggle off on a priced agent sends null, without asking for a price", () => {
  const view = advicePriceView(agent(true), { forSale: false, text: "" }, true);

  assert.equal(view.dirty, true);
  assert.deepEqual(view.body, { priceAusd: null });
  assert.equal(view.canSave, true);
  assert.equal(view.inputError, null);
});

test("turning the toggle on needs a valid price", () => {
  const good = advicePriceView(agent(false), { forSale: true, text: "2" }, true);
  const bad = advicePriceView(agent(false), { forSale: true, text: "0.01" }, true);

  assert.deepEqual(good.body, { priceAusd: "2" });
  assert.equal(good.canSave, true);
  assert.equal(bad.inputError, PRICE_BOUNDS);
  assert.equal(bad.canSave, false);
  assert.equal(bad.body, null);
});

test("an empty price on a fresh toggle is not yet an error", () => {
  const view = advicePriceView(agent(false), { forSale: true, text: "" }, true);

  assert.equal(view.canSave, false);
  assert.equal(view.body, null);
});

test("the view says where the money goes and that failures are not refunded", () => {
  const view = advicePriceView(agent(true), savedPriceForm(agent(true)), true);

  assert.equal(view.walletLine, "Paid to this agent's wallet, 0x1234…abcd.");
  assert.ok(view.note.includes("A failed analysis is not refunded automatically."));
});

test("the view follows the saved price when the form is clean", () => {
  const before = advicePriceView(agent(false), savedPriceForm(agent(false)), true);
  const after = advicePriceView(agent(true), savedPriceForm(agent(true)), true);

  assert.equal(before.tag, "NOT FOR SALE");
  assert.equal(after.tag, "FOR SALE · 1.5 AUSD");
  assert.equal(after.dirty, false);
});

test("advicePriceError words each API code", () => {
  assert.equal(advicePriceError("AGENT_WALLET_REQUIRED"), NO_WALLET);
  assert.equal(advicePriceError("INVALID_INPUT"), PRICE_BOUNDS);
  assert.equal(advicePriceError("FORBIDDEN"), VIEW_ONLY_REASON);
  assert.equal(advicePriceError("OTHER"), "The price was not saved. Try again.");
});

test("a creator can take a priced agent off sale after its wallet was unlinked", () => {
  const view = advicePriceView(agent(true, false), { forSale: false, text: "" }, true);

  assert.equal(view.disabledReason, NO_WALLET);
  assert.deepEqual(view.body, { priceAusd: null });
  assert.equal(view.canSave, true);
});

test("an unpriced agent without a wallet cannot be priced", () => {
  const view = advicePriceView(agent(false, false), { forSale: true, text: "2" }, true);

  assert.equal(view.canSave, false);
  assert.equal(view.body, null);
});

test("without a wallet only the toggle off stays open; a view-only member has nothing open", () => {
  const owner = advicePriceLocks(agent(true), { forSale: true, text: "1.5" }, true);
  assert.deepEqual(owner, { toggle: false, input: false });

  const unlinkedPriced = advicePriceLocks(agent(true, false), { forSale: true, text: "1.5" }, true);
  assert.deepEqual(unlinkedPriced, { toggle: false, input: true });

  const unlinkedOff = advicePriceLocks(agent(true, false), { forSale: false, text: "1.5" }, true);
  assert.deepEqual(unlinkedOff, { toggle: true, input: true });

  const viewer = advicePriceLocks(agent(true), { forSale: true, text: "1.5" }, false);
  assert.deepEqual(viewer, { toggle: true, input: true });
});

test("a refused save on a preview studio says so; any other refusal is worded", () => {
  assert.deepEqual(advicePriceOutcome("PREVIEW"), { kind: "preview" });
  assert.deepEqual(advicePriceOutcome("AGENT_WALLET_REQUIRED"), { kind: "error", text: NO_WALLET });
  assert.deepEqual(advicePriceOutcome("NETWORK"), {
    kind: "error",
    text: "The price was not saved. Try again.",
  });
});
