// apps/web/test/studio-live-build.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entryDirty,
  entryPatch,
  limitsWallet,
  liveBriefTags,
  liveCapsView,
  liveEntryView,
  pluginCount,
  pluginRows,
  stopRows,
} from "../src/features/studio/live/build-model";

const caps = {
  perTradeAusd: 25,
  perDayAusd: 100,
  maxLeverage: 3,
  maxOpenPositions: 3,
  dayLossStopAusd: 20,
};

test("the mode note is said of the setting, not of today (D19)", () => {
  const view = liveEntryView({ mode: "approve", meanwhile: "wait", smallAusd: 10 }, 25);

  assert.equal(
    view.modeNote,
    "ONCE IT RUNS · EVERY ENTRY WAITS FOR YOUR TAP, 4 MIN, THEN IT IS SKIPPED · EXITS NEVER WAIT",
  );
});

test("the day-loss line no longer claims it pauses itself today; the others are kept", () => {
  const view = liveCapsView(caps, caps);

  assert.equal(view.rows[4]?.sub, "LOST IN A DAY · ONCE IT RUNS, IT PAUSES ITSELF THERE");
  assert.equal(view.rows[0]?.sub, "THE MOST IT PUTS INTO ONE POSITION");
  assert.equal(view.tag, "SAVED · 25/100/3/3/20");
});

test("a brief tag reads the version where the draft's says DEFAULT", () => {
  const tags = liveBriefTags(
    {
      thesis: { text: "DEFAULT", edited: false },
      enters: { text: "3 LINES · DEFAULT", edited: false },
      exits: { text: "2 LINES · EDITED", edited: true },
      never: { text: "EMPTY", edited: false },
    },
    4,
  );

  assert.equal(tags.thesis.text, "V4");
  assert.equal(tags.enters.text, "3 LINES · V4");
  assert.equal(tags.exits.text, "2 LINES · EDITED");
  assert.equal(tags.never.text, "EMPTY");
});

test("IT READS: Perpl fixed, the web a switch, two shut", () => {
  const rows = pluginRows(false);

  assert.deepEqual(
    rows.map((row) => [row.key, row.kind, row.line]),
    [
      ["perpl", "fixed", "ALWAYS ON"],
      ["web", "switch", "OFF"],
      ["x", "soon", "SOON"],
      ["oi", "soon", "SOON"],
    ],
  );
  assert.equal(pluginCount(true), "2 ON");
  assert.equal(pluginCount(false), "1 ON");
});

test("stops: Pause is real, Stop is Soon, Auto-pause comes with the runtime", () => {
  const rows = stopRows(true);

  assert.deepEqual(rows[0]?.action, { kind: "button", label: "Resume" });
  assert.deepEqual(rows[1]?.action, { kind: "tag", label: "SOON" });
  assert.deepEqual(rows[2]?.action, { kind: "tag", label: "WITH THE RUNTIME" });
  assert.match(rows[2]?.note ?? "", /^It will pause itself/);
});

test("the entry saves clamped and compares as it saves", () => {
  const saved = { mode: "approve", meanwhile: "small", smallAusd: 10 } as const;

  assert.deepEqual(entryPatch({ ...saved, smallAusd: 40 }, 25), { ...saved, smallAusd: 25 });
  assert.equal(entryDirty(saved, saved, 25), false);
  assert.equal(entryDirty({ ...saved, mode: "auto" }, saved, 25), true);
});

test("its wallet: dashes unread, low gas, nothing to pull at zero", () => {
  assert.deepEqual(limitsWallet(null), {
    free: "—",
    inPositions: "0",
    mon: "—",
    gasLow: false,
    canPull: false,
  });

  const low = limitsWallet({ ausdMicro: 18_000_000n, monWei: 120_000_000_000_000_000n });

  assert.equal(low.free, "18");
  assert.equal(low.gasLow, true);
  assert.equal(low.canPull, true);
});
