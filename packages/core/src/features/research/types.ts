import {
  assertMarketScope,
  type MarketScope,
  type MarketClassification,
  type ResearchProtocol,
} from "./market-scope.js";
import type { PluginConfig } from "./plugins.js";
import type { ResearchReport, SportsContext, ResearchReference } from "./nfl.js";
export const TOOL_NAMES = [
  "searchWeb",
  "readPage",
  "getMarketRules",
  "getOrderBook",
  "getSportsContext",
  "getExternalOdds",
] as const;
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
export interface AgentConfig {
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
}
export type PolicyReason =
  | "MODEL_ABSTAINED"
  | "HIGH_UNCERTAINTY"
  | "MISSING_INFORMATION"
  | "MISSING_PROBABILITY"
  | "WIDE_PROBABILITY_RANGE"
  | "INSUFFICIENT_CONSERVATIVE_MARGIN"
  | "PRICE_EXCEEDS_LIMIT";
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
    selectionSteps?: number;
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
    };
  };
}

export interface ResearchRepository {
  agents(tenantId: string): Promise<AgentRecord[]>;
  agent(scope: Scope): Promise<AgentRecord>;
  updateConfig(scope: Scope, expectedVersion: number, config: AgentConfig): Promise<AgentRecord>;
  pause(scope: Scope, paused: boolean): Promise<void>;
  schedule(scope: Scope, enabled: boolean, now: number): Promise<void>;
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

export const DEFAULT_CONFIG: AgentConfig = {
  profile:
    "Research carefully. Read resolution rules, seek contrary evidence, and abstain when evidence is insufficient.",
  categoryIds: [],
  tools: [...TOOL_NAMES],
  intervalHours: 4,
  limits: { ...MAX_LIMITS },
  uncertaintyPolicy: { ...DEFAULT_UNCERTAINTY_POLICY },
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
        (id) => !["polymarket", "exa", "balldontlie", "the-odds-api", "paper-trading"].includes(id),
      ))
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid plugin configuration");
  }
  assertUncertaintyPolicy(config.uncertaintyPolicy ?? DEFAULT_UNCERTAINTY_POLICY);
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
