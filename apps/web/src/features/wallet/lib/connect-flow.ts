/**
 * The chooser's steps, as a pure reducer (docs/specs/mera-web-v1.md §3 and §9):
 *
 *   choose ──► sign in ──► username ──► closed
 *                            └──► join ──► joined ──► closed
 *
 * The passkey wallet signs in while it connects, so it skips the sign-in step; a browser wallet
 * passes through it. An account that already has a username skips the rest.
 *
 * The username step has a second way out. Somebody who connected a wallet Pickler had not seen is
 * asked for a username, because that wallet has no account — but the person may have one already,
 * under their other wallet. `join` is where they say so: they sign with that wallet, and the one
 * they connected opens that account from then on. `joined` says it happened.
 *
 * `prf` is the side step for a passkey that cannot open a wallet, from the choice or from `join`.
 */
export type ConnectStep = "choose" | "signin" | "username" | "prf" | "join" | "joined" | "closed";

export interface ConnectFlowState {
  step: ConnectStep;
  /** Something is in flight: a wallet prompt, a passkey prompt, a request. */
  busy: boolean;
  /** What went wrong on this step, in words for the screen. */
  error: string | null;
  /** The person is joining an account they already have, so a side step returns to `join`. */
  joining: boolean;
}

export type ConnectFlowEvent =
  | { type: "open" }
  | { type: "working" }
  /** The wallet connected. `hasProfile` is null when nobody could tell, or nobody asked yet. */
  | { type: "connected"; signedIn: boolean; hasProfile: boolean | null }
  | { type: "signed_in"; hasProfile: boolean | null }
  /** From the username step: "I already have an account". */
  | { type: "join" }
  /** The connected wallet now opens the account the other wallet signed for. */
  | { type: "joined"; hasProfile: boolean | null }
  /** The person closed a prompt: an answer, not a failure. */
  | { type: "prompt_closed" }
  | { type: "failed"; error: string }
  | { type: "prf_unavailable" }
  /** One step back: from `join` to the username, from `prf` to the choice it came from. */
  | { type: "back" }
  | { type: "claimed" }
  | { type: "close" };

export const CLOSED: ConnectFlowState = {
  step: "closed",
  busy: false,
  error: null,
  joining: false,
};

const at = (step: ConnectStep, joining = false): ConnectFlowState => ({
  step,
  busy: false,
  error: null,
  joining,
});

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
      return at("choose");
    case "back":
      if (state.step === "join") {
        return at("username");
      }
      return state.joining ? at("join", true) : at("choose");
    case "working":
      return { ...state, busy: true, error: null };
    case "connected":
      return event.signedIn ? afterSignIn(event.hasProfile) : at("signin");
    case "signed_in":
      return afterSignIn(event.hasProfile);
    case "join":
      // Only where the question is asked: an account with a username has nothing to join from.
      return state.step === "username" ? at("join", true) : state;
    case "joined":
      if (!state.joining) {
        return state;
      }
      // The account that was joined may itself have no username yet: then it is asked for now.
      return event.hasProfile === false ? at("username") : at("joined");
    case "prompt_closed":
      return at(state.step, state.joining);
    case "failed":
      return { ...state, busy: false, error: event.error };
    case "prf_unavailable":
      return at("prf", state.joining);
    case "claimed":
    case "close":
      return CLOSED;
  }
}
