// Two folders of screenshots, and which screens differ between them.
//
//   node scripts/design/compare.mjs <before-folder> <after-folder> [--noise <file>] [--partial]
//
// It judges nothing. A task that changes a screen on purpose expects a difference and a task that
// does not expects none, and only the person who knows which task ran can say which this is — so
// this prints every screen that moved, by how much and where, and always exits 0.
//
// --noise names the output of an earlier run of this script over two captures of the same tree.
// A screen listed there moves by itself, and a difference its size is printed as NOISE.
// --partial says the second folder holds only some routes (DESIGN_ROUTES), so a screen missing
// from it was not captured rather than removed, and is not reported.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { openBrowser } from "./lib/browser.mjs";
import { difference } from "./lib/compare-page.mjs";
import { line, readNoise } from "./lib/compare-report.mjs";

const partial = process.argv.includes("--partial");
const args = process.argv.slice(2).filter((arg) => arg !== "--partial");
const flag = args.indexOf("--noise");
const noiseFile = flag === -1 ? null : args[flag + 1];
const [before, after] = args.filter((arg, at) => flag === -1 || (at !== flag && at !== flag + 1));
if (!before || !after) {
  process.stderr.write(
    "usage: node scripts/design/compare.mjs <before> <after> [--noise <file>] [--partial]\n",
  );
  process.exit(2);
}
const noise = noiseFile ? readNoise(readFileSync(noiseFile, "utf8")) : new Map();
const shots = (folder) => readdirSync(folder).filter((name) => name.endsWith(".png"));
const url = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

const was = shots(before);
const is = shots(after);
const browser = await openBrowser();
const lines = [];
let same = 0;
try {
  const page = await browser.newPage();
  for (const name of was.filter((shot) => is.includes(shot)).sort()) {
    const result = await page.evaluate(difference, [
      url(path.join(before, name)),
      url(path.join(after, name)),
    ]);
    const said = line(name, result, noise);
    if (said) {
      lines.push(said);
    } else {
      same += 1;
    }
  }
} finally {
  await browser.close();
}
for (const name of partial ? [] : was.filter((shot) => !is.includes(shot)).sort()) {
  lines.push(`GONE     ${name}  in ${before} only`);
}
for (const name of is.filter((shot) => !was.includes(shot)).sort()) {
  lines.push(`NEW      ${name}  in ${after} only`);
}
for (const said of lines) {
  process.stdout.write(`${said}\n`);
}
const quiet = lines.filter((said) => said.startsWith("NOISE")).length;
process.stdout.write(
  `compare: ${same} screen(s) identical, ${quiet} within noise, ${lines.length - quiet} to look at, of ${partial ? is.length : new Set([...was, ...is]).size}.\n`,
);
