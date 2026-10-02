import { test } from "node:test";
import assert from "node:assert/strict";
import { createXClient, XUnavailableError } from "../src/index.js";

interface Call {
  url: string;
  headers: Headers;
}

function fake(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return respond();
  }) as typeof fetch;
  return { calls, fetcher };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("without a bearer token every method throws XUnavailableError", async () => {
  const client = createXClient({ bearerToken: undefined });
  assert.equal(client.available, false);
  await assert.rejects(client.userByHandle("a"), XUnavailableError);
  await assert.rejects(client.recentPosts("1", new Date()), XUnavailableError);
});

test("userByHandle looks the account up with the bearer token", async () => {
  const { calls, fetcher } = fake(() => json({ data: { id: "42", username: "HalftimeBot" } }));
  const client = createXClient({ bearerToken: "tok", fetch: fetcher });
  assert.equal(client.available, true);
  assert.deepEqual(await client.userByHandle("halftimebot"), { id: "42", handle: "HalftimeBot" });
  assert.equal(calls[0]?.url, "https://api.x.com/2/users/by/username/halftimebot");
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer tok");
});

test("userByHandle is null when X reports errors and no data", async () => {
  const { fetcher } = fake(() => json({ errors: [{ title: "Not Found Error" }] }));
  const client = createXClient({ bearerToken: "tok", fetch: fetcher });
  assert.equal(await client.userByHandle("nobody"), null);
});

test("429, 5xx and network failures are unavailable, without X's body in the message", async () => {
  for (const status of [429, 500, 503]) {
    const { fetcher } = fake(() => json({ detail: "secret-body" }, status));
    const client = createXClient({ bearerToken: "tok", fetch: fetcher });
    await assert.rejects(client.userByHandle("a"), (error: Error) => {
      assert.ok(error instanceof XUnavailableError);
      assert.ok(!error.message.includes("secret-body"));
      return true;
    });
  }
  const failing = createXClient({
    bearerToken: "tok",
    fetch: (async () => {
      throw new Error("boom");
    }) as typeof fetch,
  });
  await assert.rejects(failing.recentPosts("1", new Date()), XUnavailableError);
});

test("an unparseable response is unavailable", async () => {
  const { fetcher } = fake(() => json({ data: { id: 7 } }));
  const client = createXClient({ bearerToken: "tok", fetch: fetcher });
  await assert.rejects(client.userByHandle("a"), XUnavailableError);
});

test("recentPosts reads the timeline since the challenge and maps to XPost", async () => {
  const since = new Date("2026-10-02T10:00:00.250Z");
  const { calls, fetcher } = fake(() =>
    json({
      data: [
        { id: "9", author_id: "42", text: "hi pk-abc", created_at: "2026-10-02T10:05:00.000Z" },
      ],
    }),
  );
  const client = createXClient({ bearerToken: "tok", fetch: fetcher });
  const posts = await client.recentPosts("42", since);
  assert.deepEqual(posts, [
    { id: "9", authorId: "42", text: "hi pk-abc", createdAt: new Date("2026-10-02T10:05:00.000Z") },
  ]);
  const url = new URL(calls[0]?.url ?? "");
  assert.equal(url.origin + url.pathname, "https://api.x.com/2/users/42/tweets");
  assert.equal(url.searchParams.get("max_results"), "20");
  // To the second, as X requires: no milliseconds.
  assert.equal(url.searchParams.get("start_time"), "2026-10-02T10:00:00Z");
  assert.equal(url.searchParams.get("tweet.fields"), "created_at,author_id");
});

test("recentPosts is empty when X returns no data", async () => {
  const { fetcher } = fake(() => json({ meta: { result_count: 0 } }));
  const client = createXClient({ bearerToken: "tok", fetch: fetcher });
  assert.deepEqual(await client.recentPosts("42", new Date()), []);
});
