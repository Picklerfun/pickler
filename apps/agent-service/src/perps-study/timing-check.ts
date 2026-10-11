import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { PilotError } from "@pickler/core";
import {
  canonicalAudit,
  nextPriceCycleDelay,
  type PerpsStudyView,
} from "@pickler/trading/evaluation";
import {
  initialPaperAccount,
  simulatePerpsFill,
  applyPaperFill,
  type PerpsPaperAttempt,
  type PerpsPaperFrame,
} from "@pickler/trading/perps";
import { createReportQueue } from "./report-queue.js";
const hash = (v: unknown) => createHash("sha256").update(canonicalAudit(v)).digest("hex");
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: (sorted[14]! + sorted[15]!) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
};
/** Offline inputs and controlled dependency delays; not historical component attribution. */
export async function runTimingCheck(state: string, destination: string, signal: AbortSignal) {
  const text = await readFile(resolve(state), "utf8");
  const packet = JSON.parse(text) as {
    version: number;
    protocol: string;
    payloadHash: string;
    payload: { study: PerpsStudyView };
  };
  if (
    packet.version !== 1 ||
    packet.protocol !== "perps-decision-audit-export-v1" ||
    hash(packet.payload) !== packet.payloadHash
  ) {
    throw new PilotError("AUDIT_HASH_INVALID", "A verified read-only audit export is required");
  }
  const evidence = packet.payload.study.rounds.find((r) => r.evidence.frames.length)?.evidence;
  if (!evidence) {
    throw new PilotError("NOT_VERIFIABLE", "No saved valid frame for financial benchmark");
  }
  const frame: PerpsPaperFrame = evidence.frames[0]!;
  const at = evidence.observedAt;
  const account = initialPaperAccount(
    {
      tenantId: "offline",
      agentId: "benchmark",
      sessionId: "timing",
      network: frame.snapshot.market.provenance.network,
    },
    1,
    at,
  );
  account.riskManagement = "buffered-selective-1x-v1";
  const intent = {
    kind: "open" as const,
    symbol: frame.snapshot.market.symbol,
    side: "long" as const,
    notional: "100",
    feeReserve: "1",
  };
  const attempt: PerpsPaperAttempt = {
    key: "controlled",
    intent,
    status: "pending",
    reserved: "101",
    createdAt: at,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const financial = () =>
    applyPaperFill(account, attempt, simulatePerpsFill(account, intent, frame, at), at);
  const scenarios: {
    name: string;
    before: number[];
    after: number[];
    outputHash: string;
    interpretation: string;
  }[] = [];
  const pending: Promise<void>[] = [];
  async function measure(
    name: string,
    baseline: () => Promise<unknown>,
    improved: () => Promise<unknown>,
    interpretation: string,
  ) {
    const before: number[] = [],
      after: number[] = [];
    let outputHash = "";
    for (let i = 0; i < 30; i++) {
      signal.throwIfAborted();
      for (const [run, values] of [
        [baseline, before],
        [improved, after],
      ] as const) {
        const started = performance.now(),
          output = await run();
        values.push(performance.now() - started);
        const current = hash(output);
        if (outputHash && outputHash !== current) {
          throw new PilotError(
            "TIMING_PARITY_FAILED",
            "Identical inputs produced different financial outputs",
          );
        }
        outputHash = current;
        await Promise.all(pending.splice(0));
      }
    }
    scenarios.push({ name, before, after, outputHash, interpretation });
  }
  await measure(
    "financial-functions",
    async () => financial(),
    async () => financial(),
    "Same existing simulator and accounting; overhead and noise may regress, no changed financial rules.",
  );
  // Measure time to servicing prices, with the same controlled slow dependencies.
  const output = financial();
  await measure(
    "price-priority-with-slow-candles-and-funding",
    async () => {
      await pause(10);
      await pause(10);
      return financial();
    },
    async () => {
      const result = financial();
      pending.push(
        (async () => {
          await pause(10);
          await pause(10);
        })(),
      );
      return result;
    },
    "Controlled 10ms candle and 10ms funding waits are moved after price maintenance. Full coordinator order is covered by regression tests; this is not a historical provider speed measurement.",
  );
  await measure(
    "slow-report-on-critical-path",
    async () => {
      await pause(20);
      return output;
    },
    async () => {
      const reports = createReportQueue(
        async () => {
          await pause(20);
        },
        (e) => {
          throw e;
        },
      );
      reports.request();
      pending.push(reports.flush());
      // Record service delay before waiting for independent report completion.
      return output;
    },
    "Coalesced report work does not delay the next price dispatch. Completion is verified separately in the controlled suite.",
  );
  await measure(
    "delayed-query-no-invented-speedup",
    async () => {
      await pause(5);
      return output;
    },
    async () => {
      await pause(5);
      return output;
    },
    "Identical injected query delay; report any regression. No claim that instrumentation accelerates PostgreSQL.",
  );
  const calendar = Array.from({ length: 30 }, (_, i) => {
    const start = 300000 + i * 60000,
      finished = start + 65000;
    return {
      sample: i,
      start,
      finished,
      beforeDelayMs: 60000 - (finished % 60000) + 100,
      afterDelayMs: nextPriceCycleDelay(finished, Math.floor(start / 60000)),
    };
  });
  const results = scenarios.map((s) => ({
    ...s,
    before: stats(s.before),
    after: stats(s.after),
    samples: { before: s.before, after: s.after },
    medianRegression: stats(s.after).medianMs > stats(s.before).medianMs,
  }));
  const result = {
    version: 1,
    protocol: "perps-sma-timing-check-v1",
    inputHash: hash(packet.payload),
    sourceCommit:
      (packet.payload.study.record.metadata as { commit?: string } | undefined)?.commit ?? null,
    analyzerCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    measurementsPerScenario: 30,
    calls: 0,
    financialParity: true,
    limitation:
      "Controlled benchmarks with saved inputs and injected waits. They do not reconstruct historical transport phases or demonstrate profitability.",
    scenarios: results,
    calendar,
  };
  const outputDir = resolve(destination);
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const csv =
    [
      "scenario,count,before_median_ms,after_median_ms,before_p95_ms,after_p95_ms,regression",
      ...results.map((s) =>
        [
          s.name,
          s.before.count,
          s.before.medianMs,
          s.after.medianMs,
          s.before.p95Ms,
          s.after.p95Ms,
          s.medianRegression,
        ].join(","),
      ),
    ].join("\n") + "\n";
  await writeFile(join(outputDir, "timing.json"), JSON.stringify(result, null, 2) + "\n");
  await writeFile(join(outputDir, "timing.csv"), csv);
  await writeFile(
    join(outputDir, "timing.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>SMA controlled timing</title><body><h1>Controlled timing comparison</h1><p>${result.limitation}</p><pre>${JSON.stringify(result, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></body></html>`,
  );
  console.log(
    JSON.stringify({ output: outputDir, financialParity: true, measurementsPerScenario: 30 }),
  );
}
