"use client";
import { useEffect, useState } from "react";
import { reviewRows, type Draft } from "./draft";
import { rowTint } from "./stack";
import styles from "./create.module.css";

/** The canvas's rhythm: one field every 620 ms, then a beat before the review. */
const REVEAL_MS = 620;
const SETTLE_MS = 700;

/**
 * "Got it": the draft the model returned, revealed one field at a time. The draft has already
 * arrived; the rhythm is on the client, as the spec decides (§2.1).
 */
export function Reading({
  draft,
  shown,
  onShown,
  onDone,
}: {
  draft: Draft;
  shown: number;
  onShown(count: number): void;
  onDone(): void;
}) {
  const rows = reviewRows(draft);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (shown >= rows.length) {
      const timer = setTimeout(() => setSettled(true), SETTLE_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => onShown(shown + 1), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [shown, rows.length, onShown]);

  useEffect(() => {
    if (settled) {
      onDone();
    }
  }, [settled, onDone]);

  return (
    <section className={styles.step} id="create-reading">
      <h1 className={styles.headline} tabIndex={-1}>
        GOT IT<span>.</span>
      </h1>
      {draft.prompt.trim() && <p className={styles.quote}>“{draft.prompt.trim()}”</p>}
      <ol className={styles.lines} aria-live="polite">
        {rows.slice(0, shown).map((row) => (
          <li key={row.key} className={styles.line}>
            <span className={styles.dot} data-tint={rowTint(row.key, draft)} />
            <span className={styles.lineLabel}>{row.label}</span>
            <span className={styles.lineText}>{row.value}</span>
          </li>
        ))}
        <li className={styles.working}>
          <span className={styles.pulse} />
          SETTING IT UP
        </li>
      </ol>
    </section>
  );
}
