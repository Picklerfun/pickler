import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatShare,
  pluralOrDash,
  sourceEyebrow,
  sourceFootnote,
} from "../src/features/markets/lib/format";
import { outOfReach, quoteTicket } from "../src/features/markets/lib/quote";

const perpl = {
  venue: "perpl",
  network: "testnet",
  observedAt: "2026-10-01T14:03:11.482Z",
  stale: false,
} as const;

test("the eyebrow names the venue, the network and when it was read", () => {
  assert.equal(sourceEyebrow("MARKETS", perpl), "MARKETS · PERPL · MONAD TESTNET · 14:03:11 UTC");
  assert.equal(
    sourceEyebrow("MARKET", { ...perpl, network: "mainnet" }),
    "MARKET · PERPL · MONAD · 14:03:11 UTC",
  );
});

test("an answer the venue has not renewed says so, and a sample never passes for a venue", () => {
  assert.equal(
    sourceEyebrow("MARKETS", { ...perpl, stale: true }),
    "MARKETS · PERPL · MONAD TESTNET · 14:03:11 UTC · STALE",
  );
  assert.equal(sourceEyebrow("MARKETS", { venue: "sample" }), "MARKETS · SAMPLE DATA");
  assert.match(sourceFootnote({ venue: "sample" }), /not read from a venue/);
  assert.match(sourceFootnote({ ...perpl, stale: true }), /has not answered since/);
  assert.match(sourceFootnote(perpl), /Perpl/);
});

test("an empty board has no source to name", () => {
  assert.equal(sourceEyebrow("MARKETS", undefined), "MARKETS");
});

test("a count nobody has measured is a dash, never a zero", () => {
  assert.equal(pluralOrDash(null, "AGENT"), "— AGENTS");
  assert.equal(pluralOrDash(0, "AGENT"), "0 AGENTS");
  assert.equal(pluralOrDash(1, "OPEN CALL"), "1 OPEN CALL");
});

test("a share keeps the decimals it has and no others", () => {
  assert.equal(formatShare(0.05), "5");
  assert.equal(formatShare(0.0005), "0.05");
  assert.equal(formatShare(0.005), "0.5");
  assert.equal(formatShare(0.000345), "0.0345");
  assert.equal(formatShare(25 / 10_000 / 15), "0.0167");
  assert.equal(formatShare(0.1), "10");
});

const limits = {
  takerFee: 0.000345,
  maintenanceMargin: 0.0166667,
  slippageCap: 0.1,
  minimumAccountOpen: 100,
};

test("the ticket is quoted with the venue's limits for that market", () => {
  const quote = quoteTicket({
    market: { mark: 100, maxLeverage: 15, limits },
    level: 1,
    margin: 1000,
    leverage: 5,
  });

  assert.equal(quote.notional, 5000);
  assert.ok(Math.abs(quote.fee - 1.725) < 1e-9);
  // 1/5 less the maintenance share, below the mark for a long.
  assert.ok(Math.abs(quote.liquidation - 100 * (1 - (0.2 - 0.0166667))) < 1e-9);
});

test("a reach nobody has measured refuses no square", () => {
  assert.equal(outOfReach({ hourlyReach: null }, 2.5, "1H"), false);
  assert.equal(outOfReach({ hourlyReach: 1.5 }, 2.5, "1H"), true);
  assert.equal(outOfReach({ hourlyReach: 1.5 }, 2.5, "4H"), false);
});
