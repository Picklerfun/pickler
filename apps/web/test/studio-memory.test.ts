import assert from "node:assert/strict";
import { test } from "node:test";
import { createStudioMemory } from "../src/features/studio/routing/memory-store";

test("navigation keeps separate form drafts, while clean forms follow refreshed configuration", () => {
  const memory = createStudioMemory();
  memory.identify("owner");
  memory.form("a:brief:form", 1, { thesis: "saved" });
  memory.edit("a:brief:form", { thesis: "edited" });
  memory.form("a:sources:form", 1, ["BTC"]);
  assert.deepEqual(memory.form("a:brief:form", 1, { thesis: "saved" }), { thesis: "edited" });
  assert.deepEqual(memory.form("a:sources:form", 2, ["ETH"]), ["ETH"]);
  assert.deepEqual(memory.form("b:brief:form", 1, { thesis: "other agent" }), {
    thesis: "other agent",
  });
});
test("a version change retains dirty edits and blocks a stale save until explicit discard", () => {
  const memory = createStudioMemory();
  memory.form("a:brief:form", 1, "old");
  memory.edit("a:brief:form", "my edit");
  assert.equal(memory.form("a:brief:form", 2, "concurrent change"), "my edit");
  assert.equal(memory.stale("a:brief", 2), true);
  memory.discard("a:brief");
  assert.equal(memory.form("a:brief:form", 2, "concurrent change"), "concurrent change");
  assert.equal(memory.stale("a:brief", 2), false);
});
test("writes remain busy after navigation and committing one form does not discard others", () => {
  const memory = createStudioMemory();
  for (const scope of ["a:brief", "a:sources"]) {
    memory.form(`${scope}:form`, 1, "saved");
    memory.edit(`${scope}:form`, "edited");
  }
  memory.begin("a:brief");
  assert.equal(memory.busy("a:brief"), true);
  memory.committed("a:brief");
  memory.end("a:brief");
  assert.equal(memory.form("a:brief:form", 2, "edited"), "edited");
  assert.equal(memory.dirty(), true);
  assert.equal(memory.writing(), false);
});
test("owner changes clear private drafts and invalidate late responses", () => {
  const memory = createStudioMemory();
  memory.identify("owner-a");
  const generation = memory.generation();
  memory.form("a:brief:form", 1, "saved");
  memory.edit("a:brief:form", "private edit");
  memory.begin("a:brief");
  memory.identify("owner-b");
  assert.notEqual(memory.generation(), generation);
  assert.equal(memory.dirty(), false);
  assert.equal(memory.writing(), false);
  assert.equal(memory.form("a:brief:form", 1, "new owner"), "new owner");
  memory.identify(null);
  assert.equal(memory.dirty(), false);
});
test("discarding drafts does not reset the X paid-preview attempt", () => {
  const memory = createStudioMemory();
  memory.setOutcome("a:x-preview:handle:connection", true);
  memory.discardForms();
  assert.equal(memory.outcome("a:x-preview:handle:connection", false), true);
});

test("the initial owner assignment does not restart a fresh workspace bootstrap", () => {
  const memory = createStudioMemory();
  const initial = memory.generation();
  memory.identify("owner");
  assert.equal(memory.generation(), initial);
  memory.identify("owner");
  assert.equal(memory.generation(), initial);
  memory.identify(null);
  assert.notEqual(memory.generation(), initial);
});
