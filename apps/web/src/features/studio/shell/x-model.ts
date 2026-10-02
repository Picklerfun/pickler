/**
 * Connect X's rules (studio-draft-dashboard-v1 D4, D5, §3.1), shared by the draft's Go Public and
 * by Identity & voice in both studios: the card's states, the handle rule, and a failed challenge
 * or check in words. Pure, pinned in `apps/web/test/studio-draft-model.test.ts`.
 */

/** Spec D5: nothing pretends to verify without Pickler's X app. */
export const X_UNAVAILABLE_LINE =
  "X verification isn't open yet. Skip it for now; you can connect X later in Identity & voice.";

export interface XCardState {
  /** The issued challenge: the handle it was issued for and the line to post. */
  challenge: { handle: string; text: string } | null;
  checking: boolean;
  /** The API answered 503 `X_UNAVAILABLE`. */
  unavailable: boolean;
  /** The handle the API said is another agent's (409 `X_HANDLE_TAKEN`). */
  taken: string | null;
  /** The last "Check again" did not find the post. */
  missed: boolean;
}

export interface XView {
  button: "Verify" | "Checking…" | "Check again";
  disabled: boolean;
  /** `missed` is the last check's answer, said inside the block so it is announced. */
  miss: { title: string; line: string; hint: string; missed: string | null } | null;
  unavailable: string | null;
  taken: string | null;
}

/** The last check's answer when the post was not there. */
export const X_NOT_FOUND_LINE = "Not found yet. Post the line, then check again.";

/**
 * Connect X's card: "Verify" asks for a challenge and shows the line to post (spec §3.1); with one
 * issued the button reads "Check again" and the miss block stays until the post is found. A handle
 * typed since (`typed`, as `xHandleInput` reads it) that is not the challenge's gets a new line, so
 * the button says Verify again.
 */
export function xView(state: XCardState, typed: string | null = null): XView {
  const { challenge } = state;
  const sameHandle =
    challenge !== null &&
    (typed === null || typed.toLowerCase() === challenge.handle.toLowerCase());
  let button: XView["button"] = "Verify";
  if (state.checking) {
    button = "Checking…";
  } else if (challenge && sameHandle) {
    button = "Check again";
  }
  return {
    button,
    disabled: state.checking,
    miss:
      challenge && !state.unavailable
        ? {
            title: "We couldn't find the post yet.",
            line: challenge.text,
            hint: `POST THIS FROM @${challenge.handle.toUpperCase()} · THEN CHECK AGAIN`,
            missed: state.missed && sameHandle ? X_NOT_FOUND_LINE : null,
          }
        : null,
    unavailable: state.unavailable ? X_UNAVAILABLE_LINE : null,
    taken: state.taken ? `@${state.taken} is already another agent's.` : null,
  };
}

/**
 * The handle as typed, without its "@", or null when X would not take it: core's `parseXHandle`
 * rule (1 to 15 letters, digits or _), mirrored so Verify can say so before anything is sent. The
 * server parses it again and decides.
 */
export function xHandleInput(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/** What Connect X shows for a failed challenge or check, by the API's error code. */
export type XProblem =
  /** 503 X_UNAVAILABLE: spec D5's line, in the card's own place for it. */
  | { kind: "unavailable" }
  /** 409 X_HANDLE_TAKEN: the card's taken line for this handle. */
  | { kind: "taken"; handle: string }
  /** The challenge lapsed or is gone: drop it, so the button reads Verify again, and say why. */
  | { kind: "expired"; text: string }
  /** A staged or preview studio: nothing is sent, the caller shows the preview note. */
  | { kind: "preview" }
  | { kind: "error"; text: string };

export function xProblem(code: string, handle: string, fallback: string): XProblem {
  switch (code) {
    case "X_UNAVAILABLE":
      return { kind: "unavailable" };
    case "X_HANDLE_TAKEN":
      return { kind: "taken", handle };
    case "TOO_MANY_CHECKS":
      return { kind: "error", text: "Wait a few seconds, then check again." };
    case "INVALID_X_HANDLE":
      return { kind: "error", text: "That isn't an X handle." };
    case "CHALLENGE_EXPIRED":
    case "CHALLENGE_NOT_FOUND":
      return { kind: "expired", text: "That line has lapsed. Press Verify for a new one." };
    case "X_ALREADY_CONNECTED":
      return { kind: "error", text: "It already has an X account." };
    case "PREVIEW":
      return { kind: "preview" };
    default:
      return { kind: "error", text: fallback };
  }
}
