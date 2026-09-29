import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BRIEF_LIMITS,
  LEVERAGE_BOUNDS,
  PAPER_BUDGET_AUSD,
  STARTER,
  STEPPERS,
  briefProblemText,
  canCreate,
  canRun,
  capsProblem,
  createLabel,
  deriveHandle,
  emptyForm,
  fingerprint,
  footNote,
  handleState,
  handleTone,
  idleNote,
  lines,
  readKind,
  riskTag,
  runLabel,
  runState,
  sectionForField,
  sectionTag,
  step,
  toRequest,
  type BriefForm,
} from "../src/features/studio/brief/model";

/* One behaviour per test, like the creation draft's tests: these are the rules the screen is. */

const filled = (patch: Partial<BriefForm> = {}): BriefForm => ({
  ...emptyForm(),
  name: "Halftime",
  enters: "A starter is ruled out",
  ...patch,
});

test("the handle is the name lower-cased, [a-z0-9_] only, at most 15", () => {
  assert.equal(deriveHandle("Half Time!"), "halftime");
  assert.equal(deriveHandle("A_Very-Long Name 2026"), "a_verylongname2");
  assert.equal(deriveHandle("  "), "");
});

test("the handle's state: empty, invalid, checking, free, taken", () => {
  assert.equal(handleState("", null), "empty");
  assert.equal(handleState("Al", null), "invalid");
  assert.equal(handleState("Halftime", null), "checking");
  assert.equal(handleState("Halftime", true), "free");
  assert.equal(handleState("Halftime", false), "taken");
});

test("its line is faint while empty or checking, lime when free, pink otherwise", () => {
  assert.equal(handleTone("empty"), "faint");
  assert.equal(handleTone("checking"), "faint");
  assert.equal(handleTone("free"), "lime");
  assert.equal(handleTone("taken"), "pink");
  assert.equal(handleTone("invalid"), "pink");
});

test("lines are trimmed and blank ones dropped", () => {
  assert.deepEqual(lines(" a \n\n b \n "), ["a", "b"]);
});

test("section tags: EMPTY, YOURS for the thesis, the line count otherwise", () => {
  assert.equal(sectionTag("thesis", "  "), "EMPTY");
  assert.equal(sectionTag("thesis", "An edge"), "YOURS");
  assert.equal(sectionTag("enters", "one"), "1 LINE · YOURS");
  assert.equal(sectionTag("never", "one\n\ntwo\nthree"), "3 LINES · YOURS");
});

test("the steppers start at the canvas's caps and keep their min, step and max", () => {
  assert.deepEqual(STARTER, { perTrade: 5, perDay: 20, leverage: 2 });
  const form = emptyForm();
  assert.equal(step(form, "perTrade", -1).perTrade, 5);
  assert.equal(step(form, "perTrade", 1).perTrade, 10);
  assert.equal(step(form, "perDay", -1).perDay, 10);
  assert.equal(step(step(form, "perDay", -1), "perDay", -1).perDay, 10);
  assert.equal(step({ ...form, perTrade: 1_000 }, "perTrade", 1).perTrade, 1_000);
});

test("leverage is Soon: its stepper does not move", () => {
  const leverage = STEPPERS.find((stepper) => stepper.key === "leverage");
  assert.equal(leverage?.soon, true);
  assert.equal(step(emptyForm(), "leverage", 1).leverage, 2);
});

test("RISK says STARTER CAPS until a cap changes, then EDITED", () => {
  assert.equal(riskTag(emptyForm()), "STARTER CAPS");
  assert.equal(riskTag(step(emptyForm(), "perDay", 1)), "EDITED");
});

test("a day's cap below one trade's is named", () => {
  assert.equal(capsProblem(emptyForm()), "");
  assert.equal(
    capsProblem({ ...emptyForm(), perTrade: 25, perDay: 20 }),
    "A day's cap can't be below one trade's.",
  );
});

test("the request trims and splits every section", () => {
  assert.deepEqual(
    toRequest(filled({ thesis: " Edge ", reads: "espn.com\n\n@x", exits: "", never: " a " })),
    {
      brief: {
        thesis: "Edge",
        reads: ["espn.com", "@x"],
        entersWhen: ["A starter is ruled out"],
        exitsWhen: [],
        never: ["a"],
      },
      spend: { perCallAusd: 5, perDayAusd: 20 },
      maxLeverage: 2,
    },
  );
});

test("the fingerprint ignores whitespace and the name, and catches any of the eight", () => {
  const base = fingerprint(filled());
  assert.equal(fingerprint(filled({ enters: "  A starter is ruled out \n\n" })), base);
  assert.equal(fingerprint(filled({ name: "Other" })), base);
  for (const patch of [
    { thesis: "x" },
    { reads: "x.com" },
    { enters: "other" },
    { exits: "x" },
    { never: "x" },
    { perTrade: 10 },
    { perDay: 30 },
    { leverage: 3 },
  ]) {
    assert.notEqual(fingerprint(filled(patch)), base, JSON.stringify(patch));
  }
});

test("the run's state: IDLE, LIVE, DONE, then STALE once the brief changes", () => {
  const ran = fingerprint(filled());
  assert.equal(runState({ started: false, terminal: false, ranFor: null }, ran), "IDLE");
  assert.equal(runState({ started: true, terminal: false, ranFor: ran }, ran), "LIVE");
  assert.equal(runState({ started: true, terminal: true, ranFor: ran }, ran), "DONE");
  assert.equal(
    runState({ started: true, terminal: true, ranFor: ran }, fingerprint(filled({ perDay: 30 }))),
    "STALE",
  );
});

test("Run's label, in the canvas's priority", () => {
  assert.equal(runLabel(filled(), "LIVE", ""), "Running");
  assert.equal(runLabel(filled({ enters: " " }), "IDLE", ""), "Write an entry rule to run it");
  assert.equal(runLabel(filled(), "DONE", "14:05"), "Next run at 14:05");
  assert.equal(runLabel(filled(), "STALE", ""), "Brief changed · run again");
  assert.equal(runLabel(filled(), "DONE", ""), "Run it again");
  assert.equal(runLabel(filled(), "IDLE", ""), "Run it on paper");
});

test("Run needs an entry rule, valid caps, no run going and no rate limit", () => {
  assert.equal(canRun(filled(), "IDLE", ""), true);
  assert.equal(canRun(filled({ enters: "" }), "IDLE", ""), false);
  assert.equal(canRun(filled(), "LIVE", ""), false);
  assert.equal(canRun(filled({ perTrade: 25, perDay: 20 }), "IDLE", ""), false);
  assert.equal(canRun(filled(), "DONE", "14:05"), false);
});

test("Create's label, in the canvas's priority", () => {
  assert.equal(createLabel(filled({ name: "" }), "empty", "DONE", true), "Name it to create");
  assert.equal(createLabel(filled(), "taken", "DONE", true), "@halftime is taken");
  assert.equal(
    createLabel(filled({ name: "Al" }), "invalid", "DONE", true),
    "@al can't be a handle",
  );
  assert.equal(createLabel(filled(), "checking", "DONE", true), "Checking @halftime…");
  assert.equal(createLabel(filled(), "free", "IDLE", false), "Run it once, then create");
  assert.equal(createLabel(filled(), "free", "STALE", true), "Run it once, then create");
  assert.equal(createLabel(filled(), "free", "DONE", false), "Run it once, then create");
  assert.equal(createLabel(filled(), "free", "DONE", true), "Create Halftime");
});

test("Create needs a free handle and a completed run that is not stale", () => {
  assert.equal(canCreate("free", "DONE", true), true);
  assert.equal(canCreate("free", "DONE", false), false);
  assert.equal(canCreate("free", "STALE", true), false);
  assert.equal(canCreate("taken", "DONE", true), false);
  assert.equal(canCreate("checking", "DONE", true), false);
});

test("the footnote follows the run", () => {
  assert.equal(footNote("IDLE"), "NOTHING GOES PUBLIC · IT RUNS ON PAPER UNTIL YOU FUND IT");
  assert.equal(footNote("LIVE"), "NOTHING GOES PUBLIC · IT RUNS ON PAPER UNTIL YOU FUND IT");
  assert.equal(footNote("STALE"), "YOU CHANGED THE BRIEF SINCE THE LAST RUN");
  assert.equal(footNote("DONE"), "THE BRIEF STAYS EDITABLE IN THE STUDIO");
});

test("the idle panel says what it needs", () => {
  assert.equal(idleNote(filled()), "RUN IT TO SEE WHICH RULES FIRE");
  assert.equal(idleNote(filled({ enters: "" })), "IT NEEDS AT LEAST ONE ENTRY RULE");
});

test("the server's field names map to the sections, with a reason a person reads", () => {
  assert.equal(sectionForField("entersWhen"), "enters");
  assert.equal(sectionForField("exitsWhen"), "exits");
  assert.equal(sectionForField("thesis"), "thesis");
  assert.equal(sectionForField("nope"), null);
  assert.equal(briefProblemText("required"), "Write at least one line.");
  assert.equal(briefProblemText("too_many"), "Too many lines for this section.");
});

// Literal copies, pinned. A dynamic import reaches an "import"-only package from this CommonJS
// test (see apps/web/src/features/studio/create/draft.ts for the constraint).
test("model.ts's copies match api-schema's and core's", async () => {
  const schema = await import("@pickler/api-schema");
  const core = await import("@pickler/core");
  assert.deepEqual(BRIEF_LIMITS, schema.BRIEF_LIMITS);
  assert.deepEqual(LEVERAGE_BOUNDS, schema.LEVERAGE_BOUNDS);
  assert.equal(PAPER_BUDGET_AUSD, schema.PAPER_BUDGET_AUSD);
  const trade = STEPPERS.find((stepper) => stepper.key === "perTrade")!;
  const day = STEPPERS.find((stepper) => stepper.key === "perDay")!;
  assert.ok(
    schema.spendLimitsSchema.safeParse({ perCallAusd: trade.max, perDayAusd: day.max }).success,
  );
  assert.ok(
    !schema.spendLimitsSchema.safeParse({ perCallAusd: trade.max + 1, perDayAusd: day.max })
      .success,
  );
  assert.ok(schema.previewRunRequestSchema.safeParse(toRequest(filled())).success);
  for (const line of [
    "https://www.espn.com/nfl",
    "nfl.com",
    "@AdamSchefter",
    "x.com/AdamSchefter",
    "https://twitter.com/AdamSchefter",
    "mobile.x.com/AdamSchefter",
    "the Thursday report",
  ]) {
    assert.equal(readKind(line), core.classifyRead(line).kind === "site" ? "site" : "soon", line);
  }
});

test("a failed availability check is its own state: pink, a retry label, no create", async () => {
  const model = await import("../src/features/studio/brief/model");
  assert.equal(handleState("Halftime", "failed"), "failed");
  assert.equal(handleState("Al", "failed"), "invalid");
  assert.equal(handleTone("failed"), "pink");
  assert.equal(
    createLabel(filled(), "failed", "DONE", true),
    "Couldn't check @halftime · try again",
  );
  assert.equal(canCreate("failed", "DONE", true), false);
  assert.equal(model.handleAnnouncement(filled(), "failed"), "Couldn't check @halftime");
});

test("the handle line announces what the check found, and nothing while it asks", async () => {
  const { handleAnnouncement } = await import("../src/features/studio/brief/model");
  assert.equal(handleAnnouncement(filled(), "free"), "@halftime is available");
  assert.equal(handleAnnouncement(filled(), "taken"), "@halftime is taken");
  assert.equal(handleAnnouncement(filled({ name: "Al" }), "invalid"), "@al can't be a handle");
  assert.equal(handleAnnouncement(filled(), "checking"), "");
  assert.equal(handleAnnouncement(filled({ name: "" }), "empty"), "");
});

test("polling a paper run gives up only when the run is gone", async () => {
  const { readGivesUp } = await import("../src/features/studio/brief/model");
  assert.equal(readGivesUp("NOT_FOUND"), true);
  assert.equal(readGivesUp("404"), true);
  assert.equal(readGivesUp("INTERNAL_OR_PROVIDER_FAILURE"), false);
  assert.equal(readGivesUp("503"), false);
  assert.equal(readGivesUp(""), false);
});
