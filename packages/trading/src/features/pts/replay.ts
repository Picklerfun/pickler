import { ptsProposals } from "./proposals.js";
import { profileProposals } from "../perps-study/profiles.js";
import { units, decimal } from "./math.js";
import { ptsQuantityAtBlock } from "./account.js";
import { PilotError } from "@pickler/core";
import { inspectPtsHistory } from "./inspection.js";
import { PTS_CATALOG, type PerpsPtsConfig } from "./policy.js";
import { PTS_VERSION, PTS_VARIANTS, type PtsReplayInput } from "./types.js";

import {
  ptsVariants,
  ptsVariant,
  ptsTemporalProfile,
  ptsCandidateVersion,
} from "./temporal-profile.js";
import { createProfileStudyRunner } from "../evaluation/profile-runner.js";
import type {
  PerpsStudyView,
  PerpsStudyRepository,
  PerpsEvidence,
  PerpsStudyLease,
} from "../perps-study/types.js";
import { initialPaperAccount, applyPaperFill, paperRisk } from "../perps-paper/policy.js";
import { applyPaperObservation, simulatePerpsFill } from "../perps-paper/simulation.js";
import type {
  PerpsPaperRepository,
  PerpsPaperView,
  PerpsPaperScope,
} from "../perps-paper/types.js";
export function assertPtsReplay(input: PtsReplayInput) {
  if (
    input.format !== "perps-pts-history-v1" ||
    (input.candidate !== undefined &&
      input.candidate !== "pts-intraday@0.1.0" &&
      input.candidate !== "pts-intraday@0.2.0-fast.1") ||
    !Number.isSafeInteger(input.from) ||
    !Number.isSafeInteger(input.to) ||
    input.to <= input.from ||
    input.to - input.from > 31 * 86400000 ||
    !Number.isSafeInteger(input.capturedAt) ||
    input.to > input.capturedAt ||
    !Array.isArray(input.markets) ||
    input.markets.length > 11 ||
    new Set(input.markets.map((h) => h.market.marketId)).size !== input.markets.length ||
    input.markets.some(
      (h) =>
        h.market.provenance.provider !== "perpl" ||
        !PTS_CATALOG.some((m) => m.symbol === h.market.symbol && m.marketId === h.market.marketId),
    )
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "A bounded, identity-verified original Perpl history packet is required",
    );
  }
}
export function replayPtsSignals(input: PtsReplayInput, digest: (v: unknown) => string) {
  assertPtsReplay(input);
  const version = ptsCandidateVersion(input.candidate);
  const profile = ptsTemporalProfile(version);
  const entryMs = version === PTS_VERSION ? 3600000 : 300000;
  const rows: Record<string, unknown>[] = [];
  const analyses: Record<string, ReturnType<typeof inspectPtsHistory>> = {};
  const first = Math.floor(input.from / 300000) * 300000 + 60000;
  for (const history of input.markets) {
    let hour = -1,
      cached: ReturnType<typeof inspectPtsHistory> | undefined,
      analysisHash = "";
    for (let at = first; at < input.to; at += 300000) {
      if (at < input.from) {
        continue;
      }
      if (Math.floor(at / entryMs) !== hour) {
        hour = Math.floor(at / entryMs);
        cached = inspectPtsHistory(history, at, version);
        analysisHash = digest(cached);
        analyses[analysisHash] = cached;
      }
      const expired = !!cached!.setup && at >= cached!.setup.expiresAt;
      const action = expired ? "hold" : cached!.action,
        reason = expired ? "SIGNAL_WINDOW" : cached!.reason;
      const row = {
        at,
        symbol: history.market.symbol,
        action,
        reason,
        status:
          cached!.validationStatus !== "VALID"
            ? "NOT_VERIFIABLE"
            : cached!.coverage.every((c) => c.eligible)
              ? "PROJECTED"
              : "NOT_ELIGIBLE_HISTORY",
        analysisHash,
        signalExpired: expired,
        setupId: cached!.setup?.id ?? null,
        initialStop: cached!.setup?.initialStop ?? null,
        triggerAt: cached!.setup?.triggerAt ?? null,
        expiresAt: cached!.setup?.expiresAt ?? null,
      };
      rows.push({ ...row, projectionHash: digest(row) });
    }
  }
  return {
    protocol: "pts-signals-replay-v1",
    policy: profile.identity,
    sourceCommit: input.commit,
    from: input.from,
    to: input.to,
    sourceHash: digest(input),
    rows,
    analyses,
    financialResult: "NOT_VERIFIABLE",
    interpretation:
      profile.version !== PTS_VERSION
        ? "Recorded native closed candles, versioned as-of five-minute projection. Slot expiry is rechecked. Historical availability/revisions not reconstructed. No hypothetical portfolio or candle-only P&L."
        : "Recorded closed candles, versioned as-of projection. Each hourly analysis is referenced by hash; slot expiry is rechecked. Historical availability/revisions not reconstructed. No hypothetical portfolio or candle-only P&L.",
  };
}
/** Offline ports only; execution, risk, accounting and ordering remain the actual shared runner. */
export async function replayPtsFinance(input: PtsReplayInput, digest: (v: unknown) => string) {
  assertPtsReplay(input);
  if (!input.financial?.length) {
    return {
      protocol: "pts-financial-replay-v1",
      status: "NOT_VERIFIABLE",
      reason: "NO_ORIGINAL_BOOKS_AND_FUNDING",
      modelCalls: 0,
    };
  }
  if (!input.markets.length) {
    throw new PilotError(
      "INVALID_INPUT",
      "Financial replay requires original market identity and history",
    );
  }
  let now = input.financial[0]!.at;
  const version = ptsCandidateVersion(input.candidate);
  const profile = ptsTemporalProfile(version);
  const config: PerpsPtsConfig = {
    ...(input.candidate
      ? {
          version: 9 as const,
          protocol: "perps-pts-intraday-sma-v1" as const,
          hours: 24 as const,
          candidate: input.candidate,
        }
      : {
          version: 8 as const,
          protocol: "perps-pts-sma-v1" as const,
          hours: 336 as const,
          candidate: "pts-trend-reversal@0.2.0" as const,
        }),
    tenantId: "offline",
    sessionId: "pts-replay",
    network: input.markets[0]!.market.provenance.network,
    budgetUsd: "5",
    markets: PTS_CATALOG.map((m) => ({ ...m })),
    acquisitionPolicy: "stream-universe-component-paper-20s-v1",
    history: { file: "history.json", sha256: digest(input) },
    preparedFor: "local-paper-only",
  };
  const view: PerpsStudyView = {
    record: {
      config,
      metadata: { source: "supplied-original-financial-frames", sourceHash: digest(input) },
      agentIds: Object.fromEntries(ptsVariants(config).map((v) => [v, v])),
      agentVersions: Object.fromEntries(ptsVariants(config).map((v) => [v, 1])),
      createdAt: now,
      startedAt: now,
      endsAt: now + config.hours * 3600000,
      graceUntil: now + config.hours * 3600000 + 900000,
      status: "running",
      decisionStopReason: null,
      stopRequested: false,
      lastObservationAt: null,
      lastRoundSlot: -1,
    },
    rounds: [],
    events: [],
  };
  const accounts: Record<string, PerpsPaperView> = {};
  for (const variant of ptsVariants(config)) {
    const account = initialPaperAccount({ ...config, agentId: variant }, 1, now);
    account.marketDataPolicy = config.acquisitionPolicy;
    account.riskManagement = "buffered-selective-1x-v1";
    if (variant === ptsVariant(config)) {
      account.positionPolicy = profile.accountPolicy;
      account.consumedPtsSetups = [];
    } else {
      account.entryPolicy = "unrestricted-hourly-v1";
      account.consumedEntryKeys = [];
    }
    accounts[variant] = { account, attempts: [], movements: [] };
  }
  let active = true;
  const guard = async () => {
    if (!active) {
      throw new PilotError("LEASE_LOST", "Offline ownership was revoked");
    }
  };
  const unavailable = async (): Promise<never> => {
    throw new PilotError("MODELS_DISABLED", "Offline PTS cannot call models or unsupported ports");
  };
  const study: PerpsStudyRepository = {
    initialize: async () => structuredClone(view),
    view: async () => structuredClone(view),
    claim: async () => ({ owner: "offline", expiresAt: now + 90000 }),
    renew: guard,
    release: async () => {
      active = false;
    },
    guard,
    claimSlot: async (_s, _l, slot) => {
      if (
        slot < 0 ||
        slot >= config.hours * 12 ||
        slot <= (view.record.lastAttemptedSlot ?? -1) ||
        now >= view.record.endsAt! ||
        now - view.record.startedAt! - slot * 300000 > 30000
      ) {
        return false;
      }
      view.record.lastAttemptedSlot = slot;
      view.events.push({ key: "slot-" + slot, at: now, kind: "slot-claimed", data: { slot } });
      return true;
    },
    event: async (_s, _l, key, kind, data) => {
      await guard();
      if (!view.events.some((e) => e.key === key)) {
        view.events.push({ key, at: now, kind, data: structuredClone(data) });
      }
      if (kind === "observation") {
        view.record.lastObservationAt = now;
      }
    },
    reserve: async (_s, _l, slot, evidence, original) => {
      const round = {
        key: "round-" + String(slot).padStart(3, "0"),
        slot,
        status: "reserved" as const,
        executionStatus: "pending" as const,
        createdAt: now,
        finishedAt: null,
        evidence: structuredClone(evidence),
        accounts: structuredClone(original),
        proposals: {},
        calls: {},
      };
      view.rounds.push(round);
      view.record.lastRoundSlot = slot;
      return round;
    },
    finishRound: async (_s, _l, key, proposals) => {
      const r = view.rounds.find((r) => r.key === key)!;
      r.proposals = structuredClone(proposals);
      r.status = "completed";
      r.finishedAt = now;
    },
    finishExecution: async (_s, _l, key, status) => {
      view.rounds.find((r) => r.key === key)!.executionStatus = status;
    },
    stop: async () => {
      view.record.stopRequested = true;
    },
    stopDecisions: async (_s, _l, reason) => {
      view.record.decisionStopReason = reason;
      view.record.status = "closing";
    },
    complete: async () => {
      view.record.status = "completed";
    },
    startCall: unavailable,
    usage: unavailable,
    finishCall: unavailable,
  };
  const lookup = (s: PerpsPaperScope) => accounts[s.agentId]!;
  const paper: PerpsPaperRepository = {
    initialize: async (s) => structuredClone(lookup(s)),
    view: async (s) => structuredClone(lookup(s)),
    observed: async (s, key) => view.events.some((e) => e.key === s.agentId + key),
    closeAdmissions: async (s) => {
      lookup(s).account.admissionsClosed = true;
    },
    observe: async (s, key, observation) => {
      await guard();
      const v = lookup(s),
        result = applyPaperObservation(v.account, v.movements, observation, key, now);
      v.account = result.account;
      v.movements.push(...result.movements);
      return structuredClone(v);
    },
    begin: unavailable,
    assertLease: guard,
    complete: unavailable,
    fail: unavailable,
    executeFrame: async (s, key, intent, frame) => {
      await guard();
      const v = lookup(s);
      if (v.attempts.some((a) => a.key === key)) {
        return structuredClone(v);
      }
      const risk = paperRisk(v.account, v.attempts, now, intent);
      if (!risk.allowed) {
        throw new PilotError("RISK_REJECTED", risk.reasons.join(","));
      }
      const attempt = {
        key,
        intent: structuredClone(intent),
        status: "pending" as const,
        reserved: "0",
        createdAt: now,
        finishedAt: null,
        reason: null,
        evidence: null,
      };
      const fill = simulatePerpsFill(v.account, intent, frame, now);
      const result = applyPaperFill(v.account, attempt, fill, now);
      v.account = result.account;
      v.movements.push(...result.movements);
      v.attempts.push({ ...attempt, status: "filled", finishedAt: now, evidence: fill });
      return structuredClone(v);
    },
  };
  let current = input.financial[0]!;
  const evidence = (): PerpsEvidence => ({
    observedAt: now,
    frames: structuredClone(current.frames),
    candles: input.markets.flatMap((h) => h.series),
    sourceIds: [],
  });
  const runner = createProfileStudyRunner({
    study,
    paper,
    now: () => now,
    data: {
      observe: async () => ({ frames: current.frames, funding: [], marksOnly: true }),
      evidence: async () => evidence(),
      prepareEvidence: async () => evidence(),
      finalEvidence: async () => evidence(),
      reconcile: async () => ({ frames: [], funding: current.funding }),
      execution: async () => current.frames,
    },
  });
  const lease: PerpsStudyLease = { owner: "offline", expiresAt: now + 90000 };
  let previous = -1;
  for (const item of input.financial) {
    if (item.at <= previous || item.at < input.from || item.at > input.to) {
      throw new PilotError(
        "INVALID_INPUT",
        "Financial capture clocks must be strictly ordered and bounded",
      );
    }
    previous = item.at;
    now = item.at;
    current = item;
    lease.expiresAt = now + 90000;
    await runner.cycle(config, lease, new AbortController().signal);
  }
  return {
    protocol: "pts-financial-replay-v1",
    status: "REPLAYED",
    sourceHash: digest(input),
    study: view,
    accounts,
    metrics: ptsFinancialAudit(accounts),
    modelCalls: 0,
    interpretation:
      "Shared coordinator and simulator over supplied original frames/funding. Missing components remain pending; controlled captures are not observed market returns.",
  };
}
export function ptsFinancialAudit(accounts: Record<string, PerpsPaperView | undefined>) {
  return (
    accounts["pts-intraday"] ? (["sma-reference", "pts-intraday"] as const) : PTS_VARIANTS
  ).map((variant) => {
    const view = accounts[variant];
    if (!view) {
      return { variant, status: "NOT_VERIFIABLE" };
    }
    const issues: string[] = [];
    for (const p of view.account.positions) {
      if (!p.pts) {
        continue;
      }
      const reduced = p.pts.reductions.reduce((n, r) => n + units(r.quantity), 0n);
      const cost = p.pts.reductions.reduce((n, r) => n + units(r.costBasis), 0n);
      if (reduced + units(p.quantity) !== units(p.pts.initialQuantity)) {
        issues.push(p.id + ":QUANTITY_DIVERGENCE");
      }
      if (cost + units(p.entryNotional) !== units(p.pts.initialNotional)) {
        issues.push(p.id + ":COST_BASIS_DIVERGENCE");
      }
      if (!view.account.consumedPtsSetups?.includes(p.pts.setup.id)) {
        issues.push(p.id + ":SETUP_NOT_CONSUMED");
      }
      for (const m of view.movements.filter(
        (m) => m.kind === "funding" && (m.evidence as { positionId?: string }).positionId === p.id,
      )) {
        const e = m.evidence as { quantity?: string; eventBlock: number };
        if (e.quantity !== ptsQuantityAtBlock(p, e.eventBlock)) {
          issues.push(m.key + ":FUNDING_QUANTITY_DIVERGENCE");
        }
      }
    }
    const sum = (kind: string) =>
      decimal(
        view.movements.filter((m) => m.kind === kind).reduce((n, m) => n + units(m.delta), 0n),
      );
    const recordedFundingAUSD = sum("funding");
    const recordedNetRealizedAUSD = decimal(
      units(sum("realized-pnl")) + units(sum("fee")) + units(recordedFundingAUSD),
    );
    const fundingKnown = !view.account.fundingPending && !view.account.fundingDisputed;
    return {
      variant,
      status: issues.length ? "DIVERGENCE" : "VERIFIED_RECORDED_LEDGER",
      issues,
      grossRealizedAUSD: sum("realized-pnl"),
      feesAUSD: sum("fee"),
      recordedFundingAUSD,
      recordedNetRealizedAUSD,
      fundingAUSD: fundingKnown ? recordedFundingAUSD : null,
      netRealizedAUSD: fundingKnown && !issues.length ? recordedNetRealizedAUSD : null,
      fundingPending: view.account.fundingPending,
      fundingDisputed: !!view.account.fundingDisputed,
      positions: view.account.positions,
    };
  });
}

export function auditPtsDecisionRows(
  study: PerpsStudyView,
  digest: (v: unknown) => string,
  slots?: readonly number[],
) {
  if (
    (study?.record?.config?.version !== 8 && study?.record?.config?.version !== 9) ||
    !Array.isArray(study.rounds) ||
    !Array.isArray(study.events)
  ) {
    throw new PilotError("INVALID_INPUT", "A versioned local PTS audit is required");
  }
  const config = study.record.config,
    rows: Record<string, unknown>[] = [];
  const rounds = new Map(study.rounds.map((r) => [r.slot, r]));
  const executions = new Map<string, typeof study.events>(),
    finals = new Map<number, PerpsEvidence>();
  const gates = new Map<
    string,
    {
      initial: import("../perps-strategies/types.js").PerpsProposal[];
      final: import("../perps-strategies/types.js").PerpsProposal[];
    }
  >();
  for (const e of study.events) {
    const d = e.data as {
      slot?: number;
      variant?: string;
      symbol?: string;
      evidence?: PerpsEvidence;
      initial?: import("../perps-strategies/types.js").PerpsProposal[];
      final?: import("../perps-strategies/types.js").PerpsProposal[];
    };
    const slot = Number(/^round-(\d+)/.exec(e.key)?.[1]);
    if (e.kind === "execution-input" && d.evidence && Number.isSafeInteger(slot)) {
      finals.set(slot, d.evidence);
    }
    if (e.kind === "final-gate" && d.initial && d.final) {
      gates.set(e.key, { initial: d.initial, final: d.final });
    }
    if (e.kind === "profile-execution") {
      const key = [d.slot, d.variant, d.symbol].join(":");
      executions.set(key, [...(executions.get(key) ?? []), e]);
    }
  }
  if (study.record.startedAt !== null) {
    const selectedSlots = slots ?? Array.from({ length: config.hours * 12 }, (_, index) => index);
    if (
      new Set(selectedSlots).size !== selectedSlots.length ||
      selectedSlots.some(
        (slot) => !Number.isSafeInteger(slot) || slot < 0 || slot >= config.hours * 12,
      )
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "PTS audit slots must be unique and within the frozen window",
      );
    }
    for (const slot of selectedSlots) {
      const round = rounds.get(slot),
        evidence = round?.evidence,
        final = finals.get(slot);
      const originalAccounts = round?.accounts;
      const block =
        !!evidence &&
        Object.values(originalAccounts ?? {}).some((a) =>
          a?.positions.some(
            (p) =>
              p.closedAt === null &&
              !evidence.frames.some((f) => f.snapshot.market.symbol === p.symbol),
          ),
        );
      const reproduced: Record<string, import("../perps-strategies/types.js").PerpsProposal[]> = {};
      if (evidence && originalAccounts) {
        for (const variant of ptsVariants(config)) {
          const account = originalAccounts[variant];
          if (account) {
            reproduced[variant] =
              variant === ptsVariant(config)
                ? ptsProposals({ evidence, account }, config, block)
                : profileProposals({ evidence, account }, config, "sma-reference", block);
          }
        }
      }
      const initialEvidenceHash = evidence ? digest(evidence) : null;
      const finalEvidenceHash = final ? digest(final) : null;
      for (const m of config.markets) {
        for (const variant of ptsVariants(config)) {
          const original = round?.proposals[variant]?.find((p) => p.symbol === m.symbol);
          const recalculated = reproduced[variant]?.find((p) => p.symbol === m.symbol);
          const gate = gates.get(round?.key + ":" + variant + ":final-gate");
          const finalDecision = gate?.final.find((p) => p.symbol === m.symbol);
          const perAsset = executions.get([slot, variant, m.symbol].join(":")) ?? [];
          const blockedInSlot =
            original?.reason === "CLOSED_THIS_SLOT" &&
            perAsset.some(
              (e) =>
                (e.data as { action: string; status: string }).action === "close" &&
                (e.data as { status: string }).status === "filled",
            );
          const equivalent =
            original &&
            recalculated &&
            (blockedInSlot ||
              digest({
                action: original.action,
                reason: original.reason,
                pts: original.pts ?? null,
                notional: original.notional ?? null,
              }) ===
                digest({
                  action: recalculated.action,
                  reason: recalculated.reason,
                  pts: recalculated.pts ?? null,
                  notional: recalculated.notional ?? null,
                }));
          const exclusions = evidence?.excluded?.filter((e) => e.symbol === m.symbol) ?? [];
          rows.push({
            slot,
            symbol: m.symbol,
            variant,
            at: evidence?.observedAt ?? null,
            status: round?.executionStatus ?? "NOT_RECORDED",
            action: original?.action ?? null,
            reason: original?.reason ?? "NOT_VERIFIABLE",
            initialEvidenceHash,
            original: original ?? null,
            reproduction: recalculated ?? null,
            finalEvidenceHash,
            finalDecision: finalDecision ?? null,
            executions: perAsset,
            exclusions,
            finalPortfolioReproduction: "NOT_VERIFIABLE_WITHOUT_EXACT_PRE_EXECUTION_ACCOUNT",
            verification:
              !original || !recalculated
                ? "NOT_VERIFIABLE"
                : equivalent
                  ? "REPRODUCED"
                  : "DIVERGENCE",
          });
        }
      }
    }
  }
  return rows;
}

export function auditPtsStudy(
  study: PerpsStudyView,
  accounts: Record<string, PerpsPaperView | undefined>,
  digest: (v: unknown) => string,
) {
  const rows = auditPtsDecisionRows(study, digest);
  const config = study.record.config as PerpsPtsConfig;
  const financial = ptsFinancialAudit(accounts);
  return {
    protocol: "perps-pts-audit-v1",
    candidate: config.candidate,
    studyMetadata: study.record.metadata,
    studyCommit: (study.record.metadata as { commit?: string }).commit ?? "NOT_VERIFIABLE",
    studyProtocol: config.protocol,
    sourceHash: digest({ study, accounts }),
    rows,
    financial,
    accounts,
    observations: study.events.filter(
      (e) =>
        e.kind === "observation" ||
        e.kind === "observation-failed" ||
        e.kind === "observation-missed",
    ),
    historyModified: false,
    modelCalls: 0,
    interpretation:
      "Reproduction uses original round accounts and evidence. Final gates/fills are recorded; absent exact final accounts remain explicitly not verifiable. No later observations fill historical gaps.",
  };
}
