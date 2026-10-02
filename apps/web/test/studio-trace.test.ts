import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunEvent } from "../src/features/studio/api";
import { shortAddress, traceLines } from "../src/features/studio/home/trace";

/* A run's trace in words, as the studio home's status line and Activity read it. */

const event = (id: number, type: string, data: unknown): RunEvent => ({
  id,
  type,
  data,
  createdAt: 1_000 + id * 1_000,
});
const entries = (...fired: boolean[]) =>
  fired.map((value, i) => ({ rule: `rule ${i + 1}`, fired: value, why: "because" }));

test("a trace leaves out token counts and names a search by its query", () => {
  const lines = traceLines(
    [
      { id: 1, type: "model_step_usage", data: {}, createdAt: 1000 },
      { id: 2, type: "search_query", data: { query: "chiefs injury report" }, createdAt: 3100 },
    ],
    1000,
  );

  assert.deepEqual(lines, [
    { id: 2, text: "Searched “chiefs injury report”", meta: "2.1s", tint: "amber" },
  ]);
});

test("the brief line says which entries fired and how many held", () => {
  const lines = traceLines(
    [
      event(1, "brief_evaluation", { entries: entries(true, true, false) }),
      event(2, "brief_evaluation", { entries: entries(false, false) }),
      event(3, "brief_evaluation", { entries: entries(true) }),
    ],
    1_000,
  );
  assert.deepEqual(
    lines.map((line) => [line.text, line.tint]),
    [
      ["Entry 1 and 2 fired · 1 held", "blue"],
      ["Checked 2 entries · none fired", "magenta"],
      ["Entry 1 fired", "blue"],
    ],
  );
});

test("an address is shortened to its ends", () => {
  assert.equal(shortAddress("0x7a3f00000000000000000000000000000091c2"), "0x7a3f…91c2");
});
