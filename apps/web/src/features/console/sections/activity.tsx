"use client";
import { Button, Icon } from "@pickler/ui";
import type { Run, RunEvent } from "../api";
import { clock, duration, runMark, runSummary, type Tint } from "../decision";
import styles from "../studio.module.css";

/** What kind of step this was, so the timeline reads as phases and not as one long grey list. */
function eventTint(type: string): Tint {
  if (/fail|cancel|error/i.test(type)) {
    return "magenta";
  }
  if (/complete|paper/i.test(type)) {
    return "lime";
  }
  if (/model|policy|assess/i.test(type)) {
    return "cyan";
  }
  if (/tool|search|page|odds|evidence|source/i.test(type)) {
    return "violet";
  }
  return "grey";
}

/**
 * An event's payload in one line. The trace is for reading, not for parsing, so a long object is
 * summarised down to its scalar fields and the rest is left to the decision screens.
 */
function describe(data: unknown): string {
  if (data === null || data === undefined) {
    return "";
  }
  if (typeof data === "string") {
    return data;
  }
  if (typeof data !== "object") {
    return String(data);
  }
  if (Array.isArray(data)) {
    return `${data.length} items`;
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === null || typeof value === "object") {
      continue;
    }
    parts.push(`${key} ${value}`);
    if (parts.length === 5) {
      break;
    }
  }
  return parts.join(" · ");
}

/** Seconds since the run started, which is how a trace is read: relative, not absolute. */
function offset(event: RunEvent, run: Run): string {
  const base = run.startedAt ?? run.createdAt;
  const seconds = (event.createdAt - base) / 1000;
  return `${seconds >= 0 ? "+" : ""}${seconds.toFixed(1)}s`;
}

export function Activity({
  runs,
  runId,
  events,
  onSelect,
  onDecision,
}: {
  runs: Run[];
  runId: string | null;
  events: RunEvent[];
  onSelect(id: string): void;
  onDecision(id: string): void;
}) {
  const selected = runs.find((run) => run.id === runId) ?? runs[0];
  const failed = runs.filter((run) => run.status === "failed").length;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>Activity</h2>
        <span className={styles.count}>
          {runs.length} RUNS · {failed} FAILED
        </span>
        <p>how each run got where it got</p>
      </div>
      {!runs.length ? (
        <p className={styles.empty}>
          Nothing has run yet. Start one from the overview and the trace fills in step by step while
          it works.
        </p>
      ) : (
        <div className={styles.picks}>
          <div className={styles.runs}>
            {runs.map((run) => {
              const { mark, tint } = runMark(run);
              return (
                <button
                  key={run.id}
                  type="button"
                  className={styles.listRow}
                  data-tint={tint}
                  aria-current={run.id === selected?.id}
                  onClick={() => onSelect(run.id)}
                >
                  <span
                    className={styles.rowDot}
                    data-live={run.status === "running" || run.status === "queued"}
                  />
                  <span className={styles.rowId}>#{run.id.slice(0, 8)}</span>
                  <span className={styles.mark} data-quiet="true">
                    {run.trigger}
                  </span>
                  <span className={styles.markInline}>{mark}</span>
                  <span className={styles.rowText}>{runSummary(run)}</span>
                  <span className={styles.rowId}>
                    {clock(run.createdAt)} · {duration(run)}
                  </span>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className={styles.trace}>
              <div className={styles.listHead}>
                RUN #{selected.id.slice(0, 8)} TRACE
                <span className={styles.stamp}>
                  config v{selected.configVersion} · {selected.trigger}
                  {selected.marketId ? ` · market ${selected.marketId}` : ""}
                </span>
                {selected.decision && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className={styles.pushEnd}
                    onClick={() => onDecision(selected.id)}
                  >
                    Open decision
                    <Icon name="arrow" size={12} />
                  </Button>
                )}
              </div>
              <div className={styles.stamps}>
                {(
                  [
                    ["status", selected.status],
                    ["createdAt", clock(selected.createdAt)],
                    ["startedAt", selected.startedAt ? clock(selected.startedAt) : "null"],
                    ["finishedAt", selected.finishedAt ? clock(selected.finishedAt) : "null"],
                  ] as const
                ).map(([key, value]) => (
                  <span key={key} className={styles.source}>
                    <em className={styles.stampKey}>{key} </em>
                    {value}
                  </span>
                ))}
              </div>
              {selected.error && (
                <p className={styles.mainAlert} role="alert">
                  <Icon name="alert" size={13} />
                  {selected.error}
                </p>
              )}
              <div className={styles.timeline}>
                {selected.id !== runId || !events.length ? (
                  <p className={styles.note}>
                    {selected.status === "queued"
                      ? "Queued. The worker has not picked it up yet."
                      : "No events recorded for this run."}
                  </p>
                ) : (
                  events.map((event) => (
                    <div key={event.id} className={styles.event} data-tint={eventTint(event.type)}>
                      <span className={styles.eventRail}>
                        <span className={styles.eventDot} />
                        <i />
                      </span>
                      <span className={styles.eventBody}>
                        <span className={styles.eventHead}>
                          {event.type}
                          <time>{offset(event, selected)}</time>
                        </span>
                        <span className={styles.eventData}>{describe(event.data)}</span>
                      </span>
                    </div>
                  ))
                )}
                {selected.id === runId && events.length > 0 && (
                  <details className={styles.raw}>
                    <summary>EVERY EVENT AS STORED</summary>
                    <pre>{JSON.stringify(events, null, 2)}</pre>
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
