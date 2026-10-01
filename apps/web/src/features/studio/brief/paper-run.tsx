"use client";
import { useEffect, useState } from "react";
import { Icon, Tag } from "@pickler/ui";
import { errorCode, readPreviewRun, type PreviewRun, type RunEvent } from "../api";
import { traceLines } from "../create/trace";
import { startPolling } from "../lib/polling";
import { isTerminal, readGivesUp, type RunState } from "./model";
import { runResult } from "./result";
import create from "../create/create.module.css";
import styles from "../home/home.module.css";

const POLL_MS = 1500;

export interface PaperRunView {
  run: PreviewRun | null;
  events: RunEvent[];
}

/**
 * PAPER RUN: IDLE until a run starts, LIVE while it thinks (the runtime's own events, in the
 * canvas's line style: dot, text, time), DONE with its result, STALE once the brief changes after
 * it. It polls the preview every 1.5 s until the run is terminal and reports each read up; a staged
 * view (the design harness) is drawn as given and nothing is read. Mount it with `key` = the run's
 * id, so a new run starts from an empty trace.
 */
export function PaperRun({
  previewId,
  staged,
  state,
  perTrade,
  idleNote,
  onUpdate,
  onExpired,
}: {
  previewId: string | null;
  staged: PaperRunView | null;
  state: RunState;
  /** The per-trade cap the run was made with, for the trade card's size. */
  perTrade: number;
  idleNote: string;
  onUpdate(run: PreviewRun): void;
  /** The run can no longer be read (404: expired or cleaned up). Polling has stopped. */
  onExpired(): void;
}) {
  const [view, setView] = useState<PaperRunView>(staged ?? { run: null, events: [] });
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (!previewId || staged) {
      return;
    }
    return startPolling(
      async (signal) => {
        let read;
        try {
          read = await readPreviewRun(previewId, signal);
        } catch (caught) {
          if (!signal.aborted && readGivesUp(errorCode(caught))) {
            onExpired();
            return null;
          }
          throw caught;
        }
        if (signal.aborted) {
          return null;
        }
        setView({ run: read.run, events: read.events });
        setPollError(null);
        onUpdate(read.run);
        return isTerminal(read.run.status) ? null : POLL_MS;
      },
      (caught) => {
        setPollError(caught instanceof Error ? caught.message : "");
      },
    );
  }, [previewId, staged, onUpdate, onExpired]);

  const run = view.run;
  const lines = traceLines(view.events, run?.startedAt ?? run?.createdAt ?? 0);
  const result = run ? runResult(run, view.events, perTrade) : null;
  const failed = run !== null && run.status !== "completed" && isTerminal(run.status);

  return (
    <div className={styles.sideCard} id="brief-run" data-state={state}>
      <div className={styles.sideHead}>
        <span className={styles.sideTitle}>PAPER RUN</span>
        <span className={styles.sideState} data-state={state}>
          {state}
        </span>
      </div>
      {state === "IDLE" ? (
        <p className={styles.runIdle}>{idleNote}</p>
      ) : (
        <ol className={create.lines} aria-label="Its paper run" aria-live="polite">
          {lines.map((line) => (
            <li key={line.id} className={create.line} data-wrap="true">
              <span className={create.dot} data-tint={line.tint} />
              <span className={create.lineText}>{line.text}</span>
              <span className={create.lineMeta}>{line.meta}</span>
            </li>
          ))}
          {state === "LIVE" && (
            <li className={create.working}>
              <span className={create.pulse} />
              {run?.status === "running" ? "THINKING" : "QUEUED"}
            </li>
          )}
        </ol>
      )}
      {pollError !== null && (
        <p className={styles.alert} role="status">
          <Icon name="alert" size={13} />
          Can&apos;t read the run right now — retrying.{pollError ? ` (${pollError})` : ""}
        </p>
      )}
      {run && failed && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          Its paper run {run.status}
          {run.error ? `: ${run.error}` : "."}
        </p>
      )}
      {result && (
        <div className={styles.runResult} data-trade={result.trade}>
          <div className={styles.runResultHead}>
            <span className={styles.runEyebrow}>{result.eyebrow}</span>
            <Tag>PAPER</Tag>
          </div>
          <p className={styles.runResultTitle}>{result.title}</p>
          <p className={styles.runResultMeta}>{result.meta}</p>
        </div>
      )}
    </div>
  );
}
