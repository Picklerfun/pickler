import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  aggregateAnalytics,
  AgentAuthenticationError,
  AgentNotFoundError,
  canonicalBody,
  createAgentQueries,
  createAuthenticateAgent,
  parseAuditQuery,
  type AgentCredentialRecord,
  type AgentEvent,
  type RegisteredAgent,
} from "../src/index.js";

const NOW = new Date("2026-09-16T12:00:00Z");

const agent = (
  id: string,
  workspaceId: string,
  status: RegisteredAgent["status"] = "active",
): RegisteredAgent => ({
  id,
  workspaceId,
  name: id,
  description: null,
  status,
  walletId: "wal",
  walletAddress: "0xabc",
  chainId: 143,
  thresholdUsd: "0",
  killedAt: null,
  turnkeyUserId: null,
  turnkeyAgentUserId: null,
  turnkeyPolicyId: null,
  activePolicyId: null,
  createdAt: NOW,
  updatedAt: null,
});

const event = (type: string, payload: Record<string, unknown> | null): AgentEvent => ({
  id: type,
  agentId: "a1",
  workspaceId: "w1",
  eventType: type,
  skillId: null,
  payload,
  createdAt: NOW,
});

test("analytics aggregate spend and top recipients like Relayer", () => {
  const result = aggregateAnalytics(
    [
      event("x402_payment", { amount: 5, recipient: "alice" }),
      event("x402_payment", { amount: 7, recipient: "bob" }),
      event("x402_payment", { amount: 3, recipient: "alice" }),
      event("llm_call", { amount: 1 }),
      event("llm_call", { amount: "2" }),
      event("agent_paused", null),
    ],
    "week",
    NOW,
  );
  assert.equal(result.totalEvents, 6);
  assert.equal(result.totalSpend, 16);
  assert.deepEqual(result.eventsByType, { x402_payment: 3, llm_call: 2, agent_paused: 1 });
  assert.deepEqual(result.topRecipients, [
    { recipient: "alice", total: 8, count: 2 },
    { recipient: "bob", total: 7, count: 1 },
  ]);
});

test("audit query parsing clamps and ignores unknown filters", () => {
  assert.deepEqual(parseAuditQuery({}, NOW), {
    page: 1,
    limit: 20,
    eventTypes: null,
    since: null,
    status: null,
  });
  const q = parseAuditQuery(
    { page: "-3", limit: "500", type: "lifecycle", period: "7d", status: "failed" },
    NOW,
  );
  assert.equal(q.page, 1);
  assert.equal(q.limit, 100);
  assert.deepEqual(q.eventTypes, [
    "agent_created",
    "agent_paused",
    "agent_resumed",
    "agent_killed",
  ]);
  assert.equal(q.since?.toISOString(), "2026-09-09T12:00:00.000Z");
  assert.equal(q.status, "failed");
  assert.deepEqual(
    parseAuditQuery({ type: "nope", period: "1y", status: "maybe", limit: "abc" }, NOW),
    { page: 1, limit: 20, eventTypes: null, since: null, status: null },
  );
});

test("queries isolate tenants and expose the kill switch", async () => {
  const agents = [agent("a1", "w1"), agent("a2", "w2", "killed"), agent("a3", "w1", "killed")];
  let since: Date | undefined;
  const queries = createAgentQueries({
    agents: {
      findById: async (id) => agents.find((a) => a.id === id) ?? null,
      listByWorkspace: async (ws) => agents.filter((a) => a.workspaceId === ws),
      findCredentials: async () => null,
    },
    events: {
      listSince: async (_id, s) => {
        since = s;
        return [event("llm_call", { amount: 2 })];
      },
      audit: async (_id, q) => ({ events: [], total: 0, page: q.page, limit: q.limit }),
    },
    now: () => NOW,
  });

  assert.deepEqual(
    (await queries.listAgents("w1")).map((a) => a.id),
    ["a1", "a3"],
  );
  await assert.rejects(queries.getAgent("w1", "a2"), AgentNotFoundError);
  await assert.rejects(queries.getStatus("w1", "missing"), AgentNotFoundError);
  assert.deepEqual(await queries.getStatus("w1", "a3"), {
    agentId: "a3",
    killSwitch: true,
    status: "killed",
  });
  const analytics = await queries.getAnalytics("w1", "a1", "bogus");
  assert.equal(analytics.period, "month");
  assert.equal(since?.toISOString(), "2026-08-17T12:00:00.000Z");
  assert.equal((await queries.getAudit("w1", "a1", { page: "2" })).page, 2);
  await assert.rejects(queries.getAudit("w2", "a1", {}), AgentNotFoundError);
});

// ── HMAC: signatures produced exactly like @relayerfi/agent-sdk HttpClient.buildAuthHeaders ──

const SECRET = "agent-secret-123";
function sdkSign(method: string, path: string, body: unknown, timestamp: number) {
  const bodyString = body ? JSON.stringify(body) : "";
  const bodyHash = createHash("sha256").update(bodyString).digest("hex");
  return createHmac("sha256", SECRET)
    .update(`${method}${path}${timestamp}${bodyHash}`)
    .digest("hex");
}

function authenticator(records: AgentCredentialRecord[]) {
  return createAuthenticateAgent({
    agents: {
      findById: async () => null,
      listByWorkspace: async () => [],
      findCredentials: async (id) => records.find((r) => r.id === id) ?? null,
    },
    decryptSecret: async (ciphertext) => {
      if (ciphertext !== "enc:ok") {
        throw new Error("bad ciphertext");
      }
      return SECRET;
    },
    sha256Hex: async (v) => createHash("sha256").update(v).digest("hex"),
    hmacSha256Hex: async (k, m) => createHmac("sha256", k).update(m).digest("hex"),
    now: () => NOW,
  });
}

const records: AgentCredentialRecord[] = [
  {
    id: "a1",
    workspaceId: "w1",
    walletId: "wal",
    status: "active",
    encryptedAgentSecret: "enc:ok",
  },
  {
    id: "dead",
    workspaceId: "w1",
    walletId: null,
    status: "killed",
    encryptedAgentSecret: "enc:ok",
  },
  {
    id: "broken",
    workspaceId: "w1",
    walletId: null,
    status: "active",
    encryptedAgentSecret: "enc:corrupt",
  },
];

test("SDK-signed requests authenticate as agent principals", async () => {
  const auth = authenticator(records);
  const ts = Math.floor(NOW.getTime() / 1000);
  const body = { events: [{ type: "llm_call", amount: 0.01 }] };
  const principal = await auth({
    agentId: "a1",
    signature: sdkSign("POST", "/v1/agents/events/batch", body, ts),
    timestamp: String(ts),
    method: "post",
    path: "/v1/agents/events/batch",
    // Whitespace differs from JSON.stringify; the server canonicalizes like Express did.
    body: JSON.stringify(body, null, 2),
  });
  assert.deepEqual(
    {
      kind: principal.kind,
      id: principal.id,
      tenantId: principal.tenantId,
      walletId: principal.walletId,
    },
    { kind: "agent", id: "a1", tenantId: "w1", walletId: "wal" },
  );

  const get = await auth({
    agentId: "a1",
    signature: sdkSign("GET", "/v1/agents/a1/status", undefined, ts - 30),
    timestamp: String(ts - 30),
    method: "GET",
    path: "/v1/agents/a1/status",
    body: "",
  });
  assert.equal(get.id, "a1");
});

test("HMAC failures: missing headers, clock skew, killed, unknown, bad secret, tampering", async () => {
  const auth = authenticator(records);
  const ts = Math.floor(NOW.getTime() / 1000);
  const base = { method: "GET", path: "/v1/agents/a1/status", body: "", timestamp: String(ts) };
  const sig = sdkSign("GET", "/v1/agents/a1/status", undefined, ts);
  const expectCode = async (request: Parameters<typeof auth>[0], code: string) => {
    await assert.rejects(
      auth(request),
      (error: unknown) => error instanceof AgentAuthenticationError && error.code === code,
    );
  };
  await expectCode({ ...base, agentId: "a1", signature: null }, "invalid_auth");
  await expectCode(
    { ...base, agentId: "a1", signature: sig, timestamp: String(ts - 61) },
    "expired_timestamp",
  );
  await expectCode(
    { ...base, agentId: "a1", signature: sig, timestamp: "soon" },
    "expired_timestamp",
  );
  await expectCode({ ...base, agentId: "dead", signature: sig }, "agent_killed");
  await expectCode({ ...base, agentId: "ghost", signature: sig }, "invalid_auth");
  await expectCode({ ...base, agentId: "broken", signature: sig }, "invalid_auth");
  await expectCode(
    { ...base, agentId: "a1", signature: sig, path: "/v1/agents/a2/status" },
    "invalid_auth",
  );
  await expectCode({ ...base, agentId: "a1", signature: "zz" + sig.slice(2) }, "invalid_auth");
  assert.equal((await auth({ ...base, agentId: "a1", signature: sig.toUpperCase() })).id, "a1");
});

test("canonical body matches Express parsing plus JSON.stringify", () => {
  assert.equal(canonicalBody(""), "");
  assert.equal(canonicalBody("{}"), "");
  assert.equal(canonicalBody("[]"), "");
  assert.equal(canonicalBody("not json"), "");
  assert.equal(canonicalBody('{ "b": 1, "a": [1, 2] }'), '{"b":1,"a":[1,2]}');
});
