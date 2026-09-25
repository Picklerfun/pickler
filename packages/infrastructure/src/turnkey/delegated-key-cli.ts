// Operator command: `npm run turnkey:delegated-key --workspace=@pickler/infrastructure`.
//
// With no argument it prints a fresh pair for an operator to put into `wrangler secret put`. With
// `--append <file>` it appends the pair to that file (a local `.dev.vars`) and prints only where
// it went — never the values, so the key does not end up in a terminal log or a transcript.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { devVarsLines, generateDelegatedKeyPair } from "./delegated-key.js";

const [flag, file] = process.argv.slice(2);
const pair = generateDelegatedKeyPair();

if (flag === "--append") {
  if (!file) {
    throw new Error("--append needs a file path");
  }
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  appendFileSync(file, devVarsLines(existing, pair), { mode: 0o600 });
  console.log(`Appended TURNKEY_DELEGATED_API_PUBLIC_KEY and _PRIVATE_KEY to ${file}`);
} else if (flag === undefined) {
  console.log(`TURNKEY_DELEGATED_API_PUBLIC_KEY=${pair.publicKey}`);
  console.log(`TURNKEY_DELEGATED_API_PRIVATE_KEY=${pair.privateKey}`);
} else {
  throw new Error(`Unknown argument ${flag}; use no argument or --append <file>`);
}
