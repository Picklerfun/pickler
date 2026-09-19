import "server-only";
import { errorResponse } from "./errors";

/** Reads a small JSON object body, or returns the error response to send. */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | Response> {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    return errorResponse(413, "invalid_request", "Request body too large.");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "invalid_request", "Body must be JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(400, "invalid_request", "Body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}
