import readJson from "./fixtures/reads/read.json";
import { localReminderContent, localResolutionContent, pushEnvFor, pushTarget, pushTargetOf } from "../src/reads/push";
import { parseRead } from "../src/reads/types";

const READ = { kind: "read", readId: "1fde46c6-97da-4435-8184-59b5218a771d", marketId: 16 };

test("the target comes from data.pickler, from data itself, or from the raw iOS payload (P7)", () => {
  expect(pushTargetOf({ pickler: READ })).toEqual(READ);
  expect(pushTargetOf(READ)).toEqual(READ);
  expect(pushTargetOf({}, { aps: { alert: {} }, pickler: READ })).toEqual(READ);
  expect(pushTargetOf(undefined, null, { aps: {} })).toBeNull();
  expect(pushTargetOf({ pickler: { kind: "read", readId: 5, marketId: 16 } })).toBeNull();
  expect(pushTargetOf({ pickler: { kind: "reminder", reminderId: "m1", marketId: 16, readId: null } })).toEqual({ kind: "reminder", reminderId: "m1", marketId: 16, readId: null });
});

test("a read push opens the Read screen on that read; a reminder opens Market on Trade (D22)", () => {
  expect(pushTarget({ kind: "read", readId: "r1", marketId: 3 })).toEqual({ screen: "read", patch: { readId: "r1", perpsMarketId: 3 } });
  expect(pushTarget({ kind: "reminder", reminderId: "m1", marketId: 3, readId: null })).toEqual({ screen: "market", patch: { perpsMarketId: 3, marketTab: "trade" } });
});

test("sandbox in __DEV__, production otherwise (D10)", () => {
  expect(pushEnvFor(true)).toBe("sandbox");
  expect(pushEnvFor(false)).toBe("production");
});

test("the local fallback names the cell and carries the same data as the server push (P5)", () => {
  const c = localResolutionContent(parseRead(readJson));
  expect(c.title).toBe("BTC +1.0% · 1H");
  expect(c.body).toBe("Your read has resolved — open Pickler to see if the agent was right.");
  expect(c.data).toEqual({ pickler: READ });
});

test("localReminderContent (fallback D10) names the level and never claims a mark", () => {
  const level = { marketId: 16, levelBps: 100, horizonMin: 240, target: 766368, expiresAt: "2026-09-22T22:00:00.000Z", readId: "1fde46c6-97da-4435-8184-59b5218a771d" };
  const pre = localReminderContent("BTC", level, "pre");
  expect(pre.title).toBe("BTC +1.0% · 4H");
  expect(pre.body).toBe("Your level resolves in 15 min — check your position on Perpl.");
  expect(pre.data).toEqual({ pickler: { kind: "reminder", reminderId: "local-pre-2026-09-22T22:00:00.000Z", marketId: 16, readId: level.readId } });
  const expiry = localReminderContent("BTC", { ...level, readId: undefined }, "expiry");
  expect(expiry.body).toBe("Your level resolves now — check your position on Perpl.");
  expect(expiry.data).toEqual({ pickler: { kind: "reminder", reminderId: "local-expiry-2026-09-22T22:00:00.000Z", marketId: 16, readId: null } });
  expect(pushTargetOf(pre.data)).toEqual({ kind: "reminder", reminderId: "local-pre-2026-09-22T22:00:00.000Z", marketId: 16, readId: level.readId });
});

test("a reminder push still opens Trade without a level (P9 of F3: the push carries no target)", () => {
  expect(pushTarget({ kind: "reminder", reminderId: "m1", marketId: 16, readId: null })).toEqual({ screen: "market", patch: { perpsMarketId: 16, marketTab: "trade" } });
});
