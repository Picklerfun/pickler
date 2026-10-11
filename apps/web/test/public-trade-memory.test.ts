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
