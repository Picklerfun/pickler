import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AccessDeniedError,
  AuthenticationRequiredError,
  buildApiKeyPrincipal,
  buildUserPrincipal,
  DataSourceUnavailableError,
  type RequestCredentials,
} from "@pickler/core";
import { createApp } from "../src/app.js";
import { requireModule, requirePermission, authenticated } from "../src/middleware/auth.js";

const workspace = {
  id: "w1",
  name: "Ana Labs",
  userId: "ana",
  isActive: true,
  activeModules: ["agent"],
};
const env = { APP_ENV: "production" } as never;

function appWith(
  authenticate: (
    c: RequestCredentials,
    o?: { userOnly?: boolean },
  ) => Promise<never | { principal: never; workspace: typeof workspace | null }>,
) {
  return createApp({
    authenticate: authenticate as never,
    authenticateAgent: (async () => {
      throw new Error("unused");
    }) as never,
    findWorkspace: async () => null,
    agentQueries: {} as never,
    budgets: {} as never,
    profiles: {} as never,
  });
}

test("health responds with Relayer's envelope and a request id", async () => {
  const res = await appWith(async () => {
    throw new Error("unused");
  }).request("/health", {}, env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.success, true);
  assert.deepEqual(body.data, { status: "ok" });
  assert.equal(body.path, "/health");
  assert.match(res.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

test("/v1/auth/me passes credentials, requires a user and returns the caller", async () => {
  let seen: { c: RequestCredentials; o?: { userOnly?: boolean } } | undefined;
  const app = appWith(async (c, o) => {
    seen = { c, o };
    return {
      principal: buildUserPrincipal({
        user: { id: "carl", email: "carl@x.io" },
        integrator: workspace,
        memberRole: "manager",
      }) as never,
      workspace,
    };
  });
  const res = await app.request(
    "/v1/auth/me",
    {
      headers: {
        Authorization: "Bearer tkn",
        "X-Integrator-Id": " w1 ",
        "CF-Connecting-IP": "1.2.3.4",
      },
    },
    env,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, {
    c: { bearerToken: "tkn", apiKey: null, selectedWorkspaceId: "w1", clientIp: "1.2.3.4" },
    o: { userOnly: true },
  });
  const body = (await res.json()) as { data: unknown };
  assert.deepEqual(body.data, {
    user: { id: "carl", email: "carl@x.io" },
    workspace: { id: "w1", name: "Ana Labs", activeModules: ["agent"] },
    role: "manager",
  });
});

test("business errors map to statuses; internals are hidden in production", async () => {
  const cases: [unknown, number, string][] = [
    [new AuthenticationRequiredError(), 401, "Valid Bearer token or API key required"],
    [
      new AccessDeniedError("Not a member of the requested workspace"),
      403,
      "Not a member of the requested workspace",
    ],
    [new DataSourceUnavailableError("supabase.x"), 503, "Service temporarily unavailable"],
    [new Error("secret stack detail"), 500, "Internal server error"],
  ];
  const original = console.error;
  console.error = () => {};
  try {
    for (const [error, status, message] of cases) {
      const res = await appWith(async () => {
        throw error;
      }).request("/v1/auth/me", {}, env);
      assert.equal(res.status, status);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.success, false);
      assert.equal(body.message, message);
      assert.equal(typeof body.traceId, "string");
    }
  } finally {
    console.error = original;
  }
});

test("module and permission middleware deny management to read-only keys", async () => {
  const { Hono } = await import("hono");
  const { handleError } = await import("../src/http/error-handler.ts");
  const make = (principal: unknown, ws: typeof workspace | null) => {
    const app = new Hono();
    app.onError(handleError as never);
    const auth = authenticated((async () => ({ principal, workspace: ws })) as never);
    app.get(
      "/agents",
      auth as never,
      requireModule("agent") as never,
      requirePermission("manage", "Agent") as never,
      (c) => c.text("ok"),
    );
    return app;
  };
  const admin = buildUserPrincipal({
    user: { id: "ana" },
    integrator: workspace,
    memberRole: "admin",
  });
  assert.equal((await make(admin, workspace).request("/agents", {}, env)).status, 200);
  assert.equal(
    (await make(admin, { ...workspace, activeModules: [] }).request("/agents", {}, env)).status,
    403,
  );
  const viewer = buildUserPrincipal({
    user: { id: "v" },
    integrator: workspace,
    memberRole: "viewer",
  });
  assert.equal((await make(viewer, workspace).request("/agents", {}, env)).status, 403);
  const key = buildApiKeyPrincipal({ id: "k", scopes: ["read:agents"] }, "w1");
  assert.equal((await make(key, workspace).request("/agents", {}, env)).status, 403);
});
