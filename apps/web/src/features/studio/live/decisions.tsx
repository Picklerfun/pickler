"use client";
import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "@pickler/ui";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { DECISIONS_EMPTY, decisionFilters, type DecisionFilterKey } from "./run-model";
import { RunCheck } from "./runtime-parts";
import {
  RUNTIME_DECISIONS_EMPTY,
  decisionRow,
  filterChecks,
  runtimeFilters,
  runtimeOn,
  stepRows,
} from "./runtime-model";
import styles from "./run.module.css";
import runtime from "./runtime.module.css";

/**
 * Decisions (canvas 285–324, spec L7). With the Perpl runtime off: the canvas's six filters, each
 * at zero, and the empty line. With it on: "Run a check now", the filters with their real counts,
 * and every check as a row (time, outcome, what it called, what it read) that opens on its lines,
 * its rationale and its timed steps. "Why this trade" opens it on one check (`focusCheck`). There is
 * no per-decision chat: Console stays Soon.
 */
export const Decisions: (props: LiveSectionProps) => ReactElement = (props) =>
  runtimeOn(props.live.record) ? <RuntimeDecisions {...props} /> : <EmptyDecisions />;

function Filters({
  filters,
  onChoose,
}: {
  filters: ReturnType<typeof decisionFilters>;
  onChoose(key: DecisionFilterKey): void;
}) {
  return (
    <div className={styles.filters} role="group" aria-label="Show decisions">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className={styles.filter}
          aria-pressed={filter.on}
          onClick={() => onChoose(filter.key)}
        >
          <span className={styles.filterDot} data-kind={filter.key} aria-hidden="true" />
          {filter.label}
          <span className={styles.filterCount}>{filter.count}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyDecisions() {
  const [chosen, setChosen] = useState<DecisionFilterKey>("all");
  return (
    <LiveSection section="decisions">
      <div className={styles.run}>
        <Filters filters={decisionFilters(chosen)} onChoose={setChosen} />
        <div className={styles.empty} id="live-decisions-empty">
          {DECISIONS_EMPTY}
        </div>
      </div>
    </LiveSection>
  );
}

function RuntimeDecisions({ live, now, canManage, focusCheck, onWhy }: LiveSectionProps) {
  const [chosen, setChosen] = useState<DecisionFilterKey>("all");
  /* The rows opened by hand; the focused check opens with it. */
  const [opened, setOpened] = useState<readonly string[]>([]);
  const checks = Array.isArray(live.checks) ? live.checks : [];

  function toggle(id: string) {
    const open = opened.includes(id) || id === focusCheck;
    if (open) {
      setOpened(opened.filter((key) => key !== id));
      if (id === focusCheck) {
        onWhy(null);
      }
      return;
    }
    setOpened([...opened, id]);
    if (!live.checkDetails[id] || live.checkDetails[id] === "failed") {
      void live.readCheckDetail(id);
    }
  }

  /* "Why this trade": that one check, read with its steps if the feed has not got it. */
  const focused = focusCheck ? (checks.find((check) => check.id === focusCheck) ?? null) : null;
  const focusDetail = focusCheck ? live.checkDetails[focusCheck] : undefined;
  const focusFallback = focusDetail && focusDetail !== "failed" ? focusDetail : null;
  const shown = focusCheck
    ? [focused ?? focusFallback].filter((check) => check !== null)
    : filterChecks(checks, chosen);
  /* The focused check is read with its steps, whether or not the feed has it. */
  const { readCheckDetail } = live;
  useEffect(() => {
    if (focusCheck && focusDetail === undefined) {
      void Promise.resolve().then(() => readCheckDetail(focusCheck));
    }
  }, [focusCheck, focusDetail, readCheckDetail]);

  return (
    <LiveSection section="decisions">
      <div className={styles.run}>
        <div className={runtime.decisionsHead}>
          <Filters
            filters={runtimeFilters(checks, focusCheck ? "all" : chosen)}
            onChoose={(key) => {
              onWhy(null);
              setChosen(key);
            }}
          />
          <RunCheck live={live} canManage={canManage} />
        </div>

        {focusCheck && (
          <div className={runtime.focus} id="live-decisions-focus">
            <span>THE DECISION BEHIND THIS TRADE</span>
            <button type="button" className={runtime.quietButton} onClick={() => onWhy(null)}>
              Every decision
            </button>
          </div>
        )}

        {live.queuedNote && (
          <p className={runtime.error} role="status">
            {live.queuedNote}
          </p>
        )}

        {live.checks === "failed" && (
          <div className={styles.empty} role="alert">
            Couldn&apos;t read its decisions.
            <button
              type="button"
              className={runtime.inlineButton}
              onClick={() => void live.readRuntime()}
            >
              Retry
            </button>
          </div>
        )}

        {live.checks !== "failed" && shown.length === 0 && (
          <div className={styles.empty} id="live-decisions-empty">
            {focusCheck && focusDetail === "failed"
              ? "Couldn't read that decision."
              : RUNTIME_DECISIONS_EMPTY}
          </div>
        )}

        {shown.length > 0 && (
          <ul className={runtime.rows} id="live-decisions-feed">
            {shown.map((check) => {
              const row = decisionRow(check, now);
              const open = opened.includes(row.id) || row.id === focusCheck;
              const detail = live.checkDetails[row.id];
              const bodyId = `live-decision-${row.id}`;
              return (
                <li key={row.id} className={runtime.row} data-open={open}>
                  <button
                    type="button"
                    className={runtime.rowButton}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => toggle(row.id)}
                  >
                    <span className={runtime.rowAt} suppressHydrationWarning>
                      {row.at}
                    </span>
                    <span className={runtime.rowDot} data-kind={row.kind} aria-hidden="true" />
                    <span className={runtime.rowText}>
                      <span className={runtime.rowLine}>{row.text}</span>
                      <span className={runtime.rowMeta}>
                        <span className={runtime.rowTag}>{row.tag}</span> · {row.inputsLine}
                        {row.cost ? ` · MODEL ${row.cost}` : ""}
                      </span>
                    </span>
                    <span className={runtime.rowChevron} aria-hidden="true">
                      <Icon name="chevronDown" size={13} />
                    </span>
                  </button>
                  {open && (
                    <div className={runtime.rowBody} id={bodyId}>
                      {row.rationale && <p className={runtime.rationale}>{row.rationale}</p>}
                      {row.lines.length > 0 && (
                        <ul className={runtime.lines} aria-label="The brief's lines">
                          {row.lines.map((line) => (
                            <li key={line.key} className={runtime.lineRow}>
                              <span className={runtime.lineLabel}>{line.label}</span>
                              <span className={runtime.lineTag} data-good={line.good}>
                                {line.tag}
                              </span>
                              {line.why && <span>{line.why}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {detail && detail !== "failed" ? (
                        <ol className={runtime.steps} aria-label="What it did, newest first">
                          {stepRows(detail).map((step) => (
                            <li key={step.key} className={runtime.stepRow}>
                              <span className={runtime.stepAt}>{step.at}</span>
                              <span>{step.text}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className={runtime.stepsNote} role="status">
                          {detail === "failed" ? "Couldn't read its steps." : "Reading its steps…"}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!focusCheck && live.moreChecks && (
          <button
            type="button"
            className={runtime.older}
            onClick={() => void live.readOlderChecks()}
          >
            Show older
          </button>
        )}
      </div>
    </LiveSection>
  );
}
