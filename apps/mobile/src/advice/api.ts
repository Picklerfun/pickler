// Client of the advice routes of the product API (`<base>` = https://pickler.fun/api/v1). fetch with AbortController +
// setTimeout (AbortSignal.timeout does not exist in RN), and the deadline covers the body: headers followed by a body that
// never arrives are a `timeout`. The marketplace list is public (a bare array); the advice routes go through `authed`
// (bearer, `{ data }` envelope); a 402 is x402's own shape and is returned, never thrown.
import type { AuthedFetch, DoFetch } from "../identity/api";
import { parseAccepted, parseData, parseHistory, parseRecommendation, parseStudioAgents } from "./parse";
import type { AdviceAccepted, AdviceHistory, AdviceSymbol, Recommendation, StudioAgent } from "./types";

export const ADVICE_TIMEOUT_MS = 15_000;

/** `status` HTTP (0 if there was no answer) and `code` = `{ error }` of the server, the status, or `timeout` | `network`. */
export class AdviceApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`advice ${status} ${code}`);
    this.name = "AdviceApiError";
  }
}

type Answer = { status: number; ok: boolean; json: unknown; settlementHeader: string | null };

/** One request under the deadline; the deadline also covers reading the body. Network and deadline failures throw. */
async function run(send: (signal: AbortSignal) => Promise<Response>): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADVICE_TIMEOUT_MS);
  try {
    const res = await send(controller.signal);
    const json: unknown = await res.json().catch(() => undefined);
    if (controller.signal.aborted) throw new AdviceApiError(0, "timeout");
    return { status: res.status, ok: res.ok, json, settlementHeader: res.headers.get("X-PAYMENT-RESPONSE") };
  } catch (e) {
    if (e instanceof AdviceApiError) throw e;
    throw new AdviceApiError(0, controller.signal.aborted || (e instanceof Error && e.name === "AbortError") ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

const errorCode = (a: Answer): string =>
  a.json !== null && typeof a.json === "object" && typeof (a.json as { error?: unknown }).error === "string" ? (a.json as { error: string }).error : String(a.status);

/** An authed `{ data }` answer: non-2xx throws with the server's code; a body that is not the envelope is `bad_response`. */
async function data(authed: AuthedFetch, path: string, init: RequestInit): Promise<unknown> {
  const a = await run((signal) => authed(path, { ...init, signal }));
  if (!a.ok) throw new AdviceApiError(a.status, errorCode(a));
  try {
    return parseData(a.json);
  } catch {
    throw new AdviceApiError(a.status, "bad_response");
  }
}

function parsed<T>(status: number, read: () => T): T {
  try {
    return read();
  } catch {
    throw new AdviceApiError(status, "bad_response");
  }
}

/** The agents that sell analyses (public, no token). */
export async function fetchStudioAgents(base: string, doFetch: DoFetch = fetch): Promise<StudioAgent[]> {
  const a = await run((signal) => doFetch(`${base}/marketplace/agents`, { method: "GET", headers: {}, signal }));
  if (!a.ok) throw new AdviceApiError(a.status, errorCode(a));
  return parsed(a.status, () => parseStudioAgents(a.json));
}

export type AdviceAnswer = { status: number; json: unknown; settlementHeader: string | null };

/**
 * POST a recommendation. Returns the answer whatever its status (the 402 with its terms, the 202 with its settlement
 * header, an error body); only a network failure or the deadline throw. `key` is the Idempotency-Key, one per Ask;
 * `payment` is the base64 X-PAYMENT of the paid retry.
 */
export async function requestAdvice(authed: AuthedFetch, agentId: string, symbol: AdviceSymbol, key: string, payment?: string): Promise<AdviceAnswer> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": key };
  if (payment !== undefined) headers["X-PAYMENT"] = payment;
  const a = await run((signal) => authed(`/agent-advice/agents/${encodeURIComponent(agentId)}/recommendations`, { method: "POST", headers, body: JSON.stringify({ symbol }), signal }));
  return { status: a.status, json: a.json, settlementHeader: a.settlementHeader };
}

/** The 202 body of an Ask, parsed. */
export const acceptedFrom = (json: unknown): AdviceAccepted => parsed(202, () => parseAccepted(parseData(json)));

export async function getRecommendation(authed: AuthedFetch, id: string): Promise<Recommendation> {
  const d = await data(authed, `/agent-advice/recommendations/${encodeURIComponent(id)}`, { method: "GET" });
  return parsed(200, () => parseRecommendation(d));
}

export async function history(authed: AuthedFetch, agentId: string, symbol: AdviceSymbol): Promise<AdviceHistory> {
  const d = await data(authed, `/agent-advice/agents/${encodeURIComponent(agentId)}/recommendations?symbol=${symbol}`, { method: "GET" });
  return parsed(200, () => parseHistory(d));
}
