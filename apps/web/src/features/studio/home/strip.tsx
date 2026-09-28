"use client";
import { useState } from "react";
import type { Strip as StripView } from "./status";
import styles from "./home.module.css";

/**
 * The live strip under the top bar: the run's latest step while it works, "First run finished in
 * 2m 11s · 8 steps, 6 sources" once it is done, and every step, newest first, when opened.
 */
export function Strip({
  strip,
  log,
}: {
  strip: StripView;
  log: { id: number; at: string; text: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.strip} id="home-strip">
      <button
        type="button"
        className={styles.stripBar}
        aria-expanded={open}
        aria-controls="home-strip-log"
        onClick={() => setOpen(!open)}
      >
        <span
          className={styles.stripDot}
          data-tint={strip.tint}
          data-live={strip.tint === "violet"}
        />
        <span className={styles.stripLine}>{strip.line}</span>
        {strip.count && <span className={styles.stripCount}>{strip.count}</span>}
        <span className={styles.stripToggle}>{open ? "HIDE" : "SHOW STEPS"}</span>
      </button>
      {open && (
        <ol className={styles.stripLog} id="home-strip-log">
          {log.length === 0 && <li className={styles.stripEmpty}>No steps written yet.</li>}
          {log.map((line) => (
            <li key={line.id}>
              <span className={styles.stripAt}>{line.at}</span>
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
