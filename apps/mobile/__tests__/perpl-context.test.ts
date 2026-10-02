import contextJson from "@pickler/perpl-context/fixtures/context.json";
import { fetchContext, parseContext, parseServerTime } from "../src/perpl/context";

const realFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = realFetch; });

test("parseContext reads the MON market from the real testnet payload", () => {
  const ctx = parseContext(contextJson);
  const mon = ctx.markets.find((m) => m.id === 64);
  expect(mon).toMatchObject({ symbol: "MON", name: "MON Perp", priceDecimals: 5, sizeDecimals: 0, ttlBlocks: 20, maxSlippageBps: 100, maintenanceBps: 500, maxLeverage: 3, takerFeeMicros: 345, isOpen: true });
  expect(mon!.mark).toBeGreaterThan(0);
  expect(ctx.markets.map((m) => m.id)).toEqual([16, 32, 48, 64, 256, 272, 320]);
});

test("parseContext reads the instance minimums and exchange", () => {
  const { instance, geoBlock } = parseContext(contextJson);
  expect(instance).toEqual({ exchange: "0x1964c32f0be608e7d29302aff5e61268e72080cc", minAccountOpen: 100_000_000n, minDeposit: 10_000_000n, minWithdraw: 10_000n });
  expect(geoBlock).toContain("US");
});

test("parseContext drops closed markets and sorts by id", () => {
  const closed = JSON.parse(JSON.stringify(contextJson)) as typeof contextJson;
  closed.markets[3].config.is_open = false;
  closed.markets.reverse();
  const ids = parseContext(closed).markets.map((m) => m.id);
  expect(ids).toEqual([16, 32, 48, 256, 272, 320]);
});

test.each([
  ["no object", null],
  ["no instances", { ...contextJson, instances: [] }],
  ["no markets", { ...contextJson, markets: "x" }],
  ["market without config", { ...contextJson, markets: [{ id: 1, symbol: "X", name: "X" }] }],
])("parseContext throws on %s", (_, body) => {
  expect(() => parseContext(body)).toThrow();
});

test("fetchContext times out with AbortController, not AbortSignal.timeout", async () => {
  const fetchMock = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  jest.useFakeTimers();
  const p = fetchContext("https://x.test/api");
  const failed = p.then(() => false, () => true);
  jest.advanceTimersByTime(15_001);
  await expect(failed).resolves.toBe(true);
  expect(fetchMock.mock.calls[0][0]).toBe("https://x.test/api/v1/pub/context");
  jest.useRealTimers();
});

test("parseContext leaves serverTime null; parseServerTime reads an RFC 1123 Date header", () => {
  expect(parseContext(contextJson).serverTime).toBeNull();
  expect(parseServerTime("Thu, 18 Sep 2026 22:35:00 GMT")).toBe(Date.UTC(2026, 8, 18, 22, 35, 0));
  expect(parseServerTime(null)).toBeNull();
  expect(parseServerTime("not a date")).toBeNull();
  expect(parseServerTime("Thu, 18 Sep 2026 22:35:00 GMT", "7")).toBe(Date.UTC(2026, 8, 18, 22, 35, 7));
  expect(parseServerTime("Thu, 18 Sep 2026 22:35:00 GMT", "x")).toBe(Date.UTC(2026, 8, 18, 22, 35, 0));
});

// Sin `new Response`: el entorno de jest-expo no garantiza los globals de fetch de Node.
function fakeFetch(headers: Record<string, string>) {
  const res = { ok: true, status: 200, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => contextJson };
  return jest.fn(async () => res) as unknown as typeof fetch;
}

test("fetchContext fills serverTime from the Date header, and null without it", async () => {
  (globalThis as { fetch: typeof fetch }).fetch = fakeFetch({ date: "Thu, 18 Sep 2026 22:35:00 GMT" });
  const withHeader = await fetchContext("https://x.test/api");
  expect(withHeader.serverTime).toBe(Date.UTC(2026, 8, 18, 22, 35, 0));
  expect(withHeader.markets.map((m) => m.id)).toEqual([16, 32, 48, 64, 256, 272, 320]);
  (globalThis as { fetch: typeof fetch }).fetch = fakeFetch({});
  expect((await fetchContext("https://x.test/api")).serverTime).toBeNull();
  (globalThis as { fetch: typeof fetch }).fetch = fakeFetch({ date: "Thu, 18 Sep 2026 22:35:00 GMT", age: "10" });
  expect((await fetchContext("https://x.test/api")).serverTime).toBe(Date.UTC(2026, 8, 18, 22, 35, 10));
});
