import test from "node:test";
import assert from "node:assert/strict";
import { createXOAuthProvider, parseXApiPolicy, xSecrets } from "../src/x/oauth-provider.js";
import { XFailure } from "@pickler/core";

const options = {
  clientId: "controlled-id",
  clientSecret: "controlled-secret",
  redirectUri: "https://app.pickler.fun/api/v1/studio/x/callback",
  enabled: true,
  readsEnabled: true,
};
const token = {
  access_token: "controlled-access",
  refresh_token: "controlled-refresh",
  token_type: "bearer",
  scope: "users.read tweet.read offline.access",
  expires_in: 7200,
};

test("PKCE uses 256-bit randomness and SHA-256; authorization is read-only", async () => {
  const secrets = xSecrets();
  const state = secrets.random();
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(state, secrets.random());
  assert.equal(await secrets.hash("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  const url = new URL(createXOAuthProvider(options).authorize(state, await secrets.hash(state)));
  assert.equal(url.origin, "https://x.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "users.read tweet.read offline.access");
  assert.equal(url.searchParams.get("redirect_uri"), options.redirectUri);
});

test("confidential exchange sends code/verifier once and never follows redirects", async () => {
  let calls = 0;
  const provider = createXOAuthProvider({
    ...options,
    fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.x.com/2/oauth2/token");
      assert.equal(init?.redirect, "manual");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Basic ${Buffer.from("controlled-id:controlled-secret").toString("base64")}`,
      );
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("code"), "code");
      assert.equal(body.get("code_verifier"), "verifier");
      return Response.json(token);
    },
  });
  const tokens = await provider.exchange("code", "verifier");
  assert.equal(tokens.refreshToken, token.refresh_token);
  assert.equal(calls, 1);
});

test("timeline includes replies, excludes reposts, and binds all returned authors", async () => {
  const provider = createXOAuthProvider({
    ...options,
    fetch: async (url) => {
      const query = new URL(String(url));
      assert.equal(query.pathname, "/2/users/123/tweets");
      assert.equal(query.searchParams.get("exclude"), "retweets");
      assert.equal(query.searchParams.get("pagination_token"), null);
      assert.equal(query.searchParams.get("max_results"), "5");
      return Response.json({
        data: [
          { id: "456", author_id: "123", text: "A reply", created_at: "2026-10-07T00:00:00Z" },
        ],
        meta: { next_token: "page3" },
      });
    },
  });
  assert.deepEqual(await provider.posts("access", "123"), {
    posts: [
      {
        id: "456",
        text: "A reply",
        createdAt: "2026-10-07T00:00:00Z",
        url: "https://x.com/i/web/status/456",
      },
    ],
    nextCursor: null,
  });
  for (const response of [
    {
      data: [
        { id: "1", author_id: "someone-else", text: "private", created_at: "2026-10-07T00:00:00Z" },
      ],
    },
    { errors: [{ detail: "private-provider-error" }] },
    {
      data: Array.from({ length: 6 }, (_, index) => ({
        id: String(index + 1),
        author_id: "123",
        text: "Too many",
        created_at: "2026-10-07T00:00:00Z",
      })),
    },
    {
      data: [{ id: "1", author_id: "123", text: "RT @other", created_at: "2026-10-07T00:00:00Z" }],
    },
  ]) {
    const bad = createXOAuthProvider({ ...options, fetch: async () => Response.json(response) });
    await assert.rejects(
      bad.posts("access", "123"),
      (e) => e instanceof XFailure && e.code === "X_UNAVAILABLE",
    );
  }
});

test("429 retains Retry-After; transport, malformed and revoked responses are distinct without retries", async () => {
  for (const status of [429, 401, 403, 500, 302]) {
    let calls = 0;
    const provider = createXOAuthProvider({
      ...options,
      fetch: async () => {
        calls++;
        return new Response("private", { status, headers: { "retry-after": "120" } });
      },
    });
    await assert.rejects(
      provider.identity("access"),
      (e) =>
        e instanceof XFailure &&
        e.code ===
          (status === 429
            ? "X_RATE_LIMITED"
            : [401, 403].includes(status)
              ? "X_RECONNECT_REQUIRED"
              : "X_UNAVAILABLE") &&
        !e.message.includes("private"),
    );
    assert.equal(calls, 1);
  }
  const provider = createXOAuthProvider({
    ...options,
    fetch: async () => {
      throw new Error("private transport");
    },
  });
  await assert.rejects(
    provider.refresh("refresh"),
    (e) => e instanceof XFailure && e.code === "X_UNAVAILABLE",
  );
});

test("policy and configuration do not silently enable reads or manufacture tariffs", async () => {
  assert.equal(parseXApiPolicy(), null);
  assert.throws(() => parseXApiPolicy('{"version":1}'));
  const policy = {
    version: 1,
    reviewedAt: "2026-10-07T00:00:00Z",
    identityRequestsPerDay: 5,
    postRequestsPerDay: 2,
    postResourcesPerDay: 40,
  };
  assert.deepEqual(parseXApiPolicy(JSON.stringify(policy)), policy);
  assert.throws(() =>
    createXOAuthProvider({
      ...options,
      redirectUri: "https://evil.example/api/v1/studio/x/callback",
    }),
  );
  let calls = 0;
  const provider = createXOAuthProvider({
    ...options,
    enabled: false,
    fetch: async () => {
      calls++;
      return Response.json(token);
    },
  });
  await assert.rejects(provider.exchange("code", "verifier"), XFailure);
  assert.equal(calls, 0);
});

test("hosted callbacks require the exact canonical origin and path", () => {
  for (const redirectUri of [
    "https://app.pickler.fun:8443/api/v1/studio/x/callback",
    "https://studio.pickler.fun/api/v1/studio/x/callback",
    "https://app.pickler.fun/api/v1/studio/x/callback?next=private",
  ]) {
    assert.throws(
      () => createXOAuthProvider({ ...options, redirectUri }),
      /Invalid X_REDIRECT_URI/,
    );
  }
});

test("disabled post reads never reach X even while OAuth is enabled", async () => {
  let calls = 0;
  const provider = createXOAuthProvider({
    ...options,
    readsEnabled: false,
    fetch: async () => {
      calls++;
      throw new Error("No transport expected");
    },
  });
  await assert.rejects(provider.posts("access", "123"), XFailure);
  assert.equal(provider.available, true);
  assert.equal(calls, 0);
  const policy = {
    version: 2,
    reviewedAt: "2026-10-08T00:00:00Z",
    identityRequestsPerDay: 10,
    postRequestsPerDay: 1,
    postResourcesPerDay: 5,
  };
  assert.deepEqual(parseXApiPolicy(JSON.stringify(policy)), policy);
});

test("identity includes profile decoration in the existing single request", async () => {
  let calls = 0;
  const provider = createXOAuthProvider({
    ...options,
    fetch: async (url) => {
      calls++;
      const request = new URL(String(url));
      assert.equal(request.pathname, "/2/users/me");
      assert.equal(request.searchParams.get("user.fields"), "name,profile_image_url");
      return Response.json({
        data: {
          id: "123",
          username: "ControlledX",
          name: "Controlled creator",
          profile_image_url: "https://pbs.twimg.com/profile_images/123/photo_normal.jpg",
        },
      });
    },
  });

  assert.deepEqual(await provider.identity("access"), {
    id: "123",
    handle: "ControlledX",
    displayName: "Controlled creator",
    profileImageUrl: "https://pbs.twimg.com/profile_images/123/photo_normal.jpg",
  });
  assert.equal(calls, 1);
});

test("missing or unsafe profile decoration does not invalidate the verified identity", async () => {
  for (const image of [
    undefined,
    "http://pbs.twimg.com/profile_images/a.jpg",
    "https://evil.example/a.jpg",
    "https://pbs.twimg.com@evil.example/a.jpg",
    "data:image/svg+xml,private",
    "https://pbs.twimg.com:8443/profile_images/a.jpg",
    "https://pbs.twimg.com/media/a.jpg",
  ]) {
    const provider = createXOAuthProvider({
      ...options,
      fetch: async () =>
        Response.json({
          data: { id: "123", username: "ControlledX", name: null, profile_image_url: image },
        }),
    });

    assert.deepEqual(await provider.identity("access"), {
      id: "123",
      handle: "ControlledX",
      displayName: null,
      profileImageUrl: null,
    });
  }
});
