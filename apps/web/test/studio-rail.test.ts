import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTIONS } from "../src/features/studio/sections/keys";
import { PANELS, RAIL, isPanel, isSoon } from "../src/features/studio/sections/rail";

/* One list feeds the shell's rail, the home's Menu and the empty home's rail. These pin the list
   against the section keys, so a key added to one and not the other fails here. */

const items = RAIL.flatMap((group) => group.items);

test("the rail lists every section key once, in the order the keys are declared", () => {
  assert.deepEqual(
    items.map((item) => item.key),
    [...SECTIONS],
  );
});

test("the rail's groups are the four the shell draws, in order", () => {
  assert.deepEqual(
    RAIL.map((group) => group.title),
    ["RUN", "BUILD", "GROW", "PUBLIC"],
  );
});

test("the sections with no screen yet are the five marked soon", () => {
  assert.deepEqual(
    SECTIONS.filter((key) => isSoon(key)),
    ["sources", "identity", "profile", "audience", "token"],
  );
});

test("every soon section has a panel to draw, so none opens on nothing", () => {
  assert.deepEqual(
    SECTIONS.filter((key) => isSoon(key) && !isPanel(key)),
    [],
  );
});

test("the board draws the panel without being soon: the pages it links to exist", () => {
  assert.equal(isPanel("board"), true);
  assert.equal(isSoon("board"), false);
});

test("a section with a screen of its own draws no panel", () => {
  assert.deepEqual(
    SECTIONS.filter((key) => !isPanel(key)),
    ["overview", "context", "picks", "activity", "brief", "skills", "limits"],
  );
});

test("no panel is left without words", () => {
  const silent = Object.entries(PANELS).filter(
    ([, copy]) => !copy.title || !copy.tag || !copy.body,
  );

  assert.deepEqual(silent, []);
});
