/** Public reference fixture, generated from business calculations; no provider or signer. */
import { readFileSync, writeFileSync } from "node:fs";
import { tokenReferenceEconomics } from "@pickler/core";
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
