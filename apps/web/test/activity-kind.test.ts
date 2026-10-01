import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { kindClass, kindLabel } from "../src/features/agents/lib/format";

/* An activity row styles its kind chip with styles[kindClass[kind]]. A class the sheet does not
   define is undefined there, and the chip silently loses its tint, as SETTLED once did. */

const sheet = readFileSync(
  new URL("../src/features/agents/agents.module.css", import.meta.url),
  "utf8",
);

test("every activity kind has a chip class the agents stylesheet defines", () => {
  const missing = Object.values(kindClass).filter(
    (name) => !new RegExp(`\\.${name}\\s*\\{`).test(sheet),
  );

  assert.deepEqual(missing, []);
});

test("a settlement reads SETTLED and takes its own class", () => {
  assert.equal(kindLabel.settlement, "SETTLED");
  assert.equal(kindClass.settlement, "kindSETTLED");
});

test("the label and the class maps cover the same kinds", () => {
  assert.deepEqual(Object.keys(kindClass).sort(), Object.keys(kindLabel).sort());
});
