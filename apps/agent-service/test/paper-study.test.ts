import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  lockStudy,
  atomicWrite,
  studyConfigSchema,
  renderStudy,
} from "../src/paper-study/files.js";
import type { StudyState } from "@pickler/trading/strategies";
test("single writer lock and atomic artifact persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pickler-study-test-"));
  try {
    const release = await lockStudy(dir);
    await assert.rejects(lockStudy(dir), /STUDY_LOCKED/);
    await atomicWrite(join(dir, "state.json"), '{"version":1}');
    assert.equal(await readFile(join(dir, "state.json"), "utf8"), '{"version":1}');
    await release();
    await (
      await lockStudy(dir)
    )();
  } finally {
    await rm(dir, { recursive: true });
  }
});
test("configuration rejects duplicate groups and unsupported plugins", () => {
  const agent = { kind: "btc-5m", enabled: true, plugins: ["polymarket", "coinbase"] };
  const value = {
    version: 1,
    id: "example",
    hours: 2,
    settlementGraceHours: 24,
    maxCases: 20,
    maxApiUsd: 5,
    pricing: null,
    agents: [agent],
  };
  assert.equal(studyConfigSchema.safeParse(value).success, true);
  assert.equal(studyConfigSchema.safeParse({ ...value, agents: [agent, agent] }).success, false);
  assert.equal(studyConfigSchema.safeParse({ ...value, hours: Infinity }).success, false);
  assert.equal(
    studyConfigSchema.safeParse({ ...value, agents: [{ ...agent, plugins: ["signer"] }] }).success,
    false,
  );
});
test("report escapes external text and labels unrealized results", () => {
  const state = {
    config: { id: "<script>" },
    updatedAt: 0,
    cases: [],
    events: [{ time: 0, kind: "session", code: "<script>alert(1)</script>" }],
  } as unknown as StudyState;
  const report = renderStudy(state);
  assert.ok(!report.html.includes("<script>"));
  assert.match(report.html, /not verified bills/);
  assert.match(report.csv, /Payout virtual/);
});
