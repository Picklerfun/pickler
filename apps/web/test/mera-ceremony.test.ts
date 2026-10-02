import { test } from "node:test";
import assert from "node:assert/strict";
import frozen from "@pickler/mera-account/vectors.json";
import { hexToBytes, recoverMessageAddress, type Hex } from "viem";
import { signIn } from "../src/features/wallet/lib/connect";
import {
  PrfUnavailableError,
  runMeraCeremony,
  WrongPasskeyError,
  type PrfSource,
} from "../src/features/wallet/lib/mera-ceremony";
import { loadMeraKit } from "../src/features/wallet/lib/mera-kit";

/* The ceremony with its parts injected: a passkey prompt that answers with a recorded PRF output,
   and an API that answers like workers/api. The key handling and the signature are the real
   libraries — the same ones the browser loads. One behaviour per test. */

const [first, second] = frozen.vectors;
const MESSAGE = "pickler.fun wants you to sign in with your Ethereum account:\nNonce: n-1";

function passkey(prfOutputHex: string) {
  const prfOutput = hexToBytes(prfOutputHex as Hex);
  const prf: PrfSource = async () => ({ credentialId: "cred-1", prfOutput });
  return { prf, prfOutput };
}

/** The two routes sign-in talks to, recording what reached them. */
function api(over: { verifyStatus?: number; throwOn?: string } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    if (over.throwOn && String(url).endsWith(over.throwOn)) {
      throw new TypeError("network down");
    }
    if (String(url).endsWith("/nonce")) {
      return Response.json({ data: { nonce: "n-1", message: MESSAGE } });
    }
    if (over.verifyStatus) {
      return Response.json({ message: "refused" }, { status: over.verifyStatus });
    }
    return Response.json({
      data: { userId: "user-1", session: { accessToken: "at", refreshToken: "rt" } },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function ceremony(
  prf: PrfSource,
  fetchImpl: typeof fetch,
  expectedAddress?: string,
): ReturnType<typeof runMeraCeremony> {
  const kit = await loadMeraKit();
  return runMeraCeremony({
    prf,
    kit,
    chainId: 10143,
    signIn: (signer) => signIn(signer, fetchImpl, "mera"),
    ...(expectedAddress ? { expectedAddress } : {}),
  });
}

test("the passkey opens the account the app derives from it", async () => {
  for (const vector of frozen.vectors) {
    const { prf } = passkey(vector.prfOutput);

    const opened = await ceremony(prf, api().fetchImpl);

    assert.equal(opened!.address, vector.accounts[0]!.address);
    assert.equal(opened!.credentialId, "cred-1");
  }
});

test("it signs the server's message exactly, as the account it opened, and says it is Mera", async () => {
  const { prf } = passkey(first!.prfOutput);
  const { calls, fetchImpl } = api();

  const opened = await ceremony(prf, fetchImpl);

  const [nonce, verify] = calls;
  assert.deepEqual(nonce!.body, { address: first!.accounts[0]!.address, chain_id: 10143 });
  assert.equal(verify!.body.raw, MESSAGE);
  assert.equal(verify!.body.kind, "mera");
  assert.equal(
    await recoverMessageAddress({ message: MESSAGE, signature: verify!.body.signature as Hex }),
    first!.accounts[0]!.address,
  );
  assert.deepEqual(opened!.session, {
    userId: "user-1",
    session: { accessToken: "at", refreshToken: "rt" },
  });
});

test("the PRF output is zeroed once the ceremony is over", async () => {
  const { prf, prfOutput } = passkey(first!.prfOutput);

  await ceremony(prf, api().fetchImpl);

  assert.ok(prfOutput.every((byte) => byte === 0));
});

test("it is zeroed when the server refuses the sign-in", async () => {
  const { prf, prfOutput } = passkey(second!.prfOutput);

  await assert.rejects(ceremony(prf, api({ verifyStatus: 401 }).fetchImpl));

  assert.ok(prfOutput.every((byte) => byte === 0));
});

test("it is zeroed when the network fails half-way", async () => {
  const { prf, prfOutput } = passkey(second!.prfOutput);

  await assert.rejects(ceremony(prf, api({ throwOn: "/nonce" }).fetchImpl), /network down/);

  assert.ok(prfOutput.every((byte) => byte === 0));
});

test("a passkey that opens another account is refused before anything is presented", async () => {
  const { prf, prfOutput } = passkey(second!.prfOutput);
  const { calls, fetchImpl } = api();

  await assert.rejects(ceremony(prf, fetchImpl, first!.accounts[0]!.address), WrongPasskeyError);

  assert.deepEqual(calls, []);
  assert.ok(prfOutput.every((byte) => byte === 0));
});

test("the same account again is accepted, whatever the case of its address", async () => {
  const { prf } = passkey(first!.prfOutput);

  const opened = await ceremony(prf, api().fetchImpl, first!.accounts[0]!.address.toLowerCase());

  assert.equal(opened!.address, first!.accounts[0]!.address);
});

test("a closed prompt is an answer, not a failure", async () => {
  const { calls, fetchImpl } = api();

  assert.equal(await ceremony(async () => null, fetchImpl), null);
  assert.deepEqual(calls, []);
});

test("a passkey that gives no PRF output is its own error, so the screen can say what to change", async () => {
  const noPrf: PrfSource = async () => {
    throw new PrfUnavailableError();
  };

  await assert.rejects(ceremony(noPrf, api().fetchImpl), PrfUnavailableError);
});
