import { PilotError } from "@pickler/core";
import {
  auditPtsDecisionRows,
  assertPtsConfig,
  ptsFinancialAudit,
  ptsVariants,
  type PerpsPtsConfig,
} from "@pickler/trading/pts";
import type { PerpsRound, PerpsStudyView } from "@pickler/trading/evaluation";
import { perpsStudyReport } from "../perps-study/report.js";
import { digest } from "./files.js";
import {
  readPtsPart,
  ptsPartsPayloadHash,
  type PtsExportManifest,
  type PtsAccounts,
} from "./parts.js";

/** Replay one original round at a time; raw initial/final histories stay in verified source parts. */
export async function ptsPartReport(directory: string, manifest: PtsExportManifest) {
  if ((await ptsPartsPayloadHash(directory, manifest)) !== manifest.payloadHash) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Segmented PTS payload differs");
  }
  const record = await readPtsPart<PerpsStudyView["record"]>(directory, manifest.record);
  if (
    (record.config.version !== 8 && record.config.version !== 9) ||
    record.config.version !== manifest.studyVersion ||
    record.config.protocol !== manifest.studyProtocol
  ) {
    throw new PilotError("INVALID_INPUT", "PTS protocol required for segmented replay");
  }
  const config: PerpsPtsConfig = record.config;
  assertPtsConfig(config);
  if (
    JSON.stringify(Object.keys(manifest.accounts).sort()) !==
    JSON.stringify([...ptsVariants(config)].sort())
  ) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Original portfolio identities differ");
  }
  const accounts: PtsAccounts = {};
  for (const [variant, reference] of Object.entries(manifest.accounts)) {
    accounts[variant] = await readPtsPart(directory, reference);
  }
  const summaries: PerpsStudyView["events"] = [];
  const slotEvents = new Map<number, PtsExportManifest["events"]>();
  for (const reference of manifest.events) {
    const event = await readPtsPart<PerpsStudyView["events"][number]>(directory, reference);
    const data = event.data as { slot?: number } | null;
    const fromKey = /^round-(\d+)/.exec(event.key)?.[1];
    const slot = data?.slot ?? (fromKey === undefined ? null : Number(fromKey));
    if (
      event.key !== reference.key ||
      event.kind !== reference.kind ||
      event.at !== reference.at ||
      slot !== reference.slot
    ) {
      throw new PilotError("AUDIT_HASH_MISMATCH", "Event index differs from original evidence");
    }
    if (
      slot !== null &&
      ["execution-input", "final-gate", "profile-execution"].includes(event.kind)
    ) {
      const group = slotEvents.get(slot) ?? [];
      group.push(reference);
      slotEvents.set(slot, group);
    }
    // Summary metrics need valuations and confirmed fills, never full candle evidence.
    const keep = [
      "observation",
      "profile-execution",
      "data-unavailable",
      "model-diagnostic",
    ].includes(event.kind);
    summaries.push({ ...event, data: keep ? event.data : { sourcePart: reference.file } });
  }
  const rows: Record<string, unknown>[] = [];
  const summaryRounds: PerpsRound[] = [];
  for (const reference of manifest.rounds) {
    const round = await readPtsPart<PerpsRound>(directory, reference);
    if (round.slot !== reference.slot || round.key !== reference.key) {
      throw new PilotError("AUDIT_HASH_MISMATCH", "Round index differs from original evidence");
    }
    const events = [] as PerpsStudyView["events"];
    for (const event of slotEvents.get(round.slot) ?? []) {
      events.push(await readPtsPart(directory, event));
    }
    rows.push(...auditPtsDecisionRows({ record, rounds: [round], events }, digest, [round.slot]));
    // Existing summary/accounting functions read only these round fields.
    summaryRounds.push({
      key: round.key,
      slot: round.slot,
      status: round.status,
      executionStatus: round.executionStatus,
      ...(round.executionReason ? { executionReason: round.executionReason } : {}),
      createdAt: round.createdAt,
      finishedAt: round.finishedAt,
      proposals: round.proposals,
      calls: round.calls,
      accounts: {},
      evidence: { observedAt: round.evidence.observedAt, frames: [], candles: [], sourceIds: [] },
    });
  }
  const recordedSlots = new Set(manifest.rounds.map((round) => round.slot));
  const absent = Array.from({ length: config.hours * 12 }, (_, slot) => slot).filter(
    (slot) => !recordedSlots.has(slot),
  );
  rows.push(...auditPtsDecisionRows({ record, rounds: [], events: [] }, digest, absent));
  rows.sort(
    (a, b) =>
      Number(a.slot) - Number(b.slot) ||
      config.markets.findIndex((m) => m.symbol === a.symbol) -
        config.markets.findIndex((m) => m.symbol === b.symbol) ||
      ptsVariants(config).indexOf(a.variant as ReturnType<typeof ptsVariants>[number]) -
        ptsVariants(config).indexOf(b.variant as ReturnType<typeof ptsVariants>[number]),
  );
  const summary = perpsStudyReport(
    { record, rounds: summaryRounds, events: summaries },
    accounts,
    manifest.capturedAt,
  );
  const financial = ptsFinancialAudit(accounts);
  return {
    report: {
      ...summary,
      candidate: config.candidate,
      portfolioMetrics: summary.rows.map((row) => {
        const metric = financial.find((item) => item.variant === row.strategy);
        return {
          ...row,
          recordedFundingVirtualAUSD: row.fundingVirtualAUSD,
          recordedNetRealizedPnlVirtualAUSD: row.netRealizedPnlVirtualAUSD,
          fundingVirtualAUSD: metric?.fundingAUSD ?? null,
          netRealizedPnlVirtualAUSD: metric?.netRealizedAUSD ?? null,
        };
      }),
      financial,
      accounts,
      sourceHash: manifest.payloadHash,
      sourceExport: "evidence/export.json",
      exporterCommit: manifest.exportCommit,
      auditProtocol: "perps-pts-audit-v2",
      reportReferenceAt: manifest.capturedAt,
      sourceStudyProtocol: config.protocol,
      historyModified: false,
      modelCalls: 0,
      observations: summaries.filter((event) =>
        ["observation", "observation-failed", "observation-missed"].includes(event.kind),
      ),
      interpretation:
        "Per-slot replay uses original accounts and initial/final evidence. Full histories remain in hash-verified source parts. Missing exact final accounts remain not verifiable; no later prices fill gaps.",
    },
    rows,
    record,
  };
}
