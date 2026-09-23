import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL, next, rail } from "../src/features/auth/lib/flow";
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
    address: null,
  });
});

test("signing up walks account, code, handle, passkey, backup", () => {
  const { steps, state } = walk(INITIAL, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_changed", code: "482913" },
    { type: "code_verified" },
    { type: "handle_claimed", handle: "nightowl" },
    { type: "passkey_created", address: "0xAbC0000000000000000000000000000000000001" },
    { type: "backup_added" },
  ]);
  assert.deepEqual(steps, ["code", "code", "handle", "passkey", "wallet", "wallet"]);
  assert.deepEqual(state, {
    mode: "up",
    step: "wallet",
    email: "ana@pickler.xyz",
    code: "482913",
    handle: "nightowl",
    address: "0xAbC0000000000000000000000000000000000001",
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
  const signedIn = walk(next(INITIAL, { type: "mode_chosen", mode: "in" }), [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_verified" },
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
  const before = next(INITIAL, { type: "mode_chosen", mode: "in" });
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

test("adding a backup passkey leaves the flow where it is", () => {
  const onBackup = walk(INITIAL, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_verified" },
    { type: "handle_claimed", handle: "nightowl" },
    { type: "passkey_created", address: "0x01" },
  ]).state;
  assert.deepEqual(next(onBackup, { type: "backup_added" }), onBackup);
});

test("the sign-up rail lights the phase you are on and every phase before it", () => {
  const at = (events: readonly FlowEvent[]) => rail(walk(INITIAL, events).state);

  assert.deepEqual(rail(INITIAL), [
    phase("ACCOUNT", "active"),
    phase("HANDLE", "todo"),
    phase("PASSKEY", "todo"),
    phase("BACKUP", "todo"),
  ]);
  // Both steps of ACCOUNT are the same phase: the bar must not move on the way to the code.
  assert.deepEqual(at([{ type: "code_sent", email: "ana@pickler.xyz" }]), [
    phase("ACCOUNT", "active"),
    phase("HANDLE", "todo"),
    phase("PASSKEY", "todo"),
    phase("BACKUP", "todo"),
  ]);
  assert.deepEqual(
    at([{ type: "code_sent", email: "ana@pickler.xyz" }, { type: "code_verified" }]),
    [
      phase("ACCOUNT", "done"),
      phase("HANDLE", "active"),
      phase("PASSKEY", "todo"),
      phase("BACKUP", "todo"),
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
      phase("BACKUP", "todo"),
    ],
  );
  assert.deepEqual(
    at([
      { type: "code_sent", email: "ana@pickler.xyz" },
      { type: "code_verified" },
      { type: "handle_claimed", handle: "nightowl" },
      { type: "passkey_created", address: "0x01" },
    ]),
    [
      phase("ACCOUNT", "done"),
      phase("HANDLE", "done"),
      phase("PASSKEY", "done"),
      phase("BACKUP", "active"),
    ],
  );
});

test("the sign-in rail has two phases, not the sign-up rail's four", () => {
  const signIn = next(INITIAL, { type: "mode_chosen", mode: "in" });
  assert.deepEqual(rail(signIn), [phase("ACCOUNT", "active"), phase("IN", "todo")]);
  const welcome = walk(signIn, [
    { type: "code_sent", email: "ana@pickler.xyz" },
    { type: "code_verified" },
  ]).state;
  assert.deepEqual(rail(welcome), [phase("ACCOUNT", "done"), phase("IN", "active")]);
});

test("the new-device rail lights each phase in turn", () => {
  const recover = next(next(INITIAL, { type: "mode_chosen", mode: "in" }), {
    type: "device_unknown",
  });
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
  const stray: FlowState = { ...INITIAL, mode: "in", step: "passkey" };
  assert.deepEqual(rail(stray), [phase("ACCOUNT", "todo"), phase("IN", "todo")]);
});
