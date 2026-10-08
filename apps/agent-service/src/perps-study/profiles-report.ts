import {
  SMA_PROFILE_VARIANTS,
  profileSmaTrace,
  profileDescriptor,
  canonicalAudit,
  type PerpsStudyView,
  type PerpsStudyMap,
  type PerpsProposal,
  type PerpsEvidence,
} from "@pickler/trading/evaluation";
import { paperUnits as u, paperDecimal as d, type PerpsPaperView } from "@pickler/trading/perps";
import { perpsStudyReport } from "./report.js";
import { createHash } from "node:crypto";
type Packet = { study: PerpsStudyView; accounts: PerpsStudyMap<PerpsPaperView> };
const escape = (v: unknown) =>
  String(v ?? "NOT_VERIFIABLE").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const csv = (v: unknown) => {
  let s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s))) {
    s = "'" + s;
  }
  return '"' + s.replaceAll('"', '""') + '"';
};
export function renderProfileReport(
  packet: Packet,
  summary: ReturnType<typeof perpsStudyReport> & { reportCommit?: string },
  processState: string,
) {
  const { record, rounds, events } = packet.study;
  if (record.config.version !== 6) {
    throw new Error("Profile report requires v6");
  }
  const config = record.config;
  if (rounds.some((r) => Object.keys(r.calls).length > 0)) {
    throw new Error("Model calls are forbidden in profile reports");
  }
  const rows = Array.from({ length: 72 }, (_, slot) =>
    config.markets.flatMap((m) =>
      SMA_PROFILE_VARIANTS.map((variant) => {
        const round = rounds.find((r) => r.slot === slot);
        const context = round?.accounts[variant]
          ? { evidence: round.evidence, account: round.accounts[variant]! }
          : null;
        const trace = context
          ? profileSmaTrace(context, m.symbol, profileDescriptor(variant).trendResolution)
          : null;
        const initial = round?.proposals[variant]?.find((p) => p.symbol === m.symbol);
        const gate = events.find((e) => e.key === `${round?.key}:${variant}:final-gate`)?.data as
          { final: PerpsProposal[] } | undefined;
        const final = gate?.final.find((p) => p.symbol === m.symbol);
        const input = (
          events.find((e) => e.key === `${round?.key}:final-evidence`)?.data as
            { evidence?: PerpsEvidence } | undefined
        )?.evidence;
        const exclusion = [...(round?.evidence.excluded ?? []), ...(input?.excluded ?? [])].filter(
          (e) => e.symbol === m.symbol,
        );
        const omission = events.find(
          (e) => e.kind === "data-unavailable" && (e.data as { slot: number }).slot === slot,
        )?.data;
        const missed = events.some(
          (e) => e.kind === "slot-missed" && (e.data as { slot: number }).slot === slot,
        );
        const executions = events
          .filter(
            (e) =>
              e.kind === "profile-execution" &&
              (e.data as { slot: number; variant: string; symbol: string }).slot === slot &&
              (e.data as { variant: string }).variant === variant &&
              (e.data as { symbol: string }).symbol === m.symbol,
          )
          .map((e) => e.data);
        const frame = round?.evidence.frames.find((f) => f.snapshot.market.symbol === m.symbol);
        const confirmation = round?.evidence.candles
          .find((s) => s.market.symbol === m.symbol && s.resolution === 300)
          ?.candles.at(-1);
        return {
          slot,
          symbol: m.symbol,
          marketId: m.marketId,
          variant,
          status:
            exclusion.length || omission
              ? "DATA_UNAVAILABLE"
              : (round?.executionStatus ??
                (missed
                  ? "MISSED_SLOT"
                  : ["completed", "interrupted"].includes(record.status)
                    ? "NOT_EVALUATED"
                    : "SCHEDULED")),
          initialClock: round?.evidence.observedAt ?? null,
          initialEvidenceHash: round
            ? createHash("sha256").update(canonicalAudit(round.evidence)).digest("hex")
            : null,
          finalEvidenceHash: input
            ? createHash("sha256").update(canonicalAudit(input)).digest("hex")
            : null,
          profile: profileDescriptor(variant),
          sma20: trace?.sma20 ?? null,
          sma50: trace?.sma50 ?? null,
          separationBps: trace?.separationBps ?? null,
          confirmation: confirmation
            ? {
                openTime: confirmation.openTime,
                open: confirmation.open,
                close: confirmation.close,
              }
            : null,
          mark: frame?.snapshot.ticker.mark ?? null,
          tickerAt: frame?.snapshot.ticker.provenance.providerTimestamp ?? null,
          bookAt: frame?.book.provenance.providerTimestamp ?? null,
          fees: frame?.snapshot.market.fees ?? null,
          funding: frame?.snapshot.funding ?? null,
          initialAction: initial?.action ?? null,
          initialReason: initial?.reason ?? null,
          initialTrace: initial ?? null,
          finalAction: final?.action ?? null,
          finalReason: final?.reason ?? null,
          executions,
          exclusions: exclusion,
          omission: omission ?? null,
        };
      }),
    ),
  ).flat();
  const headers = Object.keys(rows[0]!);
  const roundsCsv =
    [
      headers.map(csv).join(","),
      ...rows.map((r) => headers.map((k) => csv(r[k as keyof typeof r])).join(",")),
    ].join("\n") + "\n";
  const aggregateKeys = Object.keys(summary.rows[0]!);
  const aggregateCsv =
    [
      aggregateKeys.map(csv).join(","),
      ...summary.rows.map((r) => aggregateKeys.map((k) => csv(r[k as keyof typeof r])).join(",")),
    ].join("\n") + "\n";
  // Decision slots stop at 71; risk observations and final exits may continue in the grace window.
  const executions = events
    .filter((e) => e.kind === "profile-execution")
    .map((e) => ({ eventKey: e.key, eventAt: e.at, ...(e.data as Record<string, unknown>) }));
  const observations = events.filter((e) =>
    ["observation", "observation-failed", "observation-missed", "selective-reduction"].includes(
      e.kind,
    ),
  );
  const eventCsv = (values: object[]) => {
    const keys = [...new Set(values.flatMap((row) => Object.keys(row)))];
    return (
      [
        keys.map(csv).join(","),
        ...values.map((row) =>
          keys.map((key) => csv((row as Record<string, unknown>)[key])).join(","),
        ),
      ].join("\n") + "\n"
    );
  };
  const table = (data: object[]) => {
    if (!data.length) {
      return "<p>No observations.</p>";
    }
    const keys = Object.keys(data[0]!);
    return `<table><thead><tr>${keys.map((k) => `<th>${escape(k)}</th>`).join("")}</tr></thead><tbody>${data.map((row) => `<tr>${keys.map((k) => `<td>${escape(typeof (row as Record<string, unknown>)[k] === "object" ? JSON.stringify((row as Record<string, unknown>)[k]) : (row as Record<string, unknown>)[k])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  const completeSlots = rounds
    .filter((r) => r.executionStatus === "complete" && r.status === "completed")
    .map((r) => r.slot);
  const common = rows.filter((r) => completeSlots.includes(r.slot) && r.status === "complete");
  const comparisons = [
    ["hourly-selective", "hourly-legacy"],
    ["fast-selective", "fast-legacy"],
    ["fast-legacy", "hourly-legacy"],
    ["fast-selective", "hourly-selective"],
    ["fast-selective", "hourly-legacy"],
  ].map(([variant, reference]) => ({
    variant,
    reference,
    validCommonAssetSlots: common.filter((r) => r.variant === variant).length,
    initialOpenProposals: common.filter(
      (r) => r.variant === variant && r.initialAction?.startsWith("open-"),
    ).length,
    referenceInitialOpenProposals: common.filter(
      (r) => r.variant === reference && r.initialAction?.startsWith("open-"),
    ).length,
    observedNetRealizedDifferenceAUSD: (() => {
      const left = summary.rows.find((r) => r.strategy === variant),
        right = summary.rows.find((r) => r.strategy === reference);
      return left && right
        ? d(u(left.netRealizedPnlVirtualAUSD) - u(right.netRealizedPnlVirtualAUSD))
        : null;
    })(),
    observedFeeCostDifferenceAUSD: (() => {
      const left = summary.rows.find((r) => r.strategy === variant),
        right = summary.rows.find((r) => r.strategy === reference);
      return left && right ? d(u(right.feesVirtualAUSD) - u(left.feesVirtualAUSD)) : null;
    })(),
    note: "Common valid decision identities only in proposal counts. Economic totals are separately evolving portfolios, including all actual fills; not a per-slot causal attribution.",
  }));
  const riskSummary = SMA_PROFILE_VARIANTS.map((variant) => {
    const executions = events
      .filter((e) => e.kind === "profile-execution")
      .map(
        (e) =>
          e.data as {
            variant: string;
            action: string;
            status: string;
            reason: string;
            openSymbolsAfter: string[];
            before: { reasons: string[] };
          },
      )
      .filter((e) => e.variant === variant && e.action === "close" && e.status === "filled");
    const reductions = events
      .filter((e) => e.kind === "selective-reduction")
      .map(
        (e) =>
          e.data as {
            variant: string;
            observationKey: string;
            legacyCloseRequestsOnSamePortfolio: string[];
            plan: { status: string };
          },
      )
      .filter((e) => e.variant === variant && e.plan.status === "planned");
    const first = [
      ...new Map(
        reductions
          .slice()
          .reverse()
          .map((e) => [e.observationKey, e]),
      ).values(),
    ];
    const selective = executions.filter((e) => e.reason === "SELECTIVE_EXPOSURE");
    return {
      variant,
      collectiveExposureCloses: executions.filter(
        (e) => e.reason === "RISK_EXIT" && e.before.reasons.includes("EXPOSURE_LIMIT"),
      ).length,
      selectiveReductionObservations: first.length,
      legacyCloseRequestsOnSameSelectivePortfolios: first.reduce(
        (n, e) => n + e.legacyCloseRequestsOnSamePortfolio.length,
        0,
      ),
      confirmedSelectiveFullCloses: selective.length,
      positionsRetainedAfterLastSelectiveClose: selective.at(-1)?.openSymbolsAfter ?? null,
      note: "Same-portfolio requests are immediate risk projections, not future P&L for retained positions. Independently evolving portfolios are not interchangeable controls.",
    };
  });
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SMA profiles and selective risk</title><style>body{font:15px system-ui;background:#101721;color:#e8edf4;margin:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:9px;border:1px solid #344353;text-align:left;vertical-align:top}th{background:#1c2938;position:sticky;top:0}section{overflow:auto;margin:25px 0}details{margin:16px 0}input{padding:10px;width:300px;background:#fff;color:#111}p{max-width:1000px}a{color:#91c8ff}</style><h1>SMA profiles and selective risk</h1><p>State: <strong>${escape(processState)}</strong>; persisted: ${escape(record.status)}. Study commit: ${escape((record.metadata as { commit?: string }).commit)}. Report commit: ${escape(summary.reportCommit ?? (record.metadata as { commit?: string }).commit)}. New model calls / tokens / API USD / model reserves: <strong>0 / 0 / 0 / 0</strong>.</p><p>Six hours are exploratory. Historical samples are context, not paired controls. SMA separation is not a probability of profit. Spread and slippage are already included in fill prices and are not subtracted again. Unknown marks, positions and funding remain pending.</p><section>${table(summary.rows)}</section><h2>Comparison coverage</h2><section>${table(comparisons)}</section><p>${completeSlots.length}/72 completed slots. ${rows.filter((r) => r.status === "DATA_UNAVAILABLE").length} unavailable decision identities; ${rows.filter((r) => r.status === "MISSED_SLOT").length} missed identities. Net realized AUSD and API USD are separate units. Portfolio outcomes include every confirmed trade; paired decision coverage excludes omitted assets.</p><h2>Decisions: ${rows.length} identities</h2><input id="filter" placeholder="Filter market, variant, reason…"><section id="decisions">${table(rows.map((r) => ({ slot: r.slot, symbol: r.symbol, variant: r.variant, status: r.status, sma20: r.sma20, sma50: r.sma50, separationBps: r.separationBps, confirmation: r.confirmation, initialAction: r.initialAction, initialReason: r.initialReason, finalAction: r.finalAction, finalReason: r.finalReason, executions: r.executions })))}</section><details><summary>All executions, including final exits</summary><p>Execution events include the closing grace window and are separate from the 72 admission slots. <a href="executions.csv">Execution CSV</a> · <a href="executions.json">Execution JSON</a></p><section>${table(executions)}</section></details><details><summary>Risk observations, missed observations and selective projections</summary><p><a href="observations.csv">Observation CSV</a> · <a href="observations.json">Observation JSON</a></p><section>${table(observations)}</section></details><details><summary>Full provenance</summary><pre>${escape(JSON.stringify({ record, comparisons }, null, 2))}</pre></details><script>document.getElementById('filter').addEventListener('input',function(){const q=this.value.toLowerCase();document.querySelectorAll('#decisions tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q));});</script></html>`;
  return {
    rows,
    comparisons,
    riskSummary,
    executions,
    executionsCsv: eventCsv(executions),
    observations,
    observationsCsv: eventCsv(observations),
    html: html.replace(
      "<h2>Comparison coverage</h2>",
      `<h2>Risk reduction</h2><section>${table(riskSummary)}</section><h2>Comparison coverage</h2>`,
    ),
    csv: aggregateCsv,
    roundsCsv,
  };
}
