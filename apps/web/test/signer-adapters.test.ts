import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromInjectedProvider,
  describeSignerFailure,
} from "../src/features/wallet/lib/signer-adapters";

// The SIWE string the server built, with the trailing newline connect.test.ts is careful about.
// Every assertion below that claims a string was signed unchanged compares against this one.
const MESSAGE = "pickler.fun wants you to sign in…\nNonce: n1\n";

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
  const call = calls[0];
  assert.ok(call, "the provider was never asked to sign");
  assert.equal(call.method, "personal_sign");

  // personal_sign takes [data, address] — the reverse of eth_sign, which is where the argument
  // order gets misremembered. The data is the message hex-encoded, and decoding it has to give back
  // the server's string byte for byte: a lost trailing newline or a mangled ellipsis fails
  // verification in a way that looks like the wrong wallet.
  const [data, address] = call.params as [string, string];
  assert.equal(Buffer.from(data.slice(2), "hex").toString("utf8"), MESSAGE);
  assert.equal(address, "0xDeF0000000000000000000000000000000000002");
});

test("an ordinary refusal stays the error the wallet threw", () => {
  const thrown = new Error("User rejected the request");

  assert.equal(describeSignerFailure(thrown), thrown);
});

test("something thrown that is not an Error still becomes one", () => {
  const caught = describeSignerFailure("wallet exploded");
  assert.ok(caught instanceof Error);
  assert.equal(caught.message, "wallet exploded");
});
