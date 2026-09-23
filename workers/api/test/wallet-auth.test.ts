import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressTakenError,
  AuthenticationRequiredError,
  BadSignatureError,
  buildApiKeyPrincipal,
  buildUserPrincipal,
  ExpiredNonceError,
  UnknownNonceError,
  WrongDomainError,
  type createWalletSignIn,
} from "@pickler/core";
import { createApp } from "../src/app.js";

const ANA = "11111111-2222-4333-8444-555555555555";
const ADDRESS = "0xabc0000000000000000000000000000000000001";
const RAW = "pickler.fun wants you to sign in";
const TOKEN = "supabase.jwt.value";

type SignIn = ReturnType<typeof createWalletSignIn>;

/** The four methods a route can reach, each overridable, in the shape signing.test.ts uses. */
function harness(
  over: Partial<SignIn> = {},
  principal: unknown = buildUserPrincipal({ user: { id: ANA } }),
) {
  const authOptions: unknown[] = [];
  const calls: string[] = [];
  const authenticate = async (_credentials: unknown, options?: { userOnly?: boolean }) => {
    authOptions.push(options);
    if (!principal) {
      throw new AuthenticationRequiredError();
    }
    if (options?.userOnly && (principal as { kind: string }).kind !== "user") {
      throw new AuthenticationRequiredError("Bearer JWT required");
    }
    return { principal: principal as never, workspace: null };
  };

  const signIn: SignIn = {
    issueNonce: async (input) => {
      calls.push("issueNonce");
      return {
        nonce: "noncevalue1234",
        message: `${RAW}\nNonce: noncevalue1234\n${input.address}`,
      };
    },
    verify: async () => {
      calls.push("verify");
      return { userId: ANA, session: { accessToken: "at", refreshToken: "rt" } };
    },
    link: async () => {
      calls.push("link");
      return { linked: true as const };
    },
    listLinks: async () => {
      calls.push("listLinks");
      return [];
    },
    ...over,
  };

  const app = createApp({
    authenticate,
    authenticateAgent: async () => {
      throw new Error("unused");
    },
    findWorkspace: async () => null,
    agentQueries: {} as never,
    budgets: {} as never,
    profiles: {} as never,
    walletAuth: { authenticate, signIn },
  });
  return { app, authOptions, calls };
}

const post = (
  app: ReturnType<typeof harness>["app"],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("the nonce route is reachable without a session and returns a string to sign", async () => {
  const { app } = harness();
  const response = await post(app, "/v1/auth/wallet/nonce", { address: ADDRESS, chain_id: 10143 });
  assert.equal(response.status, 200);
  const { data } = (await response.json()) as { data: { nonce: string; message: string } };
  assert.ok(data.message.includes(data.nonce));
});

test("the nonce route refuses a body with no address", async () => {
  const { app, calls } = harness();
  const response = await post(app, "/v1/auth/wallet/nonce", { chain_id: 10143 });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, [], "a malformed body must not reach the service");
});

test("the nonce route refuses a chain id that is not a number", async () => {
  const { app } = harness();
  const response = await post(app, "/v1/auth/wallet/nonce", {
    address: ADDRESS,
    chain_id: "10143",
  });
  assert.equal(response.status, 400);
});

test("a spent nonce answers 400 with nonce_invalid, so the browser can ask for another", async () => {
  const { app } = harness({
    verify: () => Promise.reject(new UnknownNonceError()),
  });
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error?: string }).error, "nonce_invalid");
});

test("an expired nonce is the same answer as a spent one, because both mean ask again", async () => {
  const { app } = harness({ verify: () => Promise.reject(new ExpiredNonceError()) });
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error?: string }).error, "nonce_invalid");
});

test("a signature made for another site answers 400 with wrong_domain", async () => {
  const { app } = harness({ verify: () => Promise.reject(new WrongDomainError()) });
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error?: string }).error, "wrong_domain");
});

/**
 * 401 and no `error` code. The client tells this apart from a stale nonce by the status alone,
 * and the absence of a code is what makes that work — so this asserts the absence too.
 */
test("a bad signature answers 401, which is a different thing from a spent nonce", async () => {
  const { app } = harness({ verify: () => Promise.reject(new BadSignatureError()) });
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  assert.equal(response.status, 401);
  assert.equal(((await response.json()) as { error?: string }).error, undefined);
});

test("verify refuses a body with no signature before reaching the service", async () => {
  const { app, calls } = harness();
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("an address linked to another account answers 409, not 500", async () => {
  const { app } = harness({ link: () => Promise.reject(new AddressTakenError()) });
  const response = await post(
    app,
    "/v1/auth/wallet/link",
    { raw: RAW, signature: "0xsig" },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(response.status, 409);
});

/**
 * A failed read of someone's links must not read as an empty list — the rule the core service is
 * built around. Here that means a 500, because there is no honest 4xx for "we could not read it":
 * the caller did nothing wrong, and answering 200 with `[]` would be the lie.
 */
test("a failed read of the links propagates rather than answering with none", async () => {
  const { app } = harness({
    listLinks: () => Promise.reject(new Error("connection reset")),
  });
  const response = await app.request("/v1/auth/wallet/links", {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(response.status, 500);
});

test("API keys and anonymous callers never reach a wallet sign-in that needs a session", async () => {
  const routes: [string, string][] = [
    ["POST", "/v1/auth/wallet/link"],
    ["GET", "/v1/auth/wallet/links"],
  ];
  const callers = [buildApiKeyPrincipal({ id: "k1", scopes: ["read:agents"] }, "w1"), null];

  for (const caller of callers) {
    for (const [method, path] of routes) {
      const h = harness({}, caller);
      const res = await h.app.request(path, {
        method,
        ...(method === "POST"
          ? { body: "{}", headers: { "Content-Type": "application/json" } }
          : {}),
      });
      assert.equal(res.status, 401, `${method} ${path} must refuse this caller`);
      assert.deepEqual(h.calls, [], `${method} ${path} must not reach the sign-in service`);
      assert.deepEqual(
        h.authOptions,
        [{ userOnly: true }],
        `${method} ${path} must refuse API keys before looking one up`,
      );
    }
  }
});

test("the wallet routes are simply absent when the deployment has no domains configured", async () => {
  const app = createApp({
    authenticate: async () => ({ principal: {} as never, workspace: null }),
    authenticateAgent: async () => {
      throw new Error("unused");
    },
    findWorkspace: async () => null,
    agentQueries: {} as never,
    budgets: {} as never,
    profiles: {} as never,
  });
  const response = await post(app, "/v1/auth/wallet/nonce", { address: ADDRESS, chain_id: 10143 });
  assert.equal(response.status, 404, "unmounted is a 404, which is diagnosable");
});

test("mounting the wallet routes under /v1/auth leaves /v1/auth/me reachable", async () => {
  const { app } = harness();
  const response = await app.request("/v1/auth/me", {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.notEqual(response.status, 404, "the wallet mount must not shadow the existing route");
});
