import assert from "node:assert/strict";
import { test } from "node:test";
import { studioLanding } from "../src/features/studio/lib/landing";
import { menuAccess, NEEDS_AGENT, VIEW_ONLY } from "../src/features/studio/home/access";
import { CREATE_STAGES, isCreateStage, stageFromSearch } from "../src/features/studio/home/stage";
import { newAgentFixture } from "../src/features/studio/new-agent/fixture";
import { emptyForm, funded } from "../src/features/studio/new-agent/model";

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

test("?stage= stages each moment of the create screen and the draft home, outside production only", () => {
  for (const stage of [...CREATE_STAGES, "draft"]) {
    assert.equal(stageFromSearch("development", stage), stage);
    assert.equal(stageFromSearch("production", stage), undefined);
  }
  assert.equal(stageFromSearch("development", "create-nope"), undefined);
});

test("the old brief stages are gone", () => {
  for (const stage of ["brief-running", "brief-done", "brief-stale"]) {
    assert.equal(stageFromSearch("development", stage), undefined);
  }
});

test("every create stage is a create stage, and the other stages are not", () => {
  for (const stage of CREATE_STAGES) {
    assert.equal(isCreateStage(stage), true);
  }
  for (const stage of ["empty", "draft", "live", undefined] as const) {
    assert.equal(isCreateStage(stage), false);
  }
});

/* Each staged create screen draws the moment it is named for (studio-create-simplified-v1 §7). */

test("no wallet: a blank form, no wallet, and a first visit", () => {
  const staged = newAgentFixture("create-empty");

  assert.deepEqual(staged.form, emptyForm());
  assert.equal(staged.wallet, null);
  assert.equal(staged.firstTime, true);
  assert.deepEqual(staged.wallets.agents, []);
});

test("wallet, not funded: a named form and an empty wallet", () => {
  const staged = newAgentFixture("create-wallet");

  assert.equal(staged.form.name, "Halftime");
  assert.notEqual(staged.wallet, null);
  assert.equal(funded(staged.wallet), false);
  assert.equal(staged.firstTime, false);
});

test("every later stage has a funded wallet, listed among the agent wallets", () => {
  for (const stage of CREATE_STAGES.filter((s) => s !== "create-empty" && s !== "create-wallet")) {
    const staged = newAgentFixture(stage);

    assert.equal(funded(staged.wallet), true, stage);
    assert.equal(staged.wallets.agents[0]?.walletId, staged.wallet?.walletId, stage);
  }
});

test("advanced open, web with sites, and each modal open only on its own stage", () => {
  assert.equal(newAgentFixture("create-advanced").advancedOpen, true);
  assert.equal(newAgentFixture("create-funded").advancedOpen, false);

  const web = newAgentFixture("create-web").form;
  assert.equal(web.webOn, true);
  assert.ok(web.sites.length > 0);
  assert.equal(newAgentFixture("create-funded").form.webOn, false);

  assert.equal(newAgentFixture("create-wallets").modal, "wallets");
  assert.equal(newAgentFixture("create-credits").modal, "credits");
  assert.equal(newAgentFixture("create-avatar").modal, "avatar");
  assert.equal(newAgentFixture("create-funded").modal, null);
});

test("the Wallets stage opens with a transfer to the agent's wallet showing", () => {
  const staged = newAgentFixture("create-wallets");

  assert.equal(staged.fundOn, staged.wallet?.walletId);
  assert.equal(newAgentFixture("create-credits").fundOn, null);
});

test("each sheet stage opens the create sheet in its phase", () => {
  const phases = {
    "create-sheet": "idle",
    "create-sheet-busy": "busy",
    "create-sheet-ok": "ok",
    "create-sheet-cancelled": "err",
  } as const;
  for (const [stage, phase] of Object.entries(phases)) {
    const staged = newAgentFixture(stage as keyof typeof phases);

    assert.deepEqual(staged.sheet, { kind: "create", phase }, stage);
  }
  assert.equal(newAgentFixture("create-funded").sheet, null);
});
