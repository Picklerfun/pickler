import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PilotError } from "@pickler/core";
import {
  PTS_RESEARCH_CANDIDATES,
  analyzePts,
  auditPtsDecisionRows,
  createPtsResearchSession,
  inspectPtsResearch,
  ptsFinancialAudit,
  type PtsAnalysis,
  type PtsProposal,
  type PtsResearchInspection,
  type PtsResearchOutcome,
} from "@pickler/trading/pts";
import type { PerpsEvidence, PerpsStudyView } from "@pickler/trading/evaluation";
import { bytesHash, digest, newDirectory } from "./files.js";
import { readPtsResearchInput } from "./research-input.js";
import { openResearchAudit, type ResearchRound } from "./research-source.js";
import {
  publishPtsResearchReport,
  publishResearchArtifact,
  researchCsv,
  researchHistoryWriter,
  type ResearchTableRow,
} from "./research-report.js";
import { bufferedChunks, jsonChunks } from "./serialization.js";

export interface PtsResearchCommand {
  command: string;
  state?: string | undefined;
  output?: string | undefined;
  configPath?: string | undefined;
  envFile?: string | undefined;
  allowPaid?: boolean | undefined;
  signal: AbortSignal;
}

interface DecisionRow extends ResearchTableRow, PtsResearchOutcome {
  id: string;
  mode: "forensic" | "history";
  at: number;
  slot: number | null;
  symbol: string;
  marketId: number;
  status: "SIGNAL" | "HOLD" | "NOT_VERIFIABLE";
  source: unknown;
}

interface Counter {
  mode: string;
  candidate: string;
  symbol: string;
  rows: number;
  signalRows: number;
  holdRows: number;
  notVerifiableRows: number;
  ab: Set<string>;
  abc: Set<string>;
  signals: Map<
    string,
    { comparisonId: string; rowId: string; triggerAt: number; episodeId: string }
  >;
  blockers: Map<string, number>;
}

interface Episode {
  mode: string;
  candidate: string;
  symbol: string;
  abId: string;
  abcIds: Set<string>;
  episodeIds: Set<string>;
  firstAt: number;
  lastAt: number;
  rows: number;
  signalIds: Set<string>;
  firstRowId: string;
  lastRowId: string;
  blockerExamples: Map<string, string>;
}

function summaries() {
  const counters = new Map<string, Counter>();
  const episodes = new Map<string, Episode>();
  const stages = new Map<
    string,
    {
      mode: string;
      candidate: string;
      code: string;
      dependsOn: string[];
      totalRows: number;
      dependencyEligibleRows: number;
      pass: number;
      fail: number;
      unknown: number;
      notEvaluableDependency: number;
      exampleRows: Record<string, string>;
    }
  >();
  const temporal = new Map<string, ResearchTableRow & { rows: number; signals: number }>();

  function add(row: DecisionRow) {
    const key = [row.mode, row.candidate, row.symbol].join(":");
    let count = counters.get(key);
    if (!count) {
      count = {
        mode: row.mode,
        candidate: row.candidate,
        symbol: row.symbol,
        rows: 0,
        signalRows: 0,
        holdRows: 0,
        notVerifiableRows: 0,
        ab: new Set(),
        abc: new Set(),
        signals: new Map(),
        blockers: new Map(),
      };
      counters.set(key, count);
    }
    count.rows++;
    if (row.status === "SIGNAL") {
      count.signalRows++;
    } else if (row.status === "HOLD") {
      count.holdRows++;
    } else {
      count.notVerifiableRows++;
    }
    if (row.abId) {
      count.ab.add(row.abId);
    }
    if (row.abcId) {
      count.abc.add(row.abcId);
    }
    if (row.firstBlocker) {
      count.blockers.set(row.firstBlocker, (count.blockers.get(row.firstBlocker) ?? 0) + 1);
    }
    if (row.signal) {
      const identity = row.signal.comparisonId;
      if (!count.signals.has(identity)) {
        count.signals.set(identity, {
          comparisonId: identity,
          rowId: row.id,
          triggerAt: row.signal.triggerAt,
          episodeId: row.signal.episodeId,
        });
      }
    }
    if (row.abId) {
      const episodeKey = [row.mode, row.candidate, row.symbol, row.abId].join(":");
      let episode = episodes.get(episodeKey);
      if (!episode) {
        episode = {
          mode: row.mode,
          candidate: row.candidate,
          symbol: row.symbol,
          abId: row.abId,
          abcIds: new Set(),
          episodeIds: new Set(),
          firstAt: row.at,
          lastAt: row.at,
          rows: 0,
          signalIds: new Set(),
          firstRowId: row.id,
          lastRowId: row.id,
          blockerExamples: new Map(),
        };
        episodes.set(episodeKey, episode);
      }
      episode.firstAt = Math.min(episode.firstAt, row.at);
      episode.lastAt = Math.max(episode.lastAt, row.at);
      episode.lastRowId = row.id;
      episode.rows++;
      if (row.abcId) {
        episode.abcIds.add(row.abcId);
      }
      if (row.episodeId) {
        episode.episodeIds.add(row.episodeId);
      }
      if (row.signal) {
        episode.signalIds.add(row.signal.comparisonId);
      }
      if (row.firstBlocker && !episode.blockerExamples.has(row.firstBlocker)) {
        episode.blockerExamples.set(row.firstBlocker, row.id);
      }
    }
    for (const gate of row.gates) {
      const stageKey = [row.mode, row.candidate, gate.code].join(":");
      let stage = stages.get(stageKey);
      if (!stage) {
        stage = {
          mode: row.mode,
          candidate: row.candidate,
          code: gate.code,
          dependsOn: gate.dependsOn,
          totalRows: 0,
          dependencyEligibleRows: 0,
          pass: 0,
          fail: 0,
          unknown: 0,
          notEvaluableDependency: 0,
          exampleRows: {},
        };
        stages.set(stageKey, stage);
      }
      stage.totalRows++;
      if (gate.status === "NOT_EVALUABLE_DEPENDENCY") {
        stage.notEvaluableDependency++;
      } else {
        stage.dependencyEligibleRows++;
        if (gate.status === "PASS") {
          stage.pass++;
        } else if (gate.status === "FAIL") {
          stage.fail++;
        } else {
          stage.unknown++;
        }
      }
      stage.exampleRows[gate.status] ??= row.id;
    }
    const hour = Math.floor(row.at / 3600000) * 3600000;
    const temporalKey = [row.mode, row.candidate, hour].join(":");
    const bucket = temporal.get(temporalKey) ?? {
      mode: row.mode,
      candidate: row.candidate,
      at: hour,
      rows: 0,
      signals: 0,
    };
    bucket.rows++;
    bucket.signals += Number(row.status === "SIGNAL");
    temporal.set(temporalKey, bucket);
  }

  function result() {
    const policies = new Map<string, Counter>();
    for (const count of counters.values()) {
      const key = [count.mode, count.candidate].join(":");
      const combined = policies.get(key) ?? {
        mode: count.mode,
        candidate: count.candidate,
        symbol: "ALL_DECLARED_MARKETS",
        rows: 0,
        signalRows: 0,
        holdRows: 0,
        notVerifiableRows: 0,
        ab: new Set<string>(),
        abc: new Set<string>(),
        signals: new Map(),
        blockers: new Map<string, number>(),
      };
      combined.rows += count.rows;
      combined.signalRows += count.signalRows;
      combined.holdRows += count.holdRows;
      combined.notVerifiableRows += count.notVerifiableRows;
      count.ab.forEach((identity) => combined.ab.add(identity));
      count.abc.forEach((identity) => combined.abc.add(identity));
      count.signals.forEach((value, identity) => combined.signals.set(identity, value));
      count.blockers.forEach((value, blocker) =>
        combined.blockers.set(blocker, (combined.blockers.get(blocker) ?? 0) + value),
      );
      policies.set(key, combined);
    }
    const summarize = (count: Counter) => ({
      mode: count.mode,
      candidate: count.candidate,
      symbol: count.symbol,
      rows: count.rows,
      signalRows: count.signalRows,
      holdRows: count.holdRows,
      notVerifiableRows: count.notVerifiableRows,
      uniqueAB: count.ab.size,
      uniqueABC: count.abc.size,
      uniqueSignals: count.signals.size,
      firstBlockers: Object.fromEntries(count.blockers),
    });
    const byMarket = [...counters.values()].map(summarize);
    const comparisons: ResearchTableRow[] = [];
    for (const count of counters.values()) {
      if (count.candidate === "reference") {
        continue;
      }
      const reference = counters.get([count.mode, "reference", count.symbol].join(":"));
      const control = reference?.signals ?? new Map<string, never>();
      const gained = [...count.signals.values()].filter((item) => !control.has(item.comparisonId));
      const lost = [...control.values()].filter((item) => !count.signals.has(item.comparisonId));
      const shared = [...count.signals.values()].filter((item) => control.has(item.comparisonId));
      comparisons.push({
        mode: count.mode,
        candidate: count.candidate,
        symbol: count.symbol,
        gained: gained.length,
        lost: lost.length,
        shared: shared.length,
        gainedSignals: gained,
        lostReferenceSignals: lost,
        sharedSignalExamples: shared.slice(0, 20),
        mechanismEvidence: gained.slice(0, 20).map((item) => ({
          rowId: item.rowId,
          factor: PTS_RESEARCH_CANDIDATES.find((policy) => policy.id === count.candidate)
            ?.changedFactor,
          interpretation: "CANDLE_SIGNAL_SENSITIVITY_NOT_FINANCIAL_IMPROVEMENT",
        })),
      });
    }
    return {
      byMarket,
      byPolicy: [...policies.values()].map(summarize),
      comparisons,
      episodes: [...episodes.values()].map((episode) => ({
        ...episode,
        abcIds: [...episode.abcIds].sort(),
        episodeIds: [...episode.episodeIds].sort(),
        uniqueABC: episode.abcIds.size,
        signalIds: [...episode.signalIds].sort(),
        blockerExamples: Object.fromEntries(episode.blockerExamples),
      })),
      stages: [...stages.values()],
      temporal: [...temporal.values()],
    };
  }
  return { add, result };
}

function unknownOutcomes(reason: string): PtsResearchOutcome[] {
  return (["reference", ...PTS_RESEARCH_CANDIDATES.map((policy) => policy.id)] as const).map(
    (candidate) => ({
      candidate,
      version: candidate === "reference" ? "0.2.0-fast.2" : "0.1.0",
      action: "hold",
      reason,
      firstBlocker: "HISTORY_COVERAGE",
      validationStatus: "NOT_VERIFIABLE",
      direction: "unknown",
      abId: null,
      abcId: null,
      episodeId: null,
      signal: null,
      gates: [{ code: "HISTORY_COVERAGE", status: "UNKNOWN", dependsOn: [], values: { reason } }],
      timing: {
        aConfirmedAt: null,
        bConfirmedAt: null,
        cConfirmedAt: null,
        channelConfirmedAt: null,
        primaryReadyAt: null,
        alignmentReadyAt: null,
        prerequisitesReadyAt: null,
        admittedAt: null,
        triggerAt: null,
        expiresAt: null,
      },
      activeSetups: 0,
    }),
  );
}

function rowsAt(
  mode: DecisionRow["mode"],
  at: number,
  slot: number | null,
  symbol: string,
  marketId: number,
  outcomes: PtsResearchOutcome[],
  source: unknown,
  historicalDecision?: unknown,
): DecisionRow[] {
  const reference = outcomes.find((outcome) => outcome.candidate === "reference");
  return outcomes.map((outcome) => ({
    ...outcome,
    id: [mode, slot ?? at, symbol, outcome.candidate].join(":"),
    mode,
    at,
    slot,
    symbol,
    marketId,
    status:
      outcome.validationStatus !== "VALID" ? "NOT_VERIFIABLE" : outcome.signal ? "SIGNAL" : "HOLD",
    source,
    historicalDecision: historicalDecision ?? null,
    comparedToReference:
      outcome.candidate === "reference"
        ? "REFERENCE"
        : outcome.signal && !reference?.signal
          ? "GAINED_AT_THIS_CLOCK"
          : !outcome.signal && reference?.signal
            ? "LOST_AT_THIS_CLOCK"
            : outcome.signal?.comparisonId &&
                outcome.signal.comparisonId === reference?.signal?.comparisonId
              ? "SHARED_AT_THIS_CLOCK"
              : outcome.signal && reference?.signal
                ? "DIFFERENT_SIGNAL_AT_THIS_CLOCK"
                : "NO_SIGNAL_AT_THIS_CLOCK",
    financialStatus: "NOT_VERIFIABLE",
  }));
}

function historyFor(evidence: PerpsEvidence | undefined, symbol: string) {
  if (!evidence || evidence.excluded?.some((item) => item.symbol === symbol)) {
    return null;
  }
  const market =
    evidence.frames.find((frame) => frame.snapshot.market.symbol === symbol)?.snapshot.market ??
    evidence.candles.find((series) => series.market.symbol === symbol)?.market;
  if (!market) {
    return null;
  }
  return {
    market,
    capturedAt: evidence.observedAt,
    series: evidence.candles.filter((series) => series.market.symbol === symbol),
  };
}

function compareTrace(original: unknown, reproduced: unknown) {
  return original && reproduced
    ? digest(original) === digest(reproduced)
      ? "MATCH"
      : "DIVERGENCE"
    : "NOT_VERIFIABLE";
}

function historicalRows(
  item: ResearchRound,
  record: PerpsStudyView["record"],
  initial: Map<string, PtsResearchInspection | null>,
  final: Map<string, PtsAnalysis | null>,
) {
  return auditPtsDecisionRows({ record, rounds: [item.round], events: item.events }, digest, [
    item.round.slot,
  ]).map((row) => {
    const original = row.original as PtsProposal | null;
    const reproduced = row.reproduction as PtsProposal | null;
    const finalDecision = row.finalDecision as PtsProposal | null;
    const variant = String(row.variant);
    const symbol = String(row.symbol);
    const gate = item.events.find(
      (event) => event.key === item.round.key + ":" + variant + ":final-gate",
    );
    const gateData = gate?.data as { initial?: PtsProposal[]; final?: PtsProposal[] } | undefined;
    const initialGate = gateData?.initial?.find((proposal) => proposal.symbol === symbol);
    const pts = variant === "pts-intraday";
    const projectedFinal = pts ? final.get(symbol) : null;
    return {
      id: ["original", item.round.slot, symbol, variant].join(":"),
      slot: row.slot,
      symbol,
      variant,
      at: row.at,
      status: row.status,
      action: row.action,
      reason: row.reason,
      verification: row.verification,
      source: item.source,
      eventSources: item.eventSources,
      initialEvidenceHash: row.initialEvidenceHash,
      finalEvidenceHash: row.finalEvidenceHash,
      original: original
        ? { action: original.action, reason: original.reason, pts: original.pts ?? null }
        : null,
      initialTrace: {
        available: !!original?.trace,
        hash: original?.trace ? digest(original.trace) : null,
        originalAccountReproduction: compareTrace(original?.trace, reproduced?.trace),
        independentSignalReproduction: pts
          ? compareTrace(original?.trace, initial.get(symbol)?.baseline)
          : "NOT_APPLICABLE_SMA",
        originalGateMatch: compareTrace(original?.trace, initialGate?.trace),
      },
      finalTrace: {
        available: !!finalDecision?.trace,
        hash: finalDecision?.trace ? digest(finalDecision.trace) : null,
        independentSignalReproduction: pts
          ? compareTrace(finalDecision?.trace, projectedFinal)
          : "NOT_VERIFIABLE_WITHOUT_EXACT_PRE_EXECUTION_ACCOUNT",
        recordedInitialFinalEquality: compareTrace(initialGate?.trace, finalDecision?.trace),
      },
      finalDecision: finalDecision
        ? {
            action: finalDecision.action,
            reason: finalDecision.reason,
            pts: finalDecision.pts ?? null,
          }
        : null,
      finalPortfolioReproduction: row.finalPortfolioReproduction,
      exclusions: row.exclusions,
    };
  });
}

async function codeIdentity() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const files = [
    "apps/agent-service/src/evaluate.ts",
    "apps/agent-service/src/pts-study/index.ts",
    "apps/agent-service/src/pts-study/files.ts",
    "apps/agent-service/src/pts-study/serialization.ts",
    "apps/agent-service/src/pts-study/parts.ts",
    "apps/agent-service/src/pts-study/report.ts",
    "apps/agent-service/src/pts-study/research.ts",
    "apps/agent-service/src/pts-study/research-input.ts",
    "apps/agent-service/src/pts-study/research-path.ts",
    "apps/agent-service/src/pts-study/research-source.ts",
    "apps/agent-service/src/pts-study/research-report.ts",
    "packages/trading/src/features/pts/research.ts",
    "packages/trading/src/features/pts/research-policy.ts",
    "packages/trading/src/features/pts/research-types.ts",
    "packages/trading/src/features/pts/research-history.ts",
    "packages/trading/src/features/pts/research-selection.ts",
    "packages/trading/src/features/pts/research-signal-kernel.ts",
    "packages/trading/src/features/pts/signals.ts",
    "packages/trading/src/features/pts/replay.ts",
    "packages/trading/src/features/pts/pivots.ts",
    "packages/trading/src/features/pts/math.ts",
    "packages/trading/src/features/pts/calendar.ts",
    "packages/trading/src/features/pts/temporal-profile.ts",
  ];
  const hashes: Record<string, string> = {};
  for (const file of files) {
    hashes[file] = bytesHash(await readFile(joinRoot(root, file), "utf8"));
  }
  const compiled: { path: string; sha256: string; bytes: number }[] = [];
  let totalBytes = 0;
  async function inventory(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PilotError(
          "INVALID_INPUT",
          "Compiled business inventory cannot contain symlinks",
        );
      }
      if (entry.isDirectory()) {
        await inventory(path);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        const body = await readFile(path);
        totalBytes += body.length;
        if (compiled.length >= 10000 || totalBytes > 64 * 1024 * 1024) {
          throw new PilotError("INVALID_INPUT", "Compiled business inventory exceeds bounds");
        }
        compiled.push({
          path: relative(root, path).split("\\").join("/"),
          sha256: createHash("sha256").update(body).digest("hex"),
          bytes: body.length,
        });
      }
    }
  }
  await inventory(resolve(root, "packages/core/dist"));
  await inventory(resolve(root, "packages/trading/dist"));
  compiled.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const entryPoints = {
    core: relative(root, fileURLToPath(import.meta.resolve("@pickler/core"))),
    tradingPts: relative(root, fileURLToPath(import.meta.resolve("@pickler/trading/pts"))),
    tradingEvaluation: relative(
      root,
      fileURLToPath(import.meta.resolve("@pickler/trading/evaluation")),
    ),
    tradingPerps: relative(root, fileURLToPath(import.meta.resolve("@pickler/trading/perps"))),
  };
  if (Object.values(entryPoints).some((path) => !compiled.some((item) => item.path === path))) {
    throw new PilotError(
      "INVALID_INPUT",
      "Loaded business entry point is outside compiled inventory",
    );
  }
  return {
    version: "pts-causal-analyzer-v1",
    nodeVersion: process.version,
    commit: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: root,
      env: {},
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
    files: hashes,
    sourceHashPolicy: "sha256-canonical-audit-of-selected-source-file-byte-hashes-v1",
    sourceHash: digest(hashes),
    sourceCoverage: "SELECTED_REVIEWABLE_SOURCE_FILES_NOT_COMPLETE_EXECUTION_IDENTITY",
    compiledBusiness: {
      entryPoints,
      scope: ["packages/core/dist/**/*.js", "packages/trading/dist/**/*.js"],
      hashPolicy: "sha256-canonical-audit-of-sorted-path-byte-hash-inventory-v1",
      inventoryHash: digest(compiled),
      files: compiled,
      totalBytes,
      coverage: "COMPLETE_SCOPED_COMPILED_JS_INVENTORY_NOT_EXTERNAL_DEPENDENCIES",
    },
  };
}

function joinRoot(root: string, file: string) {
  return resolve(root, file);
}

const futureProtocol = {
  format: "pts-future-protocol-conditions-v1",
  status: "CONDITIONED_PROPOSAL_REQUIRES_SEPARATE_PLAN_AND_AUTHORIZATION",
  executionEnabled: false,
  selectedCandidates: [],
  maximumCandidates: 2,
  controls: ["frozen-reference", "no-trade"],
  requiredEvidence: [
    "Full original normalized ticker and order-book frames at every maintenance minute, including rejected and missed observations, with native/receipt/financial clocks, hashes and causal source references.",
    "Complete original funding events covering every hypothetical position interval, with pending/unknown funding retained and immutable event identities.",
    "Immutable contract catalog, public fee tier, funding interval, market scope and policy hashes, plus any metadata revisions.",
    "Original account transitions, final pre-execution accounts, admissions, fill inputs and exact order/transaction outcomes.",
  ],
  conditions: [
    "Review causal mechanisms and disconfirming examples using row references and unique AB/ABC episodes; no threshold optimization or profitability claim on this examined development sample.",
    "Select at most two independent candidates only in a separate reviewed plan that freezes all common management, exposure and execution assumptions.",
    "Predeclare a minimum effective independent sample of unique causal AB episodes and its uncertainty method, grouping dependent ABC corrections, repeated polls, nearby times and correlated markets; no unreviewed numeric sample target is supplied here.",
    "Register every tried candidate, parameter revision, rejection and failed experiment, including these four development sensitivities, and predeclare the multiplicity correction or explicit exploratory interpretation.",
    "Predeclare a future untouched chronological evaluation sample and explicit acceptance criteria; the current seven-day history remains development evidence.",
    "Freeze risk sizing, leverage, exposure, stops, exits, same-bar event ordering and portfolio management; predeclare acceptance and early-stop criteria before any prospective observation.",
    "Predeclare conservative fee, spread, slippage, depth and funding stress scenarios using immutable tariff/catalog data, with complete reconciliation and unknown-cost stopping rules.",
    "Verify full raw-frame and funding capture before any financial counterfactual; candle signals cannot establish hypothetical fills, positions, fees, exits or P&L.",
    "Obtain separate explicit authorization before capture, public trials, execution, models, schedules or deployment.",
  ],
};

/** Restricted entry point: only explicit files and offline pure functions are reachable. */
export async function runPtsResearch(input: PtsResearchCommand) {
  if (
    input.command !== "audit" ||
    !input.state ||
    !input.output ||
    input.configPath ||
    input.envFile ||
    input.allowPaid
  ) {
    throw new PilotError("INVALID_INPUT", "Research audit accepts only one state and new output");
  }
  input.signal.throwIfAborted();
  const loaded = await readPtsResearchInput(input.state, input.signal);
  const source = await openResearchAudit(
    loaded.audit.path,
    loaded.audit.value,
    loaded.input.sources.audit.payloadHash,
    loaded.input.sources.audit.sha256,
    input.signal,
  );
  if (source.record.config.history.sha256 !== loaded.input.sources.history.sha256) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Study and explicit frozen history bytes differ");
  }
  const analyzer = await codeIdentity();
  const directory = await newDirectory(input.output);
  const aggregate = summaries();
  const forensicRows: DecisionRow[] = [];
  const originalRows: ResearchTableRow[] = [];
  const recordedSlots = new Set<number>();
  let completeSlots = 0;
  for await (const item of source.rounds()) {
    input.signal.throwIfAborted();
    const { round } = item;
    if (
      !Number.isSafeInteger(round.slot) ||
      round.slot < 0 ||
      round.slot >= source.record.config.hours * 12
    ) {
      throw new PilotError("INVALID_INPUT", "Original round slot is outside the frozen window");
    }
    recordedSlots.add(round.slot);
    if (round.status === "completed" && round.executionStatus === "complete") {
      completeSlots++;
    }
    const initial = new Map<string, PtsResearchInspection | null>();
    const final = new Map<string, PtsAnalysis | null>();
    let finalEvidence: PerpsEvidence | undefined;
    for (const event of item.events) {
      if (event.kind === "execution-input") {
        finalEvidence = (event.data as { evidence?: PerpsEvidence }).evidence;
      }
    }
    const initialEvidenceHash = digest(round.evidence);
    for (const market of source.record.config.markets) {
      input.signal.throwIfAborted();
      const initialHistory = historyFor(round.evidence, market.symbol);
      const inspection = initialHistory
        ? inspectPtsResearch(initialHistory, round.evidence.observedAt)
        : null;
      initial.set(market.symbol, inspection);
      const finalHistory = historyFor(finalEvidence, market.symbol);
      final.set(
        market.symbol,
        finalHistory ? analyzePts(finalHistory, finalEvidence!.observedAt, "0.2.0-fast.2") : null,
      );
      const historical = round.proposals["pts-intraday"]?.find(
        (proposal) => proposal.symbol === market.symbol,
      );
      const rows = rowsAt(
        "forensic",
        round.evidence.observedAt,
        round.slot,
        market.symbol,
        market.marketId,
        inspection?.outcomes ?? unknownOutcomes("MISSING_OR_EXCLUDED_ORIGINAL_CANDLES"),
        {
          ...item.source,
          evidenceHash: initialEvidenceHash,
          evidenceHashPolicy: "sha256-canonical-audit-v1",
          interpretation: "ORIGINAL_INITIAL_EVIDENCE_AS_OF_ONLY",
        },
        historical ? { action: historical.action, reason: historical.reason } : null,
      );
      forensicRows.push(...rows);
      rows.forEach(aggregate.add);
    }
    originalRows.push(...historicalRows(item, source.record, initial, final));
  }
  const coverage = Array.from({ length: source.record.config.hours * 12 }, (_, slot) => ({
    slot,
    scheduledAt: source.record.startedAt === null ? null : source.record.startedAt + slot * 300000,
    status: recordedSlots.has(slot) ? "RECORDED" : "NOT_RECORDED",
    interpretation: recordedSlots.has(slot)
      ? "Original round status is retained in historical audit rows."
      : "Missing original evidence; not a hold, signal, financial observation or candidate row.",
  }));
  const historyWriter = await researchHistoryWriter(directory, input.signal);
  let historyRows = 0;
  let historyFiles;
  try {
    for (const market of source.record.config.markets) {
      const history = loaded.history.markets.find(
        (item) => item.market.marketId === market.marketId && item.market.symbol === market.symbol,
      );
      const session = history ? createPtsResearchSession(history) : null;
      for (
        let at = loaded.input.historyWindow.from + 300000;
        at <= loaded.input.historyWindow.to;
        at += 300000
      ) {
        input.signal.throwIfAborted();
        const outcomes = session?.inspect(at).outcomes ?? unknownOutcomes("MISSING_FROZEN_MARKET");
        for (const row of rowsAt("history", at, null, market.symbol, market.marketId, outcomes, {
          file: loaded.input.sources.history.file,
          sha256: loaded.input.sources.history.sha256,
          historyHash: loaded.input.sources.history.historyHash,
          at,
          interpretation: "CLOSED_5M_CAUSAL_PREFIX_OF_EXAMINED_DEVELOPMENT_HISTORY",
        })) {
          aggregate.add(row);
          await historyWriter.append(row);
          historyRows++;
        }
      }
    }
    historyFiles = await historyWriter.finish();
  } catch (error) {
    await historyWriter.discard();
    throw error;
  }
  const summary = aggregate.result();
  const financial = ptsFinancialAudit(source.accounts);
  const originalPtsRows = originalRows.filter((row) => row.variant === "pts-intraday");
  const fullTraceCounts = (
    field: "originalAccountReproduction" | "independentSignalReproduction",
  ) => {
    const values = originalPtsRows.map(
      (row) => (row.initialTrace as Record<string, string>)[field],
    );
    return {
      rows: values.length,
      fullTraceMatches: values.filter((value) => value === "MATCH").length,
      fullTraceDivergences: values.filter((value) => value === "DIVERGENCE").length,
      fullTraceNotVerifiable: values.filter((value) => value === "NOT_VERIFIABLE").length,
    };
  };
  const policyHashes = {
    reference: loaded.input.reference.sha256,
    ...Object.fromEntries(loaded.input.candidates.map((item) => [item.id, item.sha256])),
  };
  const report = {
    protocol: "pts-causal-research-report-v1",
    scope: {
      mode: "OFFLINE_CAUSAL_RESEARCH",
      dataUse: "examined-development",
      reference: "pts-intraday@0.2.0-fast.2",
      candidates: PTS_RESEARCH_CANDIDATES,
      historyWindow: loaded.input.historyWindow,
      publicTrialStarted: false,
      modelCalls: 0,
      providerCalls: 0,
      databaseConnections: 0,
      executableStrategyRegistration: false,
    },
    analyzer,
    sourceHash: source.payloadHash,
    source: {
      inputManifestHash: digest(loaded.input),
      originalExport: loaded.input.sources.audit,
      exportVersion: source.version,
      exporterCommit: source.exportCommit,
      studyCommit:
        (source.record.metadata as { commit?: string } | undefined)?.commit ?? "NOT_VERIFIABLE",
      historyCommit: loaded.history.commit,
      historySource: loaded.input.sources.history,
      studyStatus: source.record.status,
      startedAt: source.record.startedAt,
      endsAt: source.record.endsAt,
      observationParts: source.observationCount,
      partReferences: source.partReferences,
    },
    policyHashes,
    counts: {
      markets: source.record.config.markets.length,
      scheduledSlots: coverage.length,
      recordedSlots: recordedSlots.size,
      completeSlots,
      notRecordedSlots: coverage.length - recordedSlots.size,
      forensicRows: forensicRows.length,
      originalProposalRows: originalRows.length,
      historyRows,
      historyWindowsPerMarket:
        (loaded.input.historyWindow.to - loaded.input.historyWindow.from) / 300000,
    },
    originalReproduction: {
      policy: "EXISTING_AUDITOR_WITH_ORIGINAL_ROUND_ACCOUNTS",
      reproduced: originalRows.filter((row) => row.verification === "REPRODUCED").length,
      divergence: originalRows.filter((row) => row.verification === "DIVERGENCE").length,
      notVerifiable: originalRows.filter((row) => row.verification === "NOT_VERIFIABLE").length,
      initialTraceParity: originalRows.filter(
        (row) =>
          (row.initialTrace as { originalAccountReproduction: string })
            .originalAccountReproduction === "MATCH",
      ).length,
      originalAccountPtsFullTrace: fullTraceCounts("originalAccountReproduction"),
      independentSignalPtsFullTrace: fullTraceCounts("independentSignalReproduction"),
      originalPtsFirstBlockers: originalPtsRows.reduce<Record<string, number>>((counts, row) => {
        const reason = String(row.reason);
        counts[reason] = (counts[reason] ?? 0) + 1;
        return counts;
      }, {}),
      exactFinalPortfolioReproduction: "NOT_VERIFIABLE_WITHOUT_EXACT_PRE_EXECUTION_ACCOUNT",
    },
    financial: {
      candidateCounterfactual: {
        status: "NOT_VERIFIABLE",
        reason: "ORIGINAL_MINUTE_BOOKS_AND_HYPOTHETICAL_POSITION_FUNDING_PATHS_NOT_AVAILABLE",
        hypotheticalPositions: null,
        hypotheticalPnl: null,
      },
      actualRecordedLedger: financial,
      interpretation:
        "Existing trading-owned audit reads original posted ledger movements. Posted subtotals are separate from terminal portfolio return; pending funding and open positions stay explicit.",
    },
    interpretations: [
      "Historical trace facts, downstream sensitivity calculations and chronological signal projections are distinct evidence. Candidate rows are new calculations, never replacements for original proposals.",
      "All supplied history was already examined and is development evidence. No holdout, profitability ranking, independent provider-truth validation or parameter optimization is claimed.",
      "NOT_EVALUABLE_DEPENDENCY is excluded from dependency-eligible stage denominators; missing evidence remains NOT_VERIFIABLE. Scheduled slots without original rounds never become holds.",
      "Unique AB identities group one impulse; several ABC corrections can share it. Repeated polls, candidate arms and correlated markets do not create independent experiments.",
      "Signals are candidate-specific causal candle events. Removing one blocker does not imply all remaining gates pass, an executable order, a fill or a financial advantage.",
      "Original decision frames establish only their recorded as-of conditions. Valuation timestamps and frame hashes do not supply missing minute books or hypothetical funding paths.",
    ],
    forensicRows,
    historicalAudit: originalRows,
    historyArtifacts: ["history-decisions.json", "history.csv"],
    coverage,
    ...summary,
  };
  const files = { ...historyFiles };
  for (const [name, rows, columns] of [
    [
      "historical-audit.csv",
      originalRows,
      [
        "id",
        "slot",
        "symbol",
        "variant",
        "at",
        "status",
        "action",
        "reason",
        "verification",
        "initialTrace",
        "finalTrace",
        "initialEvidenceHash",
        "finalEvidenceHash",
        "source",
        "eventSources",
        "original",
        "finalDecision",
        "finalPortfolioReproduction",
        "exclusions",
      ],
    ],
    ["coverage.csv", coverage, ["slot", "scheduledAt", "status", "interpretation"]],
    [
      "episodes.csv",
      summary.episodes,
      [
        "mode",
        "candidate",
        "symbol",
        "abId",
        "uniqueABC",
        "abcIds",
        "episodeIds",
        "firstAt",
        "lastAt",
        "rows",
        "signalIds",
        "firstRowId",
        "lastRowId",
        "blockerExamples",
      ],
    ],
    [
      "stages.csv",
      summary.stages,
      [
        "mode",
        "candidate",
        "code",
        "dependsOn",
        "totalRows",
        "dependencyEligibleRows",
        "pass",
        "fail",
        "unknown",
        "notEvaluableDependency",
        "exampleRows",
      ],
    ],
  ] as const) {
    files[name] = await publishResearchArtifact(
      directory,
      name,
      researchCsv(rows, columns),
      input.signal,
    );
  }
  files["protocol-future.json"] = await publishResearchArtifact(
    directory,
    "protocol-future.json",
    [...bufferedChunks(jsonChunks(futureProtocol, { canonicalKeys: true })), "\n"],
    input.signal,
  );
  if (digest(analyzer) !== digest(await codeIdentity())) {
    throw new PilotError("AUDIT_HASH_MISMATCH", "Analyzer code changed during offline research");
  }
  const manifest = await publishPtsResearchReport(directory, report, files, input.signal);
  console.log(
    JSON.stringify({
      status: "offline-research-complete",
      output: directory,
      forensicRows: forensicRows.length,
      originalProposalRows: originalRows.length,
      historyRows,
      reportHash: manifest.reportHash,
      modelCalls: 0,
      providerCalls: 0,
    }),
  );
  return { directory, manifest, counts: report.counts };
}
