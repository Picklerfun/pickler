// A one-off rewrite of custom-property reads in one CSS file.
//
//   node retoken.mjs <file.css> <map.json> [--drop-definitions]
//
// map.json is { "--from": "--to", … }. Every `var(--from)` becomes `var(--to)`; a read with a
// fallback, `var(--from, …)`, is refused rather than guessed at. With --drop-definitions, each
// `--from: …;` line is deleted, together with the comments between the first and the last of them
// in a block and the blank line that followed.
import { readFileSync, writeFileSync } from "node:fs";

const [file, mapFile, ...flags] = process.argv.slice(2);
const map = JSON.parse(readFileSync(mapFile, "utf8"));
const drop = flags.includes("--drop-definitions");
let css = readFileSync(file, "utf8");
const counts = {};

for (const from of Object.keys(map)) {
  const fallback = new RegExp(`var\\(\\s*${from}\\s*,`);
  if (fallback.test(css)) {
    process.stderr.write(`${file}: var(${from}, …) has a fallback; rewrite it by hand first\n`);
    process.exit(1);
  }
}

if (drop) {
  const lines = css.split("\n");
  const isDefinition = (line) => {
    const match = /^\s*(--[\w-]+)\s*:/.exec(line);
    return Boolean(match && Object.hasOwn(map, match[1]));
  };
  const kept = [];
  for (let at = 0; at < lines.length; at += 1) {
    if (!isDefinition(lines[at])) {
      kept.push(lines[at]);
      continue;
    }
    // The run of definitions, and whatever comments sit between them.
    let end = at;
    for (let next = at + 1; next < lines.length; next += 1) {
      const text = lines[next].trim();
      if (isDefinition(lines[next])) {
        end = next;
      } else if (!(
        text.startsWith("/*") ||
        text.startsWith("*") ||
        text.endsWith("*/") ||
        inComment(lines, at, next)
      )) {
        break;
      }
    }
    for (let gone = at; gone <= end; gone += 1) {
      const name = /^\s*(--[\w-]+)\s*:/.exec(lines[gone])?.[1];
      if (name && Object.hasOwn(map, name)) {
        counts[`dropped ${name}`] = (counts[`dropped ${name}`] ?? 0) + 1;
      }
    }
    at = end;
    if (lines[at + 1]?.trim() === "") {
      at += 1;
    }
  }
  css = kept.join("\n");
}

function inComment(lines, from, at) {
  const text = lines.slice(from, at + 1).join("\n");
  return text.lastIndexOf("/*") > text.lastIndexOf("*/");
}

for (const [from, to] of Object.entries(map)) {
  const read = new RegExp(`var\\(\\s*${from}\\s*\\)`, "g");
  css = css.replace(read, () => {
    counts[from] = (counts[from] ?? 0) + 1;
    return `var(${to})`;
  });
}

writeFileSync(file, css);
for (const [name, count] of Object.entries(counts)) {
  process.stdout.write(`${name}\t${count}\n`);
}
