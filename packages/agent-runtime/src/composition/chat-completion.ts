import { PilotError } from "@pickler/core";

/** Races `work` with `signal`, so an aborted call stops waiting on a provider that ignores it. */
export async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
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

/** The most an OpenAI-compatible chat completion may answer with. */
export const CHAT_RESPONSE_LIMIT = 1024 * 1024;

/**
 * One POST to an OpenAI-compatible `/chat/completions` (the configured `MODEL_*` provider): no
 * redirects, no retries, the response read up to 1 MiB and parsed as JSON. Advice's forecast and
 * the Perpl check share it. A non-success answer is `MODEL_HTTP_FAILURE`, an oversized one
 * `MODEL_RESPONSE_LIMIT`, unparsable JSON `MODEL_RESPONSE_INVALID`; provider bodies never leak.
 */
export async function postChatCompletion(input: {
  transport: typeof fetch;
  baseUrl: string;
  apiKey: string;
  body: string;
  signal: AbortSignal;
}): Promise<unknown> {
  const { signal } = input;
  const response = await bounded(
    input.transport(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: input.body,
      signal,
      redirect: "manual",
    }),
    signal,
  );
  if (!response.ok || !response.body) {
    void response.body?.cancel();
    throw new PilotError("MODEL_HTTP_FAILURE", "Model analysis failed");
  }
  const reader = response.body.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await bounded(reader.read(), signal);
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > CHAT_RESPONSE_LIMIT) {
        throw new PilotError("MODEL_RESPONSE_LIMIT", "Model response exceeds its limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  signal.throwIfAborted();
  try {
    return JSON.parse(text);
  } catch {
    throw new PilotError("MODEL_RESPONSE_INVALID", "Invalid model response");
  }
}
