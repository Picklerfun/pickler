import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DataSourceUnavailableError } from "@pickler/core";
import {
  createSupabaseApplicants,
  createSupabaseRestClient,
  createSupabaseWaitlist,
} from "../src/index.js";

// Output of growth.applicant_by_token() for a seat with a submitted application.
const applicantFixture: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/applicant.json", import.meta.url), "utf8"),
);

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
}

const config = { url: "https://ref.supabase.co", secretKey: "sb_secret_test" };

test("rest client posts to the rpc endpoint with the secret key only in apikey", async () => {
  const calls: Call[] = [];
  const client = createSupabaseRestClient({
    ...config,
    fetch: fakeFetch(() => Response.json({ ok: true }), calls),
  });

  assert.deepEqual(await client.rpc("join_waitlist", { p_email: "a@b.co" }), { ok: true });
  assert.equal(calls[0]!.url, "https://ref.supabase.co/rest/v1/rpc/join_waitlist");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(calls[0]!.init.body, JSON.stringify({ p_email: "a@b.co" }));
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.apikey, "sb_secret_test");
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers["Content-Profile"], undefined);
});

test("rest client targets the configured schema through Content-Profile", async () => {
  const calls: Call[] = [];
  const client = createSupabaseRestClient({
    ...config,
    schema: "growth",
    fetch: fakeFetch(() => Response.json(true), calls),
  });

  await client.rpc("ticker_available", { p_ticker: "$HALF" });
  assert.equal((calls[0]!.init.headers as Record<string, string>)["Content-Profile"], "growth");
});

test("rest client sends legacy JWT keys as a bearer token too", async () => {
  const calls: Call[] = [];
  const client = createSupabaseRestClient({
    url: config.url,
    secretKey: "eyJlegacy",
    fetch: fakeFetch(() => Response.json([]), calls),
  });

  await client.rpc("ticker_available");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>).Authorization,
    "Bearer eyJlegacy",
  );
});

test("rest client maps HTTP errors, network errors and timeouts to DataSourceUnavailableError", async (t) => {
  const failing = [
    fakeFetch(() => new Response("nope", { status: 500 })),
    fakeFetch(() => Promise.reject(new TypeError("fetch failed"))),
    fakeFetch(() => new Response("not json", { status: 200 })),
  ];
  for (const doFetch of failing) {
    const client = createSupabaseRestClient({ ...config, fetch: doFetch });
    await assert.rejects(client.rpc("ticker_available"), DataSourceUnavailableError);
  }

  // Real fetch owns an I/O handle; this pending mock needs a referenced handle on Node 22.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
    )) as typeof fetch;
  const slow = createSupabaseRestClient({ ...config, timeoutMs: 10, fetch: hanging });
  await assert.rejects(slow.rpc("ticker_available"), DataSourceUnavailableError);
});

test("waitlist adapter sends the referral code and reads the single placement row", async () => {
  const calls: unknown[] = [];
  const token = "375cfaba-764f-439d-a8d1-0bcd308b1cf2";
  const waitlist = createSupabaseWaitlist({
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      return [{ line_position: 1205, already_joined: false, apply_token: token }];
    },
  });
  assert.deepEqual(await waitlist.join("a@b.co", "abc12345"), {
    position: 1205,
    alreadyJoined: false,
    applyToken: token,
  });
  assert.deepEqual(calls, [["join_waitlist", { p_email: "a@b.co", p_referral_code: "abc12345" }]]);

  const empty = createSupabaseWaitlist({ rpc: async () => [] });
  await assert.rejects(empty.join("a@b.co", null), DataSourceUnavailableError);
});

test("applicant adapter parses applicant_by_token output", async () => {
  const token = "f086a045-d1bd-4470-9e7c-98b9250cdcba";
  const applicants = createSupabaseApplicants({ rpc: async () => applicantFixture });
  const applicant = await applicants.findByToken(token);

  assert.equal(applicant?.email, "bo@x.io");
  assert.equal(applicant?.application?.ticker, "$BOBO");
  assert.ok(applicant?.application?.submittedAt instanceof Date);
});

test("applicant adapter never sends malformed tokens to Postgres", async () => {
  let calls = 0;
  const applicants = createSupabaseApplicants({
    rpc: async () => {
      calls += 1;
      return null;
    },
  });
  assert.equal(await applicants.findByToken("not-a-uuid"), null);
  assert.equal(await applicants.submit("'; drop table", {} as never), "not_found");
  assert.equal(calls, 0);
});

test("applicant adapter rejects unknown submit outcomes", async () => {
  const applicants = createSupabaseApplicants({ rpc: async () => "maybe" });
  await assert.rejects(
    applicants.submit("f086a045-d1bd-4470-9e7c-98b9250cdcba", {
      agentName: "A",
      ticker: "$AA",
      xHandle: "@a",
      category: "Sports",
      personality: "Analyst",
      edge: "e",
      whyYou: "w",
    }),
    DataSourceUnavailableError,
  );
});
