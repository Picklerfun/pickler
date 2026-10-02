import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED,
  connectFlow,
  type ConnectFlowEvent,
  type ConnectFlowState,
} from "../src/features/wallet/lib/connect-flow";
import { hasProfile, readProfile } from "../src/features/wallet/lib/handles";

const opened = connectFlow(CLOSED, { type: "open" });
const connecting = connectFlow(opened, { type: "working" });

test("the chooser opens on the choice, with nothing in the way", () => {
  assert.deepEqual(opened, { step: "choose", busy: false, error: null, joining: false });
});

test("a passkey wallet that signed in while connecting, with a username, is done", () => {
  const done = connectFlow(connecting, { type: "connected", signedIn: true, hasProfile: true });

  assert.equal(done.step, "closed");
});

test("a passkey wallet that signed in and has no username is asked for one", () => {
  const next = connectFlow(connecting, { type: "connected", signedIn: true, hasProfile: false });

  assert.deepEqual(next, { step: "username", busy: false, error: null, joining: false });
});

test("a browser wallet that connected still has to sign in", () => {
  const next = connectFlow(connecting, { type: "connected", signedIn: false, hasProfile: null });

  assert.deepEqual(next, { step: "signin", busy: false, error: null, joining: false });
});

test("after signing in, a browser wallet is asked for a username only when it has none", () => {
  const signing = connectFlow(
    { step: "signin", busy: false, error: null, joining: false },
    { type: "working" },
  );

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
  const signing = connectFlow(
    { step: "signin", busy: false, error: "old", joining: false },
    { type: "working" },
  );

  assert.deepEqual(connectFlow(connecting, { type: "prompt_closed" }), opened);
  assert.deepEqual(connectFlow(signing, { type: "prompt_closed" }), {
    step: "signin",
    busy: false,
    error: null,
    joining: false,
  });
});

test("a failure stays on its step and says what happened", () => {
  const failed = connectFlow(connecting, {
    type: "failed",
    error: "That did not go through.",
  });

  assert.deepEqual(failed, {
    step: "choose",
    busy: false,
    error: "That did not go through.",
    joining: false,
  });
});

test("a passkey with no PRF output gets its own step, and a way to the browser wallet", () => {
  const prf = connectFlow(connecting, { type: "prf_unavailable" });

  assert.deepEqual(prf, { step: "prf", busy: false, error: null, joining: false });
  assert.deepEqual(connectFlow(prf, { type: "back" }), opened);
});

test("claiming the username, or closing at any step, ends the flow", () => {
  const username: ConnectFlowState = { step: "username", busy: false, error: null, joining: false };

  assert.equal(connectFlow(username, { type: "claimed" }).step, "closed");
  for (const step of ["choose", "signin", "username", "prf", "join", "joined"] as const) {
    const state: ConnectFlowState = { step, busy: true, error: "x", joining: false };
    assert.equal(connectFlow(state, { type: "close" }).step, "closed");
  }
});

test("working clears the last error and marks the step busy", () => {
  const retry = connectFlow(
    { step: "choose", busy: false, error: "old", joining: false },
    { type: "working" },
  );

  assert.deepEqual(retry, { step: "choose", busy: true, error: null, joining: false });
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

test("a closed chooser only opens: a prompt answered after closing does not bring it back", () => {
  const late: ConnectFlowEvent[] = [
    { type: "working" },
    { type: "connected", signedIn: false, hasProfile: null },
    { type: "connected", signedIn: true, hasProfile: false },
    { type: "signed_in", hasProfile: false },
    { type: "prompt_closed" },
    { type: "failed", error: "The network dropped." },
    { type: "prf_unavailable" },
    { type: "back" },
    { type: "join" },
    { type: "joined", hasProfile: true },
    { type: "claimed" },
    { type: "close" },
  ];
  for (const event of late) {
    assert.deepEqual(connectFlow(CLOSED, event), CLOSED, event.type);
  }

  assert.equal(connectFlow(CLOSED, { type: "open" }).step, "choose");
});

/* Joining: the wallet that was connected has no account, and the person already has one. */

const USERNAME: ConnectFlowState = { step: "username", busy: false, error: null, joining: false };
const JOIN: ConnectFlowState = { step: "join", busy: false, error: null, joining: true };

test("from the username step, 'I already have an account' opens the join step, and back returns", () => {
  const join = connectFlow(USERNAME, { type: "join" });

  assert.deepEqual(join, JOIN);
  assert.deepEqual(connectFlow(join, { type: "back" }), USERNAME);
});

test("joining is only offered where the username is asked", () => {
  for (const step of ["choose", "signin", "prf", "joined"] as const) {
    const state: ConnectFlowState = { step, busy: false, error: null, joining: false };

    assert.deepEqual(connectFlow(state, { type: "join" }), state, step);
  }
});

test("the other wallet signed: the chooser says the account was joined", () => {
  const waiting = connectFlow(JOIN, { type: "working" });

  assert.deepEqual(waiting, { ...JOIN, busy: true });
  assert.equal(connectFlow(waiting, { type: "joined", hasProfile: true }).step, "joined");
  // Not known is not asked, here as after a sign-in.
  assert.equal(connectFlow(waiting, { type: "joined", hasProfile: null }).step, "joined");
});

test("an account that was joined and has no username yet is asked for one", () => {
  const next = connectFlow({ ...JOIN, busy: true }, { type: "joined", hasProfile: false });

  assert.deepEqual(next, USERNAME);
});

test("a join approved after going back still says the account was joined", () => {
  // Back was pressed while the other wallet's prompt was up, and then the prompt was approved.
  assert.equal(connectFlow(USERNAME, { type: "joined", hasProfile: true }).step, "joined");
  // A closed chooser stays closed: the account is joined and nothing is said.
  assert.deepEqual(connectFlow(CLOSED, { type: "joined", hasProfile: true }), CLOSED);
});

test("the join step can be opened directly, and Back from it asks for the username", () => {
  const join = connectFlow(CLOSED, { type: "open_join", signedIn: true });

  assert.deepEqual(join, JOIN);
  assert.deepEqual(connectFlow(join, { type: "back" }), USERNAME);
});

test("opened to join without a session, the connected wallet confirms itself first", () => {
  const first = connectFlow(CLOSED, { type: "open_join", signedIn: false });

  assert.deepEqual(first, { step: "signin", busy: false, error: null, joining: true });
  assert.deepEqual(connectFlow(first, { type: "signed_in", hasProfile: false }), JOIN);
  // It turned out to have a username already: there is nothing to join from.
  assert.equal(connectFlow(first, { type: "signed_in", hasProfile: true }).step, "closed");
  assert.equal(connectFlow(first, { type: "signed_in", hasProfile: null }).step, "closed");
});

test("a closed prompt or a refusal keeps the join step, with its words", () => {
  const waiting: ConnectFlowState = { ...JOIN, busy: true };

  assert.deepEqual(connectFlow(waiting, { type: "prompt_closed" }), JOIN);
  assert.deepEqual(connectFlow(waiting, { type: "failed", error: "That wallet has no account." }), {
    ...JOIN,
    error: "That wallet has no account.",
  });
});

test("a passkey with no PRF output while joining returns to the join step, not to the choice", () => {
  const prf = connectFlow({ ...JOIN, busy: true }, { type: "prf_unavailable" });

  assert.deepEqual(prf, { step: "prf", busy: false, error: null, joining: true });
  assert.deepEqual(connectFlow(prf, { type: "back" }), JOIN);

  // From the first choice it still returns there.
  const first = connectFlow(
    { step: "choose", busy: true, error: null, joining: false },
    { type: "prf_unavailable" },
  );
  assert.equal(connectFlow(first, { type: "back" }).step, "choose");
});

test("the joined step closes like any other", () => {
  const joined: ConnectFlowState = { step: "joined", busy: false, error: null, joining: true };

  assert.deepEqual(connectFlow(joined, { type: "close" }), CLOSED);
});

test("a profile is read with its username, and one that is missing or unread is told apart", async () => {
  const answering = (status: number, body: unknown) =>
    (async () => Response.json(body, { status })) as typeof fetch;

  assert.deepEqual(await readProfile("t", answering(200, { data: { handle: "nightowl" } })), {
    handle: "nightowl",
  });
  // A profile whose body could not be read is still a profile.
  assert.deepEqual(await readProfile("t", answering(200, {})), { handle: null });
  assert.equal(await readProfile("t", answering(404, { message: "Profile not found" })), false);
  assert.equal(await readProfile("t", answering(500, {})), null);
  assert.equal(
    await readProfile("t", (async () => {
      throw new TypeError("offline");
    }) as typeof fetch),
    null,
  );
});
