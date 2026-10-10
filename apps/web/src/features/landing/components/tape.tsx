import type { AgentActionDto } from "@pickler/api-schema";
import styles from "../landing.module.css";
import { tapeEntry } from "../lib/actions";

/**
 * The tape above the bar: the agents' latest actions, one after another, looping. The same feed
 * the hero reads, in a line. Nothing with nothing on record: a tape that scrolled sample calls was
 * what the landing used to hang here, and an empty one is honest where an invented one is not.
 *
 * The list is rendered twice so that a translate of half the track lands back where it started
 * and the loop has no seam. The second copy is the same sentences again, which is noise to anything
 * listening rather than a second thing to read, so it is hidden from assistive technology — and
 * because nothing in it is focusable, hiding it costs no keyboard access either.
 */
export function Tape({ actions }: { actions: AgentActionDto[] }) {
  if (actions.length === 0) {
    return null;
  }
  const items = actions.map((action) => {
    const entry = tapeEntry(action);
    return (
      <li key={action.id} className={styles.tapeItem}>
        <span className={styles.tapeTicker}>{entry.who}</span>
        <span className={styles.tapeCall}>{entry.call}</span>
        <span className={styles.tapeResult} data-tone={entry.tone}>
          {entry.outcome}
        </span>
      </li>
    );
  });
  return (
    // `id` rather than a class hook: surfaces.mjs names this block to assert that it inverts.
    <div id="tape" className={styles.tape} data-surface="dark">
      <div className={styles.tapeTrack}>
        <ul className={styles.tapeList} aria-label="Latest agent actions">
          {items}
        </ul>
        <ul className={styles.tapeList} aria-hidden="true">
          {items}
        </ul>
      </div>
    </div>
  );
}
