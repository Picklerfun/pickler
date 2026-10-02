import { calibration, recordFor } from "../src/reads/calibration";
import type { Read } from "../src/reads/types";

const base: Read = {
  id: "r", agentId: "drift", marketId: 1, symbol: "BTC", priceDecimals: 1, levelBps: 100, horizonMin: 240, markAtRequest: 762555, target: 770181,
  question: "q", status: "open", probability: 0.5, reasons: null, limits: null, creditsCharged: 1, error: null,
  createdAt: "2026-09-28T10:00:00Z", expiresAt: "2026-09-28T14:00:00Z", resolvedAt: null, markAtResolution: null, outcome: null, brier: null,
};
const r = (id: string, p: Partial<Read>): Read => ({ ...base, id, ...p });
const resolved = (id: string, probability: number, outcome: boolean): Read => r(id, { status: outcome === probability >= 0.5 ? "right" : "wrong", probability, outcome });

test("fewer than 5 resolved reads → empty state (null)", () => {
  expect(calibration([resolved("a", 0.1, false), resolved("b", 0.3, false), resolved("c", 0.5, true), resolved("d", 0.9, true)])).toBeNull();
});

test("open, void and failed reads do not count (Review Focus 2)", () => {
  const four = [resolved("a", 0.1, false), resolved("b", 0.3, false), resolved("c", 0.5, true), resolved("d", 0.9, true)];
  expect(calibration([...four, r("o", { status: "open" }), r("v", { status: "void" }), r("f", { status: "failed", probability: null })])).toBeNull();
});

test("5 buckets of 0.2; boundaries go up; 1.0 falls in the last (Review Focus 2)", () => {
  const b = calibration([resolved("a", 0.2, false), resolved("b", 0.25, true), resolved("c", 1, true), resolved("d", 0.85, false), resolved("e", 0.05, false)])!;
  expect(b.map((x) => x.n)).toEqual([1, 2, 0, 0, 2]);
  expect(b[1]).toEqual({ lo: 0.2, hi: 0.4, promised: 0.3, actual: 0.5, n: 2 });
  expect(b[2].actual).toBeNull();
  expect(b[4].actual).toBe(0.5);
  expect(b[0].promised).toBeCloseTo(0.1);
});

test("record: only this agent, newest first as given, filtered", () => {
  const list = [r("1", { status: "right" }), r("2", { status: "wrong" }), r("3", { status: "open" }), r("4", { agentId: "anchor" }), r("5", { status: "void" })];
  expect(recordFor(list, "drift", "all")!.map((x) => x.id)).toEqual(["1", "2", "3", "5"]);
  expect(recordFor(list, "drift", "right")!.map((x) => x.id)).toEqual(["1"]);
  expect(recordFor(list, "drift", "wrong")!.map((x) => x.id)).toEqual(["2"]);
  expect(recordFor(list, "drift", "open")!.map((x) => x.id)).toEqual(["3"]);
  expect(recordFor(null, "drift", "all")).toBeNull();
});
