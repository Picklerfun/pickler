"use client";
import { useState } from "react";
import { stripView } from "./model";
import styles from "./live.module.css";

/**
 * The live strip under the top bar (canvas 88–109, spec L6): the last check in one line with the
 * count, and under it, when opened, that check's steps and "EVERY DECISION →". With no runtime
 * there is no check: the line says so and the log is empty.
 */
export function LiveStrip({ onDecisions }: { onDecisions(): void }) {
  const [open, setOpen] = useState(false);
  const view = stripView();
  return (
    <div className={styles.strip} id="live-strip">
      <button
        type="button"
        className={styles.stripButton}
        aria-expanded={open}
        aria-controls="live-strip-log"
        onClick={() => setOpen(!open)}
      >
        <span className={styles.stripDot} aria-hidden="true" />
        <span className={styles.stripLine}>{view.line}</span>
        <span className={styles.stripCount}>{view.count}</span>
        <span className={styles.stripToggle}>{open ? "HIDE" : "SHOW"}</span>
      </button>
      {open && (
        <div className={styles.stripLog} id="live-strip-log">
          {view.log.map((step) => (
            <p key={`${step.at}-${step.text}`} className={styles.stripStep}>
              <span className={styles.stripAt}>{step.at}</span>
              <span>{step.text}</span>
            </p>
          ))}
          <button type="button" className={styles.stripMore} onClick={onDecisions}>
            {view.more}
          </button>
        </div>
      )}
    </div>
  );
}
