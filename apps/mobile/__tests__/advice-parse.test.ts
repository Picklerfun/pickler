import agentsJson from "./fixtures/advice/marketplace-agents.json";
import recommendationJson from "./fixtures/advice/recommendation.json";
import {
  parseAccepted, parseAusdAmount, parseData, parseHistory, parseRecommendation, parseStudioAgents,
} from "../src/advice/parse";

test("parseStudioAgents keeps only the priced perps and both-venue rows, in the server order", () => {
  const agents = parseStudioAgents(agentsJson);

  expect(agents).toEqual([
    { id: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", name: "Momentum Mira", handle: "mira", accent: "lime", venue: "perps", price: { micro: 1_500_000n, text: "1.5" } },
    { id: "a0b1c2d3-e4f5-4a6b-9c7d-8e9f0a1b2c3d", name: "Basis Bruno", handle: "bruno", accent: "cyan", venue: "both", price: { micro: 250_000n, text: "0.25" } },
  ]);
});

test.each([
  ["not an object", 7],
  ["no id", { ...agentsJson[0], id: undefined }],
  ["no handle", { ...agentsJson[0], handle: 3 }],
  ["unknown venue", { ...agentsJson[0], venue: "spot" }],
  ["another asset", { ...agentsJson[0], advicePrice: { amount: "1.5", asset: "USDC", decimals: 6 } }],
  ["other decimals", { ...agentsJson[0], advicePrice: { amount: "1.5", asset: "AUSD", decimals: 18 } }],
  ["amount not a string", { ...agentsJson[0], advicePrice: { amount: 1.5, asset: "AUSD", decimals: 6 } }],
  ["a zero price", { ...agentsJson[0], advicePrice: { amount: "0", asset: "AUSD", decimals: 6 } }],
])("parseStudioAgents drops a row with %s without throwing", (_, row) => {
  expect(parseStudioAgents([row, agentsJson[1]]).map((a) => a.handle)).toEqual(["bruno"]);
});

test("parseStudioAgents throws when the body is not the bare array", () => {
  expect(() => parseStudioAgents({ data: agentsJson })).toThrow(/Advice API/);
});

test.each([
  ["1.5", 1_500_000n],
  ["0.1", 100_000n],
  ["100", 100_000_000n],
  ["0.000001", 1n],
  ["999.999999", 999_999_999n],
])("parseAusdAmount reads %s as micro-AUSD", (text, micro) => {
  expect(parseAusdAmount(text)).toBe(micro);
});

test.each(["", "1.", ".5", "1,5", "1.2345678", "1000", "-1", " 1", "1e3", "0x10"])(
  "parseAusdAmount refuses %p",
  (text) => {
    expect(parseAusdAmount(text)).toBeNull();
  },
);

test("parseRecommendation reads every field the result screen needs", () => {
  const r = parseRecommendation(recommendationJson);

  expect(r).toMatchObject({ id: recommendationJson.id, agentId: recommendationJson.agentId, symbol: "BTC", status: "completed", error: null, startedAt: "2026-10-12T15:00:04.000Z", finishedAt: "2026-10-12T15:01:31.000Z" });
  expect(r.result).toEqual({
    version: 1, symbol: "BTC", network: "testnet", horizonHours: 24, orientation: "long",
    summary: "Momentum stays positive while funding is flat.",
    reasons: ["Higher lows on the 4h chart", "Funding near zero"],
    risks: ["A macro print tomorrow morning"],
    limitations: ["Testnet prices follow mainnet loosely"],
    sources: [{ id: "perpl-btc", name: "Perpl BTC market", url: "https://perpl.xyz/markets/btc", observedAt: "2026-10-12T15:00:10.000Z" }],
    generatedAt: "2026-10-12T15:01:30.000Z", dataAsOf: "2026-10-12T15:00:10.000Z",
  });
});

test("parseRecommendation accepts a queued job and a failed one", () => {
  const queued = parseRecommendation({ ...recommendationJson, status: "queued", startedAt: null, finishedAt: null, result: null });
  expect(queued).toMatchObject({ status: "queued", result: null, error: null });

  const failed = parseRecommendation({ ...recommendationJson, status: "failed", result: null, error: "ANALYSIS_EXPIRED" });
  expect(failed).toMatchObject({ status: "failed", result: null, error: "ANALYSIS_EXPIRED" });
});

test.each([
  ["not an object", null],
  ["unknown status", { ...recommendationJson, status: "paid" }],
  ["unknown symbol", { ...recommendationJson, symbol: "SOL" }],
  ["unknown error", { ...recommendationJson, error: "OOPS" }],
  ["createdAt not ISO", { ...recommendationJson, createdAt: "today" }],
  ["unknown orientation", { ...recommendationJson, result: { ...recommendationJson.result, orientation: "buy" } }],
  ["reasons not strings", { ...recommendationJson, result: { ...recommendationJson.result, reasons: [1] } }],
  ["a source without url", { ...recommendationJson, result: { ...recommendationJson.result, sources: [{ id: "x", name: "y", observedAt: "2026-10-12T15:00:10.000Z" }] } }],
  ["horizon not 24", { ...recommendationJson, result: { ...recommendationJson.result, horizonHours: 12 } }],
])("parseRecommendation throws on %s", (_, body) => {
  expect(() => parseRecommendation(body)).toThrow(/Advice API/);
});

test("parseData unwraps the { data } envelope and refuses anything else", () => {
  expect(parseData({ data: { a: 1 }, meta: {} })).toEqual({ a: 1 });
  expect(() => parseData({ a: 1 })).toThrow(/Advice API/);
  expect(() => parseData(null)).toThrow(/Advice API/);
});

test("parseAccepted and parseHistory read the 202 and the free history", () => {
  const accepted = parseAccepted({ id: recommendationJson.id, status: "queued", statusUrl: `/v1/agent-advice/recommendations/${recommendationJson.id}` });
  expect(accepted).toEqual({ id: recommendationJson.id, status: "queued", statusUrl: `/v1/agent-advice/recommendations/${recommendationJson.id}` });
  expect(() => parseAccepted({ id: "x", status: "queued" })).toThrow(/Advice API/);

  const history = parseHistory({ items: [recommendationJson, recommendationJson], nextCursor: null });
  expect(history.items).toHaveLength(2);
  expect(history.nextCursor).toBeNull();
  expect(parseHistory({ items: [], nextCursor: "abc" }).nextCursor).toBe("abc");
  expect(() => parseHistory({ items: "x", nextCursor: null })).toThrow(/Advice API/);
});
