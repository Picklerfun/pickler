import assert from "node:assert/strict";
import { test } from "node:test";
// Type-only: apps/web is CommonJS to node's resolver and @pickler/core exports only an "import"
// condition, so a value import would not load. The types are what is wanted here anyway — these
// pin the browser's vocabulary to the API's rather than repeating it in prose.
import type { SUPPORTED_TRANSPORTS } from "@pickler/core";
import type { ChallengeOptionsDto } from "../src/features/auth/lib/custody-api";
import { createPasskey, describeCeremonyFailure } from "../src/features/auth/lib/ceremony";
import type { Attachment } from "../src/features/auth/lib/ceremony";

// `Attachment` and lib.dom's `AuthenticatorAttachment` must be the same two words, or the value
// this module accepts is one the browser would ignore.
const _attachmentIsWhatTheBrowserTakes: AuthenticatorAttachment = {} as Attachment;
void _attachmentIsWhatTheBrowserTakes;

// Every transport the API can put in an exclusion list must be one lib.dom names, which is what
// makes ceremony.ts's narrowing of the server's `string[]` safe rather than hopeful.
const _apiTransportsAreDomTransports: AuthenticatorTransport =
  {} as (typeof SUPPORTED_TRANSPORTS)[number];
void _apiTransportsAreDomTransports;

const bufferOf = (bytes: number[]) => new Uint8Array(bytes).buffer;
const bytesOf = (source: BufferSource) =>
  Array.from(
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  );

// Bytes and their base64url are both written out, independently, rather than one being produced
// from the other by the encoder under test: a fixture built with bufferToBase64url would agree
// with base64urlToBuffer by construction, and a symmetric bug in the pair would go unseen.
const CHALLENGE_BYTES = [0x9f, 0x00, 0xfb, 0xff, 0x2a];
const CHALLENGE_WIRE = "nwD7_yo";
const USER_ID_BYTES = [0x10, 0x20, 0x30, 0xfe, 0xff, 0x01];
const USER_ID_WIRE = "ECAw_v8B";
const EXCLUDED_BYTES = [0xde, 0xad, 0xbe, 0xef];
const EXCLUDED_WIRE = "3q2-7w";
const RAW_ID_BYTES = [0x01, 0xff, 0x80, 0x00, 0xfe];
const RAW_ID_WIRE = "Af-AAP4";
const CLIENT_DATA_BYTES = [0x7b, 0x22, 0x74, 0xfb, 0xff];
const CLIENT_DATA_WIRE = "eyJ0-_8";
const ATTESTATION_BYTES = [0xa3, 0x63, 0xff, 0xfe, 0x00, 0x7f];
const ATTESTATION_WIRE = "o2P__gB_";

/**
 * Records the options it is handed, and fails loudly on every method the ceremony has no
 * business calling. A fake that answered a constant would let a test assert that constant and
 * prove only that the fake ran.
 */
class FakeAuthenticator implements CredentialsContainer {
  readonly asked: PublicKeyCredentialCreationOptions[] = [];
  constructor(private readonly answer: () => Credential | null) {}

  async create(options?: CredentialCreationOptions): Promise<Credential | null> {
    assert.ok(options?.publicKey, "the ceremony must ask for a public key credential");
    this.asked.push(options.publicKey);
    return this.answer();
  }
  async get(): Promise<Credential | null> {
    return assert.fail("createPasskey must not ask the browser for an existing credential");
  }
  async store(): Promise<void> {
    return assert.fail("createPasskey must not store a credential");
  }
  async preventSilentAccess(): Promise<void> {
    return assert.fail("createPasskey must not change silent access");
  }
  /** The single set of options the browser saw. */
  get only(): PublicKeyCredentialCreationOptions {
    assert.equal(this.asked.length, 1, "the browser should have been asked exactly once");
    return this.asked[0]!;
  }
}

/** What a browser hands back. `getTransports` is left off when `transports` is undefined. */
function browserAnswer(transports?: string[]) {
  return {
    id: "the ceremony reads rawId, not this",
    type: "public-key",
    rawId: bufferOf(RAW_ID_BYTES),
    response: {
      clientDataJSON: bufferOf(CLIENT_DATA_BYTES),
      attestationObject: bufferOf(ATTESTATION_BYTES),
      ...(transports ? { getTransports: () => transports } : {}),
    },
  };
}

/** The server's options with some of the optional fields left out, as an older API might. */
const without = (
  options: ChallengeOptionsDto,
  ...keys: ("authenticatorSelection" | "timeout" | "attestation")[]
): ChallengeOptionsDto => {
  const stated = { ...options };
  for (const key of keys) {
    delete stated[key];
  }
  return stated;
};

const serverOptions = (over: Partial<ChallengeOptionsDto> = {}): ChallengeOptionsDto => ({
  challenge: CHALLENGE_WIRE,
  rp: { id: "pickler.xyz", name: "Pickler" },
  user: { id: USER_ID_WIRE, name: "someone@example.com", displayName: "someone@example.com" },
  pubKeyCredParams: [
    { type: "public-key", alg: -7 },
    { type: "public-key", alg: -257 },
  ],
  authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  timeout: 300_000,
  attestation: "none",
  ...over,
});

test("the browser is handed the bytes the server's base64url encodes, and the rest verbatim", async () => {
  const browser = new FakeAuthenticator(() => browserAnswer(["internal"]));
  await createPasskey(browser, serverOptions(), "platform");
  assert.deepEqual(bytesOf(browser.only.challenge), CHALLENGE_BYTES);
  assert.deepEqual(bytesOf(browser.only.user.id), USER_ID_BYTES);
  assert.deepEqual(browser.only.rp, { id: "pickler.xyz", name: "Pickler" });
  assert.equal(browser.only.user.name, "someone@example.com");
  assert.equal(browser.only.user.displayName, "someone@example.com");
  assert.deepEqual(browser.only.pubKeyCredParams, [
    { type: "public-key", alg: -7 },
    { type: "public-key", alg: -257 },
  ]);
  assert.equal(browser.only.timeout, 300_000);
  assert.equal(browser.only.attestation, "none");
});

test("the attachment the caller asks for is the attachment the operating system is given", async () => {
  // "cross-platform" is what turns into a QR code for a phone; sending "platform" for it would
  // silently offer this laptop's own authenticator instead, and still succeed.
  for (const attachment of ["platform", "cross-platform"] satisfies Attachment[]) {
    const browser = new FakeAuthenticator(() => browserAnswer());
    await createPasskey(browser, serverOptions(), attachment);
    assert.equal(browser.only.authenticatorSelection?.authenticatorAttachment, attachment);
    assert.equal(browser.only.authenticatorSelection?.residentKey, "preferred");
    assert.equal(browser.only.authenticatorSelection?.userVerification, "preferred");
  }
});

test("a server that states no authenticatorSelection still gets the attachment and the defaults", async () => {
  const browser = new FakeAuthenticator(() => browserAnswer());
  await createPasskey(
    browser,
    without(serverOptions(), "authenticatorSelection"),
    "cross-platform",
  );
  assert.deepEqual(browser.only.authenticatorSelection, {
    authenticatorAttachment: "cross-platform",
    residentKey: "preferred",
    userVerification: "preferred",
  });
});

test("the server's own residentKey and userVerification are not overwritten", async () => {
  const browser = new FakeAuthenticator(() => browserAnswer());
  await createPasskey(
    browser,
    serverOptions({
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    }),
    "platform",
  );
  assert.equal(browser.only.authenticatorSelection?.residentKey, "required");
  assert.equal(browser.only.authenticatorSelection?.userVerification, "required");
});

test("attestation defaults to none when the server states none", async () => {
  const browser = new FakeAuthenticator(() => browserAnswer());
  await createPasskey(browser, without(serverOptions(), "attestation", "timeout"), "platform");
  assert.equal(browser.only.attestation, "none");
  assert.equal(browser.only.timeout, undefined);
});

test("an exclusion list reaches the browser with each id decoded", async () => {
  const browser = new FakeAuthenticator(() => browserAnswer());
  await createPasskey(
    browser,
    serverOptions({
      excludeCredentials: [{ id: EXCLUDED_WIRE, type: "public-key", transports: ["internal"] }],
    }),
    "platform",
  );
  const excluded = browser.only.excludeCredentials;
  assert.equal(excluded?.length, 1);
  assert.deepEqual(bytesOf(excluded![0]!.id), EXCLUDED_BYTES);
  assert.equal(excluded![0]!.type, "public-key");
  assert.deepEqual(excluded![0]!.transports, ["internal"]);
});

test("no exclusion list, and an empty one, leave the key off the options entirely", async () => {
  // An empty array is not the same as an absent field: some authenticators treat an empty
  // excludeCredentials as a list they must consult and refuse, so it must not be sent.
  for (const over of [{}, { excludeCredentials: [] }] satisfies Partial<ChallengeOptionsDto>[]) {
    const browser = new FakeAuthenticator(() => browserAnswer());
    await createPasskey(browser, serverOptions(over), "platform");
    assert.equal(
      "excludeCredentials" in browser.only,
      false,
      `excludeCredentials must be absent, not empty, for ${JSON.stringify(over)}`,
    );
  }
});

test("the attestation is encoded back to base64url and the transports normalised", async () => {
  const browser = new FakeAuthenticator(() => browserAnswer(["HYBRID"]));
  const attestation = await createPasskey(browser, serverOptions(), "cross-platform");
  assert.deepEqual(attestation, {
    credentialId: RAW_ID_WIRE,
    clientDataJson: CLIENT_DATA_WIRE,
    attestationObject: ATTESTATION_WIRE,
    transports: ["hybrid"],
  });
});

test("an authenticator with no getTransports is reported as internal", async () => {
  const browser = new FakeAuthenticator(() => browserAnswer());
  const attestation = await createPasskey(browser, serverOptions(), "platform");
  assert.deepEqual(attestation.transports, ["internal"]);
});

test("a browser that returns no credential throws rather than answering with nothing", async () => {
  const browser = new FakeAuthenticator(() => null);
  await assert.rejects(
    () => createPasskey(browser, serverOptions(), "platform"),
    /passkey/i,
    "a null credential must not become an attestation of empty strings",
  );
  assert.equal(browser.asked.length, 1);
});

test("a cancelled ceremony is a decision, not an error", () => {
  assert.equal(describeCeremonyFailure(new DOMException("cancelled", "NotAllowedError")), null);
});

test("every other ceremony failure gets a message that says what to do about it", () => {
  const described = (name: string) => describeCeremonyFailure(new DOMException("x", name));
  assert.match(described("InvalidStateError")!, /already has a passkey/i);
  assert.match(described("SecurityError")!, /address/i);
  assert.match(described("NotSupportedError")!, /support/i);
  assert.match(described("AbortError")!, /again/i);
  // Not every failure arrives as a DOMException, or even as an Error.
  assert.match(describeCeremonyFailure(new Error("network went away"))!, /again/i);
  assert.match(describeCeremonyFailure("a bare string")!, /again/i);
  assert.match(describeCeremonyFailure(undefined)!, /again/i);
  // The four named branches must not collapse into one another.
  const messages = ["InvalidStateError", "SecurityError", "NotSupportedError", "AbortError"].map(
    (name) => described(name),
  );
  assert.equal(new Set(messages).size, 4);
});
