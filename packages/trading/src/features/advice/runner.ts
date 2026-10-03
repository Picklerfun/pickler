import {
  PilotError,
  assertAdviceAgent,
  type AdviceExecutionRepository,
  type AdviceJob,
  type PerpCandles,
} from "@pickler/core";
import { validatePaperFrame, type PerpsPaperFrame } from "../perps-paper/simulation.js";
export interface AdviceSource {
  id: string;
  name: string;
  url: string;
  observedAt: string;
}
export interface AdviceEvidence {
  frame: PerpsPaperFrame;
  candles: PerpCandles;
  sources: AdviceSource[];
  web: unknown[];
}
export interface AdviceAnswer {
  orientation: "long" | "short" | "wait";
  summary: string;
  reasons: string[];
  risks: string[];
  limitations: string[];
  sourceIds: string[];
}
export interface AdviceModels {
  metadata(): unknown;
  sufficient(
    job: AdviceJob,
    evidence: AdviceEvidence,
    signal: AbortSignal,
  ): Promise<{ skip: boolean; answers: unknown }>;
  forecast(job: AdviceJob, evidence: AdviceEvidence, signal: AbortSignal): Promise<AdviceAnswer>;
}
export function validateAdviceEvidence(job: AdviceJob, evidence: AdviceEvidence, now: number) {
  const network = job.config.perpl!.network;
  validatePaperFrame(evidence.frame, network, job.symbol, now);
  const candles = evidence.candles;
  const lastClosed = Math.floor(now / 3600000) * 3600000 - 3600000;
  if (
    candles.market.symbol !== job.symbol ||
    candles.market.marketId !== evidence.frame.snapshot.market.marketId ||
    candles.market.provenance.network !== network ||
    candles.resolution !== 3600 ||
    candles.missingOpenTimes.length ||
    candles.candles.length !== 60 ||
    candles.candles.some((c, i) => !c.closed || c.openTime !== lastClosed - (59 - i) * 3600000)
  ) {
    throw new PilotError(
      "DATA_UNAVAILABLE",
      "Sixty closed consecutive hourly candles are required",
    );
  }
}
export function createAdviceRunner(deps: {
  repository: AdviceExecutionRepository;
  data(job: AdviceJob, signal: AbortSignal): Promise<AdviceEvidence>;
  models: AdviceModels;
  now(): number;
}) {
  return async (job: AdviceJob, signal: AbortSignal) => {
    const guard = async () => {
      signal.throwIfAborted();
      await deps.repository.guard(job);
      const agent = await deps.repository.resolve(job.publicAgentId);
      assertAdviceAgent(agent, job.symbol);
      if (
        agent.version !== job.configVersion ||
        JSON.stringify(agent.config) !== JSON.stringify(job.config)
      ) {
        throw new PilotError("CONFIG_CHANGED", "Agent configuration changed");
      }
    };
    try {
      await guard();
      await deps.repository.event(job, "metadata", deps.models.metadata());
      const evidence = await deps.data(job, signal);
      await guard();
      validateAdviceEvidence(job, evidence, deps.now());
      await deps.repository.event(job, "evidence", evidence);
      const review = await deps.models.sufficient(job, evidence, signal);
      await guard();
      await deps.repository.event(job, "jev_review", review);
      let answer: AdviceAnswer;
      if (review.skip) {
        answer = {
          orientation: "wait",
          summary: "Material evidence gaps prevent a supported analysis.",
          reasons: ["The sufficiency review identified missing or conflicting evidence."],
          risks: ["The available evidence is insufficient for a direction."],
          limitations: ["No DeepSeek forecast was requested."],
          sourceIds: evidence.sources.map((s) => s.id),
        };
      } else {
        validateAdviceEvidence(job, evidence, deps.now());
        answer = await deps.models.forecast(job, evidence, signal);
      }
      await guard();
      const sources = evidence.sources.filter((source) => answer.sourceIds.includes(source.id));
      if (
        !sources.length ||
        answer.sourceIds.some((id) => !evidence.sources.some((s) => s.id === id))
      ) {
        throw new PilotError("MODEL_OUTPUT_INVALID", "Analysis must cite available evidence");
      }
      await deps.repository.finish(job, {
        version: 1,
        symbol: job.symbol,
        network: job.config.perpl!.network,
        horizonHours: 24,
        orientation: answer.orientation,
        summary: answer.summary,
        reasons: answer.reasons,
        risks: answer.risks,
        limitations: answer.limitations,
        sources,
        generatedAt: new Date(deps.now()).toISOString(),
        dataAsOf: new Date(
          evidence.frame.snapshot.ticker.provenance.providerTimestamp!,
        ).toISOString(),
      });
    } catch (error) {
      if (error instanceof PilotError && error.code === "LEASE_LOST") {
        throw error;
      }
      await deps.repository.finish(
        job,
        null,
        error instanceof PilotError ? error.code : "ANALYSIS_FAILED",
      );
    }
  };
}
