"use client";
import { lockedCopy, type DraftSectionKey } from "./model";
import styles from "./draft.module.css";

/**
 * A section a private agent has nothing to show in (spec D2: Activity, Public profile), as the
 * canvas's locked panel draws it (835–842): "{Section} opens when it's public." and the way back.
 * `#draft-section-locked` is what the design harness proves on `?stage=draft-locked`.
 */
export function Locked({ section, onBack }: { section: DraftSectionKey; onBack(): void }) {
  const line = lockedCopy(section);
  return (
    <section
      className={styles.locked}
      id="draft-section-locked"
      aria-labelledby="draft-section-locked-title"
    >
      <h2 className={styles.lockedTitle} id="draft-section-locked-title">
        {line.slice(0, -1)}
        <span className={styles.lockedDot}>.</span>
      </h2>
      <p className={styles.lockedNote}>
        Nothing runs, posts or trades while it&apos;s a draft, so there&apos;s nothing to show here
        yet.
      </p>
      <button type="button" className={styles.lightButton} onClick={onBack}>
        Back to Overview
      </button>
    </section>
  );
}
