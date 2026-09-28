import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResearchTools } from "@pickler/core";
import { ExaResearch } from "@pickler/infrastructure";
import { allowedHost, exaSearchBody, siteScopedTools, siteScopedWeb } from "../src/plugins/exa.js";

const signal = () => AbortSignal.timeout(1000);

/** A fake Exa endpoint that answers each search from a queue and records every request body. */
function fakeExa(answers: { url: string }[][]) {
  const bodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const results = (answers.shift() ?? []).map((item) => ({ ...item, text: "evidence" }));
    return Response.json({ results });
  };
  return { exa: new ExaResearch("test-only", fetcher), bodies };
}

test("only mode refuses a host outside the list, prefer and anywhere do not", () => {
  const sites = ["espn.com", "nfl.com"];

  assert.equal(allowedHost("https://www.espn.com/nfl/story", { mode: "only", sites }), true);
  assert.equal(allowedHost("https://sub.nfl.com/x", { mode: "only", sites }), true);
  assert.equal(
    allowedHost("https://notespn.com/x", { mode: "only", sites }),
    false,
    "a suffix without a dot is a different site",
  );
  assert.equal(allowedHost("https://reddit.com/r/nfl", { mode: "only", sites }), false);
  assert.equal(allowedHost("https://reddit.com/r/nfl", { mode: "prefer", sites }), true);
  assert.equal(allowedHost("https://reddit.com/r/nfl", { mode: "anywhere", sites: [] }), true);
});

test("the site guard stands alone: it normalises the URL before judging the host", () => {
  const only = { mode: "only" as const, sites: ["espn.com"] };

  assert.equal(allowedHost("https://ESPN.COM/nfl", only), true, "hosts compare without case");
  assert.equal(allowedHost("ftp://espn.com/file", only), false, "only http and https are read");
  assert.equal(
    allowedHost("https://evil.io@espn.com/x", only),
    false,
    "credentials in a URL are refused outright, though the host is espn.com",
  );
  assert.equal(
    allowedHost("https://espn.com@evil.io/x", only),
    false,
    "the host decides, never the credentials",
  );
  assert.equal(allowedHost("not a url", only), false);
  assert.equal(allowedHost("ftp://reddit.com/x", { mode: "anywhere", sites: [] }), false);
});

test("the search request carries the list as includeDomains for only and prefer, and nothing for anywhere", () => {
  const sites = ["espn.com"];

  assert.deepEqual(exaSearchBody("q", { mode: "only", sites }).includeDomains, sites);
  assert.deepEqual(exaSearchBody("q", { mode: "prefer", sites }).includeDomains, sites);
  assert.equal(exaSearchBody("q", { mode: "anywhere", sites: [] }).includeDomains, undefined);
});

test("anywhere sends exactly the request Exa received before site lists existed", async () => {
  const { exa, bodies } = fakeExa([[{ url: "https://example.com/a" }]]);
  const web = siteScopedWeb(exa, { mode: "anywhere", sites: [] }, async () => {});

  await web.search("q", signal());

  assert.equal(
    JSON.stringify(bodies[0]),
    JSON.stringify({ query: "q", numResults: 5, contents: { text: true } }),
  );
  assert.deepEqual(bodies[0], exaSearchBody("q", { mode: "anywhere", sites: [] }));
});

test("reading a page outside an only list is refused without calling Exa", async () => {
  const { exa, bodies } = fakeExa([]);
  const web = siteScopedWeb(exa, { mode: "only", sites: ["espn.com"] }, async () => {});

  await assert.rejects(web.read("https://reddit.com/r/nfl", signal()), {
    code: "INVALID_INPUT",
    message: "Outside the agent's site list",
  });

  assert.equal(bodies.length, 0);
});

test("prefer retries once without the list when the list finds nothing, and says so", async () => {
  const { exa, bodies } = fakeExa([[], [{ url: "https://reddit.com/r/nfl" }]]);
  const fallbacks: unknown[] = [];
  const web = siteScopedWeb(exa, { mode: "prefer", sites: ["espn.com"] }, async (data) => {
    fallbacks.push(data);
  });

  const result = await web.search("q", signal());

  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], exaSearchBody("q", { mode: "prefer", sites: ["espn.com"] }));
  assert.deepEqual(bodies[1], exaSearchBody("q", { mode: "anywhere", sites: [] }));
  assert.equal(result.sources[0]?.url, "https://reddit.com/r/nfl");
  assert.equal(fallbacks.length, 1);
});

test("prefer does not retry when the list found something", async () => {
  const { exa, bodies } = fakeExa([[{ url: "https://www.espn.com/a" }]]);
  const web = siteScopedWeb(exa, { mode: "prefer", sites: ["espn.com"] }, async () => {});

  await web.search("q", signal());

  assert.equal(bodies.length, 1);
});

test("only never retries and never returns a page from outside the list", async () => {
  const { exa, bodies } = fakeExa([[{ url: "https://reddit.com/r/nfl" }], []]);
  const fallbacks: unknown[] = [];
  const web = siteScopedWeb(exa, { mode: "only", sites: ["espn.com"] }, async (data) => {
    fallbacks.push(data);
  });

  const result = await web.search("q", signal());

  assert.equal(bodies.length, 1);
  assert.deepEqual(result.sources, []);
  assert.equal(fallbacks.length, 0);
});

test("with the web off, search finds nothing and reading is refused, without calling Exa", async () => {
  const { exa, bodies } = fakeExa([[{ url: "https://example.com/a" }]]);
  const web = siteScopedWeb(exa, null, async () => {});

  const result = await web.search("q", signal());

  assert.deepEqual(result.sources, []);
  await assert.rejects(web.read("https://example.com/a", signal()), { code: "INVALID_INPUT" });
  assert.equal(bodies.length, 0);
});

test("the model's readPage refuses outside the list before the runner's provider call", async () => {
  const reads: string[] = [];
  const tools: Partial<ResearchTools> = {
    searchWeb: async () => [],
    readPage: async (url) => {
      reads.push(url);
      throw new Error("the runner must not be reached");
    },
  };

  const only = siteScopedTools(tools, { mode: "only", sites: ["espn.com"] });
  const off = siteScopedTools(tools, null);

  await assert.rejects(only.readPage!("https://reddit.com/r/nfl"), {
    code: "INVALID_INPUT",
    message: "Outside the agent's site list",
  });
  assert.equal(reads.length, 0);
  assert.equal(off.readPage, undefined, "no page reader is offered with the web off");
  assert.equal(typeof off.searchWeb, "function", "search stays: the runner requires both intents");
  assert.equal(siteScopedTools(tools, { mode: "anywhere", sites: [] }), tools);
});
