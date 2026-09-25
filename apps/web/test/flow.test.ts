import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL, next, rail, stepsFor } from "../src/features/auth/lib/flow";
import type { FlowEvent, FlowState, RailPhase, Step } from "../src/features/auth/lib/flow";

/** Feeds the machine a script and returns the step after each event, plus the final state. */
function walk(from: FlowState, events: readonly FlowEvent[]): { steps: Step[]; state: FlowState } {
  const steps: Step[] = [];
  let state = from;
  for (const event of events) {
    state = next(state, event);
    steps.push(state.step);
  }
  return { steps, state };
}

/**
 * Written out rather than built from the rail under test: a fixture produced by `rail` would
 * agree with `rail` whatever either of them did.
 */
const phase = (label: string, at: "done" | "active" | "todo"): RailPhase => ({
  label,
  active: at === "active",
  done: at === "done",
});

test("the flow starts on the account screen of the sign-up rail, with nothing known", () => {
  assert.deepEqual(INITIAL, {
    mode: "up",
    step: "auth",
    email: "",
    code: "",
    handle: "",
    needsWallet: false,
  });
});

test("signing up walks account, code, handle, passkey, welcome", () => {
  const { steps, state } = walk(INITIAL, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_changed", code: "482913" },
    { type: "code_verified" },
    { type: "handle_claimed", handle: "nightowl" },
    { type: "passkey_created" },
  ]);
  // The walk, not the rail. A rail that merely stopped listing HANDLE would leave this green
  // with the step still reachable, which is the whole reason this asserts the steps a person is
  // put through rather than the labels drawn above them.
  assert.deepEqual(steps, ["code", "code", "handle", "passkey", "welcome"]);
  assert.deepEqual(state, {
    mode: "up",
    step: "welcome",
    email: "ana@pickler.xyz",
    code: "482913",
    handle: "nightowl",
    needsWallet: false,
  });
});

test("signing in walks account, code, welcome — the handle is never asked for", () => {
  const { steps, state } = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_verified" },
  ]);
  assert.deepEqual(steps, ["code", "welcome"]);
  assert.equal(state.mode, "in");
  assert.equal(state.handle, "", "signing in must not invent a handle");
});

test("a new device walks signed in, approve, this device", () => {
  // The landing check sends device_unknown in place of code_verified, from the code screen.
  const signedIn = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
  ]).state;
  const { steps, state } = walk(signedIn, [
    { type: "device_unknown" },
    { type: "approve_started" },
    { type: "device_added" },
  ]);
  assert.deepEqual(steps, ["recover", "approve", "recovered"]);
  assert.equal(state.step, "recovered");
});

test("device_unknown switches the rail as well as the step", () => {
  const before = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
  ]).state;
  assert.equal(before.mode, "in");
  const after = next(before, { type: "device_unknown" });
  assert.equal(after.mode, "recover", "the rail must change, not only the screen");
  assert.equal(after.step, "recover");
  assert.deepEqual(rail(after), [
    phase("SIGNED IN", "active"),
    phase("APPROVE", "todo"),
    phase("THIS DEVICE", "todo"),
  ]);
});

test("leaving the new-device rail lands on the welcome screen, on the rail that has one", () => {
  const recover = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "device_unknown" },
  ]).state;
  const left = next(recover, { type: "device_skipped" });
  assert.equal(left.step, "welcome");
  // The mode has to come back with the step. `welcome` is in no phase of the recover rail, so a
  // state that kept `mode: "recover"` would light nothing above the form.
  assert.equal(left.mode, "in", "the rail must change back, not only the screen");
  assert.deepEqual(rail(left), [phase("ACCOUNT", "done"), phase("IN", "active")]);
});

test("the way out of the new-device rail is open from the approve step too", () => {
  // The screen stays up while the phone is asked, and a stamp that never comes must not trap
  // somebody on a step they can no longer finish.
  const approving = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "device_unknown" },
    { type: "approve_started" },
  ]).state;
  assert.equal(approving.step, "approve");
  const left = next(approving, { type: "device_skipped" });
  assert.equal(left.step, "welcome");
  assert.equal(left.mode, "in");
});

test("leaving the new-device rail invents nothing and forgets nothing", () => {
  const recover: FlowState = {
    ...INITIAL,
    mode: "recover",
    step: "recover",
    email: "ana@pickler.xyz",
    handle: "nightowl",
  };
  assert.deepEqual(next(recover, { type: "device_skipped" }), {
    ...recover,
    mode: "in",
    step: "welcome",
  });
});

test("changing the email goes back to the account screen and forgets the code", () => {
  const typed = walk(INITIAL, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_changed", code: "4829" },
  ]).state;
  assert.equal(typed.code, "4829");
  const back = next(typed, { type: "change_email" });
  assert.equal(back.step, "auth");
  assert.equal(back.code, "", "a code typed for the old address must not be reused");
  assert.equal(back.email, "ana@pickler.xyz", "the address itself stays, to prefill the field");
});

test("a fresh code replaces whatever was typed for the last one", () => {
  const typed = walk(INITIAL, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_changed", code: "4829" },
    { type: "code_sent", email: "ana@pickler.xyz" },
  ]).state;
  assert.equal(typed.code, "");
});

test("the sign-up rail lights the phase you are on and every phase before it", () => {
  const at = (events: readonly FlowEvent[]) => rail(walk(INITIAL, events).state);

  assert.deepEqual(rail(INITIAL), [
    phase("ACCOUNT", "active"),
    phase("HANDLE", "todo"),
    phase("PASSKEY", "todo"),
    phase("IN", "todo"),
  ]);
  // Both steps of ACCOUNT are the same phase: the bar must not move on the way to the code.
  assert.deepEqual(at([{ type: "code_sent", email: "ana@pickler.xyz" }]), [
    phase("ACCOUNT", "active"),
    phase("HANDLE", "todo"),
    phase("PASSKEY", "todo"),
    phase("IN", "todo"),
  ]);
  assert.deepEqual(
    at([{ type: "code_sent", email: "ana@pickler.xyz" }, { type: "code_verified" }]),
    [
      phase("ACCOUNT", "done"),
      phase("HANDLE", "active"),
      phase("PASSKEY", "todo"),
      phase("IN", "todo"),
    ],
  );
  assert.deepEqual(
    at([
      { type: "code_sent", email: "ana@pickler.xyz" },
      { type: "code_verified" },
      { type: "handle_claimed", handle: "nightowl" },
    ]),
    [
      phase("ACCOUNT", "done"),
      phase("HANDLE", "done"),
      phase("PASSKEY", "active"),
      phase("IN", "todo"),
    ],
  );
  assert.deepEqual(
    at([
      { type: "code_sent", email: "ana@pickler.xyz" },
      { type: "code_verified" },
      { type: "handle_claimed", handle: "nightowl" },
      { type: "passkey_created" },
    ]),
    [
      phase("ACCOUNT", "done"),
      phase("HANDLE", "done"),
      phase("PASSKEY", "done"),
      phase("IN", "active"),
    ],
  );
});

test("the sign-in rail has two phases, not the sign-up rail's three", () => {
  const signIn = next(INITIAL, { type: "mode_chosen", mode: "in" });
  assert.deepEqual(rail(signIn), [phase("ACCOUNT", "active"), phase("IN", "todo")]);
  const welcome = walk(signIn, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_verified" },
  ]).state;
  assert.deepEqual(rail(welcome), [phase("ACCOUNT", "done"), phase("IN", "active")]);
});

test("the new-device rail lights each phase in turn", () => {
  const recover = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "device_unknown" },
  ]).state;
  assert.deepEqual(rail(next(recover, { type: "approve_started" })), [
    phase("SIGNED IN", "done"),
    phase("APPROVE", "active"),
    phase("THIS DEVICE", "todo"),
  ]);
  assert.deepEqual(
    rail(walk(recover, [{ type: "approve_started" }, { type: "device_added" }]).state),
    [phase("SIGNED IN", "done"), phase("APPROVE", "done"), phase("THIS DEVICE", "active")],
  );
});

test("a step outside the current rail lights nothing rather than lighting everything", () => {
  // Not reachable through `next`, but `rail` is called on whatever a screen holds, and a
  // findIndex miss returns -1 — which, compared with `<`, would mark every phase done.
  const stray: FlowState = { ...INITIAL, mode: "in", step: "recovered" };
  assert.deepEqual(rail(stray), [phase("ACCOUNT", "todo"), phase("IN", "todo")]);
});

test("the rails ask for the passkey on sign-up always and on sign-in only without a wallet", () => {
  assert.deepEqual(stepsFor("up"), ["auth", "code", "handle", "passkey", "welcome"]);
  assert.deepEqual(stepsFor("in"), ["auth", "code", "welcome"]);
  assert.deepEqual(stepsFor("in", true), ["auth", "code", "passkey", "welcome"]);
});

/** Every event a screen can send, with fixed payloads, for the exhaustive walks below. */
const EVERY_EVENT: readonly FlowEvent[] = [
  { type: "mode_chosen", mode: "up" },
  { type: "mode_chosen", mode: "in" },
  { type: "code_sent", email: "ana@pickler.xyz" },
  { type: "code_changed", code: "482913" },
  { type: "code_verified" },
  { type: "handle_claimed", handle: "nightowl" },
  { type: "profile_missing" },
  { type: "wallet_missing" },
  { type: "account_found" },
  { type: "passkey_created" },
  { type: "device_unknown" },
  { type: "approve_started" },
  { type: "device_added" },
  { type: "device_skipped" },
  { type: "change_email" },
];

/** Every state reachable from `from` in at most `depth` events drawn from `events`. */
function reachable(from: FlowState, events: readonly FlowEvent[], depth: number): FlowState[] {
  const seen = new Map<string, FlowState>([[JSON.stringify(from), from]]);
  let frontier = [from];
  for (let round = 0; round < depth; round += 1) {
    const after: FlowState[] = [];
    for (const state of frontier) {
      for (const event of events) {
        const moved = next(state, event);
        const key = JSON.stringify(moved);
        if (!seen.has(key)) {
          seen.set(key, moved);
          after.push(moved);
        }
      }
    }
    frontier = after;
  }
  return [...seen.values()];
}

test("sign-up cannot reach welcome without passkey_created, whatever else is sent", () => {
  const claimed = walk(INITIAL, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_verified" },
    { type: "handle_claimed", handle: "nightowl" },
  ]).state;
  assert.equal(claimed.step, "passkey");

  // Six events of anything but the ceremony finishing — the way out of the new-device rail, a
  // changed email, the sign-in toggle — and the person is still on the passkey step.
  const without = EVERY_EVENT.filter((event) => event.type !== "passkey_created");
  const states = reachable(claimed, without, 6);
  assert.ok(
    states.every((state) => state.step === "passkey"),
    "a signed-up person reached another step without creating their wallet",
  );
});

test("sign-in without a sub-organization cannot reach welcome without passkey_created", () => {
  const missing = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "wallet_missing" },
  ]).state;
  assert.equal(missing.step, "passkey");

  const without = EVERY_EVENT.filter((event) => event.type !== "passkey_created");
  assert.ok(reachable(missing, without, 6).every((state) => state.step === "passkey"));
  assert.equal(next(missing, { type: "passkey_created" }).step, "welcome");
});

test("sign-in with a sub-organization goes straight to welcome, with no passkey phase", () => {
  const { steps, state } = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_verified" },
  ]);
  assert.deepEqual(steps, ["code", "welcome"]);
  assert.deepEqual(rail(state), [phase("ACCOUNT", "done"), phase("IN", "active")]);
});

test("sign-in without a sub-organization walks account, code, passkey, welcome", () => {
  const signIn = next(INITIAL, { type: "mode_chosen", mode: "in" });
  const { steps, state } = walk(signIn, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "wallet_missing" },
  ]);
  assert.deepEqual(steps, ["code", "passkey"]);
  assert.equal(state.mode, "in");
  assert.deepEqual(rail(state), [
    phase("ACCOUNT", "done"),
    phase("PASSKEY", "active"),
    phase("IN", "todo"),
  ]);
  const done = next(state, { type: "passkey_created" });
  assert.deepEqual(rail(done), [
    phase("ACCOUNT", "done"),
    phase("PASSKEY", "done"),
    phase("IN", "active"),
  ]);
});

test("sign-in on an account with no profile finishes signing up, passkey included", () => {
  const { steps, state } = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "profile_missing" },
    { type: "handle_claimed", handle: "nightowl" },
    { type: "passkey_created" },
  ]);
  assert.deepEqual(steps, ["code", "handle", "passkey", "welcome"]);
  assert.equal(state.mode, "up");
});

test("a sign-up that finds a complete account behind it is welcomed as a sign-in", () => {
  const { steps, state } = walk(INITIAL, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "account_found" },
  ]);
  assert.deepEqual(steps, ["code", "welcome"]);
  assert.equal(state.mode, "in");
});

test("an event sent from a screen that cannot send it changes nothing", () => {
  assert.equal(next(INITIAL, { type: "passkey_created" }), INITIAL);
  assert.equal(next(INITIAL, { type: "device_skipped" }), INITIAL);
  assert.equal(next(INITIAL, { type: "handle_claimed", handle: "x" }), INITIAL);
});
