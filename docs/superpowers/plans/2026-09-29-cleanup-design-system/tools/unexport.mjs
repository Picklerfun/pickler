// A one-off removal of the `export` keyword from declarations nothing imports.
//
//   node unexport.mjs <list.tsv>
//
// list.tsv holds one `<file>\t<name>` per line. The declaration must be found exactly once, as
// `export type|interface|const|function|async function|class <name>`, or nothing is written.
import { readFileSync, writeFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));
const texts = new Map();
const wrong = [];
for (const [file, name] of rows) {
  const text = texts.get(file) ?? readFileSync(file, "utf8");
  const declaration = new RegExp(
    `^export ((?:type|interface|const|function|async function|class) ${name}\\b)`,
    "gm",
  );
  const found = [...text.matchAll(declaration)].length;
  if (found !== 1) {
    wrong.push(`${file}: expected one exported declaration of ${name}, found ${found}`);
    continue;
  }
  texts.set(file, text.replace(declaration, "$1"));
}
if (wrong.length) {
  process.stderr.write(`nothing written\n${wrong.map((line) => `  ${line}\n`).join("")}`);
  process.exit(1);
}
for (const [file, text] of texts) {
  writeFileSync(file, text);
}
process.stdout.write(`${rows.length} declaration(s) in ${texts.size} file(s) no longer exported\n`);
