import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceUnavailableError } from "@pickler/core";
import {
  createSupabaseAdmin,
  createSupabaseApiKeyDirectory,
  createSupabaseWorkspaceDirectory,
} from "../src/index.js";

type Reply = { status?: number; body: unknown };

/** Fake PostgREST: records requests and answers in order. */
function fakeSupabase(replies: Reply[]) {
  const requests: URL[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    requests.push(new URL(String(input instanceof Request ? input.url : input)));
    const reply = replies.shift() ?? { body: null };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    db: createSupabaseAdmin({
      url: "https://ref.supabase.co",
      secretKey: "sb_secret_test",
      fetch: fetchFn,
    }),
    requests,
  };
}

test("workspace directory reads identity.workspaces and resolves owner and member roles", async () => {
  const { db, requests } = fakeSupabase([
    {
      body: {
        id: "w1",
        name: "Ana Labs",
        owner_user_id: "ana",
        is_active: true,
        active_modules: ["agent"],
      },
    },
    { body: { owner_user_id: "ana" } },
    { body: { owner_user_id: "ana" } },
    { body: { role: "developer" } },
    { body: { owner_user_id: "ana" } },
    { body: null },
  ]);
  const dir = createSupabaseWorkspaceDirectory(db);

  assert.deepEqual(await dir.findById("w1"), {
    id: "w1",
    name: "Ana Labs",
    userId: "ana",
    isActive: true,
    activeModules: ["agent"],
  });
  assert.equal(requests[0]!.pathname, "/rest/v1/workspaces");
  assert.equal(requests[0]!.searchParams.get("id"), "eq.w1");

  assert.equal(await dir.roleOf("ana", "w1"), "admin");
  assert.equal(await dir.roleOf("carl", "w1"), "developer");
  assert.equal(requests[3]!.pathname, "/rest/v1/workspace_members");
  assert.equal(await dir.roleOf("dan", "w1"), null);
});

test("api key directory reads the workspace from the key and treats revoked keys as inactive", async () => {
  const { db, requests } = fakeSupabase([
    {
      body: {
        id: "k1",
        workspace_id: "w1",
        scopes: ["integrator"],
        allowed_cidrs: null,
        expires_at: "2026-10-01T00:00:00+00:00",
        revoked_at: "2026-09-10T00:00:00+00:00",
      },
    },
  ]);
  const key = await createSupabaseApiKeyDirectory(db).findByHash("abc");
  assert.equal(requests[0]!.pathname, "/rest/v1/api_keys");
  assert.equal(requests[0]!.searchParams.get("hash"), "eq.abc");
  assert.equal(key?.workspaceId, "w1");
  assert.equal(key?.active, false);
  assert.equal(key?.expiresAt?.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(key?.linkExpiresAt, null);
});

test("database errors surface as DataSourceUnavailableError", async () => {
  const { db } = fakeSupabase([{ status: 500, body: { message: "boom", code: "XX000" } }]);
  await assert.rejects(
    createSupabaseWorkspaceDirectory(db).findOwnedBy("ana"),
    DataSourceUnavailableError,
  );
});
