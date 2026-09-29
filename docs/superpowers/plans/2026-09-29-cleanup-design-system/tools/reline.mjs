// A one-off exact-text rewrite of one file.
//
//   node reline.mjs <file> <edits.json>
//
// edits.json is [{ "find": "…", "replace": "…", "count": 1 }, …]. Each `find` must occur exactly
// `count` times (1 when omitted) or nothing is written: a table that no longer matches the file
// is a table to re-read, not to force.
import { readFileSync, writeFileSync } from "node:fs";

const [file, editsFile] = process.argv.slice(2);
const edits = JSON.parse(readFileSync(editsFile, "utf8"));
let text = readFileSync(file, "utf8");
const wrong = [];
for (const { find, replace, count = 1 } of edits) {
  const found = text.split(find).length - 1;
  if (found !== count) {
    wrong.push(`expected ${count}, found ${found}: ${JSON.stringify(find)}`);
    continue;
  }
  text = text.split(find).join(replace);
}
if (wrong.length) {
  process.stderr.write(`${file}: nothing written\n${wrong.map((line) => `  ${line}\n`).join("")}`);
  process.exit(1);
}
writeFileSync(file, text);
process.stdout.write(`${file}: ${edits.length} edit(s) applied\n`);
