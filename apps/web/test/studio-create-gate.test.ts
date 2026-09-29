import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRAFT_LIMIT_NOTE,
  createGate,
  gateHref,
  gateNote,
  newAgentGate,
  newAgentLock,
  startIfOpen,
} from "../src/features/studio/create/gate";

/* "+ New agent" is locked before any passkey prompt while an agent is unfunded. */

const open = { ok: true, reason: null } as const;
const locked = { ok: false, reason: "unfunded_agent" } as const;
const draftLimit = { ok: false, reason: "draft_limit" } as const;
type Lock = typeof open | typeof locked | typeof draftLimit;
const agent = (id: string, balanceAusd: number | null, canCreateAnother: Lock) => ({
  id: `runtime-${id}`,
  productId: id,
  name: `Agent ${id}`,
  draft: false,
  wallet: balanceAusd === null ? null : { walletId: `w-${id}`, address: "0x1", balanceAusd },
  canCreateAnother,
});

test("no agents yet: the first one may be created", () => {
  assert.deepEqual(createGate([]), { open: true });
});

test("every agent funded: another may be created", () => {
  assert.deepEqual(createGate([agent("a", 10, open), agent("b", 25, open)]), { open: true });
});

test("an unfunded agent closes the gate and is the one named", () => {
  const funded = agent("a", 12, locked);
  const unfunded = agent("b", 3, locked);

  assert.deepEqual(createGate([funded, unfunded]), { open: false, agent: unfunded });
});

test("an agent without a wallet is not the one to fund: there is nothing to fund", () => {
  // Made before wallets existed. The API does not count it as unfunded, so neither does the gate.
  const bare = agent("a", null, locked);
  const unfunded = agent("b", 4, locked);

  assert.deepEqual(createGate([bare, unfunded]), { open: false, agent: unfunded });
});

test("a lock with no wallet behind it is not one the gate can explain, so it does not invent one", () => {
  // The API answers `unfunded_agent` only over agents with a wallet, and refuses the create itself.
  assert.deepEqual(createGate([agent("a", null, locked)]), { open: true });
});

test("a closed lock with no agent below the minimum still names one", () => {
  const first = agent("a", 50, locked);

  assert.deepEqual(createGate([first]), { open: false, agent: first });
});

test("the note and the link name the agent to fund", () => {
  const unfunded = agent("b", 0, locked);

  assert.deepEqual(gateNote(unfunded), {
    title: "Fund Agent b first.",
    note: "One unfunded agent at a time.",
  });
  assert.equal(gateHref(unfunded, "/studio"), "/studio?agent=b");
});

test('"Fund it" goes to the studio\'s home on the host it is rendered for', () => {
  // `/studio` is a 404 on the studio host, where the studio is `/`.
  const unfunded = agent("b", 0, locked);
  assert.equal(gateHref(unfunded, "/"), "/?agent=b");
  assert.equal(gateHref(unfunded, "https://app.pickler.fun/"), "https://app.pickler.fun/?agent=b");
});

test("a closed gate never starts the ceremony", async () => {
  const unfunded = agent("b", 0, locked);
  let started = 0;

  const outcome = await startIfOpen(
    async () => [unfunded],
    async () => {
      started += 1;
      return "ceremony";
    },
  );

  assert.equal(started, 0);
  assert.deepEqual(outcome, { started: false, agent: unfunded });
});

test("an open gate starts it once and answers what it returned", async () => {
  let started = 0;

  const outcome = await startIfOpen(
    async () => [agent("a", 10, open)],
    async () => {
      started += 1;
      return "ceremony";
    },
  );

  assert.equal(started, 1);
  assert.deepEqual(outcome, { started: true, value: "ceremony" });
});

/* Drafts (studio-brief-v1 §6): no wallet, never the agent to fund, capped at three. */

const draft = (id: string, canCreateAnother: Lock) => ({
  ...agent(id, null, canCreateAnother),
  name: `Draft ${id}`,
  draft: true,
});

test("three drafts and every wallet funded: the reason is the draft limit, not funding", () => {
  // Input A. A draft has no wallet, so reading its balance as 0 made this "Fund Draft d1 first".
  const agents = [
    draft("d1", draftLimit),
    draft("d2", draftLimit),
    draft("d3", draftLimit),
    agent("a", 25, draftLimit),
  ];

  assert.deepEqual(newAgentGate(agents), { open: false, reason: "draft_limit" });
  assert.equal(newAgentLock(agents), "At most 3 drafts at a time.");
  assert.equal(DRAFT_LIMIT_NOTE, "At most 3 drafts at a time.");
});

test("a draft beside an unfunded agent: the one to fund is the agent with the wallet", () => {
  // Input B, with the draft first in the list and selected.
  const unfunded = agent("a", 0, locked);
  const agents = [draft("d1", locked), unfunded];

  assert.deepEqual(createGate(agents), { open: false, agent: unfunded });
  assert.deepEqual(newAgentGate(agents), {
    open: false,
    reason: "unfunded_agent",
    agent: unfunded,
  });
  assert.equal(newAgentLock(agents), "Fund Agent a first. One unfunded agent at a time.");
});

test("a closed funding lock with every wallet above the minimum names a wallet agent, never a draft", () => {
  const first = agent("a", 50, locked);

  assert.deepEqual(createGate([draft("d1", locked), first]), { open: false, agent: first });
});

test("funding comes before the draft limit when both hold", () => {
  // The API answers `unfunded_agent` first; this is the same order for a list that mixes them.
  const unfunded = agent("a", 2, locked);
  const agents = [draft("d1", locked), draft("d2", locked), draft("d3", locked), unfunded];

  assert.equal(newAgentLock(agents), "Fund Agent a first. One unfunded agent at a time.");
});

test("an open lock has no note", () => {
  assert.equal(newAgentLock([]), "");
  assert.equal(newAgentLock([draft("d1", open), agent("a", 10, open)]), "");
});

test("three drafts do not close /studio/new: the limit is on drafts, and it creates none", async () => {
  const agents = [draft("d1", draftLimit), draft("d2", draftLimit), draft("d3", draftLimit)];
  let started = 0;

  assert.deepEqual(createGate(agents), { open: true });
  const outcome = await startIfOpen(
    async () => agents,
    async () => {
      started += 1;
      return "ceremony";
    },
  );

  assert.equal(started, 1);
  assert.deepEqual(outcome, { started: true, value: "ceremony" });
});

test("the staged draft home models the lock the API gives a lone draft: open", async () => {
  // One draft, no wallet agents: nothing is unfunded and the drafts are below their limit.
  const { draftFixture } = await import("../src/features/studio/home/fixture");
  const staged = draftFixture().agent;

  assert.equal(staged.draft, true);
  assert.deepEqual(staged.canCreateAnother, { ok: true, reason: null });
  assert.equal(newAgentLock([staged]), "");
});
