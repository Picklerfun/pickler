// The shape of the passkey sign-up, sign-in and new-device flows, from the "Pickler Auth Passkey
// Flow" design canvas. Deliberately free of React: the canvas drives its steps from a demo tab
// strip, and a machine that can only be driven by clicking through a browser cannot be checked.
// Everything here is a pure function over a plain object, so apps/web/test/flow.test.ts walks
// each flow end to end.
//
// The names are the canvas's own — `STEPS` and `RAILS` below are the same words, in the same
// order, as the constants in the canvas's logic half.
//
// The passkey step is mandatory (studio-create-and-fund §4.1, decided 2026-09-25): the master
// wallet exists before any agent, so the person's profile can show it from the first studio visit.
// Sign-up is account → code → handle → passkey → welcome, and the only event that leaves the
// passkey step is `passkey_created` — the enrolment ceremony that creates the sub-organization and
// its master wallet. Sign-in passes through the same step when the landing check finds no
// sub-organization (`wallet_missing`), and goes straight to welcome when there is one.
//
// Every event is accepted only on the steps whose screen can send it (`ACCEPTS` below). That is
// what makes the rule hold for the machine rather than for today's screens: from the passkey step
// no stray `device_skipped`, `change_email` or `mode_chosen` can walk round the ceremony.

export type Step =
  "auth" | "code" | "handle" | "passkey" | "welcome" | "recover" | "approve" | "recovered";

/** Which rail is on screen: creating an account, returning to one, or adding a device to one. */
export type Mode = "up" | "in" | "recover";

export interface FlowState {
  mode: Mode;
  step: Step;
  email: string;
  code: string;
  handle: string;
  /**
   * Sign-in found no sub-organization, so its rail carries the PASSKEY phase. Sign-up always does;
   * a sign-in with a wallet never shows it.
   */
  needsWallet: boolean;
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
  /** Sign-in's landing check: the account has no profile yet, so it finishes signing up. */
  | { type: "profile_missing" }
  /** Sign-in's landing check: GET /wallets/me answered 404, so there is no sub-organization. */
  | { type: "wallet_missing" }
  /**
   * The landing check found a complete account — a profile and a sub-organization — behind a
   * sign-up, so it is a sign-in after all.
   */
  | { type: "account_found" }
  /** The enrolment ceremony finished: the sub-organization and its master wallet exist. */
  | { type: "passkey_created" }
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

const RAILS: Record<Mode | "inWithoutWallet", readonly Phase[]> = {
  up: [
    { label: "ACCOUNT", steps: ["auth", "code"] },
    { label: "HANDLE", steps: ["handle"] },
    { label: "PASSKEY", steps: ["passkey"] },
    // Sign-up ends where signing in ends, under the label the `in` rail already gives `welcome`.
    { label: "IN", steps: ["welcome"] },
  ],
  in: [
    { label: "ACCOUNT", steps: ["auth", "code"] },
    { label: "IN", steps: ["welcome"] },
  ],
  // Sign-in without a sub-organization: the same mandatory step, between the code and welcome.
  inWithoutWallet: [
    { label: "ACCOUNT", steps: ["auth", "code"] },
    { label: "PASSKEY", steps: ["passkey"] },
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
export function stepsFor(mode: Mode, needsWallet = false): Step[] {
  return railOf({ ...INITIAL, mode, needsWallet }).flatMap((phase) => [...phase.steps]);
}

export const INITIAL: FlowState = {
  mode: "up",
  step: "auth",
  email: "",
  code: "",
  handle: "",
  needsWallet: false,
};

/** The steps whose screen can send each event. Anything else is ignored, not obeyed. */
const ACCEPTS: Record<FlowEvent["type"], readonly Step[]> = {
  mode_chosen: ["auth"],
  code_sent: ["auth", "code"],
  code_changed: ["code"],
  code_verified: ["code"],
  handle_claimed: ["handle"],
  profile_missing: ["code"],
  wallet_missing: ["code"],
  account_found: ["code"],
  passkey_created: ["passkey"],
  device_unknown: ["code"],
  approve_started: ["recover"],
  device_added: ["approve"],
  device_skipped: ["recover", "approve"],
  change_email: ["code"],
};

/** The rail a state is drawn on: sign-in without a wallet carries the passkey phase. */
function railOf(state: FlowState): readonly Phase[] {
  if (state.mode === "in" && state.needsWallet) {
    return RAILS.inWithoutWallet;
  }
  return RAILS[state.mode];
}

export function next(state: FlowState, event: FlowEvent): FlowState {
  if (!ACCEPTS[event.type].includes(state.step)) {
    return state;
  }
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
      // Not the end of sign-up: the master wallet is made next, and nobody skips it.
      return { ...state, step: "passkey", handle: event.handle };
    case "profile_missing":
      // No profile yet: finish signing up rather than welcoming somebody to an empty account.
      return { ...state, mode: "up", step: "handle" };
    case "wallet_missing":
      return { ...state, step: "passkey", needsWallet: true };
    case "account_found":
      return { ...state, mode: "in", step: "welcome" };
    case "passkey_created":
      return { ...state, step: "welcome" };
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
  const phases = railOf(state);
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
