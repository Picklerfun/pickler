// apps/web/test/studio-new-agent-transfer.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUnits, parseAmount, shortAddress } from "../src/features/studio/new-agent/model";
import {
  MON_GAS_RESERVE_WEI,
  POST_STAMP_SAFE,
  agentWalletTag,
  canMove,
  cleanAmount,
  exactUnits,
  failedTransfer,
  maxAmount,
  moveBody,
  moveNote,
  moveSheetCopy,
  moveSource,
  transferFailure,
  transferLabel,
  walletName,
} from "../src/features/studio/new-agent/transfer-model";

/* One behaviour per test: these are the rules the Wallets modal is. */

const walletsDto = (patch: { agentId?: string | null; agentName?: string | null } = {}) => ({
  master: { address: "0xmaster", ausdMicro: "50000000", monWei: "2000000000000000000" },
  agents: [
    {
      walletId: "wal",
      address: "0x91be00000000000000000000000000000000a07",
      ausdMicro: "3000000",
      monWei: null,
      agentId: patch.agentId ?? null,
      agentName: patch.agentName ?? null,
      caps: null,
      policiesApproved: false,
    },
  ],
  readAt: 0,
});

test("pulling back names the agent when it holds too little", () => {
  assert.equal(
    transferLabel({
      amount: "5",
      token: "AUSD",
      toAgent: false,
      held: 1_000_000n,
      agentName: "Halftime",
    }),
    "More AUSD than Halftime holds",
  );
});

test("formatUnits truncates to four decimals", () => {
  assert.equal(formatUnits(1_234_567n, "AUSD"), "1.2345");
});

test("a move toward the agent spends the master's balance of its token", () => {
  const wallets = walletsDto();
  assert.equal(moveSource(wallets, { walletId: "wal", toAgent: true, token: "AUSD" }), 50_000_000n);
  assert.equal(
    moveSource(wallets, { walletId: "wal", toAgent: true, token: "MON" }),
    2_000_000_000_000_000_000n,
  );
});

test("a pull spends the agent wallet's balance, unread as null", () => {
  const wallets = walletsDto();
  assert.equal(moveSource(wallets, { walletId: "wal", toAgent: false, token: "AUSD" }), 3_000_000n);
  assert.equal(moveSource(wallets, { walletId: "wal", toAgent: false, token: "MON" }), null);
});

test("a wallet the list does not hold has no source", () => {
  assert.equal(moveSource(walletsDto(), { walletId: "gone", toAgent: false, token: "AUSD" }), null);
});

test("a move's body has master on exactly one side, by direction, and the amount trimmed", () => {
  assert.deepEqual(moveBody({ walletId: "wal", toAgent: true, token: "AUSD" }, " 5 "), {
    from: "master",
    to: "wal",
    token: "AUSD",
    amount: "5",
  });
  assert.deepEqual(moveBody({ walletId: "wal", toAgent: false, token: "MON" }, "0.1"), {
    from: "wal",
    to: "master",
    token: "MON",
    amount: "0.1",
  });
});

test("a move opens only for an amount within what the source holds", () => {
  const input = { token: "AUSD" as const, toAgent: true, agentName: "Halftime" };
  assert.equal(canMove({ ...input, amount: "5", held: 5_000_000n }), true);
  assert.equal(canMove({ ...input, amount: "5.000001", held: 5_000_000n }), false);
  assert.equal(canMove({ ...input, amount: "", held: 5_000_000n }), false);
  assert.equal(canMove({ ...input, amount: "0", held: 5_000_000n }), false);
  assert.equal(canMove({ ...input, amount: "1", held: null }), false);
});

test("MAX is exactly what the source holds, every decimal kept", () => {
  assert.equal(exactUnits(1_234_567n, "AUSD"), "1.234567");
  assert.equal(exactUnits(5_000_000n, "AUSD"), "5");
  assert.equal(exactUnits(1n, "MON"), "0.000000000000000001");
  assert.equal(exactUnits(0n, "MON"), "0");
  assert.equal(exactUnits(null, "AUSD"), "");
});

test("MAX parses back to the balance and opens the move", () => {
  const held = 1_234_567n;
  assert.equal(parseAmount(exactUnits(held, "AUSD"), "AUSD"), held);
  assert.equal(
    canMove({
      amount: exactUnits(held, "AUSD"),
      token: "AUSD",
      toAgent: false,
      held,
      agentName: "Halftime",
    }),
    true,
  );
});

test("the move's note says which side holds what, and that positions stay on a pull", () => {
  assert.equal(
    moveNote({ toAgent: true, held: 50_000_000n, token: "AUSD" }),
    "MASTER HOLDS 50 AUSD · ONE TOKEN PER TRANSACTION",
  );
  assert.equal(
    moveNote({ toAgent: false, held: 3_000_000n, token: "AUSD" }),
    "IT HOLDS 3 AUSD · ONE TOKEN PER TRANSACTION · OPEN POSITIONS STAY",
  );
});

test("the transfer sheet names the amount, the agent and both sides", () => {
  const address = "0x91be00000000000000000000000000000000a07";
  assert.deepEqual(
    moveSheetCopy({ amount: " 5 ", token: "AUSD", toAgent: true, agentName: "Halftime", address }),
    {
      title: "Move 5 AUSD to Halftime?",
      body: "MASTER → 0x91be…0a07 · ONE TRANSACTION",
      done: "Moved",
    },
  );
  assert.deepEqual(
    moveSheetCopy({ amount: "0.1", token: "MON", toAgent: false, agentName: "Halftime", address }),
    {
      title: "Move 0.1 MON back to master?",
      body: "0x91be…0a07 → MASTER · ONE TRANSACTION",
      done: "Moved",
    },
  );
});

test("an address is shortened to its first six and last four", () => {
  assert.equal(shortAddress("0x91be00000000000000000000000000000000a07"), "0x91be…0a07");
});

test("an agent wallet is CREATING until an agent has it, then DRAFT", () => {
  assert.equal(agentWalletTag(walletsDto().agents[0]!), "CREATING");
  assert.equal(agentWalletTag(walletsDto({ agentId: "agt" }).agents[0]!), "DRAFT");
});

test("an agent wallet is named for its agent, else for the agent being created on it", () => {
  const linked = walletsDto({ agentId: "agt", agentName: "Overtime" }).agents[0]!;
  const unlinked = walletsDto().agents[0]!;
  assert.equal(walletName(linked, { walletId: "wal", name: "Halftime" }), "Overtime");
  assert.equal(walletName(unlinked, { walletId: "wal", name: " Halftime " }), "Halftime");
  assert.equal(walletName(unlinked, { walletId: "wal", name: "" }), "Your new agent");
  assert.equal(walletName(unlinked, null), "Your new agent");
});

test("MAX on AUSD is the whole balance", () => {
  assert.equal(maxAmount(1_234_567n, "AUSD"), "1.234567");
});

test("MAX on MON keeps 0.01 MON back for the network fee", () => {
  assert.equal(MON_GAS_RESERVE_WEI, 10_000_000_000_000_000n);
  assert.equal(maxAmount(2_000_000_000_000_000_000n, "MON"), "1.99");
});

test("MAX on MON at or below the reserve is 0", () => {
  assert.equal(maxAmount(10_000_000_000_000_000n, "MON"), "0");
  assert.equal(maxAmount(1n, "MON"), "0");
});

test("MAX on an unread balance fills nothing", () => {
  assert.equal(maxAmount(null, "MON"), "");
});

test("a move still opens up to the whole MON balance: the reserve is only MAX's", () => {
  const held = 2_000_000_000_000_000_000n;
  const input = { token: "MON" as const, toAgent: true, held, agentName: "Halftime" };
  assert.equal(canMove({ ...input, amount: "2" }), true);
});

test("the note says MAX kept MON for gas", () => {
  assert.equal(
    moveNote({ toAgent: true, held: 2_000_000_000_000_000_000n, token: "MON", keptForGas: true }),
    "MASTER HOLDS 2 MON · ONE TOKEN PER TRANSACTION · KEEPS 0.01 MON FOR GAS",
  );
});

test("a decimal comma is a point: 1,5 is 1.5, never 15", () => {
  assert.equal(cleanAmount("1,5"), "1.5");
  assert.equal(parseAmount(cleanAmount("1,5"), "AUSD"), 1_500_000n);
});

test("an amount keeps only digits and the point", () => {
  assert.equal(cleanAmount(" 12a.3$ "), "12.3");
});

test("a closed prompt before the stamp is a cancellation the sheet can retry", () => {
  assert.equal(failedTransfer({ closedPrompt: true, code: "", stamped: false }), "cancelled");
});

test("a cancellation-type error after the stamp is an unknown outcome, not a cancellation", () => {
  assert.equal(failedTransfer({ closedPrompt: true, code: "", stamped: true }), "failed");
});

test("an already recorded transfer went through", () => {
  const input = { closedPrompt: false, code: "TRANSFER_ALREADY_RECORDED", stamped: true };
  assert.equal(failedTransfer(input), "done");
});

test("before the stamp, the studio's message for any code is shown", () => {
  const message = transferFailure({
    sessionExpired: false,
    studio: { code: "SOMETHING_NEW", message: "The server's words." },
    stamped: false,
  });
  assert.equal(message, "The server's words.");
});

test("after the stamp, a known code still speaks for itself", () => {
  const message = transferFailure({
    sessionExpired: false,
    studio: { code: "NONCE_GAP", message: "The studio's nonce message." },
    stamped: true,
  });
  assert.equal(message, "The studio's nonce message.");
});

test("after the stamp, an unknown code may have gone through: check the balances", () => {
  const message = transferFailure({
    sessionExpired: false,
    studio: { code: "502", message: "Bad gateway" },
    stamped: true,
  });
  assert.equal(message, "It may have gone through. Check the balances above before sending again.");
});

test("after the stamp, a network error may have gone through too", () => {
  const message = transferFailure({ sessionExpired: false, studio: null, stamped: true });
  assert.equal(message, "It may have gone through. Check the balances above before sending again.");
});

test("before the stamp, a network error moved nothing", () => {
  const message = transferFailure({ sessionExpired: false, studio: null, stamped: false });
  assert.equal(message, "It did not go through. Nothing moved.");
});

test("an expired sign-in moved nothing", () => {
  const message = transferFailure({ sessionExpired: true, studio: null, stamped: false });
  assert.equal(message, "Your sign-in expired. Sign in again; nothing moved.");
});

const MAY_HAVE = "It may have gone through. Check the balances above before sending again.";
const afterStamp = (code: string) =>
  transferFailure({
    sessionExpired: false,
    studio: { code, message: `words for ${code}` },
    stamped: true,
  });

test("after the stamp, each code that guarantees no broadcast speaks for itself", () => {
  const safe = [
    "INVALID_TRANSFER",
    "INSUFFICIENT_FUNDS",
    "INSUFFICIENT_GAS",
    "FEE_TOO_HIGH",
    "NONCE_GAP",
    "WALLET_NOT_FOUND",
    "INVALID_SIGNED_ACTIVITY",
    "SIGNED_ACTIVITY_REJECTED",
  ];
  assert.deepEqual([...POST_STAMP_SAFE].sort(), [...safe].sort());
  for (const code of safe) {
    assert.equal(afterStamp(code), `words for ${code}`);
  }
});

test("after the stamp, a known code that may have broadcast is an unknown outcome", () => {
  for (const code of ["WALLETS_UNAVAILABLE", "SIGNING_UNAVAILABLE", "NOT_SENDABLE"]) {
    assert.equal(afterStamp(code), MAY_HAVE);
  }
});

test("before the stamp, an unavailable backend's own message is shown", () => {
  const message = transferFailure({
    sessionExpired: false,
    studio: { code: "WALLETS_UNAVAILABLE", message: "words" },
    stamped: false,
  });
  assert.equal(message, "words");
});
