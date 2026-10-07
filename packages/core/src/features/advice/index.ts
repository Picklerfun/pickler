import { PilotError, type AgentConfig, type Scope } from "../research/types.js";
import { toolEnabled } from "../research/plugins.js";
import type { Principal } from "../access/domain/principal.js";

export type AdviceSymbol = "BTC" | "ETH";
export type AdviceLane = "jev" | "deepseek" | "web" | "web-fallback";
export type AdviceStatus = "queued" | "running" | "completed" | "failed";
interface AdvicePricing {
  jevModel: "jev-1.13.0";
  deepseekModel: string;
  inputRates: Record<"jev" | "deepseek", string>;
  outputRates: Record<"jev" | "deepseek", string>;
  webSearchUsd: string;
  requestLimitUsd: string;
  dailyLimitUsd: string;
  pricingVerifiedAt: string;
  pricingSources: string[];
}
export type AdvicePolicy = AdvicePricing &
  ({ version: 1 } | { version: 2; deepseekBaseUrl: string });
export interface AdviceAgent extends Scope {
  publicId: string;
  version: number;
  config: AgentConfig;
  published: boolean;
  enabled: boolean;
}
export interface AdviceJob {
  id: string;
  publicAgentId: string;
  userId: string;
  tenantId: string;
  agentId: string;
  symbol: AdviceSymbol;
  status: AdviceStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  configVersion: number;
  config: AgentConfig;
  policy: AdvicePolicy;
  result: unknown | null;
  error: string | null;
}
export interface AdvicePage {
  items: AdviceJob[];
  nextCursor: string | null;
}
export interface AdviceRepository {
  resolve(publicId: string): Promise<AdviceAgent>;
  enqueue(
    userId: string,
    publicId: string,
    symbol: AdviceSymbol,
    key: string,
    policy: AdvicePolicy,
  ): Promise<AdviceJob>;
  get(id: string): Promise<AdviceJob>;
  requestReplay(userId: string, publicId: string, key: string): Promise<AdviceJob | null>;
  history(publicId: string, symbol?: AdviceSymbol, cursor?: string): Promise<AdvicePage>;
}
export interface AdviceUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: string;
}
export interface AdviceExecutionRepository extends AdviceRepository {
  claim(): Promise<AdviceJob | null>;
  guard(job: AdviceJob): Promise<void>;
  renew(job: AdviceJob): Promise<void>;
  event(job: AdviceJob, kind: string, data: unknown): Promise<void>;
  startCall(job: AdviceJob, lane: AdviceLane, hash: string): Promise<void>;
  usage(job: AdviceJob, lane: AdviceLane, usage: AdviceUsage): Promise<void>;
  finish(job: AdviceJob, result: unknown | null, error?: string): Promise<void>;
  recover(): Promise<boolean>;
}
export function adviceMarkets(agent: AdviceAgent): AdviceSymbol[] {
  if (!agent.published || !agent.enabled || !agent.config.perpl) {
    return [];
  }
  if (
    !(["getPerpSnapshot", "getPerpOrderBook", "getPerpCandles"] as const).every((tool) =>
      toolEnabled(agent.config, tool),
    )
  ) {
    return [];
  }
  const markets: readonly string[] = agent.config.perpl.markets;
  return markets.filter((symbol): symbol is AdviceSymbol => symbol === "BTC" || symbol === "ETH");
}
export function assertAdviceAgent(agent: AdviceAgent, symbol?: AdviceSymbol): void {
  if (!agent.published) {
    throw new PilotError("NOT_FOUND", "Agent not found");
  }
  const markets = adviceMarkets(agent);
  if (!markets.length) {
    throw new PilotError("ADVICE_UNAVAILABLE", "Agent analysis is unavailable");
  }
  if (symbol && !markets.includes(symbol)) {
    throw new PilotError("MARKET_NOT_ALLOWED", "Market is not enabled for this agent");
  }
}
export function createAdviceService(
  repository: AdviceRepository,
  options: { enabled: boolean; policy: AdvicePolicy | null },
) {
  const user = (principal: Principal) => {
    if (principal.kind !== "user") {
      throw new PilotError("FORBIDDEN", "User session required");
    }
    return principal.id;
  };
  return {
    async capabilities(principal: Principal, id: string) {
      user(principal);
      const agent = await repository.resolve(id);
      if (!agent.published) {
        throw new PilotError("NOT_FOUND", "Agent not found");
      }
      const markets = adviceMarkets(agent);
      return {
        agentId: id,
        symbols: markets,
        horizonHours: 24 as const,
        available: options.enabled && options.policy !== null && markets.length > 0,
      };
    },
    async request(principal: Principal, id: string, symbol: AdviceSymbol, key: string) {
      const userId = user(principal);
      if (!options.enabled || !options.policy) {
        const agent = await repository.resolve(id);
        if (!agent.published) {
          throw new PilotError("NOT_FOUND", "Agent not found");
        }
        const replay = await repository.requestReplay(userId, id, key);
        if (replay) {
          if (replay.symbol !== symbol) {
            throw new PilotError("CONFLICT", "Idempotency key belongs to another request");
          }
          return replay;
        }
        throw new PilotError("ADVICE_UNAVAILABLE", "New analyses are disabled");
      }
      return repository.enqueue(userId, id, symbol, key, options.policy);
    },
    async get(principal: Principal, id: string) {
      const userId = user(principal);
      const job = await repository.get(id);
      const agent = await repository.resolve(job.publicAgentId);
      if (!agent.published || (job.status !== "completed" && job.userId !== userId)) {
        throw new PilotError("NOT_FOUND", "Analysis not found");
      }
      return job;
    },
    async history(principal: Principal, id: string, symbol?: AdviceSymbol, cursor?: string) {
      user(principal);
      const agent = await repository.resolve(id);
      if (!agent.published) {
        throw new PilotError("NOT_FOUND", "Agent not found");
      }
      return repository.history(id, symbol, cursor);
    },
  };
}
