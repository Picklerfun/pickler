// The static half of the design checks: what the source says, before anything is rendered.
//
// The rendered checks catch a colour that reaches the screen from anywhere. They cannot catch one
// that no measured route paints, or a second naming layer that happens to resolve to the right
// value today. This reads the source instead: packages/ui/src/styles.css is the only place a
// colour or a --pk-* token may be written, and everything else reads it by name.
//
//   node scripts/design/source.mjs            report every violation, exit 0
//   node scripts/design/source.mjs --strict   the same report, exit 1 when there is any
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkCss,
  checkTs,
  definedTokens,
  readClasses,
  unusedClasses,
} from "./lib/source-rules.mjs";

const ROOT = process.env.DESIGN_SOURCE_ROOT ?? fileURLToPath(new URL("../..", import.meta.url));
const SCOPE = ["apps/web/src", "packages/ui/src"];
export const TOKEN_FILE = "packages/ui/src/styles.css";
export const MIRROR = "packages/ui/src/tokens.ts";
export const MARKS = ["packages/ui/src/brand.tsx"];
export const CHANNEL = "apps/web/src/lib/accent.ts";

/* Classes reached only through a computed `styles[...]`, with the place that computes them. */
export const KEEP = {
  "apps/web/src/features/agents/agents.module.css": [
    // styles[outcomeClass[...]] in token-page.tsx and pick-detail.tsx; the map is lib/format.ts.
    "resultWon",
    "resultLost",
    "resultOpen",
    // styles[`kind${kindLabel[event.kind]}`] in activity-row.tsx.
    "kindCALL",
    "kindPOSITION",
    "kindPASS",
    "kindANSWER",
    "kindPERP",
  ],
  "apps/web/src/features/markets/markets.module.css": [
    // styles[quote.side] in trade-ticket.tsx.
    "long",
    "short",
  ],
};

const strict = process.argv.includes("--strict");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
// Tracked files and new ones alike: a file somebody has just written is checked before it is added.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", ...SCOPE],
  { cwd: ROOT, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file, at, all) => file && all.indexOf(file) === at && existsSync(path.join(ROOT, file)));

const tokens = definedTokens(read(TOKEN_FILE));
const code = files.filter((file) => /\.tsx?$/.test(file));
const problems = [];

for (const file of files.filter((name) => name.endsWith(".css"))) {
  problems.push(...checkCss(file, read(file), { tokens, isTokenFile: file === TOKEN_FILE }));
}
for (const file of code) {
  problems.push(
    ...checkTs(file, read(file), { tokens, mirror: MIRROR, marks: MARKS, channel: CHANNEL }),
  );
}
for (const file of files.filter((name) => name.endsWith(".module.css"))) {
  const used = new Set();
  for (const reader of code) {
    const source = read(reader);
    for (const match of source.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+\.module\.css)["']/g)) {
      const target = match[2].startsWith("@/")
        ? path.posix.join("apps/web/src", match[2].slice(2))
        : path.posix.join(path.posix.dirname(reader), match[2]);
      if (path.posix.normalize(target) === file) {
        for (const name of readClasses(source, match[1])) {
          used.add(name);
        }
      }
    }
  }
  problems.push(...unusedClasses(file, read(file), used, KEEP[file] ?? []));
}

problems.sort(
  (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line,
);
const counts = {};
for (const problem of problems) {
  counts[problem.rule] = (counts[problem.rule] ?? 0) + 1;
  process.stdout.write(
    `${strict ? "FAIL" : "note"}  ${problem.rule}  ${problem.file}:${problem.line}  ${problem.text}\n`,
  );
}
const summary = Object.entries(counts)
  .map(([rule, count]) => `${rule} ${count}`)
  .join(", ");
if (!problems.length) {
  process.stdout.write(`source: clean over ${files.length} file(s).\n`);
} else if (strict) {
  process.stdout.write(`\nsource: ${problems.length} violation(s) — ${summary}.\n`);
  process.exit(1);
} else {
  process.stdout.write(
    `\nsource: ${problems.length} violation(s) — ${summary}. Report only; --strict fails on them.\n`,
  );
}
