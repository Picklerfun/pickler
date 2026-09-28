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

test("canonical entry rejects paid work before provider configuration", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "evaluation-admission-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [protocol, version] of [
    ["perps-comparison-v1", 1],
    ["btc-decision-benchmark-v1", 4],
  ]) {
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({ protocol, version }));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/evaluate.ts", "run", "--config", path],
      { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PAID_OPT_IN_REQUIRED/);
  }
});

test("cancellation during BTC setup releases the study lock before any execution", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runBtcBenchmark } = await import("../src/paper-study/benchmark-host.js");
  const { lockStudy } = await import("../src/paper-study/files.js");
  const directory = await mkdtemp(join(tmpdir(), "evaluation-cancel-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 4,
      protocol: "btc-decision-benchmark-v1",
      id: "cancel-test",
      plugins: ["polymarket", "coinbase", "jev"],
      jevInputPerMillion: 0.1,
      maxNewReservedUsd: 1,
      historicalStudies: [],
    }),
  );
  const controller = new AbortController();
  // runBtcBenchmark reaches its first asynchronous configuration read before cancellation.
  const pending = runBtcBenchmark(["report", path], { root: directory, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  const release = await lockStudy(join(directory, "cancel-test"));
  await release();
});
