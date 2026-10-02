"use client";
import styles from "./build.module.css";

/**
 * The note bar over Brief and Sources & rules (canvas 679, 715). Nothing has run yet on a draft,
 * so it is the canvas's first state; "Run it" opens the Console.
 */
export function RunNote({ onRun }: { onRun(): void }) {
  return (
    <div className={styles.runNote}>
      <span className={styles.runDot} aria-hidden="true" />
      <span className={styles.runText}>EDIT FREELY · THEN RUN IT ON PAPER</span>
      <button type="button" className={styles.runButton} onClick={onRun}>
        Run it
      </button>
    </div>
  );
}
