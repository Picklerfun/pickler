// A one-off removal of CSS rules by class name.
//
//   node derule.mjs <file.css> --classes a,b,c [--keyframes x,y]
//
// A rule goes when every selector in its list names one of the classes. A list that mixes a
// listed class with others loses only the selectors that name one. A comment that sits directly
// on top of a removed rule, with no blank line between them, goes with it. An @media block left
// with nothing in it goes too.
import { readFileSync, writeFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
const option = (name) => {
  const at = rest.indexOf(name);
  return at === -1 ? [] : rest[at + 1].split(",").filter(Boolean);
};
const classes = new Set(option("--classes"));
const keyframes = new Set(option("--keyframes"));
const source = readFileSync(file, "utf8");

const names = (selector) =>
  [...selector.replace(/:global\([^)]*\)/g, " ").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(
    (match) => match[1],
  );
const dead = (selector) => names(selector).some((name) => classes.has(name));

/** Splits a block's text into its top-level items: comments, rules, at-rules, blank runs. */
function items(text) {
  const found = [];
  let at = 0;
  while (at < text.length) {
    if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at) + 2;
      found.push({ kind: "comment", text: text.slice(at, end) });
      at = end;
    } else if (/\s/.test(text[at])) {
      let end = at;
      while (end < text.length && /\s/.test(text[end])) {
        end += 1;
      }
      found.push({ kind: "space", text: text.slice(at, end) });
      at = end;
    } else {
      const open = text.indexOf("{", at);
      const semicolon = text.indexOf(";", at);
      if (open === -1 || (semicolon !== -1 && semicolon < open)) {
        const end = semicolon === -1 ? text.length : semicolon + 1;
        found.push({ kind: "declaration", text: text.slice(at, end) });
        at = end;
        continue;
      }
      let depth = 0;
      let end = open;
      for (; end < text.length; end += 1) {
        if (text.startsWith("/*", end)) {
          end = text.indexOf("*/", end) + 1;
        } else if (text[end] === "{") {
          depth += 1;
        } else if (text[end] === "}") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
      }
      found.push({
        kind: "rule",
        head: text.slice(at, open),
        body: text.slice(open + 1, end),
        text: text.slice(at, end + 1),
      });
      at = end + 1;
    }
  }
  return found;
}

const removed = [];
function clean(text, indent) {
  const list = items(text);
  const out = [];
  const drop = () => {
    // The comment sitting directly on the rule, and the whitespace before it.
    const space = out.at(-1);
    const comment = out.at(-2);
    if (space?.kind === "space" && !space.text.includes("\n\n") && comment?.kind === "comment") {
      out.splice(-2, 2);
    }
  };
  for (const item of list) {
    if (item.kind !== "rule") {
      out.push(item);
      continue;
    }
    const head = item.head.trim();
    if (head.startsWith("@keyframes")) {
      const name = head.split(/\s+/)[1];
      if (keyframes.has(name)) {
        removed.push(head);
        drop();
        continue;
      }
      out.push(item);
      continue;
    }
    if (head.startsWith("@")) {
      const inner = clean(item.body, `${indent}  `);
      if (!inner.trim()) {
        removed.push(`${head} (left empty)`);
        drop();
        continue;
      }
      out.push({ kind: "rule", text: `${item.head}{${inner}}` });
      continue;
    }
    const selectors = head.split(",").map((selector) => selector.trim());
    const alive = selectors.filter((selector) => !dead(selector));
    if (alive.length === selectors.length) {
      out.push(item);
      continue;
    }
    removed.push(selectors.filter(dead).join(", ").replace(/\s+/g, " "));
    if (!alive.length) {
      drop();
      continue;
    }
    out.push({ kind: "rule", text: `${alive.join(`,\n${indent}`)} {${item.body}}` });
  }
  return out.map((item) => item.text).join("");
}

const cleaned = clean(source, "")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/\s+$/, "\n");
writeFileSync(file, cleaned);
for (const line of removed) {
  process.stdout.write(`removed  ${line}\n`);
}
process.stdout.write(`${file}: ${removed.length} rule(s) or selector(s) removed\n`);
