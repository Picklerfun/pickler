// apps/web/test/studio-draft-model.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WalletsDto } from "@pickler/api-schema";
import {
  DRAFT_SECTIONS,
  INTERVAL_OPTIONS,
  X_UNAVAILABLE_LINE,
  addSite,
  briefTags,
  capsStepper,
  draftRail,
  goPublicView,
  headerTiles,
  lockedCopy,
  nextRuns,
  publishBlockedCopy,
  runsPerDay,
  sectionLabel,
  xView,
} from "../src/features/studio/draft/model";
import { LEVERAGE_BOUNDS, MAX_SITES, SPEND_BOUNDS } from "../src/features/studio/new-agent/model";

/* One behaviour per test: these are the rules the draft studio's screens are. */

const agentWallet = (ausdMicro: string | null): WalletsDto["agents"][number] => ({
  walletId: "w",
  address: "0x91be",
  ausdMicro,
  monWei: "0",
  agentId: null,
  agentName: null,
  caps: null,
  policiesApproved: true,
});
const wallets = (master: string | null, agents: (string | null)[] = []): WalletsDto => ({
  master: { address: "0x7f3a", ausdMicro: master, monWei: "0" },
  agents: agents.map(agentWallet),
  readAt: 0,
});
const caps = { perTradeAusd: 5, perDayAusd: 20, maxLeverage: 1 };
const noX = { challenge: null, checking: false, unavailable: false, taken: null } as const;

test("the rail has the four groups of the canvas, in order", () => {
  const rail = draftRail("overview");
  assert.deepEqual(
    rail.map((group) => [group.title, group.items.map((item) => item.label)]),
    [
      ["RUN", ["Overview", "Console", "Trades", "Activity"]],
      ["BUILD", ["Brief", "Sources & rules", "Limits & funding", "Identity & voice"]],
      ["GROW", ["Public profile"]],
      ["YOU", ["Trade", "Master wallet"]],
    ],
  );
});

test("each rail item carries its icon", () => {
  const icons = DRAFT_SECTIONS.flatMap((group) => group.items.map((item) => item.icon));
  assert.deepEqual(icons, [
    "grid",
    "chat",
    "target",
    "activity",
    "file",
    "sliders",
    "wallet",
    "user",
    "globe",
    "coin",
    "wallet",
  ]);
});

test("Activity and Public profile are locked while private, nothing else is", () => {
  const locked = draftRail("overview")
    .flatMap((group) => group.items)
    .filter((item) => item.locked)
    .map((item) => item.key);
  assert.deepEqual(locked, ["activity", "profile"]);
});

test("a locked item says when it opens, an open one is its own label", () => {
  const items = draftRail("overview").flatMap((group) => group.items);
  assert.equal(items.find((item) => item.key === "profile")?.title, "Opens when it's public");
  assert.equal(items.find((item) => item.key === "brief")?.title, "Brief");
});

test("exactly the current section is on", () => {
  const on = draftRail("limits")
    .flatMap((group) => group.items)
    .filter((item) => item.on)
    .map((item) => item.key);
  assert.deepEqual(on, ["limits"]);
});

test("a locked section's panel names it", () => {
  assert.equal(lockedCopy("activity"), "Activity opens when it's public.");
  assert.equal(lockedCopy("profile"), "Public profile opens when it's public.");
});

test("a section's label is the canvas's", () => {
  assert.equal(sectionLabel("picks"), "Trades");
  assert.equal(sectionLabel("skills"), "Sources & rules");
  assert.equal(sectionLabel("master"), "Master wallet");
});

test("the tiles read master and the agents' wallets, formatted in AUSD", () => {
  const tiles = headerTiles(wallets("187600000", ["10000000", "2500000"]));
  assert.deepEqual(
    tiles.slice(0, 2).map(({ label, value }) => ({ label, value })),
    [
      { label: "MASTER · AUSD", value: "187.6" },
      { label: "IN AGENT WALLETS · AUSD", value: "12.5" },
    ],
  );
});

test("three tiles read Soon, never a made-up number", () => {
  const tiles = headerTiles(wallets("1000000"));
  assert.deepEqual(
    tiles.slice(2).map(({ label, value, soon }) => ({ label, value, soon })),
    [
      { label: "IN YOUR POSITIONS · AUSD", value: "Soon", soon: true },
      { label: "OPEN P&L · AUSD", value: "Soon", soon: true },
      { label: "AI CREDITS", value: "Soon", soon: true },
    ],
  );
});

test("tiles are dashes while the wallets are unread", () => {
  const tiles = headerTiles(null);
  assert.deepEqual(
    tiles.slice(0, 2).map((tile) => tile.value),
    ["—", "—"],
  );
});

test("an unread agent wallet makes the agents' total unknown, not smaller", () => {
  assert.equal(headerTiles(wallets("0", ["10000000", null]))[1]?.value, "—");
});

test("no agent wallets is zero in them", () => {
  assert.equal(headerTiles(wallets("0"))[1]?.value, "0");
});

test("Go Public starts at 0 of 1 with Connect X and a shut button", () => {
  const view = goPublicView({ xHandle: null, skipped: false, publishing: false, error: null });
  assert.equal(view.title, "GO PUBLIC");
  assert.deepEqual([view.done, view.of], [0, 1]);
  assert.deepEqual(view.task, { title: "Connect X", meta: "WHERE IT POSTS", done: false });
  assert.equal(view.canPublish, false);
  assert.equal(view.label, "Connect X to go public");
  assert.equal(view.skipLabel, "SKIP X FOR NOW · IT POSTS ON PICKLER ONLY");
  assert.equal(view.xNote, "");
});

test("a verified X account completes the task and adds X to the line", () => {
  const view = goPublicView({
    xHandle: "halftimebot",
    skipped: false,
    publishing: false,
    error: null,
  });
  assert.deepEqual([view.done, view.of], [1, 1]);
  assert.deepEqual(view.task, { title: "Connect X", meta: "@HALFTIMEBOT", done: true });
  assert.equal(view.canPublish, true);
  assert.equal(view.label, "Go public");
  assert.equal(view.xNote, " and X");
  assert.equal(view.skipLabel, "");
});

test("skipping X opens the button without completing the task, and offers undo", () => {
  const view = goPublicView({ xHandle: null, skipped: true, publishing: false, error: null });
  assert.equal(view.done, 0);
  assert.equal(view.canPublish, true);
  assert.equal(view.label, "Go public");
  assert.equal(view.skipLabel, "POSTS ON PICKLER ONLY · UNDO");
  assert.equal(view.xNote, "");
});

test("while publishing the button is shut and says so", () => {
  const view = goPublicView({ xHandle: null, skipped: true, publishing: true, error: null });
  assert.equal(view.canPublish, false);
  assert.equal(view.label, "Going public…");
});

test("an error passes through for the card to show", () => {
  const view = goPublicView({ xHandle: null, skipped: true, publishing: false, error: "Nope" });
  assert.equal(view.error, "Nope");
});

test("Verify becomes Check again once a challenge exists, and Checking… while it runs", () => {
  assert.equal(xView(noX).button, "Verify");
  const challenge = { handle: "halftimebot", text: "Verifying Halftime on @pickler · pk-7f3a" };
  assert.equal(xView({ ...noX, challenge }).button, "Check again");
  assert.deepEqual(
    [
      xView({ ...noX, challenge, checking: true }).button,
      xView({ ...noX, checking: true }).disabled,
    ],
    ["Checking…", true],
  );
});

test("with a challenge the miss block shows the line to post and where from", () => {
  const challenge = { handle: "halftimebot", text: "Verifying Halftime on @pickler · pk-7f3a" };
  assert.deepEqual(xView({ ...noX, challenge }).miss, {
    title: "We couldn't find the post yet.",
    line: "Verifying Halftime on @pickler · pk-7f3a",
    hint: "POST THIS FROM @HALFTIMEBOT · THEN CHECK AGAIN",
  });
  assert.equal(xView(noX).miss, null);
});

test("without X credentials the card says so and shows no miss block", () => {
  const view = xView({ ...noX, unavailable: true });
  assert.equal(view.unavailable, X_UNAVAILABLE_LINE);
  assert.equal(
    X_UNAVAILABLE_LINE,
    "X verification isn't open yet. Skip it for now; you can connect X later in Identity & voice.",
  );
  assert.equal(xView(noX).unavailable, null);
});

test("a handle that is another agent's says so", () => {
  assert.equal(
    xView({ ...noX, taken: "halftimebot" }).taken,
    "@halftimebot is already another agent's.",
  );
  assert.equal(xView(noX).taken, null);
});

test("each publish blocker has its line, and only FUNDS offers funding", () => {
  assert.deepEqual(publishBlockedCopy(["WALLET", "FUNDS"]), [
    { blocker: "WALLET", text: "It needs its own wallet to go public.", fund: false },
    { blocker: "FUNDS", text: "Its wallet needs at least 10 AUSD to go public.", fund: true },
  ]);
  const [killed] = publishBlockedCopy(["KILLED"]);
  assert.equal(killed?.fund, false);
  assert.ok(killed?.text);
});

test("the caps steppers start at the saved values, clean and tagged SAVED", () => {
  const view = capsStepper(caps, caps);
  assert.equal(view.dirty, false);
  assert.equal(view.tag, "SAVED");
  assert.deepEqual(
    view.rows.map((row) => [row.title, row.display]),
    [
      ["PER TRADE", "5 AUSD"],
      ["PER DAY", "20 AUSD"],
      ["MAX LEVERAGE", "1×"],
    ],
  );
});

test("a cap off its saved value is dirty and tagged UNSAVED CHANGES", () => {
  const view = capsStepper({ ...caps, maxLeverage: 3 }, caps);
  assert.equal(view.dirty, true);
  assert.equal(view.tag, "UNSAVED CHANGES");
});

test("steps are 5, 10 and 1, and stop at the floor", () => {
  const rows = capsStepper(caps, caps).rows;
  assert.deepEqual(
    rows.map((row) => [row.next, row.prev]),
    [
      [10, null],
      [30, 10],
      [2, null],
    ],
  );
});

test("steps stop at core's ceilings", () => {
  const top = {
    perTradeAusd: SPEND_BOUNDS.perCallAusd.max,
    perDayAusd: SPEND_BOUNDS.perDayAusd.max,
    maxLeverage: LEVERAGE_BOUNDS.max,
  };
  assert.deepEqual(
    capsStepper(top, top).rows.map((row) => row.next),
    [null, null, null],
  );
});

test("a day's cap below one trade's cannot be saved", () => {
  const view = capsStepper({ ...caps, perTradeAusd: 50 }, caps);
  assert.equal(view.inverted, true);
  assert.equal(view.canSave, false);
  assert.equal(capsStepper({ ...caps, perDayAusd: 30 }, caps).canSave, true);
  assert.equal(capsStepper(caps, caps).canSave, false);
});

const brief = { thesis: "BTC first", enters: "a\nb", exits: "c", never: "" };

test("an unchanged brief tags DEFAULT, with counts on the three lists", () => {
  const tags = briefTags(brief, brief);
  assert.deepEqual(
    [tags.thesis.text, tags.enters.text, tags.exits.text],
    ["DEFAULT", "2 LINES · DEFAULT", "1 LINE · DEFAULT"],
  );
  assert.equal(tags.thesis.edited, false);
});

test("an edited section tags EDITED and lights", () => {
  const tags = briefTags({ ...brief, enters: "a\nb\nc" }, brief);
  assert.equal(tags.enters.text, "3 LINES · EDITED");
  assert.equal(tags.enters.edited, true);
  assert.equal(briefTags({ ...brief, thesis: "ETH" }, brief).thesis.text, "EDITED");
});

test("an empty section tags EMPTY without a count", () => {
  const tags = briefTags(brief, brief);
  assert.equal(tags.never.text, "EMPTY");
  assert.equal(tags.never.edited, false);
  assert.equal(briefTags({ ...brief, thesis: "  " }, brief).thesis.text, "EMPTY");
});

test("a site is stripped to its bare host and added", () => {
  assert.deepEqual(addSite([], "  https://www.CoinDesk.com/markets/x "), {
    sites: ["coindesk.com"],
    draft: "",
    error: null,
  });
});

test("a site that is not a host stays in the box with the reason", () => {
  assert.deepEqual(addSite(["a.com"], "not a host"), {
    sites: ["a.com"],
    draft: "not a host",
    error: "BARE HOSTNAMES ONLY · NO HTTPS, NO PATHS",
  });
});

test("a listed site is not added twice, whatever its spelling", () => {
  const result = addSite(["coindesk.com"], "https://www.coindesk.com/x");
  assert.deepEqual(result.sites, ["coindesk.com"]);
  assert.equal(result.error, "ALREADY LISTED");
  assert.equal(result.draft, "coindesk.com");
});

test("the twenty-first site is refused", () => {
  const full = Array.from({ length: MAX_SITES }, (_, i) => `s${i}.com`);
  const result = addSite(full, "extra.com");
  assert.equal(result.sites.length, MAX_SITES);
  assert.equal(result.error, `${MAX_SITES} SITES IS THE LIMIT`);
});

test("an empty box adds nothing and says nothing", () => {
  assert.deepEqual(addSite(["a.com"], "  "), { sites: ["a.com"], draft: "  ", error: null });
});

test("the schedule offers 3, 6, 12 and 24 hours", () => {
  assert.deepEqual([...INTERVAL_OPTIONS], [3, 6, 12, 24]);
});

test("runs per day follows the interval, at least one", () => {
  assert.deepEqual(INTERVAL_OPTIONS.map(runsPerDay), [8, 4, 2, 1]);
  assert.equal(runsPerDay(48), 1);
});

test("the next three runs are an interval apart, the first labelled for go public", () => {
  const runs = nextRuns(6, new Date(2026, 9, 2, 9, 5));
  assert.deepEqual(runs, [
    { label: "First run after go public", at: "15:05" },
    { label: "Then · reads sources, decides, posts", at: "21:05" },
    { label: "Then · reads sources, decides, posts", at: "03:05 · TMRW" },
  ]);
});

test("a run days out says how many days, not tomorrow", () => {
  const runs = nextRuns(24, new Date(2026, 9, 2, 9, 5));
  assert.deepEqual(
    runs.map((run) => run.at),
    ["09:05 · TMRW", "09:05 · +2D", "09:05 · +3D"],
  );
});
