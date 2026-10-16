// Parsers of the advice DTOs (packages/api-schema/src/advice.ts, agentSummarySchema in
// public-schemas.ts), by hand in the style of src/reads/types.ts. Strict: they throw on a shape the
// server does not send, except the marketplace list, which drops a bad row and keeps the rest.
import type {
  AdviceAccepted, AdviceHistory, AdviceJobError, AdviceResult, AdviceSource, AdviceStatus, AdviceSymbol,
  Recommendation, StudioAgent,
} from "./types";

type Rec = Record<string, unknown>;
const fail = (what: string): never => { throw new Error(`Advice API: ${what}`); };
const rec = (v: unknown, what: string): Rec => (v === null || typeof v !== "object" || Array.isArray(v) ? fail(`${what} is not an object`) : (v as Rec));
const str = (r: Rec, k: string, what: string): string => (typeof r[k] === "string" ? (r[k] as string) : fail(`${what}.${k} is not a string`));
const strOrNull = (r: Rec, k: string, what: string): string | null => (r[k] === null ? null : str(r, k, what));
const iso = (r: Rec, k: string, what: string): string => {
  const s = str(r, k, what);
  return Number.isNaN(Date.parse(s)) ? fail(`${what}.${k} is not a date`) : s;
};
const isoOrNull = (r: Rec, k: string, what: string): string | null => (r[k] === null ? null : iso(r, k, what));
const oneOf = <T extends string>(r: Rec, k: string, values: readonly T[], what: string): T => {
  const s = str(r, k, what);
  return (values as readonly string[]).includes(s) ? (s as T) : fail(`${what}.${k} ${s} is unknown`);
};
const strings = (r: Rec, k: string, what: string): string[] =>
  Array.isArray(r[k]) && (r[k] as unknown[]).every((x) => typeof x === "string") ? (r[k] as string[]) : fail(`${what}.${k} is not a string array`);

const SYMBOLS: readonly AdviceSymbol[] = ["BTC", "ETH"];
const STATUSES: readonly AdviceStatus[] = ["queued", "running", "completed", "failed"];
const JOB_ERRORS: readonly AdviceJobError[] = ["ANALYSIS_FAILED", "ANALYSIS_INTERRUPTED", "ANALYSIS_EXPIRED"];
const SOLD_VENUES = ["perps", "both"] as const;

/**
 * Decimal AUSD to micro-AUSD under the server's rule (`parseAusdToMicro` in core): 1 to 3 whole
 * digits and at most 6 decimals, nothing else. Null for any other text and for zero.
 * It deliberately does not enforce core's 0.10–100 range: the API is authoritative on prices.
 */
export function parseAusdAmount(text: string): bigint | null {
  const m = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(text);
  if (!m) return null;
  const micro = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
  return micro > 0n ? micro : null;
}

function studioAgent(v: unknown): StudioAgent | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Rec;
  if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.handle !== "string" || typeof r.accent !== "string") return null;
  if (!(SOLD_VENUES as readonly unknown[]).includes(r.venue)) return null;
  const p = r.advicePrice;
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null;
  const price = p as Rec;
  if (price.asset !== "AUSD" || price.decimals !== 6 || typeof price.amount !== "string") return null;
  const micro = parseAusdAmount(price.amount);
  if (micro === null) return null;
  return { id: r.id, name: r.name, handle: r.handle, accent: r.accent, venue: r.venue as StudioAgent["venue"], price: { micro, text: price.amount } };
}

/**
 * `GET /v1/marketplace/agents` (a bounded `{ items, nextCursor }` page) → the agents that sell analyses: a
 * non-null `advicePrice` and venue perps or both. A malformed row is dropped, never thrown.
 */
export function parseStudioAgents(json: unknown): StudioAgent[] {
  const body = rec(json,"marketplace page");
  if (!Array.isArray(body.items)) fail("marketplace agents page has no items");
  json = body.items;
  const agents: StudioAgent[] = [];
  for (const row of json as unknown[]) {
    const agent = studioAgent(row);
    if (agent) agents.push(agent);
  }
  return agents;
}

/** The `{ data }` envelope of the routes under `/v1/agent-advice`. */
export function parseData(json: unknown): unknown {
  const b = rec(json, "response");
  return "data" in b ? b.data : fail("response has no data");
}

function parseSource(v: unknown): AdviceSource {
  const s = rec(v, "source");
  return { id: str(s, "id", "source"), name: str(s, "name", "source"), url: str(s, "url", "source"), observedAt: iso(s, "observedAt", "source") };
}

function parseResult(v: unknown): AdviceResult {
  const r = rec(v, "result");
  if (r.version !== 1) fail("result.version is not 1");
  if (r.horizonHours !== 24) fail("result.horizonHours is not 24");
  if (!Array.isArray(r.sources)) fail("result.sources is not an array");
  return {
    version: 1, symbol: oneOf(r, "symbol", SYMBOLS, "result"), network: oneOf(r, "network", ["mainnet", "testnet"] as const, "result"),
    horizonHours: 24, orientation: oneOf(r, "orientation", ["long", "short", "wait"] as const, "result"), summary: str(r, "summary", "result"),
    reasons: strings(r, "reasons", "result"), risks: strings(r, "risks", "result"), limitations: strings(r, "limitations", "result"),
    sources: (r.sources as unknown[]).map(parseSource), generatedAt: iso(r, "generatedAt", "result"), dataAsOf: iso(r, "dataAsOf", "result"),
  };
}

/** One job (`adviceRecommendationSchema`): the poll of `statusUrl` and each history item. */
export function parseRecommendation(v: unknown): Recommendation {
  const r = rec(v, "recommendation");
  const error = r.error === null ? null : oneOf(r, "error", JOB_ERRORS, "recommendation");
  return {
    id: str(r, "id", "recommendation"), agentId: str(r, "agentId", "recommendation"), symbol: oneOf(r, "symbol", SYMBOLS, "recommendation"),
    status: oneOf(r, "status", STATUSES, "recommendation"), createdAt: iso(r, "createdAt", "recommendation"),
    startedAt: isoOrNull(r, "startedAt", "recommendation"), finishedAt: isoOrNull(r, "finishedAt", "recommendation"),
    result: r.result === null ? null : parseResult(r.result), error,
  };
}

/** The 202 of a paid (or replayed) Ask (`adviceAcceptedSchema`). */
export function parseAccepted(v: unknown): AdviceAccepted {
  const r = rec(v, "accepted");
  return { id: str(r, "id", "accepted"), status: oneOf(r, "status", STATUSES, "accepted"), statusUrl: str(r, "statusUrl", "accepted") };
}

/** The free completed history, newest first (`adviceHistorySchema`). */
export function parseHistory(v: unknown): AdviceHistory {
  const r = rec(v, "history");
  if (!Array.isArray(r.items)) fail("history.items is not an array");
  return { items: (r.items as unknown[]).map(parseRecommendation), nextCursor: strOrNull(r, "nextCursor", "history") };
}
