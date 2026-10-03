// apps/web/test/studio-draft-build.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WalletsDto } from "@pickler/api-schema";
import {
  CONFLICT_LINE,
  agentWalletRead,
  briefLists,
  briefText,
  briefView,
  readClock,
  setupProblem,
  sourcesView,
  webForm,
} from "../src/features/studio/shell/build-model";
import { capsOf, checkedLabel, starterCaps } from "../src/features/studio/draft/caps-model";
import { arrived } from "../src/features/studio/new-agent/model";

/* The Build sections' rules: Brief, Sources & rules, Limits & funding (spec §3.3, §3.5). */

const saved = {
  thesis: "Headlines move first.",
  entersWhen: ["Two sources agree", "Price moved < 0.3%"],
  exitsWhen: ["+2% or −1%"],
  never: [],
};

test("briefText: one rule per line; a config without a brief reads as empty", () => {
  assert.deepEqual(briefText(saved), {
    thesis: "Headlines move first.",
    enters: "Two sources agree\nPrice moved < 0.3%",
    exits: "+2% or −1%",
    never: "",
  });
  assert.deepEqual(briefText(undefined), { thesis: "", enters: "", exits: "", never: "" });
});

test("briefLists: trims the thesis and every line, and drops the empty ones", () => {
  assert.deepEqual(
    briefLists({ thesis: "  Edge.  ", enters: " a \n\n  b\n", exits: "\n", never: "x" }),
    { thesis: "Edge.", entersWhen: ["a", "b"], exitsWhen: [], never: ["x"] },
  );
});

test("briefView: blank lines and edges are not changes; a new line is; no entry rule is flagged", () => {
  const text = briefText(saved);
  assert.equal(briefView(text, text).dirty, false);
  assert.equal(
    briefView({ ...text, enters: `${text.enters}\n\n  `, thesis: ` ${text.thesis} ` }, text).dirty,
    false,
  );
  const edited = briefView({ ...text, never: "Add to a loser" }, text);
  assert.equal(edited.dirty, true);
  assert.equal(edited.tags.never.text, "1 LINE · EDITED");
  assert.equal(edited.needsEntry, false);
  const cleared = briefView({ ...text, enters: " \n" }, text);
  assert.equal(cleared.dirty, true);
  assert.equal(cleared.needsEntry, true);
  assert.equal(cleared.tags.enters.text, "EMPTY");
});

test("capsOf: the agent's spend before the config's, starter caps for what it lacks", () => {
  assert.deepEqual(
    capsOf({
      spend: { perCallAusd: 10, perDayAusd: 50 },
      configSpend: { perCallAusd: 5, perDayAusd: 20 },
      maxLeverage: 3,
    }),
    { perTradeAusd: 10, perDayAusd: 50, maxLeverage: 3 },
  );
  assert.deepEqual(capsOf({ spend: null, configSpend: { perCallAusd: 5, perDayAusd: 30 } }), {
    perTradeAusd: 5,
    perDayAusd: 30,
    maxLeverage: 1,
  });
  assert.deepEqual(capsOf({}), { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 });
});

test("starterCaps: true only when capsOf had to fill in what the agent was never given", () => {
  const spend = { perCallAusd: 10, perDayAusd: 50 };
  assert.equal(starterCaps({ spend, maxLeverage: 3 }), false);
  assert.equal(starterCaps({ spend: null, configSpend: spend, maxLeverage: 3 }), false);
  assert.equal(starterCaps({ spend: null, configSpend: null, maxLeverage: 3 }), true);
  assert.equal(starterCaps({ spend, maxLeverage: null }), true);
  assert.equal(starterCaps({}), true);
});

test("webForm: the config's web source, off as Anywhere with no sites", () => {
  assert.deepEqual(webForm({ mode: "prefer", sites: ["coindesk.com"] }), {
    on: true,
    mode: "prefer",
    sites: ["coindesk.com"],
  });
  assert.deepEqual(webForm(null), { on: false, mode: "anywhere", sites: [] });
  assert.deepEqual(webForm(undefined), { on: false, mode: "anywhere", sites: [] });
});

test("sourcesView: the tag, what is dirty, and the patch (null web when off)", () => {
  const was = webForm({ mode: "prefer", sites: ["coindesk.com"] });
  const same = sourcesView(was, was, null);
  assert.equal(same.tag, "PERPL + WEB");
  assert.equal(same.dirty, false);
  assert.equal(same.note.text, "1 OF 20 · ENTER TO ADD");
  assert.deepEqual(same.sources, { web: { mode: "prefer", sites: ["coindesk.com"] } });

  const off = sourcesView({ ...was, on: false }, was, null);
  assert.equal(off.tag, "PERPL ONLY");
  assert.equal(off.dirty, true);
  assert.deepEqual(off.sources, { web: null });

  /* With the web off, its mode and sites are not what is saved, so they are not changes. */
  const none = webForm(null);
  assert.equal(sourcesView({ ...none, mode: "only" }, none, null).dirty, false);
  assert.equal(sourcesView({ ...was, sites: ["coindesk.com", "x.com"] }, was, null).dirty, true);
});

test("sourcesView: an add's error comes first; Only without a site can't save; 20 is the limit", () => {
  const was = webForm({ mode: "prefer", sites: [] });
  const bad = sourcesView(was, was, "ALREADY LISTED");
  assert.deepEqual(bad.note, { text: "ALREADY LISTED", bad: true });
  const only = sourcesView({ ...was, mode: "only" }, was, null);
  assert.equal(only.needsSite, true);
  assert.deepEqual(only.note, { text: "“ONLY” NEEDS AT LEAST ONE SITE", bad: true });
  const full = Array.from({ length: 20 }, (_, index) => `site${index}.com`);
  assert.deepEqual(sourcesView({ ...was, sites: full }, was, null).note, {
    text: "20 SITES IS THE LIMIT",
    bad: false,
  });
});

test("setupProblem: a stale version reloads, a preview says so, anything else in its words", () => {
  assert.deepEqual(setupProblem("CONFLICT", "x"), { kind: "conflict" });
  assert.deepEqual(setupProblem("PREVIEW", "x"), { kind: "preview" });
  assert.deepEqual(setupProblem("INVALID_BRIEF", "Check the brief."), {
    kind: "error",
    text: "Check the brief.",
  });
  assert.equal(CONFLICT_LINE, "It changed somewhere else. Reloaded.");
});

const read = (ausdMicro: string, monWei: string | null, readAt: number): WalletsDto => ({
  master: { address: "0x7f3a", ausdMicro: "0", monWei: "0" },
  agents: [
    {
      walletId: "w",
      address: "0x91be",
      ausdMicro,
      monWei,
      agentId: "a",
      agentName: "Halftime",
      caps: null,
      policiesApproved: true,
    },
  ],
  readAt,
});

test("agentWalletRead: this wallet's balances, null until read or when it is not listed", () => {
  assert.deepEqual(agentWalletRead(read("10000000", null, 0), "w"), {
    walletId: "w",
    address: "0x91be",
    ausdMicro: 10_000_000n,
    monWei: null,
  });
  assert.equal(agentWalletRead(read("1", "1", 0), "other"), null);
  assert.equal(agentWalletRead(null, "w"), null);
});

test("between two reads, what grew arrived, stamped with the later read's time", () => {
  const at = new Date(2026, 9, 2, 14, 23).getTime();
  const before = agentWalletRead(read("10000000", "0", 0), "w")!;
  const after = agentWalletRead(read("15000000", "500000000000000000", at), "w")!;
  assert.deepEqual(
    arrived(before, after, readClock(at)).map((entry) => [entry.text, entry.at]),
    [
      ["5 AUSD arrived", "14:23"],
      ["0.5 MON arrived", "14:23"],
    ],
  );
});

test("checkedLabel: LAST CHECKED hh:mm in local time, or not checked yet", () => {
  assert.equal(checkedLabel(new Date(2026, 9, 2, 9, 5).getTime()), "LAST CHECKED 09:05");
  assert.equal(checkedLabel(null), "NOT CHECKED YET");
});

test("checkedLabel: what is still below the minimums, as the canvas says it", () => {
  const at = new Date(2026, 9, 2, 14, 23).getTime();
  const funded = { ausdMicro: 10_000_000n, monWei: 500_000_000_000_000_000n };
  assert.equal(checkedLabel(at, funded), "LAST CHECKED 14:23");
  assert.equal(
    checkedLabel(at, { ausdMicro: 0n, monWei: 0n }),
    "LAST CHECKED 14:23 · WAITING FOR AUSD AND MON",
  );
  assert.equal(checkedLabel(at, { ...funded, monWei: 0n }), "LAST CHECKED 14:23 · WAITING FOR MON");
  assert.equal(
    checkedLabel(at, { ...funded, ausdMicro: 9_999_999n }),
    "LAST CHECKED 14:23 · WAITING FOR AUSD",
  );
  /* A balance the chain did not answer for claims nothing. */
  assert.equal(checkedLabel(at, { ausdMicro: null, monWei: 0n }), "LAST CHECKED 14:23");
  assert.equal(checkedLabel(at, null), "LAST CHECKED 14:23");
});
