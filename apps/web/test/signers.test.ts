import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromViemAccount,
  fromInjectedProvider,
  PasskeyUnusableError,
  describeSignerFailure,
} from "../src/features/wallet/lib/signers";

// The SIWE string the server built, with the trailing newline connect.test.ts is careful about.
// Every assertion below that claims a string was signed unchanged compares against this one.
const MESSAGE = "pickler.fun wants you to sign in…\nNonce: n1\n";

/**
 * A MeraError as the library actually constructs one. Verified against the published
 * @category-labs/mera@0.2.0 artifact: `name` is "MeraError" and `code` is an own property.
 * Building it here rather than importing keeps this module free of the SDK; see signers.ts.
 */
function meraError(code: string, message: string) {
  const error = new Error(message);
  error.name = "MeraError";
  Object.assign(error, { code });
  return error;
}

test("a viem account becomes a Signer that signs the string it is given", async () => {
  const signed: string[] = [];
  const signer = fromViemAccount(
    {
      address: "0xAbC0000000000000000000000000000000000001",
      signMessage: async ({ message }: { message: string }) => {
        signed.push(message);
        return "0xsig";
      },
    },
    10143,
  );

  assert.equal(await signer.signMessage(MESSAGE), "0xsig");
  // Signed unchanged: the server built this string and verifies that exact one.
  assert.deepEqual(signed, [MESSAGE]);
  assert.equal(signer.address, "0xAbC0000000000000000000000000000000000001");
  assert.equal(signer.chainId, 10143);
});

test("an injected wallet signs the same string unchanged, hex-encoded for personal_sign", async () => {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const signer = fromInjectedProvider(
    {
      request: async (args: { method: string; params?: unknown[] | object }) => {
        calls.push(args);
        return "0xeoasig";
      },
    },
    "0xDeF0000000000000000000000000000000000002",
    10143,
  );

  assert.equal(await signer.signMessage(MESSAGE), "0xeoasig");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "personal_sign");

  // personal_sign takes [data, address]. The data is the message hex-encoded, and decoding it has
  // to give back the server's string byte for byte — a lost trailing newline or a mangled ellipsis
  // fails verification in a way that looks like the wrong wallet.
  const [data, address] = calls[0].params as [string, string];
  assert.equal(Buffer.from(data.slice(2), "hex").toString("utf8"), MESSAGE);
  assert.equal(address, "0xDeF0000000000000000000000000000000000002");
});

test("a passkey with no PRF output is its own failure, not a generic error", () => {
  const caught = describeSignerFailure(
    meraError("PRF_UNAVAILABLE", "Authenticator did not enable PRF"),
  );
  assert.ok(caught instanceof PasskeyUnusableError);
});

test("a cancelled passkey prompt stays an ordinary refusal", () => {
  // The everyday case, and the one a message-matching rule gets wrong: the SDK call that failed is
  // still createPasskeyWithPrfOutput, so anything reading the text rather than the code blames a
  // passkey that is perfectly fine.
  const caught = describeSignerFailure(
    meraError(
      "PASSKEY_OPERATION_FAILED",
      "createPasskeyWithPrfOutput: the person dismissed the prompt",
    ),
  );
  assert.ok(!(caught instanceof PasskeyUnusableError));
  assert.equal(caught.message, "createPasskeyWithPrfOutput: the person dismissed the prompt");
});

test("an ordinary refusal stays an ordinary refusal", () => {
  const caught = describeSignerFailure(new Error("User rejected the request"));
  assert.ok(!(caught instanceof PasskeyUnusableError));
  assert.equal(caught.message, "User rejected the request");
});

test("something thrown that is not an Error still becomes one", () => {
  const caught = describeSignerFailure("wallet exploded");
  assert.ok(caught instanceof Error);
  assert.equal(caught.message, "wallet exploded");
});
