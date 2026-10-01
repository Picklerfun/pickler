// apps/web/test/studio-new-agent-wallet.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WalletsDto } from "@pickler/api-schema";
import {
  applyRead,
  failRead,
  initialReads,
  markApproved,
  markDelegated,
  policiesApproved,
} from "../src/features/studio/new-agent/wallet-reads";

/* The create screen's wallet reads: newest wins, and approved policies stay approved. */

const list = (patch: Partial<WalletsDto["agents"][number]> = {}): WalletsDto => ({
  master: { address: "0xm", ausdMicro: "0", monWei: "0" },
  agents: [
    {
      walletId: "wal",
      address: "0x1",
      ausdMicro: "10000000",
      monWei: "500000000000000000",
      agentId: null,
      agentName: null,
      caps: null,
      policiesApproved: false,
      ...patch,
    },
  ],
  readAt: 0,
});

test("a read sets the wallet, the delegated user and the time", () => {
  const state = applyRead(initialReads(), {
    seq: 1,
    wallets: list(),
    delegated: true,
    at: "10:00",
  });

  assert.equal(state.wallet?.walletId, "wal");
  assert.equal(state.wallet?.ausdMicro, 10_000_000n);
  assert.equal(state.delegated, true);
  assert.equal(state.checkedAt, "10:00");
});

test("an older read that answers late is dropped", () => {
  const newer = applyRead(initialReads(), {
    seq: 2,
    wallets: list({ ausdMicro: "20000000" }),
    delegated: true,
    at: "10:01",
  });

  const after = applyRead(newer, { seq: 1, wallets: list(), delegated: false, at: "10:00" });

  assert.equal(after, newer);
});

test("approved policies stay approved when a later read still says false", () => {
  const approved = markApproved(
    applyRead(initialReads(), { seq: 1, wallets: list(), delegated: true, at: "10:00" }),
    "wal",
  );

  const reread = applyRead(approved, { seq: 2, wallets: list(), delegated: true, at: "10:01" });

  assert.equal(policiesApproved(reread), true);
});

test("a read that finds the policies approved keeps them approved", () => {
  const first = applyRead(initialReads(), {
    seq: 1,
    wallets: list({ policiesApproved: true }),
    delegated: true,
    at: "10:00",
  });

  const second = applyRead(first, { seq: 2, wallets: list(), delegated: true, at: "10:01" });

  assert.equal(policiesApproved(second), true);
});

test("another wallet's approval does not approve this one", () => {
  const state = markApproved(
    applyRead(initialReads(), { seq: 1, wallets: list(), delegated: true, at: "10:00" }),
    "other",
  );

  assert.equal(policiesApproved(state), false);
});

test("a rise between two reads is an arrival", () => {
  const first = applyRead(initialReads(), {
    seq: 1,
    wallets: list(),
    delegated: true,
    at: "10:00",
  });

  const second = applyRead(first, {
    seq: 2,
    wallets: list({ ausdMicro: "15000000" }),
    delegated: true,
    at: "10:01",
  });

  assert.deepEqual(second.arrivals, [{ text: "5 AUSD arrived", at: "10:01" }]);
});

test("a failed read keeps what was known and says so; only a later success clears it", () => {
  const read = applyRead(initialReads(), { seq: 1, wallets: list(), delegated: true, at: "10:00" });

  const failed = failRead(read, { seq: 2, message: "could not read" });
  const recovered = applyRead(failed, { seq: 3, wallets: list(), delegated: true, at: "10:02" });

  assert.equal(failed.error, "could not read");
  assert.equal(failed.wallet?.walletId, "wal");
  assert.equal(recovered.error, "");
});

test("a failure older than the newest read says nothing", () => {
  const read = applyRead(initialReads(), { seq: 2, wallets: list(), delegated: true, at: "10:00" });

  assert.equal(failRead(read, { seq: 1, message: "late" }), read);
});

test("the finished ceremony marks the delegated user", () => {
  const state = applyRead(initialReads(), { seq: 1, wallets: list(), delegated: false, at: "" });

  assert.equal(markDelegated(state).delegated, true);
});
