/**
 * The brief home at each `?stage=brief-*`, outside production only (see `home/stage.ts`): Halftime's
 * brief, run once on paper against Chiefs vs. Bills. The events are the types the runtime writes,
 * `brief_evaluation` included, so the panel goes through the same trace and result code a real run
 * does. The clock is fixed so the server and the browser draw the same screen.
 */
import type { PreviewRun, RunEvent } from "../api";
import type { BriefStaged } from "../home/empty";
import type { BriefStage } from "../home/stage";
import { emptyForm, fingerprint, type BriefForm } from "./model";

const START = Date.UTC(2026, 8, 28, 18, 0, 0);
const PREVIEW_ID = "0000000b-0000-4000-8000-000000000000";
const ENTERS = [
  "A starter is ruled out on the injury report",
  "The market has not moved since the report",
];

const form: BriefForm = {
  ...emptyForm(),
  name: "Halftime",
  thesis: "Injury news reaches the sportsbooks before this market prices it.",
  reads: "espn.com\n@AdamSchefter",
  enters: ENTERS.join("\n"),
  exits: "The line moves back",
  never: "Trade within an hour of kickoff",
};

/** [seconds from the start, type, data], in the order the runtime writes them. */
const TRACE: [number, string, unknown][] = [
  [1, "runtime", { worker: "local" }],
  [2, "eligible_candidates", [{ id: "518203" }, { id: "518207" }, { id: "518211" }]],
  [9, "selection", { marketId: "518203", reason: "The line moved overnight." }],
  [
    10,
    "market",
    {
      id: "518203",
      question: "Chiefs vs. Bills",
      outcomes: [
        { id: "chiefs", label: "Chiefs" },
        { id: "bills", label: "Bills" },
      ],
    },
  ],
  [24, "search_query", { query: "Chiefs injury report", intent: "supporting" }],
  [41, "search_query", { query: "Chiefs line since the report", intent: "contradicting" }],
  [88, "model_assessment", { action: "TRADE" }],
  [
    89,
    "brief_evaluation",
    {
      entries: ENTERS.map((rule) => ({ rule, fired: true, why: "The Thursday report says so." })),
      exitArmed: "The line moves back",
      neverChecked: [{ rule: "Trade within an hour of kickoff", respected: true }],
      stoppedBy: null,
    },
  ],
  [112, "policy_evaluation", { finalAction: "TRADE", reasonCodes: [] }],
];

const decision = {
  action: "TRADE",
  marketId: "518203",
  outcomeId: "chiefs",
  abstentionReason: null,
} as unknown as NonNullable<PreviewRun["decision"]>;

export function briefFixture(stage: BriefStage): BriefStaged {
  const done = stage !== "brief-running";
  const events: RunEvent[] = TRACE.slice(0, done ? TRACE.length : 6).map(
    ([seconds, type, data], index) => ({
      id: index + 1,
      type,
      data,
      createdAt: START + seconds * 1000,
    }),
  );
  const run: PreviewRun = {
    id: PREVIEW_ID,
    status: done ? "completed" : "running",
    createdAt: START,
    startedAt: START,
    finishedAt: done ? START + 113_000 : null,
    expiresAt: START + 86_400_000,
    adopted: false,
    decision: done ? decision : null,
    error: null,
  };
  return {
    // Stale: the per-trade cap was raised after the run.
    form: stage === "brief-stale" ? { ...form, perTrade: 10 } : form,
    available: true,
    paper: {
      id: PREVIEW_ID,
      ranFor: fingerprint(form),
      perTrade: form.perTrade,
      run,
      view: { run, events },
    },
  };
}
