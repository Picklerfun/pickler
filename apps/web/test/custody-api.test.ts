import assert from "node:assert/strict";
import { test } from "node:test";
// Type-only, so nothing is loaded at run time: @pickler/core publishes only an "import"
// condition and apps/web is CommonJS to node's resolver. These are the pins — the DTOs are
// checked against the types the API is built from rather than against a paragraph of prose.
import type {
  ChallengeOptions,
  Passkey,
  PasskeyAttestation,
  SignedActivityRequest,
  UnsignedActivity,
} from "@pickler/core";
import { ApiError } from "../src/features/auth/lib/pickler-api";
import {
  challenge,
  confirmAdd,
  prepareAdd,
  register,
  wallet,
} from "../src/features/auth/lib/custody-api";
import type {
  AttestationDto,
  ChallengeOptionsDto,
  PasskeyDto,
  SignedActivityDto,
  UnsignedActivityDto,
} from "../src/features/auth/lib/custody-api";

// Everything the challenge route can answer with must fit the DTO the ceremony reads.
const _serverOptionsFitTheDto: ChallengeOptionsDto = {} as ChallengeOptions;
void _serverOptionsFitTheDto;
// Both directions for the attestation: the API validates exactly these four keys, and
// `clientDataJson` against the browser's `clientDataJSON` is a one-character mistake to make.
const _attestationIsWhatTheApiValidates: PasskeyAttestation = {} as AttestationDto;
void _attestationIsWhatTheApiValidates;
const _theDtoAcceptsWhatTheApiValidates: AttestationDto = {} as PasskeyAttestation;
void _theDtoAcceptsWhatTheApiValidates;
// timestampMs is decimal text, not a number; this is the line that says so.
const _unsignedActivityFitsTheDto: UnsignedActivityDto = {} as UnsignedActivity;
void _unsignedActivityFitsTheDto;
const _signedActivityFitsTheDto: SignedActivityRequest = {} as SignedActivityDto;
void _signedActivityFitsTheDto;

// PasskeyDto cannot be assigned from core's Passkey the way the others can: GET /passkeys
// snake_cases the keys and serialises both Dates with toISOString(). So the pin is the mapping
// itself. Record<keyof Passkey, ...> fails to compile if core grows a field the DTO has no name
// for — a field the account screen would then never see — and the reverse fails if the DTO grows
// one the route does not send.
const _everyPasskeyFieldReachesTheDto: Record<keyof Passkey, keyof PasskeyDto> = {
  id: "id",
  credentialId: "credential_id",
  label: "label",
  transports: "transports",
  deviceType: "device_type",
  createdAt: "created_at",
  lastUsedAt: "last_used_at",
};
void _everyPasskeyFieldReachesTheDto;
const _everyDtoFieldComesFromOne: Record<keyof PasskeyDto, keyof Passkey> = {
  id: "id",
  credential_id: "credentialId",
  label: "label",
  transports: "transports",
  device_type: "deviceType",
  created_at: "createdAt",
  last_used_at: "lastUsedAt",
};
void _everyDtoFieldComesFromOne;
// The two the route sends null for must stay nullable. `call` casts rather than validates, so a
// DTO narrowed to `string` here would hand the account screen a null it swears cannot happen —
// and the screen reads last_used_at === null as NEVER USED, which is the whole point of it.
const _deviceTypeStaysNullable: PasskeyDto["device_type"] = null;
void _deviceTypeStaysNullable;
const _lastUsedStaysNullable: PasskeyDto["last_used_at"] = null;
void _lastUsedStaysNullable;
// @ts-expect-error the dates cross the wire as ISO text, not as Date objects
const _datesAreText: PasskeyDto["created_at"] = new Date();
void _datesAreText;

const TOKEN = "supabase.jwt.value";

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}

/** Records every request, and answers with the envelope workers/api actually sends. */
function recordFetch(answer: { status?: number; envelope: unknown }) {
  const sent: Sent[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization"),
      contentType: headers.get("Content-Type"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    return new Response(JSON.stringify(answer.envelope), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    sent,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const ok = (data: unknown) => ({ envelope: { success: true, message: "fine", data } });

const ATTESTATION: AttestationDto = {
  credentialId: "Af-AAP4",
  clientDataJson: "eyJ0-_8",
  attestationObject: "o2P__gB_",
  transports: ["internal"],
};

test("each route is reached at the path workers/api mounts, with the token as a bearer header", async (t) => {
  const fetching = recordFetch(ok({}));
  t.after(fetching.restore);
  await challenge(TOKEN);
  await register(TOKEN, { label: "MacBook", challenge: "nwD7_yo", attestation: ATTESTATION });
  await prepareAdd(TOKEN, { label: "iPhone", challenge: "nwD7_yo", attestation: ATTESTATION });
  await confirmAdd(TOKEN, {
    label: "iPhone",
    credentialId: "Af-AAP4",
    transports: ["hybrid"],
    signed: {
      url: "https://api.turnkey.com/x",
      body: "{}",
      stamp: { stampHeaderName: "X-Stamp", stampHeaderValue: "s" },
    },
  });
  await wallet(TOKEN);

  assert.deepEqual(
    fetching.sent.map((request) => `${request.method} ${request.url}`),
    [
      "POST /api/v1/signing/passkeys/challenge",
      "POST /api/v1/signing/passkeys/register",
      "POST /api/v1/signing/passkeys/add/prepare",
      "POST /api/v1/signing/passkeys/add/confirm",
      "GET /api/v1/signing/wallets/me",
    ],
  );
  for (const request of fetching.sent) {
    assert.equal(request.authorization, `Bearer ${TOKEN}`);
    // The token belongs in the header and nowhere else: a query string lands in server logs.
    assert.equal(request.url.includes(TOKEN), false);
    assert.equal(JSON.stringify(request.body ?? null).includes(TOKEN), false);
  }
});

test("the challenge request carries no body, so nothing about it is caller-chosen", async (t) => {
  const fetching = recordFetch(ok({}));
  t.after(fetching.restore);
  await challenge(TOKEN);
  assert.equal(fetching.sent[0]!.body, undefined);
  assert.equal(fetching.sent[0]!.contentType, null);
});

test("register and prepare send the attestation under the keys the API validates", async (t) => {
  const fetching = recordFetch(ok({}));
  t.after(fetching.restore);
  await register(TOKEN, { label: "MacBook", challenge: "nwD7_yo", attestation: ATTESTATION });
  await prepareAdd(TOKEN, { label: "iPhone", challenge: "nwD7_yo", attestation: ATTESTATION });
  for (const request of fetching.sent) {
    assert.deepEqual(request.body, {
      label: request === fetching.sent[0] ? "MacBook" : "iPhone",
      challenge: "nwD7_yo",
      attestation: ATTESTATION,
    });
    assert.equal(request.contentType, "application/json");
  }
});

test("confirm renames credentialId to the credential_id the route reads", async (t) => {
  const fetching = recordFetch(ok({ activity_id: "act_1", status: "ACTIVITY_STATUS_COMPLETED" }));
  t.after(fetching.restore);
  const signed: SignedActivityDto = {
    url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
    body: '{"type":"ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2"}',
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "stamped" },
  };
  const added = await confirmAdd(TOKEN, {
    label: "iPhone",
    credentialId: "Af-AAP4",
    transports: ["hybrid"],
    signed,
  });
  assert.deepEqual(fetching.sent[0]!.body, {
    label: "iPhone",
    credential_id: "Af-AAP4",
    transports: ["hybrid"],
    signed,
  });
  // The camelCase spelling would be dropped by the route's validator, which reads credential_id.
  assert.equal("credentialId" in (fetching.sent[0]!.body as object), false);
  assert.deepEqual(added, { activity_id: "act_1", status: "ACTIVITY_STATUS_COMPLETED" });
});

test("each route unwraps the envelope and answers with its data", async (t) => {
  const walletData = {
    address: "0xabc",
    balances: {
      native: { symbol: "MON", decimals: 18, raw: "1000" },
      token: { symbol: "USDC", decimals: 6, raw: null },
    },
  };
  const fetching = recordFetch(ok(walletData));
  t.after(fetching.restore);
  assert.deepEqual(await wallet(TOKEN), walletData);
});

test("a refused request keeps the status, the code and the reason the API sent", async (t) => {
  // This is why the signing client reuses pickler-api's `call`: a spent challenge (400) and an
  // account with no wallet yet (404) have to stay tellable apart at the call site.
  const fetching = recordFetch({
    status: 400,
    envelope: {
      success: false,
      message: "This passkey request expired. Start again.",
      error: "challenge_not_usable",
      reason: "expired",
    },
  });
  t.after(fetching.restore);
  const caught = await register(TOKEN, {
    label: "MacBook",
    challenge: "nwD7_yo",
    attestation: ATTESTATION,
  }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(caught instanceof ApiError, "a refused envelope must arrive as an ApiError");
  assert.equal(caught.status, 400);
  assert.equal(caught.code, "challenge_not_usable");
  assert.equal(caught.reason, "expired");
  assert.equal(caught.message, "This passkey request expired. Start again.");
});
