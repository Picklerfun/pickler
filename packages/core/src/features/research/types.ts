import {
  assertMarketScope,
  type MarketScope,
  type MarketClassification,
  type ResearchProtocol,
} from "./market-scope.js";
import type { PluginConfig } from "./plugins.js";
import type { ResearchReport, SportsContext, ResearchReference } from "./nfl.js";
import type { Skill } from "./brief.js";
import { isBookKey, type BookKey } from "./books.js";
import { PERP_TOOLS, type PerplConfig } from "../perps/types.js";
import { assertPerplConfig } from "../perps/service.js";

/** The six voices' keys; `features/studio/create.ts` names and samples them. */
export const VOICE_KEYS = [
  "analyst",
  "contrarian",
  "trash_talker",
  "deadpan",
  "hype",
  "professor",
] as const;

export const RESEARCH_TOOL_NAMES = [
  "searchWeb",
  "readPage",
  "getMarketRules",
  "getOrderBook",
  "getSportsContext",
  "getExternalOdds",
] as const;
export const TOOL_NAMES = [...RESEARCH_TOOL_NAMES, ...PERP_TOOLS] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const MAX_LIMITS = {
  searches: 3,
  pageReads: 5,
  steps: 12,
  durationMs: 300_000,
  outputTokens: 32768,
  dailyRuns: 6,
} as const;
export type ResearchLimits = { [K in keyof typeof MAX_LIMITS]: number };
export interface DiscoveryPolicy {
  version: 1;
  mode: "open-market" | "pre-event";
  minLeadMinutes: number;
  maxHorizonDays: number;
}
export type WebMode = "anywhere" | "prefer" | "only";
export interface AgentSources {
  web: { mode: WebMode; sites: string[] } | null;
  /** `SPORTSBOOKS` keys the odds plugin may quote; empty means all. */
  books: BookKey[];
}
export const MAX_SKILLS = 8;
export const MAX_SKILL_PROMPT = 600;
export const MAX_SITES = 20;
export interface AgentConfig {
  perpsPaper?: import("./trading-config.js").PerpsPaperConfig | undefined;
  perpl?: PerplConfig | undefined;
  trading?: import("./trading-config.js").TradingConfig | undefined;
  marketScope?: MarketScope | undefined;
  plugins?: PluginConfig | undefined;
  researchProtocol?: "nfl-winner-v1" | undefined;
  discoveryPolicy?: DiscoveryPolicy | undefined;
  limits: ResearchLimits;
  profile: string;
  categoryIds?: string[] | undefined;
  tools: ToolName[];
  intervalHours: number;
  uncertaintyPolicy?: UncertaintyPolicy | undefined;
  /** What it reads beyond market data. `web: null` means the web is off. */
  sources?: AgentSources | undefined;
  /** Routines the person added; appended to the brief at run time (see brief.ts). */
  skills?: Skill[] | undefined;
  /**
   * What the person allows it to spend, in AUSD. Paper orders enforce it: one order's notional is
   * capped at `perCallAusd` and a UTC day's at `perDayAusd`. Absent until the person sets it.
   */
  spend?: SpendLimits | undefined;
  /**
   * The brief written on `/studio` (docs/specs/studio-brief-v1.md §2). Absent for legacy agents,
   * made before the brief existed, which behave exactly as before. Stored normalized;
   * `assertBrief` refuses anything else.
   */
  brief?: AgentBrief | undefined;
  /** The brief's MAX LEVERAGE. It applies to perps only. */
  maxLeverage?: number | undefined;
  /** The voice its posts are written in (docs/specs/studio-create-simplified-v1.md D8). */
  voice?: (typeof VOICE_KEYS)[number] | undefined;
  /**
   * OPEN AT ONCE and DAY-LOSS STOP (docs/specs/studio-live-v1.md L12). Saved for the Perpl runtime
   * to read; nothing enforces them yet. Absent means `RISK_DEFAULTS`: read it with `effectiveRisk`.
   */
  risk?: RiskLimits | undefined;
  /** How it enters (L13). Absent means `ENTRY_DEFAULTS`: read it with `effectiveEntry`. */
  entry?: EntrySetting | undefined;
}

export interface SpendLimits {
  perCallAusd: number;
  perDayAusd: number;
}

/** Bounds of `SpendLimits`, in AUSD. A day's cap is never below one call's. */
export const SPEND_BOUNDS = {
  perCallAusd: { min: 1, max: 1_000 },
  perDayAusd: { min: 1, max: 10_000 },
} as const;

/**
 * Paper orders enforce `spend` (per-trade notional and the UTC day's sum, `paper/orders.ts`). Real
 * money limits come with Go Public and the trading work, as Turnkey value caps.
 */
export const SPEND_ENFORCED = true;

/** Bounds and the day ≥ call rule; `assertConfig` and `updateSpend` both apply it. */
export function assertSpendLimits(spend: SpendLimits): void {
  const within = (value: unknown, bounds: { min: number; max: number }) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= bounds.min &&
    value <= bounds.max;
  if (
    !within(spend.perCallAusd, SPEND_BOUNDS.perCallAusd) ||
    !within(spend.perDayAusd, SPEND_BOUNDS.perDayAusd)
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "Spend limits must stay within 1–1000 a call and 1–10000 a day",
    );
  }
  if (spend.perDayAusd < spend.perCallAusd) {
    throw new PilotError("INVALID_INPUT", "A day's spend cannot be below one call's");
  }
}

export interface RiskLimits {
  /** How many positions it may hold at once. */
  maxOpenPositions: number;
  /** The loss in a UTC day, in AUSD, after which it stops entering. */
  dayLossStopAusd: number;
}

/** Bounds of `RiskLimits`. The day-loss stop moves in steps, as the studio's control does. */
export const RISK_BOUNDS = {
  maxOpenPositions: { min: 1, max: 6 },
  dayLossStopAusd: { min: 5, max: 200, step: 5 },
} as const;

/** What a config without `risk` means: one position, and a small stop, for a first agent. */
export const RISK_DEFAULTS = { maxOpenPositions: 1, dayLossStopAusd: 10 } as const;

export function assertRiskLimits(risk: RiskLimits): void {
  const open = RISK_BOUNDS.maxOpenPositions;
  const stop = RISK_BOUNDS.dayLossStopAusd;
  if (
    !Number.isInteger(risk.maxOpenPositions) ||
    risk.maxOpenPositions < open.min ||
    risk.maxOpenPositions > open.max
  ) {
    throw new PilotError("INVALID_INPUT", "Open positions must be a whole number from 1 to 6");
  }
  if (
    !Number.isInteger(risk.dayLossStopAusd) ||
    risk.dayLossStopAusd < stop.min ||
    risk.dayLossStopAusd > stop.max ||
    risk.dayLossStopAusd % stop.step !== 0
  ) {
    throw new PilotError("INVALID_INPUT", "The day-loss stop must be 5–200 AUSD in steps of 5");
  }
}

/** The stored risk, or the defaults; always the caller's own copy. */
export function effectiveRisk(config: Pick<AgentConfig, "risk">): RiskLimits {
  return { ...(config.risk ?? RISK_DEFAULTS) };
}

/**
 * How it enters: `approve` asks the owner first, `auto` enters on its own inside the caps. While
 * it waits for an answer it either stays out (`wait`) or goes in at `smallAusd` (`small`).
 * `meanwhile` and `smallAusd` are kept under `auto` too, so switching back finds them as left.
 */
export interface EntrySetting {
  mode: "approve" | "auto";
  meanwhile: "wait" | "small";
  smallAusd: number;
}

export const ENTRY_MODES = ["approve", "auto"] as const;
export const ENTRY_MEANWHILE = ["wait", "small"] as const;

/** What a config without `entry` means: it asks, and stays out until answered. */
export const ENTRY_DEFAULTS = { mode: "approve", meanwhile: "wait", smallAusd: 5 } as const;

/**
 * The shape, and `smallAusd` within one call's bounds. `perTradeAusd` is the cap it must also stay
 * under where that is being decided (`reviseSetup`). `assertConfig` does not pass it: `updateSpend`
 * lowers the cap without touching `entry`, and a stored config must stay readable after that, so
 * readers take the amount from `effectiveEntry`, which clamps it.
 */
export function assertEntrySetting(entry: EntrySetting, perTradeAusd?: number): void {
  if (
    !(ENTRY_MODES as readonly unknown[]).includes(entry.mode) ||
    !(ENTRY_MEANWHILE as readonly unknown[]).includes(entry.meanwhile)
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown entry mode");
  }
  const max = Math.min(perTradeAusd ?? Infinity, SPEND_BOUNDS.perCallAusd.max);
  if (
    typeof entry.smallAusd !== "number" ||
    !Number.isFinite(entry.smallAusd) ||
    entry.smallAusd < SPEND_BOUNDS.perCallAusd.min ||
    entry.smallAusd > max
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "The small entry must be at least 1 AUSD and no more than the per-trade cap",
    );
  }
}

/**
 * The stored entry, or the defaults; always the caller's own copy. `smallAusd` never exceeds the
 * per-trade cap: the default 5 under a smaller cap, or a stored amount the cap has since dropped
 * under, comes back as the cap.
 */
export function effectiveEntry(config: Pick<AgentConfig, "entry" | "spend">): EntrySetting {
  const entry = config.entry ?? ENTRY_DEFAULTS;
  const cap = config.spend?.perCallAusd ?? Infinity;
  return { ...entry, smallAusd: Math.min(entry.smallAusd, cap) };
}

/** How often a scheduled agent runs: whole hours, 1–168, the same bounds `assertConfig` applies. */
export function assertIntervalHours(hours: number): void {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new PilotError("INVALID_INPUT", "The interval must be 1–168 whole hours");
  }
}

export interface AgentRecord {
  id: string;
  tenantId: string;
  version: number;
  config: AgentConfig;
  paused: boolean;
  scheduleEnabled: boolean;
  nextDueAt: number | null;
}

export interface Scope {
  tenantId: string;
  agentId: string;
}

export interface Category {
  id: string;
  label: string;
}

export interface Market {
  classification?: MarketClassification | undefined;
  id: string;
  question: string;
  rules: string;
  categoryIds: string[];
  active: boolean;
  closesAt: string | null;
  startsAt?: string | null;
  timingSource?: string | null;
  sportsMarketType?: string | null;
  resolutionUrls?: string[];
  liquidity: number;
  outcomes: { id: string; label: string }[];
}

export interface OrderBook {
  outcomeId: string;
  observedAt: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
}

export interface Source {
  id: string;
  url: string;
  title: string;
  content: string;
  retrievedAt: string;
  publishedAt: string | null;
  provider: string;
  truncated: boolean;
  pluginVersion?: string;
  externalId?: string;
  providerUsage?: unknown;
  requestedUrl?: string;
  provenance?: "search" | "resolution-rule-link";
}

export interface LegacyDecision {
  action: "TRADE" | "ABSTAIN";
  marketId: string;
  outcomeId: string | null;
  thesis: string;
  counterEvidence: string;
  uncertainty: string;
  sourceIds: string[];
  estimatedProbability: number | null;
  observedPrice: string | null;
  limitPrice: string | null;
  expiresAt: string | null;
  abstentionReason: string | null;
}

export interface UncertaintyPolicy {
  blockHighUncertainty: boolean;
  requireCompleteInformation: boolean;
  minProbabilityMargin: number;
  maxProbabilityRangeWidth: number;
}
export const DEFAULT_UNCERTAINTY_POLICY: Readonly<UncertaintyPolicy> = Object.freeze({
  blockHighUncertainty: true,
  requireCompleteInformation: true,
  minProbabilityMargin: 0.01,
  maxProbabilityRangeWidth: 0.2,
});
export interface ModelAssessment extends Omit<LegacyDecision, "estimatedProbability"> {
  probability: { lower: number; estimate: number; upper: number } | null;
  uncertaintyLevel: "LOW" | "MEDIUM" | "HIGH";
  missingInformation: string[];
  report?: ResearchReport;
  /** The model's answer to each brief rule; required when the run's config has a brief (§3.2). */
  brief?: BriefEvaluation | undefined;
}

/** One answer per rule, in the brief's order. The policy layer checks it (`briefVerdict`). */
export interface BriefEvaluation {
  entries: { rule: string; fired: boolean; why: string }[];
  /** The `exitsWhen` line it set, copied exactly, or null. */
  exitArmed: string | null;
  neverChecked: { rule: string; respected: boolean }[];
}
export type PolicyReason =
  | "MODEL_ABSTAINED"
  | "HIGH_UNCERTAINTY"
  | "MISSING_INFORMATION"
  | "MISSING_PROBABILITY"
  | "WIDE_PROBABILITY_RANGE"
  | "INSUFFICIENT_CONSERVATIVE_MARGIN"
  | "PRICE_EXCEEDS_LIMIT"
  | "BRIEF_ENTRY_NOT_MET"
  | "BRIEF_NEVER_BROKEN";
export interface DecisionV2 extends LegacyDecision {
  schemaVersion: 2;
  modelAssessment: ModelAssessment;
  policyEvaluation: {
    version: "1.0.0";
    config: UncertaintyPolicy;
    finalAction: "TRADE" | "ABSTAIN";
    reasonCodes: PolicyReason[];
    evaluatedAt: string;
  };
}
export interface DecisionV3 extends Omit<DecisionV2, "schemaVersion"> {
  schemaVersion: 3;
  forecast: ResearchReport["forecast"];
  coverage: ResearchReport["sections"];
}
export interface DecisionV4 extends Omit<DecisionV3, "schemaVersion"> {
  schemaVersion: 4;
  protocol: ResearchProtocol;
}
export type Decision = LegacyDecision | DecisionV2 | DecisionV3 | DecisionV4;

export interface RunRecord extends Scope {
  id: string;
  trigger: "manual" | "schedule";
  marketId: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  configVersion: number;
  config: AgentConfig;
  decision: Decision | null;
  error: string | null;
}

export interface RunEvent {
  id: number;
  type: string;
  data: unknown;
  createdAt: number;
}

export interface SearchResult {
  sources: Source[];
  usage: unknown;
}

export interface WebSearch {
  search(query: string, signal: AbortSignal): Promise<SearchResult>;
}

export interface PageReader {
  read(url: string, signal: AbortSignal): Promise<Source>;
}

export interface MarketData {
  listScope?(
    scope: MarketScope,
    signal: AbortSignal,
    report?: (data: unknown) => Promise<void>,
  ): Promise<Market[]>;
  categories(signal: AbortSignal): Promise<Category[]>;
  list(
    categoryIds: string[],
    signal: AbortSignal,
    report?: (data: unknown) => Promise<void>,
  ): Promise<Market[]>;
  get(id: string, signal: AbortSignal): Promise<Market>;
  book(outcomeId: string, signal: AbortSignal): Promise<OrderBook>;
}

export interface ResearchTools {
  getSportsContext(): Promise<SportsContext>;
  getExternalOdds(): Promise<SportsContext>;
  searchWeb(query: string, intent: "supporting" | "contradicting"): Promise<Source[]>;
  readPage(url: string): Promise<Source>;
  getMarketRules(): Promise<Market>;
  getOrderBook(outcomeId: string): Promise<OrderBook>;
}

/** Trusted, versioned system instructions recorded when research starts. */
export interface PromptSnapshot {
  id: string;
  version: string;
  sha256: string;
  instructions: string;
}

export interface ResearchModel {
  select(
    markets: Market[],
    profile: string,
    signal: AbortSignal,
    limits: ResearchLimits,
    now: string,
    onDiagnostic?: (data: unknown) => Promise<void>,
  ): Promise<{ marketId: string; reason: string; usage: unknown }>;
  research(input: {
    market: Market;
    protocol?: ResearchProtocol;
    availability?: Record<string, string>;
    profile: string;
    tools: Partial<ResearchTools>;
    signal: AbortSignal;
    limits: ResearchLimits;
    onUsage(usage: unknown): Promise<void>;
    beforeStep?(): Promise<void>;
    onDiagnostic?(data: unknown): Promise<void>;
    evidence?(): { sources: Source[]; quotes: OrderBook[]; references?: ResearchReference[] };
    /** Trusted host capture of the exact tool-free finalizer evidence, never model input. */
    onDecisionInput?(input: DecisionInputSnapshot): void;
    selectionSteps?: number;
    /** The run's brief, so the decision can answer each rule. Absent without one. */
    brief?: AgentBrief | undefined;
  }): Promise<{ decision: ModelAssessment; usage: unknown }>;
  metadata(): {
    model: string;
    provider: string;
    prompts: {
      research: PromptSnapshot;
      marketSelection: PromptSnapshot;
      decision?: PromptSnapshot;
      nflDecision?: PromptSnapshot;
      generalDecision?: PromptSnapshot;
      briefDecision?: PromptSnapshot;
    };
  };
}

/** What persistence knows about an agent's readiness for its current configuration version. */
export interface ScheduleReadiness {
  connectionsChecked: boolean;
  manualSucceeded: boolean;
}

export interface DecisionInputSnapshot {
  observedAt: string;
  market: Market;
  evidence: { sources: Source[]; quotes: OrderBook[]; references?: ResearchReference[] };
}

/** Observation only: the primary decision has already been durably completed. */
export interface ResearchObservation extends DecisionInputSnapshot {
  schemaVersion: 1;
  scope: Scope & { runId: string; configVersion: number };
  primary: {
    decision: Decision;
    usage: unknown;
    metadata: ReturnType<ResearchModel["metadata"]>;
  };
}

export interface ResearchObserver {
  completed(snapshot: ResearchObservation): Promise<void>;
  failed?(): void | Promise<void>;
}

/** What a config save may ask of `updateConfig` beyond the write itself. */
export interface UpdateConfigOptions {
  perplOnly?: boolean;
  writeSpend?: boolean;
  versionSummary?: (prev: AgentConfig, next: AgentConfig) => string;
}

export interface ResearchRepository {
  agents(tenantId: string): Promise<AgentRecord[]>;
  agent(scope: Scope): Promise<AgentRecord>;
  /**
   * A new configuration version (stale `expectedVersion`: CONFLICT). With `perplOnly`, refused with
   * NOT_A_PERPL_AGENT unless the stored config has `perpl`, checked in the same transaction as the
   * write. `config.spend` is ignored (the stored one is kept) unless `writeSpend` is set, which
   * writes it in the same transaction. With `versionSummary`, the new version is recorded in that
   * transaction too (studio-live-v1 L10), under the line it answers for the stored config before
   * and after; a write that fails records nothing, and a record that fails writes nothing.
   */
  updateConfig(
    scope: Scope,
    expectedVersion: number,
    config: AgentConfig,
    options?: UpdateConfigOptions,
  ): Promise<AgentRecord>;
  /**
   * Writes only `config.spend`. Unlike `updateConfig` it keeps the version, the schedule and so
   * readiness: spend limits do not change how the agent researches.
   */
  updateSpend(scope: Scope, spend: SpendLimits): Promise<AgentRecord>;
  /**
   * Writes only `config.intervalHours`. Like `updateSpend` it keeps the version, the schedule and
   * readiness: the person tunes it right before turning the schedule on. When the schedule is on,
   * the next run moves to `now` plus the new interval, as turning the schedule on computes it.
   */
  updateInterval(scope: Scope, hours: number, now: number): Promise<AgentRecord>;
  pause(scope: Scope, paused: boolean): Promise<void>;
  schedule(scope: Scope, enabled: boolean, now: number): Promise<void>;
  /** The facts `isReadyToSchedule` reads, for the agent's current configuration version. */
  readiness(scope: Scope): Promise<ScheduleReadiness>;
  enqueue(scope: Scope, key: string, marketId: string | null, now: number): Promise<RunRecord>;
  run(tenantId: string, runId: string): Promise<RunRecord>;
  events(tenantId: string, runId: string): Promise<RunEvent[]>;
  event(run: RunRecord, type: string, data: unknown, now: number): Promise<void>;
  claim(now: number): Promise<RunRecord | null>;
  assertOwnership(run: RunRecord): Promise<void>;
  renew(run: RunRecord): Promise<void>;
  setConcurrency(globalLimit: number, tenantLimit: number): Promise<void>;
  finish(
    run: RunRecord,
    decision: Decision | null,
    error: string | null,
    now: number,
  ): Promise<void>;
  tick(now: number): Promise<void>;
  recover(now: number): Promise<void>;
  setConnectionsChecked(ok: boolean): Promise<void>;
}
// Capability-specific repository views share one transactional implementation in this pilot.
export type ConfigurationRepository = Pick<ResearchRepository, "agents" | "agent" | "updateConfig">;
export type RunRepository = Pick<ResearchRepository, "enqueue" | "run" | "claim" | "recover">;
export type EvidenceRepository = Pick<ResearchRepository, "events" | "event">;
export type DecisionRepository = Pick<ResearchRepository, "finish" | "run">;
export class PilotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PilotError";
  }
}

export class PersistenceFailure extends PilotError {
  constructor(
    public readonly details: {
      operation: "event";
      eventType: string;
      reason: "CONNECTION_LOST" | "QUERY_TIMEOUT" | "DATABASE_ERROR";
    },
  ) {
    super(
      "PERSISTENCE_FAILURE",
      "Research persistence failed; inspect the persistence_failure event",
    );
  }
}

/** The brief a person writes on `/studio` (§2). Lines are trimmed and never blank. */
export interface AgentBrief {
  /** Why this edge exists, in plain words. May be empty. */
  thesis: string;
  /** One source per line: a site, an @account or a named feed. */
  reads: string[];
  /** Every line must be true for it to enter. At least one. */
  entersWhen: string[];
  /** The first line that turns true closes it. */
  exitsWhen: string[];
  /** Hard lines it will not cross. */
  never: string[];
}

/** The canvas sets none; these exist so a brief fits a prompt. */
export const BRIEF_LIMITS = {
  thesis: 600,
  line: 200,
  reads: 12,
  entersWhen: 8,
  exitsWhen: 8,
  never: 8,
} as const;

export type BriefField = keyof AgentBrief;
export type BriefProblem = "required" | "too_long" | "too_many" | "not_trimmed";

/** 400 INVALID_BRIEF, naming the section and why, so the screen can say it under that section. */
export class BriefError extends PilotError {
  constructor(
    public readonly field: BriefField,
    public readonly reason: BriefProblem,
  ) {
    super("INVALID_BRIEF", `Brief ${field}: ${reason}`);
  }
}

const BRIEF_LISTS = ["reads", "entersWhen", "exitsWhen", "never"] as const;

/** The canvas's `split('\n').map(trim).filter(Boolean)`, for text or for lines already split. */
export function briefLines(value: string | readonly string[]): string[] {
  const raw =
    typeof value === "string" ? value.split("\n") : value.flatMap((line) => line.split("\n"));
  return raw.map((line) => line.trim()).filter(Boolean);
}

export function normalizeBrief(input: AgentBrief): AgentBrief {
  return {
    thesis: input.thesis.trim(),
    reads: briefLines(input.reads),
    entersWhen: briefLines(input.entersWhen),
    exitsWhen: briefLines(input.exitsWhen),
    never: briefLines(input.never),
  };
}

/** Every write path runs this on a normalized brief; it never fixes one up. */
export function assertBrief(brief: AgentBrief): void {
  if (typeof brief.thesis !== "string" || brief.thesis !== brief.thesis.trim()) {
    throw new BriefError("thesis", "not_trimmed");
  }
  if (brief.thesis.length > BRIEF_LIMITS.thesis) {
    throw new BriefError("thesis", "too_long");
  }
  for (const field of BRIEF_LISTS) {
    const lines: unknown = brief[field];
    if (!Array.isArray(lines)) {
      throw new BriefError(field, "required");
    }
    if (lines.length > BRIEF_LIMITS[field]) {
      throw new BriefError(field, "too_many");
    }
    for (const line of lines) {
      if (typeof line !== "string" || !line || line !== line.trim() || line.includes("\n")) {
        throw new BriefError(field, "not_trimmed");
      }
      if (line.length > BRIEF_LIMITS.line) {
        throw new BriefError(field, "too_long");
      }
    }
  }
  if (brief.entersWhen.length === 0) {
    throw new BriefError("entersWhen", "required");
  }
}

/** MAX LEVERAGE: stored, shown with "Soon", applied once perps run. */
export const LEVERAGE_BOUNDS = { min: 1, max: 10 } as const;

export function assertMaxLeverage(value: number): void {
  if (!Number.isInteger(value) || value < LEVERAGE_BOUNDS.min || value > LEVERAGE_BOUNDS.max) {
    throw new PilotError("INVALID_INPUT", "Leverage must be a whole number from 1 to 10");
  }
}

/**
 * The eight inputs a run was made from (§5): thesis, reads, enters, exits, never, per trade, per
 * day, leverage. Taken on the normalized brief, so whitespace alone never makes a run stale.
 */
export function briefFingerprint(input: {
  brief: AgentBrief;
  spend: SpendLimits;
  maxLeverage: number;
}): string {
  const { brief, spend, maxLeverage } = input;
  return JSON.stringify([
    brief.thesis,
    brief.reads,
    brief.entersWhen,
    brief.exitsWhen,
    brief.never,
    spend.perCallAusd,
    spend.perDayAusd,
    maxLeverage,
  ]);
}

export const DEFAULT_CONFIG: AgentConfig = {
  profile:
    "Research carefully. Read resolution rules, seek contrary evidence, and abstain when evidence is insufficient.",
  categoryIds: [],
  tools: [...RESEARCH_TOOL_NAMES],
  intervalHours: 4,
  limits: { ...MAX_LIMITS },
  uncertaintyPolicy: { ...DEFAULT_UNCERTAINTY_POLICY },
  sources: { web: { mode: "anywhere", sites: [] }, books: [] },
  skills: [],
};

export function assertUncertaintyPolicy(policy: UncertaintyPolicy): void {
  if (
    typeof policy.blockHighUncertainty !== "boolean" ||
    typeof policy.requireCompleteInformation !== "boolean" ||
    !Number.isFinite(policy.minProbabilityMargin) ||
    policy.minProbabilityMargin < 0 ||
    policy.minProbabilityMargin > 1 ||
    !Number.isFinite(policy.maxProbabilityRangeWidth) ||
    policy.maxProbabilityRangeWidth < 0 ||
    policy.maxProbabilityRangeWidth > 1
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid uncertainty policy");
  }
}

export function assertConfig(config: AgentConfig): void {
  if (
    config.perpsPaper &&
    (config.perpsPaper.version !== 1 || config.perpsPaper.policy !== "conservative-1x-v1")
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid perpetual paper policy");
  }
  if (config.perpl) {
    assertPerplConfig(config.perpl);
  }
  if (
    config.trading &&
    (config.trading.version !== 1 || !["off", "manual", "automatic"].includes(config.trading.mode))
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid trading configuration");
  }
  if (config.marketScope) {
    assertMarketScope(config.marketScope);
    if (
      config.categoryIds !== undefined ||
      config.researchProtocol !== undefined ||
      config.discoveryPolicy !== undefined
    ) {
      throw new PilotError("INVALID_INPUT", "Do not mix marketScope with legacy selection fields");
    }
  } else if (!Array.isArray(config.categoryIds)) {
    throw new PilotError("INVALID_INPUT", "Market selection is required");
  }
  const discovery = config.discoveryPolicy;
  if (
    config.researchProtocol &&
    (config.researchProtocol !== "nfl-winner-v1" || discovery?.mode !== "pre-event")
  ) {
    throw new PilotError("INVALID_INPUT", "NFL research requires pre-event discovery");
  }
  if (
    discovery &&
    (discovery.version !== 1 ||
      !["open-market", "pre-event"].includes(discovery.mode) ||
      !Number.isInteger(discovery.minLeadMinutes) ||
      discovery.minLeadMinutes < 15 ||
      discovery.minLeadMinutes > 1440 ||
      !Number.isInteger(discovery.maxHorizonDays) ||
      discovery.maxHorizonDays < 1 ||
      discovery.maxHorizonDays > 7)
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid discovery policy");
  }
  if (
    config.plugins &&
    (config.plugins.version !== 1 ||
      new Set(config.plugins.enabled).size !== config.plugins.enabled.length ||
      config.plugins.enabled.some(
        (id) =>
          ![
            "polymarket",
            "exa",
            "balldontlie",
            "the-odds-api",
            "paper-trading",
            "polymarket-trading",
            "perpl",
            "perps-paper",
          ].includes(id),
      ))
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid plugin configuration");
  }
  assertUncertaintyPolicy(config.uncertaintyPolicy ?? DEFAULT_UNCERTAINTY_POLICY);
  if (config.sources) {
    const web = config.sources.web;
    if (web) {
      if (!["anywhere", "prefer", "only"].includes(web.mode)) {
        throw new PilotError("INVALID_INPUT", "Invalid web mode");
      }
      if ((web.mode === "prefer" || web.mode === "only") && web.sites.length === 0) {
        throw new PilotError("INVALID_INPUT", "Prefer and only need at least one site");
      }
      if (
        web.sites.length > MAX_SITES ||
        web.sites.some((site) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site))
      ) {
        throw new PilotError("INVALID_INPUT", "Sites must be bare hostnames");
      }
    }
    if (!Array.isArray(config.sources.books) || !config.sources.books.every(isBookKey)) {
      throw new PilotError("INVALID_INPUT", "Invalid sportsbook list");
    }
  }
  if (config.spend !== undefined) {
    assertSpendLimits(config.spend);
  }
  if (config.brief !== undefined) {
    assertBrief(config.brief);
  }
  if (config.maxLeverage !== undefined) {
    assertMaxLeverage(config.maxLeverage);
  }
  if (config.voice !== undefined && !VOICE_KEYS.includes(config.voice)) {
    throw new PilotError("INVALID_INPUT", "Unknown voice");
  }
  if (config.risk !== undefined) {
    assertRiskLimits(config.risk);
  }
  if (config.entry !== undefined) {
    assertEntrySetting(config.entry);
  }
  if (config.skills) {
    if (config.skills.length > MAX_SKILLS) {
      throw new PilotError("INVALID_INPUT", `At most ${MAX_SKILLS} skills`);
    }
    for (const skill of config.skills) {
      const name = skill.name.trim();
      const prompt = skill.prompt.trim();
      if (!name || name.length > 40 || !prompt || prompt.length > MAX_SKILL_PROMPT) {
        throw new PilotError(
          "INVALID_INPUT",
          `A skill needs a name (≤ 40) and a prompt (≤ ${MAX_SKILL_PROMPT})`,
        );
      }
    }
  }
  if (
    !config.limits ||
    Object.entries(MAX_LIMITS).some(([key, cap]) => {
      const value = config.limits[key as keyof ResearchLimits];
      return !Number.isInteger(value) || value < 1 || value > cap;
    }) ||
    config.limits.steps < 3 ||
    config.limits.searches < 2
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "Limits must stay within pilot caps; at least three model steps required",
    );
  }
  if (
    !config.profile.trim() ||
    config.profile.length > 4000 ||
    (config.categoryIds?.length ?? 0) > 10 ||
    config.categoryIds?.some((id) => !/^\d+$/.test(id)) ||
    new Set(config.categoryIds).size !== (config.categoryIds?.length ?? 0) ||
    config.tools.some((tool) => !TOOL_NAMES.includes(tool)) ||
    new Set(config.tools).size !== config.tools.length ||
    !Number.isInteger(config.intervalHours) ||
    config.intervalHours < 1 ||
    config.intervalHours > 168
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid agent configuration");
  }
}

export interface ModelFailureDetails {
  stage: "selection" | "research" | "decision";
  validation?: { code: string; path: string }[];
  statusCode?: number;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

export class ModelFailure extends PilotError {
  constructor(
    code: string,
    public readonly details: ModelFailureDetails,
  ) {
    super(code, "Model execution failed; inspect the model_failure event");
  }
}

export function isMarketOpen(market: Market, now: number): boolean {
  return market.active && market.closesAt !== null && Date.parse(market.closesAt) > now;
}

export function assertMarket(market: Market, categories: string[], now: number): void {
  if (!market.active || !categories.some((id) => market.categoryIds.includes(id))) {
    throw new PilotError(
      "MARKET_NOT_ALLOWED",
      "Market is inactive or outside the configured categories",
    );
  }
  if (!isMarketOpen(market, now)) {
    throw new PilotError("MARKET_NOT_OPEN", "Market needs a valid future closing date");
  }
}
