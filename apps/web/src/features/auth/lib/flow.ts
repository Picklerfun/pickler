// The shape of the passkey sign-up, sign-in and new-device flows, from the "Pickler Auth Passkey
// Flow" design canvas. Deliberately free of React: the canvas drives its steps from a demo tab
// strip, and a machine that can only be driven by clicking through a browser cannot be checked.
// Everything here is a pure function over a plain object, so apps/web/test/flow.test.ts walks
// each flow end to end.
//
// The names are the canvas's own — `STEPS` and `RAILS` below are the same words, in the same
// order, as the constants in the canvas's logic half. The canvas also has an `agent` rail with
// `agent` and `done` steps for creating an agent; that is a separate flow after this one and is
// not modelled here.

export type Step =
  | "auth"
  | "code"
  | "handle"
  | "passkey"
  | "wallet"
  | "welcome"
  | "recover"
  | "approve"
  | "recovered";

/** Which rail is on screen: creating an account, returning to one, or adding a device to one. */
export type Mode = "up" | "in" | "recover";

export interface FlowState {
  mode: Mode;
  step: Step;
  email: string;
  code: string;
  handle: string;
  /**
   * The master wallet's address, known only once a passkey has created one. This is the screens'
   * one copy of it: the register response carries it too, but only so the shell can put it here.
   */
  address: string | null;
  /**
   * Whether the account has a second passkey. Account state rather than a place in the flow, so
   * it moves no step — but the wallet screen's copy and the rail's BACKUP phase both read it, and
   * a screen holding it privately is how those two come to disagree.
   */
  hasBackup: boolean;
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
  | { type: "passkey_created"; address: string }
  | { type: "backup_added" }
  /** Signed in, but this browser holds no passkey for the account. */
  | { type: "device_unknown" }
  | { type: "approve_started" }
  | { type: "device_added" }
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
    { label: "PASSKEY", steps: ["passkey"] },
    { label: "BACKUP", steps: ["wallet"] },
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

export const INITIAL: FlowState = {
  mode: "up",
  step: "auth",
  email: "",
  code: "",
  handle: "",
  address: null,
  hasBackup: false,
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
      return { ...state, step: "passkey", handle: event.handle };
    case "passkey_created":
      return { ...state, step: "wallet", address: event.address };
    case "backup_added":
      // A backup is an addition to the account, not a place in the flow: the wallet screen stays
      // up and says so. The step does not move; what the screen and the rail say does.
      return { ...state, hasBackup: true };
    case "device_unknown":
      // Not just another screen — the rail above the form becomes the three-phase recovery one.
      return { ...state, mode: "recover", step: "recover" };
    case "approve_started":
      return { ...state, step: "approve" };
    case "device_added":
      return { ...state, step: "recovered" };
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
  // The one phase that can finish while you are still standing on it. A backup is an addition to
  // the account rather than a screen to leave, so once it exists nothing on the rail is pending
  // and BACKUP goes green under you instead of sitting there asking for something already done.
  const finished = state.step === "wallet" && state.hasBackup;
  return phases.map((current, index) => ({
    label: current.label,
    active: index === at && !finished,
    // `at` is -1 when the step belongs to no phase of this rail, and `index < -1` is false for
    // every phase — so a rail that does not contain the step lights nothing, rather than
    // reading as "every phase is behind you".
    done: index < at || (index === at && finished),
  }));
}
