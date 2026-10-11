/** Public reference fixture, generated from business calculations; no provider or signer. */
import { readFileSync, writeFileSync } from "node:fs";
import {
  tokenReferenceEconomics,
  tokensOutForQuoteIn,
  quoteOutForTokensIn,
  splitCurveFee,
  tokenTradeMinimumOutput,
} from "@pickler/core";
import { AUSD } from "@pickler/chain";

const output = new URL("../apps/web/src/features/tokens/reference-economics.json", import.meta.url);
const text = JSON.stringify(tokenReferenceEconomics(AUSD[10143]), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== text) {
    throw new Error("Token economics fixture drift; run npm run tokens:fixtures");
  }
} else {
  writeFileSync(output, text);
}

// Two fixed, explicitly simulated amounts. Never quote arbitrary preview input in the browser.
const reference = tokenReferenceEconomics(AUSD[10143]);
const config = {
  virtualTokenReserve: BigInt(reference.virtualTokenReserve),
  virtualQuoteReserve: BigInt(reference.virtualQuoteReserve),
  saleAllocation: BigInt(reference.saleAllocation),
};
const sold = 1000000n * 10n ** 18n;
const inputs = { buy: 1000000n, sell: 1000n * 10n ** 18n };
const quotes = Object.fromEntries(
  Object.entries(inputs).map(([side, amount]) => {
    const output =
      side === "buy"
        ? tokensOutForQuoteIn(config, sold, splitCurveFee(amount, 100).net)
        : splitCurveFee(quoteOutForTokensIn(config, sold, amount), 100).net;
    return [
      side,
      {
        amount: amount.toString(),
        slippageBps: 50,
        side,
        approval: false,
        expectedOutput: output.toString(),
        minimumOutput: tokenTradeMinimumOutput(output, 50).toString(),
        balance: side === "buy" ? "100000000" : (10000n * 10n ** 18n).toString(),
        allowance: "0",
        feeBps: 100,
      },
    ];
  }),
);
const tradeOutput = new URL("../apps/web/src/features/tokens/trade-quotes.json", import.meta.url);
const tradeText = JSON.stringify(quotes, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(tradeOutput, "utf8") !== tradeText) {
    throw new Error("Token trade fixture drift; run npm run tokens:fixtures");
  }
} else {
  writeFileSync(tradeOutput, tradeText);
}
