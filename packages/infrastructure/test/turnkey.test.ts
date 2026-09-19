import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  InvalidSignedActivityError,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
  type TurnkeyActivity,
} from "@pickler/core";
import { createTurnkeyActivityForwarder, createTurnkeyReader } from "../src/index.js";

function apiKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  return {
    apiPrivateKey: Buffer.from(jwk.d!, "base64url").toString("hex"),
    apiPublicKey: Buffer.concat([Buffer.from([(y[31]! & 1) === 1 ? 3 : 2]), x]).toString("hex"),
    publicKey,
  };
}

/** Verifies Turnkey's X-Stamp exactly as the API does. */
function verifyStamp(header: string, body: string) {
  const stamp = JSON.parse(Buffer.from(header, "base64url").toString()) as {
    publicKey: string;
    scheme: string;
    signature: string;
  };
  const spki = Buffer.concat([
    Buffer.from("3039301306072a8648ce3d020106082a8648ce3d030107032200", "hex"),
    Buffer.from(stamp.publicKey, "hex"),
  ]);
  return {
    scheme: stamp.scheme,
    valid: verify(
      "sha256",
      Buffer.from(body),
      { key: createPublicKey({ key: spki, format: "der", type: "spki" }), dsaEncoding: "der" },
      Buffer.from(stamp.signature, "hex"),
    ),
  };
}

const activity = (status: string, extra: Partial<TurnkeyActivity> = {}): TurnkeyActivity => ({
  id: "act-1",
  fingerprint: "fp",
  status,
  organizationId: "sub-org-1",
  ...extra,
});

test("the parent-key reader stamps requests Turnkey can verify and never follows redirects", async () => {
  const key = apiKey();
  const seen: RequestInit[] = [];
  const reader = createTurnkeyReader({
    apiPublicKey: key.apiPublicKey,
    apiPrivateKey: key.apiPrivateKey,
    fetch: (async (url: string, init: RequestInit) => {
      seen.push(init);
      assert.equal(url, "https://api.turnkey.com/public/v1/query/get_activity");
      const headers = init.headers as Record<string, string>;
      assert.deepEqual(verifyStamp(headers["X-Stamp"]!, String(init.body)), {
        scheme: "SIGNATURE_SCHEME_TK_API_P256",
        valid: true,
      });
      assert.deepEqual(JSON.parse(String(init.body)), {
        organizationId: "sub-org-1",
        activityId: "act-1",
      });
      return Response.json({ activity: activity("ACTIVITY_STATUS_COMPLETED") });
    }) as never,
  });
  assert.equal(
    (await reader.getActivity("sub-org-1", "act-1")).status,
    "ACTIVITY_STATUS_COMPLETED",
  );
  assert.equal(seen[0]!.redirect, "manual");
});

const signed = (
  overrides: { url?: string; body?: Record<string, unknown> | string; header?: string } = {},
) => ({
  url: overrides.url ?? "https://api.turnkey.com/public/v1/submit/create_wallet",
  body:
    typeof overrides.body === "string"
      ? overrides.body
      : JSON.stringify({
          type: "ACTIVITY_TYPE_CREATE_WALLET",
          organizationId: "sub-org-1",
          timestampMs: "1",
          parameters: {},
          ...(overrides.body ?? {}),
        }),
  stamp: {
    stampHeaderName: overrides.header ?? "X-Stamp-WebAuthn",
    stampHeaderValue: "passkey-stamp",
  },
});
const expectations = {
  organizationId: "sub-org-1",
  allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_WALLET"],
};

test("forwarder refuses requests outside the caller's scope before contacting Turnkey", async () => {
  let calls = 0;
  const forwarder = createTurnkeyActivityForwarder({
    reader: { getActivity: async () => activity("ACTIVITY_STATUS_COMPLETED") },
    fetch: (async () => {
      calls++;
      return Response.json({});
    }) as never,
  });
  const bad = [
    signed({ url: "https://evil.example/public/v1/submit/create_wallet" }),
    signed({ url: "https://api.turnkey.com/public/v1/query/get_wallets" }),
    signed({ url: "https://api.turnkey.com/public/v1/submit/create_wallet?x=1" }),
    signed({ url: "not a url" }),
    signed({ body: { type: "ACTIVITY_TYPE_EXPORT_WALLET" } }),
    signed({ body: { organizationId: "someone-else" } }),
    signed({ body: "{broken" }),
    signed({ header: "Authorization" }),
  ];
  for (const request of bad) {
    await assert.rejects(forwarder.forward(request, expectations), InvalidSignedActivityError);
  }
  assert.equal(calls, 0);
});

test("forwarder sends the passkey stamp unchanged and polls briefly to a terminal status", async () => {
  const forwarded: { url: string; headers: Record<string, string>; body: string }[] = [];
  const polls: string[] = [];
  const statuses = ["ACTIVITY_STATUS_PENDING", "ACTIVITY_STATUS_COMPLETED"];
  const forwarder = createTurnkeyActivityForwarder({
    sleep: async () => {},
    reader: {
      getActivity: async (org, id) => {
        polls.push(`${org}/${id}`);
        return activity(statuses.shift()!);
      },
    },
    fetch: (async (url: string, init: RequestInit) => {
      forwarded.push({
        url,
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return Response.json({ activity: activity("ACTIVITY_STATUS_CREATED") });
    }) as never,
  });
  const request = signed();
  const result = await forwarder.forward(request, expectations);
  assert.equal(result.status, "ACTIVITY_STATUS_COMPLETED");
  assert.equal(forwarded[0]!.headers["X-Stamp-WebAuthn"], "passkey-stamp");
  assert.equal(forwarded[0]!.body, request.body);
  assert.deepEqual(polls, ["sub-org-1/act-1", "sub-org-1/act-1"]);
});

test("Turnkey 4xx messages are shown; 5xx, network errors and empty responses are unavailable", async () => {
  const make = (respond: () => Promise<Response>) =>
    createTurnkeyActivityForwarder({
      sleep: async () => {},
      reader: { getActivity: async () => activity("ACTIVITY_STATUS_COMPLETED") },
      fetch: respond as never,
    });

  await assert.rejects(
    make(async () =>
      Response.json({ code: 3, message: "policy denied: amount exceeds limit" }, { status: 400 }),
    ).forward(signed(), expectations),
    (error: unknown) =>
      error instanceof SignedActivityRejectedError &&
      error.message === "policy denied: amount exceeds limit",
  );
  await assert.rejects(
    make(async () => new Response("oops", { status: 503 })).forward(signed(), expectations),
    SigningServiceUnavailableError,
  );
  await assert.rejects(
    make(async () => {
      throw new TypeError("network");
    }).forward(signed(), expectations),
    SigningServiceUnavailableError,
  );
  await assert.rejects(
    make(async () => Response.json({})).forward(signed(), expectations),
    SigningServiceUnavailableError,
  );

  const stuck = createTurnkeyActivityForwarder({
    sleep: async () => {},
    pollAttempts: 2,
    reader: { getActivity: async () => activity("ACTIVITY_STATUS_PENDING") },
    fetch: (async () => Response.json({ activity: activity("ACTIVITY_STATUS_PENDING") })) as never,
  });
  assert.equal((await stuck.forward(signed(), expectations)).status, "ACTIVITY_STATUS_PENDING");
});
