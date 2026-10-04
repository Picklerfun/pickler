import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditPerpsFilters,
  canonicalAudit,
  perpsJevDecisions,
  perpsJevReviewed,
  type PerpsStudyView,
  type PerpsCall,
  type PerpsJevAnswers,
} from "@pickler/trading/evaluation";
import {
  perpsMultiframeRules,
  traceMultiframeProposal,
  multiframeFeatures,
} from "@pickler/trading/strategies";
import { perpsMultiframeModelState } from "@pickler/agent-runtime/composition/perps-model-state";
import { createPerpsStudyModels } from "@pickler/agent-runtime/composition/perps-study-model";
import { contractContext } from "../src/perps-study/contract-context.js";
import { runPerpsAudit } from "../src/perps-study/audit.js";
import { studyConfig } from "./perps-study-fixtures.js";

const hash = (v: unknown) => createHash("sha256").update(canonicalAudit(v)).digest("hex");
const config = {
  ...studyConfig,
  version: 2 as const,
  protocol: "perps-multiframe-v3" as const,
  strategyVersion: "1.1.0" as const,
  hours: 2 as const,
};
function context() {
  const ctx = contractContext(1800000000000, true);
  for (const frame of ctx.evidence.frames) {
    frame.snapshot.funding = {
      rate: "0",
      intervalSeconds: 3600,
      intervalBlocks: 3600,
      appliesAt: ctx.evidence.observedAt + 3600000,
      eventBlock: 10,
      applicationTimeEstimated: true,
      provenance: frame.book.provenance,
    };
  }
  for (const series of ctx.evidence.candles) {
    if (series.resolution === 3600) {
      for (const [i, c] of series.candles.entries()) {
        c.close = (95 + i * 0.1).toFixed(2);
      }
    }
  }
  return ctx;
}
function answers(review = false): PerpsJevAnswers {
  return Object.fromEntries(
    ["BTC", "ETH"].flatMap((symbol) =>
      (review ? ["identity", "evidence", "costs"] : ["long", "short", "thesis"]).map((kind) => {
        const labels = review
          ? ["CONSISTENT", "CONTRADICTED", "UNKNOWN"]
          : kind === "thesis"
            ? ["INVALIDATED", "INTACT", "UNKNOWN"]
            : ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "UNKNOWN"];
        const choice = review ? "CONSISTENT" : kind === "thesis" ? "INTACT" : "UNSUPPORTED";
        return [
          `${symbol}_${kind}`,
          {
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(
              labels.map((label) => [label, label === choice ? 1 : 0]),
            ),
          },
        ];
      }),
    ),
  );
}
function view(): PerpsStudyView {
  const ctx = context();
  const hold = (["BTC", "ETH"] as const).map((symbol) => ({
    symbol,
    action: "hold" as const,
    reason: "COST_HURDLE: momentum5Bps=0",
    sourceIds: [],
  }));
  const jev = { answers: answers(), proposals: perpsJevDecisions(ctx, answers()) };
  const review = { answers: answers(true), proposals: perpsJevReviewed(hold, answers(true)) };
  const call = (lane: PerpsCall["lane"], result: unknown): PerpsCall => ({
    lane,
    model: "controlled",
    status: "completed",
    result,
    error: null,
    costUsd: "0.001",
    reservationUsd: "0.02",
    inputTokens: 10,
    outputTokens: 1,
    startedAt: ctx.evidence.observedAt,
    finishedAt: ctx.evidence.observedAt + 1,
    requestHash: "a".repeat(64),
  });
  return {
    record: {
      config,
      metadata: { commit: "controlled" },
      agentIds: { rules: "r", jev: "j", deepseek: "d", combined: "c" },
      agentVersions: { rules: 1, jev: 1, deepseek: 1, combined: 1 },
      createdAt: ctx.evidence.observedAt,
      startedAt: ctx.evidence.observedAt,
      endsAt: ctx.evidence.observedAt + 7200000,
      graceUntil: null,
      status: "completed",
      decisionStopReason: null,
      stopRequested: false,
      lastObservationAt: null,
      lastRoundSlot: 1,
    },
    rounds: [
      {
        key: "round-001",
        slot: 1,
        executionStatus: "complete",
        status: "completed",
        createdAt: ctx.evidence.observedAt,
        finishedAt: ctx.evidence.observedAt,
        evidence: ctx.evidence,
        accounts: {
          rules: ctx.account,
          jev: ctx.account,
          deepseek: ctx.account,
          combined: ctx.account,
        },
        proposals: {
          rules: perpsMultiframeRules(ctx),
          jev: jev.proposals,
          deepseek: hold,
          combined: review.proposals,
        },
        calls: {
          direct: call("direct", hold),
          jev: call("jev", jev),
          fallback: call("fallback", hold),
          review: call("review", review),
        },
      },
    ],
    events: [
      {
        key: "round-001:execution-input",
        at: ctx.evidence.observedAt,
        kind: "execution-input",
        data: { observedAt: ctx.evidence.observedAt, frames: ctx.evidence.frames },
      },
    ],
  };
}

test("paired audit uses only hourly baseline regardless of input order, with overlapping filters", () => {
  const study = view();
  const report = auditPerpsFilters(study, [], hash);
  assert.equal(report.rows.length, 64);
  assert.equal(report.pairedSummary.observations, 2);
  assert.equal(report.pairedSummary.previousOpenings, 2);
  assert.equal(report.pairedSummary.discardedOpenings, 2);
  assert.deepEqual(report.pairedSummary.firstBlocks, { DIRECTION_NOT_CONFIRMED: 2 });
  assert.deepEqual(report.pairedSummary.overlappingFailedConditions, {
    DIRECTION_NOT_CONFIRMED: 2,
    RECENT_MOVE_BELOW_COST_HURDLE: 2,
  });
  study.rounds[0]!.evidence.candles.reverse();
  assert.deepEqual(auditPerpsFilters(study, [], hash).pairedSummary, report.pairedSummary);
  assert.equal(auditPerpsFilters(study, [], hash).summary.divergences, 0);
  const invalidFinal = structuredClone(study);
  const frames = (
    invalidFinal.events[0]!.data as { frames: (typeof study.rounds)[0]["evidence"]["frames"] }
  ).frames;
  frames[1]!.book.provenance.providerTimestamp! -= 31000;
  assert.equal(auditPerpsFilters(invalidFinal, [], hash).pairedSummary.observations, 0);
  const missing = structuredClone(study);
  missing.rounds[0]!.evidence.candles.pop();
  assert.equal(auditPerpsFilters(missing, [], hash).pairedSummary.observations, 0);
});

test("failed slots retain reservations, omit comparisons and do not invent timeout phases", () => {
  const study = view();
  const round = study.rounds[0]!;
  round.executionStatus = "incomplete";
  round.calls.direct = {
    ...round.calls.direct,
    result: null,
    status: "failed",
    error: "MODEL_TIMEOUT",
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    finishedAt: round.calls.direct.startedAt! + 20000,
  };
  const r = auditPerpsFilters(study, [], hash);
  assert.equal(r.pairedSummary.observations, 0);
  assert.equal(r.technical.accountedOrReservedUsd, "0.023");
  assert.equal(r.technical.failures[0]!.durationMs, 20000);
  assert.equal(
    r.technical.failures[0]!.diagnosis,
    "DEADLINE_EXHAUSTED_PHASE_AND_CAUSE_NOT_VERIFIABLE",
  );
  assert.equal(r.technical.failures[0]!.consumption, "UNKNOWN_RESERVATION_RETAINED");
  assert.ok(
    r.rows
      .filter((row) => row.slot === 1)
      .every((row) => row.explanation === "INCOMPLETE_NOT_COMPARABLE"),
  );
});

test("trace preserves position and horizon boundaries", () => {
  const ctx = context();
  const p = {
    symbol: "BTC" as const,
    action: "open-long" as const,
    reason: "controlled",
    sourceIds: [],
  };
  const trace = traceMultiframeProposal(ctx, p);
  assert.equal(trace.firstBlock, "DIRECTION_NOT_CONFIRMED");
  ctx.account.positions.push({
    symbol: "BTC",
    side: "long",
    openedAt: ctx.evidence.observedAt - 1800000,
    closedAt: null,
  } as never);
  assert.equal(traceMultiframeProposal(ctx, p).horizon.triggered, true);
  assert.equal(traceMultiframeProposal(ctx, p).executable.action, "close");
  ctx.account.positions[0]!.openedAt++;
  assert.equal(traceMultiframeProposal(ctx, p).firstBlock, "POSITION_ALREADY_OPEN");
});

test("model request bodies preserve frozen d4e60533 fingerprints for all three adapters", async () => {
  const expected = {
    direct: "710c1bb3cc293b653103789c0f3c16f8a94fdd578aee5dac12c6fa95391cf008",
    decide: "a4efb8dd1f4be3fab825f90003825e161b50f3828e92529eb08ba9e2c9bd945e",
    review: "409e5a96817fa2ff76b5095ab025deb4991f46a12b32c2dedd9eaee17d32cb0f",
  };
  const cfg = {
    ...config,
    deepseek: {
      model: "controlled",
      baseUrl: "https://example.invalid/v1",
      inputPerMillion: "0.3",
      outputPerMillion: "1.2",
    },
  };
  const ctx = contractContext(1800000000000, true);
  let lane: keyof typeof expected = "direct";
  const captured: Partial<Record<keyof typeof expected, string>> = {};
  const models = createPerpsStudyModels(
    cfg,
    { deepseek: "controlled", jev: "controlled" },
    async (_u, init) => {
      captured[lane] = createHash("sha256").update(String(init?.body)).digest("hex");
      return new Response("", { status: 500 });
    },
  );
  const hooks = { before: async () => {}, usage: async () => {} };
  for (lane of ["direct", "decide", "review"] as const) {
    const operation =
      lane === "review"
        ? models.review!(
            ctx,
            [
              { symbol: "BTC", action: "hold", reason: "controlled", sourceIds: [] },
              { symbol: "ETH", action: "hold", reason: "controlled", sourceIds: [] },
            ],
            new AbortController().signal,
            hooks,
          )
        : models[lane]!(ctx, new AbortController().signal, hooks);
    await assert.rejects(operation);
  }
  assert.deepEqual(captured, expected);
  const projected = perpsMultiframeModelState(ctx);
  assert.ok(
    projected.candles.every((c) => c.columns.length === 2 && c.rows.every((r) => r.length === 2)),
  );
  assert.deepEqual(projected.features[0], multiframeFeatures(ctx, "BTC"));
});

test("v2 reports are deterministic, escaped and offline; unknown reasons stay literal", async (t) => {
  const study = view();
  const literal = "NO_SIGNAL: <script>alert(1)</script>; undefined outside confirmation";
  study.rounds[0]!.proposals.deepseek![0]!.reason = literal;
  (study.rounds[0]!.calls.direct.result as { reason: string }[])[0]!.reason = literal;
  const root = await mkdtemp(join(tmpdir(), "filter-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = { study, diagnostics: [], accounts: {} };
  const path = join(root, "packet.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      protocol: "perps-decision-audit-export-v1",
      payload,
      payloadHash: hash(payload),
      exportCommit: "controlled",
      provenance: { study: "fixture", diagnostics: null, diagnosticsHash: null },
    }),
  );
  const fetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Network forbidden");
  };
  try {
    for (const output of ["a", "b"]) {
      await runPerpsAudit({ command: "audit", state: path, output: join(root, output) });
    }
  } finally {
    globalThis.fetch = fetch;
  }
  for (const file of ["audit.json", "audit.csv", "audit.html"]) {
    assert.equal(
      await readFile(join(root, "a", file), "utf8"),
      await readFile(join(root, "b", file), "utf8"),
    );
  }
  const loader = join(root, "offline-loader.mjs");
  await writeFile(
    loader,
    `export async function resolve(specifier, context, next) {
    if (/^node:(net|http|https|tls|dns)$/.test(specifier) && !context.parentURL?.includes("/node_modules/tsx/")) { throw new Error("Offline network module"); }
    if (/^@pickler\\/infrastructure|dotenv|model-providers|composition\\/perps-study-model/.test(specifier)) { throw new Error("Forbidden offline dependency"); }
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
    await readFile(join(root, "a", "audit.json"), "utf8"),
  );
  const html = await readFile(join(root, "a", "audit.html"), "utf8");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  const report = JSON.parse(await readFile(join(root, "a", "audit.json"), "utf8"));
  assert.equal(report.protocol, "perps-decision-audit-v2");
  assert.equal(report.contexts[0].states.rules.state.candles[0].columns.length, 2);
});

test("numeric claims are checked without interpreting free-text reasons or missing input", () => {
  const study = view();
  const round = study.rounds[0]!;
  round.proposals.deepseek![0]!.reason = "NO_SIGNAL: momentum5Bps=999";
  const r = auditPerpsFilters(study, [], hash).rows.find(
    (v) => v.slot === 1 && v.strategy === "deepseek" && v.symbol === "BTC",
  )!;
  assert.ok(r.modelReasonCheck.checks.some((c) => c.status === "NUMERICAL_MISMATCH"));
  assert.equal(r.recordedProposal!.action, "hold");
});

test("audit traces strict cost equality, zero momentum and sufficient depth equality", () => {
  const ctx = context();
  const p = {
    symbol: "BTC" as const,
    action: "open-long" as const,
    reason: "controlled",
    sourceIds: [],
  };
  const frame = ctx.evidence.frames[0]!;
  frame.book.bids[0]!.price = "100";
  frame.book.asks[0]!.price = "100";
  frame.book.asks[0]!.size = "1";
  frame.snapshot.market.fees.taker = "0";
  for (const s of ctx.evidence.candles.filter(
    (v) => v.market.symbol === "BTC" && v.resolution !== 3600,
  )) {
    s.candles.at(-1)!.close = "100.15";
  }
  const trace = traceMultiframeProposal(ctx, p);
  assert.equal(trace.features.activityHurdleBps, 15);
  assert.equal(trace.features.momentum5Bps, 15);
  assert.equal(trace.firstBlock, "RECENT_MOVE_BELOW_COST_HURDLE");
  assert.equal(trace.checks.find((c) => c.code === "INSUFFICIENT_DEPTH")!.passed, true);
  for (const s of ctx.evidence.candles.filter(
    (v) => v.market.symbol === "BTC" && v.resolution !== 3600,
  )) {
    s.candles.at(-1)!.close = "100.16";
  }
  assert.equal(traceMultiframeProposal(ctx, p).executable.action, "open-long");
});
