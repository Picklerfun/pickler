import { test } from "node:test";
import assert from "node:assert/strict";
import { ExaResearch } from "../src/research/exa";
import { PolymarketData } from "../src/polymarket/market-data";
const signal = () => AbortSignal.timeout(1000);
const respond =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    Response.json(body, { status });
test("Exa contract preserves provenance, missing dates and marked truncation", async () => {
  const exa = new ExaResearch(
    "test-only",
    respond({
      results: [{ url: "https://example.com/a", text: "x".repeat(7000), title: "Evidence" }],
      costDollars: { total: 0.01 },
    }),
  );
  const { sources } = await exa.search("evidence", signal());

  assert.equal(sources[0]?.content.length, 6000);
  assert.equal(sources[0]?.truncated, true);
  assert.equal(sources[0]?.publishedAt, null);
  assert.equal(sources[0]?.provider, "exa");
  assert.deepEqual(sources[0]?.providerUsage, { total: 0.01 });
  assert.equal((await exa.read("https://example.com/a", signal())).id, sources[0]?.id);
});

test("provider failures, incomplete sources and invalid input are errors", async () => {
  await assert.rejects(new ExaResearch("test", respond({}, 429)).search("x", signal()), {
    code: "PROVIDER_HTTP_429",
  });
  await assert.rejects(
    new ExaResearch("test", respond({ results: [{ url: "https://example.com" }] })).search(
      "x",
      signal(),
    ),
    { code: "INVALID_PROVIDER_RESPONSE" },
  );
  await assert.rejects(
    new ExaResearch("test", respond({ results: [] })).read("https://example.com", signal()),
    { code: "INVALID_PROVIDER_RESPONSE" },
  );
  assert.throws(() => new ExaResearch("test").search("", signal()), { code: "INVALID_INPUT" });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    new ExaResearch("test", async (_url, init) => {
      init?.signal?.throwIfAborted();
      return Response.json({});
    }).search("x", controller.signal),
    { code: "PROVIDER_TIMEOUT" },
  );
});

test("order book validates outcome, timestamp, fractional prices and sorting", async () => {
  const book = {
    asset_id: "99",
    timestamp: String(Date.now()),
    bids: [],
    asks: [
      { price: "0.7", size: "2" },
      { price: "0.2", size: "3" },
    ],
  };

  assert.equal(
    (await new PolymarketData(respond(book)).book("99", signal())).asks[0]?.price,
    "0.2",
  );
  await assert.rejects(new PolymarketData(respond(book)).book("98", signal()), {
    code: "INVALID_PROVIDER_RESPONSE",
  });
  await assert.rejects(
    new PolymarketData(respond({ ...book, timestamp: "1" })).book("99", signal()),
    { code: "STALE_QUOTE" },
  );
  await assert.rejects(
    new PolymarketData(respond({ ...book, asks: [{ price: "2.0", size: "1" }] })).book(
      "99",
      signal(),
    ),
    { code: "INVALID_PROVIDER_RESPONSE" },
  );
  assert.deepEqual(
    (await new PolymarketData(respond({ ...book, asks: [] })).book("99", signal())).asks,
    [],
  );
});

test("market rules and category membership are independently fetched", async () => {
  const paths: string[] = [];
  const provider = new PolymarketData(async (url) => {
    paths.push(String(url));
    return Response.json(
      String(url).endsWith("/tags")
        ? [{ id: "7", label: "Test category" }]
        : {
            id: "1",
            question: "Test?",
            description: "Official resolution condition",
            active: true,
            closed: false,
            outcomes: '["Yes","No"]',
            clobTokenIds: '["99","100"]',
            liquidityNum: 12,
          },
    );
  });
  const market = await provider.get("1", signal());

  assert.deepEqual(market.categoryIds, ["7"]);
  assert.equal(market.rules, "Official resolution condition");
  assert.equal(paths.length, 2);
  await assert.rejects(provider.list([], signal()), { code: "CATEGORIES_REQUIRED" });
});

test("empty Exa search preserves reported usage without fabricating evidence", async () => {
  const result = await new ExaResearch(
    "test",
    respond({ results: [], costDollars: { total: 0.01 } }),
  ).search("no results", signal());

  assert.deepEqual(result, { sources: [], usage: { total: 0.01 } });
});

test("provider redirects are rejected without forwarding credentials", async () => {
  let calls = 0;
  const exa = new ExaResearch("test-only", async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://example.com" } });
  });
  await assert.rejects(exa.search("probe", signal()), { code: "PROVIDER_HTTP_302" });
  assert.equal(calls, 1);
});

test("discovery shares five pages across categories, preserving verified start and exact rule links", async () => {
  const paths: URL[] = [];
  const reports: unknown[] = [];
  const provider = new PolymarketData(async (input) => {
    const url = new URL(String(input));
    paths.push(url);
    return Response.json(
      Array.from({ length: 20 }, (_, index) => ({
        id: String(paths.length * 20 + index),
        question: "Game",
        active: true,
        closed: false,
        description: "Resolve using https://example.com/rules. Never use http://127.0.0.1/private",
        resolutionSource: "https://scores.example.org/event#result",
        outcomes: '["Yes","No"]',
        clobTokenIds: '["99","100"]',
        liquidityNum: index,
        gameStartTime:
          index === 0
            ? "2026-09-18 00:15:00+00"
            : index === 2
              ? "2026-02-31T00:15:00Z"
              : "2026-09-18 00:15:00",
        endDate: "2026-09-20T00:00:00Z",
        sportsMarketType: "moneyline",
      })),
    );
  });
  const candidates = await provider.list(["1", "2"], signal(), async (data) => {
    reports.push(data);
  });
  assert.equal(paths.length, 5);
  assert.equal(candidates.length, 100);
  assert.deepEqual(
    paths.map((url) => [url.searchParams.get("tag_id"), url.searchParams.get("offset")]),
    [
      ["1", "0"],
      ["2", "0"],
      ["1", "20"],
      ["2", "20"],
      ["1", "40"],
    ],
  );
  assert.equal(candidates.find((m) => m.id === "20")?.startsAt, "2026-09-18T00:15:00.000Z");
  assert.equal(candidates.find((m) => m.id === "21")?.startsAt, null);
  assert.equal(candidates.find((m) => m.id === "22")?.startsAt, null);
  assert.deepEqual(candidates[0]?.resolutionUrls, [
    "https://example.com/rules",
    "https://scores.example.org/event",
  ]);
  assert.equal((reports[0] as { exhaustedBudget: boolean }).exhaustedBudget, true);
});

test("paper conditions require explicit per-market fees and constraints", async () => {
  const market = {
    id: "1",
    question: "Fixture",
    description: "Fixture full-game rules",
    active: true,
    closed: false,
    outcomes: '["A","B"]',
    clobTokenIds: '["2","3"]',
    feesEnabled: true,
    feeSchedule: { rate: 0.05, exponent: 1, takerOnly: true },
    orderPriceMinTickSize: 0.01,
    orderMinSize: 5,
  };
  const result = await new PolymarketData(respond(market)).conditions("1", "2", signal());
  assert.equal(result.feeRate, "0.05");
  assert.equal(result.minimumNotional, "5");
  await assert.rejects(
    new PolymarketData(respond({ ...market, feeSchedule: null })).conditions("1", "2", signal()),
    { code: "PAPER_INVALID_CONDITIONS" },
  );
  await assert.rejects(
    new PolymarketData(respond({ ...market, orderMinSize: undefined })).conditions(
      "1",
      "2",
      signal(),
    ),
    { code: "INVALID_PROVIDER_RESPONSE" },
  );
  assert.equal(
    (
      await new PolymarketData(
        respond({ ...market, feesEnabled: false, feeSchedule: null }),
      ).conditions("1", "2", signal())
    ).feeRate,
    "0",
  );
  await assert.rejects(new PolymarketData(respond(market)).conditions("1", "999", signal()), {
    code: "PAPER_INVALID_CONDITIONS",
  });
});
