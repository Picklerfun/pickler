import test from "node:test";
import assert from "node:assert/strict";
import { readPublicTrade, writePublicTrade } from "../src/features/wallet/lib/public-trade-memory";
import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
import type { PublicTradeAttempt } from "../src/features/wallet/lib/public-trade-memory";

test("persistence failure before signing blocks sending; after sending it retains the hash", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const stored = new Map<string, string>();
  let fail = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (fail) {
          throw new Error("storage unavailable");
        }
        stored.set(key, value);
      },
      removeItem: (key: string) => stored.delete(key),
    },
  });
  try {
    const decode = (value: unknown) => value as PublicTokenTradePreparedDto;
    // Only storage behavior is under test; the wire payload is validated on restore.
    const review = { prepared: {}, status: "review", hash: null } as PublicTradeAttempt;
    writePublicTrade("before", review);
    fail = true;
    assert.throws(() => writePublicTrade("before", { ...review, status: "submitting" }));
    assert.equal(readPublicTrade("before", decode)?.status, "review");
    fail = false;
    writePublicTrade("after", { ...review, status: "submitting" });
    fail = true;
    const hash = "0x" + "a".repeat(64);
    writePublicTrade("after", { ...review, status: "confirming", hash });
    assert.equal(readPublicTrade("after", decode)?.hash, hash);
    assert.equal(readPublicTrade("after", decode)?.status, "confirming");
    assert.equal(JSON.parse(stored.get("after")!).status, "submitting");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    if (originalStorage) {
      Object.defineProperty(globalThis, "sessionStorage", originalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  }
});

test("restoring receipts preserves both references, reads historical attempts and rejects malformed approvals", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const hash = "0x" + "a".repeat(64);
  const approvalHash = "0x" + "b".repeat(64);
  const stored = new Map<string, string>();
  const review = { prepared: {}, status: "confirming", hash };
  stored.set("receipts", JSON.stringify({ ...review, approvalHash }));
  stored.set("historical", JSON.stringify(review));
  stored.set("malformed", JSON.stringify({ ...review, approvalHash: "not-a-hash" }));
  stored.set(
    "cancelled",
    JSON.stringify({ ...review, status: "cancelled", hash: null, approvalHash }),
  );
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null },
  });
  try {
    const decode = (value: unknown) => value as PublicTokenTradePreparedDto;
    assert.deepEqual(readPublicTrade("receipts", decode), { ...review, approvalHash });
    assert.deepEqual(readPublicTrade("historical", decode), review);
    assert.equal(readPublicTrade("malformed", decode), null);
    assert.equal(readPublicTrade("cancelled", decode)?.approvalHash, approvalHash);
    assert.equal(readPublicTrade("cancelled", decode)?.status, "cancelled");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    if (originalStorage) {
      Object.defineProperty(globalThis, "sessionStorage", originalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  }
});
