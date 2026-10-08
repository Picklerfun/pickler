import test from "node:test";
import assert from "node:assert/strict";
import { PilotError } from "@pickler/core";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
} from "@pickler/infrastructure";
import {
  createPerpsStudyRunner,
  perpsStrategies,
  perpsCallCost,
  assertPerpsStudyConfig,
  type PerpsOriginalSmaConfig,
} from "@pickler/trading/evaluation";
import { createPerpsStudyModels } from "@pickler/agent-runtime/composition/perps-study-model";
import { perpsStudyReport, renderPerpsReport } from "../src/perps-study/report.js";
import { studyEvidence } from "./perps-study-fixtures.js";
const config: PerpsOriginalSmaConfig = {
  version: 3,
  protocol: "perps-original-sma-v1",
  tenantId: "alpha",
  sessionId: "original-sma",
  network: "mainnet",
  hours: 24,
  budgetUsd: "5",
};

test("original SMA is one arm and cannot construct or reserve models", () => {
  assert.deepEqual(perpsStrategies(config), ["rules"]);
  assertPerpsStudyConfig(config);
  const disabled = (error: unknown) =>
    error instanceof PilotError && error.code === "MODELS_DISABLED";
  assert.throws(() => perpsCallCost(config, "direct", 1, 1), disabled);
  assert.throws(
    () =>
      createPerpsStudyModels(config, { deepseek: "", jev: "" }, async () => {
        throw new Error("Must never call transport");
      }),
    disabled,
  );
  assert.throws(() =>
    assertPerpsStudyConfig({ ...config, deepseek: {} } as unknown as PerpsOriginalSmaConfig),
  );
});

for (const side of ["long", "short"] as const) {
  test(`original SMA opens ${side}, closes at four hours, and never reopens in that slot`, async (t) => {
    let now = 1800000000000;
    const research = await createTestStore(t, () => now);
    const study = new PostgresPerpsStudyStore(research.pool, () => now);
    const paper = new PostgresPerpsPaperStore(research.pool, () => now);
    const initialized = await study.initialize(config, { acquisitionPolicy: "rest-paced-20s-v1" });
    assert.deepEqual(Object.keys(initialized.record.agentIds), ["rules"]);
    const lease = await study.claim(config);
    const evidence = () => {
      const result = studyEvidence(now);
      if (side === "short") {
        for (const series of result.candles) {
          for (const candle of series.candles.slice(-20)) {
            candle.close = "99";
          }
        }
      }
      return result;
    };
    const runner = createPerpsStudyRunner({
      study,
      paper,
      now: () => now,
      data: {
        observe: async () => {
          const e = evidence();
          return {
            frames: e.frames,
            funding: e.frames.map((f) => ({
              market: f.book.market,
              from: initialized.record.createdAt,
              to: now,
              complete: true,
              events: [],
              pages: [f.book.provenance],
            })),
          };
        },
        evidence: async () => evidence(),
        execution: async () => evidence().frames,
      },
    });
    assert.equal(await runner.cycle(config, lease, new AbortController().signal), true);
    const scope = { ...config, agentId: initialized.record.agentIds.rules! };
    let account = await paper.view(scope);
    assert.equal(account.attempts.filter((a) => a.status === "filled").length, 2);
    assert.ok(account.account.positions.every((p) => p.side === side && p.closedAt === null));
    const saved = await study.view(config);
    assert.deepEqual(saved.rounds[0]!.calls, {});
    assert.equal(saved.rounds[0]!.executionStatus, "complete");
    await assert.rejects(
      study.guard(config, lease, true),
      (disabled) => disabled instanceof PilotError && disabled.code === "MODELS_DISABLED",
    );
    await runner.cycle(config, lease, new AbortController().signal);
    assert.equal((await study.view(config)).rounds.length, 1);
    for (let minute = 0; minute < 239; minute++) {
      now += 60000;
      await study.renew(config, lease);
    }
    await runner.cycle(config, lease, new AbortController().signal);
    assert.equal(
      (await paper.view(scope)).account.positions.filter((p) => p.closedAt === null).length,
      2,
    );
    now += 60000;
    await study.renew(config, lease);
    await runner.cycle(config, lease, new AbortController().signal);
    account = await paper.view(scope);
    assert.equal(account.account.positions.filter((p) => p.closedAt === null).length, 0);
    assert.equal(account.attempts.filter((a) => a.status === "filled").length, 4);
    assert.ok(account.movements.some((m) => m.kind === "fee"));
    const packet = await exportPerpsAudit(research.pool, config);
    const report = perpsStudyReport(packet.study, packet.accounts, now);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0]!.modelCalls, 0);
    assert.equal(report.accountedOrReservedUSD, "0");
    assert.ok(renderPerpsReport(report).html.includes("rules"));
    now += 90001;
    await assert.rejects(
      runner.cycle(config, lease, new AbortController().signal),
      (e) => e instanceof PilotError && e.code === "LEASE_LOST",
    );
    await study.release(config, lease);
  });
}
