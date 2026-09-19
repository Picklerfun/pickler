import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserPrincipal,
  createAgentQueries,
  type RegisteredAgent,
  type Workspace,
} from "@pickler/core";
import { createApp } from "../src/app.js";

const A1 = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-16T12:00:00Z");
const workspace: Workspace = {
  id: "w1",
  name: "w",
  userId: "ana",
  isActive: true,
  activeModules: ["agent"],
};
const agent = (id: string, ws: string): RegisteredAgent => ({
  id,
  workspaceId: ws,
  name: id,
  description: null,
  status: "active",
  walletId: null,
  walletAddress: null,
  chainId: null,
  thresholdUsd: "0",
  killedAt: null,
  turnkeyUserId: null,
  turnkeyAgentUserId: null,
  turnkeyPolicyId: null,
  activePolicyId: null,
  createdAt: NOW,
  updatedAt: null,
});

test("GET /v1/agents/:id/budget returns Relayer's budget shape and never opens other tenants' ledgers", async () => {
  const opened: string[] = [];
  const agents = [agent(A1, "w1"), agent(OTHER, "w2")];
  const app = createApp({
    authenticate: async () => ({
      principal: buildUserPrincipal({
        user: { id: "ana" },
        integrator: workspace,
        memberRole: "admin",
      }),
      workspace,
    }),
    authenticateAgent: async () => {
      throw new Error("unused");
    },
    findWorkspace: async () => workspace,
    agentQueries: createAgentQueries({
      agents: {
        findById: async (id) => agents.find((a) => a.id === id) ?? null,
        listByWorkspace: async () => [],
        findCredentials: async () => null,
      },
      events: {
        listSince: async () => [],
        audit: async () => ({ events: [], total: 0, page: 1, limit: 20 }),
      },
      now: () => NOW,
    }),
    profiles: {} as never,
    budgets: {
      snapshot: async (agentId) => {
        opened.push(agentId);
        return {
          status: "active",
          categories: [
            {
              category: "payments",
              limit: 100_000_000n,
              spent: 25_000_000n,
              reserved: 5_000_000n,
              remaining: 70_000_000n,
              usagePct: 25,
              status: "ok",
              periodStart: new Date("2026-09-01T00:00:00Z"),
              periodEnd: new Date("2026-10-01T00:00:00Z"),
            },
          ],
        };
      },
    },
  });

  const res = await app.request(`/v1/agents/${A1}/budget`, {}, { APP_ENV: "production" } as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown };
  assert.deepEqual(body.data, {
    agent_id: A1,
    categories: [
      {
        category: "payments",
        limit: "100000000",
        spent: "25000000",
        reserved: "5000000",
        remaining: "70000000",
        usage_pct: 25,
        period_start: "2026-09-01T00:00:00.000Z",
        period_end: "2026-10-01T00:00:00.000Z",
        status: "ok",
      },
    ],
  });

  assert.equal(
    (await app.request(`/v1/agents/${OTHER}/budget`, {}, { APP_ENV: "production" } as never))
      .status,
    404,
  );
  assert.deepEqual(opened, [A1]);
});
