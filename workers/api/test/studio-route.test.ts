import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  buildApiKeyPrincipal,
  DEFAULT_CONFIG,
  PilotError,
  type StudioDirectory,
  type ResearchRepository,
} from "@pickler/core";
import { studioRoutes } from "../src/routes/studio.js";

function fixture({ enabled = true, owner = true, key = false } = {}) {
  let calls = 0;
  const directory: StudioDirectory = {
    onboard: async () => {},
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: owner ? "user" : "other",
      role: "auditor",
      enabled,
    }),
    createAgent: async () => {
      calls++;
      return { tenantId: "trusted", agentId: "agent" };
    },
    agentScope: async (_access, id) => {
      if (id !== "agent") {
        throw new PilotError("NOT_FOUND", "Missing");
      }
      return { tenantId: "trusted", agentId: "agent" };
    },
    list: async () => [],
    runs: async () => [],
  };
  const repository = {
    enqueue: async (scope: unknown) => {
      calls++;
      assert.deepEqual(scope, { tenantId: "trusted", agentId: "agent" });
      return { id: "run", status: "queued" };
    },
  } as unknown as ResearchRepository;
  const app = studioRoutes({
    directory,
    repository,
    paper: {
      create: async () => {
        throw new Error("Not used");
      },
      get: async () => {
        throw new Error("Not used");
      },
      settle: async (tenantId, runId) => {
        calls++;
        assert.equal(tenantId, "trusted");
        if (runId !== "run") {
          throw new PilotError("NOT_FOUND", "Missing");
        }
        return {
          id: "paper",
          tenantId,
          agentId: "agent",
          runId,
          marketId: "1",
          outcomeId: "2",
          status: "filled",
          virtualBudget: "10",
          createdAt: 1,
          finishedAt: 2,
          reason: null,
          fill: null,
          settlement: null,
        };
      },
      summary: async (scope) => {
        calls++;
        assert.deepEqual(scope, { tenantId: "trusted", agentId: "agent" });
        return {
          filled: 0,
          open: 0,
          settled: 0,
          totalCost: "0",
          openCost: "0",
          payouts: "0",
          realizedPnl: "0",
          netCashFlow: "0",
        };
      },
    },
    trading: {
      repository: {} as import("@pickler/core").TradingRepository,
      admissionsEnabled: true,
      notify: async () => {},
      invoke: async (_path, input) => {
        calls++;
        assert.equal((input as { scope: { tenantId: string } }).scope.tenantId, "trusted");
        return Response.json({ ok: true });
      },
    },
    notifyQueued: async () => {},
    wallets: { findAgentWallet: async () => null },
    balances: {
      read: async () => {
        throw new Error("no balance read expected");
      },
    },
    authenticate: async (_credentials, options) => {
      if (key && options?.userOnly) {
        throw new AuthenticationRequiredError();
      }
      return {
        principal: key
          ? buildApiKeyPrincipal({ id: "key", scopes: ["read:agents"] }, "workspace")
          : buildUserPrincipal({
              user: { id: "user" },
              integrator: { id: "workspace" },
              memberRole: "auditor",
            }),
        workspace: null,
      };
    },
  });
  return { app, calls: () => calls };
}
const request = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": "request" },
  body: JSON.stringify(body),
});
test("studio rejects API keys, disabled owners and read-only members before admission", async () => {
  for (const mode of [{ key: true }, { enabled: false }, { owner: false }]) {
    const { app, calls } = fixture(mode);
    const response = await app.request("/agents/agent/runs", request({}));
    assert.equal(response.status, mode.key ? 401 : 403);
    assert.equal(calls(), 0);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
});
test("invalid shared-schema input returns 400 and cannot set tenant authority", async () => {
  const { app, calls } = fixture();
  const invalid = await app.request("/agents/agent/runs", request({ tenantId: "victim" }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "INVALID_INPUT" });
  assert.equal(calls(), 0);
  const valid = await app.request("/agents/agent/runs", request({}));
  assert.equal(valid.status, 202);
  assert.deepEqual(await valid.json(), { runId: "run", status: "queued" });
});
test("new agent configuration cannot omit category and subcategories", async () => {
  const { app, calls } = fixture();
  const profile = {
    accent: "lime",
    blurb: "",
    venue: "predictions",
    vibe: "",
    voice: "",
    decides: "",
    wrong: "",
    xHandle: null,
  };
  const response = await app.request(
    "/agents",
    request({ name: "New", handle: "new_agent", config: DEFAULT_CONFIG, profile }),
  );
  assert.equal(response.status, 400);
  assert.equal(calls(), 0);
});
test("a client-sent policyIds is refused before anything is created; the server is the only source of approved policies", async () => {
  const { app, calls } = fixture();
  const config = { ...DEFAULT_CONFIG };
  delete config.categoryIds;
  Object.assign(config, {
    marketScope: { version: 1, category: "sports", subcategories: ["soccer"] },
  });
  const profile = {
    accent: "lime",
    blurb: "",
    venue: "predictions",
    vibe: "",
    voice: "",
    decides: "",
    wrong: "",
    xHandle: null,
  };
  const response = await app.request(
    "/agents",
    request({
      name: "New",
      handle: "new_agent",
      config,
      profile,
      wallet: { walletId: "wallet-1", policyIds: ["p1", "p2"] },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(calls(), 0);
});

test("trading requires a user owner and rejects tenant or credential injection before the executor", async () => {
  for (const mode of [{ key: true }, { enabled: false }, { owner: false }]) {
    const { app, calls } = fixture(mode);
    const response = await app.request("/agents/agent/trading/check", request({}));
    assert.equal(response.status, mode.key ? 401 : 403);
    assert.equal(calls(), 0);
  }
  const { app, calls } = fixture();
  for (const body of [{ tenantId: "victim" }, { privateKey: "secret" }]) {
    assert.equal((await app.request("/agents/agent/trading/check", request(body))).status, 400);
  }
  assert.equal((await app.request("/agents/other/trading/check", request({}))).status, 404);
  assert.equal(calls(), 0);
  assert.equal((await app.request("/agents/agent/trading/check", request({}))).status, 200);
  assert.equal(calls(), 1);
});

test("paper settlement is owner-only, accepts no authority overrides, and summary resolves mapped scope", async () => {
  for (const mode of [{ key: true }, { enabled: false }, { owner: false }]) {
    const { app, calls } = fixture(mode);
    assert.equal(
      (await app.request("/runs/run/paper-order/settle", request({}))).status,
      mode.key ? 401 : 403,
    );
    assert.equal(calls(), 0);
  }
  const { app, calls } = fixture();
  assert.equal(
    (await app.request("/runs/run/paper-order/settle", request({ numerator: "1" }))).status,
    400,
  );
  assert.equal(calls(), 0);
  assert.equal((await app.request("/runs/run/paper-order/settle", request({}))).status, 200);
  assert.equal((await app.request("/runs/other/paper-order/settle", request({}))).status, 404);
  assert.equal((await app.request("/agents/agent/paper-summary")).status, 200);
  assert.equal((await app.request("/agents/other/paper-summary")).status, 404);
});
