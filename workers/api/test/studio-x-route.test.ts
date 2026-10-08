import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  AuthenticationRequiredError,
  DEFAULT_BRIEF,
  STARTER_CAPS,
  XFailure,
  buildUserPrincipal,
  createXOAuthService,
  prepareDraft,
} from "@pickler/core";
import {
  PostgresStudioDirectory,
  PostgresXOAuthStore,
  createXOAuthProvider,
  xSecrets,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { xStateResponseSchema, xPostsResponseSchema } from "@pickler/api-schema";
import type { AppEnv } from "../src/env.js";
import { studioRoutes, type StudioServices } from "../src/routes/studio.js";
import { studioXCallbackRoutes } from "../src/routes/studio-x.js";

const policy = {
  version: 1,
  reviewedAt: "2026-10-07T00:00:00Z",
  identityRequestsPerDay: 10,
  postRequestsPerDay: 2,
  postResourcesPerDay: 40,
};
const key = "01".repeat(32);
const json = (body: unknown) => Response.json(body);

async function fixture(t: TestContext, existing?: Awaited<ReturnType<typeof createTestStore>>) {
  // Reject remote databases before the isolated helper creates anything.
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler",
  );
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const repo = existing ?? (await createTestStore(t));
  const directory = new PostgresStudioDirectory(repo.pool);
  const userId = randomUUID();
  await repo.pool.query("SELECT identity.create_profile($1,'Maker',$2)", [
    userId,
    `owner_${randomUUID().slice(0, 8)}`,
  ]);
  await directory.onboard(userId);
  await repo.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const access = (await directory.access(userId, null))!;
  const walletId = `controlled-${randomUUID()}`;
  await repo.pool.query(
    "INSERT INTO wallets.wallets (user_id,wallet_id,sub_organization_id,kind,name,approved_policy_ids) VALUES ($1,$2,'controlled-org','agent','Controlled',ARRAY['p1','p2','p3'])",
    [userId, walletId],
  );
  await repo.pool.query(
    "INSERT INTO wallets.wallet_accounts (wallet_id,chain,address,address_format,path) VALUES ($1,'monad',$2,'ADDRESS_FORMAT_ETHEREUM','m/44')",
    [walletId, `0x${randomUUID().replaceAll("-", "")}${randomUUID().slice(0, 8)}`],
  );
  const handle = `agent_${randomUUID().slice(0, 8)}`;
  const draft = prepareDraft({
    name: "Controlled",
    handle,
    markets: ["BTC"],
    voice: "analyst",
    avatar: { accent: "lime", pattern: 1 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId,
  });
  const created = await directory.createDraft(access, userId, {
    ...draft,
    name: "Controlled",
    handle,
    walletId,
  });
  const agentId = created.productId;
  const actor = { userId, workspaceId: access.workspaceId, tenantId: access.tenantId, agentId };
  const store = new PostgresXOAuthStore(repo.pool, key, 1);
  const calls: { url: string; body: URLSearchParams | null }[] = [];
  let clock = new Date();
  let principalUserId = userId;
  let scopes = "users.read tweet.read offline.access";
  let identityId = "123";
  let fail: "identity" | "refresh" | "revoke" | "revoke-refresh" | "posts" | "token" | null = null;
  let afterIdentity: (() => Promise<void>) | null = null;
  const provider = createXOAuthProvider({
    clientId: "controlled-id",
    clientSecret: "controlled-secret",
    redirectUri: "http://localhost:3001/api/v1/studio/x/callback",
    enabled: true,
    readsEnabled: true,
    now: () => clock,
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = init?.body instanceof URLSearchParams ? init.body : null;
      calls.push({ url: String(url), body });
      if (path.endsWith("/token")) {
        if (fail === "token") {
          throw new Error("uncertain exchange");
        }
        if (body?.get("grant_type") === "refresh_token" && fail === "refresh") {
          throw new Error("uncertain private response");
        }
        if (body?.get("code") === "invalid-pkce") {
          return new Response("private", { status: 400 });
        }
        return json({
          access_token: "controlled-access",
          refresh_token: "controlled-refresh",
          token_type: "bearer",
          scope: scopes,
          expires_in: 7200,
        });
      }
      if (path.endsWith("/users/me")) {
        if (afterIdentity) {
          await afterIdentity();
        }
        if (fail === "identity") {
          return new Response("private", { status: 500 });
        }
        return json({
          data: {
            id: identityId,
            username: "ControlledX",
            name: "Controlled creator",
            profile_image_url: "https://pbs.twimg.com/profile_images/123/photo_normal.jpg",
          },
        });
      }
      if (path.endsWith("/revoke")) {
        return fail === "revoke" ||
          (fail === "revoke-refresh" && body?.get("token") === "controlled-refresh")
          ? new Response("private", { status: 500 })
          : json({ revoked: true });
      }
      if (path.endsWith("/tweets")) {
        if (fail === "posts") {
          return new Response("private", { status: 429, headers: { "retry-after": "120" } });
        }
        return json({
          data: [
            {
              id: "456",
              author_id: identityId,
              text: "Controlled reply",
              created_at: "2026-10-07T00:00:00Z",
            },
          ],
          meta: { next_token: "next-page" },
        });
      }
      throw new Error(`Unexpected X transport ${path}`);
    },
  });
  const service = createXOAuthService({
    directory,
    store,
    provider,
    secrets: xSecrets(),
    policy,
    now: () => clock,
  });
  const services: StudioServices = {
    directory,
    repository: repo,
    notifyQueued: async () => {},
    wallets: { findAgentWallet: async () => null },
    balances: { read: async () => 100, forget: () => {} },
    x: service,
    authenticate: async (credentials, options) => {
      assert.equal(options?.userOnly, true);
      if (credentials.bearerToken !== "controlled-jwt" || credentials.apiKey) {
        throw new AuthenticationRequiredError();
      }
      return {
        principal: buildUserPrincipal({
          user: { id: principalUserId },
          integrator: { id: access.workspaceId },
          memberRole: "admin",
        }),
        workspace: null,
      };
    },
  };
  const app = new Hono<AppEnv>();
  app.route("/v1/studio/x", studioXCallbackRoutes(services));
  app.route("/v1/studio", studioRoutes(services));
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`/v1/studio${path}`, init, { APP_ENV: "local" } as AppEnv["Bindings"]);
  const owned = `/agents/${agentId}/x`;
  const headers = { Authorization: "Bearer controlled-jwt", "content-type": "application/json" };
  async function begin() {
    const response = await request(`${owned}/authorize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ returnTo: `/studio?agent=${agentId}&resume=identity` }),
    });
    assert.equal(response.status, 200);
    const auth = new URL(
      ((await response.json()) as { authorizationUrl: string }).authorizationUrl,
    );
    return {
      state: auth.searchParams.get("state")!,
      cookie: response.headers.get("set-cookie")!.split(";")[0]!,
      auth,
    };
  }
  async function callback(
    attempt: Awaited<ReturnType<typeof begin>>,
    tail = "code=approved",
    cookie = attempt.cookie,
  ) {
    return request(`/x/callback?state=${attempt.state}&${tail}`, { headers: { cookie } });
  }
  async function connect() {
    const attempt = await begin();
    const response = await callback(attempt);
    assert.match(response.headers.get("location") ?? "", /xResult=connected/);
    return attempt;
  }
  return {
    repo,
    directory,
    userId,
    access,
    actor,
    agentId,
    store,
    service,
    provider,
    calls,
    request,
    owned,
    headers,
    begin,
    callback,
    connect,
    setPrincipal: (value: string) => {
      principalUserId = value;
    },
    setClock: (value: Date) => {
      clock = value;
    },
    getClock: () => clock,
    setScopes: (value: string) => {
      scopes = value;
    },
    setIdentity: (value: string) => {
      identityId = value;
    },
    setFail: (value: typeof fail) => {
      fail = value;
    },
    afterIdentity: (value: typeof afterIdentity) => {
      afterIdentity = value;
    },
  };
}

test("controlled API → PKCE → encrypted PostgreSQL → publication → private manual timeline", async (t) => {
  const f = await fixture(t);
  const attempt = await f.connect();
  assert.equal(attempt.auth.searchParams.get("code_challenge_method"), "S256");
  const state = await f.request(f.owned, { headers: f.headers });
  assert.equal(state.headers.get("cache-control"), "private, no-store");
  const connection = xStateResponseSchema.parse(await state.json());
  assert.equal(connection.status, "connected");
  assert.equal(connection.account?.displayName, "Controlled creator");
  assert.equal(
    connection.account?.profileImageUrl,
    "https://pbs.twimg.com/profile_images/123/photo_normal.jpg",
  );
  const callCount = f.calls.length;
  const stored = await f.request(f.owned, { headers: f.headers });
  assert.deepEqual(xStateResponseSchema.parse(await stored.json()), connection);
  assert.equal(f.calls.length, callCount, "reading the profile never queries X");
  const rows = await f.repo.pool.query(
    "SELECT g.tokens,a.state_hash,a.browser_hash,a.verifier,a.status FROM agents.x_oauth_grants g JOIN agents.x_oauth_attempts a ON a.agent_id=g.agent_id WHERE g.agent_id=$1",
    [f.agentId],
  );
  assert.ok(!rows.rows[0].tokens.includes("controlled-refresh"));
  assert.notEqual(rows.rows[0].state_hash, attempt.state);
  assert.notEqual(rows.rows[0].browser_hash, attempt.cookie.split("=")[1]);
  assert.equal(rows.rows[0].verifier, "");
  const published = await f.request(`/agents/${f.agentId}/publish`, {
    method: "POST",
    headers: f.headers,
  });
  assert.equal(published.status, 200);
  const posts = await f.request(`${f.owned}/posts`, { headers: f.headers });
  assert.equal(posts.status, 200);
  assert.equal(xPostsResponseSchema.parse(await posts.json()).posts[0]?.text, "Controlled reply");
  assert.equal(new URL(f.calls.at(-1)!.url).searchParams.get("max_results"), "5");
  assert.equal(
    (await f.repo.pool.query("SELECT count(*) FROM agents.x_api_calls")).rows[0].count,
    "3",
  );
  assert.equal(
    (await f.repo.pool.query("SELECT post_resources FROM agents.x_api_usage")).rows[0]
      .post_resources,
    5,
  );
  // A public agent disconnects without changing trading/publication state.
  const before = (
    await f.repo.pool.query(
      "SELECT status,visibility,published_at FROM agents.agents WHERE id=$1",
      [f.agentId],
    )
  ).rows[0];
  const disconnected = await f.request(f.owned, { method: "DELETE", headers: f.headers });
  assert.equal(disconnected.status, 200);
  assert.deepEqual(await disconnected.json(), { disconnected: true, status: "disconnected" });
  assert.deepEqual(
    (
      await f.repo.pool.query(
        "SELECT status,visibility,published_at FROM agents.agents WHERE id=$1",
        [f.agentId],
      )
    ).rows[0],
    before,
  );
  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 409);
});

test("JWT-only routes reject missing/invalid bearer, API keys and HMAC; callback has no JWT", async (t) => {
  const f = await fixture(t);
  for (const headers of [
    {},
    { Authorization: "Bearer invalid" },
    { "x-api-key": "key" },
    { Authorization: "ApiKey key" },
    { "x-agent-id": f.agentId, "x-agent-signature": "signature" },
  ]) {
    assert.equal((await f.request(f.owned, { headers })).status, 401);
  }
  const attempt = await f.begin();
  const result = await f.callback(attempt);
  assert.equal(result.status, 303);
  assert.match(result.headers.get("location") ?? "", /xResult=connected/);
  for (const old of ["/challenge", "/verify"]) {
    assert.equal(
      (await f.request(f.owned + old, { method: "POST", headers: f.headers, body: "{}" })).status,
      404,
    );
  }
});

test("bad state/cookie, denied consent, expired attempts and duplicate callbacks never repeat an exchange", async (t) => {
  const f = await fixture(t);
  const attempt = await f.begin();
  assert.match(
    (await f.callback(attempt, "code=approved", "wrong=wrong")).headers.get("location") ?? "",
    /failed/,
  );
  assert.match(
    (await f.callback({ ...attempt, state: "a".repeat(43) })).headers.get("location") ?? "",
    /failed/,
  );
  assert.equal(f.calls.length, 0);
  assert.match(
    (await f.callback(attempt, "error=access_denied")).headers.get("location") ?? "",
    /cancelled/,
  );
  assert.match((await f.callback(attempt)).headers.get("location") ?? "", /failed/);
  assert.equal(f.calls.length, 0);
  await f.repo.pool.query(
    "UPDATE agents.x_oauth_attempts SET created_at=now()-interval '20 seconds'",
  );
  const expired = await f.begin();
  await f.repo.pool.query(
    "UPDATE agents.x_oauth_attempts SET expires_at=now()-interval '1 second'",
  );
  assert.match((await f.callback(expired)).headers.get("location") ?? "", /failed/);
  assert.equal(f.calls.length, 0);
});

for (const scenario of [
  "scopes",
  "pkce",
  "uncertain",
  "token-uncertain",
  "revoked-access",
] as const) {
  test(`OAuth ${scenario} does not link or replay`, async (t) => {
    const f = await fixture(t);
    const attempt = await f.begin();
    if (scenario === "scopes") {
      f.setScopes("users.read");
    }
    if (scenario === "token-uncertain") {
      f.setFail("token");
    }
    if (scenario === "uncertain") {
      f.setFail("identity");
    }
    if (scenario === "revoked-access") {
      await f.repo.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
        f.userId,
      ]);
    }
    const result = await f.callback(
      attempt,
      scenario === "pkce" ? "code=invalid-pkce" : "code=approved",
    );
    assert.match(result.headers.get("location") ?? "", /failed/);
    assert.equal(
      (await f.repo.pool.query("SELECT count(*) FROM agents.x_oauth_grants")).rows[0].count,
      "0",
    );
    const count = f.calls.length;
    await f.callback(attempt);
    assert.equal(f.calls.length, count);
  });
}

test("historical verification requires OAuth, keeps evidence, reconnect requires the same X ID", async (t) => {
  const f = await fixture(t);
  await f.repo.pool.query(
    "INSERT INTO agents.x_accounts(agent_id,x_user_id,handle,verification_post_id,verified_at) VALUES ($1,'123','ControlledX','old-proof',now())",
    [f.agentId],
  );
  assert.equal((await f.service.state(f.userId, null, f.agentId)).status, "reconnect_required");
  const blocked = await f.request(`/agents/${f.agentId}/publish`, {
    method: "POST",
    headers: f.headers,
  });
  assert.equal(blocked.status, 409);
  assert.match(await blocked.text(), /X_CONNECTION_REQUIRED/);
  f.setIdentity("999");
  const attempt = await f.begin();
  assert.match((await f.callback(attempt)).headers.get("location") ?? "", /x_account_mismatch/);
  await f.repo.pool.query(
    "UPDATE agents.x_oauth_attempts SET created_at=now()-interval '20 seconds'",
  );
  f.setIdentity("123");
  await f.connect();
  const row = (
    await f.repo.pool.query(
      "SELECT verification_method,verification_post_id FROM agents.x_accounts WHERE agent_id=$1",
      [f.agentId],
    )
  ).rows[0];
  assert.deepEqual(row, { verification_method: "oauth", verification_post_id: "old-proof" });
});

test("publication races and provider failures cannot bypass OAuth or reinterpret outages as revocation", async (t) => {
  const f = await fixture(t);
  await f.connect();
  f.setFail("identity");
  assert.equal(
    (await f.request(`/agents/${f.agentId}/publish`, { method: "POST", headers: f.headers }))
      .status,
    503,
  );
  assert.equal((await f.service.state(f.userId, null, f.agentId)).status, "connected");
  f.setFail(null);
  f.afterIdentity(async () => {
    await f.store.disconnect(f.actor);
  });
  assert.equal(
    (await f.request(`/agents/${f.agentId}/publish`, { method: "POST", headers: f.headers }))
      .status,
    409,
  );
  assert.equal(
    (await f.repo.pool.query("SELECT visibility FROM agents.agents WHERE id=$1", [f.agentId]))
      .rows[0].visibility,
    "private",
  );
});

test("failed revocation blocks local access immediately and can be explicitly retried", async (t) => {
  const f = await fixture(t);
  await f.connect();
  f.setFail("revoke");
  const response = await f.request(f.owned, { method: "DELETE", headers: f.headers });
  assert.deepEqual(await response.json(), { disconnected: true, status: "revocation_pending" });
  assert.equal((await f.service.state(f.userId, null, f.agentId)).status, "revocation_pending");
  assert.equal((await f.store.grant(f.actor))?.tokens?.accessToken, "");
  assert.equal((await f.store.grant(f.actor))?.tokens?.refreshToken, "");
  assert.deepEqual((await f.store.pendingRevocations(f.actor)).map((item) => item.token).sort(), [
    "controlled-access",
    "controlled-refresh",
  ]);
  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 409);
  f.setFail(null);
  assert.equal((await f.service.disconnect(f.userId, null, f.agentId)).status, "disconnected");
  assert.equal(
    (await f.repo.pool.query("SELECT count(*) FROM agents.x_oauth_grants")).rows[0].count,
    "0",
  );
});

test("refresh concurrency/lost claim/uncertain response stops without repeating initiated exchanges", async (t) => {
  const f = await fixture(t);
  await f.connect();
  const grant = (await f.store.grant(f.actor))!;
  const claims = await Promise.allSettled([
    f.store.claimRefresh(f.actor, grant.version, new Date()),
    f.store.claimRefresh(f.actor, grant.version, new Date()),
  ]);
  assert.equal(claims.filter((c) => c.status === "fulfilled").length, 1);
  await f.repo.pool.query(
    "UPDATE agents.x_oauth_grants SET refresh_started_at=now()-interval '31 seconds'",
  );
  await assert.rejects(f.store.claimRefresh(f.actor, grant.version, new Date()), XFailure);
  assert.equal((await f.store.grant(f.actor))?.status, "reconnect_required");
  const calls = f.calls.length;
  await assert.rejects(f.service.posts(f.userId, null, f.agentId), XFailure);
  assert.equal(f.calls.length, calls);
});

test("a refresh with an uncertain response is not retried by a later read", async (t) => {
  const f = await fixture(t);
  await f.connect();
  f.setClock(new Date(f.getClock().getTime() + 7200000));
  f.setFail("refresh");
  await assert.rejects(f.service.posts(f.userId, null, f.agentId), XFailure);
  const calls = f.calls.length;
  await assert.rejects(f.service.posts(f.userId, null, f.agentId), XFailure);
  assert.equal(f.calls.length, calls);
  assert.equal((await f.store.grant(f.actor))?.status, "reconnect_required");
});

test("concurrent quotas reserve before transport; 429 preserves resources and Retry-After", async (t) => {
  const f = await fixture(t);
  await f.connect();
  const responses = await Promise.all(
    [1, 2, 3].map(() => f.request(`${f.owned}/posts`, { headers: f.headers })),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 429, 429]);
  assert.equal(f.calls.filter((c) => c.url.includes("/tweets")).length, 1);
  assert.equal(
    (await f.repo.pool.query("SELECT post_resources FROM agents.x_api_usage")).rows[0]
      .post_resources,
    5,
  );
  await assert.rejects(
    f.repo.pool.query("UPDATE agents.x_api_calls SET reserved_resources=0"),
    /append-only/,
  );
});

test("provider rate-limit blocks a second read without automatic polling", async (t) => {
  const f = await fixture(t);
  await f.connect();
  f.setFail("posts");
  const first = await f.request(`${f.owned}/posts`, { headers: f.headers });
  assert.equal(first.status, 429);
  assert.equal(first.headers.get("retry-after"), "120");
  const calls = f.calls.length;
  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 429);
  assert.equal(f.calls.length, calls);
});

test("private X state and reads cannot cross owners or workspaces", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t, first.repo);
  await first.connect();
  for (const [tail, method] of [
    ["", "GET"],
    ["/posts", "GET"],
    ["", "DELETE"],
    ["/authorize", "POST"],
  ]) {
    const response = await second.request(first.owned + tail, {
      method,
      headers: second.headers,
      body: method === "POST" ? JSON.stringify({ returnTo: "/studio" }) : undefined,
    });
    assert.ok([403, 404].includes(response.status));
  }
  assert.equal(second.calls.length, 0);
  assert.equal((await first.service.state(first.userId, null, first.agentId)).status, "connected");
});

test("concurrent connections cannot claim the same X identity twice", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t, first.repo);
  const attempts = await Promise.all([first.begin(), second.begin()]);
  const responses = await Promise.all([
    first.callback(attempts[0]!),
    second.callback(attempts[1]!),
  ]);
  assert.equal(
    responses.filter((r) => r.headers.get("location")?.includes("xResult=connected")).length,
    1,
  );
  assert.equal(
    responses.filter((r) => r.headers.get("location")?.includes("x_handle_taken")).length,
    1,
  );
  assert.equal(
    (await first.repo.pool.query("SELECT count(*) FROM agents.x_oauth_grants")).rows[0].count,
    "1",
  );
});

test("creator permission revoked after identity transport prevents linking but still allows disconnect", async (t) => {
  const f = await fixture(t);
  f.afterIdentity(async () => {
    await f.repo.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
      f.userId,
    ]);
  });
  const attempt = await f.begin();
  assert.match((await f.callback(attempt)).headers.get("location") ?? "", /failed/);
  assert.equal(
    (await f.repo.pool.query("SELECT count(*) FROM agents.x_oauth_grants")).rows[0].count,
    "0",
  );
  assert.equal((await f.request(f.owned, { headers: f.headers })).status, 200);
  assert.equal((await f.request(f.owned, { method: "DELETE", headers: f.headers })).status, 200);
});

test("successful refresh advances the encrypted grant once; a stale claim cannot overwrite it", async (t) => {
  const f = await fixture(t);
  await f.connect();
  const previous = (await f.store.grant(f.actor))!;
  f.setClock(new Date(f.getClock().getTime() + 7200000));
  await f.service.posts(f.userId, null, f.agentId);
  const current = (await f.store.grant(f.actor))!;
  assert.equal(current.version, previous.version + 1);
  assert.equal(f.calls.filter((c) => c.body?.get("grant_type") === "refresh_token").length, 1);
  await assert.rejects(
    f.store.finishRefresh(f.actor, previous.version, randomUUID(), current.tokens!, f.getClock()),
    XFailure,
  );
  assert.equal((await f.store.grant(f.actor))?.version, current.version);
});

test("a workspace member cannot impersonate its owner for X state or disconnect", async (t) => {
  const f = await fixture(t);
  await f.connect();
  const memberId = randomUUID();
  await f.repo.pool.query(
    "INSERT INTO identity.workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'auditor')",
    [f.access.workspaceId, memberId],
  );
  f.setPrincipal(memberId);
  for (const method of ["GET", "DELETE"]) {
    assert.equal((await f.request(f.owned, { headers: f.headers, method })).status, 403);
  }
  assert.equal((await f.store.grant(f.actor))?.status, "connected");
});

test("ownership changed during OAuth cannot complete; the new owner can clean up pending revocation", async (t) => {
  const f = await fixture(t);
  const nextOwner = randomUUID();
  await f.repo.pool.query("SELECT identity.create_profile($1,'Next','next_x_owner')", [nextOwner]);
  await f.repo.pool.query("INSERT INTO pickler.research_access(user_id,enabled) VALUES ($1,true)", [
    nextOwner,
  ]);
  f.setFail("revoke");
  f.afterIdentity(async () => {
    await f.repo.pool.query("UPDATE identity.workspaces SET owner_user_id=$2 WHERE id=$1", [
      f.access.workspaceId,
      nextOwner,
    ]);
  });
  const attempt = await f.begin();
  assert.match((await f.callback(attempt)).headers.get("location") ?? "", /failed/);
  assert.equal(
    (await f.repo.pool.query("SELECT count(*) FROM agents.x_oauth_grants")).rows[0].count,
    "0",
  );
  await assert.rejects(f.service.state(f.userId, f.access.workspaceId, f.agentId));
  assert.equal(
    (await f.service.state(nextOwner, f.access.workspaceId, f.agentId)).status,
    "revocation_pending",
  );
  f.setFail(null);
  assert.equal(
    (await f.service.disconnect(nextOwner, f.access.workspaceId, f.agentId)).status,
    "disconnected",
  );
});

test("partial revocation retains only the remaining token and explicitly retries that token", async (t) => {
  const f = await fixture(t);
  await f.connect();
  f.setFail("revoke-refresh");
  assert.equal(
    (await f.service.disconnect(f.userId, null, f.agentId)).status,
    "revocation_pending",
  );
  assert.deepEqual(
    (await f.store.pendingRevocations(f.actor)).map((item) => item.token),
    ["controlled-refresh"],
  );
  const before = f.calls.length;
  f.setFail(null);
  assert.equal((await f.service.disconnect(f.userId, null, f.agentId)).status, "disconnected");
  assert.deepEqual(
    f.calls.slice(before).map((call) => call.body?.get("token")),
    ["controlled-refresh"],
  );
  assert.equal((await f.store.pendingRevocations(f.actor)).length, 0);
});

test("pagination and exhausted daily quota cannot renew tokens or call X", async (t) => {
  const f = await fixture(t);
  await f.connect();
  const calls = f.calls.length;

  assert.equal(
    (await f.request(`${f.owned}/posts?cursor=page2`, { headers: f.headers })).status,
    400,
  );
  assert.equal(f.calls.length, calls);
  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 200);
  const afterRead = f.calls.length;
  f.setClock(new Date(f.getClock().getTime() + 7200000));

  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 429);
  assert.equal(f.calls.length, afterRead);
  assert.equal((await f.store.grant(f.actor))?.status, "connected");
});

test("a new UTC day permits only one new preview without rewriting earlier reservations", async (t) => {
  const f = await fixture(t);
  await f.connect();
  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 200);
  f.setClock(new Date(f.getClock().getTime() + 86400000));

  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 200);
  assert.equal((await f.request(`${f.owned}/posts`, { headers: f.headers })).status, 429);
  const usage = await f.repo.pool.query(
    "SELECT post_requests,post_resources FROM agents.x_api_usage ORDER BY day",
  );
  assert.deepEqual(usage.rows, [
    { post_requests: 1, post_resources: 5 },
    { post_requests: 1, post_resources: 5 },
  ]);
});

test("disabled reads do not renew tokens or reserve resources while linking remains available", async (t) => {
  const f = await fixture(t);
  await f.connect();
  f.setClock(new Date(f.getClock().getTime() + 7200000));
  const service = createXOAuthService({
    directory: f.directory,
    store: f.store,
    provider: { ...f.provider, readsAvailable: false },
    secrets: xSecrets(),
    policy,
    now: () => f.getClock(),
  });
  const calls = f.calls.length;

  await assert.rejects(service.posts(f.userId, null, f.agentId), XFailure);
  const state = await service.state(f.userId, null, f.agentId);
  assert.equal(state.available, true);
  assert.equal(state.readsAvailable, false);
  assert.equal(f.calls.length, calls);
  const usage = await f.repo.pool.query(
    "SELECT post_requests,post_resources FROM agents.x_api_usage",
  );
  assert.deepEqual(usage.rows, [{ post_requests: 0, post_resources: 0 }]);
});

test("earlier connected grants with no profile photo remain connected without provider reads", async (t) => {
  const f = await fixture(t);
  await f.connect();
  await f.repo.pool.query(
    "UPDATE agents.x_oauth_grants SET display_name=NULL,profile_image_url=NULL WHERE agent_id=$1",
    [f.agentId],
  );
  const before = f.calls.length;

  const response = await f.request(f.owned, { headers: f.headers });
  const state = xStateResponseSchema.parse(await response.json());

  assert.equal(state.status, "connected");
  assert.equal(state.account?.handle, "ControlledX");
  assert.equal(state.account?.displayName, null);
  assert.equal(state.account?.profileImageUrl, null);
  assert.equal(f.calls.length, before);
});
