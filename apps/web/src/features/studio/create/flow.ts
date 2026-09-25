/**
 * The creation screen's state, as a reducer: the draft being built, which screen is showing, and
 * whether the person arrived at the review from their line (`auto`) or step by step (`manual`).
 *
 * Pure, so the transitions the canvas draws — Back from the first manual step returns to Describe,
 * Edit from the review snapshots the draft and Cancel restores it — are pinned in
 * `apps/web/test/studio-create-flow.test.ts` rather than through a rendered screen.
 */
import { ORDER, emptyDraft, ready, type Draft, type OrderStep, type Step } from "./draft";

export type Mode = "auto" | "manual";

export interface FlowState {
  draft: Draft;
  step: Step;
  mode: Mode;
  /** True while a review row's step is open for an edit; Done and Cancel both return to review. */
  editing: boolean;
  /** The draft as it was when Edit was pressed, restored by Cancel. */
  snapshot: Draft | null;
  /** What the model proposed that cannot run yet, e.g. `venue:perpl`, flagged on the review. */
  unsupported: string[];
  error: string;
  busy: boolean;
}

export type FlowAction =
  | { type: "patch"; patch: Partial<Draft> }
  | { type: "replace"; draft: Draft }
  | { type: "go"; step: Step }
  | { type: "manual" }
  | { type: "drafted"; draft: Draft; unsupported: string[] }
  | { type: "next" }
  | { type: "back" }
  | { type: "edit"; step: OrderStep }
  | { type: "busy"; busy: boolean }
  | { type: "error"; error: string };

export function initialFlow(step: Step, draft: Draft = emptyDraft()): FlowState {
  return {
    draft,
    step,
    mode: "auto",
    editing: false,
    snapshot: null,
    unsupported: [],
    error: "",
    busy: false,
  };
}

/** The step after `step` in the manual order, or the review when it is the last. */
function after(step: Step): Step {
  const index = ORDER.indexOf(step as OrderStep);
  if (index < 0) {
    return step;
  }
  return ORDER[Math.min(index + 1, ORDER.length - 1)] ?? "review";
}

function before(state: FlowState): Step {
  if (state.step === "name") {
    return "start";
  }
  if (state.step === "review" && state.mode === "auto") {
    return "start";
  }
  const index = ORDER.indexOf(state.step as OrderStep);
  if (index <= 0) {
    return "start";
  }
  return ORDER[index - 1] ?? "start";
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "patch":
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case "replace":
      return { ...state, draft: action.draft };
    case "go":
      return { ...state, step: action.step, error: "" };
    case "manual":
      return { ...state, step: "name", mode: "manual", editing: false, error: "" };
    case "drafted":
      return {
        ...state,
        draft: { ...action.draft, prompt: state.draft.prompt },
        unsupported: action.unsupported,
        step: "reading",
        mode: "auto",
        editing: false,
        busy: false,
        error: "",
      };
    case "next": {
      if (!ready(state.step, state.draft)) {
        return state;
      }
      if (state.editing) {
        return { ...state, step: "review", editing: false, snapshot: null };
      }
      return { ...state, step: after(state.step), error: "" };
    }
    case "back": {
      if (state.editing) {
        return {
          ...state,
          draft: state.snapshot ?? state.draft,
          step: "review",
          editing: false,
          snapshot: null,
        };
      }
      return { ...state, step: before(state), error: "" };
    }
    case "edit":
      return { ...state, step: action.step, editing: true, snapshot: state.draft, error: "" };
    case "busy":
      return { ...state, busy: action.busy };
    case "error":
      return { ...state, error: action.error, busy: false };
  }
}

/** `?step=` spells the first screen `describe`; the draft rules call it `start`. */
export const STEP_PARAMS = [
  "describe",
  "reading",
  "name",
  "trades",
  "looks",
  "reads",
  "skills",
  "decides",
  "review",
  "run",
] as const;
export type StepParam = (typeof STEP_PARAMS)[number];

export function stepFromParam(value: string | string[] | undefined): Step {
  const raw = Array.isArray(value) ? value[0] : value;
  const found = STEP_PARAMS.find((param) => param === raw);
  if (!found || found === "describe") {
    return "start";
  }
  return found;
}

export function paramFromStep(step: Step): StepParam {
  return step === "start" ? "describe" : step;
}

/**
 * The canvas's own example, for a link that opens past Describe outside production: without a
 * draft those screens have nothing to show. It is the same draft the canvas's `startStep` opens
 * on, is never sent anywhere by itself, and the handle is still checked for real.
 */
export function sampleDraft(): Draft {
  return {
    ...emptyDraft(),
    prompt: "Calls NFL games off injury news before the lines move.",
    name: "Halftime",
    handle: "halftime",
    venues: ["polymarket"],
    beat: "Sports",
    subs: ["NFL"],
    webMode: "prefer",
    sites: ["espn.com", "nfl.com", "rotowire.com"],
    books: ["draftkings", "fanduel", "pinnacle"],
    skills: ["Injury double-check"],
    edge: "It reads injury reports before the books move.",
  };
}

/** What every step screen is handed: the draft, and the two ways to change it. */
export interface StepProps {
  draft: Draft;
  patch(patch: Partial<Draft>): void;
  replace(draft: Draft): void;
}
