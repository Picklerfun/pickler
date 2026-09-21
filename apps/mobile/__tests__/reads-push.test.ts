import readJson from "./fixtures/reads/read.json";
import { localResolutionContent, patchForPush, pushEnvFor, pushTargetOf } from "../src/reads/push";
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

test("a read push opens My reads on that read; a reminder opens Trade (P7)", () => {
  expect(patchForPush({ kind: "read", readId: "r1", marketId: 16 })).toEqual({ perpsMarketId: 16, marketTab: "ask", askView: "mine", askFocusReadId: "r1" });
  expect(patchForPush({ kind: "reminder", reminderId: "m1", marketId: 64, readId: null })).toEqual({ perpsMarketId: 64, marketTab: "trade" });
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
