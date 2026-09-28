// Metadata only: no raw content, error strings, headers or unknown provider fields.
export type Diagnostics = {
  stage:
    | "NOT_STARTED"
    | "TRANSPORT_FAILURE"
    | "HTTP_FAILURE"
    | "OUTER_JSON_FAILURE"
    | "CONTENT_JSON_FAILURE"
    | "RESPONSE_RECEIVED";
  status?: number;
  contentBytes?: number;
  finishReason?: "stop" | "length" | "content_filter" | "tool_calls" | "other";
};
export function diagnosticTransport(
  transport: typeof fetch,
  diagnostic: Diagnostics,
): typeof fetch {
  return async (input, init) => {
    let response: Response;
    try {
      response = await transport(input, init);
    } catch {
      diagnostic.stage = "TRANSPORT_FAILURE";
      throw new Error("TRANSPORT_FAILURE");
    }
    diagnostic.status = response.status;
    if (!response.ok) {
      diagnostic.stage = "HTTP_FAILURE";
      return response;
    }
    let body;
    try {
      body = await response.clone().json();
    } catch {
      diagnostic.stage = "OUTER_JSON_FAILURE";
      return response;
    }
    diagnostic.stage = "RESPONSE_RECEIVED";
    const choice = body?.choices?.[0];
    if (choice) {
      const reason = choice.finish_reason;
      diagnostic.finishReason = ["stop", "length", "content_filter", "tool_calls"].includes(reason)
        ? reason
        : "other";
      if (typeof choice.message?.content === "string") {
        diagnostic.contentBytes = Buffer.byteLength(choice.message.content);
        try {
          JSON.parse(choice.message.content);
        } catch {
          diagnostic.stage = "CONTENT_JSON_FAILURE";
        }
      }
    }
    return response;
  };
}
