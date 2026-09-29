import assert from "node:assert/strict";
import { test } from "node:test";
import { studioLanding } from "../src/features/studio/lib/landing";
import { menuAccess, NEEDS_AGENT, VIEW_ONLY } from "../src/features/studio/home/access";
import { stageFromSearch } from "../src/features/studio/home/stage";

/* What `/studio` shows: the home, a section, the empty home, or nothing yet while agents are read. */

test("with an agent, the home or the section asked for, read or not", () => {
  assert.equal(studioLanding(true, [{ id: "a" }], "home"), "home");
  assert.equal(studioLanding(false, [{ id: "a" }], "home"), "home");
  assert.equal(studioLanding(true, [{ id: "a" }], "limits"), "section");
});

test("no agents, once read, is the empty home rather than a redirect", () => {
  assert.equal(studioLanding(true, [], "home"), "empty");
});

test("?section= with no agents is the empty home too", () => {
  for (const section of ["overview", "limits", "context", "profile", "board"]) {
    assert.equal(studioLanding(true, [], section), "empty");
  }
});

test("no agents before the read is still loading, not an empty studio", () => {
  assert.equal(studioLanding(false, [], "home"), "loading");
  assert.equal(studioLanding(false, [], "limits"), "loading");
});

test("?stage=empty stages the empty home outside production only", () => {
  assert.equal(stageFromSearch("development", "empty"), "empty");
  assert.equal(stageFromSearch("production", "empty"), undefined);
});

/* The Menu's decision, which the empty home's own button reads too. */

const open = { hasAgent: true, canManage: true, researchLock: "", fundLock: "", draftLock: "" };

test("no agents disables every section with the canvas's hint, and creating stays open", () => {
  const access = menuAccess({ ...open, hasAgent: false });

  assert.equal(access.sections, false);
  assert.equal(access.sectionNote, NEEDS_AGENT);
  assert.equal(NEEDS_AGENT, "After you create your agent");
  assert.equal(access.create, true);
  assert.equal(access.createNote, "");
});

test("an agent opens every section", () => {
  const access = menuAccess(open);

  assert.equal(access.sections, true);
  assert.equal(access.sectionNote, "");
});

test("research locked for someone who can manage gives the research reason, not view-only", () => {
  const researchLock = "Research is not enabled on this workspace yet. An operator switches it on.";

  const access = menuAccess({ ...open, hasAgent: false, researchLock });

  assert.equal(access.create, false);
  assert.equal(access.createNote, researchLock);
});

test("research off wins over view-only: the API's canManage is false for an owner waiting on research", () => {
  const access = menuAccess({
    ...open,
    canManage: false,
    researchLock: "locked",
    fundLock: "fund",
  });

  assert.equal(access.create, false);
  assert.equal(access.createNote, "locked");
});

test("someone who cannot manage an enabled workspace is told they only view it", () => {
  const access = menuAccess({ ...open, canManage: false, fundLock: "fund" });

  assert.equal(access.create, false);
  assert.equal(access.createNote, VIEW_ONLY);
});

test("the unfunded-agent lock comes after research access", () => {
  assert.equal(
    menuAccess({ ...open, fundLock: "Fund Halftime first." }).createNote,
    "Fund Halftime first.",
  );
  assert.equal(
    menuAccess({ ...open, researchLock: "locked", fundLock: "fund" }).createNote,
    "locked",
  );
});

test("the draft limit is the last reason: research, view-only and funding come first", () => {
  const draftLock = "At most 3 drafts at a time.";

  assert.equal(menuAccess({ ...open, draftLock }).create, false);
  assert.equal(menuAccess({ ...open, draftLock }).createNote, draftLock);
  assert.equal(menuAccess({ ...open, fundLock: "fund", draftLock }).createNote, "fund");
  assert.equal(menuAccess({ ...open, canManage: false, draftLock }).createNote, VIEW_ONLY);
  assert.equal(menuAccess({ ...open, researchLock: "locked", draftLock }).createNote, "locked");
});

test("?stage= stages the brief's run states and the draft home, outside production only", () => {
  for (const stage of ["brief-running", "brief-done", "brief-stale", "draft"]) {
    assert.equal(stageFromSearch("development", stage), stage);
    assert.equal(stageFromSearch("production", stage), undefined);
  }
  assert.equal(stageFromSearch("development", "brief-nope"), undefined);
});

test("each staged brief draws the state it is named for", async () => {
  const { briefFixture } = await import("../src/features/studio/brief/fixture");
  const { fingerprint, runState, isTerminal } = await import("../src/features/studio/brief/model");
  const stateOf = (stage: "brief-running" | "brief-done" | "brief-stale") => {
    const staged = briefFixture(stage);
    const run = staged.paper.view!.run!;
    return runState(
      { started: true, terminal: isTerminal(run.status), ranFor: staged.paper.ranFor },
      fingerprint(staged.form),
    );
  };
  assert.equal(stateOf("brief-running"), "LIVE");
  assert.equal(stateOf("brief-done"), "DONE");
  assert.equal(stateOf("brief-stale"), "STALE");
});
