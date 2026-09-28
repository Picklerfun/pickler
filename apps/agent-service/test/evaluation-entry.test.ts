import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { assertLegacyRead } from "../src/evaluation-host/legacy.js";

test("retired execution entries cannot reach configuration or providers", () => {
  for (const entry of [
    "perps-study/main.ts",
    "paper-study/benchmark-main.ts",
    "paper-study/main.ts",
    "paper-study/quant-main.ts",
    "paper-study/comparison-main.ts",
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", `src/${entry}`, "run", "missing-config.json", "--allow-paid"],
      { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 1, entry);
    assert.match(result.stderr, /EVALUATION_ENTRY_RETIRED/, entry);
    assert.doesNotMatch(result.stderr, /ENOENT/, entry);
  }
});
test("historical read and reconciliation remain allowed; new evaluation is rejected", () => {
  for (const command of ["report", "settle"]) {
    assert.doesNotThrow(() => assertLegacyRead(command, ["report", "settle"]));
  }
  for (const command of ["run", "prepare", "evaluate", undefined]) {
    assert.throws(
      () => assertLegacyRead(command, ["report", "settle"]),
      /EVALUATION_ENTRY_RETIRED/,
    );
  }
});
