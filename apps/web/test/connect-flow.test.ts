import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED,
  connectFlow,
  type ConnectFlowState,
} from "../src/features/wallet/lib/connect-flow";
import { hasProfile } from "../src/features/wallet/lib/handles";

const opened = connectFlow(CLOSED, { type: "open" });
const connecting = connectFlow(opened, { type: "working" });

test("the chooser opens on the choice, with nothing in the way", () => {
  assert.deepEqual(opened, { step: "choose", busy: false, error: null });
});

test("a passkey wallet that signed in while connecting, with a username, is done", () => {
  const done = connectFlow(connecting, { type: "connected", signedIn: true, hasProfile: true });

  assert.equal(done.step, "closed");
});

test("a passkey wallet that signed in and has no username is asked for one", () => {
  const next = connectFlow(connecting, { type: "connected", signedIn: true, hasProfile: false });

  assert.deepEqual(next, { step: "username", busy: false, error: null });
});

test("a browser wallet that connected still has to sign in", () => {
  const next = connectFlow(connecting, { type: "connected", signedIn: false, hasProfile: null });

  assert.deepEqual(next, { step: "signin", busy: false, error: null });
});

test("after signing in, a browser wallet is asked for a username only when it has none", () => {
  const signing = connectFlow({ step: "signin", busy: false, error: null }, { type: "working" });

  assert.equal(connectFlow(signing, { type: "signed_in", hasProfile: false }).step, "username");
  assert.equal(connectFlow(signing, { type: "signed_in", hasProfile: true }).step, "closed");
});

test("a profile that could not be read does not hold anybody in the chooser", () => {
  // Unknown is not "none": asking for a username the account may already have would be wrong,
  // and the portfolio asks again when it can read the answer.
  assert.equal(
    connectFlow(connecting, { type: "connected", signedIn: true, hasProfile: null }).step,
    "closed",
  );
});

test("a closed prompt puts the step back as it was, with nothing to say", () => {
  const signing = connectFlow({ step: "signin", busy: false, error: "old" }, { type: "working" });

  assert.deepEqual(connectFlow(connecting, { type: "prompt_closed" }), opened);
  assert.deepEqual(connectFlow(signing, { type: "prompt_closed" }), {
    step: "signin",
    busy: false,
    error: null,
  });
});

test("a failure stays on its step and says what happened", () => {
  const failed = connectFlow(connecting, { type: "failed", error: "That did not go through." });

  assert.deepEqual(failed, { step: "choose", busy: false, error: "That did not go through." });
});

test("a passkey with no PRF output gets its own step, and a way to the browser wallet", () => {
  const prf = connectFlow(connecting, { type: "prf_unavailable" });

  assert.deepEqual(prf, { step: "prf", busy: false, error: null });
  assert.deepEqual(connectFlow(prf, { type: "back" }), opened);
});

test("claiming the username, or closing at any step, ends the flow", () => {
  const username: ConnectFlowState = { step: "username", busy: false, error: null };

  assert.equal(connectFlow(username, { type: "claimed" }).step, "closed");
  for (const step of ["choose", "signin", "username", "prf"] as const) {
    assert.equal(connectFlow({ step, busy: true, error: "x" }, { type: "close" }).step, "closed");
  }
});

test("working clears the last error and marks the step busy", () => {
  const retry = connectFlow({ step: "choose", busy: false, error: "old" }, { type: "working" });

  assert.deepEqual(retry, { step: "choose", busy: true, error: null });
});

const answering = (status: number) =>
  (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token-1");
    return Response.json({ data: {} }, { status });
  }) as typeof fetch;

test("an account has a profile, has none, or nobody could tell", async () => {
  assert.equal(await hasProfile("token-1", answering(200)), true);
  assert.equal(await hasProfile("token-1", answering(404)), false);
  assert.equal(await hasProfile("token-1", answering(503)), null);
  assert.equal(
    await hasProfile("token-1", (async () => {
      throw new TypeError("offline");
    }) as typeof fetch),
    null,
  );
});
