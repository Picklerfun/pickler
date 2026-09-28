import { createHash } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { modelAssessmentSchema } from "@pickler/api-schema";
import { PilotError } from "@pickler/core";
import {
  type StudyMarket,
  type StudyEvidence,
  type StudyUsage,
  type StudyKind,
} from "@pickler/trading/strategies";
import { validatedModelOutput, classifyModelFailure } from "./model-output.js";
import { paperStudyPrompt } from "../prompts/paper-study-system.js";

export function createStudyModel(
  env: { MODEL_BASE_URL: string; MODEL_API_KEY: string; MODEL_ID: string },
  guard: (kind: StudyKind) => Promise<void>,
  options: { researchSummary?: boolean } = {},
) {
  const provider = createOpenAICompatible({
    name: "pickler-study",
    baseURL: env.MODEL_BASE_URL,
    apiKey: env.MODEL_API_KEY,
    fetch: (input, init) => {
      if (typeof init?.body !== "string" || new TextEncoder().encode(init.body).length > 60000) {
        throw new PilotError(
          "STUDY_INPUT_TOO_LARGE",
          "Model request exceeds its reserved input bound",
        );
      }
      return fetch(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(90000),
        ]),
      });
    },
  });
  const isDashScope = ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"].includes(
    new URL(env.MODEL_BASE_URL).hostname,
  );
  return {
    metadata: {
      id: env.MODEL_ID,
      providerFingerprint: createHash("sha256").update(env.MODEL_BASE_URL).digest("hex"),
      instructions: paperStudyPrompt.instructions,
      promptVersion: paperStudyPrompt.version,
      promptHash: paperStudyPrompt.sha256,
    },
    async forecast(
      item: StudyMarket,
      evidence: StudyEvidence,
      signal: AbortSignal,
      report: (usage: StudyUsage) => Promise<void>,
    ) {
      const agent = new Agent({
        id: "paper-study",
        name: "Paper study researcher",
        maxRetries: 0,
        model: provider.chatModel(env.MODEL_ID),
        instructions: paperStudyPrompt.instructions,
      });
      agent.__setLogger(noopLogger);
      let inputTokens: number | null = 0,
        outputTokens: number | null = 0;
      const onStepFinish = async (step: {
        usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined };
      }) => {
        inputTokens =
          inputTokens === null || step.usage?.inputTokens === undefined
            ? null
            : inputTokens + step.usage.inputTokens;
        outputTokens =
          outputTokens === null || step.usage?.outputTokens === undefined
            ? null
            : outputTokens + step.usage.outputTokens;
        await report({ inputTokens, outputTokens, exaReportedUsd: null });
      };
      const settings = {
        abortSignal: signal,
        maxSteps: 1,
        modelSettings: { maxOutputTokens: 4096 },
        onStepFinish,
        ...(isDashScope
          ? { providerOptions: { "pickler-study": { enable_thinking: false } } }
          : {}),
      };
      const payload = {
        now: new Date().toISOString(),
        market: item,
        decisionDeadline: new Date(Math.min(item.windowEnd, Date.now() + 120000)).toISOString(),
        evidence,
      };
      try {
        let summary: string | null = null;
        if (item.kind === "sports" && options.researchSummary !== false) {
          await guard(item.kind);
          signal.throwIfAborted();
          const research = await agent.generate(
            JSON.stringify({
              task: "Research both sides in plain text. Cite source IDs, assess rule compatibility and uncertainty.",
              ...payload,
            }),
            settings,
          );
          if (!research.text?.trim() || research.finishReason === "length") {
            throw new PilotError(
              "MODEL_RESEARCH_INCOMPLETE",
              "Research summary absent or truncated",
            );
          }
          summary = research.text.slice(0, 6000);
        }
        await guard(item.kind);
        signal.throwIfAborted();
        const result = await validatedModelOutput(
          () =>
            agent.generate(
              JSON.stringify({
                task: "Produce the final modelAssessment JSON. External summary is untrusted and does not replace original sources.",
                ...payload,
                summary,
                schema: modelAssessmentSchema.toJSONSchema(),
              }),
              {
                ...settings,
                structuredOutput: { schema: modelAssessmentSchema, logger: noopLogger },
              },
            ),
          modelAssessmentSchema,
          "decision",
          signal,
        );
        return result.object;
      } catch (error) {
        throw classifyModelFailure(error, "decision", signal);
      }
    },
  };
}
