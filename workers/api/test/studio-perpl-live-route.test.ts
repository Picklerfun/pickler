import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  buildUserPrincipal,
  createStudioAccess,
  AccessDeniedError,
  type StudioDirectory,
} from "@pickler/core";
import { studioPerplLiveRoutes } from "../src/routes/studio-perpl-live.js";
import type { AppEnv } from "../src/env.js";

test("owner-only Perpl routes preserve JWT, strict inputs and no-store", async () => {
  const owner = randomUUID();
  const agent = randomUUID();
  const other = randomUUID();
  const principal = buildUserPrincipal({
    user: { id: owner },
    integrator: { id: randomUUID() },
    memberRole: "admin",
  });
  const directory = {
    async access(userId: string) {
      return {
        ownerUserId: owner,
        role: "admin",
        enabled: true,
        workspaceId: "workspace",
        tenantId: "tenant",
        userId,
      };
    },
    async agentScope(_access: unknown, id: string) {
      if (id !== agent) {
        throw new AccessDeniedError("No access");
      }
      return { tenantId: "tenant", agentId: "runtime" };
    },
  } as unknown as StudioDirectory;
  let calls = 0;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set(
      "principal",
      c.req.header("Authorization") === "Bearer owner" ? principal : { ...principal, id: other },
    );
    await next();
  });
  app.route(
    "/",
    studioPerplLiveRoutes({
      directory,
      access: createStudioAccess(directory),
      service: {
        async invoke(_path, _body, authorization) {
          calls++;
          assert.equal(authorization, "Bearer owner");
          return Response.json({ error: "PERPL_ADMISSIONS_PAUSED" }, { status: 409 });
        },
      },
    }),
  );
  const path = `/agents/${agent}/perpl/start`;
  const headers = {
    Authorization: "Bearer owner",
    "Content-Type": "application/json",
    "Idempotency-Key": randomUUID(),
  };
  const input = { symbol: "BTC", marginAusd: "5", leverage: 1, cycles: 1, holdSeconds: 60 };
  app.onError((error, c) =>
    c.json({ error: error instanceof AccessDeniedError ? "FORBIDDEN" : "INVALID_INPUT" }, 400),
  );
  const valid = await app.request(path, { method: "POST", headers, body: JSON.stringify(input) });
  assert.equal(valid.status, 409);
  assert.match(valid.headers.get("Cache-Control")!, /private.*no-store/);
  assert.equal(calls, 1);
  const connection = await app.request(`/agents/${agent}/perpl/credentials/connect`, {
    method: "POST",
    headers,
    body: JSON.stringify({ apiKey: "controlled-existing-token", privateKeyHex: "07".repeat(32) }),
  });
  assert.equal(connection.status, 409);
  assert.equal(calls, 2);
  assert.equal((await connection.text()).includes("controlled-existing-token"), false);
  const extraConnection = await app.request(`/agents/${agent}/perpl/credentials/connect`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      apiKey: "controlled-existing-token",
      privateKeyHex: "07".repeat(32),
      address: "0x" + "11".repeat(20),
    }),
  });
  assert.equal(extraConnection.status, 400);
  assert.equal(calls, 2);
  const extra = await app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, address: "0x" + "11".repeat(20) }),
  });
  assert.equal(extra.status, 400);
  assert.equal(calls, 2);
  await app.request(path, {
    method: "POST",
    headers: { ...headers, Authorization: "Bearer other" },
    body: JSON.stringify(input),
  });
  assert.equal(calls, 2);
});
