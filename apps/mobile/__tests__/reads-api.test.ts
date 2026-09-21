import readJson from "./fixtures/reads/read.json";
import { describeReadsError, type DoFetch, fetchAgents, fetchRead, fetchReads, ReadsError, requestRead } from "../src/reads/api";
import { READ_REQUEST_TIMEOUT_MS, READS_TIMEOUT_MS } from "../src/reads/constants";

const BASE = "https://reads.test/functions/v1";
const SESSION = { address: "0x1111111111111111111111111111111111111111", ts: 1_789_600_000_000, sig: `0x${"ab".repeat(65)}` as const };
type Call = { url: string; init?: RequestInit };
// Sin `new Response`: el entorno de jest-expo no garantiza los globals de fetch de Node (perpl-context.test.ts).
type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const ok = (body: unknown): FakeRes => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, error: string): FakeRes => ({ ok: false, status, json: async () => ({ error }) });
const html = (status: number): FakeRes => ({ ok: false, status, json: async () => { throw new SyntaxError("not json"); } });
function fetchOnce(res: FakeRes, calls: Call[] = []) {
  const f = jest.fn((url: string, init?: RequestInit) => { calls.push({ url, init }); return Promise.resolve(res); }) as unknown as DoFetch;
  return { f, calls };
}

test("fetchAgents is a public GET", async () => {
  const { f, calls } = fetchOnce(ok({ agents: [] }));
  expect(await fetchAgents(BASE, f)).toEqual([]);
  expect(calls[0].url).toBe(`${BASE}/agents-list`);
  expect((calls[0].init?.headers as Record<string, string>)["x-pickler-address"]).toBeUndefined();
});

test("fetchReads signs the request and passes marketId", async () => {
  const { f, calls } = fetchOnce(ok({ reads: [readJson], credits: 19 }));
  const r = await fetchReads(BASE, SESSION, 16, f);
  expect(r.credits).toBe(19);
  expect(r.reads[0].id).toBe(readJson.id);
  expect(calls[0].url).toBe(`${BASE}/reads-list?marketId=16`);
  expect(calls[0].init?.headers).toMatchObject({ "x-pickler-address": SESSION.address, "x-pickler-ts": String(SESSION.ts), "x-pickler-sig": SESSION.sig });
});

test("fetchRead gets one read by id", async () => {
  const { f, calls } = fetchOnce(ok({ read: readJson }));
  expect((await fetchRead(BASE, SESSION, readJson.id, f)).id).toBe(readJson.id);
  expect(calls[0].url).toBe(`${BASE}/read-get?id=${readJson.id}`);
});

test("requestRead posts the cell, the agent and the push token", async () => {
  const { f, calls } = fetchOnce(ok({ read: readJson, credits: 19 }));
  const r = await requestRead(BASE, SESSION, { marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus", pushToken: "ab".repeat(32), pushEnv: "sandbox" }, f);
  expect(r.credits).toBe(19);
  expect(calls[0].url).toBe(`${BASE}/read-request`);
  expect(calls[0].init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus", pushToken: "ab".repeat(32), pushEnv: "sandbox" });
  expect((calls[0].init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
});

test.each([
  [402, "no_credits"], [401, "signature_expired"], [409, "market_closed"], [422, "unknown_agent"], [429, "rate_limited"], [503, "busy"], [503, "perpl_unavailable"],
])("a %i %s becomes a ReadsError with the server code", async (status, code) => {
  const { f } = fetchOnce(fail(status, code));
  await expect(requestRead(BASE, SESSION, { marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus" }, f)).rejects.toMatchObject({ status, code });
});

test("a non-JSON 5xx becomes bad_response and a malformed 200 throws the parser error", async () => {
  await expect(fetchAgents(BASE, fetchOnce(html(502)).f)).rejects.toMatchObject({ status: 502, code: "bad_response" });
  await expect(fetchAgents(BASE, fetchOnce(ok({ agents: "x" })).f)).rejects.toThrow(/Reads API/);
});

test("timeouts use AbortController: 65 s for read-request, 15 s for the rest", async () => {
  jest.useFakeTimers();
  const hang = jest.fn((_url: string, init?: RequestInit) => new Promise<FakeRes>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
  })) as unknown as DoFetch;
  // Los handlers se cuelgan al crear las promesas: una rejection sin handler haría ruido en jest.
  const p1 = requestRead(BASE, SESSION, { marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus" }, hang).then(() => "resolved", (e: ReadsError) => e.code);
  jest.advanceTimersByTime(READ_REQUEST_TIMEOUT_MS - 1);
  const p2 = fetchAgents(BASE, hang).then(() => "resolved", (e: ReadsError) => e.code);
  jest.advanceTimersByTime(READS_TIMEOUT_MS); // p2 vence; p1 lleva 65 s − 1 + 15 s > 65 s: también
  await expect(p2).resolves.toBe("timeout");
  await expect(p1).resolves.toBe("timeout");
  jest.useRealTimers();
});

test("network failures become network and the copy is human", async () => {
  const f = jest.fn(() => Promise.reject(new TypeError("Network request failed"))) as unknown as DoFetch;
  await expect(fetchAgents(BASE, f)).rejects.toMatchObject({ code: "network" });
  expect(describeReadsError(new ReadsError(402, "no_credits"))).toBe("No credits left. Credits are simulated for the testnet.");
  expect(describeReadsError(new ReadsError(401, "signature_expired"))).toBe("Your Ask session expired. Unlock again.");
  expect(describeReadsError(new ReadsError(0, "timeout"))).toMatch(/took too long/);
  expect(describeReadsError(new ReadsError(500, "weird"))).toBe("The reads service responded 500.");
  expect(describeReadsError(new Error("Reads API: read.id is not a string"))).toBe("Reads API: read.id is not a string");
});
