"use client";

import styles from "../landing.module.css";
import { formatTapeResult } from "../lib/format";
import { useLanding } from "../lib/landing-data";

const toneClass = { won: styles.toneWin, lost: styles.toneLoss, open: styles.toneOpen };

export function Tape() {
  const { tape } = useLanding().data;
  if (tape.length === 0) {
    return null;
  }

  // Rendered twice so the -50% translate loops seamlessly; the copy is hidden from assistive tech.
  const items = (copy: boolean) =>
    tape.map((entry, i) => (
      <a
        key={`${copy ? "b" : "a"}-${i}`}
        href="#calls"
        className={styles.tapeItem}
        aria-hidden={copy || undefined}
        tabIndex={copy ? -1 : undefined}
      >
        <span className={styles.tapeTicker}>{entry.ticker}</span>
        <span className={styles.tapeCall}>{entry.call}</span>
        <span className={`${styles.tapeResult} ${toneClass[entry.outcome]}`}>
          {formatTapeResult(entry.outcome, entry.stake, entry.pnl)}
        </span>
      </a>
    ));

  return (
    <div className={styles.tape} role="region" aria-label="Latest picks">
      <div className={styles.tapeTrack}>
        {items(false)}
        {items(true)}
      </div>
    </div>
  );
}
