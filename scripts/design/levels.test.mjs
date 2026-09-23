// Every ink level against every ground it could sit on, read straight out of the token file.
//
// This is the check that would have caught both faint inks before either reached the spec. It needs
// no browser and no dev server, because it asks a question that has nothing to do with any page:
// given these levels and these grounds, is there a pair that cannot be read? contrast.mjs answers
// the harder question — which pairs a component actually puts on screen — and it is the one that
// found these. This one just makes the same mistake impossible to write down again.
//
// What it cannot know is which pairs are really used. It therefore judges all of them, which is
// stricter than the product needs and is the point: a level that cannot survive the darkest panel
// is a level with a footnote, and footnotes are what both of these defects were.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ratio } from "./lib/colour.mjs";

// The values live here and only here. colour.test.mjs proves the arithmetic against answers that are
// public knowledge; pinning token values there as well let a level drift out from under its own
// test the moment the token changed.

const CSS = readFileSync(
  fileURLToPath(new URL("../../packages/ui/src/styles.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, ""); // comments quote hex values; they are prose, not declarations

/** The custom properties declared in one surface's block. The light surface is selected by its
 *  data-surface rather than by `:root`, because an earlier `:root` block holds the radii and would
 *  otherwise match first and yield a block with no inks in it at all. */
function surface(selector) {
  const at = CSS.indexOf(selector);
  assert.notEqual(at, -1, `${selector} is not in styles.css — this check is looking at nothing`);
  const open = CSS.indexOf("{", at);
  const body = CSS.slice(open, CSS.indexOf("\n}", open));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

/** Follows var() chains, so a level that resolves to another level is judged as what it paints. */
function resolve(tokens, name, seen = new Set()) {
  const value = tokens[name];
  const chained = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  if (!chained) {
    return value;
  }
  assert.ok(!seen.has(name), `${name} resolves in a circle`);
  return resolve(tokens, chained[1], seen.add(name));
}

const rgb = (value) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  assert.ok(hex, `${value} is not a plain hex colour, so this check cannot judge it`);
  return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
};

const INKS = ["--pk-ink", "--pk-ink-soft", "--pk-ink-muted", "--pk-ink-faint"];
const GROUNDS = ["--pk-bg", "--pk-panel", "--pk-panel-2", "--pk-panel-3"];
const BODY = 4.5; // WCAG AA for body text. Every one of these levels is used as text.

/** The state pairs, discovered rather than listed: `--pk-state-<name>-bg` and its `-ink`. Finding
 *  them by shape means a pair added later is covered the day it is added, which is the only way a
 *  check like this stays true — a hand-written list is a list someone forgets to extend. */
function pairs(tokens, prefix) {
  const names = new Set();
  for (const key of Object.keys(tokens)) {
    const match = new RegExp(`^${prefix}(.+)-(?:bg|ink)$`).exec(key);
    if (match && tokens[`${prefix}${match[1]}-bg`] && tokens[`${prefix}${match[1]}-ink`]) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

for (const name of ["light", "dark"]) {
  test(`every ${name} ink is legible on every ${name} ground`, () => {
    const tokens = surface(`[data-surface="${name}"]`);
    const unreadable = [];
    for (const ink of INKS) {
      for (const ground of GROUNDS) {
        const measured = ratio(rgb(resolve(tokens, ink)), rgb(resolve(tokens, ground)));
        if (measured < BODY) {
          unreadable.push(
            `${ink} (${resolve(tokens, ink)}) on ${ground} (${resolve(tokens, ground)}) is ${measured.toFixed(2)}, needs ${BODY}`,
          );
        }
      }
    }
    assert.deepEqual(unreadable, []);
  });
}

// A state is a tinted ground with an ink chosen to be legible on it — that legibility is the whole
// contract, and it is the one thing a pair exists to guarantee. Unlike the ink ramp, each pair has
// exactly one ground: its own tint. Nothing else is asserted here, because nothing else is promised.
for (const name of ["light", "dark"]) {
  test(`every ${name} state ink is legible on its own tint`, () => {
    const tokens = surface(`[data-surface="${name}"]`);
    const found = pairs(tokens, "--pk-state-");
    assert.ok(
      found.length >= 6,
      `only ${found.length} state pairs found — the walk matched nothing`,
    );
    const unreadable = [];
    for (const state of found) {
      const ink = resolve(tokens, `--pk-state-${state}-ink`);
      const tint = resolve(tokens, `--pk-state-${state}-bg`);
      const measured = ratio(rgb(ink), rgb(tint));
      if (measured < BODY) {
        unreadable.push(
          `${state}: ink ${ink} on tint ${tint} is ${measured.toFixed(2)}, needs ${BODY}`,
        );
      }
    }
    assert.deepEqual(unreadable, []);
  });
}

test("the ink levels stay distinct rather than collapsing silently", () => {
  // A level that resolves to another is a deliberate collapse and says so in the token file. Two
  // levels that merely land on near-identical literals are the failure this catches: they read as
  // two levels in the spec and paint as one on screen.
  const tooClose = [];
  for (const name of ["light", "dark"]) {
    const tokens = surface(`[data-surface="${name}"]`);
    for (let i = 0; i < INKS.length - 1; i += 1) {
      const [a, b] = [resolve(tokens, INKS[i]), resolve(tokens, INKS[i + 1])];
      if (a === b) {
        continue; // an explicit fallback, not an accident
      }
      const apart = rgb(a)
        .slice(0, 3)
        .reduce((total, channel, c) => total + Math.abs(channel - rgb(b)[c]), 0);
      if (apart < 20) {
        tooClose.push(`${name}: ${INKS[i]} ${a} and ${INKS[i + 1]} ${b} differ by ${apart}/765`);
      }
    }
  }
  assert.deepEqual(tooClose, []);
});
