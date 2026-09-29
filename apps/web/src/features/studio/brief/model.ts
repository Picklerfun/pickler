/**
 * The brief home's rules (docs/specs/studio-brief-v1.md §5, the "Pickler Studio Empty v4"
 * canvas): the handle a name becomes, the section tags, the risk steppers, the fingerprint a run is
 * taken with, and the Run and Create labels in the canvas's order. Pure, no React and no transport,
 * so each rule is pinned in `apps/web/test/studio-brief.test.ts`.
 *
 * `BRIEF_LIMITS`, `LEVERAGE_BOUNDS` and `PAPER_BUDGET_AUSD` are literal copies of api-schema's
 * (which mirror core's), and `readKind` copies core's `classifyRead` site rule: this module is
 * required by node:test from CommonJS, where an "import"-only package cannot be loaded statically.
 * The test pins each copy through a dynamic import.
 */
export type SectionKey = "thesis" | "reads" | "enters" | "exits" | "never";
export type StepperKey = "perTrade" | "perDay" | "leverage";

export interface BriefForm {
  name: string;
  thesis: string;
  reads: string;
  enters: string;
  exits: string;
  never: string;
  perTrade: number;
  perDay: number;
  leverage: number;
}

/** The canvas's five sections: label, sub, rows and placeholder. */
export const SECTIONS: {
  key: SectionKey;
  label: string;
  sub: string;
  rows: number;
  placeholder: string;
}[] = [
  {
    key: "thesis",
    label: "THESIS",
    sub: "why this edge exists, in plain words",
    rows: 3,
    placeholder: "What does this agent believe that the market does not price yet?",
  },
  {
    key: "reads",
    label: "IT READS",
    sub: "one source per line",
    rows: 4,
    placeholder: "A feed, an @account, a site it trusts…",
  },
  {
    key: "enters",
    label: "ENTERS WHEN",
    sub: "every line must be true",
    rows: 4,
    placeholder: "Conditions, one per line. The run shows which ones fired.",
  },
  {
    key: "exits",
    label: "EXITS WHEN",
    sub: "the first line that turns true closes it",
    rows: 3,
    placeholder: "Take profit, stop, time limit…",
  },
  {
    key: "never",
    label: "NEVER",
    sub: "hard lines it will not cross",
    rows: 3,
    placeholder: "The things a tired human would do at 3am.",
  },
];

/** Mirrors `BRIEF_LIMITS` in `@pickler/api-schema`. */
export const BRIEF_LIMITS = {
  thesis: 600,
  line: 200,
  reads: 12,
  entersWhen: 8,
  exitsWhen: 8,
  never: 8,
} as const;
/** Mirrors `LEVERAGE_BOUNDS` in `@pickler/api-schema`. */
export const LEVERAGE_BOUNDS = { min: 1, max: 10 } as const;
/** Mirrors `PAPER_BUDGET_AUSD` in `@pickler/api-schema`: a paper order never spends more. */
export const PAPER_BUDGET_AUSD = 10;

export const STARTER = { perTrade: 5, perDay: 20, leverage: 2 } as const;

/** The canvas's steppers. The maxima are core's `SPEND_BOUNDS`; leverage is Soon (perps). */
export const STEPPERS: readonly {
  key: StepperKey;
  title: string;
  min: number;
  step: number;
  max: number;
  unit: string;
  soon: boolean;
}[] = [
  { key: "perTrade", title: "PER TRADE", min: 5, step: 5, max: 1_000, unit: " AUSD", soon: false },
  { key: "perDay", title: "PER DAY", min: 10, step: 10, max: 10_000, unit: " AUSD", soon: false },
  {
    key: "leverage",
    title: "MAX LEVERAGE",
    min: LEVERAGE_BOUNDS.min,
    step: 1,
    max: LEVERAGE_BOUNDS.max,
    unit: "×",
    soon: true,
  },
];

export const emptyForm = (): BriefForm => ({
  name: "",
  thesis: "",
  reads: "",
  enters: "",
  exits: "",
  never: "",
  ...STARTER,
});

/** The canvas's `split('\n').map(trim).filter(Boolean)`. */
export const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** The canvas's slug: lower-case, `[a-z0-9_]` only, up to 15. */
export const deriveHandle = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 15);

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;

export type HandleState = "empty" | "invalid" | "checking" | "free" | "taken";

/** `available` is the availability check's answer for the current handle, or null while asking. */
export function handleState(name: string, available: boolean | null): HandleState {
  if (!name.trim()) {
    return "empty";
  }
  if (!HANDLE_RE.test(deriveHandle(name))) {
    return "invalid";
  }
  if (available === null) {
    return "checking";
  }
  return available ? "free" : "taken";
}

/** The handle line's colour: faint when empty, lime when OK, pink when it cannot be used. */
export function handleTone(state: HandleState): "faint" | "lime" | "pink" {
  if (state === "empty" || state === "checking") {
    return "faint";
  }
  return state === "free" ? "lime" : "pink";
}

/** What `POST /v1/studio/preview-runs` and `POST /v1/studio/drafts` are sent. */
export function toRequest(form: BriefForm) {
  return {
    brief: {
      thesis: form.thesis.trim(),
      reads: lines(form.reads),
      entersWhen: lines(form.enters),
      exitsWhen: lines(form.exits),
      never: lines(form.never),
    },
    spend: { perCallAusd: form.perTrade, perDayAusd: form.perDay },
    maxLeverage: form.leverage,
  };
}

/** The eight inputs a run is taken with (§5); the name is not one of them. */
export const fingerprint = (form: BriefForm): string => JSON.stringify(toRequest(form));

/** "EMPTY", "YOURS", or "N LINE(S) · YOURS". A blank brief has no source to be EDITED from. */
export function sectionTag(key: SectionKey, value: string): string {
  if (!value.trim()) {
    return "EMPTY";
  }
  if (key === "thesis") {
    return "YOURS";
  }
  const count = lines(value).length;
  return `${count} ${count === 1 ? "LINE" : "LINES"} · YOURS`;
}

export function riskTag(form: BriefForm): "STARTER CAPS" | "EDITED" {
  return form.perTrade !== STARTER.perTrade ||
    form.perDay !== STARTER.perDay ||
    form.leverage !== STARTER.leverage
    ? "EDITED"
    : "STARTER CAPS";
}

/** One click of a stepper, clamped to its min and max. A Soon stepper does not move. */
export function step(form: BriefForm, key: StepperKey, direction: 1 | -1): BriefForm {
  const stepper = STEPPERS.find((candidate) => candidate.key === key)!;
  if (stepper.soon) {
    return form;
  }
  const next = Math.min(stepper.max, Math.max(stepper.min, form[key] + direction * stepper.step));
  return { ...form, [key]: next };
}

/** The day ≥ trade rule the canvas does not check; the stepper says why. */
export function capsProblem(form: BriefForm): string {
  return form.perDay < form.perTrade ? "A day's cap can't be below one trade's." : "";
}

export type RunState = "IDLE" | "LIVE" | "DONE" | "STALE";

export const TERMINAL = ["completed", "failed", "cancelled"] as const;
export const isTerminal = (status: string): boolean =>
  (TERMINAL as readonly string[]).includes(status);

export function runState(
  progress: { started: boolean; terminal: boolean; ranFor: string | null },
  current: string,
): RunState {
  if (!progress.started) {
    return "IDLE";
  }
  if (!progress.terminal) {
    return "LIVE";
  }
  return progress.ranFor === current ? "DONE" : "STALE";
}

/** `nextRunAt` is the rate limit's time, already formatted, or "" when there is none. */
export function runLabel(form: BriefForm, state: RunState, nextRunAt: string): string {
  if (state === "LIVE") {
    return "Running";
  }
  if (lines(form.enters).length === 0) {
    return "Write an entry rule to run it";
  }
  if (nextRunAt) {
    return `Next run at ${nextRunAt}`;
  }
  if (state === "STALE") {
    return "Brief changed · run again";
  }
  if (state === "DONE") {
    return "Run it again";
  }
  return "Run it on paper";
}

export function canRun(form: BriefForm, state: RunState, nextRunAt: string): boolean {
  return (
    lines(form.enters).length > 0 && state !== "LIVE" && capsProblem(form) === "" && !nextRunAt
  );
}

/** `completed`: the run finished with a decision, not a failure. */
export function createLabel(
  form: BriefForm,
  handle: HandleState,
  state: RunState,
  completed: boolean,
): string {
  const derived = deriveHandle(form.name);
  if (handle === "empty") {
    return "Name it to create";
  }
  if (handle === "taken") {
    return `@${derived} is taken`;
  }
  if (handle === "invalid") {
    return `@${derived || "handle"} can't be a handle`;
  }
  if (handle === "checking") {
    return `Checking @${derived}…`;
  }
  if (state !== "DONE" || !completed) {
    return "Run it once, then create";
  }
  return `Create ${form.name.trim()}`;
}

export const canCreate = (handle: HandleState, state: RunState, completed: boolean): boolean =>
  handle === "free" && state === "DONE" && completed;

export function footNote(state: RunState): string {
  if (state === "STALE") {
    return "YOU CHANGED THE BRIEF SINCE THE LAST RUN";
  }
  if (state === "DONE") {
    return "THE BRIEF STAYS EDITABLE IN THE STUDIO";
  }
  return "NOTHING GOES PUBLIC · IT RUNS ON PAPER UNTIL YOU FUND IT";
}

export const idleNote = (form: BriefForm): string =>
  lines(form.enters).length > 0
    ? "RUN IT TO SEE WHICH RULES FIRE"
    : "IT NEEDS AT LEAST ONE ENTRY RULE";

/** Copy of core's `classifyRead`: a site the search prefers, or a line that is "Soon" (§3.4). */
export function readKind(line: string): "site" | "soon" {
  const text = line.trim();
  if (text.startsWith("@")) {
    return "soon";
  }
  let host = "";
  if (/^https?:\/\//i.test(text)) {
    try {
      host = new URL(text).hostname;
    } catch {
      return "soon";
    }
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) {
    host = text.split("/")[0]!;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  if (/^(?:[a-z0-9-]+\.)?(?:x|twitter)\.com$/.test(host)) {
    return "soon";
  }
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? "site" : "soon";
}

const FIELD_SECTION: Record<string, SectionKey> = {
  thesis: "thesis",
  reads: "reads",
  entersWhen: "enters",
  exitsWhen: "exits",
  never: "never",
};

/** 400 INVALID_BRIEF's `field`, as the section to show it under. */
export const sectionForField = (field: string): SectionKey | null => FIELD_SECTION[field] ?? null;

/** 400 INVALID_BRIEF's `reason`, in words. */
export function briefProblemText(reason: string): string {
  if (reason === "required") {
    return "Write at least one line.";
  }
  if (reason === "too_many") {
    return "Too many lines for this section.";
  }
  if (reason === "too_long") {
    return `Too long: ${BRIEF_LIMITS.line} characters a line, ${BRIEF_LIMITS.thesis} for the thesis.`;
  }
  return "Check this section.";
}
