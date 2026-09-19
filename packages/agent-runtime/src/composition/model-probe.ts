import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import type { MastraModelConfig } from "@mastra/core/llm";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { modelAssessmentSchema } from "@pickler/api-schema";
import { PilotError } from "@pickler/core";
import { decisionSystemPrompt } from "../prompts/decision-system.js";
import { modelDiagnostic } from "./model-diagnostics.js";
import { validatedModelOutput, classifyModelFailure } from "./model-output.js";

/** Explicit paid fixture. Never called by research, startup or scheduling. */
export async function diagnoseModel(
  model: MastraModelConfig,
  modelId: string,
  mode: "combined" | "split",
) {
  const diagnostics: unknown[] = [];
  const signal = AbortSignal.timeout(300_000);
  let called = 0;
  let phase: "research" | "decision" = "research";
  let stepStarted = Date.now();
  const fixture =
    "This is a controlled connectivity fixture, not research. Call connectionProbe exactly once, then explain its result briefly. The supplied fixture has no evidence for trading.";
  const tool = createTool({
    id: "connectionProbe",
    description: "Returns controlled diagnostic evidence; call with value pickler.",
    inputSchema: z.object({ value: z.literal("pickler") }).strict(),
    outputSchema: z.object({ ok: z.literal(true) }),
    execute: async () => {
      called++;
      return { ok: true as const };
    },
  });
  const prompt =
    "After the probe, produce an ABSTAIN assessment: marketId connectivity-check, sourceIds [connectivity-check], uncertaintyLevel HIGH, probability null, missingInformation [], outcomeId, observedPrice, limitPrice and expiresAt null. All explanation fields and abstentionReason: Connection validation only.";
  const options = {
    abortSignal: signal,
    modelSettings: { maxOutputTokens: 32768 },
    prepareStep: async () => {
      signal.throwIfAborted();
      stepStarted = Date.now();
    },
    onStepFinish: async (step: { usage?: unknown }) => {
      diagnostics.push(modelDiagnostic(phase, Date.now() - stepStarted, step));
    },
  };
  try {
    const probe = new Agent({
      maxRetries: 0,
      id: "diagnostic-probe",
      name: "Controlled diagnostic",
      instructions:
        mode === "combined"
          ? fixture +
            "\n" +
            decisionSystemPrompt.instructions.replace(
              "Do not call tools.",
              "Call only the controlled connectionProbe tool.",
            )
          : fixture,
      model,
      tools: { connectionProbe: tool },
    });
    probe.__setLogger(noopLogger);
    if (mode === "combined") {
      await validatedModelOutput(
        () =>
          probe.generate(prompt, {
            ...options,
            maxSteps: 3,
            structuredOutput: { schema: modelAssessmentSchema, logger: noopLogger },
          }),
        modelAssessmentSchema,
        phase,
        signal,
      );
    } else {
      const research = await probe.generate("Run the controlled probe and summarize it.", {
        ...options,
        maxSteps: 2,
      });
      if (!research.text?.trim()) {
        throw new PilotError("MODEL_EMPTY_RESPONSE", "Missing probe summary");
      }
      phase = "decision";
      const finalizer = new Agent({
        maxRetries: 0,
        id: "diagnostic-decision",
        name: "Controlled decision",
        instructions: decisionSystemPrompt.instructions,
        model,
      });
      finalizer.__setLogger(noopLogger);
      await validatedModelOutput(
        () =>
          finalizer.generate(JSON.stringify({ fixture: prompt, untrustedSummary: research.text }), {
            ...options,
            maxSteps: 1,
            structuredOutput: { schema: modelAssessmentSchema, logger: noopLogger },
          }),
        modelAssessmentSchema,
        phase,
        signal,
      );
    }
    if (called !== 1) {
      throw new PilotError("MODEL_TOOL_CHECK_FAILED", "Expected exactly one controlled tool call");
    }
    return { mode, model: modelId, ok: true, toolCalls: called, diagnostics };
  } catch (error) {
    const failure = classifyModelFailure(error, phase, signal);
    return {
      mode,
      model: modelId,
      ok: false,
      toolCalls: called,
      code: failure.code,
      diagnostics,
    };
  }
}
