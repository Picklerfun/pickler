/**
 * The Studio, rendered without a session, so the design checks have the screen to look at.
 *
 * Every section of this screen is behind Supabase auth and the studio API. With neither present —
 * which is every environment `scripts/design` runs against — `/studio` renders a sign-in stub, and
 * a contrast, token or type check that walks thirty-three elements of that stub reports the same
 * green as a check that walked the whole studio. That is the failure the verification is meant to
 * catch, so the screen has to be reachable.
 *
 * It is reachable only where it cannot be mistaken for the product: never in a production build,
 * and only when authentication is not configured at all, which is already a dead end — nobody can
 * sign in, so there is no real studio for this to stand in front of. The screen says so, in the
 * banner the shell draws above the section.
 *
 * The numbers are the canvas's own (`Pickler Studio v4.dc.html`), so a screenshot can be held
 * beside it. Nothing here is a claim about anyone's workspace.
 */
import { isAuthConfigured } from "../auth/lib/config";
import type { Agent, Catalog, Options, Run, RunEvent } from "./api";

export type PreviewState = {
  agents: Agent[];
  runs: Run[];
  events: RunEvent[];
  catalog: Catalog;
  options: Options;
};

/** Fixed offsets from a caller-supplied clock, so the countdown and the stamps stay coherent. */
const MINUTE = 60_000;

/** The canvas agent's configuration; the home's `?stage=` fixture starts from it too. */
export const previewConfig: Agent["config"] = {
  limits: {
    searches: 3,
    pageReads: 4,
    steps: 10,
    durationMs: 180_000,
    outputTokens: 8192,
    dailyRuns: 6,
  },
  profile:
    "Late-week NFL winner markets. I hunt the gap between a sportsbook line that has already moved on an injury and a prediction market that has not. I refuse anything inside sixty minutes of kickoff, and I will not commit above a twenty-point range.",
  marketScope: { version: 1, category: "sports", subcategories: ["american-football"] },
  tools: ["getMarketRules", "getOrderBook", "searchWeb", "readPage", "getSportsContext"],
  plugins: { version: 1, enabled: ["polymarket", "exa", "balldontlie", "paper-trading"] },
  intervalHours: 6,
  uncertaintyPolicy: {
    blockHighUncertainty: true,
    requireCompleteInformation: false,
    minProbabilityMargin: 0.04,
    maxProbabilityRangeWidth: 0.2,
  },
};

const report = (
  entries: [string, "supported" | "conflicting" | "missing", string, number][],
): { section: string; status: string; explanation: string; sourceIds: string[] }[] =>
  entries.map(([section, status, explanation, sources]) => ({
    section,
    status,
    explanation,
    sourceIds: Array.from({ length: sources }, (_, index) => `s${index + 1}`),
  }));

function decision(now: number) {
  const assessment = {
    action: "TRADE" as const,
    marketId: "518203",
    outcomeId: "YES · Chiefs",
    thesis:
      "Kansas City's line moved two points on the Thursday injury report and the market has not followed. The books have the Chiefs at roughly 0.71; this market is still trading at 0.63.",
    counterEvidence:
      "Buffalo has covered four of five at home and the Chiefs are on a short week. One beat writer reports the starting tackle may return, which would move the line back.",
    uncertainty:
      "The injury report is preliminary and the Friday practice report is not out. The range is wide because the tackle's status swings it.",
    sourceIds: ["s1", "s2", "s3", "s4", "s5"],
    probability: { lower: 0.66, estimate: 0.71, upper: 0.78 },
    uncertaintyLevel: "MEDIUM" as const,
    missingInformation: [],
    observedPrice: "0.63",
    limitPrice: "0.68",
    expiresAt: null,
    abstentionReason: null,
    report: {
      protocol: "nfl-winner-v1" as const,
      forecast: {
        outcomeId: "YES · Chiefs",
        probability: { lower: 0.66, estimate: 0.71, upper: 0.78 },
        inabilityReason: null,
      },
      sections: report([
        [
          "identity",
          "supported",
          "Both teams and the kickoff time match the market's own rules.",
          2,
        ],
        [
          "schedule",
          "supported",
          "Sunday 16:25 ET, inside the three-day horizon and past the sixty-minute lead.",
          1,
        ],
        ["rules", "supported", "Resolves on the official final score; overtime counts.", 1],
        ["teamContext", "supported", "Kansas City 9-3, Buffalo 8-4. Buffalo 5-1 at home.", 3],
        [
          "injuries",
          "conflicting",
          "One report has the starting tackle returning; two have him out.",
          3,
        ],
        [
          "supporting",
          "supported",
          "Sportsbook consensus sits eight points above the market price.",
          2,
        ],
        ["contradicting", "conflicting", "Buffalo's home split argues the other way.", 2],
        [
          "quotes",
          "missing",
          "No post-practice quotes from either head coach were published in time.",
          0,
        ],
        [
          "limitations",
          "supported",
          "The Friday practice report lands after this run's window.",
          1,
        ],
      ]),
    },
  };
  return {
    schemaVersion: 3 as const,
    ...assessment,
    estimatedProbability: assessment.probability.estimate,
    modelAssessment: assessment,
    forecast: assessment.report.forecast,
    coverage: assessment.report.sections,
    policyEvaluation: {
      version: "1.0.0" as const,
      config: previewConfig.uncertaintyPolicy!,
      finalAction: "TRADE" as const,
      reasonCodes: [],
      evaluatedAt: new Date(now - 94 * MINUTE).toISOString(),
    },
  };
}

function run(now: number, index: number, over: Partial<Run>): Run {
  return {
    id: `0000000${index}-0000-4000-8000-000000000000`,
    tenantId: "preview",
    agentId: "preview-agent",
    trigger: "schedule",
    marketId: null,
    status: "completed",
    createdAt: now - index * 94 * MINUTE,
    startedAt: now - index * 94 * MINUTE,
    finishedAt: now - index * 94 * MINUTE + 2 * MINUTE,
    configVersion: 7,
    config: previewConfig,
    decision: null,
    error: null,
    ...over,
  } as Run;
}

/** The plugin roster and its tools, as `/options` answers it. Skills draws its rows from this. */
const options: Options = {
  defaults: {
    profile: previewConfig.profile,
    tools: previewConfig.tools,
    limits: previewConfig.limits,
    intervalHours: previewConfig.intervalHours,
    uncertaintyPolicy: previewConfig.uncertaintyPolicy,
  },
  plugins: [
    { id: "polymarket", version: "v1.4.0", tools: ["getMarketRules", "getOrderBook"] },
    { id: "exa", version: "v2.1.3", tools: ["searchWeb", "readPage"] },
    { id: "balldontlie", version: "v1.0.2", tools: ["getSportsContext"] },
    { id: "the-odds-api", version: "v1.2.0", tools: ["getExternalOdds"] },
    { id: "paper-trading", version: "v0.9.1", tools: [] },
  ],
};

const catalog: Catalog = {
  version: 1,
  categories: [
    {
      id: "sports",
      label: "Sports",
      subcategories: [
        { id: "soccer", label: "Soccer" },
        { id: "american-football", label: "American football" },
        { id: "basketball", label: "Basketball" },
        { id: "tennis", label: "Tennis" },
      ],
    },
  ],
};

/**
 * The fixture's `/options`, for a creation screen shown as a preview where authentication *is*
 * configured but there is no session behind the screen — outside production only, and the caller
 * checks that. `studioPreview` cannot serve it: its gate also requires Supabase to be unconfigured.
 */
export function previewOptions(): Options {
  return options;
}

/**
 * Whether the fixture may stand in for the studio. Both inputs are arguments rather than reads so
 * each condition can be pinned on its own: a gate tested only through the environment it happens to
 * run in is a gate tested in one position.
 */
export function previewAllowed(nodeEnv: string | undefined, authConfigured: boolean): boolean {
  return nodeEnv !== "production" && !authConfigured;
}

/** The preview, or null when the real studio — or someone else's screen — is what should render. */
export function studioPreview(now: number, search = ""): PreviewState | null {
  if (!previewAllowed(process.env.NODE_ENV, isAuthConfigured())) {
    return null;
  }
  // `?state=empty` is the empty studio: the same fixture with nothing in it, so the journey from no
  // agents to a first one is a screen a check can reach rather than a database to empty.
  if (new URLSearchParams(search).get("state") === "empty") {
    return { agents: [], runs: [], events: [], catalog, options };
  }
  const agents: Agent[] = [
    {
      id: "preview-agent",
      productId: "preview-agent",
      tenantId: "preview",
      name: "Halftime",
      handle: "halftime",
      accent: "lime",
      version: 7,
      config: previewConfig,
      paused: false,
      scheduleEnabled: true,
      nextDueAt: now + 134 * MINUTE,
      wallet: {
        walletId: "preview-wallet",
        address: "0x7a3f5c1e9b2d4a6f8e0c3b5d7f9a1c2e4b6d91c2",
        balanceAusd: 40,
      },
      canSchedule: { ok: true, reason: null },
      canCreateAnother: { ok: true, reason: null },
      spend: { perCallAusd: 5, perDayAusd: 20 },
      spendEnforced: false,
    },
  ];
  const runs: Run[] = [
    run(now, 1, {
      status: "running",
      createdAt: now - 3 * MINUTE,
      startedAt: now - 3 * MINUTE,
      finishedAt: null,
    }),
    run(now, 2, { marketId: "518203", decision: decision(now) as Run["decision"] }),
    run(now, 3, {
      trigger: "manual",
      marketId: "517880",
      status: "failed",
      error: "exa: page read timed out after 30s",
    }),
    run(now, 4, { marketId: "517412" }),
  ];
  const events: RunEvent[] = [
    {
      id: 1,
      type: "run.queued",
      data: { trigger: "schedule", configVersion: 7 },
      createdAt: now - 3 * MINUTE,
    },
    {
      id: 2,
      type: "run.started",
      data: { worker: "eu-west-1" },
      createdAt: now - 3 * MINUTE + 400,
    },
    {
      id: 3,
      type: "tool.getMarketRules",
      data: { lead: "≥ 60 min", horizon: "≤ 3 days", scope: "pre-event" },
      createdAt: now - 2 * MINUTE,
    },
  ];
  return { agents, runs, events, catalog, options };
}
