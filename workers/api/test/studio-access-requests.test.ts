import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import {
  AccessDeniedError,
  AuthenticationRequiredError,
  type Principal,
  type StudioDirectory,
} from "@pickler/core";
import {
  studioAccessRequestStatusSchema,
  studioAccessRequestsInboxSchema,
} from "@pickler/api-schema";
import { authenticated } from "../src/middleware/auth.js";
import { studioAccessRequestRoutes } from "../src/routes/studio-access-requests.js";
import type { AppEnv } from "../src/env.js";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
function setup({ kind = "user", admin = false, owner = true } = {}) {
  const principal = { kind, id: userId, tenantId: null, isSuperAdmin: admin } as Principal;
  let writes = 0;
  const at = new Date("2026-10-05T00:00:00Z");
  const directory = {
    access: async () => ({
      workspaceId,
      tenantId: workspaceId,
      ownerUserId: owner ? userId : "someone-else",
      role: "admin",
      enabled: false,
    }),
  } as unknown as StudioDirectory;
  const repository = {
    read: async () => ({
      status: writes ? ("pending" as const) : ("not_requested" as const),
      requestedAt: writes ? at : null,
    }),
    request: async (user: string, workspace: string) => {
      assert.equal(user, userId);
      assert.equal(workspace, workspaceId);
      writes = 1;
      return { status: "pending" as const, requestedAt: at };
    },
    pending: async () => [{ userId, handle: "creator", displayName: "Creator", requestedAt: at }],
  };
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    authenticated(
      async (credentials) => {
        if (!credentials.bearerToken) {
          throw new AuthenticationRequiredError();
        }
        return { principal, workspace: null };
      },
      { userOnly: true },
    ),
  );
  app.onError((error, c) => {
    if (error instanceof AuthenticationRequiredError) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    return c.json(
      { error: error instanceof AccessDeniedError ? "FORBIDDEN" : "BAD_REQUEST" },
      error instanceof AccessDeniedError ? 403 : 400,
    );
  });
  app.route("/", studioAccessRequestRoutes(directory, repository));
  const call = app.request.bind(app);
  app.request = ((path, init = {}) =>
    call(path, {
      ...init,
      headers: {
        Authorization: "Bearer controlled",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    })) as typeof app.request;
  return { app, anonymous: call, writes: () => writes };
}

test("owner requests use server identity, survive repeats and match documented schemas", async () => {
  const f = setup();
  const request = () =>
    f.app.request("/access-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  assert.equal(f.writes(), 1);
  const status = await f.app.request("/access-request");
  assert.equal(status.headers.get("cache-control"), "private, no-store");
  assert.equal(studioAccessRequestStatusSchema.parse(await status.json()).status, "pending");
  const spoofed = await f.app.request("/access-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: workspaceId }),
  });
  assert.equal(spoofed.status, 400);
});

test("only verified operators can see the inbox; non-users and non-owners cannot request", async () => {
  assert.equal((await setup().app.request("/access-requests")).status, 403);
  const response = await setup({ admin: true }).app.request("/access-requests");
  assert.equal(response.status, 200);
  assert.equal(studioAccessRequestsInboxSchema.parse(await response.json()).requests.length, 1);
  for (const options of [{ kind: "apikey" }, { kind: "agent" }, { owner: false }]) {
    const f = setup(options);
    assert.equal(
      (
        await f.app.request("/access-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(f.writes(), 0);
  }
});

test("missing JWT and API keys do not admit a request", async () => {
  const f = setup();
  for (const headers of [{}, { "x-api-key": "not-a-user" }]) {
    const response = await f.anonymous("/access-request", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401);
  }
  assert.equal(f.writes(), 0);
});

test("JWT-only Studio API persists requests through real PostgreSQL without granting access", async (t) => {
  const { createTestStore } = await import("@pickler/infrastructure/testing");
  const { PostgresStudioDirectory, PostgresStudioAccessRequests } =
    await import("@pickler/infrastructure");
  const { buildUserPrincipal } = await import("@pickler/core");
  const { studioRoutes } = await import("../src/routes/studio.js");
  const { randomUUID } = await import("node:crypto");
  const store = await createTestStore(t);
  const directory = new PostgresStudioDirectory(store.pool);
  const ownerId = randomUUID();
  if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
    await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [ownerId]);
  }
  await store.pool.query("SELECT identity.create_profile($1, 'Creator', 'api_requester')", [
    ownerId,
  ]);
  await directory.onboard(ownerId);
  const app = studioRoutes({
    directory,
    repository: store,
    accessRequests: new PostgresStudioAccessRequests(store.pool),
    notifyQueued: async () => {
      throw new Error("Access requests must not enqueue research");
    },
    authenticate: async (credentials) => {
      if (credentials.bearerToken !== "controlled-jwt") {
        throw new AuthenticationRequiredError();
      }
      return {
        principal: buildUserPrincipal({ user: { id: ownerId }, memberRole: "admin" }),
        workspace: null,
      };
    },
  });
  const request = () =>
    app.request("/access-request", {
      method: "POST",
      headers: { Authorization: "Bearer controlled-jwt", "Content-Type": "application/json" },
      body: "{}",
    });
  const responses = await Promise.all([request(), request()]);
  assert.ok(responses.every((response) => response.status === 200));
  const rows = await store.pool.query("SELECT * FROM pickler.studio_access_requests");
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].user_id, ownerId);
  assert.equal((await directory.access(ownerId, null))!.enabled, false);
  const state = await app.request("/access-request", {
    headers: { Authorization: "Bearer controlled-jwt" },
  });
  assert.equal(studioAccessRequestStatusSchema.parse(await state.json()).status, "pending");
  assert.equal((await app.request("/access-request")).status, 401);
  assert.equal(
    (await app.request("/access-requests", { headers: { Authorization: "Bearer controlled-jwt" } }))
      .status,
    403,
  );
});
