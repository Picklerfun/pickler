/**
 * Identity & voice's rules (studio-draft-dashboard-v1 D14, §3.2), the same in the draft and the
 * live studio: the name's bounds, the voice a config holds, the X ACCOUNT card's tag and a refused
 * disconnect in words. Pure, pinned in `apps/web/test/studio-draft-model.test.ts`.
 */
import { VOICES, type VoiceKey } from "../new-agent/model";

/** The name's bounds, as `PUT /identity` holds them: 1–40 once trimmed. */
export const NAME_MAX = 40;

/**
 * What leaving the NAME box does: nothing when the trimmed name is the saved one (no request),
 * the reason when it is out of bounds, else the trimmed name to save.
 */
export function nameChange(
  saved: string | undefined,
  typed: string,
): { kind: "same" } | { kind: "bad"; text: string } | { kind: "save"; name: string } {
  const name = typed.trim();
  if (name === (saved ?? "").trim()) {
    return { kind: "same" };
  }
  if (!name) {
    return { kind: "bad", text: "IT NEEDS A NAME" };
  }
  if (name.length > NAME_MAX) {
    return { kind: "bad", text: `${NAME_MAX} CHARACTERS AT MOST` };
  }
  return { kind: "save", name };
}

/** The voice the config holds, or the first (Analyst) for a config without one. */
export const voiceOf = (voice: string | undefined): VoiceKey =>
  VOICES.find((option) => option.key === voice)?.key ?? "analyst";

/** The X ACCOUNT card's tag. */
export const xAccountTag = (handle: string | null): "CONNECTED" | "NOT CONNECTED" =>
  handle ? "CONNECTED" : "NOT CONNECTED";

/** DISCONNECT refused, in words: a public agent keeps its account (D6); anything else as said. */
export const disconnectProblem = (code: string, fallback: string): string =>
  code === "X_ON_PUBLIC_AGENT" ? "A public agent keeps its X account." : fallback;
