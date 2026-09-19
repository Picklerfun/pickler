import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationRequiredError,
  buildApiKeyPrincipal,
  buildUserPrincipal,
  createProfileService,
  type Profile,
  type ProfileRepository,
} from "@pickler/core";
import { createApp } from "../src/app.js";

function app(principal: unknown) {
  const rows: Profile[] = [
    {
      userId: "taken-user",
      displayName: "Half",
      handle: "halftime",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
  ];
  const repo: ProfileRepository = {
    findByUserId: async (id) => rows.find((r) => r.userId === id) ?? null,
    isHandleTaken: async (h) => rows.some((r) => r.handle === h),
    create: async (input) => {
      if (rows.some((r) => r.handle === input.handle)) {
        return { created: false, reason: "handle_taken" };
      }
      const profile = { ...input, createdAt: new Date("2026-09-16T12:00:00Z") };
      rows.push(profile);
      return { created: true, profile };
    },
  };
  return createApp({
    authenticate: async (_c, options) => {
      if (!principal) {
        throw new AuthenticationRequiredError();
      }
      if (options?.userOnly && (principal as { kind: string }).kind !== "user") {
        throw new AuthenticationRequiredError("Bearer JWT required");
      }
      return { principal: principal as never, workspace: null };
    },
    authenticateAgent: async () => {
      throw new Error("unused");
    },
    findWorkspace: async () => null,
    agentQueries: {} as never,
    budgets: {} as never,
    profiles: createProfileService(repo),
  });
}

const env = {
  APP_ENV: "production",
  ALLOWED_ORIGINS: "https://pickler.fun,http://localhost:3000",
} as never;
const json = async (res: Response) =>
  (await res.json()) as { data: Record<string, unknown>; error?: string; reason?: string };

test("handle availability is public", async () => {
  const res = await app(null).request("/v1/handles/HalfTime/availability", {}, env);
  assert.equal(res.status, 200);
  assert.deepEqual((await json(res)).data, {
    handle: "halftime",
    available: false,
    reason: "taken",
  });
  assert.deepEqual(
    (await json(await app(null).request("/v1/handles/anarobles/availability", {}, env))).data,
    { handle: "anarobles", available: true },
  );
});

test("signed-in users create and read their own profile; API keys and anonymous callers cannot", async () => {
  const ana = buildUserPrincipal({ user: { id: "ana-user", email: "ana@x.io" } });
  const post = (p: unknown, body: unknown) =>
    app(p).request(
      "/v1/profile",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  const created = await post(ana, { display_name: "Ana Robles", handle: "@AnaRobles" });
  assert.equal(created.status, 201);
  assert.deepEqual((await json(created)).data, {
    user_id: "ana-user",
    display_name: "Ana Robles",
    handle: "anarobles",
    created_at: "2026-09-16T12:00:00.000Z",
  });

  const taken = await post(ana, { display_name: "Ana", handle: "halftime" });
  assert.equal(taken.status, 409);
  assert.equal((await json(taken)).error, "handle_taken");

  const invalid = await post(ana, { display_name: "Ana", handle: "admin" });
  assert.equal(invalid.status, 400);
  assert.equal((await json(invalid)).reason, "reserved");

  assert.equal((await post(ana, { display_name: 5 })).status, 400);
  assert.equal(
    (
      await post(buildApiKeyPrincipal({ id: "k", scopes: [] }, "w1"), {
        display_name: "Ana",
        handle: "anarobles",
      })
    ).status,
    401,
  );
  assert.equal((await post(null, { display_name: "Ana", handle: "anarobles" })).status, 401);
  assert.equal((await app(ana).request("/v1/profile", {}, env)).status, 404);
});

test("CORS allows configured origins only", async () => {
  const preflight = (origin: string) =>
    app(null).request(
      "/v1/profile",
      { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } },
      env,
    );
  assert.equal(
    (await preflight("https://pickler.fun")).headers.get("access-control-allow-origin"),
    "https://pickler.fun",
  );
  assert.equal(
    (await preflight("https://evil.example")).headers.get("access-control-allow-origin"),
    null,
  );
});
