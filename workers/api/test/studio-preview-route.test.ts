import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  PilotError,
  PreviewRateLimited,
  buildUserPrincipal,
  type AgentConfig,
  type PreviewRepository,
  type ResearchRepository,
  type StudioDirectory,
} from "@pickler/core";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";

const RUN = "0000000a-0000-4000-8000-000000000000";
const body = {
  brief: {
    thesis: "Injury news moves the books first.",
    reads: ["espn.com", "@AdamSchefter"],
    entersWhen: ["A starter is ruled out"],
    exitsWhen: [],
    never: [],
  },
  spend: { perCallAusd: 5, perDayAusd: 20 },
  maxLeverage: 2,
};

function app({
  enabled = true,
  previews,
  admissions = true,
}: {
  enabled?: boolean;
  previews?: Partial<PreviewRepository>;
  admissions?: boolean;
} = {}) {
  const created: { userId: string; config: AgentConfig; fingerprint: string }[] = [];
  const reads: string[] = [];
  let notified = 0;
  const directory = {
    access: async () => ({
      workspaceId: "workspace",
      tenantId: "trusted",
      ownerUserId: "user",
      role: "admin",
      enabled,
    }),
  } as unknown as StudioDirectory;
  const repository: PreviewRepository = {
    create: async (input) => {
      created.push(input);
      return { id: RUN };
    },
    read: async (userId, id) => {
      reads.push(`${userId}:${id}`);
      if (userId !== "user") {
        throw new PilotError("NOT_FOUND", "Paper run not found");
      }
      return {
        run: {
          id,
          status: "running",
          createdAt: 1,
          startedAt: 2,
          finishedAt: null,
          expiresAt: 86_400_001,
          adopted: false,
          decision: null,
          error: null,
        },
        events: [{ id: 1, type: "runtime", data: {}, createdAt: 3 }],
      };
    },
    ...previews,
  };
  const studio = studioRoutes({
    directory,
    repository: {} as ResearchRepository,
    admissionsEnabled: admissions,
    notifyQueued: async () => {
      notified++;
    },
    previews: repository,
    wallets: { findAgentWallet: async () => null },
    balances: { read: async () => 0 },
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
  return { root, created, reads, notified: () => notified };
}

const post = (payload: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
  body: JSON.stringify(payload),
});

test("a brief queues a paper run on the config it becomes, with no agent", async () => {
  const f = app();
  const response = await f.root.request("/preview-runs", post(body));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { id: RUN });
  assert.equal(f.notified(), 1);
  const [input] = f.created;
  assert.equal(input?.userId, "user");
  assert.deepEqual(input?.config.marketScope, {
    version: 1,
    category: "sports",
    subcategories: "all",
  });
  assert.deepEqual(input?.config.sources?.web, { mode: "prefer", sites: ["espn.com"] });
  assert.deepEqual(input?.config.spend, body.spend);
  assert.equal(input?.config.maxLeverage, 2);
});

test("a brief without an entry rule is 400 INVALID_BRIEF naming the section", async () => {
  const f = app();
  const response = await f.root.request(
    "/preview-runs",
    post({ ...body, brief: { ...body.brief, entersWhen: ["  "] } }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "INVALID_BRIEF",
    field: "entersWhen",
    reason: "required",
  });
  assert.equal(f.created.length, 0);
});

test("a line too long is 400 INVALID_BRIEF too_long", async () => {
  const f = app();
  const response = await f.root.request(
    "/preview-runs",
    post({ ...body, brief: { ...body.brief, never: ["x".repeat(201)] } }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "INVALID_BRIEF",
    field: "never",
    reason: "too_long",
  });
});

test("a day's cap below one trade's is 400 INVALID_INPUT", async () => {
  const f = app();
  const response = await f.root.request(
    "/preview-runs",
    post({ ...body, spend: { perCallAusd: 25, perDayAusd: 20 } }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_INPUT" });
});

test("without research access it is 403 RESEARCH_ACCESS_DENIED", async () => {
  const f = app({ enabled: false });
  const response = await f.root.request("/preview-runs", post(body));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "RESEARCH_ACCESS_DENIED" });
});

test("past the hourly limit it is 429 with the time the next one is allowed", async () => {
  const f = app({
    previews: {
      create: async () => {
        throw new PreviewRateLimited(1_790_000_000_000);
      },
    },
  });
  const response = await f.root.request("/preview-runs", post(body));
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "PREVIEW_RATE_LIMITED",
    retryAt: 1_790_000_000_000,
  });
});

test("paused admissions refuse new paper runs like new research", async () => {
  const f = app({ admissions: false });
  const response = await f.root.request("/preview-runs", post(body));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "ADMISSIONS_PAUSED" });
});

test("the owner reads the run and its trace in a run's event shape", async () => {
  const f = app();
  const response = await f.root.request(`/preview-runs/${RUN}`, {
    headers: { Authorization: "Bearer token" },
  });
  assert.equal(response.status, 200);
  const read = await response.json();
  assert.equal(read.run.status, "running");
  assert.deepEqual(read.events, [{ id: 1, type: "runtime", data: {}, createdAt: 3 }]);
  assert.deepEqual(f.reads, [`user:${RUN}`]);
});

test("a run that is not the caller's, or has expired, is 404", async () => {
  const f = app({
    previews: {
      read: async () => {
        throw new PilotError("NOT_FOUND", "Paper run not found");
      },
    },
  });
  const response = await f.root.request(`/preview-runs/${RUN}`, {
    headers: { Authorization: "Bearer token" },
  });
  assert.equal(response.status, 404);
});
