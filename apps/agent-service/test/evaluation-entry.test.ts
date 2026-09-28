import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
test("legacy evaluation commands and executable files are removed", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of [
    "paper:study",
    "paper:quant",
    "paper:compare",
    "paper:benchmark",
    "perps:study",
  ]) {
    assert.equal(manifest.scripts[name], undefined);
  }
  for (const file of [
    "paper-study/main.ts",
    "paper-study/quant-main.ts",
    "paper-study/comparison-main.ts",
    "paper-study/benchmark-main.ts",
    "perps-study/main.ts",
  ]) {
    await assert.rejects(access(new URL("../src/" + file, import.meta.url)));
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

test("historical report preserves reservations and rejects mismatched identity", async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { runHistoricalEvaluation } = await import("../src/evaluation-host/history.js");
  const root = await mkdtemp(join(tmpdir(), "historical-evaluation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    version: 2,
    protocol: "btc-quant-jev-v1",
    id: "frozen",
    plugins: ["polymarket", "coinbase", "jev"],
    jevInputPerMillion: 0.1,
    maxNewReservedUsd: 0.1,
    historicalStudies: [],
  };
  const state = {
    ...config,
    createdAt: 0,
    deadline: 100,
    settlementDeadline: 200,
    priorReservedUsd: 0.07,
    cases: [],
    paidStopped: true,
  };
  const directory = join(root, "frozen");
  await mkdir(directory);
  await writeFile(join(directory, "state.json"), JSON.stringify(state));
  await writeFile(join(directory, "STOP"), "PRESERVE");
  await runHistoricalEvaluation("report", config, root, new AbortController().signal);
  const saved = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.equal(saved.priorReservedUsd, 0.07);
  assert.equal(saved.paidStopped, true);
  assert.equal(await readFile(join(directory, "STOP"), "utf8"), "PRESERVE");
  await writeFile(join(directory, "state.json"), JSON.stringify({ ...state, id: "other" }));
  await assert.rejects(
    runHistoricalEvaluation("settle", config, root, new AbortController().signal),
    { code: "HISTORICAL_STATE_MISMATCH" },
  );
});
