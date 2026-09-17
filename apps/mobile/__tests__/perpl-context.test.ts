import contextJson from "./fixtures/perpl/context.json";
import { fetchContext, parseContext } from "../src/perpl/context";

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
