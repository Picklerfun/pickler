import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  DEFAULT_CONFIG,
  PilotError,
  X_CHECK_INTERVAL_MS,
  XHandleTakenError,
  buildUserPrincipal,
  type AgentRecord,
  type ResearchRepository,
  type StudioDirectory,
  type XAccount,
  type XChallenge,
  type XPost,
  type XStore,
} from "@pickler/core";
import { XUnavailableError, type XClient } from "@pickler/infrastructure";
import { xStateResponseSchema } from "@pickler/api-schema";
import type { AppEnv } from "../src/env.js";
import { studioRoutes } from "../src/routes/studio.js";

const AGENT = "33333333-3333-4333-8333-333333333333";
const OTHER = "99999999-9999-4999-8999-999999999999";
const HOUR = 3_600_000;

/** An in-memory XStore with the Postgres store's rules. */
function memoryStore(options: { taken?: string[]; public?: boolean } = {}) {
  const challenges = new Map<string, XChallenge>();
  const accounts = new Map<string, XAccount>();
  const claims: Date[] = [];
  const store: XStore = {
    async saveChallenge(agentId, challenge) {
      const saved = { ...challenge, createdAt: new Date(), lastCheckedAt: null };
      challenges.set(agentId, saved);
      return saved;
    },
    async challenge(agentId) {
      return challenges.get(agentId) ?? null;
    },
    async claimCheck(agentId, at, intervalMs) {
      const challenge = challenges.get(agentId);
      if (!challenge) {
        return false;
      }
      if (
        challenge.lastCheckedAt &&
        at.getTime() - challenge.lastCheckedAt.getTime() < intervalMs
      ) {
        return false;
      }
      challenge.lastCheckedAt = at;
      claims.push(at);
      return true;
    },
    async connect(agentId, account) {
      if (options.taken?.some((handle) => handle.toLowerCase() === account.handle.toLowerCase())) {
        throw new XHandleTakenError();
      }
      if (accounts.has(agentId)) {
        throw new PilotError("X_ALREADY_CONNECTED", "connected");
      }
      accounts.set(agentId, {
        xUserId: account.xUserId,
        handle: account.handle,
        verifiedAt: account.at,
        postId: account.postId,
      });
      challenges.delete(agentId);
    },
    async account(agentId) {
      return accounts.get(agentId) ?? null;
    },
    async disconnect(agentId) {
      if (options.public) {
        throw new PilotError("X_ON_PUBLIC_AGENT", "public");
      }
      accounts.delete(agentId);
      challenges.delete(agentId);
    },
    async handleTaken(handle) {
      return options.taken?.some((taken) => taken.toLowerCase() === handle.toLowerCase()) ?? false;
    },
  };
  return { store, challenges, accounts, claims };
}

function fakeClient({
  available = true,
  user = { id: "42", handle: "HalftimeBot" } as { id: string; handle: string } | null,
  posts = [] as XPost[],
  down = false,
} = {}) {
  const reads: { userId: string; since: Date }[] = [];
  const client: XClient = {
    available,
    async userByHandle() {
      if (!available || down) {
        throw new XUnavailableError("X answered 503: secret body");
      }
      return user;
    },
    async recentPosts(userId, since) {
      reads.push({ userId, since });
      if (down) {
        throw new XUnavailableError();
      }
      return posts;
    },
  };
  return { client, reads };
}

function app({
  store = memoryStore(),
  x = fakeClient(),
  composed = true,
}: {
  store?: ReturnType<typeof memoryStore>;
  x?: ReturnType<typeof fakeClient>;
  composed?: boolean;
} = {}) {
  const record = (id: string): AgentRecord => ({
    id,
    tenantId: "trusted",
    version: 1,
    config: { ...DEFAULT_CONFIG },
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
    list: async () => [
      {
        id: AGENT,
        name: "Halftime",
        handle: "halftime",
        accent: "lime" as const,
        draft: true,
        visibility: "private" as const,
        publishedAt: null,
        xHandle: null,
        scope: { tenantId: "trusted", agentId: AGENT },
      },
    ],
    agentScope: async (_access, id) => {
      if (id !== AGENT) {
        throw new PilotError("NOT_FOUND", "Agent not found");
      }
      return { tenantId: "trusted", agentId: id };
    },
  } as Partial<StudioDirectory> as StudioDirectory;
  const studio = studioRoutes({
    directory,
    repository: {
      agent: async (scope: { agentId: string }) => record(scope.agentId),
      readiness: async () => ({ connectionsChecked: false, manualSucceeded: true }),
    } as unknown as ResearchRepository,
    notifyQueued: async () => {},
    wallets: { findAgentWallet: async () => null },
    balances: { read: async () => 50 },
    ...(composed ? { x: { store: store.store, client: x.client } } : {}),
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
  return root;
}

const send = (method: string, payload?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
const get = () => ({ headers: { Authorization: "Bearer token" } });

async function challenged(store: ReturnType<typeof memoryStore>, createdAgo = 0) {
  const now = Date.now();
  store.challenges.set(AGENT, {
    handle: "HalftimeBot",
    code: "pk-abcdefgh",
    createdAt: new Date(now - createdAgo),
    expiresAt: new Date(now - createdAgo + 24 * HOUR),
    lastCheckedAt: null,
  });
}

test("a challenge for a free handle answers the line to post, for 24 h", async () => {
  const store = memoryStore();
  const root = app({ store });

  const response = await root.request(
    `/agents/${AGENT}/x/challenge`,
    send("POST", { handle: "@HalftimeBot" }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.handle, "HalftimeBot");
  assert.match(body.text, /^Verifying Halftime on @pickler · pk-[a-z2-7]{8}$/);
  const saved = store.challenges.get(AGENT)!;
  assert.ok(body.text.endsWith(saved.code));
  const ttl = new Date(body.expiresAt).getTime() - Date.now();
  assert.ok(ttl > 24 * HOUR - 60_000 && ttl <= 24 * HOUR);
});

test("a handle X would not accept is 400 INVALID_X_HANDLE", async () => {
  const store = memoryStore();
  const root = app({ store });

  for (const handle of ["", "@", "has space", "sixteen_chars_xx", "dash-ed"]) {
    const response = await root.request(`/agents/${AGENT}/x/challenge`, send("POST", { handle }));
    assert.equal(response.status, 400, handle);
    assert.equal((await response.json()).error, "INVALID_X_HANDLE");
  }
  assert.equal(store.challenges.size, 0);
});

test("a handle another agent holds is 409 X_HANDLE_TAKEN", async () => {
  const store = memoryStore({ taken: ["halftimebot"] });
  const root = app({ store });

  const response = await root.request(
    `/agents/${AGENT}/x/challenge`,
    send("POST", { handle: "HalftimeBot" }),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "X_HANDLE_TAKEN");
  assert.equal(store.challenges.size, 0);
});

test("a challenge for an agent that already has X is 409 X_ALREADY_CONNECTED", async () => {
  const store = memoryStore();
  store.accounts.set(AGENT, {
    xUserId: "42",
    handle: "HalftimeBot",
    verifiedAt: new Date(),
    postId: "1",
  });
  const root = app({ store });

  const response = await root.request(
    `/agents/${AGENT}/x/challenge`,
    send("POST", { handle: "OtherBot" }),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "X_ALREADY_CONNECTED");
});

test("without a bearer token a challenge is 503 X_UNAVAILABLE and nothing is saved", async () => {
  const store = memoryStore();
  const root = app({ store, x: fakeClient({ available: false }) });

  const response = await root.request(
    `/agents/${AGENT}/x/challenge`,
    send("POST", { handle: "HalftimeBot" }),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "X_UNAVAILABLE");
  assert.equal(store.challenges.size, 0);
});

test("X state: the account, the live challenge and whether X is open", async () => {
  const store = memoryStore();
  await challenged(store);
  const root = app({ store, x: fakeClient({ available: false }) });

  const response = await root.request(`/agents/${AGENT}/x`, get());

  assert.equal(response.status, 200);
  const state = xStateResponseSchema.parse(await response.json());
  assert.equal(state.available, false);
  assert.equal(state.account, null);
  assert.deepEqual(state.challenge, {
    handle: "HalftimeBot",
    text: "Verifying Halftime on @pickler · pk-abcdefgh",
    expiresAt: store.challenges.get(AGENT)!.expiresAt.toISOString(),
  });
});

test("X state hides a lapsed challenge", async () => {
  const store = memoryStore();
  await challenged(store, 25 * HOUR);
  const root = app({ store });

  const state = await (await root.request(`/agents/${AGENT}/x`, get())).json();

  assert.equal(state.challenge, null);
  assert.equal(state.available, true);
});

test("verify finds the post and connects the account", async () => {
  const store = memoryStore();
  await challenged(store);
  const since = store.challenges.get(AGENT)!.createdAt;
  const x = fakeClient({
    posts: [
      {
        id: "7",
        authorId: "42",
        text: "Verifying Halftime on @pickler · pk-abcdefgh",
        createdAt: new Date(),
      },
    ],
  });
  const root = app({ store, x });

  const response = await root.request(`/agents/${AGENT}/x/verify`, send("POST", {}));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: true, handle: "HalftimeBot" });
  assert.deepEqual(x.reads, [{ userId: "42", since }]);
  assert.equal(store.accounts.get(AGENT)?.postId, "7");
  assert.equal(store.accounts.get(AGENT)?.xUserId, "42");

  const state = await (await root.request(`/agents/${AGENT}/x`, get())).json();
  assert.equal(state.account.handle, "HalftimeBot");
  assert.equal(state.challenge, null);
});

test("verify without the post answers NOT_FOUND, and a second check within 10 s is 429", async () => {
  const store = memoryStore();
  await challenged(store);
  const root = app({ store, x: fakeClient({ posts: [] }) });

  const first = await root.request(`/agents/${AGENT}/x/verify`, send("POST", {}));
  const second = await root.request(`/agents/${AGENT}/x/verify`, send("POST"));

  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { verified: false, reason: "NOT_FOUND" });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error, "TOO_MANY_CHECKS");
  assert.equal(store.claims.length, 1);
  assert.equal(store.accounts.size, 0);
  assert.ok(X_CHECK_INTERVAL_MS === 10_000);
});

test("verify of a handle X does not know answers NOT_FOUND without reading posts", async () => {
  const store = memoryStore();
  await challenged(store);
  const x = fakeClient({ user: null });
  const root = app({ store, x });

  const response = await root.request(`/agents/${AGENT}/x/verify`, send("POST", {}));

  assert.deepEqual(await response.json(), { verified: false, reason: "NOT_FOUND" });
  assert.deepEqual(x.reads, []);
});

test("a post by someone else, or before the challenge, does not verify", async () => {
  const store = memoryStore();
  await challenged(store, HOUR);
  const x = fakeClient({
    posts: [
      { id: "1", authorId: "43", text: "pk-abcdefgh", createdAt: new Date() },
      { id: "2", authorId: "42", text: "pk-abcdefgh", createdAt: new Date(Date.now() - 2 * HOUR) },
    ],
  });
  const root = app({ store, x });

  const response = await root.request(`/agents/${AGENT}/x/verify`, send("POST", {}));

  assert.deepEqual(await response.json(), { verified: false, reason: "NOT_FOUND" });
  assert.equal(store.accounts.size, 0);
});

test("verify with no challenge is 404 CHALLENGE_NOT_FOUND, and a lapsed one 409 CHALLENGE_EXPIRED", async () => {
  const none = app();
  const lapsedStore = memoryStore();
  await challenged(lapsedStore, 25 * HOUR);
  const lapsed = app({ store: lapsedStore });

  const missing = await none.request(`/agents/${AGENT}/x/verify`, send("POST", {}));
  const expired = await lapsed.request(`/agents/${AGENT}/x/verify`, send("POST", {}));

  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "CHALLENGE_NOT_FOUND");
  assert.equal(expired.status, 409);
  assert.equal((await expired.json()).error, "CHALLENGE_EXPIRED");
  assert.equal(lapsedStore.claims.length, 0);
});

test("verify when another agent took the account meanwhile is 409 X_HANDLE_TAKEN", async () => {
  const store = memoryStore({ taken: ["HalftimeBot"] });
  await challenged(store);
  const x = fakeClient({
    posts: [{ id: "7", authorId: "42", text: "pk-abcdefgh", createdAt: new Date() }],
  });
  const root = app({ store, x });

  const response = await root.request(`/agents/${AGENT}/x/verify`, send("POST", {}));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "X_HANDLE_TAKEN");
});

test("verify when X is down is 503 X_UNAVAILABLE without X's words", async () => {
  const store = memoryStore();
  await challenged(store);
  const root = app({ store, x: fakeClient({ down: true }) });

  const response = await root.request(`/agents/${AGENT}/x/verify`, send("POST", {}));

  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, "X_UNAVAILABLE");
  assert.ok(!text.includes("secret body"));
});

test("verify without a bearer token is 503 and spends no check", async () => {
  const store = memoryStore();
  await challenged(store);
  const root = app({ store, x: fakeClient({ available: false }) });

  const response = await root.request(`/agents/${AGENT}/x/verify`, send("POST", {}));

  assert.equal(response.status, 503);
  assert.equal(store.claims.length, 0);
});

test("disconnect clears the account; a public agent's is 409 X_ON_PUBLIC_AGENT", async () => {
  const store = memoryStore();
  store.accounts.set(AGENT, {
    xUserId: "42",
    handle: "HalftimeBot",
    verifiedAt: new Date(),
    postId: "1",
  });
  const root = app({ store });
  const publicRoot = app({ store: memoryStore({ public: true }) });

  const response = await root.request(`/agents/${AGENT}/x`, send("DELETE"));
  const refused = await publicRoot.request(`/agents/${AGENT}/x`, send("DELETE"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { disconnected: true });
  assert.equal(store.accounts.size, 0);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, "X_ON_PUBLIC_AGENT");
});

test("another owner's agent is 404 on every X route and its store is never touched", async () => {
  const store = memoryStore();
  const root = app({ store });

  const responses = await Promise.all([
    root.request(`/agents/${OTHER}/x`, get()),
    root.request(`/agents/${OTHER}/x/challenge`, send("POST", { handle: "HalftimeBot" })),
    root.request(`/agents/${OTHER}/x/verify`, send("POST", {})),
    root.request(`/agents/${OTHER}/x`, send("DELETE")),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status),
    [404, 404, 404, 404],
  );
  assert.equal(store.challenges.size, 0);
});

test("where X is not composed every X route is 503 X_UNAVAILABLE", async () => {
  const root = app({ composed: false });

  const state = await root.request(`/agents/${AGENT}/x`, get());

  assert.equal(state.status, 503);
  assert.equal((await state.json()).error, "X_UNAVAILABLE");
});
