import { test } from "node:test";
import assert from "node:assert/strict";
import frozen from "@pickler/mera-account/vectors.json";
import { hexToBytes, recoverMessageAddress, type Hex } from "viem";
import { challenge, present } from "../src/features/wallet/lib/connect";
import { isMeraError, MeraError } from "@category-labs/mera";
import {
  PrfUnavailableError,
  promptFailure,
  runMeraCeremony,
  WrongPasskeyError,
  type MeraKit,
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
function api(
  over: { verifyStatus?: number; throwOn?: string; onCall?: (url: string) => void } = {},
) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    over.onCall?.(String(url));
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
  over: { kit?: MeraKit; onPasskey?: (credentialId: string) => void } = {},
): ReturnType<typeof runMeraCeremony> {
  return runMeraCeremony({
    prf,
    kit: over.kit ?? (await loadMeraKit()),
    challenge: (address) => challenge(address, 10143, fetchImpl),
    present: (message, signature) => present(message, signature, "mera", fetchImpl),
    ...(over.onPasskey ? { onPasskey: over.onPasskey } : {}),
    ...(expectedAddress ? { expectedAddress } : {}),
  });
}

/** The real kit, watched: the key bytes it handed out and whether the signing session was ended. */
async function watchedKit() {
  const real = await loadMeraKit();
  const seen = { key: null as Uint8Array | null, ended: false, signAfterEnd: null as unknown };
  let sign: ((message: string) => Promise<string>) | null = null;
  const kit: MeraKit = {
    privateKeyFromPrf(prfOutput) {
      seen.key = real.privateKeyFromPrf(prfOutput);
      return seen.key;
    },
    openKey(privateKey) {
      const opened = real.openKey(privateKey);
      sign = opened.signMessage;
      return {
        ...opened,
        end() {
          opened.end();
          seen.ended = true;
        },
      };
    },
  };
  const signAgain = () => sign!("anything");
  return { kit, seen, signAgain };
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

test("the PRF output is already zero when the first request leaves", async () => {
  const { prf, prfOutput } = passkey(first!.prfOutput);
  const atRequest: Record<string, boolean> = {};
  const { fetchImpl } = api({
    onCall: (url) => {
      atRequest[url] = prfOutput.every((byte) => byte === 0);
    },
  });

  await ceremony(prf, fetchImpl);

  assert.deepEqual(atRequest, {
    "/api/v1/auth/wallet/nonce": true,
    "/api/v1/auth/wallet/verify": true,
  });
});

test("the key is wiped before the signature is presented, and cannot sign again", async () => {
  const { prf } = passkey(first!.prfOutput);
  const { kit, seen, signAgain } = await watchedKit();
  const atVerify = { ended: false, zero: false };
  const { fetchImpl } = api({
    onCall: (url) => {
      if (url.endsWith("/verify")) {
        atVerify.ended = seen.ended;
        atVerify.zero = seen.key!.every((byte) => byte === 0);
      }
    },
  });

  await ceremony(prf, fetchImpl, undefined, { kit });

  assert.deepEqual(atVerify, { ended: true, zero: true });
  await assert.rejects(signAgain());
});

test("the key is wiped when the challenge never arrives", async () => {
  const { prf } = passkey(second!.prfOutput);
  const { kit, seen, signAgain } = await watchedKit();

  await assert.rejects(
    ceremony(prf, api({ throwOn: "/nonce" }).fetchImpl, undefined, { kit }),
    /network down/,
  );

  assert.equal(seen.ended, true);
  assert.ok(seen.key!.every((byte) => byte === 0));
  await assert.rejects(signAgain());
});

test("the passkey that was just made is named even when the sign-in then fails", async () => {
  const { prf } = passkey(second!.prfOutput);
  const made: string[] = [];

  await assert.rejects(
    ceremony(prf, api({ verifyStatus: 500 }).fetchImpl, undefined, {
      onPasskey: (credentialId) => made.push(credentialId),
    }),
  );

  assert.deepEqual(made, ["cred-1"]);
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

test("a prompt that threw is named: closed, no PRF output, or a real failure", () => {
  // The SDK's own errors, as the browser path gets them.
  const sdk = (code: ConstructorParameters<typeof MeraError>[0], cause?: unknown) =>
    new MeraError(code, "from the SDK", cause === undefined ? undefined : { cause });
  const dom = (name: string) => Object.assign(new Error(name), { name });

  assert.equal(promptFailure(sdk("PRF_UNAVAILABLE"), isMeraError), "no_prf");
  assert.equal(
    promptFailure(sdk("PASSKEY_OPERATION_FAILED", dom("NotAllowedError")), isMeraError),
    "closed",
  );
  assert.equal(
    promptFailure(sdk("PASSKEY_OPERATION_FAILED", dom("AbortError")), isMeraError),
    "closed",
  );
  // A passkey operation that failed for another reason is not the person closing the prompt.
  assert.equal(
    promptFailure(sdk("PASSKEY_OPERATION_FAILED", dom("SecurityError")), isMeraError),
    "failed",
  );
  assert.equal(promptFailure(sdk("PASSKEY_OPERATION_FAILED"), isMeraError), "failed");
  // Not the SDK's error at all: a bare NotAllowedError is not taken for a closed prompt.
  assert.equal(promptFailure(dom("NotAllowedError"), isMeraError), "failed");
  assert.equal(promptFailure(null, isMeraError), "failed");
});
