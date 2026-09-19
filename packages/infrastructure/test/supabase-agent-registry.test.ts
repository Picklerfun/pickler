import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceUnavailableError, parseAuditQuery } from "@pickler/core";
import {
  createSupabaseAdmin,
  createSupabaseAgentEventLog,
  createSupabaseAgentRegistry,
} from "../src/index.js";

function fakeSupabase(
  replies: { status?: number; body: unknown; headers?: Record<string, string> }[],
) {
  const requests: Request[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    const reply = replies.shift() ?? { body: null };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json", ...(reply.headers ?? {}) },
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

const ID = "8b3a4d2e-1f9c-4e5a-b6d7-9c8e7f6a5b4d";
const row = {
  id: ID,
  workspace_id: "w1",
  name: "Halftime",
  status: "pending_policies",
  chain_id: null,
  killed_at: null,
  created_at: "2026-09-01T10:00:00+00:00",
  updated_at: "2026-09-01T10:00:00+00:00",
  agent_profiles: { blurb: "" },
};

test("agent reads target the agents schema and never select secrets", async () => {
  const { db, requests } = fakeSupabase([{ body: row }]);
  const agent = await createSupabaseAgentRegistry(db).findById(ID);
  const url = new URL(requests[0]!.url);
  assert.equal(url.pathname, "/rest/v1/agents");
  assert.equal(requests[0]!.headers.get("accept-profile"), "agents");
  assert.doesNotMatch(url.searchParams.get("select") ?? "", /credentials|encrypted/);
  assert.equal(agent?.workspaceId, "w1");
  assert.equal(agent?.description, null);
  assert.equal(agent?.createdAt.toISOString(), "2026-09-01T10:00:00.000Z");
});

test("malformed ids never reach Postgres", async () => {
  const { db, requests } = fakeSupabase([]);
  const registry = createSupabaseAgentRegistry(db);
  assert.equal(await registry.findById("not-a-uuid"), null);
  assert.equal(await registry.findCredentials("x"), null);
  assert.equal(requests.length, 0);
});

test("audit applies Relayer's filters, pagination and exact count", async () => {
  const { db, requests } = fakeSupabase([{ body: [], headers: { "Content-Range": "20-39/57" } }]);
  const now = new Date("2026-09-16T12:00:00Z");
  const page = await createSupabaseAgentEventLog(db).audit(
    ID,
    parseAuditQuery({ page: "2", type: "budget", period: "24h", status: "success" }, now),
  );
  const url = new URL(requests[0]!.url);
  assert.equal(
    url.searchParams.get("event_type"),
    "in.(budget_update,budget_exceeded,budget_reset)",
  );
  assert.equal(url.searchParams.get("created_at"), "gte.2026-09-15T12:00:00.000Z");
  assert.equal(url.searchParams.get("payload->>status"), "eq.success");
  assert.equal(url.searchParams.get("offset"), "20");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.match(requests[0]!.headers.get("prefer") ?? "", /count=exact/);
  assert.deepEqual(page, { events: [], total: 57, page: 2, limit: 20 });
});

test("storage errors are surfaced instead of empty analytics", async () => {
  const { db } = fakeSupabase([{ status: 500, body: { message: "down" } }]);
  await assert.rejects(
    createSupabaseAgentEventLog(db).listSince(ID, new Date()),
    DataSourceUnavailableError,
  );
});
