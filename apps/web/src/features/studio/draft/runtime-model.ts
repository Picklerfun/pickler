/**
 * The draft Console on the Perpl paper runtime (perpl-paper-runtime-v1 R2, R17;
 * studio-draft-dashboard-v1 D12, D19): whether "Run it on paper" is open and why not, the check's
 * timed steps as "What it did" lists them, its outcome card, and the paper positions Trades and
 * Overview list. Pure, no React and no transport, pinned in
 * `apps/web/test/studio-draft-runtime.test.ts`.
 *
 * With the runtime off (`runtimeEnabled` false, or the record unread) the Console keeps its Soon
 * state; nothing here is consulted for it.
 */
import type {
  PerpsCheckDetailDto,
  PerpsPositionsResponseDto,
  PerpsRecordDto,
} from "@pickler/api-schema";
import { clock } from "../shell/clock";

/** How often a running check is read again. */
export const CHECK_POLL_MS = 1500;

/** The runtime is open for this agent: only a record read that says so opens the Console. */
export const runtimeOpen = (record: PerpsRecordDto | null): boolean =>
  record?.runtimeEnabled === true;

/** A check still to finish: polled until it is. */
export const checkRunning = (check: Pick<PerpsCheckDetailDto, "status"> | null): boolean =>
  check !== null && check.status !== "finished";

export interface RunButtonView {
  /** "Run it on paper", "Running", "Run it again". */
  label: string;
  /** Shut (aria-disabled): view only, a check running, or today's manual checks used. */
  shut: boolean;
  /** The tracked line under the button: today's count, and the reason when shut. */
  note: string;
}

/**
 * The run button (canvas `runLabel`): "Running" while a check is out, "Run it again" once one
 * finished, else "Run it on paper". Shut with the reason for a view-only member, while a check
 * runs, and once today's manual checks are used ("6 OF 6 TODAY", R2); the count is always shown.
 */
export function runButtonView(input: {
  record: PerpsRecordDto;
  /** A check is being started or polled. */
  running: boolean;
  /** A check of this agent has finished (this one or an earlier one). */
  ran: boolean;
  canManage: boolean;
}): RunButtonView {
  const { manualChecks, manualLimit } = input.record.today;
  const count = `${Math.min(manualChecks, manualLimit)} OF ${manualLimit} TODAY`;
  let label = "Run it on paper";
  if (input.running) {
    label = "Running";
  } else if (input.ran) {
    label = "Run it again";
  }
  if (input.running) {
    return { label, shut: true, note: `A CHECK IS RUNNING · ${count}` };
  }
  if (!input.canManage) {
    return { label, shut: true, note: `VIEW ONLY · THE OWNER RUNS IT · ${count}` };
  }
  if (manualChecks >= manualLimit) {
    return { label, shut: true, note: `${count} · IT CAN RUN AGAIN TOMORROW (UTC)` };
  }
  return { label, shut: false, note: count };
}

/** The RUN IT ON PAPER card's state (canvas `runState`): IDLE, RUNNING or DONE. */
export function runState(running: boolean, check: PerpsCheckDetailDto | null): string {
  if (running) {
    return "RUNNING";
  }
  return check?.status === "finished" ? "DONE" : "IDLE";
}

/** WHAT IT DID's meta: the check's local time once there is one, else NO RUNS YET. */
export function didMeta(check: PerpsCheckDetailDto | null): string {
  if (!check) {
    return "NO RUNS YET";
  }
  return `RUN AT ${clock(new Date(check.at))}`;
}

/** The words for a refused "Run it on paper" (`POST /perps/checks`), by the API's code. */
export function checkRefusal(code: string, limit: number, fallback: string): string {
  switch (code) {
    case "MANUAL_LIMIT":
      return `That's ${limit} paper runs today. It can run again tomorrow (UTC).`;
    case "CHECK_RUNNING":
      return "A check is already running. It shows here as it goes.";
    case "RUNTIME_DISABLED":
      return "Paper runs are closed right now.";
    case "NOT_A_PERPL_AGENT":
      return "This draft does not trade on Perpl, so there is nothing to run on paper.";
    default:
      return fallback;
  }
}

export type StepKind = "brief" | "read" | "model" | "rules" | "act" | "trade" | "stood" | "failed";

export interface StepLine {
  text: string;
  /** Seconds since the check started ("1.9s"), as the canvas times its lines. */
  meta: string;
  iso: string;
  kind: StepKind;
}

/** A step's dot by what it says, in the runner's words (`composition/perps-check.ts`). */
function stepKind(text: string): StepKind {
  if (text.startsWith("Read the brief")) {
    return "brief";
  }
  if (text.startsWith("Read ")) {
    return "read";
  }
  if (text.startsWith("Asked the model")) {
    return "model";
  }
  if (/^(Entry|Entries|Exit|Never|No entry)/.test(text)) {
    return "rules";
  }
  return "act";
}

/**
 * "What it did": the check's steps in order, each timed from the check's start. Once the check has
 * finished its last step takes the outcome's tone.
 */
export function stepLines(check: PerpsCheckDetailDto): StepLine[] {
  const first = check.steps[0];
  const start = Date.parse(check.startedAt ?? first?.at ?? check.at);
  const last = check.steps.length - 1;
  return check.steps.map((step, index) => {
    const elapsed = Math.max(0, Date.parse(step.at) - start);
    return {
      text: step.text,
      meta: `${(elapsed / 1000).toFixed(1)}s`,
      iso: step.at,
      kind:
        check.status === "finished" && index === last ? outcomeTone(check) : stepKind(step.text),
    };
  });
}

/** The outcome card's colour: a trade (lime), stood down (pink), or failed (loss). */
export function outcomeTone(
  check: Pick<PerpsCheckDetailDto, "outcome">,
): "trade" | "stood" | "failed" {
  if (check.outcome === "entered" || check.outcome === "exited" || check.outcome === "proposed") {
    return "trade";
  }
  return check.outcome === "failed" ? "failed" : "stood";
}

export interface OutcomeLine {
  /** The brief's own line, or "Entry n" when the brief no longer has it. */
  text: string;
  /** The model's why for it, or "". */
  why: string;
  tag: string;
  kind: "met" | "held" | "exit" | "broken";
}

export interface OutcomeCard {
  tone: "trade" | "stood" | "failed";
  /** ITS TRADE · STOOD DOWN · IT WOULD ASK YOU · IT FAILED. */
  eyebrow: string;
  /** The server's outcome text ("ENTERED LONG BTC", "ENTRY 2 HELD"), or the outcome. */
  tag: string;
  /** "LONG BTC · 5 AUSD · 1×", "HOLD ETH", "NO DECISION". */
  title: string;
  /** "68% · 24H HORIZON", or "" with no call. */
  meta: string;
  lines: OutcomeLine[];
  /** The model's rationale, or the failure's code, or "". */
  rationale: string;
}

const ACTION: Record<NonNullable<PerpsCheckDetailDto["action"]>, string> = {
  "open-long": "LONG",
  "open-short": "SHORT",
  close: "CLOSE",
  hold: "HOLD",
};

const EYEBROW: Record<NonNullable<PerpsCheckDetailDto["outcome"]>, string> = {
  entered: "ITS TRADE",
  exited: "ITS TRADE",
  proposed: "IT WOULD ASK YOU",
  held: "STOOD DOWN",
  blocked: "STOOD DOWN",
  skipped: "STOOD DOWN",
  failed: "IT FAILED",
  system: "STOOD DOWN",
};

/**
 * The finished check's card (canvas 563–598 without Accept / Reject / Ask, which are decision
 * review and not this spec): the outcome tag, the call (instrument, action, probability, horizon,
 * with the margin and leverage of the paper position it opened), which entries were met and which
 * held, the exits met, any never line broken, and the rationale.
 */
export function outcomeCard(
  check: PerpsCheckDetailDto,
  brief:
    | { entersWhen: readonly string[]; exitsWhen: readonly string[]; never: readonly string[] }
    | undefined,
  positions: PerpsPositionsResponseDto | null,
): OutcomeCard {
  const tone = outcomeTone(check);
  const opened = positions?.open.find((p) => p.checkId === check.id) ?? null;
  let title = "NO DECISION";
  if (check.action && check.instrument) {
    title = `${ACTION[check.action]} ${check.instrument}`;
    if (opened && check.action !== "close" && check.action !== "hold") {
      title += ` · ${amount(opened.margin)} AUSD · ${opened.leverage}×`;
    }
  }
  const parts: string[] = [];
  if (check.probability !== null) {
    parts.push(`${Math.round(check.probability * 100)}%`);
  }
  if (check.horizonHours !== null) {
    parts.push(`${check.horizonHours}H HORIZON`);
  }
  const lines: OutcomeLine[] = [
    ...check.entries.map((line) => ({
      text: brief?.entersWhen[line.index - 1] ?? `Entry ${line.index}`,
      why: line.why,
      tag: line.met ? "MET" : "HELD",
      kind: line.met ? ("met" as const) : ("held" as const),
    })),
    ...check.exits
      .filter((line) => line.met)
      .map((line) => ({
        text: brief?.exitsWhen[line.index - 1] ?? `Exit ${line.index}`,
        why: line.why,
        tag: "EXIT",
        kind: "exit" as const,
      })),
    ...check.never
      .filter((line) => line.broken)
      .map((line) => ({
        text: brief?.never[line.index - 1] ?? `Never ${line.index}`,
        why: "",
        tag: "BROKEN",
        kind: "broken" as const,
      })),
  ];
  return {
    tone,
    eyebrow: check.outcome ? EYEBROW[check.outcome] : "STOOD DOWN",
    tag: check.outcomeText ?? (check.outcome ?? "done").toUpperCase(),
    title,
    meta: parts.join(" · "),
    lines,
    rationale: check.rationale ?? check.error ?? "",
  };
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** An AUSD amount or a price from a decimal string: grouped, at most two decimals ("64,210.5"). */
export const amount = (value: string): string => grouped.format(Number(value));

/** A signed P&L ("+0.06 AUSD", "−0.40 AUSD"), or "—" while unknown. */
export function pnl(value: string | null): { text: string; tone: "up" | "down" | "flat" } {
  if (value === null) {
    return { text: "—", tone: "flat" };
  }
  const n = Math.round(Number(value) * 100) / 100;
  if (n === 0) {
    return { text: "0.00 AUSD", tone: "flat" };
  }
  return n > 0
    ? { text: `+${n.toFixed(2)} AUSD`, tone: "up" }
    : { text: `−${Math.abs(n).toFixed(2)} AUSD`, tone: "down" };
}

const CLOSE_REASON: Record<
  NonNullable<PerpsPositionsResponseDto["closed"][number]["closeReason"]>,
  string
> = {
  stop: "STOP",
  take_profit: "TARGET",
  time: "TIME STOP",
  brief: "ITS BRIEF",
  owner: "CLOSED BY YOU",
  stop_all: "STOP · CLOSE ALL",
  day_loss: "DAY-LOSS STOP",
};

export interface TradeRow {
  id: string;
  state: "OPEN" | "CLOSED";
  /** "LONG BTC · 5 AUSD · 1×". */
  title: string;
  /** "OPEN · ENTRY 64,210.5 · MARK 64,480" or "CLOSED · TARGET · 2,412.8 → 2,380.4". */
  meta: string;
  pnl: { text: string; tone: "up" | "down" | "flat" };
  /** Opened (open) or closed (closed), ISO; the view prints it in local time. */
  iso: string;
  at: string;
}

/** Trades: the open paper positions first, then the closed ones, each newest first, with P&L. */
export function tradeRows(positions: PerpsPositionsResponseDto | null): TradeRow[] {
  if (!positions) {
    return [];
  }
  const open = [...positions.open]
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
    .map<TradeRow>((p) => ({
      id: p.id,
      state: "OPEN",
      title: `${p.side.toUpperCase()} ${p.instrument} · ${amount(p.margin)} AUSD · ${p.leverage}×`,
      meta: `OPEN · ENTRY ${amount(p.entryPrice)} · MARK ${p.mark === null ? "—" : amount(p.mark)}`,
      pnl: pnl(p.unrealizedPnl),
      iso: p.openedAt,
      at: clock(new Date(p.openedAt)),
    }));
  const closed = positions.closed.map<TradeRow>((p) => ({
    id: p.id,
    state: "CLOSED",
    title: `${p.side.toUpperCase()} ${p.instrument} · ${amount(p.margin)} AUSD · ${p.leverage}×`,
    meta: [
      "CLOSED",
      ...(p.closeReason ? [CLOSE_REASON[p.closeReason]] : []),
      `${amount(p.entryPrice)} → ${p.exitPrice === null ? "—" : amount(p.exitPrice)}`,
    ].join(" · "),
    pnl: pnl(p.realizedPnl),
    iso: p.closedAt,
    at: clock(new Date(p.closedAt)),
  }));
  return [...open, ...closed];
}

/** The Trades count (canvas `paperCountLabel`): "0", or "1 OPEN · 2 CLOSED". */
export function tradeCount(positions: PerpsPositionsResponseDto | null): string {
  const open = positions?.open.length ?? 0;
  const closed = positions?.closed.length ?? 0;
  return open + closed === 0 ? "0" : `${open} OPEN · ${closed} CLOSED`;
}
