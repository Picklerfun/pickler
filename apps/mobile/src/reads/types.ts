// DTOs del servicio de reads (spec §2.2, F1 dto.ts). Parseo estricto como perpl/context.ts: lanza si la forma no es la verificada.
import { isHorizon, isLevel } from "./matrix";

export type ReadStatus = "pending" | "open" | "right" | "wrong" | "void" | "failed";
const STATUSES: readonly ReadStatus[] = ["pending", "open", "right", "wrong", "void", "failed"];

export type Read = {
  id: string; agentId: string; marketId: number; symbol: string; priceDecimals: number;
  levelBps: number; horizonMin: number; markAtRequest: number; target: number; question: string;
  status: ReadStatus; probability: number | null; reasons: string[] | null; limits: string | null;
  creditsCharged: number; error: string | null;
  /** ISO UTC, como los manda el servidor. */
  createdAt: string; expiresAt: string; resolvedAt: string | null;
  markAtResolution: number | null; outcome: boolean | null; brier: number | null;
};

export type AgentRecord = { reads: number; resolved: number; right: number; brierAvg: number | null };
export type Agent = { id: string; handle: string; name: string; owner: string; priceCredits: number; record: AgentRecord };

type Rec = Record<string, unknown>;
const fail = (what: string): never => { throw new Error(`Reads API: ${what}`); };
const rec = (v: unknown, what: string): Rec => (v === null || typeof v !== "object" ? fail(`${what} is not an object`) : (v as Rec));
const num = (r: Rec, k: string, what: string): number => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : fail(`${what}.${k} is not a number`));
const str = (r: Rec, k: string, what: string): string => (typeof r[k] === "string" ? (r[k] as string) : fail(`${what}.${k} is not a string`));
const numOrNull = (r: Rec, k: string, what: string): number | null => (r[k] === null || r[k] === undefined ? null : num(r, k, what));
const strOrNull = (r: Rec, k: string, what: string): string | null => (r[k] === null || r[k] === undefined ? null : str(r, k, what));
const iso = (r: Rec, k: string, what: string): string => {
  const s = str(r, k, what);
  return Number.isNaN(Date.parse(s)) ? fail(`${what}.${k} is not a date`) : s;
};
const isoOrNull = (r: Rec, k: string, what: string): string | null => (r[k] === null || r[k] === undefined ? null : iso(r, k, what));

export function parseRead(v: unknown): Read {
  const r = rec(v, "read");
  const status = str(r, "status", "read");
  if (!(STATUSES as readonly string[]).includes(status)) fail(`read.status ${status} is unknown`);
  const levelBps = num(r, "levelBps", "read"), horizonMin = num(r, "horizonMin", "read");
  if (!isLevel(levelBps) || !isHorizon(horizonMin)) fail("read cell is outside the matrix");
  const probability = numOrNull(r, "probability", "read");
  if (probability !== null && (probability < 0 || probability > 1)) fail("read.probability out of range");
  const reasons = r.reasons === null || r.reasons === undefined ? null
    : Array.isArray(r.reasons) && r.reasons.every((x) => typeof x === "string") ? (r.reasons as string[]) : fail("read.reasons is not a string array");
  const outcome = r.outcome === null || r.outcome === undefined ? null : typeof r.outcome === "boolean" ? r.outcome : fail("read.outcome is not a boolean");
  return {
    id: str(r, "id", "read"), agentId: str(r, "agentId", "read"), marketId: num(r, "marketId", "read"), symbol: str(r, "symbol", "read"),
    priceDecimals: num(r, "priceDecimals", "read"), levelBps, horizonMin, markAtRequest: num(r, "markAtRequest", "read"),
    target: num(r, "target", "read"), question: str(r, "question", "read"), status: status as ReadStatus, probability, reasons,
    limits: strOrNull(r, "limits", "read"), creditsCharged: num(r, "creditsCharged", "read"), error: strOrNull(r, "error", "read"),
    createdAt: iso(r, "createdAt", "read"), expiresAt: iso(r, "expiresAt", "read"), resolvedAt: isoOrNull(r, "resolvedAt", "read"),
    markAtResolution: numOrNull(r, "markAtResolution", "read"), outcome, brier: numOrNull(r, "brier", "read"),
  };
}

export function parseReadResponse(body: unknown): { read: Read; credits: number } {
  const b = rec(body, "response");
  return { read: parseRead(b.read), credits: num(b, "credits", "response") };
}

export function parseReadsList(body: unknown): { reads: Read[]; credits: number } {
  const b = rec(body, "response");
  if (!Array.isArray(b.reads)) fail("response.reads is not an array");
  return { reads: (b.reads as unknown[]).map(parseRead), credits: num(b, "credits", "response") };
}

function parseAgent(v: unknown): Agent {
  const a = rec(v, "agent");
  const rc = rec(a.record, "agent.record");
  return {
    id: str(a, "id", "agent"), handle: str(a, "handle", "agent"), name: str(a, "name", "agent"), owner: str(a, "owner", "agent"),
    priceCredits: num(a, "priceCredits", "agent"),
    record: { reads: num(rc, "reads", "record"), resolved: num(rc, "resolved", "record"), right: num(rc, "right", "record"), brierAvg: numOrNull(rc, "brierAvg", "record") },
  };
}

export function parseAgentsList(body: unknown): Agent[] {
  const b = rec(body, "response");
  if (!Array.isArray(b.agents)) fail("response.agents is not an array");
  return (b.agents as unknown[]).map(parseAgent);
}
