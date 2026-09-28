// Operator command: `npm run turnkey:delegated-key --workspace=@pickler/infrastructure`.
//
// With no argument it prints only the public key of a fresh pair and says how to keep the private
// half: `--append <file>` writes both to that file (a local `.dev.vars`) and prints only where
// they went, and `--print-private` prints both, for an operator about to `wrangler secret put`.
// The private key is never printed without that explicit flag, so it does not end up in a
// terminal log or a transcript by default.

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
} else if (flag === "--print-private") {
  console.log(`TURNKEY_DELEGATED_API_PUBLIC_KEY=${pair.publicKey}`);
  console.log(`TURNKEY_DELEGATED_API_PRIVATE_KEY=${pair.privateKey}`);
} else if (flag === undefined) {
  console.log(`TURNKEY_DELEGATED_API_PUBLIC_KEY=${pair.publicKey}`);
  console.log(
    "The private key was not printed, so this pair cannot be used: run again with " +
      "`-- --append <path to .dev.vars>` to write a pair to a file, or `-- --print-private` " +
      "to print both for `wrangler secret put`.",
  );
} else {
  throw new Error(`Unknown argument ${flag}; use no argument, --append <file> or --print-private`);
}
