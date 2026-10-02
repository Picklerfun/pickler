import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AccountNotJoinableError,
  AddressTakenError,
  AuthenticationRequiredError,
  NoAccountToJoinError,
  SameAccountError,
  WrongPurposeError,
  BadSignatureError,
  buildApiKeyPrincipal,
  buildUserPrincipal,
  createWalletSignIn as createRealWalletSignIn,
  ExpiredNonceError,
  UnknownNonceError,
  WalletAccountConflictError,
  WrongDomainError,
  type createWalletSignIn,
} from "@pickler/core";
import { buildSiweMessage, parseSiweMessage } from "@pickler/infrastructure";
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
    join: async () => {
      calls.push("join");
      return { userId: ANA, session: { accessToken: "at-kept", refreshToken: "rt-kept" } };
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

/**
 * The service itself over the real SIWE builder and parser, wired as the container wires it, with
 * a nonce store that only counts. Malformed input is refused by core and by viem, not by the
 * route, so a stub service could not show what the route answers for it.
 */
function realSignIn() {
  const stored: string[] = [];
  const signIn = createRealWalletSignIn({
    clock: { now: () => new Date("2026-09-29T12:00:00Z") },
    domain: "pickler.fun",
    nonces: {
      issue: async (nonce) => void stored.push(nonce),
      consume: async () => null,
    },
    links: {
      findByAddress: async () => null,
      link: async () => ({ created: true }),
      listForUser: async () => [],
      reassignSole: async () => false,
    },
    verifier: { verify: async () => true },
    accounts: {
      forAddress: async () => ({ userId: ANA, created: true }),
      session: async () => ({ accessToken: "at", refreshToken: "rt" }),
      markWalletAccount: async () => {},
      discardAccount: async () => {},
      isOwnWalletAccount: async () => true,
    },
    hasProfile: async () => false,
    hasCustodyAccount: async () => false,
    randomNonce: () => "b1c93a5f4e2d47a8b0c6e9f1a2d3b4c5",
    buildMessage: (fields) =>
      buildSiweMessage({
        domain: fields.domain,
        address: fields.address as `0x${string}`,
        statement: fields.statement,
        uri: `https://${fields.domain}`,
        chainId: fields.chainReference,
        nonce: fields.nonce,
        issuedAt: fields.issuedAt,
      }),
    parseMessage: parseSiweMessage,
  });
  return { signIn, stored };
}

async function refusal(response: Response) {
  return { status: response.status, error: ((await response.json()) as { error?: string }).error };
}

test("the real service issues a nonce for a well-formed request", async () => {
  const { signIn, stored } = realSignIn();
  const { app } = harness(signIn);
  const response = await post(app, "/v1/auth/wallet/nonce", { address: ADDRESS, chain_id: 10143 });
  assert.equal(response.status, 200);
  assert.equal(stored.length, 1);
});

test("an address that is not one answers 400 invalid_address and stores no nonce", async () => {
  const { signIn, stored } = realSignIn();
  const { app } = harness(signIn);
  const response = await post(app, "/v1/auth/wallet/nonce", { address: "nope", chain_id: 10143 });
  assert.deepEqual(await refusal(response), { status: 400, error: "invalid_address" });
  assert.deepEqual(stored, []);
});

test("a chain id that is not a positive whole number answers 400 invalid_chain", async () => {
  for (const chain of [1.5, 0, -1, 2 ** 60]) {
    const { signIn, stored } = realSignIn();
    const { app } = harness(signIn);
    const response = await post(app, "/v1/auth/wallet/nonce", {
      address: ADDRESS,
      chain_id: chain,
    });
    assert.deepEqual(
      await refusal(response),
      { status: 400, error: "invalid_chain" },
      String(chain),
    );
    assert.deepEqual(stored, []);
  }
});

test("a fractional chain id never reaches the service", async () => {
  const { app, calls } = harness();
  const response = await post(app, "/v1/auth/wallet/nonce", { address: ADDRESS, chain_id: 1.5 });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("an address that is not a string answers 400, not 500", async () => {
  const { signIn, stored } = realSignIn();
  const { app } = harness(signIn);
  const response = await post(app, "/v1/auth/wallet/nonce", {
    address: { toString: "x" },
    chain_id: 10143,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(stored, []);
});

test("a string that is not a sign-in message answers 400 invalid_message", async () => {
  const { signIn } = realSignIn();
  const { app } = harness(signIn);
  for (const path of ["/v1/auth/wallet/verify", "/v1/auth/wallet/link"]) {
    const response = await post(
      app,
      path,
      { raw: "hello", signature: "0xsig" },
      { Authorization: `Bearer ${TOKEN}` },
    );
    assert.deepEqual(await refusal(response), { status: 400, error: "invalid_message" }, path);
  }
});

test("a raw or signature that is not a string answers 400, not 500", async () => {
  const { signIn } = realSignIn();
  const { app } = harness(signIn);
  for (const body of [
    { raw: 12, signature: "0xsig" },
    { raw: "hello", signature: { a: 1 } },
  ]) {
    const response = await post(app, "/v1/auth/wallet/verify", body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("a field the message builder refuses answers 400 invalid_message", async () => {
  // viem's own refusal, recognised by name: the worker does not depend on viem.
  const refused = Object.assign(new Error("Invalid Sign-In with Ethereum message field"), {
    name: "SiweInvalidMessageFieldError",
  });
  const { app } = harness({ issueNonce: () => Promise.reject(refused) });
  const response = await post(app, "/v1/auth/wallet/nonce", { address: ADDRESS, chain_id: 10143 });
  assert.deepEqual(await refusal(response), { status: 400, error: "invalid_message" });
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

test("a sign-in held by a pre-registered account answers 409 wallet_account_conflict, no session", async () => {
  const { app } = harness({ verify: () => Promise.reject(new WalletAccountConflictError()) });
  const response = await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  assert.equal(response.status, 409);
  const body = (await response.json()) as { error?: string; data?: unknown };
  assert.equal(body.error, "wallet_account_conflict");
  assert.equal(body.data, undefined, "no session in the answer");
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

test("the kind of wallet travels to the service on verify and on link, and is optional", async () => {
  const seen: unknown[] = [];
  const { app } = harness({
    verify: async (presented) => {
      seen.push(presented);
      return { userId: ANA, session: { accessToken: "at", refreshToken: "rt" } };
    },
    link: async (_userId, presented) => {
      seen.push(presented);
      return { linked: true as const };
    },
  });

  await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig", kind: "mera" });
  await post(app, "/v1/auth/wallet/verify", { raw: RAW, signature: "0xsig" });
  await post(
    app,
    "/v1/auth/wallet/link",
    { raw: RAW, signature: "0xsig", kind: "eoa" },
    { Authorization: `Bearer ${TOKEN}` },
  );

  assert.deepEqual(seen, [
    { raw: RAW, signature: "0xsig", kind: "mera" },
    { raw: RAW, signature: "0xsig" },
    { raw: RAW, signature: "0xsig", kind: "eoa" },
  ]);
});

test("a kind of wallet nobody offers answers 400 invalid_wallet_kind and reaches no service", async () => {
  const { app, calls } = harness();

  for (const kind of ["turnkey", "smart", 7, null]) {
    const response = await post(app, "/v1/auth/wallet/verify", {
      raw: RAW,
      signature: "0xsig",
      kind,
    });
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 400, String(kind));
    assert.equal(body.error, "invalid_wallet_kind", String(kind));
  }
  assert.deepEqual(calls, []);
});

/* Joining: the caller's bare account is folded into the account of the wallet that signed. */

test("joining needs the session of the account that is given up", async () => {
  const { app, calls, authOptions } = harness({}, null);

  const response = await post(app, "/v1/auth/wallet/join", { raw: RAW, signature: "0xsig" });

  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
  assert.deepEqual(authOptions, [{ userOnly: true }]);
});

test("joining answers with the kept account's session, as the caller, with the other wallet's proof", async () => {
  const seen: unknown[] = [];
  const { app } = harness({
    join: async (userId, presented) => {
      seen.push(userId, presented);
      return { userId: "kept", session: { accessToken: "at-kept", refreshToken: "rt-kept" } };
    },
  });

  const response = await post(
    app,
    "/v1/auth/wallet/join",
    { raw: RAW, signature: "0xsig" },
    { Authorization: `Bearer ${TOKEN}` },
  );

  assert.equal(response.status, 200);
  const { data } = (await response.json()) as { data: unknown };
  assert.deepEqual(data, {
    userId: "kept",
    session: { accessToken: "at-kept", refreshToken: "rt-kept" },
  });
  assert.deepEqual(seen, [ANA, { raw: RAW, signature: "0xsig" }]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("each way a join is refused has a status and a code the browser can branch on", async () => {
  const refusals: [Error, number, string | undefined][] = [
    [new NoAccountToJoinError(), 404, "no_account"],
    [new SameAccountError(), 409, "same_account"],
    [new AccountNotJoinableError("has_profile"), 409, "join_has_profile"],
    [new AccountNotJoinableError("not_wallet_account"), 409, "join_not_wallet_account"],
    [new AccountNotJoinableError("has_custody"), 409, "join_has_custody"],
    [new AccountNotJoinableError("changed"), 409, "join_changed"],
    [new BadSignatureError(), 401, undefined],
    [new UnknownNonceError(), 400, "nonce_invalid"],
    [new WrongPurposeError(), 400, "wrong_purpose"],
  ];
  for (const [thrown, status, code] of refusals) {
    const { app } = harness({ join: () => Promise.reject(thrown) });

    const response = await post(
      app,
      "/v1/auth/wallet/join",
      { raw: RAW, signature: "0xsig" },
      { Authorization: `Bearer ${TOKEN}` },
    );

    assert.equal(response.status, status, thrown.name);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, code, thrown.name);
  }
});

test("a join with no signed message does not reach the service", async () => {
  const { app, calls } = harness();

  const response = await post(
    app,
    "/v1/auth/wallet/join",
    { raw: RAW },
    { Authorization: `Bearer ${TOKEN}` },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

/* What a signature is for is in the message the nonce route hands out. */

const OTHER = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";

test("the nonce route writes a sign-in message, or one that names the wallet being let in", async () => {
  const { signIn } = realSignIn();
  const { app } = harness(signIn);

  const plain = await post(app, "/v1/auth/wallet/nonce", { address: ADDRESS, chain_id: 10143 });
  const joining = await post(app, "/v1/auth/wallet/nonce", {
    address: ADDRESS,
    chain_id: 10143,
    joining: OTHER,
  });

  const message = async (response: Response) =>
    ((await response.json()) as { data: { message: string } }).data.message;
  assert.equal(parseSiweMessage(await message(plain)).statement, "Sign in to Pickler");
  assert.equal(
    parseSiweMessage(await message(joining)).statement,
    // In the one spelling the store keeps, whatever the wallet sent: the sentence `join` compares.
    `Link wallet ${OTHER.toLowerCase()} to this wallet's Pickler account`,
  );
});

test("a wallet to let in that is not an address answers 400 and stores no nonce", async () => {
  for (const joining of ["nope", 7, ""]) {
    const { signIn, stored } = realSignIn();
    const { app } = harness(signIn);

    const response = await post(app, "/v1/auth/wallet/nonce", {
      address: ADDRESS,
      chain_id: 10143,
      joining,
    });

    assert.deepEqual(await refusal(response), { status: 400, error: "invalid_address" });
    assert.deepEqual(stored, [], String(joining));
  }
});

test("a message signed for something else answers 400 wrong_purpose on every route that takes one", async () => {
  for (const path of ["verify", "link", "join"] as const) {
    const { app } = harness({ [path]: () => Promise.reject(new WrongPurposeError()) });

    const response = await post(
      app,
      `/v1/auth/wallet/${path}`,
      { raw: RAW, signature: "0xsig" },
      { Authorization: `Bearer ${TOKEN}` },
    );

    assert.deepEqual(await refusal(response), { status: 400, error: "wrong_purpose" });
  }
});
