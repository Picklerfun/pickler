import readJson from "./fixtures/reads/read.json";
import { parseAgentsList, parseRead, parseReadResponse, parseReadsList } from "../src/reads/types";

test("parseRead reads the DTO of F1 verbatim", () => {
  const r = parseRead(readJson);
  expect(r).toMatchObject({ id: "1fde46c6-97da-4435-8184-59b5218a771d", agentId: "jesus", marketId: 16, symbol: "BTC", priceDecimals: 1, levelBps: 100, horizonMin: 60, markAtRequest: 804425, target: 812469, status: "open", probability: 0.07, creditsCharged: 1, error: null, resolvedAt: null, markAtResolution: null, outcome: null, brier: null });
  expect(r.reasons).toHaveLength(3);
  expect(r.limits).toMatch(/invalidate/);
  expect(r.expiresAt).toBe("2026-09-20T07:35:06.712Z");
});

test("parseRead accepts a resolved and a failed read", () => {
  const right = parseRead({ ...readJson, status: "right", resolvedAt: "2026-09-20T07:36:00.000Z", markAtResolution: 812470, outcome: true, brier: 0.8649 });
  expect(right).toMatchObject({ status: "right", markAtResolution: 812470, outcome: true, brier: 0.8649 });
  const failed = parseRead({ ...readJson, status: "failed", probability: null, reasons: null, limits: null, error: "timeout" });
  expect(failed).toMatchObject({ status: "failed", probability: null, reasons: null, error: "timeout" });
});

test.each([
  ["not an object", null],
  ["unknown status", { ...readJson, status: "maybe" }],
  ["level outside the matrix", { ...readJson, levelBps: 75 }],
  ["probability out of range", { ...readJson, probability: 1.2 }],
  ["reasons not strings", { ...readJson, reasons: [1, 2, 3] }],
  ["missing expiresAt", { ...readJson, expiresAt: undefined }],
  ["expiresAt not ISO", { ...readJson, expiresAt: "tomorrow" }],
])("parseRead throws on %s", (_, body) => {
  expect(() => parseRead(body)).toThrow(/Reads API/);
});

test("parseReadResponse and parseReadsList carry the credits", () => {
  expect(parseReadResponse({ read: readJson, credits: 19 })).toMatchObject({ credits: 19, read: { id: readJson.id } });
  const list = parseReadsList({ reads: [readJson, readJson], credits: 18 });
  expect(list.reads).toHaveLength(2);
  expect(list.credits).toBe(18);
  expect(() => parseReadsList({ reads: "x", credits: 1 })).toThrow(/Reads API/);
  expect(() => parseReadResponse({ read: readJson, credits: "19" })).toThrow(/Reads API/);
});

test("parseAgentsList reads the record and keeps the server order", () => {
  const agents = parseAgentsList({ agents: [
    { id: "jesus", handle: "jesus", name: "Jesús's agent", owner: "Jesús", priceCredits: 1, record: { reads: 1, resolved: 0, right: 0, brierAvg: null } },
    { id: "drift", handle: "drift", name: "Drift", owner: "Pickler", priceCredits: 1, record: { reads: 2, resolved: 1, right: 1, brierAvg: 0.0144 } },
  ] });
  expect(agents.map((a) => a.id)).toEqual(["jesus", "drift"]);
  expect(agents[1].record).toEqual({ reads: 2, resolved: 1, right: 1, brierAvg: 0.0144 });
  expect(() => parseAgentsList({ agents: [{ id: "x" }] })).toThrow(/Reads API/);
});
