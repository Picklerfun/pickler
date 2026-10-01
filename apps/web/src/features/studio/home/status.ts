/**
 * The studio home's words, as the "Pickler Studio v5" canvas writes them: the status pill, the
 * agent's mood and "say" line, the live strip, the picks card, the schedule note, the next-up list
 * and the deposit failures. Pure, so every branch is pinned in `studio-status.test.ts`.
 *
 * Everything here reads real data — the latest run, its events, its paper order and the studio
 * agent DTO — and nothing is invented. The canvas played a scripted run; a real one only has the
 * events the runtime wrote, so the lines below are built from those events' types and fields.
 *
 * Only types cross from `../api` (and through it `@pickler/api-schema`), which cost nothing at
 * runtime; see the note in `create/draft.ts` on why a value import would break `node:test`.
 */
import type { PaperOrder, Run, RunEvent } from "../api";
import { decisionView, two } from "../decision";
import { traceLines } from "../create/trace";

/** The schedule and next-up locks open at this balance. Core's `MIN_FUNDED_AUSD`, restated. */
export const MIN_FUNDED_AUSD = 10;

/** The intervals "Run on its own" offers, and the only ones `PUT /interval` accepts. */
export const INTERVALS = [3, 6, 12, 24] as const;
export type IntervalHours = (typeof INTERVALS)[number];

export type Pill = "WORKING" | "FIRST CALL IN" | "LIVE" | "NO CALL YET";
type Mood = "THINKING" | "RESEARCHING" | "PICKED" | "PASSED" | "WAITING" | "STOPPED";
type Tint = "violet" | "lime" | "grey" | "magenta";

/** What the home reads of the studio agent DTO: a structural subset, so a test can build one. */
export interface StatusAgent {
  scheduleEnabled: boolean;
  nextDueAt: number | null;
  config: { intervalHours: number };
  wallet: { balanceAusd: number } | null;
  canSchedule: { ok: boolean; reason: string | null };
  /** A private draft (studio-brief-v1 §6): no wallet to fund until it goes public. */
  draft?: boolean;
}

interface StatusInput {
  /** The agent's latest run, or null before it has one. */
  run: Run | null;
  /** That run's events, oldest first. */
  events: readonly RunEvent[];
  agent: StatusAgent;
  now: number;
  /** How many runs the agent has, so the words can say "first" only of the first. */
  runCount: number;
}

export interface Strip {
  line: string;
  count: string;
  tint: Tint;
}

export interface HomeStatus {
  pill: Pill;
  working: boolean;
  mood: Mood;
  moodTint: Tint;
  moodSub: string;
  say: string;
  /** Null when there is no run to describe. */
  strip: Strip | null;
  picks: "empty" | "looking" | "done";
  hasRange: boolean;
  /** The range the model has formed, once it has; the looking card draws it. */
  range: { lower: number; upper: number } | null;
  lookingNote: string;
  market: { question: string; outcome: string | null } | null;
}

const ACTIVE: Run["status"][] = ["queued", "running"];

const field = (data: unknown, key: string): unknown =>
  data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)[key]
    : undefined;

const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

interface Candidate {
  id: string;
  question: string;
  outcomes: { id: string; label: string }[];
}

function isCandidate(value: unknown): value is Candidate {
  return (
    typeof field(value, "id") === "string" &&
    typeof field(value, "question") === "string" &&
    Array.isArray(field(value, "outcomes"))
  );
}

/** The market the run chose (or was given), named from the candidates the runtime listed. */
function marketOf(run: Run | null, events: readonly RunEvent[]): Candidate | null {
  const chosen = events.find((event) => event.type === "selection");
  const id = (field(chosen?.data, "marketId") as string | undefined) ?? run?.marketId ?? null;
  if (!id) {
    return null;
  }
  const listed = events.find((event) => event.type === "eligible_candidates");
  const candidates = Array.isArray(listed?.data) ? listed.data.filter(isCandidate) : [];
  return candidates.find((candidate) => candidate.id === id) ?? null;
}

function researching(events: readonly RunEvent[]): boolean {
  return events.some(
    (event) => event.type === "selection" || event.type === "market_classification",
  );
}

function assessed(events: readonly RunEvent[]): { lower: number; upper: number } | null {
  const event = events.find((candidate) => candidate.type === "model_assessment");
  if (!event) {
    return null;
  }
  const probability = field(event.data, "probability");
  const lower = field(probability, "lower");
  const upper = field(probability, "upper");
  return typeof lower === "number" && typeof upper === "number" ? { lower, upper } : null;
}

/** "2m 11s", "48s": a run's length as the strip writes it. */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** "0:24": seconds from the run's start, as the strip's log stamps each line. */
const stamp = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** "25m", "6h", "any moment": how long until a scheduled run is due. */
function until(ms: number): string {
  if (ms <= 0) {
    return "any moment";
  }
  if (ms < 3_600_000) {
    return `${Math.max(1, Math.ceil(ms / 60_000))}m`;
  }
  return `${Math.round(ms / 3_600_000)}h`;
}

function nextRun(agent: StatusAgent, now: number): string {
  if (agent.nextDueAt === null) {
    return `in ${agent.config.intervalHours}h`;
  }
  const left = until(agent.nextDueAt - now);
  return left === "any moment" ? left : `in ${left}`;
}

/** "just now", "12m ago", "3h ago", "1d ago". */
function ago(at: number | null, now: number): string {
  const ms = at === null ? 0 : now - at;
  if (ms < 60_000) {
    return "just now";
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m ago`;
  }
  if (ms < 86_400_000) {
    return `${Math.round(ms / 3_600_000)}h ago`;
  }
  return `${Math.round(ms / 86_400_000)}d ago`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const intervalLabel = (hours: number): string =>
  hours === 24 ? "daily" : `every ${hours}h`;

export const intervalOption = (hours: number): string =>
  hours === 24 ? "Daily" : `Every ${hours}h`;

const intervalWords = (hours: number): string =>
  hours === 24 ? "once a day" : `every ${hours} hours`;

const funded = (agent: StatusAgent) => (agent.wallet?.balanceAusd ?? 0) >= MIN_FUNDED_AUSD;

/** The first-person line while a run is working, from the latest event that says something. */
function workingSay(events: readonly RunEvent[], market: Candidate | null, first: boolean): string {
  if (events.length === 0) {
    return first ? "Getting ready for my first run." : "Getting ready for this run.";
  }
  if (!researching(events)) {
    return "Scanning the markets I may call for one worth a look.";
  }
  const types = events.map((event) => event.type);
  if (types.includes("policy_evaluation")) {
    return "Checking your rules before I commit.";
  }
  if (types.includes("model_assessment")) {
    const range = assessed(events);
    return range
      ? `My range is ${two(range.lower)} to ${two(range.upper)}. Checking it against the market.`
      : "Forming my range.";
  }
  const lastSearch = last(events.filter((event) => event.type === "search_query"));
  const lastSource = last(
    events.filter((event) => event.type === "source" || event.type === "research_references"),
  );
  if (lastSearch && (!lastSource || lastSearch.id > lastSource.id)) {
    const query = field(lastSearch.data, "query");
    return typeof query === "string" ? `Looking up “${query}”.` : "Searching the web.";
  }
  if (lastSource) {
    return market ? `Reading what I found on ${market.question}.` : "Reading what I found.";
  }
  return market ? `${market.question} looks interesting.` : "I picked a market to look at.";
}

/** "Chiefs to win", "Yes · Will it rain?", or the question when the outcome has no name. */
function pickTitle(market: Candidate | null, outcomeId: string | null, marketId: string): string {
  const outcome = market?.outcomes.find((candidate) => candidate.id === outcomeId)?.label ?? null;
  if (!market) {
    return `Market ${marketId}`;
  }
  if (!outcome) {
    return market.question;
  }
  return /^(yes|no)$/i.test(outcome) ? `${outcome} · ${market.question}` : `${outcome} to win`;
}

export function homeStatus({ run, events, agent, now, runCount }: StatusInput): HomeStatus {
  const working = run !== null && ACTIVE.includes(run.status);
  const first = runCount <= 1;
  const market = marketOf(run, events);
  const decision = run?.status === "completed" ? run.decision : null;
  const traded = decision?.action === "TRADE";
  const lines = traceLines(events, run?.startedAt ?? run?.createdAt ?? 0);
  const range = assessed(events);
  const which = first ? "first" : "latest";
  const Which = first ? "First" : "Last";

  const pill: Pill = working
    ? "WORKING"
    : agent.scheduleEnabled
      ? "LIVE"
      : decision
        ? "FIRST CALL IN"
        : "NO CALL YET";

  let mood: Mood;
  let moodTint: Tint;
  let moodSub: string;
  let say: string;
  if (working && !researching(events)) {
    mood = "THINKING";
    moodTint = "violet";
    moodSub = last(lines)?.text ?? "Getting ready";
    say = workingSay(events, market, first);
  } else if (working) {
    mood = "RESEARCHING";
    moodTint = "violet";
    moodSub = market?.question ?? "The market it chose";
    say = workingSay(events, market, first);
  } else if (agent.scheduleEnabled) {
    mood = "WAITING";
    moodTint = "grey";
    moodSub = `Next run ${nextRun(agent, now)}`;
    say = `On it. I will run ${intervalWords(agent.config.intervalHours)} and only bother you when I make a call.`;
  } else if (run && decision) {
    mood = traded ? "PICKED" : "PASSED";
    moodTint = traded ? "lime" : "grey";
    const title = traded
      ? pickTitle(market, decision.outcomeId ?? null, decision.marketId)
      : (market?.question ?? `Market ${decision.marketId}`);
    moodSub = `${title} · ${which} call`;
    if (agent.draft) {
      say = `That was my ${which} call, on paper. I stay private and on paper until I go public.`;
    } else if (!funded(agent)) {
      say = `That was my ${which} call, on paper. Fund my wallet and I can keep going on my own.`;
    } else if (agent.canSchedule.ok) {
      say = "Funded. Turn on the schedule and I will keep going on my own.";
    } else {
      say = "Funded. Run me once by hand with these settings and I can keep going on my own.";
    }
  } else if (run) {
    mood = "STOPPED";
    const failed = run.status !== "completed";
    moodTint = failed ? "magenta" : "grey";
    moodSub = failed ? (run.error ?? `Run ${run.status}`) : "Finished without a call";
    say = failed
      ? `My ${which} run stopped before a call: ${run.error ?? `it was ${run.status}`}.`
      : `My ${which} run finished without a call.`;
  } else {
    mood = "WAITING";
    moodTint = "grey";
    moodSub = "No run yet";
    say = "I have not made a call yet.";
  }

  let strip: Strip | null = null;
  if (run && working) {
    const latest = last(lines);
    strip = {
      line: latest ? `${latest.text}…` : "Getting ready…",
      count: plural(lines.length, "STEP", "STEPS"),
      tint: "violet",
    };
  } else if (run) {
    const took =
      run.startedAt !== null && run.finishedAt !== null
        ? ` ${run.status === "completed" ? "in" : "after"} ${elapsed(run.finishedAt - run.startedAt)}`
        : "";
    if (run.status === "completed") {
      const sources = decision
        ? decision.sourceIds.length
        : events.filter((event) => event.type === "source").length;
      strip = {
        line: `${Which} run finished${took} · ${plural(lines.length, "step", "steps")}, ${plural(sources, "source", "sources")}`,
        count: "",
        tint: "lime",
      };
    } else {
      strip = {
        line: `${Which} run ${run.status}${took}${run.error ? ` · ${run.error}` : ""}`,
        count: "",
        tint: "magenta",
      };
    }
  }

  const searches = events.filter((event) => event.type === "search_query").length;
  return {
    pill,
    working,
    mood,
    moodTint,
    moodSub,
    say,
    strip,
    picks: decision ? "done" : working && researching(events) ? "looking" : "empty",
    hasRange: range !== null,
    range,
    lookingNote: range
      ? "Range forming · checking your rules"
      : searches
        ? `Searched ${plural(searches, "time", "times")} so far`
        : "Reading the market rules",
    market: market ? { question: market.question, outcome: null } : null,
  };
}

/** The strip's log when it is open: every line of the trace, newest first. */
export function stripLog(
  events: readonly RunEvent[],
  run: Run | null,
): { id: number; at: string; text: string }[] {
  const base = run?.startedAt ?? run?.createdAt ?? 0;
  return traceLines(events, base)
    .map((line) => {
      const event = events.find((candidate) => candidate.id === line.id);
      return { id: line.id, at: stamp((event?.createdAt ?? base) - base), text: line.text };
    })
    .reverse();
}

// ─── Picks ──────────────────────────────────────────────────────────────────────────────────────

/** Where the run's paper order stands. A pass has none; a TRADE's is read from the API. */
export type OrderState =
  | { state: "none" }
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "loaded"; order: PaperOrder };

export interface PickCard {
  action: "TRADE" | "PASS";
  title: string;
  sub: string;
  range: { lower: number; estimate: number; upper: number } | null;
  market: number | null;
  rangeText: string;
  marketText: string;
  reason: string;
  /** "TRACKED ON PAPER · 10 AT 0.54" for a TRADE; null for a pass. */
  paper: string | null;
}

function paperLine(order: OrderState): string | null {
  switch (order.state) {
    case "none":
      return null;
    case "loading":
      return "PLACING IT ON PAPER…";
    case "missing":
    case "error":
      return "NOT TRACKED ON PAPER";
    case "loaded": {
      const { order: paper } = order;
      if (paper.status === "filled" && paper.fill) {
        return `TRACKED ON PAPER · ${paper.fill.quantity} AT ${paper.fill.averagePrice}`;
      }
      if (paper.status === "pending") {
        return "PLACING IT ON PAPER…";
      }
      return `NOT FILLED ON PAPER${paper.reason ? ` · ${paper.reason}` : ""}`;
    }
  }
}

/** The done card: null until the latest run has completed with a decision. */
export function pickCard(input: {
  run: Run;
  events: readonly RunEvent[];
  order: OrderState;
  now: number;
}): PickCard | null {
  const { run, events, order, now } = input;
  if (run.status !== "completed" || !run.decision) {
    return null;
  }
  const view = decisionView(run, run.decision);
  const market = marketOf(run, events);
  const traded = run.decision.action === "TRADE";
  const when = ago(run.finishedAt, now);
  const title = traded
    ? pickTitle(market, run.decision.outcomeId ?? null, run.decision.marketId)
    : (market?.question ?? `Market ${run.decision.marketId}`);
  let sub: string;
  if (!traded) {
    sub = `Passed · ${when}`;
  } else if (market && title !== market.question && !title.endsWith(market.question)) {
    sub = `${market.question} · ${when}`;
  } else {
    sub = when;
  }
  const range = view.probability;
  const observed = view.observedPrice;
  let reason: string;
  if (traded) {
    reason =
      range && observed !== null && observed < range.lower
        ? "The price sits under its whole range, and none of your rules stopped it."
        : "None of your rules stopped it.";
  } else {
    reason =
      view.abstentionReason ||
      view.codes.map((code) => code.why).join(" ") ||
      "It passed on this one.";
  }
  return {
    action: traded ? "TRADE" : "PASS",
    title,
    sub,
    range,
    market: observed,
    rangeText: range ? `${two(range.lower)} – ${two(range.upper)}` : "—",
    marketText: two(observed),
    reason,
    paper: traded ? paperLine(order) : null,
  };
}

// ─── Run on its own ─────────────────────────────────────────────────────────────────────────────

interface ScheduleView {
  /** The switch cannot turn on. A schedule that is on can always be turned off. */
  locked: boolean;
  note: string;
  title: string;
}

export function scheduleView(agent: StatusAgent, now: number): ScheduleView {
  if (agent.scheduleEnabled) {
    const left = nextRun(agent, now);
    return {
      locked: false,
      note: `On. Next run ${left}.`,
      title: "Turn the schedule on or off",
    };
  }
  if (agent.canSchedule.ok) {
    return { locked: false, note: "Ready. Off for now.", title: "Turn the schedule on or off" };
  }
  if (agent.canSchedule.reason === "first_run") {
    return {
      locked: true,
      note: "Unlocks after its first run.",
      title: "Locked until the first run finishes",
    };
  }
  return {
    locked: true,
    note: "Fund its wallet to let it run on its own · min. 10 AUSD.",
    title: "Fund its wallet first",
  };
}

// ─── Next up ────────────────────────────────────────────────────────────────────────────────────

export interface NextItem {
  key: "fund";
  title: string;
  note: string;
  cta: string;
  done: boolean;
}

/** One item today, as the spec scopes it: "Fund its wallet", once its first call is in. */
export function nextUp(input: { callIn: boolean; balanceAusd: number }): {
  items: NextItem[];
  count: string;
} {
  if (!input.callIn) {
    return { items: [], count: "" };
  }
  const done = input.balanceAusd >= MIN_FUNDED_AUSD;
  const items: NextItem[] = [
    {
      key: "fund",
      title: "Fund its wallet",
      note: done ? "Done" : "At least 10 AUSD to run on its own.",
      cta: "Deposit",
      done,
    },
  ];
  const left = items.filter((item) => !item.done).length;
  return { items, count: left ? `${left} LEFT` : "ALL DONE" };
}

// ─── Deposit ────────────────────────────────────────────────────────────────────────────────────

/**
 * A deposit's failure in the person's terms. A confirm the API already recorded is not a failure:
 * the money moved, so the screen treats it as done and reads the balance again.
 */
export function depositFailure(code: string, message: string): { done: boolean; message: string } {
  switch (code) {
    case "DEPOSIT_NOT_SENDABLE":
      return { done: false, message: "Your master wallet can't cover this. Add AUSD to it first." };
    case "DEPOSIT_FEE_TOO_HIGH":
      return { done: false, message: "Network fees jumped. Try again." };
    case "DEPOSIT_NONCE_MISMATCH":
      return {
        done: false,
        message: "Your master wallet sent another transaction. Try again.",
      };
    case "DEPOSIT_ALREADY_RECORDED":
      return { done: true, message: "" };
    default:
      return { done: false, message };
  }
}
