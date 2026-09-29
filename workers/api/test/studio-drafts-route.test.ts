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
  balance = 50,
}: {
  listed?: { id: string; draft: boolean; wallet: boolean }[];
  refuse?: string;
  balance?: number;
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
    createDraft: async (_access, _user, input, _now, admit) => {
      // The directory checks the run and the handle, then runs the lock, inside its transaction.
      if (refuse) {
        throw new PilotError(refuse, "refused");
      }
      await admit?.();
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
    balances: { read: async () => balance },
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

const draftAgents = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `5555555${index}-5555-4555-8555-555555555555`,
    draft: true,
    wallet: false,
  }));

test("a draft holds no wallet and does not close the lock", async () => {
  const f = app({ listed: draftAgents(1) });

  const response = await f.root.request("/drafts", post(body));

  assert.equal(response.status, 201);
});

test("an unfunded agent with a wallet still closes the lock for a draft", async () => {
  const f = app({ listed: [{ id: FUNDED, draft: false, wallet: true }], balance: 3 });

  const response = await f.root.request("/drafts", post(body));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "UNFUNDED_AGENT" });
});

test("the fourth draft is refused: 409 DRAFT_LIMIT, naming the limit", async () => {
  const f = app({ listed: draftAgents(3) });

  const response = await f.root.request("/drafts", post(body));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "DRAFT_LIMIT",
    message: "At most 3 drafts at a time",
  });
  assert.equal(f.drafts.length, 0);
});

test("the agents list says which are drafts, and drafts leave the lock open", async () => {
  const f = app({ listed: draftAgents(2) });

  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });

  const { agents } = await response.json();
  assert.equal(agents[0].draft, true);
  assert.equal(agents[0].wallet, null);
  assert.deepEqual(agents[0].canCreateAnother, { ok: true, reason: null });
});

test("at the draft limit the lock says so", async () => {
  const f = app({ listed: draftAgents(3) });

  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });

  const { agents } = await response.json();
  assert.deepEqual(agents[0].canCreateAnother, { ok: false, reason: "draft_limit" });
});

test("a funded agent without a draft leaves the lock open", async () => {
  const f = app({ listed: [{ id: FUNDED, draft: false, wallet: true }] });
  const response = await f.root.request("/agents", { headers: { Authorization: "Bearer t" } });
  const { agents } = await response.json();
  assert.equal(agents[0].draft, false);
  assert.deepEqual(agents[0].canCreateAnother, { ok: true, reason: null });
});
