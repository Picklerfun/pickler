import {
  PERPS_STUDY_STRATEGIES,
  perpsAccountedUsd,
  type PerpsStudyView,
  type PerpsStrategy,
} from "@pickler/trading/evaluation";
import {
  paperRisk,
  paperUnits as u,
  paperDecimal as d,
  type PerpsPaperView,
} from "@pickler/trading/perps";
export function perpsStudyReport(
  study: PerpsStudyView,
  accounts: Record<PerpsStrategy, PerpsPaperView>,
  now = Date.now(),
) {
  const { record, rounds, events } = study;
  const observations = events
    .filter((e) => e.kind === "observation")
    .map((e) => e.at)
    .sort((a, b) => a - b);
  const end = Math.min(now, record.endsAt ?? now);
  const times = [record.startedAt ?? now, ...observations.filter((t) => t <= end), end];
  const unobservedMs = times
    .slice(1)
    .reduce((sum, t, i) => sum + Math.max(0, t - times[i]! - 90000), 0);
  const unknownCalls = rounds
    .flatMap((r) => Object.values(r.calls))
    .filter((c) => ["started", "failed"].includes(c.status) && c.costUsd === null);
  const incompleteRounds = rounds.filter(
    (r) =>
      r.executionStatus !== "skipped_data_unavailable" &&
      (r.status !== "completed" || r.executionStatus !== "complete"),
  ).length;
  const omitted = events.filter((e) => e.kind === "data-unavailable");
  const rows = PERPS_STUDY_STRATEGIES.map((strategy) => {
    const view = accounts[strategy];
    const risk = paperRisk(view.account, view.attempts, now);
    const calls = rounds
      .flatMap((r) => Object.values(r.calls))
      .filter((c) =>
        strategy === "deepseek"
          ? c.lane === "direct"
          : strategy === "jev"
            ? c.lane !== "direct"
            : false,
      );
    const sum = (kind: string) =>
      d(view.movements.filter((m) => m.kind === kind).reduce((v, m) => v + u(m.delta), 0n));
    const metrics = events
      .filter((e) => e.kind === "observation")
      .map(
        (e) =>
          (e.data as Record<string, { risk: { equity: string | null; exposure: string | null } }>)[
            strategy
          ]?.risk,
      )
      .filter(Boolean);
    metrics.push(risk);
    let peak = u("1000"),
      maxDrawdown = 0n,
      maxExposure = 0n;
    for (const metric of metrics) {
      if (metric?.equity !== null && metric?.equity !== undefined) {
        const equity = u(metric.equity);
        peak = equity > peak ? equity : peak;
        const draw = peak > 0n ? ((peak - equity) * u("1")) / peak : 0n;
        maxDrawdown = draw > maxDrawdown ? draw : maxDrawdown;
      }
      if (metric?.exposure) {
        const exposure = u(metric.exposure);
        maxExposure = exposure > maxExposure ? exposure : maxExposure;
      }
    }
    const filled = view.attempts.filter((a) => a.status === "filled");
    const executionCosts = filled.map(
      (a) =>
        a.evidence as {
          slippageQuote?: string;
          spread?: string | null;
          consumed?: { quantity: string }[];
        },
    );
    const slippage = executionCosts.reduce((sum, e) => sum + u(e.slippageQuote ?? "0"), 0n);
    const halfSpread = executionCosts.reduce(
      (sum, e) =>
        sum +
        (e.spread
          ? (u(e.spread) *
              (e.consumed ?? []).reduce((quantity, l) => quantity + u(l.quantity), 0n)) /
            (2n * u("1"))
          : 0n),
      0n,
    );
    const costs = calls.reduce((v, c) => v + u(c.costUsd ?? "0"), 0n);
    const latency = calls
      .filter((c) => c.startedAt !== null && c.finishedAt !== null)
      .map((c) => c.finishedAt! - c.startedAt!);
    return {
      strategy,
      initialVirtualAUSD: "1000",
      cashVirtualAUSD: risk.cash,
      equityVirtualAUSD: risk.equity,
      returnVirtualPct: risk.equity === null ? null : d((u(risk.equity) - u("1000")) / 10n),
      maxDrawdownPct: d(maxDrawdown * 100n),
      exposureVirtualAUSD: risk.exposure,
      maxExposureVirtualAUSD: d(maxExposure),
      marginVirtualAUSD: risk.margin,
      reservedVirtualAUSD: risk.reserved,
      availableVirtualAUSD: risk.available,
      realizedPnlVirtualAUSD: sum("realized-pnl"),
      unrealizedPnlVirtualAUSD: risk.unrealized,
      feesVirtualAUSD: sum("fee"),
      fundingVirtualAUSD: sum("funding"),
      slippageVirtualAUSD: d(slippage),
      halfSpreadCostVirtualAUSD: d(halfSpread),
      fundingPending: view.account.fundingPending,
      fundingDisputed: !!view.account.fundingDisputed,
      openPositions: view.account.positions.filter((p) => p.closedAt === null).length,
      fills: filled.length,
      rejections: view.attempts.filter((a) => a.status !== "filled").length,
      riskExits: filled.filter((a) => a.key.includes(":risk:")).length,
      modelCalls: calls.filter((c) => c.startedAt !== null).length,
      modelCostEstimateUSD: d(costs),
      inputTokens: calls.reduce((sum, c) => sum + (c.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((sum, c) => sum + (c.outputTokens ?? 0), 0),
      unknownModelCosts: calls.filter((c) => c.startedAt !== null && c.costUsd === null).length,
      meanModelLatencyMs: latency.length
        ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length)
        : null,
    };
  });
  const direct = u(rows[1]!.modelCostEstimateUSD),
    routed = u(rows[2]!.modelCostEstimateUSD);
  const comparable =
    record.status === "completed" &&
    !record.stopRequested &&
    !record.decisionStopReason?.match(/FAIL|INTERRUPT|INCOMPLETE|UNVERIFIED/) &&
    incompleteRounds === 0 &&
    omitted.length === 0 &&
    unknownCalls.length === 0 &&
    unobservedMs === 0 &&
    rounds.length === 96 &&
    rows.every((r) => !r.fundingPending && !r.fundingDisputed && !r.openPositions);
  return {
    protocol: record.config.protocol,
    dataPolicy: record.dataPolicy ?? "legacy",
    config: record.config,
    metadata: record.metadata,
    status: record.status,
    startedAt: record.startedAt,
    endsAt: record.endsAt,
    stopReason: record.decisionStopReason,
    rounds: rounds.length,
    incompleteRounds,
    omittedRounds: omitted.length,
    omittedSlots: omitted.map((e) => e.data),
    unknownCalls: unknownCalls.length,
    unobservedMs,
    accountedOrReservedUSD: perpsAccountedUsd(rounds),
    observedModelSavingPct:
      unknownCalls.length || direct === 0n ? null : d(((direct - routed) * 100n * u("1")) / direct),
    comparable,
    profitabilityRanking: null,
    limitations: [
      "Virtual AUSD and model USD are separate units.",
      "Model cost is an estimate using pinned public upper tariffs, not an invoice.",
      "Funding uses the laboratory formula; liquidity is independent for each agent.",
      "No liquidation, signing, real orders, or on-chain activity.",
      "Twenty-four hours cannot establish profitability.",
      ...(!comparable ? ["Incomplete comparison: no profitability ranking."] : []),
    ],
    rows,
  };
}
const escape = (v: unknown) =>
  String(v ?? "unknown").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function renderPerpsReport(report: ReturnType<typeof perpsStudyReport>) {
  const fields = Object.keys(report.rows[0]!);
  const csvCell = (value: unknown) => {
    let s = String(value ?? "");
    if (/^[=+@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return `"${s.replaceAll('"', '""')}"`;
  };
  const csv =
    [
      fields.map(csvCell).join(","),
      ...report.rows.map((row) => fields.map((f) => csvCell(row[f as keyof typeof row])).join(",")),
    ].join("\n") + "\n";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Perpetual virtual comparison</title><style>body{font:16px system-ui;margin:32px;color:#142332;background:#f5f7fa}table{border-collapse:collapse;background:white}td,th{border:1px solid #ccc;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Perpetual virtual comparison</h1><p>Status: ${escape(report.status)}. Comparable: ${report.comparable}. Rounds: ${report.rounds}. Incomplete: ${report.incompleteRounds}. Data-unavailable: ${report.omittedRounds}. Unobserved milliseconds: ${report.unobservedMs}.</p><table><tr><th>Metric</th>${report.rows.map((r) => `<th>${escape(r.strategy)}</th>`).join("")}</tr>${fields.map((f) => `<tr><th>${escape(f)}</th>${report.rows.map((r) => `<td>${escape(r[f as keyof typeof r])}</td>`).join("")}</tr>`).join("")}</table><ul>${report.limitations.map((l) => `<li>${escape(l)}</li>`).join("")}</ul><details><summary>Configuration and protocol</summary><pre>${escape(JSON.stringify({ config: report.config, metadata: report.metadata }, null, 2))}</pre></details></html>`;
  return { html, csv };
}
