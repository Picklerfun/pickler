import assert from "node:assert/strict";
import { test } from "node:test";
import { createGate, gateHref, gateNote, startIfOpen } from "../src/features/studio/create/gate";

/* "+ New agent" is locked before any passkey prompt while an agent is unfunded. */

const open = { ok: true, reason: null } as const;
const locked = { ok: false, reason: "unfunded_agent" } as const;
const agent = (
  id: string,
  balanceAusd: number | null,
  canCreateAnother: typeof open | typeof locked,
) => ({
  id: `runtime-${id}`,
  productId: id,
  name: `Agent ${id}`,
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

test("an agent without a wallet reads as unfunded", () => {
  const bare = agent("a", null, locked);

  assert.deepEqual(createGate([bare]), { open: false, agent: bare });
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
