import assert from "node:assert/strict";
import test from "node:test";
import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
import type { PublicTradeAttempt } from "../src/features/wallet/lib/public-trade-memory";
import {
  runPublicTokenTrade,
  waitForPublicTradeReceipt,
  PUBLIC_CONFIRMATION_LIMITS,
} from "../src/features/wallet/lib/public-trade-flow";
import { WalletSubmissionUnknown } from "../src/features/wallet/lib/public-token-transaction";

const hash = "0x" + "a".repeat(64);
const swapHash = "0x" + "b".repeat(64);
function prepared(approval: boolean): PublicTokenTradePreparedDto {
  return {
    version: 1,
    token: "0x" + "1".repeat(40),
    curve: "0x" + "2".repeat(40),
    quoteToken: "0x" + "3".repeat(40),
    expiresAt: new Date(Date.now() + 290_000).toISOString(),
    quote: {
      side: "buy",
      amount: "1000000",
      slippageBps: 50,
      approval,
      expectedOutput: "1000",
      minimumOutput: "995",
      balance: "2000000",
      allowance: "0",
      feeBps: 100,
    },
    transaction: {
      from: "0x" + "4".repeat(40),
      to: "0x" + "2".repeat(40),
      chainId: 10143,
      nonce: approval ? 0 : 1,
      data: "0x01",
      value: "0x0",
      gas: "0x10000",
      maxFeePerGas: "0x3",
      maxPriorityFeePerGas: "0x1",
    },
  };
}
class Page extends EventTarget {
  hidden = false;
  hide(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
const flush = async () => {
  for (let i = 0; i < 15; i += 1) {
    await Promise.resolve();
  }
};

test("one click advances through approval and swap, waiting for each receipt before proceeding", async () => {
  const events: string[] = [];
  const saved: PublicTradeAttempt[] = [];
  const result = await runPublicTokenTrade({
    prepared: prepared(true),
    signal: new AbortController().signal,
    prepareNext: async () => {
      events.push("prepare swap");
      return prepared(false);
    },
    send: async (tx) => {
      events.push(tx.quote.approval ? "approve" : "buy");
      return tx.quote.approval ? hash : swapHash;
    },
    receipt: async (tx) => {
      events.push(tx === hash ? "approval receipt" : "swap receipt");
      return "confirmed";
    },
    keep: (attempt) => saved.push(attempt),
  });
  assert.equal(result, "confirmed");
  assert.deepEqual(events, ["approve", "approval receipt", "prepare swap", "buy", "swap receipt"]);
  assert.equal(saved.at(-1)?.hash, swapHash);
  assert.equal(saved.at(-1)?.status, "confirmed");
});

test("unknown sends with a hash reconcile that same transaction without rebroadcast", async () => {
  let sends = 0;
  let latest: PublicTradeAttempt | undefined;
  const result = await runPublicTokenTrade({
    prepared: prepared(false),
    signal: new AbortController().signal,
    prepareNext: async () => {
      throw new Error("unexpected preparation");
    },
    send: async () => {
      sends += 1;
      throw new WalletSubmissionUnknown(swapHash);
    },
    receipt: async (tx) => {
      assert.equal(tx, swapHash);
      return "confirmed";
    },
    keep: (value) => {
      latest = value;
    },
  });
  assert.equal(sends, 1);
  assert.equal(result, "confirmed");
  assert.equal(latest?.hash, swapHash);
});

test("missing hash, refusal, revert and pending approval never advance to another send", async () => {
  for (const outcome of ["unknown", "cancel", "reverted", "pending"] as const) {
    let sends = 0;
    let preparations = 0;
    let latest: PublicTradeAttempt | undefined;
    const run = runPublicTokenTrade({
      prepared: prepared(true),
      signal: new AbortController().signal,
      prepareNext: async () => {
        preparations += 1;
        return prepared(false);
      },
      send: async () => {
        sends += 1;
        if (outcome === "unknown") {
          throw new WalletSubmissionUnknown(null);
        }
        if (outcome === "cancel") {
          throw Object.assign(new Error("cancelled"), { code: 4001 });
        }
        return hash;
      },
      receipt: async () => (outcome === "reverted" ? "reverted" : "pending"),
      keep: (value) => {
        latest = value;
      },
    });
    if (outcome === "unknown" || outcome === "cancel") {
      await assert.rejects(run);
    } else {
      assert.equal(await run, outcome);
    }
    assert.equal(sends, 1);
    assert.equal(preparations, 0);
    assert.equal(
      latest?.status,
      outcome === "unknown"
        ? "unknown"
        : outcome === "cancel"
          ? "review"
          : outcome === "pending"
            ? "confirming"
            : "reverted",
    );
  }
});

test("a worse refreshed minimum requires explicit review; altered follow-up never sends", async () => {
  for (const change of ["minimum", "wallet", "amount", "curve", "approval"] as const) {
    let sends = 0;
    const next = prepared(false);
    if (change === "minimum") {
      next.quote.minimumOutput = "900";
    }
    if (change === "wallet") {
      next.transaction.from = "0x" + "5".repeat(40);
    }
    if (change === "amount") {
      next.quote.amount = "2000000";
    }
    if (change === "curve") {
      next.curve = next.token;
    }
    if (change === "approval") {
      next.quote.approval = true;
    }
    const run = runPublicTokenTrade({
      prepared: prepared(true),
      signal: new AbortController().signal,
      prepareNext: async () => next,
      send: async () => {
        sends += 1;
        return hash;
      },
      receipt: async () => "confirmed",
      keep() {},
    });
    if (change === "minimum") {
      assert.equal(await run, "review");
    } else {
      await assert.rejects(run);
    }
    assert.equal(sends, 1);
  }
});

test("leaving during a wallet prompt preserves its eventual hash but never continues", async () => {
  const controller = new AbortController();
  let latest: PublicTradeAttempt | undefined;
  let reads = 0;
  const run = runPublicTokenTrade({
    prepared: prepared(true),
    signal: controller.signal,
    prepareNext: async () => {
      throw new Error("unexpected preparation");
    },
    send: async () => {
      controller.abort();
      return hash;
    },
    receipt: async () => {
      reads += 1;
      return "confirmed";
    },
    keep: (value) => {
      latest = value;
    },
  });
  await assert.rejects(run);
  assert.equal(latest?.hash, hash);
  assert.equal(latest?.status, "confirming");
  assert.equal(reads, 0);
});

test("transient receipt failures recover automatically with serial reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const result = waitForPublicTradeReceipt({
    signal: new AbortController().signal,
    page: new Page(),
    read: async () => {
      reads += 1;
      if (reads === 1) {
        throw new Error("offline");
      }
      return reads < 3 ? "pending" : "confirmed";
    },
  });
  await flush();
  t.mock.timers.tick(3000);
  await flush();
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(await result, "confirmed");
  assert.equal(reads, 3);
});

test("observation pauses in hidden pages, aborts on navigation and never overlaps", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = new Page();
  const controller = new AbortController();
  let reads = 0;
  let finish!: (result: "pending") => void;
  page.hide(true);
  const result = waitForPublicTradeReceipt({
    signal: controller.signal,
    page,
    read: () => {
      reads += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await flush();
  assert.equal(reads, 0);
  page.hide(false);
  await flush();
  assert.equal(reads, 1);
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(reads, 1);
  controller.abort();
  finish("pending");
  await assert.rejects(result);
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(reads, 1);
});

test("receipt observation stops at its finite read ceiling, leaving the original hash untouched", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const result = waitForPublicTradeReceipt({
    signal: new AbortController().signal,
    page: new Page(),
    read: async () => {
      reads += 1;
      return "pending";
    },
  });
  await flush();
  for (let i = 1; i < PUBLIC_CONFIRMATION_LIMITS.reads; i += 1) {
    t.mock.timers.tick(3000);
    await flush();
  }
  assert.equal(await result, "pending");
  assert.equal(reads, 30);
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(reads, 30);
});
