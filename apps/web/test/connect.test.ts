import { test } from "node:test";
import assert from "node:assert/strict";
import { join, signIn, ConnectError } from "../src/features/wallet/lib/connect";

// The trailing newline is load-bearing, not untidiness. This fixture exists to catch a client
// that normalises the server's string, and the commonest way to do that — `.trim()` — is
// invisible against a message with no whitespace at its edges. A fixture without it leaves the
// assertion below green through exactly the bug this module is shaped to prevent.
const MESSAGE = "pickler.fun wants you to sign in…\nNonce: n1\n";

function fakeFetch(steps: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const step = steps.shift()!;
    return new Response(JSON.stringify(step.body), { status: step.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("it signs the string the server sent, unchanged", async () => {
  const signed: string[] = [];
  const { impl, calls } = fakeFetch([
    { status: 200, body: { data: { nonce: "n1", message: MESSAGE } } },
    {
      status: 200,
      body: { data: { userId: "u1", session: { accessToken: "at", refreshToken: "rt" } } },
    },
  ]);
  const result = await signIn(
    {
      address: "0xabc0000000000000000000000000000000000001",
      chainId: 10143,
      signMessage: async (m) => {
        signed.push(m);
        return "0xsig";
      },
    },
    impl,
  );
  assert.deepEqual(signed, [MESSAGE]);
  // And it posts back exactly that string, not a rebuilt one.
  assert.equal((calls[1]!.body as { raw: string }).raw, MESSAGE);
  assert.equal(result.userId, "u1");
});

test("a refusal surfaces its code, so the screen can tell apart a stale nonce from a bad signature", async () => {
  const { impl } = fakeFetch([
    { status: 200, body: { data: { nonce: "n1", message: MESSAGE } } },
    { status: 400, body: { error: "nonce_invalid", message: "Ask for a new one" } },
  ]);
  await assert.rejects(
    () =>
      signIn(
        {
          address: "0xabc0000000000000000000000000000000000001",
          chainId: 10143,
          signMessage: async () => "0xsig",
        },
        impl,
      ),
    (caught: ConnectError) => caught.code === "nonce_invalid",
  );
});

test("a failure to get a nonce never reaches the wallet", async () => {
  let asked = false;
  const { impl } = fakeFetch([{ status: 500, body: {} }]);
  await assert.rejects(
    () =>
      signIn(
        {
          address: "0xabc0000000000000000000000000000000000001",
          chainId: 10143,
          signMessage: async () => {
            asked = true;
            return "0xsig";
          },
        },
        impl,
      ),
    // It has to be the deliberate refusal, not merely "something threw". Delete the response check
    // entirely and `issued` is undefined, so reading `issued.message` throws a TypeError before the
    // wallet is reached — the prompt is skipped by accident of evaluation order rather than by the
    // guard that is supposed to skip it, and a bare `rejects` cannot tell those two apart.
    (caught: ConnectError) => caught instanceof ConnectError && caught.code === "500",
  );
  // Prompting for a signature that cannot be used trains people to approve prompts.
  assert.equal(asked, false);
});

test("joining presents the other wallet's signature with the session of the account given up", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({
      data: { userId: "kept", session: { accessToken: "at-kept", refreshToken: "rt-kept" } },
    });
  }) as typeof fetch;

  const kept = await join("the server's message", "0xsig", "token-of-the-new-account", fetchImpl);

  assert.deepEqual(kept, {
    userId: "kept",
    session: { accessToken: "at-kept", refreshToken: "rt-kept" },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "/api/v1/auth/wallet/join");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>).Authorization,
    "Bearer token-of-the-new-account",
  );
  // The string unchanged, and nothing about which kind of wallet: the link it has stands.
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    raw: "the server's message",
    signature: "0xsig",
  });
});

test("a refused join surfaces the API's code, so the screen can say what to do instead", async () => {
  const fetchImpl = (async () =>
    Response.json(
      { message: "That wallet has no Pickler account yet", error: "no_account" },
      { status: 404 },
    )) as typeof fetch;

  await assert.rejects(
    join("m", "0xsig", "t", fetchImpl),
    (caught: unknown) => caught instanceof ConnectError && caught.code === "no_account",
  );
});
