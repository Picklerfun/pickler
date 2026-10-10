/**
 * The home at each `?stage=`, drawn from the "Pickler Studio v5" canvas's own run: Halftime reading
 * NFL markets, choosing Chiefs vs. Bills, forming a 0.58–0.66 range against a 0.54 market and
 * trading it on paper. Outside production only (see `stage.ts`); nothing here is anyone's agent.
 *
 * The events are the types the runtime really writes (`eligible_candidates`, `selection`,
 * `search_query`, `model_assessment`, `policy_evaluation` …) with the fields the home reads, so the
 * preview goes through the same `homeStatus` a real run does rather than a second set of words.
 *
 * The clock is fixed, not `Date.now()`: the server renders this first, and a stamp that differs
 * between the server and the browser would rehydrate into a different screen.
 */
import type { Agent, PaperOrder, Run, RunEvent } from "../api";
import { previewConfig } from "../preview";
import type { HomeStage } from "./stage";

interface HomeFixture {
  now: number;
  agent: Agent;
  runs: Run[];
  events: RunEvent[];
  order: PaperOrder | null;
}

const START = Date.UTC(2026, 8, 25, 18, 0, 0);
const RUN_ID = "0000000a-0000-4000-8000-000000000000";
const AGENT_ID = "preview-agent";

const candidates = [
  {
    id: "518203",
    question: "Chiefs vs. Bills",
    outcomes: [
      { id: "chiefs", label: "Chiefs" },
      { id: "bills", label: "Bills" },
    ],
  },
  {
    id: "518207",
    question: "Eagles vs. Cowboys",
    outcomes: [
      { id: "eagles", label: "Eagles" },
      { id: "cowboys", label: "Cowboys" },
    ],
  },
  {
    id: "518211",
    question: "49ers vs. Rams",
    outcomes: [
      { id: "niners", label: "49ers" },
      { id: "rams", label: "Rams" },
    ],
  },
];

const probability = { lower: 0.58, estimate: 0.62, upper: 0.66 };

/** [seconds from the start, type, data], in the order the runtime writes them. */
const TRACE: [number, string, unknown][] = [
  [1, "runtime", { worker: "local" }],
  [2, "eligible_candidates", candidates],
  [9, "selection", { marketId: "518203", reason: "The line moved overnight." }],
  [10, "market_classification", { protocol: "nfl-winner-v1" }],
  [12, "source", { id: "polymarket:518203:rules", title: "Market resolution rules" }],
  [24, "search_query", { query: "Chiefs Bills injury report", intent: "supporting" }],
  [41, "search_query", { query: "Bills sportsbook line this week", intent: "contradicting" }],
  [88, "model_assessment", { action: "TRADE", probability }],
  [112, "policy_evaluation", { finalAction: "TRADE", reasonCodes: [] }],
];

/** How far into the trace each stage has got: the canvas's step 2, step 5 and the end. */
const REACHED: Record<HomeStage, number> = { live: 2, researching: 7, decided: TRACE.length };

function decision(): NonNullable<Run["decision"]> {
  const assessment = {
    action: "TRADE" as const,
    marketId: "518203",
    outcomeId: "chiefs",
    thesis:
      "The Chiefs' line moved on the Thursday injury report and this market has not followed. Three sportsbooks sit between 0.60 and 0.64.",
    counterEvidence: "Buffalo is strong at home and Kansas City is on a short week.",
    uncertainty: "The Friday practice report is not out, so the range stays eight points wide.",
    sourceIds: ["s1", "s2", "s3", "s4", "s5", "s6"],
    probability,
    uncertaintyLevel: "MEDIUM" as const,
    missingInformation: [],
    observedPrice: "0.54",
    limitPrice: "0.58",
    expiresAt: null,
    abstentionReason: null,
  };
  return {
    schemaVersion: 3,
    ...assessment,
    estimatedProbability: probability.estimate,
    modelAssessment: assessment,
    coverage: [],
    policyEvaluation: {
      version: "1.0.0",
      config: previewConfig.uncertaintyPolicy,
      finalAction: "TRADE",
      reasonCodes: [],
      evaluatedAt: new Date(START + 112_000).toISOString(),
    },
  } as unknown as NonNullable<Run["decision"]>;
}

export function homeFixture(stage: HomeStage): HomeFixture {
  const decided = stage === "decided";
  const reached = TRACE.slice(0, REACHED[stage]);
  const events: RunEvent[] = reached.map(([seconds, type, data], index) => ({
    id: index + 1,
    type,
    data,
    createdAt: START + seconds * 1000,
  }));
  const run = {
    id: RUN_ID,
    tenantId: "preview",
    agentId: AGENT_ID,
    trigger: "manual",
    marketId: decided ? "518203" : null,
    status: decided ? "completed" : "running",
    createdAt: START,
    startedAt: START,
    finishedAt: decided ? START + 131_000 : null,
    configVersion: 1,
    config: { ...previewConfig, intervalHours: 6 },
    decision: decided ? decision() : null,
    error: null,
  } as Run;
  const agent: Agent = {
    id: AGENT_ID,
    productId: AGENT_ID,
    tenantId: "preview",
    name: "Halftime",
    handle: "halftime",
    accent: "lime",
    avatarPattern: 0,
    draft: false,
    version: 1,
    config: { ...previewConfig, intervalHours: 6 },
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
    advicePrice: null,
    wallet: {
      walletId: "preview-wallet",
      address: "0x7a3f5c1e9b2d4a6f8e0c3b5d7f9a1c2e4b6d91c2",
      balanceAusd: 0,
    },
    canSchedule: decided ? { ok: false, reason: "unfunded" } : { ok: false, reason: "first_run" },
    canCreateAnother: { ok: false, reason: "unfunded_agent" },
    spend: null,
    spendEnforced: true,
    visibility: "public",
    publishedAt: new Date(START).toISOString(),
    xHandle: null,
  };
  const order = decided
    ? ({
        id: "preview-order",
        tenantId: "preview",
        agentId: AGENT_ID,
        runId: RUN_ID,
        marketId: "518203",
        outcomeId: "chiefs",
        status: "filled",
        virtualBudget: "10",
        createdAt: START + 132_000,
        finishedAt: START + 133_000,
        reason: null,
        fill: {
          quantity: "10",
          averagePrice: "0.54",
          market: { question: "Chiefs vs. Bills", outcomes: candidates[0]!.outcomes },
        },
      } as unknown as PaperOrder)
    : null;
  return { now: START + (decided ? 140_000 : 60_000), agent, runs: [run], events, order };
}
