import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { AccessDeniedError, AuthenticationRequiredError, type Principal } from "@pickler/core";
import {
  studioAccessRequestStatusSchema,
  studioAccessRequestsInboxSchema,
} from "@pickler/api-schema";
import { authenticated } from "../src/middleware/auth.js";
import { studioAccessRequestRoutes } from "../src/routes/studio-access-requests.js";
import type { AppEnv } from "../src/env.js";

const userId = "11111111-1111-4111-8111-111111111111";
function setup({ kind = "user", admin = false, pending = false } = {}) {
  const principal = { kind, id: userId, tenantId: null, isSuperAdmin: admin } as Principal;
  const at = new Date("2026-10-05T00:00:00Z");
  const repository = {
    read: async () => ({
      status: pending ? ("pending" as const) : ("not_requested" as const),
      requestedAt: pending ? at : null,
    }),
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
  app.route("/", studioAccessRequestRoutes(repository));
  const call = app.request.bind(app);
  app.request = ((path, init = {}) =>
    call(path, {
      ...init,
      headers: {
        Authorization: "Bearer controlled",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    })) as typeof app.request;
  return { app, anonymous: call };
}

test("a person reads their own status in the documented shape, and nothing else", async () => {
  const status = await setup().app.request("/access-request");
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "private, no-store");
  const parsed = studioAccessRequestStatusSchema.parse(await status.json());
  assert.equal(parsed.status, "not_requested");
  assert.equal(parsed.canReviewRequests, false);
  const recorded = studioAccessRequestStatusSchema.parse(
    await (await setup({ pending: true }).app.request("/access-request")).json(),
  );
  assert.equal(recorded.status, "pending");
  assert.equal(recorded.requestedAt, "2026-10-05T00:00:00.000Z");
});

test("requesting access was retired: the studio no longer takes a POST", async () => {
  const response = await setup().app.request("/access-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 404);
});

test("only verified operators can see the inbox", async () => {
  assert.equal((await setup().app.request("/access-requests")).status, 403);
  assert.equal((await setup({ kind: "apikey" }).app.request("/access-request")).status, 403);
  const response = await setup({ admin: true }).app.request("/access-requests");
  assert.equal(response.status, 200);
  assert.equal(studioAccessRequestsInboxSchema.parse(await response.json()).requests.length, 1);
});

test("missing JWT and API keys do not read a status", async () => {
  const f = setup();
  for (const headers of [{}, { "x-api-key": "not-a-user" }]) {
    assert.equal((await f.anonymous("/access-request", { headers })).status, 401);
  }
});

test("JWT-only Studio API reads access through real PostgreSQL without granting it", async (t) => {
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
      throw new Error("Reading access must not enqueue research");
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
  const state = await app.request("/access-request", {
    headers: { Authorization: "Bearer controlled-jwt" },
  });
  assert.equal(studioAccessRequestStatusSchema.parse(await state.json()).status, "not_requested");
  assert.equal((await directory.access(ownerId, null))!.enabled, false);
  assert.equal((await app.request("/access-request")).status, 401);
  assert.equal(
    (await app.request("/access-requests", { headers: { Authorization: "Bearer controlled-jwt" } }))
      .status,
    403,
  );
});
