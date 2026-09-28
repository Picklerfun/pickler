import { join } from "node:path";
import {
  comparisonReserved,
  comparisonReviews,
  COMPARISON_POLICIES,
  quantProposal,
  type ComparisonState,
  type QuantState,
} from "@pickler/core";
import { atomicWrite } from "./files.js";

export function replayComparison(state: QuantState) {
  if (state.version !== 2 || state.protocol !== "btc-quant-jev-v1") {
    throw new Error("REPLAY_EXPECTS_QUANT_V2");
  }
  return state.cases
    .filter((r) => r.input && r.forecast)
    .map((r) => ({
      marketId: r.marketId,
      kind: r.kind,
      observedAt: r.forecast!.observedAt,
      policies: COMPARISON_POLICIES.map((policy) => ({
        policy,
        ...quantProposal(r.input!, r.forecast!, r.forecast!.observedAt, policy),
      })).map(({ policy, proposal, reasons }) => ({
        policy,
        reasons,
        proposal: proposal
          ? {
              outcomeId: proposal.outcomeId,
              limitPrice: proposal.limitPrice,
              centralEdge: proposal.centralEdge,
              conservativeEdge: proposal.conservativeEdge,
              decisionEdge: proposal.decisionEdge,
              effectiveCost: proposal.effectiveCost,
            }
          : null,
      })),
    }));
}
export function comparisonSummary(state: ComparisonState) {
  const reviews = comparisonReviews(state);
  return {
    protocol: state.protocol,
    originalCeilingUsd: 5,
    priorReservedUsd: state.priorReservedUsd,
    reservedUsd: comparisonReserved(state),
    reviews: reviews.length,
    inputTokens: reviews.reduce((s, r) => s + (r.result?.inputTokens ?? 0), 0),
    outputTokens: reviews.reduce((s, r) => s + (r.result?.outputTokens ?? 0), 0),
    unknownUsage: reviews.filter((r) => r.result?.inputTokens == null).length,
    estimatedUsd: reviews.reduce(
      (s, r) => s + ((r.result?.inputTokens ?? 0) * state.jevInputPerMillion) / 1e6,
      0,
    ),
    paidStopped: state.paidStopped,
    probe: state.probe
      ? {
          status: state.probe.status,
          policies: state.probe.policies.map((p) => ({
            policy: p.policy,
            status: p.status,
            settled: !!p.settlement,
            reasons: p.reasons,
          })),
        }
      : null,
    slots: state.slots.map((s) => ({ ...s })),
    policies: COMPARISON_POLICIES.map((policy) => {
      const decisions = state.cases.flatMap((r) => r.policies.filter((p) => p.policy === policy));
      return {
        policy,
        proposed: decisions.filter((d) => d.proposal).length,
        filled: decisions.filter((d) => d.fill).length,
        blocked: decisions.filter((d) => d.status === "blocked").length,
        abstained: decisions.filter((d) => d.status === "abstained").length,
        settled: decisions.filter((d) => d.settlement).length,
        realizedVirtualPnl: decisions.reduce(
          (s, d) => s + Number(d.settlement?.realizedPnl ?? 0),
          0,
        ),
      };
    }),
    forecasts: (["btc-5m", "btc-15m"] as const).map((kind) => {
      const rows = state.cases.filter((r) => r.kind === kind && r.forecast);
      const scored = rows.flatMap((r) => {
        const up = r.forecast!.probabilities.find((p) => p.label === "Up")!;
        const resolution = r.resolutions.find((v) => v.outcomeId === up.outcomeId);
        if (
          !resolution ||
          (resolution.numerator !== "0" && resolution.numerator !== resolution.denominator)
        ) {
          return [];
        }
        const actual = resolution.numerator === "0" ? 0 : 1;
        const book = r.input!.books.find((b) => b.outcomeId === up.outcomeId);
        const ask = book?.asks.length ? Math.min(...book.asks.map((l) => Number(l.price))) : NaN;
        const bid = book?.bids.length ? Math.max(...book.bids.map((l) => Number(l.price))) : NaN;
        const midpoint = (ask + bid) / 2;
        return [
          {
            model: (up.estimate - actual) ** 2,
            book: Number.isFinite(midpoint) && bid <= ask ? (midpoint - actual) ** 2 : null,
          },
        ];
      });
      const matched = scored.filter((s) => s.book !== null);
      return {
        kind,
        forecasts: rows.length,
        scored: scored.length,
        pending: rows.filter(
          (r) =>
            !r.resolutions.some(
              (v) =>
                v.outcomeId === r.forecast!.probabilities.find((p) => p.label === "Up")!.outcomeId,
            ),
        ).length,
        brier: scored.length ? scored.reduce((s, v) => s + v.model, 0) / scored.length : null,
        baseline50: scored.length ? 0.25 : null,
        matchedQuotes: matched.length,
        bookBrier: matched.length
          ? matched.reduce((s, v) => s + v.book!, 0) / matched.length
          : null,
        modelBrierOnQuoteSubset: matched.length
          ? matched.reduce((s, v) => s + v.model, 0) / matched.length
          : null,
      };
    }),
  };
}
export function comparisonReport(state: ComparisonState) {
  const summary = comparisonSummary(state);
  const headers = [
    "Market",
    "Kind",
    "UTC",
    "Policy",
    "Up probability / bounds",
    "Down probability / bounds",
    "Threshold",
    "Reference",
    "Ticker age ms (signed)",
    "Candle age ms",
    "Remaining seconds",
    "Outcome",
    "Central edge",
    "Conservative edge",
    "Decision edge",
    "Limit",
    "Review ID",
    "Review",
    "Status",
    "Reason",
    "Quantity",
    "Average price",
    "Fees",
    "Virtual cost",
    "Official resolution",
    "Payout",
    "Virtual P&L",
    "Duration ms",
  ];
  const rows = state.cases.flatMap((r) =>
    r.policies.map((d) => [
      r.marketId,
      r.kind,
      new Date(r.startedAt).toISOString(),
      d.policy,
      JSON.stringify(r.forecast?.probabilities[0] ?? null),
      JSON.stringify(r.forecast?.probabilities[1] ?? null),
      r.input?.opening.price ?? "",
      r.input?.ticker.price ?? "",
      r.input ? (r.forecast ? r.forecast.observedAt - r.input.ticker.observedAt : "") : "",
      r.input ? r.input.observedAt - (r.input.candles.at(-1)!.time + 60000) : "",
      r.forecast?.horizonSeconds ?? "",
      d.proposal?.outcomeId ?? "",
      d.proposal?.centralEdge ?? "",
      d.proposal?.conservativeEdge ?? "",
      d.proposal?.decisionEdge ?? "",
      d.proposal?.limitPrice ?? "",
      d.reviewId ?? "",
      JSON.stringify(r.reviews.find((v) => v.id === d.reviewId)?.result ?? null),
      d.status,
      d.reasons.join(";") || r.reason || "",
      d.fill?.quantity ?? "",
      d.fill?.averagePrice ?? "",
      d.fill?.fees ?? "",
      d.fill?.totalCost ?? "",
      JSON.stringify(r.resolutions),
      d.settlement?.payout ?? "",
      d.settlement?.realizedPnl ?? "",
      r.finishedAt ? r.finishedAt - r.startedAt : "",
    ]),
  );
  const escape = (v: unknown) =>
    String(v).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map(
          (v) =>
            `"${(/^[=+\-@\t\r]/.test(String(v)) ? "'" : "") + String(v).replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\n");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="30"><title>BTC policy comparison</title><style>body{font:15px system-ui;background:#101412;color:#eef3ef;padding:24px}section{overflow:auto}td,th{padding:12px;border-bottom:1px solid #465047;white-space:nowrap;text-align:left}th,a{color:#c8ee72}pre{white-space:pre-wrap}</style><h1>BTC · ${escape(state.id)}</h1><p>Virtual alternatives on shared forecasts. No real orders. Ten virtual units per purchase. Experimental, uncalibrated probabilities; overlapping windows are dependent. Two hours cannot establish profitability.</p><p>Synthetic probe excluded from live metrics. Brier is counted once per forecast. Known token estimates and reserved limits are different measures; unknown usage remains reserved.</p><p><a href="results.csv">CSV</a> · <a href="state.json">Evidence</a> · <a href="requests.json">Public request diagnostics</a></p><pre>${escape(JSON.stringify(summary, null, 2))}</pre><section><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></section></html>`;
  return { csv, html, summary };
}
export async function saveComparison(directory: string, state: ComparisonState) {
  await atomicWrite(join(directory, "state.json"), JSON.stringify(state, null, 2));
  const report = comparisonReport(state);
  await atomicWrite(join(directory, "results.csv"), report.csv);
  await atomicWrite(join(directory, "index.html"), report.html);
  await atomicWrite(join(directory, "summary.json"), JSON.stringify(report.summary, null, 2));
}
