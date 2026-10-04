/**
 * The live studio with the Perpl paper runtime on (docs/specs/perpl-paper-runtime-v1.md §2, §3,
 * §7; the "Pickler Studio v5 Live" canvas): the status, tiles, meters and health once it runs, the
 * strip from the newest check, Decisions' rows and filters, the positions with their stop–target
 * meter and time stop, "Waiting on you", the record, the manual check, the stops and the words for
 * the runtime's refusals.
 *
 * Every line here describes what really runs (draft spec D19): the runtime checks every hour on
 * paper once `GET /perps/record` answered `runtimeEnabled: true` (`runtimeOn`). With it off, the
 * paper an agent already holds is still drawn (`paperShown`: it has a paper account), because
 * exits, Close now and Stop · close all still run (R3); the lines say checks are paused by the
 * operator. With neither, the studio keeps `./model.ts`'s and `./run-model.ts`'s "runs soon" copy.
 *
 * Pure, no React and no transport, and it value-imports neither `@pickler/api-schema` nor
 * `@pickler/core`, so `apps/web/test/studio-live-runtime.test.ts` can load it.
 */
import type {
  PerpsActionDto,
  PerpsCheckDetailDto,
  PerpsCheckSummaryDto,
  PerpsPositionsResponseDto,
  PerpsProposalDto,
  PerpsRecordDto,
} from "@pickler/api-schema";
import { formatSignedTwo, formatTwo } from "../../agents/lib/format";
import { formatPrice } from "../../markets/lib/format";
import type { StopRow } from "./build-model";
import type { DecisionFilter, DecisionFilterKey } from "./run-model";
import { clock, stamp } from "../shell/clock";
import type { HeaderTile } from "../shell/model";
import {
  liveTiles,
  type EntryView,
  type HealthRow,
  type LiveCaps,
  type LiveCapsView,
  type LiveStatus,
  type LiveWalletRead,
  type MeterRow,
  type StripView,
} from "./model";

type OpenPosition = PerpsPositionsResponseDto["open"][number];
type ClosedPosition = PerpsPositionsResponseDto["closed"][number];
type CheckOutcome = NonNullable<PerpsCheckSummaryDto["outcome"]>;

const MINUS = "−";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ─── Is it on ──────────────────────────────────────────────────────────────────────────────────

/**
 * The runtime is on only once the record answered so: unread, failed, or `runtimeEnabled: false`
 * all keep the "runs soon" copy.
 */
export const runtimeOn = (record: PerpsRecordDto | null | "failed"): record is PerpsRecordDto =>
  record !== null && record !== "failed" && record.runtimeEnabled;

/**
 * The paper is drawn (positions, proposals, the record, the feed, Close now and Stop · close all)
 * once the runtime is on or the agent has a paper account: an operator who turns the runtime off
 * leaves the owner's positions open, still exited at stop, target and time, and still closable.
 */
export const paperShown = (record: PerpsRecordDto | null | "failed"): record is PerpsRecordDto =>
  record !== null && record !== "failed" && (record.runtimeEnabled || record.account);

/** What still runs with the runtime off, said wherever its paper is drawn. */
export const RUNTIME_OFF_NOTE =
  "Checks are paused by the operator; exits and your closes still run.";

// ─── Numbers ───────────────────────────────────────────────────────────────────────────────────

/** 25 → "25", 25.5 → "25.50": a whole amount stays whole. */
export const ausdShort = (value: number): string =>
  Number.isInteger(value) ? String(value) : formatTwo(value);

/** A signed amount, "+3.90" / "−3.20"; null (no mark) is a dash. */
export const signedAusd = (value: number | null): string =>
  value === null ? "—" : formatSignedTwo(value);

/** The tone of an amount: up, down, or neither (zero or unknown). */
export const toneOf = (value: number | null): "up" | "down" | null => {
  if (value === null || value === 0) {
    return null;
  }
  return value > 0 ? "up" : "down";
};

const signedPct = (value: number, digits: number): string =>
  `${value < 0 ? MINUS : "+"}${Math.abs(value).toFixed(digits)}%`;

/** A decimal string from the API as a number; null stays null. */
const num = (value: string | null): number | null => (value === null ? null : Number(value));

/** "≈ $0.04" for the model's cost in micro-USD; under a cent, "< $0.01". */
export function costLine(micros: string | null): string {
  if (micros === null) {
    return "—";
  }
  const usd = Number(micros) / 1_000_000;
  if (usd > 0 && usd < 0.01) {
    return "< $0.01";
  }
  return `≈ $${usd.toFixed(2)}`;
}

/** 52 minutes → "52 MIN", 190 → "3H 10M", 240 → "4H". */
export function spanLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 60) {
    return `${minutes} MIN`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}H` : `${hours}H ${rest}M`;
}

/** Seconds since the start as the canvas writes them: 7.8 s → "0:07". */
export const offsetLabel = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** How long a check took: "0.9s", "12s", "1m 12s". */
export function durationLabel(ms: number): string {
  if (ms < 10_000) {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ─── Status, tiles, meters, health ─────────────────────────────────────────────────────────────

/**
 * The chip once it runs: it checks on paper; paused is the same "PAUSED · EXITS ONLY". With the
 * runtime off and paper held (`running` false), "PAPER · CHECKS PAUSED".
 */
export function runtimeStatus(paused: boolean, running = true): LiveStatus {
  if (paused) {
    return { state: "paused", label: "PAUSED · EXITS ONLY", tone: "caution", action: "Resume" };
  }
  if (!running) {
    return {
      state: "public",
      label: "PAPER · CHECKS PAUSED",
      tone: "caution",
      action: "Pause entries",
    };
  }
  return { state: "public", label: "LIVE · ON PAPER", tone: "good", action: "Pause entries" };
}

/**
 * The four tiles once it runs: EQUITY stays its wallet's AUSD (L5); TODAY is today's realized paper
 * P&L, OPEN the open positions' P&L at the board's marks, PUT IN TODAY today's new margin.
 */
export function runtimeTiles(
  read: LiveWalletRead | null,
  perDayAusd: number,
  record: PerpsRecordDto,
): HeaderTile[] {
  const [equity] = liveTiles(read, perDayAusd);
  const open = record.today.openCount;
  return [
    equity!,
    { label: "TODAY · AUSD", value: signedAusd(record.today.realizedAusd), soon: false },
    {
      label: `OPEN · ${open} ${open === 1 ? "POSITION" : "POSITIONS"}`,
      value: open === 0 ? "0" : signedAusd(record.openPnlAusd),
      soon: false,
    },
    {
      label: `PUT IN TODAY · OF ${perDayAusd} CAP`,
      value: `${ausdShort(record.today.newMarginAusd)} AUSD`,
      soon: false,
    },
  ];
}

const fill = (used: number, cap: number): number =>
  cap > 0 ? Math.max(0, Math.min(1, used / cap)) : 0;

/** Controls' meters from today's figures, against the caps it holds. */
export function runtimeMeters(caps: LiveCaps, today: PerpsRecordDto["today"]): MeterRow[] {
  const lost = Math.max(0, -today.realizedAusd);
  return [
    {
      key: "putIn",
      title: "PUT IN TODAY",
      value: `${ausdShort(today.newMarginAusd)} / ${caps.perDayAusd} AUSD`,
      fill: fill(today.newMarginAusd, caps.perDayAusd),
    },
    {
      key: "open",
      title: "OPEN POSITIONS",
      value: `${today.openCount} / ${caps.maxOpenPositions}`,
      fill: fill(today.openCount, caps.maxOpenPositions),
    },
    {
      key: "dayLoss",
      title: "DAY-LOSS STOP",
      value: `${lost > 0 ? `${MINUS}${ausdShort(lost)}` : "0"} / ${MINUS}${caps.dayLossStopAusd} AUSD`,
      fill: fill(lost, caps.dayLossStopAusd),
    },
    {
      key: "leverage",
      title: "LEVERAGE IN USE",
      value: `${today.leverageInUse}× / ${caps.maxLeverage}× max`,
      fill: fill(today.leverageInUse, caps.maxLeverage),
    },
  ];
}

/**
 * HEALTH with the runtime's two rows after the others: its state, and the model's cost today
 * (R16; AI credits stay Soon). With the record read and the runtime off, only the state, quiet.
 */
export function runtimeHealthRows(
  rows: readonly HealthRow[],
  record: PerpsRecordDto | null | "failed",
): HealthRow[] {
  if (record === null || record === "failed") {
    return [...rows];
  }
  if (!record.runtimeEnabled && !record.account) {
    return [...rows, { key: "runtime", label: "Runtime", value: "NOT OPEN YET", tone: "quiet" }];
  }
  return [
    ...rows,
    record.runtimeEnabled
      ? { key: "runtime", label: "Runtime", value: "ON · PAPER · HOURLY", tone: "good" }
      : { key: "runtime", label: "Runtime", value: "CHECKS PAUSED · EXITS RUN", tone: "quiet" },
    {
      key: "cost",
      label: "Model cost today",
      value: costLine(record.today.costMicros),
      tone: "quiet",
    },
  ];
}

// ─── Words for what runs ───────────────────────────────────────────────────────────────────────

/**
 * Overview's and Positions' line with nothing open, once it runs (the canvas's); with the runtime
 * off (`running` false), that it opens nothing while checks are paused.
 */
export function flatLine(paused: boolean, running = true): string {
  if (!running) {
    return "Flat. Checks are paused by the operator, so it opens nothing.";
  }
  return paused
    ? "Flat. Entries are paused; it opens nothing until you resume."
    : "Flat right now. It enters when every line of the brief is true; the last checks are in Decisions.";
}

/** Decisions with no check yet, once it runs. */
export const RUNTIME_DECISIONS_EMPTY =
  "No checks yet. Every check lands here with what it did and why. Nothing here is edited after the fact.";

/**
 * HOW IT RUNS' notes once it runs: the status note says it checks hourly on paper, and the mode
 * notes lose "ONCE IT RUNS", because it does.
 */
export function runtimeEntryView(view: EntryView): EntryView {
  const then = view.statusNote.replace(/^.*; then it /, "").replace(/\.$/, "");
  return {
    ...view,
    statusNote: `It is public on Pickler and checks Perpl and its sources every hour, on paper; it ${then}.`,
    modeNote: view.modeNote.replace(/^ONCE IT RUNS · /, "ON PAPER · "),
  };
}

/**
 * STOPS once it runs: "Stop · close all" is real on paper (one inline confirm, no passkey), and
 * Auto-pause is on for the one thing the runtime pauses itself for, the day-loss stop (R11); the
 * other triggers the canvas lists (gas, credits, losing Perpl) are not built, and it says so. With
 * the runtime off and paper held (`running` false) the stops are the same, and Auto-pause says
 * checks are paused while a close that crosses the day-loss stop still pauses it.
 */
export function runtimeStopRows(paused: boolean, running = true): StopRow[] {
  return [
    {
      key: "pause",
      name: "Pause entries",
      note: "No new positions; closing its own stays allowed. One click, no passkey.",
      action: { kind: "button", label: paused ? "Resume" : "Pause" },
    },
    {
      key: "stop",
      name: "Stop · close all",
      note: "Closes every paper position at the market and pauses it. No passkey: it is paper.",
      action: { kind: "tag", label: "PAPER" },
    },
    {
      key: "auto",
      name: "Auto-pause",
      note: running
        ? "It pauses itself when today's realized loss (UTC) reaches the day-loss stop; open positions keep their exits. Pausing for gas, credits or losing Perpl comes with live trading."
        : `${RUNTIME_OFF_NOTE} A close that takes today's realized loss (UTC) to the day-loss stop still pauses it.`,
      action: { kind: "tag", label: "ON · DAY-LOSS" },
    },
  ];
}

/**
 * Limits' caps once it runs: the day-loss line says what the runtime does now (R11), and the note
 * says Pickler holds every paper trade to them, not that it will once it runs.
 */
export function runtimeCapsView(view: LiveCapsView): LiveCapsView {
  return {
    ...view,
    rows: view.rows.map((row) =>
      row.key === "dayLossStopAusd"
        ? { ...row, sub: "LOST IN A DAY (UTC) · IT PAUSES ITSELF THERE, EXITS KEEP RUNNING" }
        : row,
    ),
    note: "Pickler holds every paper trade to these. On-chain caps come with live trading.",
  };
}

/** "Stop · close all"'s inline confirm. */
export function stopConfirm(openCount: number): { title: string; note: string; cta: string } {
  const what =
    openCount === 0
      ? "Nothing is open"
      : `${openCount} paper ${openCount === 1 ? "position closes" : "positions close"} at the market`;
  return {
    title: "Stop it and close everything?",
    note: `${what}; it pauses until you resume. No passkey: it is paper.`,
    cta: "Close all & stop",
  };
}

/** The runtime's refusals in the owner's words (workers/api studio-perps routes). */
const RUNTIME_ERRORS: Record<string, string> = {
  RUNTIME_DISABLED: "The Perpl runtime is closed right now. Nothing was run.",
  MANUAL_LIMIT: "That's the 6 manual checks for today (UTC). The hourly checks go on.",
  CHECK_RUNNING: "A check is already running. It shows here when it ends.",
  POSITION_CLOSED: "That position is already closed.",
  PROPOSAL_DECIDED: "That proposal was already decided.",
  PROPOSAL_EXPIRED: "That proposal expired after 15 minutes. Nothing was entered.",
  RUNTIME_UNAVAILABLE: "The Perpl runtime isn't answering. Try again in a moment.",
  RUNTIME_CEILING: "Pickler's checks for today are used up. Try again tomorrow.",
  NOT_A_PERPL_AGENT: "This agent doesn't trade on Perpl.",
  AGENT_KILLED: "Pickler has stopped this agent, so it enters nothing. Closing stays allowed.",
};

export const runtimeErrorText = (code: string, fallback: string): string =>
  RUNTIME_ERRORS[code] ?? fallback;

// ─── The owner's actions ───────────────────────────────────────────────────────────────────────

/** What the owner asked for: an approval, one close, or "Stop · close all". */
export type OwnerActionKind = "approve" | "close" | "stop";

export interface OwnerActionView {
  /** `sending` until the POST answers; then the action's status; `done` once its outcome is read. */
  state: "sending" | "pending" | "running" | "done" | "failed";
  text: string;
  tone: "quiet" | "good" | "caution" | "bad";
  /** Nothing more to read: done with its outcome read (or none to read), or failed. */
  settled: boolean;
}

const RUNNING_TEXT: Record<OwnerActionKind, string> = {
  approve: "Entering on paper…",
  close: "Closing on paper…",
  stop: "Closing everything on paper…",
};

const FAILED_VERB: Record<OwnerActionKind, string> = {
  approve: "Couldn't enter",
  close: "Couldn't close it",
  stop: "Couldn't close everything",
};

/** An action's `lastError` in words: the runtime's refusals, then the worker's own codes. */
const ACTION_ERRORS: Record<string, string> = {
  CHECK_INTERRUPTED: "It lost its turn before acting, so nothing changed. Try again.",
  ACTION_FAILED: "The research worker hit an error, so nothing changed. Try again.",
  CLOSE_FAILED: "A paper close didn't go through.",
  PLUGIN_NOT_CONFIGURED: "It has no Perpl settings.",
  NOT_FOUND: "Pickler no longer has this request.",
};

/** A failed action's code in words: the worker's own codes, then the runtime's refusals. */
export function actionErrorText(code: string | null): string {
  if (code === null) {
    return "It could not be carried out.";
  }
  return ACTION_ERRORS[code] ?? RUNTIME_ERRORS[code] ?? `It could not be carried out (${code}).`;
}

/** What the action's check did, from its outcome: entered, blocked by a cap, closed, already closed. */
function outcomeView(kind: OwnerActionKind, check: PerpsCheckDetailDto): OwnerActionView {
  const text = check.outcomeText ?? OUTCOME_TAGS[check.outcome ?? "system"];
  const done = (line: string, tone: OwnerActionView["tone"]): OwnerActionView => ({
    state: "done",
    text: line,
    tone,
    settled: true,
  });
  switch (check.outcome) {
    case "entered":
      return done(`Entered on paper · ${text}`, "good");
    case "blocked":
      return done(`Not entered · ${text}`, "caution");
    case "exited":
      return done(`Done · ${text}`, "good");
    case "skipped":
      return done(`Nothing changed · ${text}`, "quiet");
    case "failed":
      return done(`${FAILED_VERB[kind]}. ${actionErrorText(check.error)}`, "bad");
    default:
      return done(`Done · ${text}`, "quiet");
  }
}

/**
 * One owner action as the line under the control pressed: sending, waiting for the worker (or for
 * the check holding the agent: `lastError` CHECK_RUNNING), being carried out, what its check did
 * once done, or why it failed. `outcome` is `GET /perps/checks/:checkId` once done (null until
 * read, `failed` when it could not be).
 */
export function ownerActionView(input: {
  kind: OwnerActionKind;
  action: PerpsActionDto | null;
  outcome: PerpsCheckDetailDto | null | "failed";
}): OwnerActionView {
  const { kind, action, outcome } = input;
  if (action === null) {
    return { state: "sending", text: "Sending…", tone: "quiet", settled: false };
  }
  switch (action.status) {
    case "pending": {
      let text = "Sent · the research worker picks it up within a minute.";
      if (action.lastError === "CHECK_RUNNING") {
        text = "Waiting for the current check…";
      } else if (action.lastError) {
        text = `Trying again. ${actionErrorText(action.lastError)}`;
      }
      return { state: "pending", text, tone: "quiet", settled: false };
    }
    case "running":
      return { state: "running", text: RUNNING_TEXT[kind], tone: "quiet", settled: false };
    case "failed":
      return {
        state: "failed",
        text: `${FAILED_VERB[kind]}. ${actionErrorText(action.lastError)}`,
        tone: "bad",
        settled: true,
      };
    case "done":
      if (action.checkId === null || outcome === "failed") {
        return { state: "done", text: "Done.", tone: "quiet", settled: true };
      }
      if (outcome === null || outcome.id !== action.checkId) {
        return { state: "running", text: RUNNING_TEXT[kind], tone: "quiet", settled: false };
      }
      return outcomeView(kind, outcome);
  }
}

// ─── The manual check ──────────────────────────────────────────────────────────────────────────

export interface ManualCheckView {
  label: string;
  /** "2 OF 6 MANUAL TODAY". */
  note: string;
  /** Why it is shut, or null when it can be pressed. */
  shut: string | null;
}

/** "Run a check now": the day's manual checks against the limit; one at a time. */
export function manualCheckView(
  today: PerpsRecordDto["today"],
  checking: boolean,
): ManualCheckView {
  const used = Math.min(today.manualChecks, today.manualLimit);
  let shut: string | null = null;
  if (checking) {
    shut = "A check is running.";
  } else if (used >= today.manualLimit) {
    shut = `All ${today.manualLimit} manual checks are used today (UTC).`;
  }
  return {
    label: checking ? "Checking…" : "Run a check now",
    note: `${used} OF ${today.manualLimit} MANUAL TODAY`,
    shut,
  };
}

// ─── Decisions ─────────────────────────────────────────────────────────────────────────────────

/** Each outcome's tag in the feed (the canvas's `KIND`, worded for what the runtime does). */
export const OUTCOME_TAGS: Record<CheckOutcome, string> = {
  entered: "ENTERED",
  exited: "EXITED",
  held: "HELD",
  blocked: "BLOCKED",
  proposed: "ASKED YOU",
  skipped: "SKIPPED",
  failed: "FAILED",
  system: "SYSTEM",
};

const TRIGGERS: Record<PerpsCheckSummaryDto["trigger"], string> = {
  hourly: "HOURLY",
  manual: "RUN BY YOU",
  exits: "EXITS",
  owner: "YOU",
  system: "SYSTEM",
};

const ACTIONS: Record<NonNullable<PerpsCheckSummaryDto["action"]>, string> = {
  "open-long": "LONG",
  "open-short": "SHORT",
  close: "CLOSE",
  hold: "HOLD",
};

/** The canvas's six filters with their real counts over the checks read; Posted stays at zero. */
export function runtimeFilters(
  checks: readonly PerpsCheckSummaryDto[],
  chosen: DecisionFilterKey,
): DecisionFilter[] {
  const count = (key: DecisionFilterKey) => {
    if (key === "all") {
      return checks.length;
    }
    return checks.filter((check) => check.outcome === key).length;
  };
  const keys: readonly [DecisionFilterKey, string][] = [
    ["all", "All"],
    ["entered", "Entered"],
    ["held", "Held"],
    ["exited", "Exited"],
    ["blocked", "Blocked"],
    ["posted", "Posted"],
  ];
  return keys.map(([key, label]) => ({ key, label, count: count(key), on: key === chosen }));
}

export const filterChecks = (
  checks: readonly PerpsCheckSummaryDto[],
  chosen: DecisionFilterKey,
): PerpsCheckSummaryDto[] =>
  chosen === "all" ? [...checks] : checks.filter((check) => check.outcome === chosen);

export interface DecisionLine {
  key: string;
  label: string;
  /** MET / HELD for an entry or an exit, KEPT / BROKEN for a never. */
  tag: string;
  good: boolean;
  why: string | null;
}

export interface DecisionRow {
  id: string;
  at: string;
  /** The outcome (or "running"), for its dot. */
  kind: CheckOutcome | "running";
  text: string;
  tag: string;
  inputsLine: string;
  rationale: string | null;
  lines: DecisionLine[];
  cost: string | null;
}

/** One check as a feed row: its outcome text, what it called and how sure, and what it read. */
export function decisionRow(check: PerpsCheckSummaryDto, now: number): DecisionRow {
  const running = check.status !== "finished";
  const parts: string[] = [];
  if (running) {
    parts.push(check.status === "queued" ? "Queued" : "Checking…");
  } else {
    parts.push(check.outcomeText ?? OUTCOME_TAGS[check.outcome ?? "system"]);
  }
  if (check.action && check.instrument) {
    parts.push(`${ACTIONS[check.action]} ${check.instrument}`);
  }
  if (check.strategyResult) {
    parts.push(`${check.strategyResult.strategy.id}@${check.strategyResult.strategy.version}`);
    parts.push(
      ...check.strategyResult.actions.map(
        (item) => `${item.proposal.symbol}: ${item.execution.kind}`,
      ),
    );
    if (check.strategyResult.fundingPending) {
      parts.push("FUNDING PENDING");
    }
    if (check.strategyResult.incomplete) {
      parts.push("INCOMPLETE");
    }
  }
  if (!check.strategyResult && check.probability !== null) {
    parts.push(
      `${Math.round(check.probability * 100)}%${check.horizonHours ? ` OVER ${check.horizonHours}H` : ""}`,
    );
  }
  if (check.error && !running) {
    parts.push(check.error);
  }

  const inputs = [TRIGGERS[check.trigger]];
  if (check.inputs) {
    inputs.push(check.inputs.instruments.join(", "));
    if (check.inputs.web) {
      inputs.push("WEB");
    }
  }

  const lines: DecisionLine[] = [
    ...(check.strategyResult?.actions.flatMap((item) =>
      (["entries", "exits", "never"] as const).flatMap((section) =>
        item.proposal.brief[section].map((finding) => ({
          key: `${item.proposal.symbol}-${section}-${finding.index}`,
          label: `${item.proposal.symbol} ${section.toUpperCase()} ${finding.index}`,
          tag: finding.state.toUpperCase(),
          good: section === "never" ? finding.state === "not-met" : finding.state === "met",
          why: finding.reason,
        })),
      ),
    ) ?? []),
    ...check.entries.map((line) => ({
      key: `entry-${line.index}`,
      label: `ENTRY ${line.index}`,
      tag: line.met ? "MET" : "HELD",
      good: line.met,
      why: line.why,
    })),
    ...check.exits.map((line) => ({
      key: `exit-${line.index}`,
      label: `EXIT ${line.index}`,
      tag: line.met ? "MET" : "HELD",
      good: !line.met,
      why: line.why,
    })),
    ...check.never.map((line) => ({
      key: `never-${line.index}`,
      label: `NEVER ${line.index}`,
      tag: line.broken ? "BROKEN" : "KEPT",
      good: !line.broken,
      why: null,
    })),
  ];

  return {
    id: check.id,
    at: stamp(new Date(check.at), new Date(now)),
    kind: running ? "running" : (check.outcome ?? "system"),
    text: parts.join(" · "),
    tag: running ? "RUNNING" : OUTCOME_TAGS[check.outcome ?? "system"],
    inputsLine: inputs.join(" · "),
    rationale: check.rationale,
    lines,
    cost: check.costMicros === null ? null : costLine(check.costMicros),
  };
}

/** A check's timed steps, newest first, each at its offset from the start ("0:07"). */
export function stepRows(detail: PerpsCheckDetailDto): { key: string; at: string; text: string }[] {
  const start = Date.parse(detail.startedAt ?? detail.steps[0]?.at ?? detail.at);
  return detail.steps
    .map((step, index) => ({
      key: `${index}-${step.at}`,
      at: offsetLabel(Date.parse(step.at) - start),
      text: step.text,
    }))
    .reverse();
}

// ─── The strip ─────────────────────────────────────────────────────────────────────────────────

/**
 * The strip from the newest check (canvas 88–109): its time, what it did, how long it took and its
 * steps; the count is every hourly and manual check; the log is the newest check's steps.
 */
export function runtimeStrip(input: {
  newest: PerpsCheckSummaryDto | null;
  detail: PerpsCheckDetailDto | null;
  total: number;
  paused: boolean;
  now: number;
  /** The runtime is on; off (paper held), the line says checks are paused by the operator. */
  running?: boolean;
}): StripView {
  const { newest, total } = input;
  const running = input.running ?? true;
  const count = `${total} ${total === 1 ? "CHECK" : "CHECKS"}`;
  const more = "EVERY DECISION →";
  if (!newest) {
    let line = "No checks yet · it checks Perpl every hour, on paper";
    if (!running) {
      line = "No checks · checks are paused by the operator";
    } else if (input.paused) {
      line = "No checks yet · entries are paused, so no hourly check runs";
    }
    return { line, count, log: [], more };
  }

  const detail = input.detail?.id === newest.id ? input.detail : null;
  const log = detail ? stepRows(detail).map(({ at, text }) => ({ at, text })) : [];
  const at = clock(new Date(newest.at));
  if (newest.status !== "finished") {
    return { line: `Checking now · started ${at}`, count, log, more };
  }

  const parts = [
    `Last check ${at}`,
    newest.outcomeText ?? OUTCOME_TAGS[newest.outcome ?? "system"],
  ];
  if (detail?.startedAt && detail.finishedAt) {
    parts.push(durationLabel(Date.parse(detail.finishedAt) - Date.parse(detail.startedAt)));
  }
  if (detail) {
    parts.push(`${detail.steps.length} ${detail.steps.length === 1 ? "step" : "steps"}`);
  }
  if (!running) {
    parts.push("checks paused by the operator");
  }
  return { line: parts.join(" · "), count, log, more };
}

// ─── Positions ─────────────────────────────────────────────────────────────────────────────────

export interface PositionMeter {
  /** How far from the stop toward the target the mark is, 0–1. */
  fill: number;
  stop: string;
  target: string;
  text: string;
}

export interface PositionTime {
  text: string;
  /** How much of the time stop has passed, 0–1. */
  fill: number;
  closesAt: string;
}

export interface PositionView {
  id: string;
  side: "LONG" | "SHORT";
  long: boolean;
  market: string;
  asset: string;
  pnl: string;
  pnlPct: string | null;
  tone: "up" | "down" | null;
  size: string;
  notional: string;
  leverage: number;
  worth: string;
  entry: string;
  mark: string;
  liq: string;
  meter: PositionMeter | null;
  time: PositionTime | null;
  opened: string;
  /** The check that opened it, for "Why this trade", or null. */
  checkId: string | null;
  decision: string | null;
  /** Overview's one line: "Put in 25 AUSD · 75 of BTC at 3× · worth 26.20 · 2H 26M LEFT OF 4H". */
  line: string;
}

/** The stop–target meter: where the mark sits between them, and how far each is. */
export function positionMeter(
  long: boolean,
  entry: number,
  mark: number | null,
  stop: number | null,
  target: number | null,
): PositionMeter | null {
  if (stop === null || target === null || mark === null || stop === target) {
    return null;
  }
  const progress = long ? (mark - stop) / (target - stop) : (stop - mark) / (stop - target);
  const move = (long ? 1 : -1) * (mark / entry - 1) * 100;
  const toTarget = Math.abs(target / mark - 1) * 100;
  const toStop = Math.abs(stop / mark - 1) * 100;
  return {
    fill: Math.max(0, Math.min(1, progress)),
    stop: `STOP ${formatPrice(stop)}`,
    target: `TARGET ${formatPrice(target)}`,
    text: `${signedPct(move, 2)} · ${toTarget.toFixed(2)}% TO TARGET · ${toStop.toFixed(2)}% TO STOP`,
  };
}

/** The time stop: what is left of it, how much has passed, and when it closes. */
export function positionTime(
  openedAt: string,
  exitDueAt: string | null,
  now: number,
): PositionTime | null {
  if (!exitDueAt) {
    return null;
  }
  const opened = Date.parse(openedAt);
  const due = Date.parse(exitDueAt);
  const total = Math.max(MINUTE, due - opened);
  const left = Math.max(0, due - now);
  const minutes = Math.ceil(left / MINUTE);
  const hours = Math.round(total / HOUR);
  return {
    text:
      left === 0
        ? "TIME STOP DUE · CLOSES ON THE NEXT EXIT PASS"
        : `${Math.floor(minutes / 60)}H ${String(minutes % 60).padStart(2, "0")}M LEFT OF ${hours}H`,
    fill: Math.max(0, Math.min(1, (now - opened) / total)),
    closesAt: clock(new Date(due)),
  };
}

export function positionView(position: OpenPosition, now: number): PositionView {
  const long = position.side === "long";
  const margin = Number(position.margin);
  const entry = Number(position.entryPrice);
  const mark = num(position.mark);
  const pnl = num(position.unrealizedPnl);
  const liq = num(position.liquidationEstimate);
  const time = positionTime(position.openedAt, position.exitDueAt, now);
  const worth = pnl === null ? "—" : formatTwo(margin + pnl);
  const notional = ausdShort(Math.round(Number(position.notional) * 100) / 100);

  let liqText = "—";
  if (liq !== null) {
    liqText = formatPrice(liq);
    if (mark !== null && mark > 0) {
      liqText += ` · ${(Math.abs(1 - liq / mark) * 100).toFixed(1)}% AWAY`;
    }
  }

  const lineParts = [
    `Put in ${ausdShort(margin)} AUSD`,
    `${notional} of ${position.instrument} at ${position.leverage}×`,
    `worth ${worth}`,
  ];
  if (time) {
    lineParts.push(time.text);
  }

  return {
    id: position.id,
    side: long ? "LONG" : "SHORT",
    long,
    market: `${position.instrument}-PERP`,
    asset: position.instrument,
    pnl: signedAusd(pnl),
    pnlPct: pnl === null || margin === 0 ? null : signedPct((pnl / margin) * 100, 1),
    tone: toneOf(pnl),
    size: ausdShort(margin),
    notional,
    leverage: position.leverage,
    worth,
    entry: formatPrice(entry),
    mark: mark === null ? "—" : formatPrice(mark),
    liq: liqText,
    meter: positionMeter(long, entry, mark, num(position.stopPrice), num(position.takeProfitPrice)),
    time,
    opened: stamp(new Date(position.openedAt), new Date(now)),
    checkId: position.checkId,
    decision: position.checkId ? `#${position.checkId.slice(0, 6).toUpperCase()}` : null,
    line: lineParts.join(" · "),
  };
}

/** The positions list's head: "OPEN +1.20 AUSD", or "0 OPEN" with none. */
export function openPnlLabel(open: readonly OpenPosition[]): string {
  if (open.length === 0) {
    return "0 OPEN";
  }
  const marks = open.map((position) => num(position.unrealizedPnl));
  if (marks.some((value) => value === null)) {
    return `${open.length} OPEN`;
  }
  const sum = marks.reduce<number>((total, value) => total + (value ?? 0), 0);
  return `OPEN ${signedAusd(Math.round(sum * 100) / 100)} AUSD`;
}

// ─── Waiting on you ────────────────────────────────────────────────────────────────────────────

export interface ProposalView {
  id: string;
  head: string;
  title: string;
  at: string;
  /** "VALID 4:12", or "EXPIRED" once its 15 minutes are up. */
  ttl: string;
  expired: boolean;
  putIn: string;
  notional: string;
  asset: string;
  leverage: number;
  /** The check's entry lines, each with MET or HELD, then the ask. */
  why: { key: string; text: string; tag: string; ask: boolean }[];
  cta: string;
  skip: string;
  checkId: string;
}

/** "Waiting on you"'s line beside its title. */
export const proposalsSub = (count: number): string =>
  `${count} WAITING · ONE TAP, NO PASSKEY · PAPER`;

/** A live countdown to `expiresAt`: "VALID 4:12" (m:ss), or "EXPIRED". */
export function countdown(expiresAt: string, now: number): { text: string; expired: boolean } {
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) {
    return { text: "EXPIRED", expired: true };
  }
  const seconds = Math.ceil(left / 1000);
  return {
    text: `VALID ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    expired: false,
  };
}

/** One proposal as the canvas's card, its why lines from the check that proposed it (if read). */
export function proposalView(
  proposal: PerpsProposalDto,
  now: number,
  check: PerpsCheckSummaryDto | null,
): ProposalView {
  const sizeUp = proposal.kind === "size_up";
  const margin = ausdShort(Number(proposal.margin));
  const side = proposal.side === "long" ? "LONG" : "SHORT";
  const ttl = countdown(proposal.expiresAt, now);
  const why = (check?.entries ?? []).map((line) => ({
    key: `entry-${line.index}`,
    text: line.why,
    tag: line.met ? "MET" : "HELD",
    ask: false,
  }));
  why.push({
    key: "ask",
    text: sizeUp
      ? "It went in small; the rest waits for you"
      : "You asked to approve entries · waiting",
    tag: "ASK",
    ask: true,
  });
  return {
    id: proposal.id,
    head: sizeUp ? "IN SMALL · SIZE UP?" : "IT WANTS TO ENTER",
    title: `${side} ${proposal.instrument}-PERP · ${margin} AUSD · ${proposal.leverage}×`,
    at: clock(new Date(proposal.createdAt)),
    ttl: ttl.text,
    expired: ttl.expired,
    putIn: margin,
    notional: ausdShort(Math.round(Number(proposal.notional) * 100) / 100),
    asset: proposal.instrument,
    leverage: proposal.leverage,
    why,
    cta: sizeUp ? `Size up +${margin}` : "Enter",
    skip: sizeUp ? "Keep it small" : "Skip",
    checkId: proposal.checkId,
  };
}

// ─── Record ────────────────────────────────────────────────────────────────────────────────────

const CLOSE_REASONS: Record<NonNullable<ClosedPosition["closeReason"]>, string> = {
  stop: "STOP",
  take_profit: "TAKE PROFIT",
  time: "TIME STOP",
  brief: "BRIEF EXIT",
  owner: "CLOSED BY YOU",
  stop_all: "STOP · CLOSE ALL",
  day_loss: "DAY-LOSS STOP",
};

export interface ClosedRow {
  id: string;
  title: string;
  sub: string;
  pnl: string;
  tone: "up" | "down" | null;
  at: string;
}

export function closedRow(position: ClosedPosition, now: number): ClosedRow {
  const pnl = Number(position.realizedPnl);
  const reason = position.closeReason ? CLOSE_REASONS[position.closeReason] : "CLOSED";
  const held = spanLabel(Date.parse(position.closedAt) - Date.parse(position.openedAt));
  return {
    id: position.id,
    title: `${position.side === "long" ? "LONG" : "SHORT"} ${position.instrument}-PERP · ${ausdShort(
      Number(position.margin),
    )} AUSD · ${position.leverage}×`,
    sub: `${reason} · HELD ${held}`,
    pnl: signedAusd(pnl),
    tone: toneOf(pnl),
    at: stamp(new Date(position.closedAt), new Date(now)),
  };
}

export interface RecordView {
  meta: string;
  equityHead: string;
  /** The equity series for the sparkline, oldest first. */
  trail: number[];
  up: boolean | null;
  /** The equity curve in words, for the drawing's text alternative. */
  trailText: string;
  stats: { key: string; value: string; label: string; tone: "up" | "down" | null }[];
}

/** Record's figures (R13): the head, the equity line and the five stats. */
export function recordView(record: PerpsRecordDto): RecordView {
  const trail = record.series.map((point) => point.equity);
  const first = trail[0] ?? null;
  const last = trail[trail.length - 1] ?? null;
  const equity = record.equityAusd ?? record.cashAusd;

  let up: boolean | null = null;
  if (first !== null && last !== null && last !== first) {
    up = last > first;
  }

  let dip = "0";
  if (record.maxDrawdownPct !== null) {
    dip = `${MINUS}${(record.maxDrawdownPct * 100).toFixed(1)}%`;
  } else if (record.maxDrawdownAusd > 0) {
    dip = `${MINUS}${ausdShort(record.maxDrawdownAusd)}`;
  }

  return {
    meta: `SINCE PUBLIC · ${record.closedCount} CLOSED`,
    equityHead:
      first === null
        ? `NOW ${formatTwo(equity)}`
        : `STARTED ${formatTwo(first)} · NOW ${formatTwo(equity)}`,
    trail,
    up,
    trailText:
      first === null || last === null
        ? "No equity read yet."
        : `Paper equity from ${formatTwo(first)} to ${formatTwo(last)} AUSD, low ${formatTwo(
            Math.min(...trail),
          )}, high ${formatTwo(Math.max(...trail))}.`,
    stats: [
      {
        key: "realized",
        value: signedAusd(record.realizedAusd),
        label: "REALIZED · AUSD",
        tone: toneOf(record.realizedAusd),
      },
      {
        key: "won",
        value: String(record.wins),
        label: `WON · OF ${record.closedCount} CLOSED`,
        tone: null,
      },
      { key: "dip", value: dip, label: "WORST DIP", tone: dip === "0" ? null : "down" },
      {
        key: "fees",
        value: signedAusd(record.feesAndFundingAusd),
        label: "FEES + FUNDING · AUSD",
        tone: null,
      },
      {
        key: "checks",
        value: String(record.checks),
        label: `CHECKS · ${record.entries} ENTERED`,
        tone: null,
      },
    ],
  };
}

// ─── The rail ──────────────────────────────────────────────────────────────────────────────────

/** Why Enter is shut with the runtime off: approvals open a position, so they wait for it. */
export const ENTER_OFF_REASON =
  "Checks are paused by the operator, so it enters nothing. Skip still works.";

/** Positions' badge is the open positions, Decisions' the proposals waiting on the owner. */
export const runtimeCounts = (
  positions: PerpsPositionsResponseDto | null | "failed",
  proposals: PerpsProposalDto[] | null | "failed",
): { positions: number; decisions: number } => ({
  positions: positions && positions !== "failed" ? positions.open.length : 0,
  decisions: Array.isArray(proposals) ? proposals.length : 0,
});
