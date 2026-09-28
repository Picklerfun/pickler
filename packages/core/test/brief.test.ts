import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBrief } from "../src/features/research/brief.js";

test("skills are appended as numbered rules, and the edge stays first", () => {
  const brief = composeBrief("It reads injury reports before the books move.", [
    { name: "Injury double-check", prompt: "Only count an injury if two sources confirm it." },
    {
      name: "Late line moves",
      prompt: "If the line moved more than 2 points in 24 hours, find out why.",
    },
  ]);
  assert.equal(
    brief,
    [
      "It reads injury reports before the books move.",
      "",
      "Rules it follows:",
      "1. Injury double-check — Only count an injury if two sources confirm it.",
      "2. Late line moves — If the line moved more than 2 points in 24 hours, find out why.",
    ].join("\n"),
  );
});

test("no skills means the edge alone, byte for byte", () => {
  assert.equal(composeBrief("Edge.", []), "Edge.");
});
