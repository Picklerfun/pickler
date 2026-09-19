import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  AuthenticationRequiredError,
  buildApiKeyPrincipal,
  buildUserPrincipal,
  createAgentQueries,
  createAuthenticateAgent,
  type AgentEvent,
  type RegisteredAgent,
  type Workspace,
} from "@pickler/core";
import { createApp } from "../src/app.js";

const NOW = new Date("2026-09-16T12:00:00Z");
const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SECRET = "agent-secret";

const workspace: Workspace = {
  id: "w1",
  name: "Ana Labs",
  userId: "ana",
  isActive: true,
  activeModules: ["agent"],
};
const agent = (id: string, ws = "w1"): RegisteredAgent => ({
  id,
  workspaceId: ws,
  name: `agent-${id.slice(0, 2)}`,
  description: null,
  status: "active",
  walletId: null,
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
const agents = [agent(A1), agent(A2), agent(OTHER, "w2")];
const events: AgentEvent[] = [
  {
    id: "e1",
    agentId: A1,
    workspaceId: "w1",
    eventType: "llm_call",
    skillId: null,
    payload: { amount: 3, recipient: "anthropic" },
    createdAt: NOW,
  },
];

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const hmac = (k: string, m: string) => createHmac("sha256", k).update(m).digest("hex");

function app(principal: unknown = null) {
  const registry = {
    findById: async (id: string) => agents.find((a) => a.id === id) ?? null,
    listByWorkspace: async (ws: string) => agents.filter((a) => a.workspaceId === ws),
    findCredentials: async (id: string) => {
      const a = agents.find((x) => x.id === id);
      return a
        ? {
            id: a.id,
            workspaceId: a.workspaceId,
            walletId: a.walletId,
            status: a.status,
            encryptedAgentSecret: "enc",
          }
        : null;
    },
  };
  return createApp({
    authenticate: async () => {
      if (!principal) {
        throw new AuthenticationRequiredError();
      }
      return { principal: principal as never, workspace };
    },
    authenticateAgent: createAuthenticateAgent({
      agents: registry,
      decryptSecret: async () => SECRET,
      sha256Hex: async (v) => sha(v),
      hmacSha256Hex: async (k, m) => hmac(k, m),
      now: () => NOW,
    }),
    findWorkspace: async (id) => (id === "w1" ? workspace : null),
    budgets: {} as never,
    profiles: {} as never,
    agentQueries: createAgentQueries({
      agents: registry,
      events: {
        listSince: async (id) => events.filter((e) => e.agentId === id),
        audit: async (id, q) => ({
          events: events.filter((e) => e.agentId === id),
          total: 1,
          page: q.page,
          limit: q.limit,
        }),
      },
      now: () => NOW,
    }),
  });
}

/** Headers exactly as @relayerfi/agent-sdk HttpClient.buildAuthHeaders builds them. */
function sdkHeaders(agentId: string, method: string, path: string) {
  const timestamp = Math.floor(NOW.getTime() / 1000).toString();
  return {
    "x-agent-id": agentId,
    "x-agent-auth": hmac(SECRET, `${method}${path}${timestamp}${sha("")}`),
    "x-request-timestamp": timestamp,
    "X-SDK-Version": "1.0.0",
  };
}

const env = { APP_ENV: "production" } as never;
const json = async (res: Response) =>
  (await res.json()) as { success: boolean; message: string; data: never; error?: string };

test("the agent SDK reads its own status; other agents' ids are forbidden", async () => {
  const own = await app().request(
    `/v1/agents/${A1}/status`,
    { headers: sdkHeaders(A1, "GET", `/v1/agents/${A1}/status`) },
    env,
  );
  assert.equal(own.status, 200);
  assert.deepEqual((await json(own)).data, { agentId: A1, killSwitch: false, status: "active" });

  const other = await app().request(
    `/v1/agents/${A2}/status`,
    { headers: sdkHeaders(A1, "GET", `/v1/agents/${A2}/status`) },
    env,
  );
  assert.equal(other.status, 403);

  const replayed = await app().request(
    `/v1/agents/${A1}/analytics`,
    { headers: sdkHeaders(A1, "GET", `/v1/agents/${A1}/status`) },
    env,
  );
  assert.equal(replayed.status, 401);
  assert.equal((await json(replayed)).error, "invalid_auth");
});

test("dashboard reads use Relayer's snake_case shapes", async () => {
  const admin = buildUserPrincipal({
    user: { id: "ana" },
    integrator: workspace,
    memberRole: "admin",
  });
  const list = await json(await app(admin).request("/v1/agents", {}, env));
  assert.deepEqual(
    (list.data as { id: string }[]).map((a) => a.id),
    [A1, A2],
  );
  assert.equal((list.data as Record<string, unknown>[])[0]!.integrator_id, "w1");
  assert.equal("encrypted_agent_secret" in (list.data as Record<string, unknown>[])[0]!, false);

  const analytics = await json(
    await app(admin).request(`/v1/agents/${A1}/analytics?period=week`, {}, env),
  );
  assert.deepEqual(analytics.data, {
    total_events: 1,
    total_spend: 3,
    events_by_type: { llm_call: 1 },
    top_recipients: [{ recipient: "anthropic", total: 3, count: 1 }],
    period: "week",
    period_start: "2026-09-09T12:00:00.000Z",
  });

  const audit = await json(
    await app(admin).request(`/v1/agents/${A1}/audit?page=1&limit=5`, {}, env),
  );
  assert.equal((audit.data as { limit: number }).limit, 5);
  assert.equal(
    (audit.data as { events: { event_type: string }[] }).events[0]!.event_type,
    "llm_call",
  );
});

test("tenant isolation, viewer denial and unauthenticated access", async () => {
  const admin = buildUserPrincipal({
    user: { id: "ana" },
    integrator: workspace,
    memberRole: "admin",
  });
  assert.equal((await app(admin).request(`/v1/agents/${OTHER}`, {}, env)).status, 404);
  assert.equal((await app(admin).request(`/v1/agents/${OTHER}/status`, {}, env)).status, 404);

  const viewer = buildUserPrincipal({
    user: { id: "v" },
    integrator: workspace,
    memberRole: "viewer",
  });
  assert.equal((await app(viewer).request(`/v1/agents/${A1}/status`, {}, env)).status, 403);
  assert.equal((await app(viewer).request("/v1/agents", {}, env)).status, 403);

  const key = buildApiKeyPrincipal({ id: "k", scopes: ["read:agents"] }, "w1");
  assert.equal((await app(key).request(`/v1/agents/${A1}`, {}, env)).status, 200);

  assert.equal((await app().request("/v1/agents", {}, env)).status, 401);
});

test("unrelated and legacy broad API scopes cannot read any agent route", async () => {
  for (const scopes of [[], ["read:wallets"], ["integrator"], ["internal"], ["admin"]]) {
    const key = buildApiKeyPrincipal({ id: "k", scopes }, "w1");
    for (const suffix of [
      "",
      `/${A1}`,
      `/${A1}/status`,
      `/${A1}/analytics`,
      `/${A1}/budget`,
      `/${A1}/audit`,
    ]) {
      assert.equal((await app(key).request(`/v1/agents${suffix}`, {}, env)).status, 403);
    }
  }
});
