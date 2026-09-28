"use client";

import styles from "../landing.module.css";
import { formatTapeResult } from "../lib/format";
import { useLanding } from "../lib/landing-data";

/**
 * The picks tape: every entry is a real pick out of the snapshot, priced and settled or still open.
 *
 * The canvas draws these as links. Nothing here can be one — a tape entry carries a ticker, a call
 * and a result but no agent or pick to address, and the sections that link went to are the ones
 * this page removes. A link to an anchor that is not on the page is its own kind of lie, so these
 * are read-only.
 *
 * The list is rendered twice so that a translate of half the track lands back where it started and
 * the loop has no seam. The second copy is the same sentences again, which is noise to anything
 * listening rather than a second thing to read, so it is hidden from assistive technology — and
 * because nothing in it is focusable, hiding it costs no keyboard access either.
 */
export function Tape() {
  const { tape } = useLanding().data;
  if (tape.length === 0) {
    return null;
  }

  const items = tape.map((entry, i) => (
    <li key={`${entry.ticker}-${i}`} className={styles.tapeItem}>
      <span className={styles.tapeTicker}>{entry.ticker}</span>
      <span className={styles.tapeCall}>{entry.call}</span>
      <span className={styles.tapeResult} data-outcome={entry.outcome}>
        {formatTapeResult(entry.outcome, entry.stake, entry.pnl)}
      </span>
    </li>
  ));

  return (
    // `id` rather than a class hook: surfaces.mjs names this block to assert that it inverts, and
    // an id is unique by definition where a class selector is only unique until someone adds a
    // second class. See four-moves.tsx, which the same check reaches by `#how`.
    <div id="tape" className={styles.tape} data-surface="dark">
      <div className={styles.tapeTrack}>
        <ul className={styles.tapeList} aria-label="Latest picks">
          {items}
        </ul>
        <ul className={styles.tapeList} aria-hidden="true">
          {items}
        </ul>
      </div>
    </div>
  );
}
