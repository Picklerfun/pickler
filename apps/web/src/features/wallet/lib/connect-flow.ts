/**
 * The chooser's steps, as a pure reducer (docs/specs/mera-web-v1.md §3):
 *
 *   choose ──► sign in ──► username ──► closed
 *
 * The passkey wallet signs in while it connects, so it skips the middle step; a browser wallet
 * passes through it. An account that already has a username skips the last. `prf` is the side
 * step for a passkey that cannot open a wallet.
 */
export type ConnectStep = "choose" | "signin" | "username" | "prf" | "closed";

export interface ConnectFlowState {
  step: ConnectStep;
  /** Something is in flight: a wallet prompt, a passkey prompt, a request. */
  busy: boolean;
  /** What went wrong on this step, in words for the screen. */
  error: string | null;
}

export type ConnectFlowEvent =
  | { type: "open" }
  | { type: "working" }
  /** The wallet connected. `hasProfile` is null when nobody could tell, or nobody asked yet. */
  | { type: "connected"; signedIn: boolean; hasProfile: boolean | null }
  | { type: "signed_in"; hasProfile: boolean | null }
  /** The person closed a prompt: an answer, not a failure. */
  | { type: "prompt_closed" }
  | { type: "failed"; error: string }
  | { type: "prf_unavailable" }
  /** From a side step back to the choice. */
  | { type: "back" }
  | { type: "claimed" }
  | { type: "close" };

export const CLOSED: ConnectFlowState = { step: "closed", busy: false, error: null };

const at = (step: ConnectStep): ConnectFlowState => ({ step, busy: false, error: null });

/**
 * Where a signed-in account goes next. Only a profile known to be missing asks for a username:
 * one that could not be read may well exist, and the portfolio asks again when it can tell.
 */
const afterSignIn = (hasProfile: boolean | null) =>
  at(hasProfile === false ? "username" : "closed");

export function connectFlow(state: ConnectFlowState, event: ConnectFlowEvent): ConnectFlowState {
  // A closed chooser only opens. A prompt that was still up when the person closed it answers
  // into nothing: the wallet may well be connected by then, but the dialog does not come back.
  if (state.step === "closed" && event.type !== "open") {
    return state;
  }
  switch (event.type) {
    case "open":
    case "back":
      return at("choose");
    case "working":
      return { step: state.step, busy: true, error: null };
    case "connected":
      return event.signedIn ? afterSignIn(event.hasProfile) : at("signin");
    case "signed_in":
      return afterSignIn(event.hasProfile);
    case "prompt_closed":
      return at(state.step);
    case "failed":
      return { step: state.step, busy: false, error: event.error };
    case "prf_unavailable":
      return at("prf");
    case "claimed":
    case "close":
      return CLOSED;
  }
}
