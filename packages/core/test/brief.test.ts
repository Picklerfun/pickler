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

const written = {
  thesis: "Injury news moves the books before this market.",
  reads: ["espn.com", "@AdamSchefter"],
  entersWhen: ["A starter is ruled out", "The market has not moved 3 points"],
  exitsWhen: ["The line moves back"],
  never: ["Trade within an hour of kickoff"],
};

test("a brief comes after the edge and before the rules, one numbered line per rule", () => {
  const text = composeBrief(
    "Research carefully.",
    [{ name: "Two sources rule", prompt: "Never call on a single source." }],
    written,
  );
  assert.equal(
    text,
    [
      "Research carefully.",
      "",
      "Thesis: Injury news moves the books before this market.",
      "It reads:",
      "1. espn.com",
      "2. @AdamSchefter",
      "It enters only when every one of these is true:",
      "1. A starter is ruled out",
      "2. The market has not moved 3 points",
      "It exits at the first of these that turns true:",
      "1. The line moves back",
      "It never:",
      "1. Trade within an hour of kickoff",
      "",
      "Rules it follows:",
      "1. Two sources rule — Never call on a single source.",
    ].join("\n"),
  );
});

test("empty sections are left out, but the entry rules always show", () => {
  const text = composeBrief("Edge.", [], {
    thesis: "",
    reads: [],
    entersWhen: ["Only this"],
    exitsWhen: [],
    never: [],
  });
  assert.equal(
    text,
    ["Edge.", "", "It enters only when every one of these is true:", "1. Only this"].join("\n"),
  );
});

test("no brief is today's text, with or without skills", () => {
  const skills = [{ name: "A", prompt: "B" }];
  assert.equal(composeBrief("Edge.", skills, undefined), composeBrief("Edge.", skills));
  assert.equal(composeBrief("Edge.", [], undefined), "Edge.");
});
