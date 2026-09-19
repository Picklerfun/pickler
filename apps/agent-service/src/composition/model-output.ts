import { ModelFailure, PilotError, type ModelFailureDetails } from "@pickler/core";
import type { z } from "zod";

type ModelOutput = {
  object?: unknown;
  finishReason?: string | undefined;
  totalUsage?: unknown;
  error?: unknown;
};
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
const fields = new Set(
  "marketId reason action outcomeId thesis counterEvidence uncertainty sourceIds probability lower estimate upper uncertaintyLevel missingInformation observedPrice limitPrice expiresAt abstentionReason report protocol forecast inabilityReason sections section status explanation".split(
    " ",
  ),
);
const issueCodes = new Set([
  "invalid_type",
  "invalid_value",
  "too_small",
  "too_big",
  "invalid_format",
  "unrecognized_keys",
  "custom",
  "invalid_union",
]);

/** No values, issue messages, unknown property names or provider bodies may leave this boundary. */
export function classifyModelFailure(
  error: unknown,
  stage: ModelFailureDetails["stage"],
  signal: AbortSignal,
  metadata?: unknown,
): PilotError {
  if (error instanceof PilotError) {
    return error;
  }
  const details: ModelFailureDetails = { stage };
  const names = new Set<unknown>();
  const capture = (value: Record<string, unknown>) => {
    if (
      typeof value.statusCode === "number" &&
      Number.isInteger(value.statusCode) &&
      value.statusCode >= 400 &&
      value.statusCode <= 599
    ) {
      details.statusCode = value.statusCode;
    }
    if (
      ["stop", "length", "content-filter", "tool-calls", "error", "other", "unknown"].includes(
        String(value.finishReason),
      )
    ) {
      details.finishReason = String(value.finishReason);
    }
    const usage = record(value.totalUsage ?? value.usage);
    for (const key of ["inputTokens", "outputTokens", "reasoningTokens"] as const) {
      const count = usage[key];
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
        details[key] = count;
      }
    }
    if (Array.isArray(value.issues)) {
      details.validation = value.issues.slice(0, 30).map((issue) => {
        const data = record(issue);
        return {
          code: issueCodes.has(String(data.code)) ? String(data.code) : "invalid",
          path: Array.isArray(data.path)
            ? data.path
                .map((part) =>
                  typeof part === "number"
                    ? "[]"
                    : fields.has(String(part))
                      ? String(part)
                      : "[unknown]",
                )
                .join(".") || "$"
            : "$",
        };
      });
    }
  };
  capture(record(metadata));
  let cause: unknown = error;
  for (let depth = 0; cause && depth < 6; depth++) {
    const value = record(cause);
    capture(value);
    names.add(value.name);
    names.add(value.id);
    cause = value.cause;
  }
  let code = "MODEL_FAILURE";
  if (signal.aborted) {
    code = signal.reason?.name === "TimeoutError" ? "MODEL_TIMEOUT" : "MODEL_CANCELLED";
  } else if (names.has("TimeoutError") || names.has("AbortError")) {
    code = "MODEL_TIMEOUT";
  } else if (details.statusCode) {
    code = `MODEL_HTTP_${details.statusCode}`;
  } else if (details.finishReason === "length") {
    code = "MODEL_OUTPUT_TRUNCATED";
  } else if (
    names.has("AI_InvalidToolInputError") ||
    names.has("AI_NoSuchToolError") ||
    names.has("AI_InvalidToolArgumentsError")
  ) {
    code = "MODEL_INVALID_TOOL";
  } else if (names.has("AI_JSONParseError") || names.has("SyntaxError")) {
    code = "MODEL_INVALID_JSON";
  } else if (names.has("STRUCTURED_OUTPUT_OBJECT_UNDEFINED")) {
    code = "MODEL_NO_STRUCTURED_OUTPUT";
  } else if (
    names.has("ZodError") ||
    names.has("AI_TypeValidationError") ||
    names.has("STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED")
  ) {
    code = "MODEL_INVALID_SCHEMA";
  } else if (names.has("AI_NoObjectGeneratedError")) {
    code = "MODEL_NO_STRUCTURED_OUTPUT";
  }
  return new ModelFailure(code, details);
}

export async function validatedModelOutput<T>(
  generate: () => Promise<ModelOutput>,
  schema: z.ZodType<T>,
  stage: ModelFailureDetails["stage"],
  signal: AbortSignal,
): Promise<{ object: T; usage: unknown }> {
  let result: ModelOutput | undefined;
  try {
    result = await generate();
    signal.throwIfAborted();
    if (result.error) {
      throw result.error;
    }
    if (result.finishReason === "length") {
      throw { name: "TruncatedOutput" };
    }
    if (result.finishReason === "content-filter") {
      throw new ModelFailure("MODEL_CONTENT_FILTERED", {
        stage,
        finishReason: result.finishReason,
      });
    }
    if (result.object === undefined || result.object === null) {
      throw new ModelFailure("MODEL_NO_STRUCTURED_OUTPUT", { stage });
    }
    return { object: schema.parse(result.object), usage: result.totalUsage };
  } catch (error) {
    throw classifyModelFailure(error, stage, signal, result);
  }
}

/** Validate original final text as well as Mastra's object; no silent JSON repair. */
export async function validateStructuredStep<T>(
  step: unknown,
  schema: z.ZodType<T>,
  stage: ModelFailureDetails["stage"],
  signal: AbortSignal,
): Promise<void> {
  const value = record(step);
  await validatedModelOutput(
    async () => {
      if (value.finishReason === "length") {
        return { finishReason: "length", totalUsage: value.usage };
      }
      if (typeof value.text !== "string" || !value.text.trim()) {
        return {};
      }
      return { object: JSON.parse(value.text), totalUsage: value.usage };
    },
    schema,
    stage,
    signal,
  );
}
