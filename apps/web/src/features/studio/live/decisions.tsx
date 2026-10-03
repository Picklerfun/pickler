"use client";
import { useState, type ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { DECISIONS_EMPTY, decisionFilters, type DecisionFilterKey } from "./run-model";
import styles from "./run.module.css";

/**
 * Decisions (canvas 285–324, spec L7): the canvas's six filters, each at zero, and the empty line.
 * The filters choose, as they will once there are decisions; each holds none yet.
 */
export const Decisions: (props: LiveSectionProps) => ReactElement = () => {
  const [chosen, setChosen] = useState<DecisionFilterKey>("all");
  const filters = decisionFilters(chosen);

  return (
    <LiveSection section="decisions">
      <div className={styles.run}>
        <div className={styles.filters} role="group" aria-label="Show decisions">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={styles.filter}
              aria-pressed={filter.on}
              onClick={() => setChosen(filter.key)}
            >
              <span className={styles.filterDot} data-kind={filter.key} aria-hidden="true" />
              {filter.label}
              <span className={styles.filterCount}>{filter.count}</span>
            </button>
          ))}
        </div>
        <div className={styles.empty} id="live-decisions-empty">
          {DECISIONS_EMPTY}
        </div>
      </div>
    </LiveSection>
  );
};
