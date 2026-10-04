import { smaAblationProposal } from "../perps-strategies/sma-ablation.js";
import { paperRisk } from "../perps-paper/policy.js";
import { paperUnits as u, paperDecimal as d } from "../perps-paper/decimal.js";
import type { PerpsPaperView } from "../perps-paper/types.js";
import { PERPS_SMA_STRATEGIES, type PerpsStudyView, type PerpsStudyMap } from "./types.js";
import { PilotError } from "@pickler/core";

export function smaStudyReport(
  study: PerpsStudyView,
  accounts: PerpsStudyMap<PerpsPaperView>,
  now: number,
) {
  if (study.record.config.version !== 3) {
    throw new PilotError("INVALID_INPUT", "SMA protocol required");
  }
  const rows = Array.from({ length: 24 }, (_, slot) => {
    const round = study.rounds.find((r) => r.slot === slot);
    const omission = study.events.find(
      (e) => e.kind === "data-unavailable" && (e.data as { slot?: number }).slot === slot,
    );
    const missed = study.events.find(
      (e) => e.kind === "slot-missed" && (e.data as { slot?: number }).slot === slot,
    );
    const scheduledAt =
      study.record.startedAt === null ? null : study.record.startedAt + slot * 900000;
    return (["BTC", "ETH"] as const).flatMap((symbol) =>
      PERPS_SMA_STRATEGIES.map((variant) => {
        const initial = study.events.find((e) => e.key === `${round?.key}:${variant}:initial`);
        const choice = (
          initial?.data as
            | {
                choices?: {
                  proposal: { symbol: string; action: string; reason: string };
                  trace: unknown;
                }[];
              }
            | undefined
        )?.choices?.find((c) => c.proposal.symbol === symbol);
        const final = study.events.find(
          (e) => e.key === `${round?.key}:${variant}:${symbol}:final-gate`,
        );
        const execution = study.events.find((e) => e.key === `${variant}:${round?.key}:${symbol}`);
        const status = omission
          ? "DATA_UNAVAILABLE"
          : missed
            ? "WINDOW_MISSED"
            : round
              ? round.executionStatus
              : scheduledAt === null || now <= scheduledAt + 30000
                ? "PENDING"
                : "NOT_ADMITTED";
        return {
          slot,
          symbol,
          variant,
          scheduledAt,
          status,
          phase: omission?.data ?? null,
          initial: choice ?? null,
          final: final?.data ?? null,
          execution: execution?.data ?? null,
          evidenceAt: round?.evidence?.observedAt ?? null,
        };
      }),
    );
  }).flat();
  const metrics = PERPS_SMA_STRATEGIES.map((variant) => {
    const view = accounts[variant];
    if (!view) {
      throw new PilotError("NOT_FOUND", "SMA account missing");
    }
    const risk = paperRisk(view.account, view.attempts, now);
    const sum = (kind: string) =>
      view.movements.filter((m) => m.kind === kind).reduce((v, m) => v + u(m.delta), 0n);
    const knownFunding = !view.account.fundingPending && !view.account.fundingDisputed;
    const realized = sum("realized-pnl"),
      fees = sum("fee"),
      funding = sum("funding");
    let peak = u("1000"),
      maxDrawdown = 0n;
    let verifiedMarks = 0;
    for (const e of study.events.filter((e) => e.kind === "observation")) {
      const point = (
        e.data as Record<
          string,
          { risk?: { equity?: string | null }; fundingPending?: boolean; fundingDisputed?: boolean }
        >
      )[variant];
      const equity = point?.risk?.equity;
      if (
        equity === null ||
        equity === undefined ||
        point?.fundingPending ||
        point?.fundingDisputed
      ) {
        continue;
      }
      verifiedMarks++;
      const value = u(equity);
      peak = value > peak ? value : peak;
      const draw = peak > 0n ? ((peak - value) * u("1")) / peak : 0n;
      maxDrawdown = draw > maxDrawdown ? draw : maxDrawdown;
    }
    const positions = view.account.positions;
    return {
      variant,
      initialVirtualAUSD: "1000",
      opens: view.attempts.filter((a) => a.status === "filled" && a.intent.kind === "open").length,
      closes: view.attempts.filter((a) => a.status === "filled" && a.intent.kind === "close")
        .length,
      holds: rows.filter(
        (r) =>
          r.variant === variant && r.status === "complete" && r.initial?.proposal.action === "hold",
      ).length,
      realizedPnlAUSD: d(realized),
      feesAUSD: d(-fees),
      reconciledFundingAUSD: d(funding),
      fundingPending: !knownFunding,
      netRealizedCashPnlAUSD: knownFunding ? d(realized + fees + funding) : null,
      equityAUSD: knownFunding ? risk.equity : null,
      unrealizedAUSD: risk.unrealized,
      exposureAUSD: risk.exposure,
      returnOnInitialCapitalPct:
        knownFunding && risk.equity !== null ? d((u(risk.equity) - u("1000")) / 10n) : null,
      observedMarkedDrawdownPct: verifiedMarks ? d(maxDrawdown * 100n) : null,
      verifiedMarks,
      closedHoldingMs: positions
        .filter((p) => p.closedAt !== null)
        .map((p) => p.closedAt! - p.openedAt),
      pendingPositions: positions.filter((p) => p.closedAt === null),
      attempts: view.attempts,
      movements: view.movements,
    };
  });
  // Proposal diagnostic on identical original inputs; never a simulated portfolio or P&L.
  const commonInputProposals = study.rounds
    .filter((r) => r.executionStatus === "complete")
    .map((r) => {
      const account = r.accounts["sma-hourly"];
      if (!account || !r.evidence) {
        return { slot: r.slot, status: "NOT_VERIFIABLE", variants: null };
      }
      return {
        slot: r.slot,
        status: "VERIFIED",
        referencePortfolio: "sma-hourly",
        variants: Object.fromEntries(
          PERPS_SMA_STRATEGIES.map((variant) => [
            variant,
            smaAblationProposal({ evidence: r.evidence!, account }, variant),
          ]),
        ),
      };
    });
  const commonSlots = study.rounds
    .filter((r) => r.executionStatus === "complete")
    .map((r) => r.slot);
  return {
    version: 1,
    protocol: "perps-sma-ablation-report-v1",
    sessionId: study.record.config.sessionId,
    status: study.record.status,
    stopReason: study.record.decisionStopReason,
    startedAt: study.record.startedAt,
    endsAt: study.record.endsAt,
    graceUntil: study.record.graceUntil,
    metadata: study.record.metadata,
    configuration: study.record.config,
    commonSlots,
    commonInputProposals,
    rows,
    metrics,
    observations: study.events.filter((e) =>
      ["observation", "observation-failed", "evidence-failed", "execution-failed"].includes(e.kind),
    ),
    evidenceSnapshots: study.rounds.map((r) => ({
      slot: r.slot,
      evidence: r.evidence,
      originalAccounts: r.accounts,
    })),
    executionSnapshots: study.events.filter((e) =>
      ["execution-input", "execution", "final-policy-gate"].includes(e.kind),
    ),
    modelCalls: study.rounds.flatMap((r) => Object.values(r.calls)).length,
    modelCostUsd: "0",
    newModelReservationsUsd: "0",
    limitations: [
      "Six hours are exploratory and cannot establish profitability.",
      "Hourly entries use common multiframe exits; this is not the complete historical strategy.",
      "Portfolios evolve independently; economic differences cannot be attributed to one round.",
      "Common-input proposals use the original hourly account, without hypothetical carry or counterfactual P&L.",
      "Missing funding stays unknown. Omitted slots are not holds or zero-return controls.",
      "Drawdown uses verified sampled marked equity, not continuous valuation.",
    ],
  };
}
