import { join } from "node:path";
import type { QuantState } from "@pickler/core";
import { atomicWrite } from "./files.js";
export function quantRows(state: QuantState) {
  return state.cases.map((c) => {
    const f = c.forecast,
      p = f?.probabilities.find((p) => p.label === "Up");
    const settled = c.resolution;
    const binary =
      settled && (settled.numerator === "0" || settled.numerator === settled.denominator);
    const y = binary ? (settled!.numerator === settled!.denominator ? 1 : 0) : null;
    const input = c.input;
    const upBook = input?.books.find((b) => b.outcomeId === p?.outcomeId);
    const downId = f?.probabilities.find((p) => p.label === "Down")?.outcomeId;
    const downBook = input?.books.find((b) => b.outcomeId === downId);
    const bid = Number(upBook?.bids[0]?.price),
      ask = Number(upBook?.asks[0]?.price);
    const reference = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : null;
    return {
      market: c.marketId,
      kind: c.kind,
      status: c.status,
      reason: c.reason ?? "",
      up: p?.estimate ?? null,
      down: p ? 1 - p.estimate : null,
      lowerUp: p?.lower ?? null,
      upperUp: p?.upper ?? null,
      threshold: input?.opening.price ?? null,
      spot: input?.ticker.price ?? null,
      seconds: f?.horizonSeconds ?? null,
      tickerAgeSeconds: input && f ? (f.observedAt - input.ticker.observedAt) / 1000 : null,
      upBid: upBook?.bids[0]?.price ?? null,
      upAsk: upBook?.asks[0]?.price ?? null,
      downBid: downBook?.bids[0]?.price ?? null,
      downAsk: downBook?.asks[0]?.price ?? null,
      lowerDown: p ? 1 - p.upper : null,
      upperDown: p ? 1 - p.lower : null,
      proposedOutcome: c.proposal?.outcomeId ?? null,
      limitPrice: c.proposal?.limitPrice ?? null,
      edge: c.proposal?.conservativeEdge ?? null,
      jev: c.review?.status ?? "not_called",
      veto: c.review?.veto ?? null,
      jevDurationMs: c.review?.durationMs ?? null,
      quantity: c.fill?.quantity ?? null,
      averagePrice: c.fill?.averagePrice ?? null,
      fees: c.fill?.fees ?? null,
      cost: c.fill?.totalCost ?? null,
      outcome: binary ? (y === 1 ? "Up" : "Down") : settled ? "nonbinary" : "pending",
      payout: c.settlement?.payout ?? null,
      pnl: c.settlement?.realizedPnl ?? null,
      brier: y !== null && p ? (p.estimate - y) ** 2 : null,
      brier50: y !== null ? 0.25 : null,
      brierBook: y !== null && reference !== null ? (reference - y) ** 2 : null,
      bookProbability: reference,
      durationMs: c.finishedAt === null ? null : c.finishedAt - c.startedAt,
      inputTokens: c.review?.inputTokens ?? null,
      outputTokens: c.review?.outputTokens ?? null,
      estimatedApiUsd:
        c.review?.inputTokens != null
          ? (c.review.inputTokens * state.jevInputPerMillion) / 1e6
          : null,
      reservedUsd: c.reservedUsd,
    };
  });
}
export async function saveQuant(directory: string, state: QuantState) {
  await atomicWrite(join(directory, "state.json"), JSON.stringify(state, null, 2));
  const rows = quantRows(state),
    keys = Object.keys(rows[0] ?? { market: "", status: "" });
  const escape = (v: unknown) =>
    String(v ?? "—").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const csv = (v: unknown) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  await atomicWrite(
    join(directory, "results.csv"),
    [
      keys.join(","),
      ...rows.map((row) => keys.map((k) => csv(row[k as keyof typeof row])).join(",")),
    ].join("\n"),
  );
  const summaries = ["btc-5m", "btc-15m"].map((kind) => {
    const group = rows.filter((r) => r.kind === kind),
      scored = group.filter((r) => r.brier !== null),
      comparable = scored.filter((r) => r.brierBook !== null);
    const mean = (key: "brier" | "brier50" | "brierBook") => {
      const v = scored.map((r) => r[key]).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return {
      kind,
      cases: group.length,
      resolved: scored.length,
      filled: group.filter((r) => r.status === "filled").length,
      brier: mean("brier"),
      brier50: mean("brier50"),
      brierBook: mean("brierBook"),
      bookComparisonCount: comparable.length,
      modelBrierOnBookSubset: comparable.length
        ? comparable.reduce((sum, r) => sum + r.brier!, 0) / comparable.length
        : null,
    };
  });
  await atomicWrite(
    join(directory, "summary.json"),
    JSON.stringify(
      {
        protocol: state.protocol,
        summaries,
        priorReservedUsd: state.priorReservedUsd,
        reservedUsd: rows.reduce((a, r) => a + r.reservedUsd, 0),
        paidStopped: state.paidStopped,
        warning:
          "Overlapping windows are dependent. Experimental uncalibrated estimates; no profitability claim.",
      },
      null,
      2,
    ),
  );
  await atomicWrite(
    join(directory, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>BTC quantitative paper study</title><style>body{background:#101218;color:#e7eaf1;font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{padding:10px;border:1px solid #39404b;max-width:350px;overflow-wrap:anywhere}th{position:sticky;top:0;background:#222833}.scroll{overflow:auto}pre{white-space:pre-wrap}</style><h1>BTC quantitative + Jev paper study</h1><p>${escape(state.id)} · Virtual funds only · Paid stop: ${state.paidStopped}</p><p>Coinbase predicts; finalized Polygon resolves. Sensitivity bounds are assumptions. No DeepSeek or Exa calls. Overlapping windows are dependent.</p><pre>${escape(JSON.stringify(summaries, null, 2))}</pre><div class="scroll"><table><tr>${keys.map((k) => `<th>${escape(k)}</th>`).join("")}</tr>${rows.map((row) => `<tr>${keys.map((k) => `<td>${escape(row[k as keyof typeof row])}</td>`).join("")}</tr>`).join("")}</table></div></html>`,
  );
}
