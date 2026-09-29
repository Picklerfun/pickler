import { z } from "zod";
import { jevEnvelopeSchema } from "./validation.js";
import { jevAnswerDiagnostics } from "./diagnostics.js";
export { jevChoiceSchema } from "./validation.js";
export { jevAnswerDiagnostics, probabilityIssues } from "./diagnostics.js";
export type JevStage = "response" | "usage" | "reservation" | "answers" | "complete";
export type JevErrorCode =
  | "INPUT_TOO_LARGE"
  | "HTTP_FAILURE"
  | "INVALID_RESPONSE"
  | "INVALID_USAGE"
  | "RESERVATION_EXCEEDED"
  | "INVALID_ANSWERS"
  | "RESPONSE_LIMIT";
export class JevClientError extends Error {
  constructor(
    readonly code: JevErrorCode,
    readonly diagnostics?: unknown,
  ) {
    super(`Jev ${code}`);
    this.name = "JevClientError";
  }
}
export interface JevRequest<T> {
  apiKey: string;
  payload: { model: string; state: unknown; questions: unknown };
  answersSchema: z.ZodType<T>;
  labels: Record<string, readonly string[]>;
  signal: AbortSignal;
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxInputTokens: number;
  before?(request: { body: string; bytes: number }): Promise<void>;
  usage(value: { input_tokens: number; output_tokens: number }): Promise<void>;
  stage?(stage: JevStage): void;
  transport?: typeof fetch;
}
async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
/** One fixed-endpoint request; no retry, credentials storage, fallback or strategy policy. */
export async function evaluateJev<T>(options: JevRequest<T>) {
  const body = JSON.stringify(options.payload);
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > options.maxRequestBytes) {
    throw new JevClientError("INPUT_TOO_LARGE");
  }
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  signal.throwIfAborted();
  await options.before?.({ body, bytes });
  signal.throwIfAborted();
  options.stage?.("response");
  const response = await bounded(
    (options.transport ?? fetch)("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body,
      signal,
      redirect: "manual",
    }),
    signal,
  );
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new JevClientError("HTTP_FAILURE", {
      version: 1,
      stage: "http",
      status: response.status,
    });
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new JevClientError("INVALID_RESPONSE");
  }
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await bounded(reader.read(), signal);
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > options.maxResponseBytes) {
        throw new JevClientError("RESPONSE_LIMIT");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  signal.throwIfAborted();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JevClientError("INVALID_RESPONSE");
  }
  options.stage?.("usage");
  const envelope = jevEnvelopeSchema(options.payload.model).safeParse(raw);
  if (!envelope.success) {
    throw new JevClientError("INVALID_USAGE");
  }
  await options.usage(envelope.data.usage);
  signal.throwIfAborted();
  options.stage?.("reservation");
  if (envelope.data.usage.input_tokens > options.maxInputTokens) {
    throw new JevClientError("RESERVATION_EXCEEDED");
  }
  options.stage?.("answers");
  const parsed = z.object({ answers: options.answersSchema }).safeParse(raw);
  if (!parsed.success) {
    throw new JevClientError(
      "INVALID_ANSWERS",
      jevAnswerDiagnostics(raw, parsed.error.issues, options.labels),
    );
  }
  options.stage?.("complete");
  return { ...envelope.data, answers: parsed.data.answers };
}
