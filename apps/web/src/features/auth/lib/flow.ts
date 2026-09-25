// The shape of the passkey sign-up, sign-in and new-device flows, from the "Pickler Auth Passkey
// Flow" design canvas. Deliberately free of React: the canvas drives its steps from a demo tab
// strip, and a machine that can only be driven by clicking through a browser cannot be checked.
// Everything here is a pure function over a plain object, so apps/web/test/flow.test.ts walks
// each flow end to end.
//
// The names are the canvas's own — `STEPS` and `RAILS` below are the same words, in the same
// order, as the constants in the canvas's logic half. The canvas also has an `agent` rail —
// `{ LIMITS: ['agent'], LIVE: ['done'] }`, whose two steps are titled NEW AGENT and AGENT LIVE —
// for creating an agent, and it once drew a `custody` rail hanging off it — a passkey step and a
// backup step, mounted at /passkey. That rail is gone from here: the studio's own "Create and run
// it once" ceremony (`features/studio/create/ceremony.ts`) is a second, independent sequence that
// was built to do the same job and never called into this one, so the custody rail sat in this
// file unreachable from any page. Under the studio-create-and-fund specification the
// sub-organization is born in exactly one place — that ceremony — so the rail that could also
// have made one is deleted rather than left to rot. `/passkey` now renders outside this machine
// entirely; see `PasskeyAddFlow` in `components/passkey-flow.tsx`.

export type Step = "auth" | "code" | "handle" | "welcome" | "recover" | "approve" | "recovered";

/** Which rail is on screen: creating an account, returning to one, or adding a device to one. */
export type Mode = "up" | "in" | "recover";

export interface FlowState {
  mode: Mode;
  step: Step;
  email: string;
  code: string;
  handle: string;
}

/**
 * Only things a person did. There is no event for "the server said so" on its own: a screen calls
 * the API, and reports the outcome as one of these once it has one.
 */
export type FlowEvent =
  /** The sign-up / sign-in toggle on the account screen. `recover` is never chosen, only entered. */
  | { type: "mode_chosen"; mode: "up" | "in" }
  | { type: "code_sent"; email: string }
  /** Typing in the six cells. The machine holds the code so `change_email` can forget it. */
  | { type: "code_changed"; code: string }
  | { type: "code_verified" }
  | { type: "handle_claimed"; handle: string }
  /** Signed in, but this browser holds no passkey for the account. */
  | { type: "device_unknown" }
  | { type: "approve_started" }
  | { type: "device_added" }
  /**
   * The new-device rail ended without adding a device, and the two ways that happens are both
   * ordinary. Either the person took the way out of it — that screen is offered on a hint that can
   * be wrong, so it must never be a room with no door — or the authenticator answered that this
   * browser already holds a credential for the account, which is the hint being corrected by
   * something that actually knows. Either way there is nothing left to approve.
   */
  | { type: "device_skipped" }
  | { type: "change_email" };

interface Phase {
  label: string;
  steps: readonly Step[];
}

/** One phase of the rail above the form, as a screen renders it. */
export interface RailPhase {
  label: string;
  active: boolean;
  /** Strictly before the phase holding the current step — a phase you are on is not yet done. */
  done: boolean;
}

const RAILS: Record<Mode, readonly Phase[]> = {
  up: [
    { label: "ACCOUNT", steps: ["auth", "code"] },
    { label: "HANDLE", steps: ["handle"] },
    // Sign-up ends where signing in ends, under the label the `in` rail already gives `welcome`.
    { label: "IN", steps: ["welcome"] },
  ],
  in: [
    { label: "ACCOUNT", steps: ["auth", "code"] },
    { label: "IN", steps: ["welcome"] },
  ],
  recover: [
    { label: "SIGNED IN", steps: ["recover"] },
    { label: "APPROVE", steps: ["approve"] },
    { label: "THIS DEVICE", steps: ["recovered"] },
  ],
};

/**
 * Every step of a mode's rail, in order. The rail is what the form asks of a person, so this is
 * the list to assert against when the question is what a flow demands — not `next`, which will
 * happily walk into a step no rail mentions.
 */
export function stepsFor(mode: Mode): Step[] {
  return RAILS[mode].flatMap((phase) => [...phase.steps]);
}

export const INITIAL: FlowState = {
  mode: "up",
  step: "auth",
  email: "",
  code: "",
  handle: "",
};

export function next(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "mode_chosen":
      // The toggle only exists on the account screen, so the step does not move. The code is
      // dropped because a code issued while signing up is not the one the other rail is waiting on.
      return { ...state, mode: event.mode, code: "" };
    case "code_sent":
      return { ...state, step: "code", email: event.email, code: "" };
    case "code_changed":
      return { ...state, code: event.code };
    case "code_verified":
      // The one place the two email rails part: a new account still has to pick a name.
      return { ...state, step: state.mode === "up" ? "handle" : "welcome" };
    case "handle_claimed":
      // Sign-up is over here. It used to fall through to `passkey`, which is what made every new
      // account create custody it had no use for yet.
      return { ...state, step: "welcome", handle: event.handle };
    case "device_unknown":
      // Not just another screen — the rail above the form becomes the three-phase recovery one.
      return { ...state, mode: "recover", step: "recover" };
    case "approve_started":
      return { ...state, step: "approve" };
    case "device_added":
      return { ...state, step: "recovered" };
    case "device_skipped":
      // The rail goes back with the step. `welcome` belongs to no phase of the recover rail, so
      // leaving the mode alone would light nothing above the form and leave the person reading
      // three phases of a journey they are no longer on. They are simply signed in, which is
      // what the `in` rail says.
      return { ...state, mode: "in", step: "welcome" };
    case "change_email":
      // The address stays so the field comes back filled in; the code does not, because it was
      // issued for whatever address is about to be replaced.
      return { ...state, step: "auth", code: "" };
  }
}

/** The rail for the current mode: every phase, which one you are on, and which are behind you. */
export function rail(state: FlowState): RailPhase[] {
  const phases = RAILS[state.mode];
  const at = phases.findIndex((current) => current.steps.includes(state.step));
  return phases.map((current, index) => ({
    label: current.label,
    active: index === at,
    // `at` is -1 when the step belongs to no phase of this rail, and `index < -1` is false for
    // every phase — so a rail that does not contain the step lights nothing, rather than
    // reading as "every phase is behind you".
    done: index < at,
  }));
}
