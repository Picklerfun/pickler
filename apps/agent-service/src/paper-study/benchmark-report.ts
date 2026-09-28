import { readFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import {
  benchmarkReserved,
  comparisonReviews,
  comparisonReserved,
  forecastMetrics,
  variantMetrics,
  reviewMetrics,
  pairedObservations,
  pairedBootstrap,
  type BenchmarkCase,
  type BenchmarkState,
  type ComparisonState,
  type QuantState,
  type StudyState,
  type BenchmarkVariant,
} from "@pickler/core";
import { atomicWrite } from "./files.js";
import { sha256, type BenchmarkScenario } from "./benchmark-cases.js";

const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const csv = (rows: unknown[][]) =>
  rows
    .map((r) =>
      r
        .map(
          (v) =>
            `"${(/^[=+\-@\t\r]/.test(String(v)) ? "'" : "") + String(v ?? "").replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\n");
function table(headers: string[], rows: unknown[][]) {
  return `<div class="scroll"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function page(title: string, content: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="60"><title>${esc(title)}</title><style>body{max-width:1600px;margin:auto;padding:32px;background:#101513;color:#ecf4ef;font:15px/1.5 system-ui}h1,h2,a{color:#c4ef78}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;white-space:nowrap;border-bottom:1px solid #34453c}th{background:#19291f}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#18221c;padding:16px;border-radius:10px}details{margin:10px 0}summary{cursor:pointer}p{max-width:1100px}.warning{border-left:3px solid #e3b65f;padding:12px}</style><h1>${esc(title)}</h1><p class="warning">Local paper experiment. No real orders. Experimental, uncalibrated forecasts and counterfactual fills. Fees and liquidity are modeled, not guaranteed. Pending positions are not losses; technical failures are not abstentions. API dollars, reserved limits and virtual units are separate.</p>${content}</html>`;
}
export function benchmarkSummary(state: BenchmarkState, scenarios: BenchmarkScenario[] = []) {
  const labels = new Map(scenarios.map((c) => [c.id, c.expectedVeto]));
  return {
    protocol: state.protocol,
    id: state.id,
    version: 4,
    createdAt: state.createdAt,
    deadline: state.deadline,
    evaluation: state.evaluation,
    invalidAnswerPolicy: state.invalidAnswerPolicy ?? "stop-study",
    paidStopped: state.paidStopped,
    accounting: {
      priorReservedUsd: state.priorReservedUsd,
      reservedUsd: benchmarkReserved(state),
      originalCeilingUsd: 5,
      newCeilingUsd: state.maxNewReservedUsd,
      reservedCalls: state.reviews.length,
      startedCalls: state.reviews.filter((r) => r.startedAt !== null).length,
      knownInputTokens: state.reviews.reduce((s, r) => s + (r.result?.inputTokens ?? 0), 0),
      knownOutputTokens: state.reviews.reduce((s, r) => s + (r.result?.outputTokens ?? 0), 0),
      estimatedKnownUsd: state.reviews.reduce(
        (s, r) => s + ((r.result?.inputTokens ?? 0) * state.jevInputPerMillion) / 1e6,
        0,
      ),
      unknownUsageCalls: state.reviews.filter(
        (r) =>
          r.startedAt !== null && (r.result?.inputTokens == null || r.result?.outputTokens == null),
      ).length,
    },
    slots: {
      total: state.slots.length,
      evaluated: state.slots.filter((s) => s.status === "evaluated").length,
      missed: state.slots.filter((s) => s.status === "missed").length,
      failed: state.slots.filter((s) => s.status === "failed").length,
      pending: state.slots.filter((s) => s.status === "pending").length,
      interrupted: state.slots.filter((s) => s.status === "interrupted").length,
    },
    variants: (["A", "B", "C", "D"] as const).map((v) => variantMetrics(state.cases, v)),
    forecasts: forecastMetrics(state.cases),
    reviewers: (["contract", "development", "heldout", "prospective"] as const).flatMap((phase) =>
      (["current", "compact"] as const).map((reviewer) => ({
        phase,
        reviewer,
        ...reviewMetrics(
          state.reviews.filter((r) => r.phase === phase && r.reviewer === reviewer),
          labels,
        ),
      })),
    ),
    effects: (
      [
        ["B", "A"],
        ["C", "B"],
        ["C", "D"],
      ] as const
    ).map(([left, right]) => ({
      comparison: `${left}-${right}`,
      excludedMarkets: state.cases.length - pairedObservations(state.cases, left, right).length,
      ...pairedBootstrap(pairedObservations(state.cases, left, right)),
    })),
    interruptions: state.interruptions,
  };
}
const detailHeaders = [
  "Market",
  "Horizon",
  "Observed UTC",
  "Variant",
  "Up probability/bounds",
  "Down probability/bounds",
  "Threshold",
  "Reference",
  "Ticker age ms",
  "Candle age ms",
  "Seconds remaining",
  "Outcome",
  "Initial central edge",
  "Initial conservative edge",
  "Initial decision edge",
  "Initial limit",
  "Final edge",
  "Edge change",
  "Effective cost change",
  "Review",
  "Review duration ms",
  "Shared wait ms",
  "Status",
  "Reason",
  "Quantity",
  "Fees",
  "Virtual cost",
  "Official resolution",
  "Payout",
  "Realized P&L",
];
function detailRows(state: BenchmarkState) {
  return state.cases.flatMap((r) =>
    r.variants.map((d) => [
      r.marketId,
      r.kind,
      new Date(r.startedAt).toISOString(),
      d.variant,
      JSON.stringify(r.forecast?.probabilities.find((p) => p.label === "Up") ?? null),
      JSON.stringify(r.forecast?.probabilities.find((p) => p.label === "Down") ?? null),
      r.input?.opening.price,
      r.input?.ticker.price,
      r.input && r.forecast ? r.forecast.observedAt - r.input.ticker.observedAt : null,
      r.input ? r.input.observedAt - (r.input.candles.at(-1)!.time + 60000) : null,
      r.forecast?.horizonSeconds,
      d.proposal?.outcomeId,
      d.proposal?.centralEdge,
      d.proposal?.conservativeEdge,
      d.proposal?.decisionEdge,
      d.proposal?.limitPrice,
      d.finalEdge,
      d.edgeChange,
      d.priceChange,
      d.reviewId ?? (d.variant === "D" ? "no-veto virtual control" : "not called"),
      state.reviews.find((v) => v.id === d.reviewId)?.result?.durationMs,
      r.waitMs,
      d.status,
      d.reasons.join(";") || r.reason,
      d.fill?.quantity,
      d.fill?.fees,
      d.fill?.totalCost,
      JSON.stringify(r.resolutions),
      d.settlement?.payout,
      d.settlement?.realizedPnl,
    ]),
  );
}
const metricHeaders = [
  "Variant",
  "Markets",
  "Proposals",
  "Buys",
  "Abstentions",
  "Blocked",
  "Failed",
  "Pending positions",
  "Invested",
  "Fees",
  "Payout",
  "Realized P&L",
  "Return / settled cost",
  "Realized drawdown",
];
const metricRow = (v: ReturnType<typeof variantMetrics>) => [
  v.variant,
  v.markets,
  v.proposals,
  v.purchases,
  v.abstentions,
  v.blocked,
  v.failed,
  v.pendingPositions,
  v.invested,
  v.fees,
  v.payout,
  v.realizedPnl,
  v.returnOnSettledCost,
  v.maxRealizedDrawdown,
];
export async function saveBenchmark(
  directory: string,
  state: BenchmarkState,
  scenarios: BenchmarkScenario[],
) {
  const summary = benchmarkSummary(state, scenarios);
  await atomicWrite(join(directory, "state.json"), JSON.stringify(state, null, 2));
  await atomicWrite(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  await atomicWrite(join(directory, "results.csv"), csv([detailHeaders, ...detailRows(state)]));
  const evaluationRows = state.reviews
    .filter((r) => r.phase !== "prospective")
    .map((r) => [
      r.caseId,
      r.phase,
      r.reviewer,
      scenarios.find((s) => s.id === r.caseId)?.expectedVeto ?? "contract only",
      r.result?.status ?? "reserved",
      r.result?.veto ?? "unknown",
      r.result?.inputTokens,
      r.result?.outputTokens,
      r.result?.durationMs,
      r.reservedUsd,
      r.contextHash,
    ]);
  const evaluationHeaders = [
    "Case",
    "Split",
    "Reviewer",
    "Expected synthetic veto",
    "Status",
    "Veto",
    "Input tokens",
    "Output tokens",
    "Latency ms",
    "Reserved USD",
    "Context hash",
  ];
  await atomicWrite(join(directory, "evaluation.csv"), csv([evaluationHeaders, ...evaluationRows]));
  const html = page(
    `BTC decision benchmark · ${state.id}`,
    `<p>A: conservative/current Jev · B: central/current · C: central/compact · D: central/no-veto control. All variants use the same refreshed snapshot. Uncertainty is not approval. Synthetic labels are authored test cases, not human financial validation.</p><p><a href="results.csv">Market CSV</a> · <a href="evaluation.csv">Reviewer evaluation</a> · <a href="state.json">Complete evidence</a> · <a href="requests.json">Public request diagnostics</a></p><h2>Observed variants</h2>${table(metricHeaders, summary.variants.map(metricRow))}<h2>Forecasts, paired effects and accounting</h2><pre>${esc(JSON.stringify(summary, null, 2))}</pre><p>Shared Brier is counted once per market. Confidence and selected probability are related. Hour-block bootstrap intervals are exploratory; six hours cannot establish profitability. No automatic strategy promotion.</p><h2>Market decisions</h2>${table(detailHeaders, detailRows(state))}<h2>Reviewer evaluation</h2>${table(evaluationHeaders, evaluationRows)}<h2>Evidence by market</h2>${state.cases.map((r) => `<details><summary>${esc(r.marketId)} · ${esc(r.kind)} · ${esc(r.status)}</summary><pre>${esc(JSON.stringify({ ...r, reviews: state.reviews.filter((v) => r.reviewIds.includes(v.id)) }, null, 2))}</pre></details>`).join("")}`,
  );
  await atomicWrite(join(directory, "index.html"), html);
}
/** Explicit offline import. Historical variants are displayed only where actually recorded. */
export async function compareBenchmarkStudies(output: string, paths: string[]) {
  if (!paths.length) {
    throw new Error("EXPLICIT_STUDY_PATHS_REQUIRED");
  }
  const ids = new Set<string>(),
    files = new Set<string>();
  const summaries: unknown[] = [];
  const tableRows: unknown[][] = [];
  const reviewerRows: unknown[][] = [];
  const benchmarkGroups = new Map<string, BenchmarkCase[]>();
  for (const file of paths) {
    const path = resolve(file),
      text = await readFile(path, "utf8"),
      fingerprint = sha256(text);
    const state = JSON.parse(text) as BenchmarkState | ComparisonState | QuantState | StudyState;
    if (![1, 2, 3, 4].includes(state.version) || !Array.isArray(state.cases)) {
      throw new Error("UNSUPPORTED_STUDY_VERSION");
    }
    const id = state.version === 1 ? state.config.id : state.id;
    if (
      ids.has(id) ||
      files.has(fingerprint) ||
      new Set(state.cases.map((c) => c.marketId)).size !== state.cases.length
    ) {
      throw new Error("DUPLICATE_HISTORICAL_STUDY_OR_MARKET");
    }
    ids.add(id);
    files.add(fingerprint);
    const metadata = await readFile(join(dirname(path), "configuration.json"), "utf8")
      .then(JSON.parse)
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") {
          return null;
        }
        throw e;
      });
    const identity = {
      id,
      path,
      stateSha256: fingerprint,
      version: state.version,
      commit: metadata?.commit ?? null,
      configuration: metadata ?? (state.version === 1 ? state.config : null),
      from: state.createdAt,
      until: state.version === 1 ? state.updatedAt : state.deadline,
    };
    if (state.version === 1) {
      const fills = state.cases.flatMap((r) => (r.paper?.fill ? [r.paper] : []));
      const settled = fills.filter((r) => r.settlement);
      const record = {
        ...identity,
        observedVariant: "historical-v1-agent",
        cases: state.cases.length,
        abstained: state.cases.filter((r) => r.status === "abstained").length,
        failed: state.cases.filter((r) => r.status === "failed").length,
        filled: fills.length,
        pending: fills.length - settled.length,
        reservedUsd: state.cases.reduce((s, r) => s + r.reservedApiUsd, 0),
        realizedPnl:
          settled.length || state.cases.some((r) => r.status === "abstained")
            ? settled.reduce((s, r) => s + Number(r.settlement!.realizedPnl), 0)
            : null,
        brier: null,
        notice: "No compatible shared quantitative forecast; no reconstructed A/B/C/D results.",
        originalCases: state.cases,
      };
      summaries.push(record);
      tableRows.push([
        id,
        1,
        "historical agent",
        state.cases.length,
        null,
        fills.length,
        record.abstained,
        null,
        record.failed,
        record.pending,
        fills.reduce((s, r) => s + Number(r.fill!.totalCost), 0),
        fills.reduce((s, r) => s + Number(r.fill!.fees), 0),
        settled.reduce((s, r) => s + Number(r.settlement!.payout), 0),
        record.realizedPnl,
        null,
        null,
      ]);
      continue;
    }
    let rows: BenchmarkCase[];
    if (state.version === 4) {
      rows = state.cases;
      const frozen = sha256(
        JSON.stringify({
          protocol: state.protocol,
          reviewers: metadata?.reviewers ?? null,
          experiment: metadata?.experiment ?? null,
          commit: metadata?.commit ?? null,
          permissions: metadata?.configuration?.plugins ?? null,
          reservationPolicy: { maximum: state.maxNewReservedUsd, rate: state.jevInputPerMillion },
        }),
      );
      // Missing freeze metadata is visible but cannot establish an economic improvement.
      const group =
        metadata?.commit && metadata?.reviewers && metadata?.experiment
          ? frozen
          : `unverified:${id}`;
      benchmarkGroups.set(group, [...(benchmarkGroups.get(group) ?? []), ...rows]);
    } else if (state.version === 3) {
      rows = state.cases.map((r) => ({
        ...r,
        variants: r.policies.map((d) => ({
          ...d,
          variant: (d.policy === "conservative-v1" ? "A" : "B") as BenchmarkVariant,
        })),
        reviewIds: r.reviews.map((v) => v.id),
      }));
    } else {
      rows = state.cases.map((r) => ({
        ...r,
        status: ["abstained", "filled"].includes(r.status)
          ? "completed"
          : (r.status as "started" | "failed" | "interrupted"),
        variants: [
          {
            variant: "A",
            policy: "conservative-v1",
            status:
              r.status === "filled"
                ? "filled"
                : r.status === "abstained"
                  ? "abstained"
                  : r.status === "started"
                    ? "pending"
                    : "failed",
            reasons: r.reason ? [r.reason] : [],
            ...(r.proposal ? { proposal: r.proposal } : {}),
            ...(r.fill ? { fill: r.fill } : {}),
            ...(r.settlement && r.resolution
              ? {
                  settlement: {
                    version: 1,
                    settledAt: Date.parse(r.resolution.observedAt),
                    ...r.settlement,
                    resolution: r.resolution,
                  } as const,
                }
              : {}),
          },
        ],
        resolutions: r.resolution ? [r.resolution] : [],
        reviewIds: [],
      }));
    }
    const present: BenchmarkVariant[] =
      state.version === 4
        ? ["A", "B", "C", "D"]
        : [...new Set(rows.flatMap((r) => r.variants.map((d) => d.variant)))];
    const variants = present.map((v) => variantMetrics(rows, v));
    for (const v of variants) {
      tableRows.push([id, state.version, ...metricRow(v)]);
    }
    const accounting =
      state.version === 4
        ? benchmarkSummary(state).accounting
        : {
            reservedUsd:
              state.version === 3
                ? comparisonReserved(state)
                : state.cases.reduce((s, c) => s + c.reservedUsd, 0),
            reviews:
              state.version === 3
                ? comparisonReviews(state)
                : state.cases.map((c) => c.review).filter(Boolean),
          };
    let evaluation: ReturnType<typeof benchmarkSummary> | null = null;
    if (state.version === 4) {
      const labels: BenchmarkScenario[] = await readFile(
        join(dirname(path), "scenarios.json"),
        "utf8",
      )
        .then(JSON.parse)
        .catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") {
            return [];
          }
          throw e;
        });
      if (
        labels.length &&
        metadata?.scenariosHash &&
        sha256(JSON.stringify(labels)) !== metadata.scenariosHash
      ) {
        throw new Error("IMPORTED_SCENARIOS_HASH_MISMATCH");
      }
      evaluation = benchmarkSummary(state, labels);
      for (const r of evaluation.reviewers.filter((r) => r.reservedCalls)) {
        reviewerRows.push([
          id,
          r.phase,
          r.reviewer,
          r.startedCalls,
          r.valid,
          r.detected,
          r.materialCases,
          r.falseVetos,
          r.coherentCases,
          r.uncertain,
          r.technicalFailures,
          r.meanLatencyMs,
          r.inputTokens,
          r.outputTokens,
          r.validation,
        ]);
      }
    }
    summaries.push({
      ...identity,
      variants,
      forecasts: forecastMetrics(rows),
      accounting,
      evaluation,
      originalCases: rows,
    });
  }
  const effects = [...benchmarkGroups].map(([freezeHash, rows]) => ({
    freezeHash,
    comparisons: (
      [
        ["B", "A"],
        ["C", "B"],
        ["C", "D"],
      ] as const
    ).map(([l, r]) => ({
      comparison: `${l}-${r}`,
      ...pairedBootstrap(
        pairedObservations(rows, l, r),
        freezeHash.startsWith("unverified:") ? 0 : 1,
      ),
    })),
  }));
  const directory = resolve(output);
  if (paths.some((p) => dirname(resolve(p)) === directory)) {
    throw new Error("CUMULATIVE_OUTPUT_MUST_NOT_OVERWRITE_STUDY");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = { studies: summaries, effects };
  await atomicWrite(join(directory, "summary.json"), JSON.stringify(report, null, 2));
  await atomicWrite(
    join(directory, "results.csv"),
    csv([["Study", "Version", ...metricHeaders], ...tableRows]),
  );
  const reviewerHeaders = [
    "Study",
    "Phase",
    "Reviewer",
    "Started calls",
    "Valid",
    "Detected",
    "Material denominator",
    "False vetos",
    "Coherent denominator",
    "Uncertain",
    "Technical failures",
    "Mean ms",
    "Input tokens",
    "Output tokens",
    "Validation",
  ];
  await atomicWrite(join(directory, "reviewers.csv"), csv([reviewerHeaders, ...reviewerRows]));
  await atomicWrite(
    join(directory, "index.html"),
    page(
      "BTC · cumulative decision laboratory",
      `<p>Explicit immutable imports. Historical protocols are separate cohorts; absent compact/no-veto variants are never reconstructed. Zero-market v4 rows describe variants that have not run. Economic comparisons pool only identical frozen v4 experiments. Unknown historical commits remain unknown.</p><p><a href="results.csv">Comparison CSV</a> · <a href="reviewers.csv">Reviewer CSV</a> · <a href="summary.json">Imported evidence and identities</a></p>${table(["Study", "Version", ...metricHeaders], tableRows)}<h2>Observed reviewer results</h2><p>Development and heldout are separate. Synthetic labels are not human review. Incomplete and technical cases are excluded from valid-case denominators and listed separately.</p>${table(reviewerHeaders, reviewerRows)}<h2>Paired prospective effects</h2><pre>${esc(JSON.stringify(effects, null, 2))}</pre><details><summary>Study identities, forecasts and original cases</summary><pre>${esc(JSON.stringify(summaries, null, 2))}</pre></details>`,
    ),
  );
  return directory;
}
