"use client";
import { useEffect, useRef, useState } from "react";
import { Icon, Tag } from "@pickler/ui";
import {
  paperOrder,
  run as readRun,
  runEvents,
  type PaperOrder,
  type Run,
  type RunEvent,
} from "../api";
import { decisionView, two } from "../decision";
import { startPolling } from "../lib/polling";
import { CEREMONY_STEPS, type CeremonyStep } from "./ceremony";
import { shortAddress, traceLines } from "./trace";
import styles from "./create.module.css";

type StepState = "pending" | "start" | "done" | "failed";

export interface CeremonyView {
  started: boolean;
  steps: Record<CeremonyStep, StepState>;
  address: string | null;
  /**
   * Whether this is the person's first agent, from the ceremony's custody read: its Wallet line
   * covers two prompts, Pickler's delegated key and then the wallet. Null until it is read.
   */
  firstAgent: boolean | null;
  agentId: string | null;
  runId: string | null;
  /** What stopped the ceremony, already in words; empty while nothing has. */
  error: string;
}

export const idleCeremony = (): CeremonyView => ({
  started: false,
  steps: { wallet: "pending", rules: "pending", agent: "pending", run: "pending" },
  address: null,
  firstAgent: null,
  agentId: null,
  runId: null,
  error: "",
});

const POLL_MS = 1500;
const RUNNER_WAIT_MS = 20_000;
const TERMINAL: Run["status"][] = ["completed", "failed", "cancelled"];

/** The command that starts a local runner: the Node executor that claims queued runs. */
const RUNNER_COMMAND = "npm run dev:agent";

function ceremonyLine(
  step: CeremonyStep,
  state: StepState,
  name: string,
  address: string | null,
  firstAgent: boolean | null,
) {
  const copy: Record<CeremonyStep, Record<StepState, string>> = {
    wallet: {
      pending: "Its wallet",
      start: firstAgent
        ? "Adding Pickler's key, then creating its wallet · confirm with your passkey twice"
        : "Creating its wallet · confirm with your passkey",
      done: `Created its wallet with your passkey${address ? ` · ${shortAddress(address)}` : ""}`,
      failed: "Its wallet was not created",
    },
    rules: {
      pending: "Its rules",
      start: "Approving its rules · confirm with your passkey",
      done: "Approved its rules: it can never withdraw on its own",
      failed: "Its rules were not approved",
    },
    agent: {
      pending: "The agent",
      start: `Creating ${name}`,
      done: `Created ${name}`,
      failed: `${name} was not created`,
    },
    run: {
      pending: "Its first run",
      start: "Starting its first run",
      done: "Started its first run, on paper",
      failed: "Its first run did not start",
    },
  };
  return copy[step][state];
}

const META: Record<StepState, string> = {
  pending: "",
  start: "PASSKEY",
  done: "DONE",
  failed: "STOPPED",
};

const TINT: Record<CeremonyStep, string> = {
  wallet: "lime",
  rules: "violet",
  agent: "amber",
  run: "blue",
};

export interface FirstCall {
  /** The stack's block: "BUY Chiefs @ 0.54" or "PASSED". */
  block: string;
}

/**
 * "Watch it think": the ceremony as a four-line rail (wallet, rules, agent, run), then the run's
 * trace polled every 1.5 s until the run is terminal, then its first call. A completed TRADE gets
 * its paper order, once. A run nobody picks up says so after 20 s rather than spinning.
 */
export function FirstRun({
  ceremony,
  name,
  onSettled,
}: {
  ceremony: CeremonyView;
  name: string;
  /** Reports the first call once the run is terminal, or null while it is still thinking. */
  onSettled(call: FirstCall | null, settled: boolean): void;
}) {
  const runId = ceremony.runId;
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [current, setCurrent] = useState<Run | null>(null);
  const [order, setOrder] = useState<PaperOrder | null>(null);
  const [orderError, setOrderError] = useState("");
  const [pollError, setPollError] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const ordered = useRef(false);

  useEffect(() => {
    if (!runId) {
      return;
    }
    const timer = setTimeout(() => setLate(true), RUNNER_WAIT_MS);
    const stop = startPolling(
      async (signal) => {
        const [trace, latest] = await Promise.all([runEvents(runId), readRun(runId)]);
        if (signal.aborted) {
          return null;
        }
        setEvents(trace.events);
        setCurrent(latest);
        setPollError(null);
        if (!TERMINAL.includes(latest.status)) {
          return POLL_MS;
        }
        if (
          latest.status === "completed" &&
          latest.decision?.action === "TRADE" &&
          !ordered.current
        ) {
          ordered.current = true;
          try {
            setOrder(await paperOrder(runId, runId));
          } catch (caught) {
            setOrderError(caught instanceof Error ? caught.message : "The paper order failed.");
          }
        }
        return null;
      },
      (caught) => {
        setPollError(caught instanceof Error ? caught.message : "");
      },
    );
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [runId]);

  const terminal = current !== null && TERMINAL.includes(current.status);
  const view = current?.decision ? decisionView(current, current.decision) : null;
  const outcome =
    order?.fill?.market.outcomes.find((candidate) => candidate.id === current?.decision?.outcomeId)
      ?.label ?? null;
  const trade = view?.action === "TRADE";
  const title = trade ? `BUY ${outcome ?? "ITS PICK"}` : view ? "IT PASSED" : "";
  const block = callBlock(view, outcome);
  /* Only a run that was read and is still queued has nobody listening. One that could not be read
     is a different problem, said differently below. */
  const waiting = late && current !== null && current.status === "queued";

  useEffect(() => {
    onSettled(terminal && block ? { block } : null, terminal || waiting);
  }, [terminal, waiting, block, onSettled]);

  const base = current?.startedAt ?? current?.createdAt ?? 0;
  const lines = traceLines(events, base);

  return (
    <section className={styles.step} id="create-run">
      <h1 className={styles.headline} tabIndex={-1}>
        WATCH IT THINK<span>.</span>
      </h1>
      <p className={styles.kicker}>PAPER MONEY · NOTHING POSTS</p>

      <ol className={styles.lines} aria-label="Creating it" aria-live="polite">
        {CEREMONY_STEPS.map((step) => {
          const state = ceremony.steps[step];
          return (
            <li key={step} className={styles.line} data-state={state}>
              <span
                className={styles.dot}
                data-tint={state === "pending" ? undefined : TINT[step]}
              />
              <span className={styles.lineText}>
                {ceremonyLine(step, state, name, ceremony.address, ceremony.firstAgent)}
              </span>
              <span className={styles.lineMeta}>{META[state]}</span>
            </li>
          );
        })}
        {lines.map((line) => (
          <li key={line.id} className={styles.line} data-wrap="true">
            <span className={styles.dot} data-tint={line.tint} />
            <span className={styles.lineText}>{line.text}</span>
            <span className={styles.lineMeta}>{line.meta}</span>
          </li>
        ))}
        {ceremony.started && !ceremony.error && !terminal && !waiting && (
          <li className={styles.working}>
            <span className={styles.pulse} />
            {runId ? "THINKING" : "SETTING IT UP"}
          </li>
        )}
      </ol>

      {!ceremony.started && (
        <p className={styles.note}>
          Nothing has been created yet. Creating it asks for your passkey: once for its wallet, once
          for its rules, and once more the very first time, to add Pickler&apos;s key.
        </p>
      )}

      {ceremony.error && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          {ceremony.error}
        </p>
      )}

      {waiting && (
        <div className={styles.panel}>
          <p className={styles.label}>WAITING FOR A RUNNER</p>
          <p className={styles.note}>
            The run is queued and nothing has picked it up. Start a local runner and it begins where
            it is:
          </p>
          <p className={styles.command}>{RUNNER_COMMAND}</p>
        </div>
      )}

      {pollError !== null && (
        <p className={styles.banner} role="status">
          <Icon name="alert" size={13} />
          Can&apos;t read the run right now — retrying.{pollError ? ` (${pollError})` : ""}
        </p>
      )}

      {current && current.status !== "completed" && terminal && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          Its first run {current.status}
          {current.error ? `: ${current.error}` : "."}
        </p>
      )}

      {terminal && view && (
        <div className={styles.pick}>
          <div className={styles.pickHead}>
            <span className={styles.label}>ITS FIRST CALL</span>
            <Tag>PAPER</Tag>
          </div>
          <p className={styles.pickTitle}>{title}</p>
          <p className={styles.pickMeta}>
            {[
              order?.fill?.market.question ?? null,
              view.observedPrice !== null ? `market ${two(view.observedPrice)}` : null,
              view.probability
                ? `its range ${two(view.probability.lower)}–${two(view.probability.upper)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {view.probability && (
            <>
              <div className={styles.range} aria-hidden="true">
                <span
                  className={styles.rangeBand}
                  style={{
                    left: `${view.probability.lower * 100}%`,
                    width: `${(view.probability.upper - view.probability.lower) * 100}%`,
                  }}
                />
                {view.observedPrice !== null && (
                  <span
                    className={styles.rangeMark}
                    style={{ left: `${view.observedPrice * 100}%` }}
                  />
                )}
              </div>
              <div className={styles.rangeLegend}>
                <span>0</span>
                <span>MARKET {two(view.observedPrice)}</span>
                <span>1</span>
              </div>
            </>
          )}
          {!trade && (view.abstentionReason || view.codes.length > 0) && (
            <p className={styles.pickMeta}>
              {view.abstentionReason || view.codes.map((code) => code.why).join(" ")}
            </p>
          )}
          {trade && <p className={styles.paper}>{paperLine(order, orderError)}</p>}
          {ceremony.address && (
            <p className={styles.walletLine}>
              <b>Its wallet</b> {shortAddress(ceremony.address)} · fund it in the studio
            </p>
          )}
        </div>
      )}
      {orderError && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          {orderError}
        </p>
      )}
    </section>
  );
}

function paperLine(order: PaperOrder | null, error: string): string {
  if (error) {
    return "NOT TRACKED ON PAPER";
  }
  if (!order) {
    return "PLACING IT ON PAPER…";
  }
  if (order.status === "filled" && order.fill) {
    return `TRACKED ON PAPER · ${order.fill.quantity} AT ${order.fill.averagePrice}`;
  }
  if (order.status === "pending") {
    return "PLACING IT ON PAPER…";
  }
  return `NOT FILLED ON PAPER${order.reason ? ` · ${order.reason}` : ""}`;
}

/** The stack's block for the first call: "BUY Chiefs @ 0.54", or "PASSED". */
function callBlock(view: ReturnType<typeof decisionView> | null, outcome: string | null) {
  if (!view) {
    return null;
  }
  if (view.action !== "TRADE") {
    return "PASSED";
  }
  const what = outcome ? `BUY ${outcome}` : "BUY";
  return view.observedPrice === null ? what : `${what} @ ${two(view.observedPrice)}`;
}
