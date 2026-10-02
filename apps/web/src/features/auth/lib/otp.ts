// The parts of the eight-digit code screen that are decisions rather than markup, kept out of the
// component so node:test can drive them: what counts as a code, what the eight cells show, how many
// tries are left, and what the resend button says while it is counting down.

/**
 * The email code's length. It is the Supabase project's "Email OTP Length" (Auth → Providers →
 * Email), 8 on the hosted project, and `otp_length` under `[auth.email]` in supabase/config.toml
 * for local development: all three change together, or every code is cut short or never complete.
 */
export const CODE_LENGTH = 8;

/** Three shots at a code before the honest advice is to ask for a new one. */
export const MAX_ATTEMPTS = 3;

/**
 * How long the resend button stays shut after a send. It is the screen's own floor, not the
 * server's: GoTrue's minimum gap is `auth.email.max_frequency`, which a hosted project
 * defaults to 60s but this repo's supabase/config.toml sets to 1s for local development. So
 * this only ever makes the button shut for longer than the server would, never shorter.
 */
export const RESEND_SECONDS = 60;

/**
 * Digits only, eight at most. Paste, autofill and a phone keyboard all arrive here, and all three
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
