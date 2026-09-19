import { TOOL_NAMES } from "@pickler/core";
import { record } from "./model-output.js";

/** Persist metadata only. Never copy provider text, arguments, headers or error messages. */
export function modelDiagnostic(phase: string, durationMs: number, input: unknown) {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const usage = value.totalUsage ?? value.usage;
  const counts: Record<string, number> = {};
  if (usage && typeof usage === "object") {
    for (const key of ["inputTokens", "outputTokens", "totalTokens", "reasoningTokens"]) {
      const count = (usage as Record<string, unknown>)[key];
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
        counts[key] = count;
      }
    }
  }
  const tools = Array.isArray(value.toolCalls)
    ? value.toolCalls.map((call: unknown) => {
        const data = record(record(call).payload ?? call);
        const name = data.toolName;
        const result = Array.isArray(value.toolResults)
          ? value.toolResults
              .map((item) => record(record(item).payload ?? item))
              .find((item) => item.toolCallId === data.toolCallId)
          : undefined;
        return {
          name: ([...TOOL_NAMES, "connectionProbe"] as readonly string[]).includes(String(name))
            ? String(name)
            : "unknown",
          status: result ? (result.isError ? "failed" : "completed") : "invoked",
        };
      })
    : [];
  return {
    phase,
    durationMs,
    usage: counts,
    tools,
    finishReason: [
      "stop",
      "length",
      "content-filter",
      "tool-calls",
      "error",
      "other",
      "unknown",
    ].includes(String(value.finishReason))
      ? value.finishReason
      : "unknown",
    hasText: typeof value.text === "string" && value.text.length > 0,
    textLength: typeof value.text === "string" ? value.text.length : 0,
    hasObject: value.object !== undefined && value.object !== null,
  };
}
