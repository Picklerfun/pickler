import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_DRAFTS,
  createGate,
  draftLimitLock,
  gateNote,
  newAgentLock,
} from "../src/features/studio/home/gate";

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

test("the note names the agent to fund", () => {
  const unfunded = agent("b", 0, locked);

  assert.deepEqual(gateNote(unfunded), {
    title: "Fund Agent b first.",
    note: "One unfunded agent at a time.",
  });
});

/* Drafts: capped at three. A draft made with its wallet counts toward the funding lock like any
   agent (the API's fleet() reads its balance); one from before wallets came with drafts has none. */

const draft = (id: string, canCreateAnother: Lock, balanceAusd: number | null = null) => ({
  ...agent(id, balanceAusd, canCreateAnother),
  name: `Draft ${id}`,
  draft: true,
});

test('three drafts and every wallet funded: "+ New agent" closes on the limit, and nobody is asked to fund a draft', () => {
  // Input A. Every agent is created as a draft, so the entries close here, before a wallet is made
  // or funded, rather than after, at the 409 DRAFT_LIMIT.
  const agents = [
    draft("d1", draftLimit),
    draft("d2", draftLimit),
    draft("d3", draftLimit),
    agent("a", 25, draftLimit),
  ];

  assert.deepEqual(createGate(agents), { open: true });
  assert.equal(newAgentLock(agents), "At most 3 drafts at a time.");
});

test("a walletless draft beside an unfunded agent: the one to fund is the agent with the wallet", () => {
  // Input B, with the draft first in the list and selected.
  const unfunded = agent("a", 0, locked);
  const agents = [draft("d1", locked), unfunded];

  assert.deepEqual(createGate(agents), { open: false, agent: unfunded });
  assert.equal(newAgentLock(agents), "Fund Agent a first. One unfunded agent at a time.");
});

test("a closed funding lock with every wallet above the minimum names a wallet, never a walletless draft", () => {
  const first = agent("a", 50, locked);

  assert.deepEqual(createGate([draft("d1", locked), first]), { open: false, agent: first });
});

test("a lone draft holding 5 AUSD is the one to fund: its wallet counts, as on the server", () => {
  const underfunded = draft("d1", locked, 5);

  assert.deepEqual(createGate([underfunded]), { open: false, agent: underfunded });
  assert.equal(newAgentLock([underfunded]), "Fund Draft d1 first. One unfunded agent at a time.");
});

test("an underfunded draft beside a funded agent is named, not the agent", () => {
  const underfunded = draft("d1", locked, 5);
  const agents = [agent("a", 40, locked), underfunded];

  assert.deepEqual(createGate(agents), { open: false, agent: underfunded });
  assert.equal(newAgentLock(agents), "Fund Draft d1 first. One unfunded agent at a time.");
});

test("an unfunded agent closes it whatever the number of drafts", () => {
  const unfunded = agent("a", 2, locked);
  const agents = [draft("d1", locked), draft("d2", locked), draft("d3", locked), unfunded];

  assert.equal(newAgentLock(agents), "Fund Agent a first. One unfunded agent at a time.");
});

test("an open lock has no note", () => {
  assert.equal(newAgentLock([]), "");
  assert.equal(newAgentLock([draft("d1", open), agent("a", 10, open)]), "");
});

test("the draft limit counts the drafts as the API does, and also reads the API's own answer", () => {
  const two = [draft("d1", open), draft("d2", open), agent("a", 25, open)];
  const three = [...two, draft("d3", open)];

  assert.equal(draftLimitLock(two), "");
  assert.equal(draftLimitLock(three), "At most 3 drafts at a time.");
  // A list whose lock already says draft_limit is closed even if this count lags behind it.
  assert.equal(draftLimitLock([draft("d1", draftLimit)]), "At most 3 drafts at a time.");
  // Funding is said first: the one to fund is named, not the limit.
  assert.equal(
    newAgentLock([...three, agent("b", 0, locked)]),
    "Fund Agent b first. One unfunded agent at a time.",
  );
});

test("the web's draft limit is core's", async () => {
  const core = await import("@pickler/core");

  assert.equal(MAX_DRAFTS, core.MAX_DRAFTS_PER_WORKSPACE);
});

test("the staged draft studio models the lock the API gives a lone draft: open", async () => {
  // One draft, funded at create: nothing is unfunded and the drafts are below their limit.
  const { draftStudioFixture } = await import("../src/features/studio/draft/fixture");
  const staged = draftStudioFixture("draft").agent;

  assert.equal(staged.draft, true);
  assert.deepEqual(staged.canCreateAnother, { ok: true, reason: null });
  assert.equal(newAgentLock([staged]), "");
});
