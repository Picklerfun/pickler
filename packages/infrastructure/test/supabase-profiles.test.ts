import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceUnavailableError } from "@pickler/core";
import { createSupabaseAdmin, createSupabaseProfileRepository } from "../src/index.js";

function fake(replies: { status?: number; body: unknown }[]) {
  const requests: Request[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    const r = replies.shift() ?? { body: null };
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    repo: createSupabaseProfileRepository(
      createSupabaseAdmin({
        url: "https://ref.supabase.co",
        secretKey: "sb_secret_x",
        fetch: fetchFn,
      }),
    ),
    requests,
  };
}

const row = {
  user_id: "u1",
  display_name: "Ana Robles",
  handle: "anarobles",
  created_at: "2026-09-16T12:00:00+00:00",
};

test("create registers handle and profile through identity.create_profile, then reads the profile", async () => {
  const { repo, requests } = fake([{ body: "created" }, { body: row }]);
  const result = await repo.create({
    userId: "u1",
    displayName: "Ana Robles",
    handle: "anarobles",
  });
  assert.equal(result.created && result.profile.handle, "anarobles");
  assert.equal(new URL(requests[0]!.url).pathname, "/rest/v1/rpc/create_profile");
  assert.equal(requests[0]!.headers.get("content-profile"), "identity");
  assert.deepEqual(await requests[0]!.json(), {
    p_user_id: "u1",
    p_display_name: "Ana Robles",
    p_handle: "anarobles",
  });
  assert.equal(new URL(requests[1]!.url).pathname, "/rest/v1/profiles");
});

test("create maps function outcomes and rejects unknown ones", async () => {
  const { repo } = fake([
    { body: "handle_taken" },
    { body: "user_has_profile" },
    { body: "maybe" },
  ]);
  const input = { userId: "u2", displayName: "Bo", handle: "anarobles" };
  assert.deepEqual(await repo.create(input), { created: false, reason: "handle_taken" });
  assert.deepEqual(await repo.create(input), { created: false, reason: "user_has_profile" });
  await assert.rejects(repo.create(input), DataSourceUnavailableError);
});

test("handle checks ask identity.handle_available, shared with agent handles", async () => {
  const { repo, requests } = fake([{ body: false }, { body: true }]);
  assert.equal(await repo.isHandleTaken("halftime"), true);
  assert.equal(await repo.isHandleTaken("freehandle"), false);
  assert.equal(new URL(requests[0]!.url).pathname, "/rest/v1/rpc/handle_available");
  assert.equal(requests[0]!.headers.get("content-profile"), "identity");
});
