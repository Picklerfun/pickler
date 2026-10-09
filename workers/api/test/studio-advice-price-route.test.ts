import test from "node:test";
import assert from "node:assert/strict";
import { buildUserPrincipal, PilotError, type StudioDirectory } from "@pickler/core";
import { studioRoutes } from "../src/routes/studio.js";

const AGENT = "11111111-1111-4111-8111-111111111111";

function fixture(over: { userId?: string; fail?: PilotError } = {}) {
  const calls: { userId: string; agentId: string; micro: bigint | null }[] = [];
  const directory = {
    onboard: async () => {},
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "owner",
      role: "admin",
      enabled: true,
    }),
    setAdvicePrice: async (userId: string, agentId: string, micro: bigint | null) => {
      if (over.fail) {
        throw over.fail;
      }
      calls.push({ userId, agentId, micro });
      return micro;
    },
  } as unknown as StudioDirectory;
  const app = studioRoutes({
    directory,
    repository: {} as never,
    notifyQueued: async () => {},
    authenticate: async () => ({
      principal: buildUserPrincipal({
        user: { id: over.userId ?? "owner" },
        integrator: { id: "workspace" },
        memberRole: "admin",
      }),
      workspace: null,
    }),
  });
  return { app, calls };
}

const put = (body: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const url = `/agents/${AGENT}/advice-price`;

test("the owner sets the price and the directory gets micro-AUSD", async () => {
  const { app, calls } = fixture();
  const response = await app.request(url, put({ priceAusd: "1.5" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    advicePrice: { amount: "1.5", asset: "AUSD", decimals: 6 },
  });
  assert.deepEqual(calls, [{ userId: "owner", agentId: AGENT, micro: 1500000n }]);
});

test("a null price clears it", async () => {
  const { app, calls } = fixture();
  const response = await app.request(url, put({ priceAusd: null }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { advicePrice: null });
  assert.equal(calls[0]!.micro, null);
});

test("a price below the minimum or a malformed body is a 400", async () => {
  const { app, calls } = fixture();
  assert.equal((await app.request(url, put({ priceAusd: "0.05" }))).status, 400);
  assert.equal((await app.request(url, put({ priceAusd: 1.5 }))).status, 400);
  assert.equal((await app.request(url, put({}))).status, 400);
  assert.deepEqual(calls, []);
});

test("a non-owner is refused like the limits are", async () => {
  const { app, calls } = fixture({ userId: "someone-else" });
  const response = await app.request(url, put({ priceAusd: "1.5" }));
  assert.equal(response.status, 403);
  assert.deepEqual(calls, []);
});

test("an agent without a wallet answers 409 AGENT_WALLET_REQUIRED", async () => {
  const { app } = fixture({ fail: new PilotError("CONFLICT", "AGENT_WALLET_REQUIRED") });
  const response = await app.request(url, put({ priceAusd: "1.5" }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, "AGENT_WALLET_REQUIRED");
});

test("an agent that is not the caller's answers 404", async () => {
  const { app } = fixture({ fail: new PilotError("NOT_FOUND", "Agent not found") });
  assert.equal((await app.request(url, put({ priceAusd: "1.5" }))).status, 404);
});
