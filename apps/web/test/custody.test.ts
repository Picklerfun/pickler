import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/features/auth/lib/pickler-api";
import type {
  AddedPasskeyDto,
  ChallengeOptionsDto,
  RegisteredWalletDto,
  SignedActivityDto,
  UnsignedActivityDto,
} from "../src/features/auth/lib/custody-api";
import {
  SessionExpired,
  addPasskey,
  alreadyEnrolled,
  createWallet,
  describeCustodyFailure,
  isEnrolledHere,
  landing,
  markEnrolled,
  openChallenge,
  type CustodyDeps,
} from "../src/features/auth/lib/custody";

// The credential the fake authenticator answers with, and the base64url the API must receive for
// it. The wire strings are written out rather than produced by bufferToBase64url: a fixture built
// with the encoder under the code under test would agree with it by construction.
const RAW_ID = [0x01, 0x02];
const RAW_ID_WIRE = "AQI";
const CLIENT_DATA = [0x03];
const CLIENT_DATA_WIRE = "Aw";
const ATTESTATION = [0x04];
const ATTESTATION_WIRE = "BA";

const bufferOf = (bytes: number[]) => new Uint8Array(bytes).buffer;

const CREDENTIAL = {
  rawId: bufferOf(RAW_ID),
  response: {
    clientDataJSON: bufferOf(CLIENT_DATA),
    attestationObject: bufferOf(ATTESTATION),
    getTransports: () => ["hybrid"],
  },
} as unknown as Credential;

const OPTIONS: ChallengeOptionsDto = {
  challenge: "nwD7_yo",
  rp: { id: "pickler.xyz", name: "Pickler" },
  user: { id: "ECAw_v8B", name: "a@b.co", displayName: "a@b.co" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};

const WALLET: RegisteredWalletDto = {
  sub_organization_id: "sub-1",
  master_wallet_id: "wal-1",
  address: "0xabc",
};

const ACTIVITY: UnsignedActivityDto = {
  url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
  body: '{"type":"CREATE_AUTHENTICATORS"}',
  timestampMs: "1758499200000",
  organizationId: "sub-1",
};

const STAMP: SignedActivityDto["stamp"] = {
  stampHeaderName: "X-Stamp-Webauthn",
  stampHeaderValue: "stamped",
};

const ADDED: AddedPasskeyDto = { activity_id: "act-1", status: "COMPLETED" };

/**
 * Records every call in one list so the order across collaborators can be asserted, not just the
 * arguments each was handed. A collaborator that is never reached leaves no entry, which is what
 * the negative assertions below read.
 */
class Recorder {
  readonly calls: string[] = [];
  readonly asked: PublicKeyCredentialCreationOptions[] = [];
  readonly tokens: string[] = [];
  readonly registered: unknown[] = [];
  readonly prepared: unknown[] = [];
  readonly stamped: { rpId: string; body: string }[] = [];
  readonly confirmed: unknown[] = [];
  readonly steps: (1 | 2)[] = [];
  /** A different token each read, so a cached one cannot pass for a fresh one. */
  private reads = 0;

  constructor(private readonly outcomes: Partial<Record<string, () => never>> = {}) {}

  private check(name: string) {
    this.calls.push(name);
    this.outcomes[name]?.();
  }

  readonly deps: CustodyDeps = {
    token: async () => {
      this.check("token");
      this.reads += 1;
      const token = `jwt-${this.reads}`;
      this.tokens.push(token);
      return token;
    },
    credentials: {
      create: async (options?: CredentialCreationOptions) => {
        assert.ok(options?.publicKey, "the ceremony must ask for a public key credential");
        this.asked.push(options.publicKey);
        this.check("create");
        return CREDENTIAL;
      },
      get: () => assert.fail("nothing here asks for an existing credential"),
      preventSilentAccess: () => assert.fail("not used"),
      store: () => assert.fail("not used"),
    } as unknown as CredentialsContainer,
    api: {
      challenge: async (token: string) => {
        this.check("challenge");
        this.tokens.push(`challenge:${token}`);
        return OPTIONS;
      },
      register: async (token: string, input: unknown) => {
        this.check("register");
        this.registered.push({ token, input });
        return WALLET;
      },
      prepareAdd: async (token: string, input: unknown) => {
        this.check("prepareAdd");
        this.prepared.push({ token, input });
        return ACTIVITY;
      },
      confirmAdd: async (token: string, input: unknown) => {
        this.check("confirmAdd");
        this.confirmed.push({ token, input });
        return ADDED;
      },
    },
    stamp: async (rpId: string, body: string) => {
      this.check("stamp");
      this.stamped.push({ rpId, body });
      return STAMP;
    },
  };

  step = (step: 1 | 2) => {
    this.steps.push(step);
  };
}

const throwing = (error: unknown) => () => {
  throw error;
};

const cancelled = () => {
  const error = new Error("The operation either timed out or was not allowed");
  error.name = "NotAllowedError";
  return error;
};

test("the challenge is fetched with the session token, before any prompt", async () => {
  const fake = new Recorder();
  assert.deepEqual(await openChallenge(fake.deps), OPTIONS);
  assert.deepEqual(fake.calls, ["token", "challenge"]);
  assert.deepEqual(fake.tokens, ["jwt-1", "challenge:jwt-1"]);
});

test("the first passkey is created on this device and registered against its own challenge", async () => {
  const fake = new Recorder();
  const created = await createWallet(fake.deps, { options: OPTIONS, label: "Chrome on macOS" });

  // The account, plus the credential this device made: the caller checks the account holds it.
  assert.deepEqual(created, { ...WALLET, credentialId: RAW_ID_WIRE });
  // The ceremony runs before the token is read, so nothing is awaited between the click and the
  // operating system's prompt: an await there costs the transient user activation Safari needs.
  assert.deepEqual(fake.calls, ["create", "token", "register"]);
  assert.equal(fake.asked[0]?.authenticatorSelection?.authenticatorAttachment, "platform");
  assert.deepEqual(fake.registered, [
    {
      token: "jwt-1",
      input: {
        label: "Chrome on macOS",
        challenge: OPTIONS.challenge,
        attestation: {
          credentialId: RAW_ID_WIRE,
          clientDataJson: CLIENT_DATA_WIRE,
          attestationObject: ATTESTATION_WIRE,
          transports: ["hybrid"],
        },
      },
    },
  ]);
});

test("a dismissed first prompt registers nothing", async () => {
  const fake = new Recorder({ create: throwing(cancelled()) });
  await assert.rejects(
    createWallet(fake.deps, { options: OPTIONS, label: "Chrome on macOS" }),
    /not allowed/,
  );
  assert.deepEqual(fake.calls, ["create"]);
  assert.deepEqual(fake.registered, [], "a cancelled ceremony must not reach the server");
});

test("a backup passkey asks for a cross-platform authenticator and is stamped in", async () => {
  const fake = new Recorder();
  const added = await addPasskey(fake.deps, {
    options: OPTIONS,
    label: "Backup passkey",
    attachment: "cross-platform",
    onStep: fake.step,
  });

  assert.deepEqual(added, ADDED);
  assert.deepEqual(fake.calls, ["create", "token", "prepareAdd", "stamp", "token", "confirmAdd"]);
  assert.equal(fake.asked[0]?.authenticatorSelection?.authenticatorAttachment, "cross-platform");
  assert.deepEqual(fake.steps, [1, 2]);
  // The stamp can sit for minutes while somebody finds their phone, so the token that writes is
  // read again after it rather than being the one the prepare used.
  assert.deepEqual(fake.prepared, [
    {
      token: "jwt-1",
      input: {
        label: "Backup passkey",
        challenge: OPTIONS.challenge,
        attestation: {
          credentialId: RAW_ID_WIRE,
          clientDataJson: CLIENT_DATA_WIRE,
          attestationObject: ATTESTATION_WIRE,
          transports: ["hybrid"],
        },
      },
    },
  ]);
  assert.deepEqual(fake.stamped, [{ rpId: OPTIONS.rp.id, body: ACTIVITY.body }]);
  assert.deepEqual(fake.confirmed, [
    {
      token: "jwt-2",
      input: {
        label: "Backup passkey",
        credentialId: RAW_ID_WIRE,
        transports: ["hybrid"],
        signed: { url: ACTIVITY.url, body: ACTIVITY.body, stamp: STAMP },
      },
    },
  ]);
});

test("a new device saves its own platform passkey before the phone approves it", async () => {
  const fake = new Recorder();
  await addPasskey(fake.deps, {
    options: OPTIONS,
    label: "Chrome on macOS",
    attachment: "platform",
    onStep: fake.step,
  });
  assert.equal(fake.asked[0]?.authenticatorSelection?.authenticatorAttachment, "platform");
  assert.deepEqual(fake.calls, ["create", "token", "prepareAdd", "stamp", "token", "confirmAdd"]);
});

test("a dismissed stamp confirms nothing", async () => {
  const fake = new Recorder({ stamp: throwing(cancelled()) });
  await assert.rejects(
    addPasskey(fake.deps, {
      options: OPTIONS,
      label: "Backup passkey",
      attachment: "cross-platform",
      onStep: fake.step,
    }),
    /not allowed/,
  );
  // The credential exists on the device by now. What must not exist is a half-written account:
  // confirmAdd is the only call that changes one, and it was never reached.
  assert.deepEqual(fake.calls, ["create", "token", "prepareAdd", "stamp"]);
  assert.deepEqual(fake.confirmed, [], "a cancelled stamp must not reach the confirm route");
  assert.deepEqual(fake.steps, [1, 2]);
});

test("a prepare that fails never asks for a stamp", async () => {
  const fake = new Recorder({
    prepareAdd: throwing(new ApiError(400, "Spent", "bad_challenge", "")),
  });
  await assert.rejects(
    addPasskey(fake.deps, {
      options: OPTIONS,
      label: "Backup passkey",
      attachment: "cross-platform",
    }),
    ApiError,
  );
  assert.deepEqual(fake.stamped, [], "there is nothing to stamp when there is no activity");
  assert.deepEqual(fake.confirmed, []);
});

test("an expired session is named as one, whichever way it arrives", () => {
  const expired = "Your sign-in expired while that was open. Sign in again — nothing was created.";
  assert.equal(describeCustodyFailure(new SessionExpired()), expired);
  assert.equal(
    describeCustodyFailure(new ApiError(401, "Bearer JWT required", undefined, "")),
    expired,
  );
});

test("a dismissed prompt stays nothing to report, and every other failure keeps its own words", () => {
  assert.equal(describeCustodyFailure(cancelled()), null);
  const taken = new Error("already");
  taken.name = "InvalidStateError";
  assert.equal(
    describeCustodyFailure(taken),
    "This device already has a passkey for your account. Use it to sign in instead.",
  );
  assert.equal(
    describeCustodyFailure(new ApiError(500, "boom", undefined, "")),
    "Setting up the passkey did not finish. Please try again.",
  );
});

test("a refused duplicate is recognised as the authenticator answering, not as a fault", () => {
  const duplicate = new Error("The authenticator already holds a credential");
  duplicate.name = "InvalidStateError";
  assert.equal(alreadyEnrolled(duplicate), true);
  // Everything else must stay a failure: reading a cancellation or a network fault as "you are
  // already enrolled" would send somebody to a wallet screen on no evidence at all.
  assert.equal(alreadyEnrolled(cancelled()), false);
  assert.equal(alreadyEnrolled(new ApiError(401, "Bearer JWT required", undefined, "")), false);
  assert.equal(alreadyEnrolled(new SessionExpired()), false);
  assert.equal(alreadyEnrolled("InvalidStateError"), false, "a string is not an error");
  assert.equal(alreadyEnrolled(null), false);
});

test("where a signed-in person belongs follows what the account holds, wallet first", () => {
  const wallet = { address: "0xabc", balances: {} } as never;
  // No wallet is the passkey step whatever the profile: the handle is saved only after it.
  assert.equal(landing({ handle: null, wallet: null, enrolledHere: false }), "passkey");
  assert.equal(landing({ handle: null, wallet: null, enrolledHere: true }), "passkey");
  assert.equal(landing({ handle: "nightowl", wallet: null, enrolledHere: true }), "passkey");
  // A wallet and no profile is the handle step, marked or not.
  assert.equal(landing({ handle: null, wallet, enrolledHere: true }), "handle");
  assert.equal(landing({ handle: null, wallet, enrolledHere: false }), "handle");
  assert.equal(landing({ handle: "nightowl", wallet, enrolledHere: true }), "welcome");
  assert.equal(landing({ handle: "nightowl", wallet, enrolledHere: false }), "recover");
});

test("the browser remembers which accounts it has made a passkey for", () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  assert.equal(isEnrolledHere(fake, "user-1"), false);
  markEnrolled(fake, "user-1");
  assert.equal(isEnrolledHere(fake, "user-1"), true);
  assert.equal(isEnrolledHere(fake, "user-2"), false, "one account's passkey is not another's");
});

test("a browser that refuses storage reads as one that has never enrolled", () => {
  const refuses = {
    getItem: () => {
      throw new Error("The operation is insecure");
    },
    setItem: () => {
      throw new Error("The operation is insecure");
    },
  };
  assert.equal(isEnrolledHere(refuses, "user-1"), false);
  assert.doesNotThrow(() => markEnrolled(refuses, "user-1"));
  assert.equal(isEnrolledHere(null, "user-1"), false);
});
