import { acceptedFrom, AdviceApiError, fetchStudioAgents, getRecommendation, history, requestAdvice } from "../src/advice/api";
import { IdentityError, WalletLockedError, type AuthedFetch } from "../src/identity/api";

// The advice client against a fake fetch: statuses are data, the deadline covers the body.

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const rec = { id: "r1", agentId: "a1", symbol: "BTC", status: "queued", createdAt: "2026-10-12T10:00:00Z", startedAt: null, finishedAt: null, result: null, error: null };
const row = { id: "a1", name: "Owl", handle: "owl", accent: "#fff", venue: "perps", advicePrice: { asset: "AUSD", decimals: 6, amount: "0.5" } };

/** A response whose body never arrives until the request is aborted. */
const hanging = (signal?: AbortSignal | null) =>
  ({
    ok: true, status: 200, headers: new Headers(),
    json: () => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  }) as unknown as Response;

afterEach(() => jest.useRealTimers());

test("a 402 is returned with its body, not thrown", async () => {
  const terms = { x402Version: 1, accepts: [] };
  const authed: AuthedFetch = jest.fn(async () => json(402, terms));
  await expect(requestAdvice(authed, "a1", "BTC", "key-1")).resolves.toEqual({ status: 402, json: terms, settlementHeader: null });
});

test("a 202 exposes X-PAYMENT-RESPONSE and its body parses", async () => {
  const body = { data: { id: "r1", status: "queued", statusUrl: "/agent-advice/recommendations/r1" } };
  const authed: AuthedFetch = async () => json(202, body, { "X-PAYMENT-RESPONSE": "abc" });
  const answer = await requestAdvice(authed, "a1", "ETH", "key-1", "pay");
  expect(answer.status).toBe(202);
  expect(answer.settlementHeader).toBe("abc");
  expect(acceptedFrom(answer.json).id).toBe("r1");
});

test("Idempotency-Key, X-PAYMENT, the path and the body go out as given", async () => {
  const authed = jest.fn<ReturnType<AuthedFetch>, Parameters<AuthedFetch>>(async () => json(202, {}));
  await requestAdvice(authed, "a/1", "BTC", "key-9", "payload");
  const [path, init] = authed.mock.calls[0]!;
  expect(path).toBe("/agent-advice/agents/a%2F1/recommendations");
  expect(init?.method).toBe("POST");
  expect(init?.headers).toMatchObject({ "Idempotency-Key": "key-9", "X-PAYMENT": "payload" });
  expect(init?.body).toBe(JSON.stringify({ symbol: "BTC" }));
  await requestAdvice(authed, "a1", "BTC", "key-9");
  expect((authed.mock.calls[1]![1]?.headers as Record<string, string>)["X-PAYMENT"]).toBeUndefined();
});

test("the deadline aborts a hanging body", async () => {
  jest.useFakeTimers();
  const authed: AuthedFetch = async (_p, init) => hanging(init?.signal);
  const pending = requestAdvice(authed, "a1", "BTC", "k");
  const outcome = pending.then(() => null, (e: unknown) => e);
  await jest.advanceTimersByTimeAsync(15_000);
  const e = await outcome;
  expect(e).toBeInstanceOf(AdviceApiError);
  expect((e as AdviceApiError).code).toBe("timeout");
});

test("a failing fetch is a network error", async () => {
  const authed: AuthedFetch = async () => { throw new TypeError("offline"); };
  await expect(requestAdvice(authed, "a1", "BTC", "k")).rejects.toMatchObject({ status: 0, code: "network" });
});

test("the public list needs no token and keeps good rows", async () => {
  const doFetch = jest.fn(async (_url: string, _init: RequestInit) => json(200, [row, { id: 1 }]));
  const agents = await fetchStudioAgents("https://x.test/api/v1", doFetch);
  expect(agents.map((a) => a.id)).toEqual(["a1"]);
  expect(doFetch.mock.calls[0]![0]).toBe("https://x.test/api/v1/marketplace/agents");
  await expect(fetchStudioAgents("b", async () => json(500, { error: "boom" }))).rejects.toMatchObject({ status: 500, code: "boom" });
  await expect(fetchStudioAgents("b", async () => json(200, { not: "an array" }))).rejects.toMatchObject({ code: "bad_response" });
});

test("getRecommendation and history read the envelope", async () => {
  const calls: string[] = [];
  const authed: AuthedFetch = async (path) => {
    calls.push(path);
    return json(200, { data: path.includes("?symbol") ? { items: [rec], nextCursor: null } : rec });
  };
  expect((await getRecommendation(authed, "r1")).id).toBe("r1");
  expect((await history(authed, "a1", "BTC")).items).toHaveLength(1);
  expect(calls).toEqual(["/agent-advice/recommendations/r1", "/agent-advice/agents/a1/recommendations?symbol=BTC"]);
});

test("an error status throws with the server's code; a body without the envelope is bad_response", async () => {
  await expect(getRecommendation(async () => json(404, { error: "not_found" }), "x")).rejects.toMatchObject({ status: 404, code: "not_found" });
  await expect(getRecommendation(async () => json(200, rec), "x")).rejects.toMatchObject({ code: "bad_response" });
});

test("a locked wallet surfaces as WalletLockedError, a failed sign-in keeps its code, a TypeError is network", async () => {
  await expect(requestAdvice(async () => { throw new WalletLockedError(); }, "a1", "BTC", "k")).rejects.toBeInstanceOf(WalletLockedError);
  await expect(getRecommendation(async () => { throw new WalletLockedError(); }, "r")).rejects.toBeInstanceOf(WalletLockedError);
  const signin = requestAdvice(async () => { throw new IdentityError(0, "unexpected_message"); }, "a1", "BTC", "k");
  await expect(signin).rejects.toMatchObject({ name: "AdviceApiError", code: "signin_unexpected_message" });
  await expect(requestAdvice(async () => { throw new TypeError("offline"); }, "a1", "BTC", "k")).rejects.toMatchObject({ code: "network" });
});
