import { test } from "node:test";
import assert from "node:assert/strict";
import { briefDecisionSystemPrompt } from "../src/prompts/brief-decision-system.js";
import { createModel } from "../src/composition/model.js";
import type { Environment } from "../src/environment.js";

test("the brief decision prompt is versioned, hashed and asks for every field", () => {
  assert.equal(briefDecisionSystemPrompt.id, "brief-decision-system");
  assert.equal(briefDecisionSystemPrompt.version, "1.0.0");
  assert.match(briefDecisionSystemPrompt.sha256, /^[0-9a-f]{64}$/);
  for (const word of [
    "entries",
    "exitArmed",
    "neverChecked",
    "untrusted",
    "same order",
    "one key allowed",
  ]) {
    assert.ok(briefDecisionSystemPrompt.instructions.includes(word), word);
  }
});

test("the model's metadata records the brief prompt", () => {
  const model = createModel({
    MODEL_BASE_URL: "https://model.example/v1",
    MODEL_ID: "fixture",
    MODEL_API_KEY: "test-only",
  } as Environment);
  assert.equal(model.metadata().prompts.briefDecision, briefDecisionSystemPrompt);
});
