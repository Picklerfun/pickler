import { adviceAmount, analysisTime, elapsedLabel, holdsFlow, splitLine } from "../src/advice/copy";

test("a price keeps every decimal it has and at least two", () => {
  expect(adviceAmount(1_500_000n)).toBe("1.50");
  expect(adviceAmount(100_000_000n)).toBe("100.00");
  expect(adviceAmount(1_234_567n)).toBe("1.234567");
  expect(adviceAmount(100_000n)).toBe("0.10");
});

test("the split names the creator's handle and Pickler", () => {
  expect(splitLine("mira")).toBe("65% to @mira · 35% to Pickler");
});

test("elapsed time is m:ss and never negative", () => {
  expect(elapsedLabel(0, 42_900)).toBe("0:42");
  expect(elapsedLabel(0, 125_000)).toBe("2:05");
  expect(elapsedLabel(10_000, 0)).toBe("0:00");
});

test("an analysis time reads like a movement's", () => {
  expect(analysisTime("2026-10-12T10:01:00.000Z")).toMatch(/^OCT 1[23], \d{2}:\d{2}$/);
});

test("only an Ask in flight, or paid and unresolved, holds the screen of another agent", () => {
  const quote = { agent: { id: "a" }, symbol: "BTC", total: 1n, creator: 0n, protocol: 1n, recipient: "0x0" } as never;
  for (const s of [
    { kind: "quoting" }, { kind: "signing", quote }, { kind: "paying", quote }, { kind: "waiting", jobId: "j", since: 0, settlement: null },
    { kind: "timeout", jobId: "j", settlement: null }, { kind: "settlement_pending", checking: false }, { kind: "busy", retrying: false },
    { kind: "offline", paid: true },
  ] as const) expect(holdsFlow(s)).toBe(true);
  for (const s of [
    { kind: "idle" }, { kind: "off" }, { kind: "confirming", quote }, { kind: "offline", paid: false }, { kind: "untrusted" },
    { kind: "refused", error: "expired", nothingCharged: true, faucet: false }, { kind: "price_changed", shown: 1n, price: 2n },
  ] as const) expect(holdsFlow(s)).toBe(false);
});
