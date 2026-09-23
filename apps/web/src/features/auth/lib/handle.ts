// What the handle screen decides, kept out of the component so node:test can drive it: what a
// typed character becomes, and what the line under the field says about it.
//
// The note is the only place the person is told why a name will not do, so it has to cover every
// reason the API can send back as well as the two the browser can see for itself.

import type { FieldTone } from "@pickler/ui";
import type { HandleAvailability } from "./pickler-api";

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 15;

/**
 * Letters, numbers and underscores, lower-cased, fifteen at most — the same rule the API applies,
 * enforced as you type so the field can never hold something it would refuse.
 */
export function normalizeHandle(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase()
    .slice(0, HANDLE_MAX);
}

export const isHandleLongEnough = (handle: string) => handle.length >= HANDLE_MIN;

/** What the availability check has to say so far. `null` is "still asking". */
export type HandleCheck = HandleAvailability | "error" | null;

const REASONS: Record<Exclude<HandleAvailability, { available: true }>["reason"], string> = {
  too_short: `AT LEAST ${HANDLE_MIN}`,
  too_long: `${HANDLE_MAX} CHARACTERS AT MOST`,
  invalid_characters: "LETTERS, NUMBERS AND _ ONLY",
  reserved: "THAT NAME IS RESERVED",
  taken: "IS TAKEN",
};

export interface HandleNote {
  text: string;
  tone: FieldTone;
  /** Whether the flow may move on. Only ever true for a name the server said is free. */
  ready: boolean;
}

export function handleNote(handle: string, check: HandleCheck, configured: boolean): HandleNote {
  if (!handle) {
    return {
      text: `${HANDLE_MIN}–${HANDLE_MAX} · LETTERS, NUMBERS, _`,
      tone: "quiet",
      ready: false,
    };
  }
  if (!isHandleLongEnough(handle)) {
    return { text: REASONS.too_short, tone: "quiet", ready: false };
  }
  if (!configured) {
    return { text: "HANDLE CHECKS ARE NOT CONNECTED HERE", tone: "warn", ready: false };
  }
  if (check === null) {
    return { text: `CHECKING @${handle.toUpperCase()}…`, tone: "quiet", ready: false };
  }
  if (check === "error") {
    return { text: "COULD NOT CHECK THAT NAME · TRY AGAIN", tone: "warn", ready: false };
  }
  if (check.available) {
    return {
      text: `@${handle.toUpperCase()} IS FREE · AGENTS SHARE THIS NAMESPACE`,
      tone: "good",
      ready: true,
    };
  }
  return {
    text:
      check.reason === "taken"
        ? `@${handle.toUpperCase()} ${REASONS.taken}`
        : REASONS[check.reason],
    tone: "bad",
    ready: false,
  };
}
