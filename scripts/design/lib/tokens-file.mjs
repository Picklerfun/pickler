/* The token file as data. Shared by levels.test.mjs, which judges the values, and by render.mjs,
 * which uses them to tell whether the server it is measuring is serving this tree at all. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const STYLES = new URL("../../../packages/ui/src/styles.css", import.meta.url);

// Comments quote hex values; they are prose, not declarations, and a bare `--pk-` in one of them
// once reported as an undefined read. Stripping them narrows the input rather than the findings.
const CSS = readFileSync(fileURLToPath(STYLES), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The custom properties declared in one surface's block. The light surface is selected by its
 *  data-surface rather than by `:root`, because an earlier `:root` block holds the radii and would
 *  otherwise match first and yield a block with no inks in it at all. */
export function surface(name) {
  const selector = `[data-surface="${name}"]`;
  const at = CSS.indexOf(selector);
  if (at === -1) {
    throw new Error(`${selector} is not in styles.css — this check is looking at nothing`);
  }
  const open = CSS.indexOf("{", at);
  const body = CSS.slice(open, CSS.indexOf("\n}", open));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

/** Follows var() chains, so a level that resolves to another level is judged as what it paints. */
export function resolve(tokens, name, seen = new Set()) {
  const value = tokens[name];
  const chained = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  if (!chained) {
    return value;
  }
  if (seen.has(name)) {
    throw new Error(`${name} resolves in a circle`);
  }
  return resolve(tokens, chained[1], seen.add(name));
}

/* Enough of the palette to identify the tree, and no more. These three levels changed in this
 * change — ink-faint twice in one evening — so a server built from another branch will disagree on
 * at least one of them, while a rebuild of this tree agrees on all three. */
export const SIGNATURE = ["--pk-bg", "--pk-ink", "--pk-ink-faint"];
