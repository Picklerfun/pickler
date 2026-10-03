// apps/web/test/studio-live-market.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WalletsDto } from "@pickler/api-schema";
import {
  LEADER_ASK,
  PASSKEY_NOTE,
  READ_WORDS,
  SHUT,
  backLabel,
  backReason,
  liveAllocation,
  passkeyTag,
  readState,
  stagedProfile,
  tabAfter,
} from "../src/features/studio/live/market-model";

/* The MARKETPLACE and YOU sections' own rules, one behaviour per test. */

const isEmpty = (list: readonly unknown[]) => list.length === 0;

test("readState: failed says so, whatever the studio", () => {
  assert.equal(readState<string[]>("failed", false, isEmpty), "failed");
  assert.equal(readState<string[]>("failed", true, isEmpty), "failed");
});

test("readState: unread is loading, except in a preview, which says so rather than empty", () => {
  assert.equal(readState<string[]>(null, false, isEmpty), "loading");
  assert.equal(readState<string[]>(null, true, isEmpty), "preview");
});

test("readState: a read list is empty or ready by the section's own test", () => {
  assert.equal(readState<string[]>([], false, isEmpty), "empty");
  assert.equal(readState(["a"], false, isEmpty), "ready");
  assert.equal(
    readState({ entries: [] as string[] }, false, (read) => read.entries.length === 0),
    "empty",
  );
});

test("SHUT: every shut control has its reason, and none promises a date", () => {
  for (const reason of Object.values(SHUT)) {
    assert.ok(reason.length > 0);
    assert.doesNotMatch(reason, /\b(soon|tomorrow|next week)\b/i);
  }
});

test("READ_WORDS: each marketplace read has its three lines", () => {
  for (const words of Object.values(READ_WORDS)) {
    assert.ok(words.loading.endsWith("…"));
    assert.match(words.failed, /^Couldn't read/);
    assert.ok(words.empty.length > 0);
  }
  assert.equal(READ_WORDS.leaders.empty, "No agent has a resolved record yet.");
});

test("backLabel: the owner's own agent has no token to back", () => {
  assert.equal(backLabel(true), "Launch its token");
  assert.equal(backLabel(false), "Back it");
});

test("backReason: Launch its token waits on the launcher, Back it on a token", () => {
  assert.equal(backReason(true), "The token launcher is not deployed yet.");
  assert.equal(backReason(false), SHUT.back);
});

test("LEADER_ASK: no price is printed, because the leaderboard carries none", () => {
  assert.equal(LEADER_ASK, "Ask");
});

const wallets = (ausdMicro: string | null): WalletsDto => ({
  master: { address: "0x7f3a", ausdMicro: "177600000", monWei: "3700000000000000000" },
  agents: [
    {
      walletId: "w",
      address: "0x91bE",
      ausdMicro,
      monWei: "900000000000000000",
      agentId: "a",
      agentName: "Halftime",
      caps: null,
      policiesApproved: true,
    },
  ],
  readAt: 0,
});

test("liveAllocation: this agent's wallet as read, then AI credits, Soon", () => {
  const rows = liveAllocation(wallets("75800000"), { name: "Halftime", wallet: { walletId: "w" } });

  assert.deepEqual(
    rows.map((row) => [row.key, row.label, row.kind, row.soon]),
    [
      ["w", "In Halftime's wallet", "agent", false],
      ["credits", "AI credits", "credits", true],
    ],
  );
  assert.match(rows[0]?.value ?? "", /^75\.8\d* AUSD$/);
  assert.equal(rows[1]?.value, "Soon");
});

test("liveAllocation: dashes until the wallets are read, and for a balance the API left out", () => {
  const agent = { name: "Halftime", wallet: { walletId: "w" } };

  assert.equal(liveAllocation(null, agent)[0]?.value, "—");
  assert.equal(liveAllocation(wallets(null), agent)[0]?.value, "—");
});

test("liveAllocation: an agent without a wallet has only the credits row", () => {
  const rows = liveAllocation(wallets("1"), { name: "Halftime", wallet: null });

  assert.deepEqual(
    rows.map((row) => row.key),
    ["credits"],
  );
});

test("liveAllocation: an unnamed agent's wallet is 'its'", () => {
  const rows = liveAllocation(null, { wallet: { walletId: "w" } });

  assert.equal(rows[0]?.label, "In its wallet");
});

test("PASSKEY_NOTE: claims no signature for what is saved or not built", () => {
  assert.doesNotMatch(PASSKEY_NOTE, /caps|closing|marketplace/i);
});

test("stagedProfile: the stage's handle, made on the stage's clock; nothing without one", () => {
  const now = Date.UTC(2026, 9, 2, 14, 30);

  assert.deepEqual(stagedProfile("nightowl", now), {
    user_id: "staged",
    display_name: "nightowl",
    handle: "nightowl",
    created_at: "2026-10-02T14:30:00.000Z",
  });
  assert.equal(stagedProfile(null, now), null);
});

const TABS = ["security", "profile", "notify"] as const;

test("tabAfter: arrows step and wrap", () => {
  assert.equal(tabAfter(TABS, "security", "ArrowRight"), "profile");
  assert.equal(tabAfter(TABS, "notify", "ArrowRight"), "security");
  assert.equal(tabAfter(TABS, "security", "ArrowLeft"), "notify");
  assert.equal(tabAfter(TABS, "profile", "ArrowLeft"), "security");
});

test("tabAfter: Home and End jump", () => {
  assert.equal(tabAfter(TABS, "profile", "Home"), "security");
  assert.equal(tabAfter(TABS, "profile", "End"), "notify");
});

test("tabAfter: any other key, or a tab not in the list, moves nowhere", () => {
  assert.equal(tabAfter(TABS, "profile", "Enter"), null);
  assert.equal(tabAfter(TABS, "profile", "ArrowDown"), null);
  assert.equal(tabAfter<string>(TABS, "missing", "ArrowRight"), null);
  assert.equal(tabAfter<string>([], "security", "Home"), null);
});

test("passkeyTag: from the list that was read, never a guess", () => {
  assert.equal(passkeyTag({ kind: "loading" }), "READING…");
  assert.equal(passkeyTag({ kind: "failed" }), "UNREAD");
  assert.equal(passkeyTag({ kind: "ready", passkeys: [] }), "NONE YET");
  assert.equal(passkeyTag({ kind: "ready", passkeys: [{}] }), "ACTIVE · 1 DEVICE");
  assert.equal(passkeyTag({ kind: "ready", passkeys: [{}, {}] }), "ACTIVE · 2 DEVICES");
});
