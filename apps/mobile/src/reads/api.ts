// Cliente del servicio de reads (D16). fetch con AbortController + setTimeout: AbortSignal.timeout no existe en RN (P4).
import type { Side } from "../perpl/orders";
import { READ_REQUEST_TIMEOUT_MS, READS_TIMEOUT_MS } from "./constants";
import { type ReadsSession, signedHeaders } from "./session";
import { type Agent, parseAgentsList, parseRead, parseReadResponse, parseReadsList, parseRemindersResponse, type Read, type Reminder } from "./types";

export type DoFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Error del servicio: `status` HTTP (0 si no hubo respuesta) y `code` = `{ error }` del servidor o `timeout` | `network` | `bad_response`. */
export class ReadsError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`reads ${status} ${code}`);
    this.name = "ReadsError";
  }
}

const COPY: Record<string, string> = {
  no_credits: "No credits left. Credits are simulated for the testnet.",
  market_closed: "This market is closed on Perpl right now.",
  rate_limited: "Too many reads in a row — wait a few minutes.",
  busy: "The agents are busy. Try again in a minute.",
  perpl_unavailable: "Perpl didn't answer. Try again in a moment.",
  unknown_agent: "That agent is no longer available.",
  bad_body: "That cell isn't on the matrix.",
  missing_signature: "Your Ask session expired. Unlock again.",
  signature_expired: "Your Ask session expired. Unlock again.",
  bad_signature: "Your Ask session expired. Unlock again.",
  expired: "That level already expired.",
  read_not_found: "That read isn't yours anymore.",
  timeout: "The agent took too long. Check My reads — your credit comes back if it failed.",
  network: "Couldn't reach the reads service.",
  bad_response: "The reads service sent something unexpected.",
};

export function describeReadsError(e: unknown): string {
  if (e instanceof ReadsError) return COPY[e.code] ?? `The reads service responded ${e.status}.`;
  return e instanceof Error ? e.message : String(e);
}

export const isSessionError = (e: unknown): boolean => e instanceof ReadsError && e.status === 401;

async function call(url: string, init: RequestInit, timeoutMs: number, doFetch: DoFetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw new ReadsError(0, controller.signal.aborted || (e instanceof Error && e.name === "AbortError") ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const code = body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "bad_response";
    throw new ReadsError(res.status, code);
  }
  return body;
}

export function fetchAgents(base: string, doFetch: DoFetch = fetch): Promise<Agent[]> {
  return call(`${base}/agents-list`, { method: "GET", headers: {} }, READS_TIMEOUT_MS, doFetch).then(parseAgentsList);
}

export function fetchReads(base: string, session: ReadsSession, marketId?: number, doFetch: DoFetch = fetch): Promise<{ reads: Read[]; credits: number }> {
  const q = marketId === undefined ? "" : `?marketId=${marketId}`;
  return call(`${base}/reads-list${q}`, { method: "GET", headers: signedHeaders(session) }, READS_TIMEOUT_MS, doFetch).then(parseReadsList);
}

export function fetchRead(base: string, session: ReadsSession, id: string, doFetch: DoFetch = fetch): Promise<Read> {
  return call(`${base}/read-get?id=${encodeURIComponent(id)}`, { method: "GET", headers: signedHeaders(session) }, READS_TIMEOUT_MS, doFetch)
    .then((b) => parseRead((b as { read?: unknown } | null)?.read));
}

export type ReadRequest = { marketId: number; levelBps: number; horizonMin: number; agentId: string; pushToken?: string; pushEnv?: "sandbox" | "production" };

export function requestRead(base: string, session: ReadsSession, body: ReadRequest, doFetch: DoFetch = fetch): Promise<{ read: Read; credits: number }> {
  return call(`${base}/read-request`, {
    method: "POST", headers: { ...signedHeaders(session), "content-type": "application/json" }, body: JSON.stringify(body),
  }, READ_REQUEST_TIMEOUT_MS, doFetch).then(parseReadResponse);
}

export type ReminderRequest = {
  marketId: number; levelBps: number; horizonMin: number; target: number; expiresAt: string; side: Side;
  readId?: string; pushToken?: string; pushEnv?: "sandbox" | "production";
};

/** POST reminder-set (D12): el servidor crea `pre` (si faltan > 15 min) y `expiry` en mobile.reminders. */
export function postReminders(base: string, session: ReadsSession, body: ReminderRequest, doFetch: DoFetch = fetch): Promise<Reminder[]> {
  return call(`${base}/reminder-set`, {
    method: "POST", headers: { ...signedHeaders(session), "content-type": "application/json" }, body: JSON.stringify(body),
  }, READS_TIMEOUT_MS, doFetch).then(parseRemindersResponse);
}
