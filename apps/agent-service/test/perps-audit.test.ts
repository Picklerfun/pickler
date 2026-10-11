import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { join } from "node:path";
import {
  auditPerpsDecisions,
  canonicalAudit,
  createPerpsStudyRunner,
  perpsJevDecisions,
  perpsJevReviewed,
  type PerpsJevAnswers,
  type PerpsStudyConfig,
  type PerpsModelHooks,
  type PerpsStudyView,
} from "@pickler/trading/evaluation";
import {
  exportPerpsAudit,
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { studyConfig, studyEvidence } from "./perps-study-fixtures.js";
import { runPerpsAudit } from "../src/perps-study/audit.js";

const hash = (v: unknown) => createHash("sha256").update(canonicalAudit(v)).digest("hex");
const config: PerpsStudyConfig = {
  ...studyConfig,
  version: 2,
  protocol: "perps-four-way-v2",
  hours: 2,
  sessionId: "audit-controlled",
};
function answer(choice: string, labels: string[], probability = 1) {
  return {
    choice,
    confidence: 1,
    probabilities: Object.fromEntries(
      labels.map((l) => [l, l === choice ? probability : (1 - probability) / (labels.length - 1)]),
    ),
  };
}
function decisionAnswers(close = false): PerpsJevAnswers {
  return Object.fromEntries(
    (["BTC", "ETH"] as const).flatMap((s) => [
      [
        `${s}_long`,
        answer(
          s === "BTC" ? "SUPPORTED" : "UNSUPPORTED",
          ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "UNKNOWN"],
          0.7,
        ),
      ],
      [
        `${s}_short`,
        answer(
          s === "ETH" ? "SUPPORTED" : "UNSUPPORTED",
          ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "UNKNOWN"],
          0.7,
        ),
      ],
      [
        `${s}_thesis`,
        answer(close ? "INVALIDATED" : "INTACT", ["INVALIDATED", "INTACT", "UNKNOWN"], 0.7),
      ],
    ]),
  );
}
function reviewAnswers(): PerpsJevAnswers {
  return Object.fromEntries(
    ["BTC", "ETH"].flatMap((s) =>
      ["identity", "evidence", "costs"].map((k) => [
        `${s}_${k}`,
        answer("CONSISTENT", ["CONSISTENT", "CONTRADICTED", "UNKNOWN"]),
      ]),
    ),
  );
}

test("read-only export and actual coordinator execute controlled long, short and close in all model arms", async (t) => {
  let now = 1800000000000;
  const db = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(db.pool, () => now);
  const paper = new PostgresPerpsPaperStore(db.pool, () => now);
  await study.initialize(config, { originalCommit: "controlled-not-live" });
  let lease = await study.claim(config);
  let invalidFinal = false;
  let calls = 0;
  const called = async (hooks: PerpsModelHooks) => {
    calls++;
    await hooks.before({ sha256: "a".repeat(64), bytes: 10 });
    await hooks.usage(100, 1);
  };
  const runner = createPerpsStudyRunner({
    study,
    paper,
    now: () => now,
    data: {
      async observe() {
        const e = studyEvidence(now);
        return {
          frames: e.frames,
          funding: e.frames.map((f) => ({
            market: f.book.market,
            from: 1800000000000,
            to: now,
            complete: true,
            events: [],
            pages: [f.book.provenance],
          })),
        };
      },
      async evidence() {
        return studyEvidence(now);
      },
      async execution() {
        const frames = studyEvidence(now).frames;
        if (invalidFinal) {
          frames[1]!.book.provenance.providerTimestamp =
            frames[1]!.book.provenance.providerTimestamp! - 31000;
        }
        return frames;
      },
    },
    models: {
      metadata: {},
      async direct(ctx, _signal, hooks) {
        await called(hooks);
        return (["BTC", "ETH"] as const).map((symbol) => ({
          symbol,
          action: ctx.account.positions.some((p) => p.symbol === symbol && p.closedAt === null)
            ? ("close" as const)
            : symbol === "BTC"
              ? ("open-long" as const)
              : ("open-short" as const),
          reason: "Controlled fixture, not a live model decision",
          sourceIds: [`${symbol}:candles`],
        }));
      },
      async readiness() {
        throw new Error("Legacy path forbidden");
      },
      async decide(ctx, _signal, hooks) {
        await called(hooks);
        const answers = decisionAnswers(ctx.account.positions.some((p) => p.closedAt === null));
        return { answers, proposals: perpsJevDecisions(ctx, answers) };
      },
      async review(_ctx, proposals, _signal, hooks) {
        await called(hooks);
        const answers = reviewAnswers();
        return { answers, proposals: perpsJevReviewed(proposals, answers) };
      },
    },
  });
  await runner.cycle(config, lease, new AbortController().signal);
  await study.release(config, lease);
  now += 900000;
  lease = await study.claim(config);
  await runner.cycle(config, lease, new AbortController().signal);
  await study.release(config, lease);
  const before = await exportPerpsAudit(db.pool, config);
  assert.equal(before.study.rounds.length, 2);
  for (const strategy of ["jev", "deepseek", "combined"] as const) {
    const account = before.accounts[strategy]!;
    assert.equal(account.attempts.filter((a) => a.status === "filled").length, 4);
    assert.equal(account.account.positions.length, 2);
    assert.ok(account.account.positions.every((p) => p.closedAt !== null));
    assert.deepEqual(
      before.study.rounds[0]!.proposals[strategy]!.map((p) => p.action),
      ["open-long", "open-short"],
    );
    assert.deepEqual(
      before.study.rounds[1]!.proposals[strategy]!.map((p) => p.action),
      ["close", "close"],
    );
  }
  assert.deepEqual(await exportPerpsAudit(db.pool, config), before);
  await assert.rejects(exportPerpsAudit(db.pool, { ...config, tenantId: "another-tenant" }), {
    code: "NOT_FOUND",
  });
  const audited = auditPerpsDecisions(before.study, [], hash, before.accounts);
  assert.equal(audited.summary.divergences, 0);
  assert.equal(audited.summary.unexplainedActions, 0);
  assert.ok(
    audited.rows
      .filter((r) => r.strategy !== "rules" && r.slot < 2)
      .every((r) => r.execution[0]?.simulation === "MATCH"),
  );
  assert.deepEqual(audited, auditPerpsDecisions(before.study, [], hash, before.accounts));

  const changed = structuredClone(before.study);
  changed.rounds[0]!.proposals.jev![0]!.action = "hold";
  assert.equal(
    auditPerpsDecisions(changed, [], hash).rows.find(
      (r) => r.slot === 0 && r.symbol === "BTC" && r.strategy === "jev",
    )!.conversion,
    "PROPOSAL_DIVERGENCE",
  );
  const partial = structuredClone(before.study);
  Reflect.deleteProperty(partial.rounds[0]!, "evidence");
  assert.equal(auditPerpsDecisions(partial, [], hash).rows[0]!.conversion, "NOT_VERIFIABLE");
  const wrongIdentity = structuredClone(before.study);
  wrongIdentity.rounds[0]!.evidence.candles[0]!.market = {
    ...wrongIdentity.rounds[0]!.evidence.candles[0]!.market,
    marketId: 99,
  };
  assert.equal(
    auditPerpsDecisions(wrongIdentity, [], hash).rows[0]!.candles.validity,
    "INVALID_CANDLES",
  );
  const gap = structuredClone(before.study);
  gap.rounds[0]!.evidence.candles[0]!.candles[20]!.openTime += 1000;
  assert.equal(auditPerpsDecisions(gap, [], hash).rows[0]!.candles.validity, "INVALID_CANDLES");
  const stale = structuredClone(before.study);
  stale.rounds[0]!.evidence.frames[0]!.book.provenance.providerTimestamp =
    stale.rounds[0]!.evidence.frames[0]!.book.provenance.providerTimestamp! - 31000;
  assert.equal(auditPerpsDecisions(stale, [], hash).rows[0]!.initialValidity, "STALE_MARKET_DATA");
  const invalid = structuredClone(before.study);
  invalid.rounds[0]!.calls.jev!.result = { answers: {}, proposals: [] };
  assert.equal(
    auditPerpsDecisions(invalid, [], hash).rows.find((r) => r.strategy === "jev")!.conversion,
    "JEV_ANSWERS_INVALID",
  );
  assert.equal(
    audited.rows.find((r) => r.slot === 1)!.candles.repeatInterpretation,
    "EXPECTED_SAME_HOUR",
  );

  // An invalid ETH final frame blocks ALL accounts even though BTC and model outputs are valid.
  now += 900000;
  invalidFinal = true;
  lease = await study.claim(config);
  await runner.cycle(config, lease, new AbortController().signal);
  await study.release(config, lease);
  const after = await exportPerpsAudit(db.pool, config);
  assert.equal(calls, 12);
  assert.equal(after.study.rounds[2]!.executionStatus, "skipped_data_unavailable");
  assert.equal(
    Object.values(after.study.rounds[2]!.calls)
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .filter((c) => c.status === "completed" && c.costUsd !== null).length,
    4,
  );
  for (const strategy of ["rules", "jev", "deepseek", "combined"] as const) {
    assert.equal(
      after.accounts[strategy]!.attempts.length,
      before.accounts[strategy]!.attempts.length,
    );
  }

  const root = await mkdtemp(join(tmpdir(), "perps-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packet = {
    version: 1,
    protocol: "perps-decision-audit-export-v1",
    exportCommit: "controlled",
    provenance: { study: "controlled", diagnostics: null, diagnosticsHash: null },
    payload: { ...before, diagnostics: [] },
    payloadHash: hash({ ...before, diagnostics: [] }),
  };
  const path = join(root, "packet.json");
  await writeFile(path, JSON.stringify(packet));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline analysis attempted network");
  };
  try {
    await runPerpsAudit({ command: "audit", state: path, output: join(root, "first") });
    await runPerpsAudit({ command: "audit", state: path, output: join(root, "second") });
    for (const file of ["audit.json", "audit.csv", "audit.html"]) {
      assert.equal(
        await readFile(join(root, "first", file), "utf8"),
        await readFile(join(root, "second", file), "utf8"),
      );
    }
    await assert.rejects(
      runPerpsAudit({
        command: "audit",
        state: path,
        envFile: "does-not-exist",
        output: join(root, "bad"),
      }),
      { code: "INVALID_INPUT" },
    );
    const loader = join(root, "offline-loader.mjs");
    await writeFile(
      loader,
      `export async function resolve(specifier, context, next) {
      if (/^node:(net|http|https|tls|dns)$/.test(specifier) && !context.parentURL?.includes("/node_modules/tsx/")) { throw new Error("Offline network module: " + specifier); }
      if (/^@pickler\\/infrastructure|dotenv|model-providers|composition\\/perps-study-model/.test(specifier)) { throw new Error("Forbidden offline dependency: " + specifier); }
      return next(specifier, context);
    }`,
    );
    await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "--experimental-loader",
        loader,
        fileURLToPath(new URL("../src/evaluate.ts", import.meta.url)),
        "audit",
        "--state",
        path,
        "--output",
        join(root, "cli"),
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: "invalid",
          DEEPSEEK_API_KEY: "must-not-be-loaded",
          JEV_API_KEY: "must-not-be-loaded",
        },
      },
    );
    assert.equal(
      await readFile(join(root, "cli", "audit.json"), "utf8"),
      await readFile(join(root, "first", "audit.json"), "utf8"),
    );
    const sensitive = structuredClone(packet);
    sensitive.payload.study.record.metadata = { apiKey: "never-export-this" };
    sensitive.payloadHash = hash(sensitive.payload);
    await writeFile(path, JSON.stringify(sensitive));
    await assert.rejects(
      runPerpsAudit({ command: "audit", state: path, output: join(root, "secret") }),
      { code: "AUDIT_SENSITIVE_INPUT" },
    );
    packet.payloadHash = "modified";
    await writeFile(path, JSON.stringify(packet));
    await assert.rejects(
      runPerpsAudit({ command: "audit", state: path, output: join(root, "bad") }),
      { code: "INVALID_INPUT" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("partial studies remain explicitly unverifiable rather than fabricating decisions", () => {
  const view = {
    record: { config, metadata: {}, startedAt: 1800000000000 },
    rounds: [],
    events: [
      {
        key: "slot4",
        kind: "data-unavailable",
        at: 1800003600000,
        data: { slot: 4, phase: "before-model" },
      },
    ],
  } as unknown as PerpsStudyView;
  const result = auditPerpsDecisions(view, [], hash);
  assert.equal(result.rows.length, 64);
  assert.ok(result.rows.every((r) => r.conversion === "NOT_VERIFIABLE"));
  assert.equal(result.omissions.length, 1);
  assert.equal(result.summary.omissions[0]!.attemptsObserved, 0);
});
