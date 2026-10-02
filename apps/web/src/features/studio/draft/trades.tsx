"use client";
import { DraftSection, type DraftSectionProps } from "./draft-section";
import styles from "./run.module.css";

/**
 * Trades (canvas 639–674, spec §3.4): paper trades, none until paper runs open with the Perpl
 * runtime (D12), so only the empty state and the way to the Console. Reviewing its calls is not
 * built, so nothing says it learns from you (D19).
 */
export function Trades({ onSection }: DraftSectionProps) {
  return (
    <DraftSection section="picks">
      <div className={styles.trades}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>Paper trades</h3>
          <span className={styles.listMeta}>0</span>
        </div>
        <p className={styles.cardNote}>Every call it would have made, once paper runs open.</p>
        <div className={styles.empty}>
          <span>
            No paper trades yet. Run it from the Console and every decision lands here, with what
            fired and what held.
          </span>
          <button type="button" className={styles.whiteButton} onClick={() => onSection("console")}>
            Open Console
          </button>
        </div>
      </div>
    </DraftSection>
  );
}
