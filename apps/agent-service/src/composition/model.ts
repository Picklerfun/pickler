import { generalDecisionSystemPrompt } from "../prompts/general-decision-system";
import { diagnoseModel } from "./model-probe";
import { noopLogger } from "@mastra/core/logger";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import {
  modelAssessmentSchema,
  nflAssessmentSchema,
  generalAssessmentSchema,
} from "@pickler/api-schema";
import { PilotError, type ResearchModel, type Market } from "@pickler/core";
import { nflDecisionSystemPrompt } from "../prompts/nfl-decision-system";
import { decisionSystemPrompt } from "../prompts/decision-system";
import { modelDiagnostic } from "./model-diagnostics";
import {
  validatedModelOutput,
  classifyModelFailure,
  validateStructuredStep,
  record,
} from "./model-output";
import { buildTools } from "../plugins/registry";
import type { Environment } from "../config/env";
import { researchSystemPrompt } from "../prompts/research-system";
import {
  marketSelectionSystemPrompt,
  marketSelectionSchema,
} from "../prompts/market-selection-system";

export function createModel(env: Environment): ResearchModel & {
  check(): Promise<unknown>;
  diagnose(mode: "combined" | "split"): Promise<unknown>;
} {
  const provider = createOpenAICompatible({
    name: "pickler-configured",
    baseURL: env.MODEL_BASE_URL,
    apiKey: env.MODEL_API_KEY,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(180_000),
        ]),
      }),
  });
  const model = provider.chatModel(env.MODEL_ID);
  const settings = { maxOutputTokens: 2000 };
  // DashScope's hybrid models accept this nonstandard top-level request field.
  const isDashScope = ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"].includes(
    new URL(env.MODEL_BASE_URL).hostname,
  );
  return {
    metadata: () => ({
      model: env.MODEL_ID,
      provider: new URL(env.MODEL_BASE_URL).origin,
      prompts: {
        research: researchSystemPrompt,
        marketSelection: marketSelectionSystemPrompt,
        decision: decisionSystemPrompt,
        nflDecision: nflDecisionSystemPrompt,
        generalDecision: generalDecisionSystemPrompt,
      },
    }),
    async select(
      markets: Market[],
      profile: string,
      signal: AbortSignal,
      limits,
      now,
      onDiagnostic,
    ) {
      const agent = new Agent({
        maxRetries: 0,
        id: "market-selector",
        name: "Market selector",
        instructions: marketSelectionSystemPrompt.instructions,
        model,
      });
      agent.__setLogger(noopLogger);
      const schema = marketSelectionSchema;
      const started = Date.now();
      let stepFailure: PilotError | undefined;
      try {
        const result = await validatedModelOutput(
          () =>
            agent.generate(
              JSON.stringify({
                now,
                profile,
                candidates: markets.map(
                  ({ id, question, liquidity, closesAt, startsAt, timingSource }) => ({
                    startsAt,
                    timingSource,
                    id,
                    question,
                    liquidity,
                    closesAt,
                  }),
                ),
              }),
              {
                maxSteps: 1,
                abortSignal: signal,
                modelSettings: { maxOutputTokens: Math.min(limits.outputTokens, 2000) },
                ...(isDashScope
                  ? { providerOptions: { "pickler-configured": { enable_thinking: false } } }
                  : {}),
                onStepFinish: async (step) => {
                  await onDiagnostic?.(modelDiagnostic("selection", Date.now() - started, step));
                  try {
                    await validateStructuredStep(step, schema, "selection", signal);
                  } catch (error) {
                    stepFailure = classifyModelFailure(error, "selection", signal, step);
                  }
                },
                structuredOutput: { schema, logger: noopLogger },
              },
            ),
          schema,
          "selection",
          signal,
        );
        if (stepFailure) {
          throw stepFailure;
        }
        await onDiagnostic?.(
          modelDiagnostic("selection-result", Date.now() - started, {
            object: result.object,
            totalUsage: result.usage,
          }),
        );
        return { ...result.object, usage: result.usage };
      } catch (error) {
        const original = classifyModelFailure(error, "selection", signal);
        const failure = /^(MODEL_HTTP_|MODEL_TIMEOUT|MODEL_CANCELLED|LEASE_LOST)/.test(
          original.code,
        )
          ? original
          : (stepFailure ?? original);
        await onDiagnostic?.({
          phase: "selection",
          kind: "failure",
          durationMs: Date.now() - started,
          code: failure.code,
        });
        throw failure;
      }
    },
    async research(input) {
      const assessmentSchema =
        input.protocol === "general-market-v1"
          ? generalAssessmentSchema
          : input.protocol === "nfl-winner-v1"
            ? nflAssessmentSchema
            : modelAssessmentSchema;
      const agent = new Agent({
        maxRetries: 0,
        id: "researcher",
        name: "Pickler researcher",
        instructions: researchSystemPrompt.instructions,
        model,
        tools: buildTools(input.tools),
      });
      agent.__setLogger(noopLogger);
      const started = Date.now();
      let phase: "research" | "decision" = "research";
      let lastStep: unknown;
      let stepFailure: PilotError | undefined;
      let stepStarted = started;
      let stepIndex = 0;
      const usages: unknown[] = [];
      const callbacks = (phase: string) => ({
        prepareStep: async () => {
          await input.beforeStep?.();
          if (stepFailure) {
            throw stepFailure;
          }
          stepStarted = Date.now();
        },
        onStepFinish: async (step: { usage?: unknown }) => {
          lastStep = step;
          usages.push(step.usage);
          await input.onUsage(step.usage);
          const diagnostic = modelDiagnostic(phase, Date.now() - stepStarted, step);
          await input.onDiagnostic?.({ ...diagnostic, kind: "step", step: ++stepIndex });
          if (
            diagnostic.tools.some((tool) => tool.status !== "completed" || tool.name === "unknown")
          ) {
            stepFailure = new PilotError("MODEL_INVALID_TOOL", "Model tool call failed");
          }
          if (phase === "decision") {
            try {
              await validateStructuredStep(step, assessmentSchema, phase, input.signal);
            } catch (error) {
              stepFailure = classifyModelFailure(error, phase, input.signal, step);
            }
          }
        },
      });
      try {
        const research = await agent.generate(
          JSON.stringify({
            now: new Date().toISOString(),
            market: input.market,
            profile: input.profile,
            protocol: input.protocol,
            availability: input.availability,
            evidence: input.evidence?.(),
          }),
          {
            maxSteps: input.limits.steps - (input.selectionSteps ?? 1) - 1,
            abortSignal: input.signal,
            modelSettings: { maxOutputTokens: input.limits.outputTokens },
            ...callbacks("research"),
            toolCallConcurrency: 1,
          },
        );
        input.signal.throwIfAborted();
        if (record(research).error) {
          throw record(research).error;
        }
        if (stepFailure) {
          throw stepFailure;
        }
        await input.onDiagnostic?.(
          modelDiagnostic("research-result", Date.now() - started, research),
        );
        if (research.finishReason === "length") {
          throw new PilotError("MODEL_OUTPUT_TRUNCATED", "Research summary truncated");
        }
        if (research.finishReason === "content-filter") {
          throw new PilotError("MODEL_CONTENT_FILTERED", "Research output filtered");
        }
        if (research.finishReason === "error") {
          throw new PilotError("MODEL_FAILURE", "Research model failed");
        }
        if (!research.text?.trim()) {
          throw new PilotError("MODEL_EMPTY_RESPONSE", "Research summary absent");
        }
        await input.beforeStep?.();
        input.signal.throwIfAborted();
        phase = "decision";
        const finalizer = new Agent({
          maxRetries: 0,
          id: "research-decision",
          name: "Research decision",
          instructions:
            input.protocol === "general-market-v1"
              ? generalDecisionSystemPrompt.instructions
              : input.protocol === "nfl-winner-v1"
                ? nflDecisionSystemPrompt.instructions
                : decisionSystemPrompt.instructions,
          model,
        });
        finalizer.__setLogger(noopLogger);
        const result = await validatedModelOutput(
          () =>
            finalizer.generate(
              JSON.stringify({
                now: new Date().toISOString(),
                market: input.market,
                profile: input.profile,
                protocol: input.protocol,
                availability: input.availability,
                evidence: input.evidence?.(),
                untrustedResearchSummary: research.text,
              }),
              {
                maxSteps: 1,
                abortSignal: input.signal,
                modelSettings: { maxOutputTokens: input.limits.outputTokens },
                ...callbacks("decision"),
                structuredOutput: { schema: assessmentSchema, logger: noopLogger },
              },
            ),
          assessmentSchema,
          "decision",
          input.signal,
        );
        if (stepFailure) {
          throw stepFailure;
        }
        await input.onDiagnostic?.(
          modelDiagnostic("decision-result", Date.now() - stepStarted, {
            object: result.object,
            totalUsage: result.usage,
          }),
        );
        const total: Record<string, number> = {};
        for (const usage of usages) {
          const counts = modelDiagnostic(phase, 0, { usage }).usage;
          for (const [key, count] of Object.entries(counts)) {
            total[key] = (total[key] ?? 0) + count;
          }
        }
        return { decision: result.object, usage: total };
      } catch (error) {
        const original = classifyModelFailure(error, phase, input.signal, lastStep);
        const failure = /^(MODEL_HTTP_|MODEL_TIMEOUT|MODEL_CANCELLED|LEASE_LOST)/.test(
          original.code,
        )
          ? original
          : (stepFailure ?? original);
        await input.onDiagnostic?.({
          phase,
          kind: "failure",
          durationMs: Date.now() - started,
          code: failure.code,
        });
        throw failure;
      }
    },
    diagnose: (mode) => diagnoseModel(model, env.MODEL_ID, mode),
    async check() {
      let called = false;
      const echo = createTool({
        id: "connectionProbe",
        description: "Required connection probe. Call with value pickler.",
        inputSchema: z.object({ value: z.literal("pickler") }),
        outputSchema: z.object({ ok: z.literal(true) }),
        execute: async () => {
          called = true;
          return { ok: true as const };
        },
      });
      const agent = new Agent({
        maxRetries: 0,
        id: "connection-check",
        name: "Connection check",
        instructions: "Follow the probe instruction exactly.",
        model,
        tools: { connectionProbe: echo },
      });
      const probe = await agent.generate("Call connectionProbe with value pickler.", {
        maxSteps: 1,
        toolChoice: "required",
        modelSettings: settings,
      });
      if (!called) {
        throw new PilotError(
          "MODEL_TOOL_CHECK_FAILED",
          "Configured model did not invoke the probe",
        );
      }
      const structured = await new Agent({
        maxRetries: 0,
        id: "schema-check",
        name: "Schema check",
        instructions: `Return the requested structured sample as JSON; this is a connectivity fixture, not market research. The JSON response must satisfy this schema exactly: ${JSON.stringify(z.toJSONSchema(modelAssessmentSchema))}`,
        model,
      }).generate(
        "Return an ABSTAIN decision for market connectivity-check, sourceIds [connectivity-check], uncertaintyLevel HIGH, missingInformation [], probability null, all other nullable fields null except abstentionReason Connection validation only. Explain thesis, counterEvidence and uncertainty as Connection validation only.",
        {
          maxSteps: 1,
          modelSettings: settings,
          structuredOutput: { schema: modelAssessmentSchema, logger: noopLogger },
        },
      );
      modelAssessmentSchema.parse(structured.object);
      return {
        model: env.MODEL_ID,
        toolCall: true,
        structuredDecision: true,
        usage: [probe.totalUsage, structured.totalUsage],
      };
    },
  };
}
