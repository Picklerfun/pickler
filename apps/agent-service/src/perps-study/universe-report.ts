import {
  hourlySmaTrace,
  type PerpsStudyView,
  type PerpsStudyMap,
  type PerpsProposal,
} from "@pickler/trading/evaluation";
import { paperUnits, paperDecimal, type PerpsPaperView } from "@pickler/trading/perps";
import { perpsStudyReport } from "./report.js";
type Packet = { study: PerpsStudyView; accounts: PerpsStudyMap<PerpsPaperView> };
const object = (v: unknown) => v as Record<string, unknown> | undefined;
const html = (v: unknown) =>
  String(v ?? "NOT_VERIFIABLE").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const csv = (v: unknown) => {
  let value = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
  if (/^[=+@\t\r]/.test(value) || (/^-/.test(value) && !/^-\d+(\.\d+)?$/.test(value))) {
    value = "'" + value;
  }
  return '"' + value.replaceAll('"', '""') + '"';
};
/** Offline rendering: exactly 8 x 11 x 3 decision identities, including missing slots. */
export function universeReport(
  packet: Packet,
  processState: string,
  providerAccounting: unknown = null,
) {
  const { record, rounds, events } = packet.study;
  if (record.config.version !== 5) {
    throw new Error("Universe report requires configuration v5");
  }
  const aggregate = perpsStudyReport(packet.study, packet.accounts);
  const rows = Array.from({ length: 8 }, (_, slot) =>
    record.config.version === 5
      ? record.config.markets.flatMap((m) =>
          (["rules", "sma-jev", "sma-exa-jev"] as const).map((variant) => {
            const round = rounds.find((r) => r.slot === slot);
            const context = round
              ? { evidence: round.evidence, account: round.accounts[variant]! }
              : null;
            const t = context ? hourlySmaTrace(context, m.symbol) : null;
            const originalEvent = object(
              events.find((e) => e.key === `${round?.key}:${variant}:original`)?.data,
            );
            const initial = (
              (originalEvent?.proposals as PerpsProposal[] | undefined) ?? round?.proposals[variant]
            )?.find((p) => p.symbol === m.symbol);
            const gate = object(
              events.find((e) => e.key === `${round?.key}:${variant}:final-gate`)?.data,
            );
            const final = (gate?.final as PerpsProposal[] | undefined)?.find(
              (p) => p.symbol === m.symbol,
            );
            const execution = events
              .filter((e) => e.kind === "execution")
              .map((e) => object(e.data))
              .find(
                (e) =>
                  e?.strategy === variant &&
                  object(e.proposal)?.symbol === m.symbol &&
                  events.some((x) => x.data === e && x.key.includes(round?.key ?? "impossible")),
              );
            const frame = round?.evidence.frames.find((f) => f.snapshot.market.symbol === m.symbol);
            const excluded = round?.evidence.excluded?.find((e) => e.symbol === m.symbol);
            const omission = object(
              events.find((e) => e.kind === "data-unavailable" && object(e.data)?.slot === slot)
                ?.data,
            );
            const missed = events.find(
              (e) => e.kind === "slot-missed" && object(e.data)?.slot === slot,
            );
            const calls = Object.values(round?.calls ?? {}).filter(
              (c) =>
                c.lane.endsWith(`:${m.symbol}`) &&
                (variant === "sma-jev"
                  ? c.lane.startsWith("sma-review:")
                  : variant === "sma-exa-jev"
                    ? !c.lane.startsWith("sma-review:")
                    : false),
            );
            return {
              slot,
              symbol: m.symbol,
              marketId: m.marketId,
              variant,
              status:
                excluded || omission
                  ? "DATA_UNAVAILABLE"
                  : (round?.executionStatus ??
                    (missed
                      ? "MISSED_SLOT"
                      : record.status === "completed" || record.status === "interrupted"
                        ? "NOT_EVALUATED"
                        : "SCHEDULED")),
              exclusion: excluded ?? omission ?? null,
              initialClock: round?.evidence.observedAt ?? null,
              tickerAt: frame?.snapshot.ticker.provenance.providerTimestamp ?? null,
              bookAt: frame?.book.provenance.providerTimestamp ?? null,
              frameHash: frame?.hash ?? null,
              mark: frame?.snapshot.ticker.mark ?? null,
              bid: frame?.book.bids[0]?.price ?? null,
              ask: frame?.book.asks[0]?.price ?? null,
              fees: frame?.snapshot.market.fees ?? null,
              funding: frame?.snapshot.funding ?? null,
              sma20: t?.sma20 ?? null,
              sma50: t?.sma50 ?? null,
              separationBps: t?.separationBps ?? null,
              initialAction: initial?.action ?? null,
              initialReason: initial?.reason ?? null,
              rank: object(initial)?.rank ?? null,
              finalAction: final?.action ?? null,
              finalReason: final?.reason ?? null,
              execution: execution ?? null,
              reviews: calls.map((c) => ({
                lane: c.lane,
                status: c.status,
                result: c.result,
                requestHash: c.requestHash,
                reservationUSD: c.reservationUsd,
                costUSD: c.costUsd,
                inputTokens: c.inputTokens,
                outputTokens: c.outputTokens,
                durationMs:
                  c.startedAt !== null && c.finishedAt !== null ? c.finishedAt - c.startedAt : null,
                error: c.error,
              })),
            };
          }),
        )
      : [],
  ).flat();
  const reservationsUSD = paperDecimal(
    rounds
      .flatMap((r) => Object.values(r.calls))
      .reduce((sum, c) => sum + paperUnits(c.reservationUsd), 0n),
  );
  const assetResults = record.config.markets.flatMap(({ symbol }) =>
    (["rules", "sma-jev", "sma-exa-jev"] as const).map((variant) => {
      const view = packet.accounts[variant]!;
      const positions = view.account.positions.filter((p) => p.symbol === symbol);
      const attempts = view.attempts.filter((a) => a.intent.symbol === symbol);
      const movements = view.movements.filter(
        (m) =>
          attempts.some((a) => m.key === `${a.key}:fee` || m.key === `${a.key}:pnl`) ||
          positions.some((p) => m.key.startsWith(`funding:${p.id}:`)),
      );
      const sum = (kind: string) =>
        paperDecimal(
          movements.filter((m) => m.kind === kind).reduce((a, m) => a + paperUnits(m.delta), 0n),
        );
      return {
        symbol,
        variant,
        fills: attempts.filter((a) => a.status === "filled").length,
        grossRealizedAUSD: sum("realized-pnl"),
        feesAUSD: sum("fee"),
        fundingAUSD: sum("funding"),
        netRealizedAUSD: paperDecimal(movements.reduce((a, m) => a + paperUnits(m.delta), 0n)),
        openPositions: positions.filter((p) => p.closedAt === null).length,
        accountFundingPending: view.account.fundingPending,
        positions,
        attempts,
        movements,
      };
    }),
  );
  const observations = events.filter((e) =>
    ["observation", "risk-close", "execution", "data-unavailable", "slot-missed"].includes(e.kind),
  );
  const fields = Object.keys(rows[0]!);
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SMA all-markets comparison</title><style>body{font:15px system-ui;margin:24px;background:#f4f6f9;color:#162333}table{border-collapse:collapse;background:white;margin-bottom:24px}td,th{border:1px solid #ccd3dc;padding:7px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{max-width:850px}section{overflow:auto}small{color:#526174}</style><h1>SMA / Jev / Exa — eleven markets</h1><p>Process: ${html(processState)}. Persisted status: ${html(record.status)}. Decisions: ${html(record.decisionStopReason ?? "no stop reason")}.</p><p>Virtual AUSD is separate from paid API USD. Reserved prospective calls: USD ${html(reservationsUSD)}. No real orders. Two hours provide exploratory evidence only.</p><section><table><tr><th>Variant</th><th>Gross realized AUSD</th><th>Fees AUSD</th><th>Funding AUSD</th><th>Net realized AUSD</th><th>Equity AUSD</th><th>Open</th><th>Funding pending</th><th>Jev calls</th><th>Exa calls</th><th>API cost USD</th></tr>${aggregate.rows.map((r) => `<tr>${[r.strategy, r.realizedPnlVirtualAUSD, r.feesVirtualAUSD, r.fundingVirtualAUSD, r.netRealizedPnlVirtualAUSD, r.equityVirtualAUSD, r.openPositions, r.fundingPending, r.modelCalls, r.exaCalls, paperDecimal(paperUnits(r.modelCostEstimateUSD) + paperUnits(r.exaReportedCostUSD))].map((v) => `<td>${html(v)}</td>`).join("")}</tr>`).join("")}</table></section><p>Missed/data-unavailable observations are not holds. Pending funding is not zero. Spread/slippage already affect fill prices and are not deducted again.</p><details><summary>Paid API accounting, checks and preserved history (USD)</summary><pre>${html(JSON.stringify(providerAccounting, null, 2))}</pre></details><section><table><tr><th>Asset</th><th>Variant</th><th>Fills</th><th>Gross realized AUSD</th><th>Fees AUSD</th><th>Funding AUSD</th><th>Net realized AUSD</th><th>Open</th></tr>${assetResults.map((r) => `<tr>${[r.symbol, r.variant, r.fills, r.grossRealizedAUSD, r.feesAUSD, r.fundingAUSD, r.netRealizedAUSD, r.openPositions].map((v) => `<td>${html(v)}</td>`).join("")}</tr>`).join("")}</table></section><section><table><tr><th>Slot</th><th>Asset</th><th>Variant</th><th>Status</th><th>SMA separation bps</th><th>Initial</th><th>Final</th><th>Evidence / reviews</th></tr>${rows.map((r) => `<tr>${[r.slot, r.symbol, r.variant, r.status, r.separationBps, `${r.initialAction ?? "—"}: ${r.initialReason ?? "—"}`, `${r.finalAction ?? "—"}: ${r.finalReason ?? "—"}`].map((v) => `<td>${html(v)}</td>`).join("")}<td><details><summary>Inspect</summary><pre>${html(JSON.stringify(r, null, 2))}</pre></details></td></tr>`).join("")}</table></section><details><summary>Observations and virtual execution details</summary><pre>${html(JSON.stringify(observations, null, 2))}</pre></details><details><summary>Frozen configuration / commit</summary><pre>${html(JSON.stringify({ config: record.config, metadata: record.metadata }, null, 2))}</pre></details></html>`;
  return {
    rows,
    assetResults,
    observations,
    reservationsUSD,
    html: body,
    csv:
      [
        fields.map(csv).join(","),
        ...rows.map((row) => fields.map((f) => csv(row[f as keyof typeof row])).join(",")),
      ].join("\n") + "\n",
  };
}
