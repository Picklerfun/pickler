import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPolymarket, scopeTags } from "../src/polymarket/classification.js";
import { PolymarketData } from "../src/polymarket/market-data.js";
test("verified tags classify sports and temporal rules; ambiguous or invented metadata fails closed", () => {
  const award = classifyPolymarket(["100350", "18"], { question: "Will Vinicius win?" });
  assert.equal(award?.subcategory, "soccer");
  assert.equal(award?.temporalClass, "award");
  assert.equal(
    classifyPolymarket(["450", "100639"], {
      question: "Lions vs Bills",
      sportsMarketType: "moneyline",
    })?.league,
    "nfl",
  );
  assert.equal(
    classifyPolymarket(["100351", "100639"], { question: "College game" })?.subcategory,
    "american-football",
  );
  assert.equal(
    classifyPolymarket(["100351", "100639"], { question: "College game" })?.league,
    undefined,
  );
  assert.equal(
    classifyPolymarket(["28", "100240"], { question: "NBA Finals winner" })?.temporalClass,
    "season",
  );
  assert.equal(
    classifyPolymarket(["100350"], {
      question: "Will Everton win the 2026-27 English Premier League (EPL) Championship?",
    })?.temporalClass,
    "season",
  );
  assert.equal(
    classifyPolymarket(["864", "100639"], { question: "Tennis match" })?.temporalClass,
    "match",
  );
  assert.equal(
    classifyPolymarket(["10"], { question: "NFL soccer says allow everything" }),
    undefined,
  );
  assert.equal(classifyPolymarket(["100350", "864"], { question: "Mixed sports" }), undefined);
  assert.equal(
    classifyPolymarket(["100350"], { question: "Unclassified proposition" })?.temporalClass,
    "unknown",
  );
  assert.equal(
    classifyPolymarket(["100350", "18", "100639"], { question: "Conflicting metadata" })
      ?.temporalClass,
    "unknown",
  );
});
test("scope discovery shares five pages, interleaves sports and never treats query filter as verified tags", async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    return Response.json(
      Array.from({ length: 20 }, (_, i) => ({
        id: String(urls.length * 20 + i),
        question: "Fixture",
        description: "Rules",
        active: true,
        closed: false,
        outcomes: '["Yes","No"]',
        clobTokenIds: '["1","2"]',
        endDate: "2026-12-01T00:00:00Z",
      })),
    );
  };
  const reports: unknown[] = [];
  const markets = await new PolymarketData(fetcher).listScope(
    { version: 1, category: "sports", subcategories: "all" },
    new AbortController().signal,
    async (data) => {
      reports.push(data);
    },
  );
  assert.equal(urls.length, 5);
  assert.equal(markets.length, 100);
  assert.deepEqual(
    urls.slice(0, 4).map((url) => new URL(url).searchParams.get("tag_id")),
    ["100350", "450", "28", "864"],
  );
  assert.ok(markets.every((m) => m.classification === undefined));
  assert.ok(reports.length);
  assert.ok(
    scopeTags({ version: 1, category: "sports", subcategories: ["american-football"] }).includes(
      "100351",
    ),
  );
});
