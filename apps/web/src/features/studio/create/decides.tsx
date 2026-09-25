"use client";
import { Segmented } from "@pickler/ui";
import type { StepProps } from "./flow";
import { STYLES } from "./map";
import styles from "./create.module.css";

/** The edge is the brief; the style is one of the three uncertainty presets (spec §3.1). */
export function DecidesStep({ draft, patch }: StepProps) {
  const style = STYLES.find((candidate) => candidate.value === draft.style) ?? STYLES[1]!;
  return (
    <section className={styles.step} id="create-decides">
      <h1 className={styles.headline}>
        HOW IT DECIDES<span>.</span>
      </h1>
      <div className={styles.well}>
        <p className={styles.label}>ITS EDGE</p>
        <textarea
          className={styles.prose}
          rows={3}
          value={draft.edge}
          maxLength={400}
          aria-label="Its edge"
          placeholder="It reads injury reports before the books move."
          onChange={(event) => patch({ edge: event.target.value.slice(0, 400) })}
        />
      </div>
      <div className={styles.panel}>
        <p className={styles.label}>HOW SURE BEFORE IT CALLS</p>
        <Segmented
          label="How sure before it calls"
          className={styles.segmented}
          options={STYLES}
          value={draft.style}
          onChange={(value) => patch({ style: value })}
        />
        <p className={styles.note}>{style.note}</p>
      </div>
    </section>
  );
}
