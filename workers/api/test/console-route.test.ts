import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  buildApiKeyPrincipal,
  DEFAULT_CONFIG,
  PilotError,
  type ConsoleDirectory,
  type ResearchRepository,
} from "@pickler/core";
import { consoleRoutes } from "../src/routes/console.js";

function fixture({ enabled = true, owner = true, key = false } = {}) {
  let calls = 0;
  const directory: ConsoleDirectory = {
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
  const app = consoleRoutes({
    directory,
    repository,
    notifyQueued: async () => {},
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
test("console rejects API keys, disabled owners and read-only members before admission", async () => {
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
  const response = await app.request(
    "/agents",
    request({ name: "New", handle: "new_agent", config: DEFAULT_CONFIG }),
  );
  assert.equal(response.status, 400);
  assert.equal(calls(), 0);
});
