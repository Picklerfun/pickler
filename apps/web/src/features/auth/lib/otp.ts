// The parts of the six-digit code screen that are decisions rather than markup, kept out of the
// component so node:test can drive them: what counts as a code, what the six cells show, how many
// tries are left, and what the resend button says while it is counting down.

export const CODE_LENGTH = 6;

/** Three shots at a code before the honest advice is to ask for a new one. */
export const MAX_ATTEMPTS = 3;

/** How long the resend button stays shut after a send. GoTrue's own floor is 60s per address. */
export const RESEND_SECONDS = 60;

/**
 * Digits only, six at most. Paste, autofill and a phone keyboard all arrive here, and all three
 * can carry spaces, a copied "Your code is 482913" or more characters than there are cells.
 */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** How a single cell is drawn: the canvas tints the one the caret is in front of. */
export interface CodeCell {
  char: string;
  filled: boolean;
  /** The next cell to be typed into — lit only while the code is neither full nor rejected. */
  caret: boolean;
  wrong: boolean;
}

export function codeCells(code: string, wrong: boolean): CodeCell[] {
  return Array.from({ length: CODE_LENGTH }, (_, index) => {
    const char = code[index] ?? "";
    return { char, filled: char !== "", caret: !wrong && index === code.length, wrong };
  });
}

export const isComplete = (code: string) => code.length === CODE_LENGTH;

/** Never negative: a fourth rejection must not read as "-1 tries left". */
export const triesLeft = (attempts: number) => Math.max(0, MAX_ATTEMPTS - attempts);

/**
 * What the resend button says. It counts in whole seconds because a label that changes twice a
 * second is noise, and it is only ever enabled at zero.
 */
export function resendLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `RESEND IN ${Math.ceil(secondsLeft)}S` : "RESEND";
}
