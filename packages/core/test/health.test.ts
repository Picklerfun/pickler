import { test } from "node:test";
import assert from "node:assert/strict";
import { createGetHealth } from "../src/index.js";

test("health uses the injected clock without a framework or infrastructure runtime", () => {
  const instant = new Date("2026-01-01T00:00:00Z");
  const getHealth = createGetHealth({ now: () => instant });
  assert.deepEqual(getHealth(), { status: "ok", checkedAt: instant });
});
