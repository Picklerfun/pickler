import type { JoinWaitlistResponse } from "@pickler/api-schema";
import type { Swatch } from "@/lib/accent";

/**
 * The rules of the application form, with no React and no value import from the schema, so
 * apps/web/test/apply-form.test.ts can pin them without building the shared packages.
 *
 * The form has six answers and an email. The six are what the API takes; the email is what seats the
 * browser first (spec A1), so it counts towards sending but not towards "N TO GO".
 */

export interface Fields {
  agentName: string;
  ticker: string;
  /** Already cleaned: `@handle`, or empty. */
  xHandle: string;
  category: string;
  personality: string;
  edge: string;
  whyYou: string;
}

export interface Limits {
  agentName: number;
  edge: number;
  whyYou: number;
}

export type AnswerKey = "name" | "xHandle" | "category" | "personality" | "edge" | "whyYou";
export type Answers = Record<AnswerKey, boolean>;

export type TickerStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown";

export const ANSWER_COUNT = 6;

const has = (value: string) => value.trim().length > 0;

/** Which of the six answers are in. The name counts only once it has a ticker beside it. */
export function answersOf(fields: Fields): Answers {
  return {
    name: has(fields.agentName) && has(fields.ticker),
    xHandle: has(fields.xHandle),
    category: has(fields.category),
    personality: has(fields.personality),
    edge: has(fields.edge),
    whyYou: has(fields.whyYou),
  };
}

export function filledCount(answers: Answers): number {
  return Object.values(answers).filter(Boolean).length;
}

/** The three free-text answers against core's limits; the chips cannot be too long. */
export function withinLimits(fields: Fields, limits: Limits): boolean {
  return (
    fields.agentName.trim().length <= limits.agentName &&
    fields.edge.length <= limits.edge &&
    fields.whyYou.length <= limits.whyYou
  );
}

/** The one check the email gets before the API sees it: something before an `@`. */
export function emailLooksOk(email: string): boolean {
  return email.trim().indexOf("@") > 0;
}

export interface SendState {
  filled: number;
  withinLimits: boolean;
  emailOk: boolean;
  tickerStatus: TickerStatus;
  submitting: boolean;
}

/**
 * Send lights when all six are in, within limits, the email has an `@` and the ticker is not known
 * to be taken or malformed. A check still in flight does not hold it: the server confirms on send.
 */
export function canSubmit(state: SendState): boolean {
  return (
    state.filled === ANSWER_COUNT &&
    state.withinLimits &&
    state.emailOk &&
    state.tickerStatus !== "taken" &&
    state.tickerStatus !== "invalid" &&
    !state.submitting
  );
}

/** The label over the section: what the six answers add up to. */
export function progressLabel({
  sent,
  filled,
  withinLimits: within,
}: {
  sent: boolean;
  filled: number;
  withinLimits: boolean;
}): string {
  if (sent) {
    return "SENT";
  }
  if (filled < ANSWER_COUNT) {
    return `${ANSWER_COUNT - filled} TO GO`;
  }
  return within ? "ALL SIX IN" : "TRIM THE LONG ANSWERS";
}

/**
 * The line beside Send. When the button is off, this says why, so a disabled control never leaves
 * the applicant guessing.
 */
export function sendHint(state: SendState): string {
  if (state.submitting) {
    return "Sending…";
  }
  if (canSubmit(state)) {
    return "All six in. Send it.";
  }
  if (state.filled < ANSWER_COUNT) {
    return `${ANSWER_COUNT - state.filled} to go`;
  }
  if (!state.withinLimits) {
    return "Trim the long answers.";
  }
  if (!state.emailOk) {
    return "Add the email the invite should go to.";
  }
  if (state.tickerStatus === "taken") {
    return "That ticker is taken. Pick another.";
  }
  return "Fix the ticker.";
}

export type HintTone = "quiet" | "good" | "bad";

export interface Hint {
  text: string;
  tone: HintTone;
}

/** The line under the name and ticker, in order of what matters most. */
export function tickerHint(
  ticker: string,
  status: TickerStatus,
  serverError: string | undefined,
): Hint {
  if (serverError) {
    return { text: serverError, tone: "bad" };
  }
  if (!has(ticker)) {
    return { text: "Type a name and we suggest a ticker. You can change it.", tone: "quiet" };
  }
  switch (status) {
    case "invalid":
      return {
        text: "Tickers are 2 to 6 letters or digits, starting with a letter.",
        tone: "bad",
      };
    case "taken":
      return { text: `${ticker} is taken. Try another.`, tone: "bad" };
    case "available":
      return { text: `${ticker} is free. Edit it if you want something else.`, tone: "good" };
    case "checking":
      return { text: `Checking ${ticker}…`, tone: "quiet" };
    default:
      return { text: `${ticker} looks good. We confirm it when you send.`, tone: "good" };
  }
}

export interface Block {
  id: string;
  swatch: Swatch;
  value: string;
  label: string;
}

/** What paints each block. Resolvers for the two answers whose colour depends on the choice. */
export interface BlockSwatches {
  email: Swatch;
  name: Swatch;
  handle: Swatch;
  edge: Swatch;
  whyYou: Swatch;
  category: (name: string) => Swatch;
  personality: (name: string) => Swatch;
}

export const EMAIL_PLACEHOLDER = "you@email.com";

/**
 * The YOUR PIECE rail and WHAT YOU SENT: the email block first, then one block per answer that is
 * in, in the order the form asks them.
 */
export function blocksOf(
  fields: Fields,
  email: string,
  ticker: string,
  swatches: BlockSwatches,
): Block[] {
  const answers = answersOf(fields);
  const blocks: Block[] = [
    {
      id: "email",
      swatch: swatches.email,
      value: emailLooksOk(email) ? email.trim() : EMAIL_PLACEHOLDER,
      label: "INVITE GOES HERE",
    },
  ];
  if (answers.name) {
    blocks.push({
      id: "name",
      swatch: swatches.name,
      value: fields.agentName.trim(),
      label: `${ticker} · NAME HELD`,
    });
  }
  if (answers.xHandle) {
    blocks.push({
      id: "handle",
      swatch: swatches.handle,
      value: fields.xHandle,
      label: "POSTS FROM",
    });
  }
  if (answers.category) {
    blocks.push({
      id: "category",
      swatch: swatches.category(fields.category),
      value: fields.category,
      label: "CATEGORY",
    });
  }
  if (answers.personality) {
    blocks.push({
      id: "personality",
      swatch: swatches.personality(fields.personality),
      value: fields.personality,
      label: "PERSONALITY",
    });
  }
  if (answers.edge) {
    blocks.push({
      id: "edge",
      swatch: swatches.edge,
      value: fields.edge.trim(),
      label: "ITS EDGE",
    });
  }
  if (answers.whyYou) {
    blocks.push({
      id: "whyYou",
      swatch: swatches.whyYou,
      value: fields.whyYou.trim(),
      label: "WHY YOU",
    });
  }
  return blocks;
}

export const WAITLIST_REFUSAL =
  "This email is already in line. Finish from the browser you signed up with.";

/**
 * A seat is bound to a browser (spec A2). The waitlist answers 200 to an email it already has, but
 * only the browser holding that seat gets the cookie back; any other gets `canApply: false`, and
 * this is what the form says then.
 */
export function waitlistRefusal(placement: Pick<JoinWaitlistResponse, "canApply">): string | null {
  return placement.canApply ? null : WAITLIST_REFUSAL;
}
