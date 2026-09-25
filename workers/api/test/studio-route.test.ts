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
    createdWithKey: async () => null,
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
