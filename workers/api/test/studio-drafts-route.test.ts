import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  DEFAULT_CONFIG,
  PilotError,
  buildUserPrincipal,
  preparePreview,
  type AgentRecord,
  type ResearchRepository,
  type StudioDirectory,
} from "@pickler/core";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";

const RUN = "0000000a-0000-4000-8000-000000000000";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const FUNDED = "44444444-4444-4444-8444-444444444444";
const request = {
  brief: {
    thesis: "Injury news moves the books first.",
    reads: ["espn.com"],
    entersWhen: ["A starter is ruled out"],
    exitsWhen: [],
    never: [],
  },
  spend: { perCallAusd: 5, perDayAusd: 20 },
  maxLeverage: 2,
};
const body = { ...request, name: "Halftime", handle: "halftime", previewRunId: RUN };

function app({
  listed = [] as { id: string; draft: boolean; wallet: boolean }[],
  refuse,
}: {
  listed?: { id: string; draft: boolean; wallet: boolean }[];
  refuse?: string;
} = {}) {
  const drafts: { handle: string; fingerprint: string }[] = [];
  const config = { ...DEFAULT_CONFIG };
  const record = (id: string): AgentRecord => ({
    id,
    tenantId: "trusted",
    version: 1,
    config,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  });
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "user",
      role: "admin",
      enabled: true,
    }),
    list: async () =>
      listed.map((agent) => ({
        id: agent.id,
        name: "Agent",
        handle: "agent",
        accent: "lime" as const,
        draft: agent.draft,
        scope: { tenantId: "trusted", agentId: agent.id },
      })),
    createDraft: async (_access, _user, input) => {
      if (refuse) {
        throw new PilotError(refuse, "refused");
      }
      drafts.push({ handle: input.handle, fingerprint: input.fingerprint });
      return { productId: DRAFT, scope: { tenantId: "trusted", agentId: DRAFT } };
    },
    agentScope: async (_access, id) => ({ tenantId: "trusted", agentId: id }),
  } as Partial<StudioDirectory> as StudioDirectory;
  const studio = studioRoutes({
    directory,
    repository: {
      agent: async (scope: { agentId: string }) => record(scope.agentId),
      readiness: async () => ({ connectionsChecked: false, manualSucceeded: true }),
    } as unknown as ResearchRepository,
    notifyQueued: async () => {},
    wallets: {
      findAgentWallet: async (id) =>
        listed.find((agent) => agent.id === id)?.wallet
          ? { walletId: `w-${id}`, address: "0x1111111111111111111111111111111111111111" }
          : null,
    },
    balances: { read: async () => 50 },
    authenticate: async () => ({
      principal: buildUserPrincipal({
        user: { id: "user" },
        integrator: { id: "workspace" },
        memberRole: "admin",
      }),
      workspace: null,
    }),
  });
  const root = new Hono<AppEnv>();
  root.use("*", async (c, next) => {
    c.set("requestId", "request-1");
    await next();
  });
  root.route("/", studio);
  return { root, drafts };
}

const post = (payload: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
  body: JSON.stringify(payload),
});

test("create sends the brief's fingerprint and answers the new draft", async () => {
  const f = app();
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.productId, DRAFT);
  assert.equal(created.agent.id, DRAFT);
  assert.deepEqual(f.drafts, [
    { handle: "halftime", fingerprint: preparePreview(request).fingerprint },
  ]);
});

for (const code of ["RUN_STALE", "HANDLE_TAKEN", "PREVIEW_UNUSABLE"]) {
  test(`the directory's ${code} is a 409 with that code`, async () => {
    const f = app({ refuse: code });
    const response = await f.root.request("/drafts", post(body));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: code });
  });
}

test("an invalid brief is refused before anything is written", async () => {
  const f = app();
  const response = await f.root.request(
    "/drafts",
    post({ ...body, brief: { ...body.brief, entersWhen: [] } }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_BRIEF");
  assert.equal(f.drafts.length, 0);
});

test("an unfunded draft already there closes the lock: 409 UNFUNDED_AGENT", async () => {
  const f = app({ listed: [{ id: DRAFT, draft: true, wallet: false }] });
  const response = await f.root.request("/drafts", post(body));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "UNFUNDED_AGENT" });
});

test("the agents list says which are drafts, and a draft counts as 0 AUSD", async () => {
  const f = app({ listed: [{ id: DRAFT, draft: true, wallet: false }] });
  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });
  const { agents } = await response.json();
  assert.equal(agents[0].draft, true);
  assert.equal(agents[0].wallet, null);
  assert.deepEqual(agents[0].canCreateAnother, { ok: false, reason: "unfunded_agent" });
});

test("a funded agent without a draft leaves the lock open", async () => {
  const f = app({ listed: [{ id: FUNDED, draft: false, wallet: true }] });
  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });
  const { agents } = await response.json();
  assert.equal(agents[0].draft, false);
  assert.deepEqual(agents[0].canCreateAnother, { ok: true, reason: null });
});
