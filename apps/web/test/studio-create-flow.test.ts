import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDraft, type Draft } from "../src/features/studio/create/draft";
import {
  flowReducer,
  initialFlow,
  openingFlow,
  paramFromStep,
  sampleDraft,
  stepFromParam,
  type FlowState,
} from "../src/features/studio/create/flow";
import { shortAddress, traceLines } from "../src/features/studio/create/trace";

/* The creation screen's transitions and its trace wording, one behaviour per test. */

const ready: Draft = { ...sampleDraft(), handleAvailable: true };

const at = (patch: Partial<FlowState>): FlowState => ({ ...initialFlow("start", ready), ...patch });

test("?step=describe is the first screen, and so is anything unknown", () => {
  assert.equal(stepFromParam("describe"), "start");
  assert.equal(stepFromParam("nonsense"), "start");
  assert.equal(stepFromParam(undefined), "start");
});

test("every other step round-trips through its URL name", () => {
  assert.equal(stepFromParam(paramFromStep("decides")), "decides");
  assert.equal(paramFromStep("start"), "describe");
});

test("step by step starts at the name, in manual mode", () => {
  const next = flowReducer(at({}), { type: "manual" });

  assert.equal(next.step, "name");
  assert.equal(next.mode, "manual");
});

test("a draft from the line goes to the reading screen and keeps the line", () => {
  const state = at({ draft: { ...emptyDraft(), prompt: "Calls NFL games" } });

  const next = flowReducer(state, { type: "drafted", draft: ready });

  assert.equal(next.step, "reading");
  assert.equal(next.draft.prompt, "Calls NFL games");
});

test("Next does nothing while the step is not ready", () => {
  const state = at({ step: "name", draft: { ...ready, handleAvailable: null } });

  assert.equal(flowReducer(state, { type: "next" }).step, "name");
});

test("Next moves to the following step when ready", () => {
  assert.equal(flowReducer(at({ step: "name" }), { type: "next" }).step, "trades");
});

test("Back from the first manual step returns to Describe", () => {
  assert.equal(flowReducer(at({ step: "name", mode: "manual" }), { type: "back" }).step, "start");
});

test("Back from an auto review returns to Describe, a manual one to Decides", () => {
  assert.equal(flowReducer(at({ step: "review", mode: "auto" }), { type: "back" }).step, "start");
  assert.equal(
    flowReducer(at({ step: "review", mode: "manual" }), { type: "back" }).step,
    "decides",
  );
});

test("Cancel on an edit restores the draft as it was and returns to review", () => {
  const editing = flowReducer(at({ step: "review" }), { type: "edit", step: "name" });
  const changed = flowReducer(editing, { type: "patch", patch: { name: "Other" } });

  const cancelled = flowReducer(changed, { type: "back" });

  assert.equal(cancelled.step, "review");
  assert.equal(cancelled.draft.name, "Halftime");
  assert.equal(cancelled.editing, false);
});

test("Done on an edit keeps the change and returns to review", () => {
  const editing = flowReducer(at({ step: "review" }), { type: "edit", step: "name" });
  const changed = flowReducer(editing, { type: "patch", patch: { name: "Other" } });

  const done = flowReducer(changed, { type: "next" });

  assert.equal(done.step, "review");
  assert.equal(done.draft.name, "Other");
});

test("a trace leaves out token counts and names a search by its query", () => {
  const lines = traceLines(
    [
      { id: 1, type: "model_step_usage", data: {}, createdAt: 1000 },
      { id: 2, type: "search_query", data: { query: "chiefs injury report" }, createdAt: 3100 },
    ],
    1000,
  );

  assert.deepEqual(lines, [
    { id: 2, text: "Searched “chiefs injury report”", meta: "2.1s", tint: "amber" },
  ]);
});

test("an address is shortened to its ends", () => {
  assert.equal(shortAddress("0x7a3f00000000000000000000000000000091c2"), "0x7a3f…91c2");
});

test("in production a link past Describe opens on Describe, with nothing to show there yet", () => {
  const opened = openingFlow("review", false);

  assert.equal(opened.step, "start");
  assert.equal(opened.draft.name, "");
});

test("outside production the same link opens on the canvas's example draft", () => {
  const opened = openingFlow("review", true);

  assert.equal(opened.step, "review");
  assert.equal(opened.draft.name, "Halftime");
});

test("Describe opens empty either way", () => {
  assert.equal(openingFlow("start", true).draft.prompt, "");
});
